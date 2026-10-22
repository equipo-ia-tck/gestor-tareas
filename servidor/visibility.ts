/**
 * Quién ve qué. Todo es privado de quien lo crea, salvo:
 * - lo que está en un proyecto de un **espacio** (equipo): lo ven todos sus miembros. Un proyecto pertenece
 *   a un espacio por su `space_id` o, si no tiene, por el de su proyecto padre;
 * - lo que **menciona una cuenta**: una tarea con la persona en "Personas" o una nota que la menciona con @.
 *   Solo cuenta el nombre completo o el email de la cuenta (no el nombre de pila: con mucha gente habría
 *   confusiones).
 * Funciones puras: las usa el servidor y se prueban en tests/servidor.test.ts.
 */

/** Tablas con dueño que se pueden compartir por mención. */
export const OWNED_TABLES = ['tasks', 'notes', 'projects', 'releases'] as const;
/** Tablas de cada persona (su clave solo es única dentro de su dueño, p. ej. la ficha "Mike"). */
export const PERSONAL_TABLES = ['settings', 'people', 'activity'] as const;
/** Configuración común del equipo (tipos con sus estados y colores de etiquetas). */
export const GLOBAL_TABLES = ['item_types', 'labels'] as const;
export const SYNC_TABLES = [...OWNED_TABLES, ...PERSONAL_TABLES, ...GLOBAL_TABLES] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Campos de la tarea que son de cada persona aunque la tarea esté compartida. */
export const PERSONAL_TASK_FIELDS = ['my_day', 'remind_at'] as const;

export const isSyncTable = (t: string): t is SyncTable => (SYNC_TABLES as readonly string[]).includes(t);
export const isPersonal = (t: SyncTable) => (PERSONAL_TABLES as readonly string[]).includes(t);
export const isGlobal = (t: SyncTable) => (GLOBAL_TABLES as readonly string[]).includes(t);

/** Igual que `nameKey` de la app: sin tildes ni mayúsculas, espacios y guiones iguales. */
export const nameKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[\s_-]+/g, '-');

export interface TeamUser { id: string; login: string; name: string }

/** Una persona mencionada es esta cuenta si coincide su nombre completo o su usuario (email). */
export function isUser(person: string, user: TeamUser): boolean {
  const k = nameKey(person);
  return k === nameKey(user.name) || k === nameKey(user.login);
}

export const mentions = (people: unknown, user: TeamUser) =>
  Array.isArray(people) && people.some((p) => typeof p === 'string' && isUser(p, user));

/** Compañeros con los que se comparte un registro (sin contar al dueño). */
export function sharedWith(people: unknown, team: TeamUser[], ownerId: string): TeamUser[] {
  return team.filter((u) => u.id !== ownerId && mentions(people, u));
}

export interface StoredRecord {
  table: SyncTable;
  key: string;
  owner: string;
  data: Record<string, unknown> | null;
  version: number;
}

const recId = (r: { table: string; key: string }) => `${r.table}:${r.key}`;

/** Espacio de un proyecto: el suyo o el del primer antepasado que tenga. */
export function spaceOfProject(projectId: unknown, byId: Map<string, StoredRecord>): string | null {
  let key = projectId;
  for (let depth = 0; typeof key === 'string' && depth < 10; depth++) {
    const p = byId.get(`projects:${key}`)?.data;
    if (!p) return null;
    if (typeof p.space_id === 'string' && p.space_id) return p.space_id;
    key = p.parent_id;
  }
  return null;
}

/** Espacio al que pertenece un registro (por su proyecto). */
export function spaceOfRecord(r: StoredRecord, byId: Map<string, StoredRecord>): string | null {
  if (!r.data) return null;
  if (r.table === 'projects') return spaceOfProject(r.key, byId);
  return spaceOfProject(r.data.project_id, byId);
}

/** Proyecto (con sus padres) y release de un registro, para que lo compartido se entienda. */
export function relatedKeys(r: StoredRecord, byId: Map<string, StoredRecord>): string[] {
  const out: string[] = [];
  if (!r.data) return out;
  let key = r.table === 'projects' ? r.data.parent_id : r.table === 'tasks' || r.table === 'notes' ? r.data.project_id : null;
  for (let depth = 0; typeof key === 'string' && depth < 10; depth++) {
    const p = byId.get(`projects:${key}`);
    if (!p?.data) break;
    out.push(recId(p));
    key = p.data.parent_id;
  }
  if (r.table === 'tasks' && typeof r.data.release_id === 'string' && byId.get(`releases:${r.data.release_id}`)?.data) {
    out.push(`releases:${r.data.release_id}`);
  }
  return out;
}

/**
 * Registros de tablas con dueño que ve el usuario: los suyos, las tareas y notas que le mencionan y,
 * para que esas se entiendan, sus proyectos (con los padres) y sus releases.
 */
export function visibleKeys(records: StoredRecord[], user: TeamUser, spaces: ReadonlySet<string> = new Set()): Set<string> {
  const byId = new Map(records.map((r) => [recId(r), r]));
  const visible = new Set<string>();
  for (const r of records) {
    if (!r.data) continue;
    const space = spaceOfRecord(r, byId);
    if (r.owner === user.id || (space && spaces.has(space))
      || ((r.table === 'tasks' || r.table === 'notes') && mentions(r.data.people, user))) visible.add(recId(r));
  }
  for (const k of [...visible]) for (const rel of relatedKeys(byId.get(k)!, byId)) visible.add(rel);
  return visible;
}
