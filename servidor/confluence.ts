import type { DatabaseSync } from 'node:sqlite';
import type { ConfluenceStatus, ConfluenceTask } from '../src/domain/confluence.ts';
import { ApiError } from './api.ts';
import { htmlToText } from './rally.ts';
import type { TeamUser } from './visibility.ts';

/**
 * Conector de Confluence Data Center/Server con el Personal Access Token de cada usuario (cabecera
 * `Authorization: Bearer`). El token se guarda solo aquí y nunca vuelve al navegador. Trae las tareas (casillas de las
 * páginas) asignadas a la persona, con el título y el espacio de su página.
 *
 * Ojo: el Confluence de CaixaBank solo es accesible desde su red (VPN o escritorio virtual). Desde fuera, el nombre ni
 * siquiera se resuelve y se avisa con un mensaje claro.
 */

/** Confluence de CaixaBank; se puede cambiar al conectar. */
export const DEFAULT_CONFLUENCE_URL = 'https://confluence.cloud.lacaixa.es/confluence';
const PAGE = 100;
const MAX_TASKS = 1000;

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

/** Dirección https de Confluence, sin la parte de la interfaz (`#all-updates`, `/display/…`, `/pages/…`). */
export function normalizeConfluenceUrl(input: unknown): string {
  const raw = String(input ?? '').trim() || DEFAULT_CONFLUENCE_URL;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ApiError(400, 'La dirección de Confluence no es válida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(400, 'La dirección de Confluence debe empezar por https://.');
  const path = url.pathname.replace(/\/(display|pages|spaces|rest|dashboard\.action|index\.action)(\/.*)?$/, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Milisegundos o fecha ISO de la API → `YYYY-MM-DD` local (o null). */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : String(v));
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tarea de la API (`/rest/api/inlinetasks/search`) → tarea del gestor, sin la página (se añade después). */
export function toConfluenceTask(t: Json): ConfluenceTask | null {
  const id = String(t.globalId ?? t.id ?? '');
  if (!id) return null;
  const body = String(t.body ?? t.description ?? t.title ?? '');
  const text = htmlToText(body).replace(/\s*\n\s*/g, '\n').trim();
  return {
    id,
    text: text || '(tarea sin texto)',
    done: String(t.status ?? '').toLowerCase() === 'complete' || String(t.status ?? '').toUpperCase() === 'CHECKED',
    dueDate: toIsoDate(t.dueDate),
    createdAt: t.createDate ? new Date(Number(t.createDate) || String(t.createDate)).toISOString() : null,
    pageId: t.contentId !== undefined && t.contentId !== null ? String(t.contentId) : t.pageId !== undefined ? String(t.pageId) : null,
    pageTitle: null,
    space: null,
    url: null,
  };
}

export class Confluence {
  private db: DatabaseSync;
  private fetch: Fetch;

  constructor(db: DatabaseSync, fetcher: Fetch = fetch) {
    this.db = db;
    this.fetch = fetcher;
    db.exec(`CREATE TABLE IF NOT EXISTS confluence_accounts (user_id TEXT PRIMARY KEY, token TEXT NOT NULL, base_url TEXT NOT NULL,
      cf_user_key TEXT NOT NULL, cf_user TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  }

  private account(user: TeamUser) {
    return this.db.prepare('SELECT * FROM confluence_accounts WHERE user_id = ?').get(user.id) as
      { token: string; base_url: string; cf_user_key: string; cf_user: string } | undefined;
  }

  status(user: TeamUser): ConfluenceStatus {
    const a = this.account(user);
    return a ? { connected: true, baseUrl: a.base_url, tokenHint: a.token.slice(-4), user: a.cf_user }
      : { connected: false, baseUrl: DEFAULT_CONFLUENCE_URL, tokenHint: null, user: null };
  }

  private async get(baseUrl: string, token: string, path: string): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    } catch {
      const host = (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })();
      throw new ApiError(502, `No se puede conectar con Confluence (${host}). Esa dirección solo funciona dentro de la red del cliente: `
        + 'con su VPN o desde su escritorio virtual. Desde este ordenador no se llega.');
    }
    if (res.status === 401 || res.status === 403) throw new ApiError(400, 'Confluence no acepta el token: revísalo o crea uno nuevo (Perfil → Personal Access Tokens).');
    if (res.status === 404) throw new ApiError(502, 'Confluence no tiene esa función (404): puede que la versión no la incluya o que la dirección no sea la base de Confluence.');
    if (!res.ok) throw new ApiError(502, `Confluence ha respondido con un error (${res.status}).`);
    const json = await res.json().catch(() => null) as Json | null;
    if (!json) throw new ApiError(502, 'Confluence no ha devuelto datos válidos (¿te ha llevado a una página de inicio de sesión?).');
    return json;
  }

  /** Comprueba el token pidiendo el usuario actual y lo guarda. */
  async connect(user: TeamUser, input: { token?: unknown; baseUrl?: unknown }): Promise<ConfluenceStatus> {
    const token = String(input.token ?? '').trim();
    if (!token) throw new ApiError(400, 'Pega tu Personal Access Token de Confluence.');
    const baseUrl = normalizeConfluenceUrl(input.baseUrl);
    const me = await this.get(baseUrl, token, '/rest/api/user/current');
    // Sin sesión válida, Confluence responde 200 con un usuario anónimo.
    if (me.type === 'anonymous' || !(me.userKey || me.accountId || me.username)) {
      throw new ApiError(400, 'Confluence no reconoce el token (te trata como anónimo): revísalo o crea uno nuevo.');
    }
    const key = String(me.userKey ?? me.accountId ?? me.username);
    const name = String(me.displayName || me.username || key);
    this.db.prepare(`INSERT INTO confluence_accounts (user_id, token, base_url, cf_user_key, cf_user, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, base_url = excluded.base_url, cf_user_key = excluded.cf_user_key,
      cf_user = excluded.cf_user, updated_at = excluded.updated_at`)
      .run(user.id, token, baseUrl, key, name, new Date().toISOString());
    return this.status(user);
  }

  disconnect(user: TeamUser): ConfluenceStatus {
    this.db.prepare('DELETE FROM confluence_accounts WHERE user_id = ?').run(user.id);
    return this.status(user);
  }

  private connected(user: TeamUser) {
    const a = this.account(user);
    if (!a) throw new ApiError(400, 'Conecta Confluence con tu token.');
    return a;
  }

  /**
   * Tareas asignadas a la persona (pendientes; con `done`, también las completadas), de 100 en 100 hasta 1.000, con el
   * título, el espacio y el enlace de su página. Las más urgentes primero (con fecha, por fecha; luego las más nuevas).
   */
  async tasks(user: TeamUser, input: { done?: unknown } = {}): Promise<ConfluenceTask[]> {
    const a = this.connected(user);
    const statuses = input.done === true || input.done === '1' ? ['incomplete', 'complete'] : ['incomplete'];
    const tasks: ConfluenceTask[] = [];
    for (const status of statuses) {
      for (let start = 0; start < MAX_TASKS; start += PAGE) {
        const params = new URLSearchParams({ assignee: a.cf_user_key, status, start: String(start), limit: String(PAGE) });
        const json = await this.get(a.base_url, a.token, `/rest/api/inlinetasks/search?${params}`);
        const rows = (Array.isArray(json.results) ? json.results : []) as Json[];
        for (const r of rows) {
          const t = toConfluenceTask(r);
          if (t) tasks.push(t);
        }
        if (rows.length < PAGE) break;
      }
    }
    await this.addPages(a, tasks);
    return tasks.sort((x, y) => (x.done === y.done ? 0 : x.done ? 1 : -1)
      || (x.dueDate && y.dueDate ? x.dueDate.localeCompare(y.dueDate) : x.dueDate ? -1 : y.dueDate ? 1 : 0)
      || (y.createdAt ?? '').localeCompare(x.createdAt ?? ''));
  }

  /** Título, espacio y enlace de las páginas de las tareas, de 50 en 50 con CQL (`id in (…)`). Si falla, sin página. */
  private async addPages(a: { base_url: string; token: string }, tasks: ConfluenceTask[]) {
    const ids = [...new Set(tasks.map((t) => t.pageId).filter((id): id is string => !!id && /^\d+$/.test(id)))];
    const pages = new Map<string, { title: string; space: string | null; url: string | null }>();
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams({ cql: `id in (${ids.slice(i, i + 50).join(',')})`, expand: 'space', limit: '50' });
      const json = await this.get(a.base_url, a.token, `/rest/api/content/search?${params}`).catch(() => null);
      for (const p of ((json?.results ?? []) as Json[])) {
        const space = p.space as Json | undefined;
        const webui = (p._links as Json | undefined)?.webui;
        pages.set(String(p.id), {
          title: String(p.title ?? ''),
          space: space ? String(space.name ?? space.key ?? '') || null : null,
          url: typeof webui === 'string' ? `${a.base_url}${webui}` : null,
        });
      }
    }
    for (const t of tasks) {
      const p = t.pageId ? pages.get(t.pageId) : undefined;
      t.pageTitle = p?.title || null;
      t.space = p?.space ?? null;
      t.url = p?.url ?? (t.pageId ? `${a.base_url}/pages/viewpage.action?pageId=${t.pageId}` : null);
    }
  }
}
