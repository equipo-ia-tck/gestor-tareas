import { DEFAULT_TYPE_ID, type ItemType, type NewTask, type Task } from './types';
import { findType, stateOf } from './workflows';

/** Prefijo del ID de Rally: US (historia), DE (defecto), TA (tarea), TS (test set), TC (test case). */
export type RallyKind = 'US' | 'DE' | 'TA' | 'TS' | 'TC';

/** Elemento de Rally (asignado a la persona o de los proyectos elegidos), tal como lo devuelve `GET /api/rally/items`. */
export interface RallyItem {
  /** FormattedID: "US1764574". */
  id: string;
  objectId: string;
  kind: RallyKind;
  name: string;
  /** Columna del tablero (FlowState) o, si no hay, ScheduleState, State o el último veredicto de un test case. */
  state: string;
  /** Orden de la columna en el tablero, para agrupar igual que Rally. */
  stateOrder: number;
  category: RallyCategory;
  done: boolean;
  blocked: boolean;
  project: string | null;
  iteration: string | null;
  release: string | null;
  /** Assignee (o, si no hay, Owner). */
  assignee: string | null;
  /** Owner: en Rally, quien la ha puesto o la lleva ("Owned By" en las tarjetas). */
  owner: string | null;
  /** Asignado a la persona conectada. */
  mine: boolean;
  updatedAt: string;
  url: string;
}

export interface RallyProject { id: string; name: string }

/** Categoría para agrupar como el Tablero del gestor (Accepted aparte de Hecho, como en Rally). */
export type RallyCategory = 'todo' | 'blocked' | 'doing' | 'done' | 'accepted';

export const RALLY_CATEGORIES: { category: RallyCategory; label: string; color: string }[] = [
  { category: 'todo', label: 'Por hacer', color: '#94a3b8' },
  { category: 'blocked', label: 'Bloqueado', color: '#ef4444' },
  { category: 'doing', label: 'En curso', color: '#3b82f6' },
  { category: 'done', label: 'Hecho', color: '#22c55e' },
  { category: 'accepted', label: 'Accepted', color: '#047857' },
];

/** Ficha completa de un elemento, como en Rally (`GET /api/rally/detail`). Los textos llegan ya sin HTML. */
export interface RallyDetail {
  item: RallyItem;
  blockedReason: string | null;
  /** Campos con valor, con el nombre que les da Rally (incluidos los personalizados). */
  fields: { label: string; value: string }[];
  /** Descripción, notas, criterios de aceptación y demás textos largos. */
  texts: { label: string; text: string }[];
  tags: string[];
  /** Elementos hijos agrupados: "Tareas", "Test Cases", "Defectos", "User Stories hijas". */
  related: { label: string; items: RallyItem[] }[];
  discussion: { author: string | null; date: string; text: string }[];
  attachments: { name: string; size: number }[];
}

export type RallyGroupBy = 'category' | 'state' | 'iteration' | 'assignee';

export interface RallyStatus {
  connected: boolean;
  baseUrl: string;
  /** Últimos caracteres de la clave, para reconocerla sin mostrarla. */
  keyHint: string | null;
  rallyUser: string | null;
}

export const RALLY_KINDS: { kind: RallyKind; label: string }[] = [
  { kind: 'US', label: 'User Stories' },
  { kind: 'DE', label: 'Defectos' },
  { kind: 'TA', label: 'Tareas' },
  { kind: 'TS', label: 'Test Sets' },
  { kind: 'TC', label: 'Test Cases' },
];

const norm = (id: string | null) => (id ?? '').replace(/-/g, '').toUpperCase();

/** Tareas del gestor por ID de Rally (sin borrar; "US-123" y "US123" son la misma). */
export function tasksByRallyId(tasks: Task[]): Map<string, Task> {
  const map = new Map<string, Task>();
  for (const t of tasks) if (t.external_id) map.set(norm(t.external_id), t);
  return map;
}

/**
 * Owner en Rally de cada tarea enlazada (id de la tarea → nombre), a partir de lo último que se sabe de Rally.
 * Solo tareas del gestor con ID de Rally: así en Personas salen los Owners de lo que llevo, no todo el proyecto.
 */
export function rallyOwners(tasks: Task[], ownerOf: (rallyId: string) => string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tasks) {
    const owner = !t.deleted_at && isRallyId(t.external_id) ? ownerOf(norm(t.external_id!)) : null;
    if (owner) map.set(t.id, owner);
  }
  return map;
}

export const linkedTask = (item: RallyItem, byId: Map<string, Task>) => byId.get(norm(item.id));

const RALLY_ID = /^(US|DE|TA|TS|TC)-?\d{1,12}$/i;

/** ID externo con forma de Rally ("US1764574", "DE-9"…). */
export const isRallyId = (id: string | null | undefined): id is string => !!id && RALLY_ID.test(id);

/** IDs de Rally de las tareas activas (sin borrar ni archivar) que lo llevan, sin repetir. */
export function rallyIdsOf(tasks: Task[]): string[] {
  return [...new Set(tasks.filter((t) => !t.deleted_at && t.status !== 'archived' && t.external_id && RALLY_ID.test(t.external_id))
    .map((t) => norm(t.external_id)))];
}

