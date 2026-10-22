import type { Table, Transaction } from 'dexie';
import { useSyncExternalStore } from 'react';
import { DEFAULT_ITEM_TYPES } from '../domain/workflows';
import type { Space } from '../domain/spaces';
import type { TasksDB } from './db';

/**
 * Sincronización con el servidor del equipo. La base de datos del navegador sigue siendo la que usa la
 * app (así deshacer, el registro y las vistas no cambian): cada cambio se apunta con los "hooks" de Dexie y
 * se sube al servidor, y cada pocos segundos se traen los cambios de los demás.
 * Solo funciona con conexión: si se cae, se avisa y los cambios esperan a que vuelva.
 */

export const SYNC_TABLES = ['tasks', 'notes', 'projects', 'releases', 'settings', 'people', 'activity', 'item_types', 'labels'] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

export interface TeamUser { id: string; login: string; name: string }
export type SyncStatus = 'ok' | 'saving' | 'offline';
interface Change { table: SyncTable; key: string; data: Record<string, unknown> | null }
interface PulledChange extends Change { owner: string | null }

export interface SyncState {
  status: SyncStatus;
  user: TeamUser | null;
  /** Todas las cuentas del servidor (para mencionar a cualquiera). */
  team: TeamUser[];
  /** Espacios de los que soy miembro. */
  spaces: Space[];
  isAdmin: boolean;
  /** Código de administración del servidor (solo para quien administra). */
  adminCode: string | null;
  /** Dueño de cada registro compartido ("tasks:<id>" → id de usuario). */
  owners: Record<string, string>;
}

const POLL_MS = 5000;
const PUSH_DELAY_MS = 400;
const CHUNK = 400;

export class AuthError extends Error {}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  // Sin JSON no es el servidor del equipo (p. ej. una vista previa antigua sin API).
  if (json === null) throw new Error('El servidor del equipo no responde.');
  if (res.status === 401) throw new AuthError(json.error ?? 'Inicia sesión.');
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}

type SyncTx = Transaction & { __fromSync?: boolean };

export class SyncClient {
  private state: SyncState = { status: 'ok', user: null, team: [], spaces: [], isAdmin: false, adminCode: null, owners: {} };
  private listeners = new Set<() => void>();
  private dirty = new Map<string, { table: SyncTable; key: string }>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pushes = 0;
  private hooked = false;
  private running = false;

  constructor(private db: TasksDB) {}

  // ---------- Estado para React ----------

  subscribe = (l: () => void) => { this.listeners.add(l); return () => void this.listeners.delete(l); };
  getState = () => this.state;
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------- Sesión ----------

  /** Usuario con sesión abierta, o null si hay que entrar. Lanza un error si el servidor no responde. */
  async me(): Promise<TeamUser | null> {
    try {
      const r = await call<{ user: TeamUser; team: TeamUser[]; spaces: Space[]; isAdmin: boolean; adminCode: string | null }>('GET', '/api/me');
      this.set({ user: r.user, team: r.team, spaces: r.spaces, isAdmin: r.isAdmin, adminCode: r.adminCode });
      return r.user;
    } catch (e) {
      if (e instanceof AuthError) return null;
      throw e;
    }
  }

  async login(login: string, password: string) {
    await call('POST', '/api/login', { login, password });
    return this.me();
  }

  async register(input: { login: string; name: string; password: string; code: string }) {
    await call('POST', '/api/register', input);
    return this.me();
  }

  /** Sube lo pendiente, cierra la sesión y vacía los datos de este navegador (ya están en el servidor). */
  async logout() {
    await this.flush().catch(() => undefined);
    this.stop();
    await call('POST', '/api/logout').catch(() => undefined);
    await this.clearLocal();
    await this.db.meta.bulkDelete(['sync-user', 'sync-cursor', 'sync-owners']);
    location.reload();
  }

  // ---------- Espacios ----------

  /** Acciones sobre espacios; al cambiar lo que veo, la siguiente sincronización lo trae todo de nuevo. */
  private async spaceAction(path: string, body: unknown = {}) {
    const r = await call<{ spaces: Space[] }>('POST', path, body);
    this.set({ spaces: r.spaces });
    await this.flush();
    await this.pull();
    return r.spaces;
  }
  createSpace = (name: string, color: string) => this.spaceAction('/api/spaces', { name, color });
  joinSpace = (code: string) => this.spaceAction('/api/spaces/join', { code });
  updateSpace = (id: string, patch: { name?: string; color?: string; newCode?: boolean }) => this.spaceAction(`/api/spaces/${id}/update`, patch);
  leaveSpace = (id: string) => this.spaceAction(`/api/spaces/${id}/remove`, {});
  removeMember = (id: string, userId: string) => this.spaceAction(`/api/spaces/${id}/remove`, { userId });
  setRole = (id: string, userId: string, role: 'admin' | 'member') => this.spaceAction(`/api/spaces/${id}/role`, { userId, role });

