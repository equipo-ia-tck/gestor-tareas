import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  isGlobal, isPersonal, isSyncTable, PERSONAL_TASK_FIELDS, relatedKeys, spaceOfProject, visibleKeys,
  type StoredRecord, type SyncTable, type TeamUser,
} from './visibility.ts';

/**
 * Lógica del servidor sin HTTP (así se prueba directamente): cuentas provisionales, sesiones, espacios
 * de equipo y sincronización de registros. Cada cambio sube un número de versión global; la app pide
 * "lo que ha cambiado desde la versión N" y recibe solo lo que puede ver. Cuando cambia lo que alguien
 * puede ver (entra o sale de un espacio, un proyecto pasa a otro espacio), su siguiente petición recibe
 * todo de nuevo (`reset`).
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

/** Espacio tal como lo ve un miembro (el código de invitación solo lo ven sus miembros). */
export interface SpaceView {
  id: string;
  name: string;
  color: string;
  members: { id: string; role: 'admin' | 'member' }[];
  inviteCode: string;
  role: 'admin' | 'member';
}

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
const newCode = () => {
  const raw = randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};
const normCode = (c: unknown) => String(c ?? '').trim().toUpperCase();

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
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS space_members (space_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        PRIMARY KEY (space_id, user_id));
    `);
    // Migración desde la versión sin espacios: las cuentas que ya existían son administradoras.
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('is_admin')) {
      db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0; UPDATE users SET is_admin = 1;');
    }
    if (!cols.includes('access_version')) db.exec('ALTER TABLE users ADD COLUMN access_version INTEGER NOT NULL DEFAULT 0');
    if (!this.kv('team_code')) this.setKv('team_code', newCode());
  }

  private kv(k: string) {
    return (this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null;
  }
  private setKv(k: string, v: string) {
    this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
  }

  /** Código de administración del servidor: crea cuentas administradoras (sale en la terminal). */
  get teamCode() { return this.kv('team_code')!; }
  get version() { return Number(this.kv('version') ?? 0); }
  private nextVersion() {
    const v = this.version + 1;
    this.setKv('version', String(v));
    return v;
  }

  // ---------- Cuentas y sesiones ----------

  /** Directorio: todas las cuentas del servidor (para poder mencionar a cualquiera). */
  team(): TeamUser[] {
    return this.db.prepare('SELECT id, login, name FROM users ORDER BY name').all() as unknown as TeamUser[];
  }

  isAdmin(user: TeamUser) {
    return !!(this.db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined)?.is_admin;
  }

  /**
   * Alta con un código: el de administración (cuenta administradora, sin espacio) o la invitación de un
   * espacio (entra en él como miembro).
   */
  register(input: { login?: unknown; name?: unknown; password?: unknown; code?: unknown }) {
    const login = String(input.login ?? '').trim().toLowerCase();
    const name = String(input.name ?? '').trim();
    const password = String(input.password ?? '');
    const code = normCode(input.code);
    const admin = code === this.teamCode;
    const space = admin ? null : this.spaceByCode(code);
    if (!admin && !space) throw new ApiError(403, 'El código no es correcto. Pide la invitación de tu espacio.');
    if (!/^[a-z0-9._@+-]{2,80}$/.test(login)) throw new ApiError(400, 'El usuario puede ser tu email o un nombre sin espacios ni tildes.');
    if (!name) throw new ApiError(400, 'Escribe tu nombre completo (es el que se usa al mencionarte).');
    if (password.length < 8) throw new ApiError(400, 'La contraseña tiene que tener al menos 8 caracteres.');
    if (this.db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) throw new ApiError(409, 'Ese usuario ya existe.');
    const user: TeamUser = { id: randomUUID(), login, name };
    this.db.prepare('INSERT INTO users (id, login, name, pass, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, login, name, hash(password), new Date().toISOString(), admin ? 1 : 0);
    if (space) this.addMember(space.id, user.id, 'member');
    return { user, token: this.newSession(user.id) };
  }

  login(input: { login?: unknown; password?: unknown }) {
    const login = String(input.login ?? '').trim().toLowerCase();
    const row = this.db.prepare('SELECT id, login, name, pass FROM users WHERE login = ?').get(login) as (TeamUser & { pass: string }) | undefined;
    if (!row || !verify(String(input.password ?? ''), row.pass)) throw new ApiError(401, 'Usuario o contraseña incorrectos.');
    return { user: { id: row.id, login: row.login, name: row.name }, token: this.newSession(row.id) };
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
    return row ? { id: row.id, login: row.login, name: row.name } : null;
  }

  logout(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ---------- Espacios ----------

  private spaceByCode(code: string) {
    return code ? this.db.prepare('SELECT id, name FROM spaces WHERE invite_code = ?').get(code) as { id: string; name: string } | undefined : undefined;
  }

  private memberSpaces(user: TeamUser): Set<string> {
    const rows = this.db.prepare('SELECT space_id FROM space_members WHERE user_id = ?').all(user.id) as { space_id: string }[];
    return new Set(rows.map((r) => r.space_id));
  }

  private role(spaceId: string, user: TeamUser) {
    return (this.db.prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, user.id) as { role: 'admin' | 'member' } | undefined)?.role ?? null;
  }

  private requireAdmin(spaceId: string, user: TeamUser) {
    if (this.role(spaceId, user) !== 'admin') throw new ApiError(403, 'Solo quien administra el espacio puede hacer esto.');
  }

  /** Lo que ve cada uno ha cambiado: en su próxima petición recibe todo de nuevo. */
  private touchAccess(userIds: Iterable<string>) {
    const v = this.nextVersion();
    for (const id of new Set(userIds)) this.db.prepare('UPDATE users SET access_version = ? WHERE id = ?').run(v, id);
  }

  private membersOf(spaceId: string | null): string[] {
    if (!spaceId) return [];
    return (this.db.prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(spaceId) as { user_id: string }[]).map((r) => r.user_id);
  }

  private addMember(spaceId: string, userId: string, role: 'admin' | 'member') {
    this.db.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(spaceId, userId, role);
    this.touchAccess([userId]);
  }

  spaces(user: TeamUser): SpaceView[] {
    const rows = this.db.prepare(`SELECT s.id, s.name, s.color, s.invite_code, m.role FROM spaces s
      JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ? ORDER BY s.name`).all(user.id) as
      { id: string; name: string; color: string; invite_code: string; role: 'admin' | 'member' }[];
    return rows.map((s) => ({
      id: s.id, name: s.name, color: s.color, inviteCode: s.invite_code, role: s.role,
      members: (this.db.prepare('SELECT user_id AS id, role FROM space_members WHERE space_id = ?').all(s.id) as { id: string; role: 'admin' | 'member' }[])
        .map((m) => ({ id: m.id, role: m.role })),
    }));
  }

  createSpace(user: TeamUser, input: { name?: unknown; color?: unknown }) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new ApiError(400, 'Ponle nombre al espacio.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO spaces (id, name, color, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name.slice(0, 60), String(input.color ?? '#6366f1'), newCode(), user.id, new Date().toISOString());
    this.addMember(id, user.id, 'admin');
    return this.spaces(user);
  }

  joinSpace(user: TeamUser, input: { code?: unknown }) {
    const space = this.spaceByCode(normCode(input.code));
    if (!space) throw new ApiError(404, 'Ese código de invitación no existe.');
    this.addMember(space.id, user.id, 'member');
    return this.spaces(user);
  }

  updateSpace(user: TeamUser, spaceId: string, input: { name?: unknown; color?: unknown; newCode?: unknown }) {
    this.requireAdmin(spaceId, user);
    const name = String(input.name ?? '').trim();
    if (name) this.db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name.slice(0, 60), spaceId);
    if (input.color) this.db.prepare('UPDATE spaces SET color = ? WHERE id = ?').run(String(input.color), spaceId);
    // Un código nuevo invalida el anterior (por si se ha difundido de más).
    if (input.newCode) this.db.prepare('UPDATE spaces SET invite_code = ? WHERE id = ?').run(newCode(), spaceId);
    this.touchAccess(this.membersOf(spaceId));
    return this.spaces(user);
  }

  /** Quitar a alguien (administradores) o salir uno mismo. Siempre queda al menos un administrador. */
  removeMember(user: TeamUser, spaceId: string, input: { userId?: unknown }) {
    const target = String(input.userId ?? user.id);
    if (target !== user.id) this.requireAdmin(spaceId, user);
    else if (!this.role(spaceId, user)) throw new ApiError(404, 'No estás en ese espacio.');
    const admins = (this.db.prepare('SELECT user_id FROM space_members WHERE space_id = ? AND role = \'admin\'').all(spaceId) as { user_id: string }[]).map((r) => r.user_id);
    const members = this.membersOf(spaceId);
    if (admins.length === 1 && admins[0] === target && members.length > 1) {
      throw new ApiError(400, 'Eres quien administra el espacio: nombra antes a otra persona administradora.');
    }
    this.db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, target);
    if (members.length === 1) this.db.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId); // era el último
    this.touchAccess([target]);
    return this.spaces(user);
  }

  setRole(user: TeamUser, spaceId: string, input: { userId?: unknown; role?: unknown }) {
    this.requireAdmin(spaceId, user);
    const role = input.role === 'admin' ? 'admin' : 'member';
    this.db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?').run(role, spaceId, String(input.userId ?? ''));
    return this.spaces(user);
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
    const spaces = this.memberSpaces(user);
    const visible = visibleKeys(all.filter((r) => !isPersonal(r.table) && !isGlobal(r.table)), user, spaces);
    const existing = new Map(all.map((r) => [`${r.table}:${r.key}`, r]));
    const rejected: string[] = [];
    const now = new Date().toISOString();
    const accessChanged = new Set<string>();
    this.db.exec('BEGIN');
    try {
      for (const c of changes) {
        if (!isSyncTable(c.table) || typeof c.key !== 'string' || !c.key) continue;
        const table = c.table;
        const id = `${table}:${c.key}`;
        const before = existing.get(id);
        const owned = !isPersonal(table) && !isGlobal(table);
        // Solo se puede cambiar lo propio, lo de tus espacios o lo que te han compartido.
        if (owned && before?.data && before.owner !== user.id && !visible.has(id)) { rejected.push(id); continue; }
        const data = c.data && typeof c.data === 'object' ? { ...c.data } : null;
        // Solo se puede llevar un proyecto a un espacio del que eres miembro.
        if (table === 'projects' && typeof data?.space_id === 'string' && data.space_id && !spaces.has(data.space_id)
          && data.space_id !== before?.data?.space_id) { rejected.push(id); continue; }
        if (table === 'tasks' && data) {
          const personal = Object.fromEntries(PERSONAL_TASK_FIELDS.map((f) => [f, data[f] ?? null]));
          this.db.prepare(`INSERT INTO overlays (tbl, key, user_id, data) VALUES (?, ?, ?, ?)
            ON CONFLICT(tbl, key, user_id) DO UPDATE SET data = excluded.data`).run(table, c.key, user.id, JSON.stringify(personal));
          for (const f of PERSONAL_TASK_FIELDS) data[f] = null;
        }
        // Si un proyecto cambia de espacio (o de padre), cambia lo que ven los miembros de los dos espacios.
        const spaceBefore = table === 'projects' && before?.data ? spaceOfProject(c.key, new Map(existing)) : null;
        const scope = isPersonal(table) ? user.id : '';
        const owner = isGlobal(table) ? '' : before?.owner || user.id;
        const version = this.nextVersion();
        this.db.prepare(`INSERT INTO records (tbl, key, scope, owner, data, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tbl, key, scope) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`)
          .run(table, c.key, scope, owner, data ? JSON.stringify(data) : null, version, now);
        const after: StoredRecord = { table, key: c.key, owner, data, version };
        existing.set(id, after);
        if (table === 'projects') {
          const spaceAfter = data ? spaceOfProject(c.key, existing) : null;
          if (spaceBefore !== spaceAfter) for (const s of [spaceBefore, spaceAfter]) for (const m of this.membersOf(s)) accessChanged.add(m);
        }
      }
      if (accessChanged.size) this.touchAccess(accessChanged);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { version: this.version, rejected };
  }

  /**
   * Cambios desde `since` que afectan al usuario. Lo que deja de verse llega como borrado, y al recibir
   * algo compartido llegan también su proyecto y su release. Con `reset`, llega todo lo visible y la app
   * descarta lo que ya no está.
   */
  pull(user: TeamUser, since: number): { version: number; reset: boolean; changes: PulledChange[] } {
    const access = (this.db.prepare('SELECT access_version FROM users WHERE id = ?').get(user.id) as { access_version: number } | undefined)?.access_version ?? 0;
    const reset = since > 0 && since < access;
    if (reset) since = 0;
    const all = this.rows(user);
    const ownedRows = all.filter((r) => !isPersonal(r.table) && !isGlobal(r.table));
    const visible = visibleKeys(ownedRows, user, this.memberSpaces(user));
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
      // Para quien no puede verlo, se manda como borrado (si lo tenía, desaparece; si no, no pasa nada).
      if (owned && !visible.has(id)) {
        if (r.version > since && since > 0) changes.push({ table: r.table, key: r.key, data: null, owner: null });
        continue;
      }
      if (reset && !r.data) continue;
      changes.push({
        table: r.table, key: r.key, owner: owned ? r.owner : null,
        data: r.data ? this.withOverlay(r.table, r.key, r.data, user) : null,
      });
    }
    return { version: this.version, reset, changes };
  }
}
