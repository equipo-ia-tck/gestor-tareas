import { addDays } from './dates';
import type { ActivityEntry, ActivityKind, ISODate, Note, Task } from './types';

type Event = { kind: ActivityKind; from: string | null; to: string | null };

/**
 * Qué apuntar en el registro al pasar una tarea de `before` a `after` (undefined = no existía).
 * Puede devolver varios apuntes (p. ej. cambio de estado y completada).
 */
export function activityFor(before: Task | undefined, after: Task | undefined): Event[] {
  if (!after) return [];
  if (!before) return [{ kind: 'created', from: null, to: after.due_date }];
  const out: Event[] = [];
  if (!before.deleted_at && after.deleted_at) return [{ kind: 'deleted', from: null, to: null }];
  if (before.status !== 'archived' && after.status === 'archived') out.push({ kind: 'archived', from: null, to: null });
  if (before.status !== 'done' && after.status === 'done') out.push({ kind: 'completed', from: null, to: null });
  if (before.status === 'done' && after.status === 'todo') out.push({ kind: 'reopened', from: null, to: null });
  // Pospuesta: tenía fecha y se mueve a una posterior o se le quita (solo si sigue pendiente).
  if (after.status === 'todo' && before.due_date && (after.due_date === null || after.due_date > before.due_date)) {
    out.push({ kind: 'postponed', from: before.due_date, to: after.due_date });
  }
  // Cambio de estado del flujo que no es simplemente completar/reabrir.
  if (before.state_id !== after.state_id && before.type_id === after.type_id && !out.some((e) => e.kind === 'completed' || e.kind === 'reopened')) {
    out.push({ kind: 'state', from: before.state_id, to: after.state_id });
  }
  return out;
}

/** Veces que se ha pospuesto cada tarea. */
export function postponeCounts(entries: ActivityEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (e.kind === 'postponed') m.set(e.task_id, (m.get(e.task_id) ?? 0) + 1);
  return m;
}

export interface DayLog {
  date: ISODate;
  completed: ActivityEntry[];
  postponed: ActivityEntry[];
  /** Eliminadas o archivadas: lo que se dejó de hacer. */
  dropped: ActivityEntry[];
  created: ActivityEntry[];
  states: ActivityEntry[];
  notes: Note[];
}

/** Registro día a día entre `from` y `to` (ambos incluidos), del más reciente al más antiguo. */
export function dailyLog(entries: ActivityEntry[], notes: Note[], from: ISODate, to: ISODate): DayLog[] {
  const days: DayLog[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const mine = entries.filter((e) => e.date === d).sort((a, b) => a.at.localeCompare(b.at));
    // Si se completó y luego se reabrió el mismo día, no cuenta como hecha.
    const lastByTask = new Map<string, ActivityEntry>();
    for (const e of mine) if (e.kind === 'completed' || e.kind === 'reopened') lastByTask.set(e.task_id, e);
    days.push({
      date: d,
      completed: [...lastByTask.values()].filter((e) => e.kind === 'completed'),
      postponed: dedupeByTask(mine.filter((e) => e.kind === 'postponed')),
      dropped: dedupeByTask(mine.filter((e) => e.kind === 'deleted' || e.kind === 'archived')),
      created: mine.filter((e) => e.kind === 'created'),
      states: mine.filter((e) => e.kind === 'state'),
      notes: notes.filter((n) => !n.deleted_at && n.date === d),
    });
  }
  return days;
}

/** Último apunte de cada tarea (si se pospuso dos veces el mismo día, una línea con la fecha final). */
function dedupeByTask(list: ActivityEntry[]): ActivityEntry[] {
  const m = new Map<string, ActivityEntry>();
  for (const e of list) {
    const prev = m.get(e.task_id);
    m.set(e.task_id, prev && e.kind === 'postponed' ? { ...e, from: prev.from } : e);
  }
  return [...m.values()];
}

export const isEmptyDay = (d: DayLog) =>
  !d.completed.length && !d.postponed.length && !d.dropped.length && !d.created.length && !d.states.length && !d.notes.length;
