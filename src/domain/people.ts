import { isActive } from './selectors';
import { nameKey } from './text';
import type { Note, Person, Task } from './types';

export interface PersonEntry {
  name: string;
  /** Tareas pendientes en las que aparece. */
  tasks: number;
  /** Notas o actas que la mencionan con @. */
  notes: number;
}

/**
 * Todas las personas que aparecen en la app: en tareas, mencionadas en notas o con ficha.
 * Se unen por nombre (sin mayúsculas, tildes ni guiones). El nombre que se muestra es el de la
 * ficha si la hay, si no el de las tareas y, por último, el de la nota.
 */
export function peopleDirectory(tasks: Task[], notes: Note[], cards: Person[]): PersonEntry[] {
  const map = new Map<string, PersonEntry & { rank: number }>();
  const touch = (name: string, rank: number) => {
    const k = nameKey(name);
    const e = map.get(k) ?? { name, tasks: 0, notes: 0, rank };
    if (rank < e.rank) { e.name = name; e.rank = rank; }
    map.set(k, e);
    return e;
  };
  for (const c of cards) touch(c.name, 0);
  for (const t of tasks) for (const p of t.people) { const e = touch(p, 1); if (isActive(t)) e.tasks++; }
  for (const n of notes) if (!n.deleted_at) for (const p of n.people) touch(p, 2).notes++;
  return [...map.values()]
    .map(({ name, tasks: t, notes: n }) => ({ name, tasks: t, notes: n }))
    .sort((a, b) => b.tasks - a.tasks || b.notes - a.notes || a.name.localeCompare(b.name, 'es'));
}