  // ---------- Primer acceso en este navegador ----------

  /**
   * Qué hacer con los datos que ya hay en el navegador al entrar:
   * - "ready": son de esta cuenta (o no hay), se sigue sincronizando.
   * - "ask-upload": hay datos sin cuenta y la cuenta está vacía en el servidor: se pregunta si subirlos.
   */
  async prepare(): Promise<'ready' | 'ask-upload'> {
    const user = this.state.user!;
    const previous = (await this.db.meta.get('sync-user'))?.value;
    if (previous === user.id) return 'ready';
    const local = (await this.db.tasks.count()) + (await this.db.notes.count()) + (await this.db.projects.count());
    if (!previous && local > 0) {
      const remote = await call<{ changes: PulledChange[] }>('GET', '/api/pull?since=0');
      if (!remote.changes.some((c) => c.owner === user.id && c.data)) return 'ask-upload';
    }
    // Datos de antes de tener cuenta cuando la cuenta ya tiene los suyos: se guarda una copia en el
    // servidor por si acaso. Los de otra cuenta ya están en el servidor. Después se vacía el navegador.
    if (!previous && local > 0) await this.snapshot();
    await this.clearLocal();
    await this.db.meta.put({ key: 'sync-user', value: user.id });
    return 'ready';
  }

  /** Sube todo lo que hay en el navegador a la cuenta (primera vez). */
  async uploadAll() {
    const changes: Change[] = [];
    for (const table of SYNC_TABLES) {
      const t = this.table(table);
      const keyPath = t.schema.primKey.keyPath as string;
      for (const row of await t.toArray()) changes.push({ table, key: String(row[keyPath]), data: row });
    }
    for (let i = 0; i < changes.length; i += CHUNK) await call('POST', '/api/push', { changes: changes.slice(i, i + CHUNK) });
    await this.db.meta.put({ key: 'sync-user', value: this.state.user!.id });
  }

  /** Empieza con la cuenta vacía: guarda una copia de lo que había en el servidor y vacía el navegador. */
  async startEmpty() {
    await this.snapshot();
    await this.clearLocal();
    await this.db.meta.put({ key: 'sync-user', value: this.state.user!.id });
  }

  private async snapshot() {
    const data: Record<string, unknown[]> = {};
    for (const table of SYNC_TABLES) data[table] = await this.table(table).toArray();
    await call('POST', '/api/snapshot', data);
  }

  private async clearLocal() {
    await this.db.transaction('rw', SYNC_TABLES.map((t) => this.table(t)), async (tx) => {
      (tx as SyncTx).__fromSync = true;
      for (const t of SYNC_TABLES) await this.table(t).clear();
    });
    await this.db.meta.bulkDelete(['sync-cursor', 'sync-owners']);
  }

  // ---------- Sincronización ----------

  async start() {
    if (this.running) return;
    this.running = true;
    this.set({ owners: ((await this.db.meta.get('sync-owners'))?.value as Record<string, string>) ?? {} });
    this.attachHooks();
    await this.pull();
    // Una cuenta nueva necesita los tipos (Tarea, US, TS…): si el equipo aún no tiene, se crean.
    if (!(await this.db.item_types.count())) await this.db.item_types.bulkPut(DEFAULT_ITEM_TYPES);
    this.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') void this.pull(); }, POLL_MS);
    addEventListener('focus', this.onFocus);
    addEventListener('online', this.onFocus);
  }

