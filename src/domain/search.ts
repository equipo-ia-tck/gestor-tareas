import { fold, nameKey } from './text';
import type { Project, Task } from './types';

export interface SearchQuery {
  words: string[];
  projects: string[];
  people: string[];
  tags: string[];
  /** Incluir completadas y archivadas ("todo:" o "is:done" en la consulta). */
  includeDone: boolean;
}

/** "informe #caixa @diana +urgente todas:" → filtros y palabras sueltas. */
export function parseSearch(q: string): SearchQuery {
  const query: SearchQuery = { words: [], projects: [], people: [], tags: [], includeDone: false };
  for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
    const value = raw.slice(1);
    if (raw.startsWith('#') && value) query.projects.push(nameKey(value));
    else if (raw.startsWith('@') && value) query.people.push(nameKey(value));
    else if (raw.startsWith('+') && value) query.tags.push(nameKey(value));
    else if (/^(todas?:|is:done|hechas?:)$/i.test(raw)) query.includeDone = true;
    else query.words.push(fold(raw));
  }
  return query;
}

export const isEmptySearch = (q: SearchQuery) =>
  !q.words.length && !q.projects.length && !q.people.length && !q.tags.length;

/**
 * Cada palabra debe aparecer en el título, las notas, los pasos, el nombre del proyecto, las personas o las etiquetas.
 * Los filtros #, @ y + se comparan por prefijo ("#cai" encuentra "caixa").
 */
export function matchesSearch(t: Task, q: SearchQuery, projects: Map<string, Project>): boolean {
  if (t.deleted_at) return false;
  if (!q.includeDone && t.status !== 'todo') return false;
  const project = t.project_id ? projects.get(t.project_id) : undefined;
  if (q.projects.length && !(project && q.projects.some((p) => nameKey(project.name).startsWith(p)))) return false;
  if (q.people.length && !q.people.every((p) => t.people.some((x) => nameKey(x).startsWith(p)))) return false;
  if (q.tags.length && !q.tags.every((g) => t.tags.some((x) => nameKey(x).startsWith(g)))) return false;
  if (!q.words.length) return true;
  const haystack = fold([t.title, t.notes, project?.name ?? '', ...t.people, ...t.tags, ...(t.checklist ?? []).map((c) => c.text), t.external_id ?? ''].join(' '));
  return q.words.every((w) => haystack.includes(w));
}
