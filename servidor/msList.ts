import { isSamePerson } from './previousAccount.ts';
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseMsList, parseMsListChanges, type MsListChange, type MsListItem } from '../src/domain/msListParse.ts';
import { ApiError } from './api.ts';
import { findGestorFile } from './calendar.ts';
import type { TeamUser } from './auth.ts';

/**
 * Microsoft List (SharePoint) sin permisos de Microsoft, igual que el calendario: un flujo de Power Automate guarda los
 * elementos en `OneDrive/Gestor/lista.json` y OneDrive lo sincroniza a este ordenador. Para escribir, el servidor apunta
 * los cambios en `OneDrive/Gestor/cambios/lista-cambios.json`; OneDrive lo sube y un segundo flujo («Cuando se modifica un
 * archivo») los aplica con «Actualizar elemento». Un cambio se borra solo cuando la lista ya lo refleja; mientras tanto,
 * los elementos se devuelven con el valor nuevo, así la siguiente exportación no lo deshace.
 */

export interface MsListStatus {
  linked: boolean;
  found: boolean;
}

export const findListFile = () => findGestorFile('lista.json', 'GESTOR_LISTA');
/** Carpeta aparte para los cambios: así el segundo flujo no se dispara cada vez que el primero escribe la lista. */
export const changesPathFor = (listPath: string) => join(dirname(listPath), 'cambios', 'lista-cambios.json');

/** Cambios que la lista todavía no refleja (los demás ya están aplicados). Del mismo elemento y columna, gana el último. */
export function pendingChanges(items: MsListItem[], changes: MsListChange[]): MsListChange[] {
  const byKey = new Map<string, MsListChange>();
  for (const c of changes) byKey.set(`${c.id} ${c.campo}`, c);
  const byId = new Map(items.map((it) => [it.id, it]));
  return [...byKey.values()].filter((c) => {
    const item = byId.get(c.id);
    return item !== undefined && (item.fields[c.campo] ?? '') !== c.valor;
  });
}

/** Elementos con los cambios pendientes ya puestos (lo que habrá en la lista cuando el flujo los aplique). */
export function withPending(items: MsListItem[], pending: MsListChange[]): MsListItem[] {
  if (!pending.length) return items;
  return items.map((it) => {
    const mine = pending.filter((c) => c.id === it.id);
    return mine.length ? { ...it, fields: { ...it.fields, ...Object.fromEntries(mine.map((c) => [c.campo, c.valor])) } } : it;
  });
}

export class MsList {
  private db: DatabaseSync;
  private findFile: () => string | null;
  private cache: { path: string; mtime: number; items: MsListItem[] } | null = null;

  constructor(db: DatabaseSync, findFile: () => string | null = findListFile) {
    this.db = db;
    this.findFile = findFile;
    db.exec('CREATE TABLE IF NOT EXISTS mslist_files (user_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL)');
  }

  private linked(user: TeamUser): string | null {
    const row = this.db.prepare('SELECT path FROM mslist_files WHERE user_id = ?').get(user.id) as { path: string } | undefined;
    return row?.path ?? null;
  }

  status(user: TeamUser): MsListStatus {
    const path = this.linked(user);
    return { linked: !!path, found: !!(path ? existsSync(path) : this.findFile()) };
  }

  /** Vincula a esta cuenta el archivo del flujo que hay en este ordenador (si no lo tiene ya otra cuenta). */
  link(user: TeamUser): MsListStatus {
    const path = this.findFile();
    if (!path) throw new ApiError(400, 'No encuentro Gestor/lista.json en tu OneDrive. Comprueba que el flujo se ha ejecutado y que OneDrive está sincronizado.');
    const owner = this.db.prepare('SELECT user_id FROM mslist_files WHERE path = ?').get(path) as { user_id: string } | undefined;
    if (owner && !isSamePerson(this.db, owner.user_id, user)) throw new ApiError(400, 'Esa lista ya está vinculada a otra cuenta.');
    // Era de su cuenta de antes de Supabase: pasa a la de ahora.
    if (owner && owner.user_id !== user.id) this.db.prepare('DELETE FROM mslist_files WHERE user_id = ?').run(owner.user_id);
    this.db.prepare(`INSERT INTO mslist_files (user_id, path, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`).run(user.id, path, new Date().toISOString());
    return this.status(user);
  }