  private stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    removeEventListener('focus', this.onFocus);
    removeEventListener('online', this.onFocus);
  }

  private onFocus = () => { void this.flush(); void this.pull(); };

  private table(t: SyncTable) {
    return this.db.table(t) as Table<Record<string, unknown>, string>;
  }

  /** Apunta cada cambio local (menos los que vienen del servidor) para subirlo. */
  private attachHooks() {
    if (this.hooked) return;
    this.hooked = true;
    for (const name of SYNC_TABLES) {
      const t = this.table(name);
      const keyPath = t.schema.primKey.keyPath as string;
      const mark = (key: unknown, tx: Transaction) => {
        if ((tx as SyncTx).__fromSync || key === undefined || key === null) return;
        this.dirty.set(`${name}:${String(key)}`, { table: name, key: String(key) });
        this.schedulePush();
      };
      t.hook('creating', (primKey, obj, tx) => mark(primKey ?? obj[keyPath], tx));
      t.hook('updating', (_mods, primKey, _obj, tx) => mark(primKey, tx));
      t.hook('deleting', (primKey, _obj, tx) => mark(primKey, tx));
    }
  }

  private schedulePush() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.flush(), PUSH_DELAY_MS);
  }

  /** Claves actuales de todo (para saber qué ha desaparecido tras sustituir los datos al importar). */
  async keys(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const table of SYNC_TABLES) for (const k of await this.table(table).toCollection().primaryKeys()) out.add(`${table}:${String(k)}`);
    return out;
  }

  /** Tras importar una copia que sustituye todo: sube lo nuevo y borra en el servidor lo que ya no está. */
  async afterReplace(before: Set<string>) {
    const now = await this.keys();
    for (const id of new Set([...before, ...now])) {
      const i = id.indexOf(':');
      this.dirty.set(id, { table: id.slice(0, i) as SyncTable, key: id.slice(i + 1) });
    }
    await this.flush();
  }

  /** Sube lo pendiente; si falla, se queda apuntado y se reintenta. */
  async flush() {
    if (!this.dirty.size || !this.running) return;
    const batch = [...this.dirty.values()];
    this.dirty.clear();
    this.set({ status: 'saving' });
    try {
      const changes: Change[] = [];
      for (const { table, key } of batch) changes.push({ table, key, data: (await this.table(table).get(key)) ?? null });
      for (let i = 0; i < changes.length; i += CHUNK) await call('POST', '/api/push', { changes: changes.slice(i, i + CHUNK) });
      this.pushes++;
      this.set({ status: 'ok' });
    } catch (e) {
      for (const c of batch) if (!this.dirty.has(`${c.table}:${c.key}`)) this.dirty.set(`${c.table}:${c.key}`, c);
      if (e instanceof AuthError) return location.reload();
      this.set({ status: 'offline' });
      setTimeout(() => void this.flush(), POLL_MS);
    }
  }

  /** Trae los cambios de los demás desde la última vez. */
  async pull() {
    if (!this.running) return;
    const pushesBefore = this.pushes;
    try {
      const since = Number((await this.db.meta.get('sync-cursor'))?.value ?? 0);
      const r = await call<{ version: number; reset: boolean; changes: PulledChange[]; team: TeamUser[]; spaces: Space[] }>('GET', `/api/pull?since=${since}`);
      // Si mientras tanto se ha subido algo, esta respuesta puede traer una versión anterior: se repite luego.
      if (this.pushes !== pushesBefore) return;
      const owners = r.reset ? {} : { ...this.state.owners };
      await this.db.transaction('rw', [...SYNC_TABLES.map((t) => this.table(t)), this.db.meta], async (tx) => {
        (tx as SyncTx).__fromSync = true;
        // Ha cambiado lo que puedo ver (espacios): llega todo de nuevo y sobra lo que ya no está.
        if (r.reset) {
          const received = new Set(r.changes.map((c) => `${c.table}:${c.key}`));
          for (const t of ['tasks', 'notes', 'projects', 'releases'] as const) {
            for (const k of await this.table(t).toCollection().primaryKeys()) {
              const id = `${t}:${String(k)}`;
              if (!received.has(id) && !this.dirty.has(id)) await this.table(t).delete(String(k));
            }
          }
        }
        for (const c of r.changes) {
          const id = `${c.table}:${c.key}`;
          if (this.dirty.has(id)) continue; // lo local pendiente de subir manda
          if (c.data) await this.table(c.table).put(c.data);
          else await this.table(c.table).delete(c.key);
          if (c.owner && c.data) owners[id] = c.owner; else delete owners[id];
        }
        await this.db.meta.put({ key: 'sync-cursor', value: r.version });
        await this.db.meta.put({ key: 'sync-owners', value: owners });
      });
      this.set({ team: r.team, spaces: r.spaces, owners, status: this.dirty.size ? this.state.status : 'ok' });
    } catch (e) {
      if (e instanceof AuthError) return location.reload();
      this.set({ status: 'offline' });
    }
  }
}

let client: SyncClient | null = null;
export const initSync = (db: TasksDB) => (client ??= new SyncClient(db));
export const sync = () => client!;

export function useSync(): SyncState {
  const c = sync();
  return useSyncExternalStore(c.subscribe, c.getState);
}
