import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { trimTeamsChats, type TeamsChat } from '../src/domain/teamsChats.ts';
import { ApiError } from './api.ts';
import { findGestorFile } from './calendar.ts';
import type { TeamUser } from './visibility.ts';

/**
 * Chats de Teams (solo lectura), igual que las reuniones: un flujo de Power Automate guarda la respuesta de Microsoft
 * Graph en `OneDrive/Gestor/chats.json`, OneDrive lo sincroniza a este ordenador y el servidor lo lee de la carpeta
 * local. Sin tokens ni permisos nuevos. Se vincula a una sola cuenta (son los chats de quien tiene el OneDrive).
 * Los mensajes son privados: no se escriben en el registro del servidor ni salen de aquí salvo hacia su dueña.
 */

export interface ChatsStatus {
  linked: boolean;
  found: boolean;
}

export const findChatsFile = () => findGestorFile('chats.json', 'GESTOR_CHATS');

export class Chats {
  private db: DatabaseSync;
  private findFile: () => string | null;
  private cache: { path: string; mtime: number; chats: TeamsChat[] } | null = null;

  constructor(db: DatabaseSync, findFile: () => string | null = findChatsFile) {
    this.db = db;
    this.findFile = findFile;
    db.exec('CREATE TABLE IF NOT EXISTS chat_files (user_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL)');
  }

  private linked(user: TeamUser): string | null {
    const row = this.db.prepare('SELECT path FROM chat_files WHERE user_id = ?').get(user.id) as { path: string } | undefined;
    return row?.path ?? null;
  }

  status(user: TeamUser): ChatsStatus {
    const path = this.linked(user);
    return { linked: !!path, found: !!(path ? existsSync(path) : this.findFile()) };
  }

  /** Vincula a esta cuenta el archivo del flujo que hay en este ordenador (si no lo tiene ya otra cuenta). */
  link(user: TeamUser): ChatsStatus {
    const path = this.findFile();
    if (!path) throw new ApiError(400, 'No encuentro Gestor/chats.json en tu OneDrive. Comprueba que el flujo se ha ejecutado y que OneDrive está sincronizado.');
    const owner = this.db.prepare('SELECT user_id FROM chat_files WHERE path = ?').get(path) as { user_id: string } | undefined;
    if (owner && owner.user_id !== user.id) throw new ApiError(400, 'Esos chats ya están vinculados a otra cuenta.');
    this.db.prepare(`INSERT INTO chat_files (user_id, path, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`).run(user.id, path, new Date().toISOString());
    return this.status(user);
  }

  unlink(user: TeamUser): ChatsStatus {
    this.db.prepare('DELETE FROM chat_files WHERE user_id = ?').run(user.id);
    return this.status(user);
  }

  /** Chats del archivo (se vuelve a leer solo cuando cambia) y cuándo lo escribió el flujo por última vez. */
  async chats(user: TeamUser): Promise<{ chats: TeamsChat[]; updatedAt: string }> {
    const path = this.linked(user);
    if (!path) throw new ApiError(400, 'Vincula el archivo de chats de Power Automate.');
    let mtime: number;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      throw new ApiError(400, 'El archivo de chats ya no está en tu OneDrive.');
    }
    if (this.cache?.path !== path || this.cache.mtime !== mtime) {
      let json: unknown;
      try {
        json = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
      } catch {
        throw new ApiError(502, 'El archivo de chats no es JSON válido (¿el flujo lo está escribiendo en este momento?).');
      }
      this.cache = { path, mtime, chats: trimTeamsChats(json) };
    }
    return { chats: this.cache.chats, updatedAt: new Date(mtime).toISOString() };
  }
}