  unlink(user: TeamUser): MsListStatus {
    this.db.prepare('DELETE FROM mslist_files WHERE user_id = ?').run(user.id);
    return this.status(user);
  }

  private async readItems(path: string): Promise<{ items: MsListItem[]; mtime: number }> {
    let mtime: number;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      throw new ApiError(400, 'El archivo de la lista ya no está en tu OneDrive.');
    }
    if (this.cache?.path !== path || this.cache.mtime !== mtime) {
      let json: unknown;
      try {
        json = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
      } catch {
        throw new ApiError(502, 'El archivo de la lista no es JSON válido (¿el flujo lo está escribiendo en este momento?).');
      }
      this.cache = { path, mtime, items: parseMsList(json) };
    }
    return { items: this.cache.items, mtime };
  }

  private async readChanges(listPath: string): Promise<MsListChange[]> {
    try {
      return parseMsListChanges(JSON.parse((await readFile(changesPathFor(listPath), 'utf8')).replace(/^﻿/, '')));
    } catch {
      return [];
    }
  }

  /** Escribe el archivo de cambios de golpe (temporal + renombrar), para que OneDrive nunca suba uno a medias. */
  private async writeChanges(listPath: string, changes: MsListChange[]) {
    const file = changesPathFor(listPath);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ cambios: changes }, null, 2));
    await rename(tmp, file);
  }

  /**
   * Elementos de la lista con los cambios pendientes ya puestos, cuándo escribió el flujo el archivo y qué cambios
   * faltan por aplicar. De paso limpia del archivo de cambios los que la lista ya refleja.
   */
  async items(user: TeamUser): Promise<{ items: MsListItem[]; updatedAt: string; pending: MsListChange[] }> {
    const path = this.linked(user);
    if (!path) throw new ApiError(400, 'Vincula el archivo de la lista de Power Automate.');
    const { items, mtime } = await this.readItems(path);
    const changes = await this.readChanges(path);
    const pending = pendingChanges(items, changes);
    if (pending.length !== changes.length) await this.writeChanges(path, pending).catch(() => {});
    return { items: withPending(items, pending), updatedAt: new Date(mtime).toISOString(), pending };
  }

  /** Apunta un cambio de una columna (la de estado) para que el segundo flujo lo aplique en la lista. */
  async change(user: TeamUser, input: { id?: unknown; campo?: unknown; valor?: unknown }): Promise<{ pending: MsListChange[] }> {
    const path = this.linked(user);
    if (!path) throw new ApiError(400, 'Vincula el archivo de la lista de Power Automate.');
    const id = String(input.id ?? '').trim();
    const campo = String(input.campo ?? '').trim();
    const valor = String(input.valor ?? '').trim();
    if (!/^\d{1,12}$/.test(id)) throw new ApiError(400, 'Elemento de la lista no válido.');
    if (!campo || campo.length > 255 || !valor || valor.length > 255) throw new ApiError(400, 'Cambio de la lista no válido.');
    const { items } = await this.readItems(path);
    const item = items.find((it) => it.id === id);
    if (!item) throw new ApiError(404, 'Ese elemento ya no está en la lista.');
    const changes = (await this.readChanges(path)).filter((c) => !(c.id === id && c.campo === campo));
    changes.push({ id, campo, valor, titulo: item.title, at: new Date().toISOString() });
    const pending = pendingChanges(items, changes);
    await this.writeChanges(path, pending);
    return { pending };
  }
}
