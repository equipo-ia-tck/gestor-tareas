import { isActive } from './selectors';
import { nameKey } from './text';
import type { Note, Person, Task } from './types';

export interface PersonEntry {
  name: string;
  /** Tareas pendientes en las que aparece. */
  tasks: number;
  /** Notas o actas que la mencionan con @. */
  notes: number;
  /** Tareas pendientes enlazadas con Rally de las que es Owner allí (sin contar las que ya la tienen en Personas). */
  rally: number;
}

/**
 * Todas las personas que aparecen en la app: en tareas, mencionadas en notas, con ficha o Owners en Rally de las tareas
 * enlazadas (`rallyOwners`: id de tarea → Owner; no cambia las tareas, así no se comparten con nadie por el nombre).
 * Se unen por nombre (sin mayúsculas, tildes ni guiones). El nombre que se muestra es el de la
 * ficha si la hay, si no el de las tareas y, por último, el de la nota.
 */
export function peopleDirectory(tasks: Task[], notes: Note[], cards: Person[], rallyOwners: Map<string, string> = new Map()): PersonEntry[] {
  const map = new Map<string, PersonEntry & { rank: number }>();
  const touch = (name: string, rank: number) => {
    const k = nameKey(name);
    const e = map.get(k) ?? { name, tasks: 0, notes: 0, rally: 0, rank };
    if (rank < e.rank) { e.name = name; e.rank = rank; }
    map.set(k, e);
    return e;
  };
  for (const c of cards) touch(c.name, 0);
  for (const t of tasks) for (const p of t.people) { const e = touch(p, 1); if (isActive(t)) e.tasks++; }
  for (const n of notes) if (!n.deleted_at) for (const p of n.people) touch(p, 2).notes++;
  for (const t of tasks) {
    const owner = rallyOwners.get(t.id);
    if (!owner) continue;
    const e = touch(owner, 3);
    if (isActive(t) && !t.people.some((p) => nameKey(p) === nameKey(owner))) e.rally++;
  }
  return [...map.values()]
    .map(({ name, tasks: t, notes: n, rally: r }) => ({ name, tasks: t, notes: n, rally: r }))
    .sort((a, b) => b.tasks + b.rally - (a.tasks + a.rally) || b.notes - a.notes || a.name.localeCompare(b.name, 'es'));
}

/** Cambia las menciones @de por @a en un texto (sin importar mayúsculas, tildes ni guiones). */
export function renameMentions(body: string, from: string, to: string): string {
  const target = `@${to.trim().replace(/\s+/g, '-')}`;
  return body.replace(/(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu, (m, token: string) =>
    (nameKey(token) === nameKey(from) ? target : m));
}

/** Lista de personas de una tarea con `de` sustituida por `a` (sin duplicados). */
export function renameInList(people: string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (const p of people.map((x) => (nameKey(x) === nameKey(from) ? to : x))) {
    if (!out.some((o) => nameKey(o) === nameKey(p))) out.push(p);
  }
  return out;
}
