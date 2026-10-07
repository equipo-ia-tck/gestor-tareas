import { diffDays } from './dates';
import type { ISODate, ItemType, Release, Task, WorkflowState } from './types';
import { findType, stateOf } from './workflows';

/** Enlace del elemento: el explícito o el de la plantilla del tipo con su ID externo. */
export function externalUrl(task: Pick<Task, 'url' | 'external_id'>, type: ItemType): string | null {
  if (task.url) return task.url;
  if (!task.external_id || !type.url_template?.includes('{id}')) return null;
  return type.url_template.replace('{id}', encodeURIComponent(task.external_id));
}

export interface ReleaseProgress {
  total: number;
  done: number;
  blocked: number;
  /** Recuento por tipo y estado, en el orden del flujo. */
  byType: { type: ItemType; states: { state: WorkflowState; count: number }[]; total: number }[];
}

export function releaseProgress(releaseId: string, tasks: Task[], types: ItemType[]): ReleaseProgress {
  const mine = tasks.filter((t) => t.release_id === releaseId && !t.deleted_at && t.status !== 'archived');
  const byType = types
    .map((type) => {
      const ofType = mine.filter((t) => findType(types, t.type_id).id === type.id);
      return {
        type,
        total: ofType.length,
        states: type.states
          .map((state) => ({ state, count: ofType.filter((t) => stateOf(types, t).id === state.id).length }))
          .filter((x) => x.count > 0),
      };
    })
    .filter((x) => x.total > 0);
  return {
    total: mine.length,
    done: mine.filter((t) => t.status === 'done').length,
    blocked: mine.filter((t) => stateOf(types, t).category === 'blocked').length,
    byType,
  };
}

/** "Hoy", "en 5 días", "hace 2 días", "sin fecha". */
export function releaseCountdown(release: Pick<Release, 'date' | 'status'>, today: ISODate): string {
  if (!release.date) return 'sin fecha';
  const d = diffDays(today, release.date);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d > 0) return `en ${d} días`;
  return d === -1 ? 'ayer' : `hace ${-d} días`;
}

/** Próximas (por fecha) y luego las pasadas o ya publicadas (las más recientes primero). */
export function groupReleases(releases: Release[], today: ISODate) {
  const upcoming = releases.filter((r) => r.status === 'planned' && (!r.date || r.date >= today));
  const overdue = releases.filter((r) => r.status === 'planned' && r.date && r.date < today);
  const finished = releases
    .filter((r) => r.status !== 'planned')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { upcoming, overdue, finished };
}