export interface RallyMove { task: Task; stateId: string; stateName: string; item: RallyItem }

/**
 * Tareas enlazadas cuya categoría no coincide con la de Rally (Rally manda): pasan al primer estado de esa categoría
 * en su tipo. Si el tipo no tiene "Accepted", una aceptada en Rally va al de "hecho"; si no tiene la categoría, no se mueve.
 */
export function rallyMoves(tasks: Task[], items: RallyItem[], types: ItemType[]): RallyMove[] {
  const byId = new Map(items.map((it) => [norm(it.id), it]));
  const moves: RallyMove[] = [];
  for (const task of tasks) {
    if (task.deleted_at || task.status === 'archived' || !task.external_id) continue;
    const item = byId.get(norm(task.external_id));
    if (!item) continue;
    const current = stateOf(types, task);
    if (current.category === item.category) continue;
    const states = findType(types, task.type_id).states;
    const target = states.find((s) => s.category === item.category)
      ?? (item.category === 'accepted' ? states.find((s) => s.category === 'done') : undefined);
    if (target && target.id !== current.id) moves.push({ task, stateId: target.id, stateName: target.name, item });
  }
  return moves;
}

/** Cambio de un registro tal como lo guarda el historial del repositorio (antes y después). */
export interface RecordChange { table: string; before?: unknown; after?: unknown }

/**
 * Elementos de Rally que hay que mover porque su tarea ha cambiado de categoría en el gestor (en un cambio, o al
 * deshacerlo, que va de `after` a `before`). No cuentan las altas, las bajas ni los test cases (no tienen columna).
 */
export function rallyPushes(changes: RecordChange[], undo: boolean, types: ItemType[]): { id: string; category: RallyCategory }[] {
  // Una entrada puede cambiar la misma tarea varias veces (completar y luego pasar a Accepted): cuenta el estado
  // antes del primer cambio y después del último (al deshacer, al revés).
  const span = new Map<string, { first: Task | undefined; last: Task | undefined }>();
  for (const c of changes) {
    if (c.table !== 'tasks') continue;
    const key = ((c.after ?? c.before) as Task).id;
    const s = span.get(key);
    if (s) s.last = c.after as Task | undefined;
    else span.set(key, { first: c.before as Task | undefined, last: c.after as Task | undefined });
  }
  const out: { id: string; category: RallyCategory }[] = [];
  for (const { first, last } of span.values()) {
    const from = undo ? last : first;
    const to = undo ? first : last;
    if (!from || !to || to.deleted_at || to.status === 'archived' || !to.external_id || !RALLY_ID.test(to.external_id)) continue;
    const id = norm(to.external_id);
    const category = stateOf(types, to).category;
    if (!id.startsWith('TC') && stateOf(types, from).category !== category) out.push({ id, category });
  }
  return out;
}

/** Tarea nueva a partir de un elemento de Rally: el tipo sale del prefijo (US, TS…) si existe uno con esa abreviatura. */
export function taskFromRally(item: RallyItem, types: ItemType[], projectId: string | null): NewTask {
  const type = types.find((t) => t.short && t.short.toUpperCase() === item.kind);
  return {
    title: item.name,
    external_id: item.id,
    url: item.url,
    type_id: type?.id ?? DEFAULT_TYPE_ID,
    project_id: projectId,
    notes: [
      item.project && `Proyecto en Rally: ${item.project}`, item.iteration && `Iteración: ${item.iteration}`,
      !item.mine && item.assignee && `Assignee en Rally: ${item.assignee}`,
    ]
      .filter(Boolean).join('\n'),
    raw_input: item.id,
  };
}

const compare = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
/** Ordena con los vacíos al final. */
const nullsLast = (a: string | null, b: string | null, cmp: (a: string, b: string) => number) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmp(a, b);

/**
 * Agrupa por categoría (Por hacer, Bloqueado, En curso, Hecho, Accepted, aunque estén vacías), por columna del tablero
 * de Rally (en su orden), por iteración (la más reciente primero) o por persona (alfabético). Lo que no tiene
 * iteración o persona va al final.
 */
export function groupRally(items: RallyItem[], by: RallyGroupBy): { key: string | null; items: RallyItem[] }[] {
  if (by === 'category') {
    return RALLY_CATEGORIES.map(({ category, label }) => ({ key: label, items: items.filter((it) => it.category === category) }));
  }
  const keyOf = (it: RallyItem) => (by === 'state' ? it.state : by === 'iteration' ? it.iteration : it.assignee);
  const groups = new Map<string | null, RallyItem[]>();
  for (const it of items) groups.set(keyOf(it), [...(groups.get(keyOf(it)) ?? []), it]);
  const order = (list: RallyItem[]) => Math.min(...list.map((it) => it.stateOrder));
  return [...groups.entries()]
    .map(([key, list]) => ({ key, items: list }))
    .sort((a, b) => by === 'state' ? order(a.items) - order(b.items) || nullsLast(a.key, b.key, compare)
      : nullsLast(a.key, b.key, by === 'iteration' ? (x, y) => compare(y, x) : compare));
}
