import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  isGlobal, isPersonal, isSyncTable, PERSONAL_TASK_FIELDS, relatedKeys, visibleKeys,
  type StoredRecord, type SyncTable, type TeamUser,
} from './visibility.ts';

/**
 * Lógica del servidor sin HTTP (así se prueba directamente): cuentas provisionales, sesiones y
 * sincronización de registros. Cada cambio sube un número de versión global; la app pide "lo que ha
 * cambiado desde la versión N" y recibe solo lo que puede ver.
 */

const SESSION_DAYS = 30;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Change { table: string; key: string; data: Record<string, unknown> | null }
export interface PulledChange { table: SyncTable; key: string; data: Record<string, unknown> | null; owner: string | null }

type Row = { tbl: SyncTable; key: string; scope: string; owner: string; data: string | null; version: number };

const hash = (password: string) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const verify = (password: string, stored: string) => {
  const [salt, hex] = stored.split(':');
  const a = scryptSync(password, salt, 64);
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export class Api {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (tbl TEXT NOT NULL, key TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL,
        data TEXT, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tbl, key, scope));
      CREATE INDEX IF NOT EXISTS records_version ON records (version);
      CREATE TABLE IF NOT EXISTS overlays (tbl TEXT NOT NULL, key TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (tbl, key, user_id));
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
    if (!this.kv('team_code')) {
      const raw = randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      this.setKv('team_code', `${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
    }
  }

  private kv(k: string) {
    return (this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null;
  }
  private setKv(k: string, v: string) {
    this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
  }

  /** Código que hay que dar a los compañeros para que creen su cuenta. */
  get teamCode() { return this.kv('team_code')!; }
  get version() { return Number(this.kv('version') ?? 0); }

  // ---------- Cuentas y sesiones ----------

  team(): TeamUser[] {
    return this.db.prepare('SELECT id, login, name FROM users ORDER BY name').all() as unknown as TeamUser[];
  }

  register(input: { login?: unknown; name?: unknown; password?: unknown; code?: unknown }) {
    const login = String(input.login ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim();
    const password = String(input.password ?? '');
    if (String(input.code ?? '').trim().toUpperCase() !== this.teamCode) throw new ApiError(403, 'El código del equipo no es correcto.');
    if (!/^[a-z0-9._@+-]{2,80}$/.test(login)) throw new ApiError(400, 'El usuario puede ser tu email o un nombre sin espacios ni tildes.');
    if (!name) throw new ApiError(400, 'Escribe tu nombre (es el que se usa al mencionarte).');
    if (password.length < 8) throw new ApiError(400, 'La contraseña tiene que tener al menos 8 caracteres.');
    if (this.db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw new ApiError(409, 'Ese usuario ya existe.');
    const user: TeamUser = { id: randomUUID(), login, name };
    this.db.prepare('INSERT INTO users (id, login, name, pass, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, login, name, hash(password), new Date().toISOString());
    return { user, token: this.newSession(user.id) };
  }

  login(input: { login?: unknown; password?: unknown }) {
    const login = String(input.login ?? '').trim().toLowerCase();
    const row = this.db.prepare('SELECT id, login, name, pass FROM users WHERE login = ?').get(login) as (TeamUser & { pass: string }) | undefined;
    if (!row || !verify(String(input.password ?? ''), row.pass)) throw new ApiError(401, 'Usuario o contraseña incorrectos.');
    const { pass: _pass, ...user } = row;
    return { user, token: this.newSession(user.id) };
  }

  private newSession(userId: string) {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    this.db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, expires);
    return token;
  }

  userForToken(token: string | undefined): TeamUser | null {
    if (!token) return null;
    const row = this.db.prepare(`SELECT u.id, u.login, u.name FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires > ?`).get(token, new Date().toISOString()) as TeamUser | undefined;
    return row ? { ...row } : null;
  }

  logout(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ---------- Sincronización ----------

  /** Registros que pueden interesar al usuario: los de tablas con dueño y globales, y los suyos personales. */
  private rows(user: TeamUser): StoredRecord[] {
    const rows = this.db.prepare('SELECT tbl, key, scope, owner, data, version FROM records WHERE scope = \'\' OR scope = ?')
      .all(user.id) as unknown as Row[];
    return rows.map((r) => ({ table: r.tbl, key: r.key, owner: r.owner, data: r.data ? JSON.parse(r.data) : null, version: r.version }));
  }

  private withOverlay(table: SyncTable, key: string, data: Record<string, unknown>, user: TeamUser) {
    if (table !== 'tasks') return data;
    const o = this.db.prepare('SELECT data FROM overlays WHERE tbl = ? AND key = ? AND user_id = ?').get(table, key, user.id) as { data: string } | undefined;
    const personal = o ? JSON.parse(o.data) : {};
    return { ...data, ...Object.fromEntries(PERSONAL_TASK_FIELDS.map((f) => [f, personal[f] ?? null])) };
  }

  push(user: TeamUser, changes: Change[]) {
    const all = this.rows(user);
    const visible = visibleKeys(all.filter((r) => !isPersonal(r.table) && !isGlobal(r.table)), user);
    const existing = new Map(all.map((r) => [`${r.table}:${r.key}`, r]));
    const rejected: string[] = [];
    const now = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      for (const c of changes) {
        if (!isSyncTable(c.table) || typeof c.key !== 'string' || !c.key) continue;
        const table = c.table;
        const id = `${table}:${c.key}`;
        const before = existing.get(id);
        const owned = !isPersonal(table) && !isGlobal(table);
        // Solo se puede cambiar lo propio o lo que te han compartido.
        if (owned && before?.data && before.owner !== user.id && !visible.has(id)) { rejected.push(id); continue; }
        let data = c.data && typeof c.data === 'object' ? { ...c.data } : null;
        if (table === 'tasks' && data) {
          const personal = Object.fromEntries(PERSONAL_TASK_FIELDS.map((f) => [f, data![f] ?? null]));
          this.db.prepare(`INSERT INTO overlays (tbl, key, user_id, data) VALUES (?, ?, ?, ?)
            ON CONFLICT(tbl, key, user_id) DO UPDATE SET data = excluded.data`).run(table, c.key, user.id, JSON.stringify(personal));
          for (const f of PERSONAL_TASK_FIELDS) data[f] = null;
        }
        const version = this.version + 1;
        this.setKv('version', String(version));
        const scope = isPersonal(table) ? user.id : '';
        const owner = isGlobal(table) ? '' : before?.owner || user.id;
        this.db.prepare(`INSERT INTO records (tbl, key, scope, owner, data, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tbl, key, scope) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`)
          .run(table, c.key, scope, owner, data ? JSON.stringify(data) : null, version, now);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { version: this.version, rejected };
  }

  /**
   * Cambios desde `since` que afectan al usuario. Lo que deja de verse (le quitan la mención) llega
   * como borrado, y al recibir algo compartido llegan también su proyecto y su release.
   */
  pull(user: TeamUser, since: number): { version: number; changes: PulledChange[] } {
    const all = this.rows(user);
    const ownedRows = all.filter((r) => !isPersonal(r.table) && !isGlobal(r.table));
    const visible = visibleKeys(ownedRows, user);
    const byId = new Map(all.map((r) => [`${r.table}:${r.key}`, r]));
    const send = new Set<string>();
    for (const r of all) if (r.version > since) send.add(`${r.table}:${r.key}`);
    // Lo que acaba de compartirse arrastra su proyecto (con padres) y su release aunque no hayan cambiado.
    for (const id of [...send]) {
      const r = byId.get(id)!;
      if (visible.has(id)) for (const rel of relatedKeys(r, byId)) send.add(rel);
    }
    const changes: PulledChange[] = [];
    // En el orden en que se hicieron los cambios.
    for (const id of [...send].sort((x, y) => byId.get(x)!.version - byId.get(y)!.version)) {
      const r = byId.get(id)!;
      const owned = !isPersonal(r.table) && !isGlobal(r.table);
      const canSee = !owned || visible.has(id);
      // Para quien no puede verlo, se manda como borrado (si lo tenía, desaparece; si no, no pasa nada).
      if (owned && !canSee) { if (r.version > since) changes.push({ table: r.table, key: r.key, data: null, owner: null }); continue; }
      changes.push({
        table: r.table, key: r.key, owner: owned ? r.owner : null,
        data: r.data ? this.withOverlay(r.table, r.key, r.data, user) : null,
      });
    }
    return { version: this.version, changes };
  }
}
