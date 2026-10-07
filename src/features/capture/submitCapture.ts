import { repo } from '../../data/services';
import { nameKey } from '../../domain/text';
import type { NewTask, Task } from '../../domain/types';
import type { ParsedTask } from '../../parser/types';

/**
 * Crea las tareas capturadas. Lo detectado por el parser manda sobre los valores
 * por defecto de la vista. Los proyectos y releases nuevos se crean una sola vez por lote.
 */
export async function submitCapture(parsed: ParsedTask[], defaults: Partial<NewTask> = {}): Promise<Task[]> {
  const created: Task[] = [];
  const newProjects = new Map<string, string>();
  const newReleases = new Map<string, string>();
  for (const p of parsed) {
    if (!p.title) continue;
    let projectId = p.project?.id ?? null;
    if (p.project && !projectId) {
      const key = nameKey(p.project.name);
      projectId = newProjects.get(key) ?? (await repo.createProject(p.project.name)).id;
      newProjects.set(key, projectId);
    }
    let releaseId = p.release?.id ?? null;
    if (p.release && !releaseId) {
      const key = nameKey(p.release.name);
      releaseId = newReleases.get(key) ?? (await repo.createRelease(p.release.name, { project_id: projectId ?? defaults.project_id ?? null })).id;
      newReleases.set(key, releaseId);
    }
    created.push(await repo.createTask({
      ...defaults,
      title: p.title,
      raw_input: p.raw_input,
      due_date: p.due_date ?? defaults.due_date ?? null,
      project_id: projectId ?? defaults.project_id ?? null,
      people: [...new Set([...(defaults.people ?? []), ...p.people])],
      tags: [...new Set([...(defaults.tags ?? []), ...p.tags])],
      priority: p.priority ?? defaults.priority ?? 4,
      estimated_minutes: p.estimated_minutes ?? defaults.estimated_minutes ?? null,
      recurrence_rule: p.recurrence,
      external_id: p.external_id ?? defaults.external_id ?? null,
      release_id: releaseId ?? defaults.release_id ?? null,
      // El tipo deducido de la clave ("US-12") manda; si la vista fija un estado, solo vale para su propio tipo.
      ...(p.type_id && p.type_id !== defaults.type_id ? { type_id: p.type_id, state_id: undefined } : {}),
      series_id: p.recurrence ? crypto.randomUUID() : null,
    }));
  }
  return created;
}
