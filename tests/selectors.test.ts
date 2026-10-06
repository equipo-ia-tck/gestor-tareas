import { describe, expect, it } from 'vitest';
import {
  inboxTasks, isInbox, overdueTasks, peopleIndex, sortTasks, tasksDueOn, weekPlan,
} from '../src/domain/selectors';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { makeTask } from './factories';

const today = '2026-10-05';

describe('selectors', () => {
  it('la bandeja es lo activo sin fecha ni proyecto', () => {
    expect(isInbox(makeTask())).toBe(true);
    expect(isInbox(makeTask({ due_date: today }))).toBe(false);
    expect(isInbox(makeTask({ project_id: 'p1' }))).toBe(false);
    expect(isInbox(makeTask({ status: 'done' }))).toBe(false);
    expect(isInbox(makeTask({ deleted_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });

  it('ordena por prioridad y después por orden manual', () => {
    const a = makeTask({ priority: 3, sort_order: 1 });
    const b = makeTask({ priority: 1, sort_order: 5 });
    const c = makeTask({ priority: 3, sort_order: 0 });
    expect(sortTasks([a, b, c]).map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });

  it('detecta atrasadas sin incluir hoy ni completadas', () => {
    const late = makeTask({ due_date: '2026-10-01' });
    const tasks = [
      late,
      makeTask({ due_date: today }),
      makeTask({ due_date: '2026-09-01', status: 'done' }),
    ];
    expect(overdueTasks(tasks, today)).toEqual([late]);
  });

  it('filtra tareas de un día', () => {
    const t = makeTask({ due_date: today });
    expect(tasksDueOn([t, makeTask({ due_date: '2026-10-06' })], today)).toEqual([t]);
  });

  it('calcula la carga de la semana con capacidad 0 en fin de semana', () => {
    const tasks = [
      makeTask({ due_date: today, estimated_minutes: 120 }),
      makeTask({ due_date: today, estimated_minutes: 30 }),
      makeTask({ due_date: '2026-10-06' }),
    ];
    const plan = weekPlan(tasks, today, DEFAULT_SETTINGS);
    expect(plan).toHaveLength(7);
    expect(plan[0]).toMatchObject({ date: today, load: 150, capacity: 360 });
    expect(plan[1].load).toBe(0);
    expect(plan[5]).toMatchObject({ date: '2026-10-10', capacity: 0 });
  });

  it('indexa personas por uso', () => {
    const tasks = [
      makeTask({ people: ['Diana', 'Luis'] }),
      makeTask({ people: ['Diana'] }),
      makeTask({ people: ['Ana'], status: 'done' }),
    ];
    expect(peopleIndex(tasks)).toEqual([
      { name: 'Diana', count: 2 },
      { name: 'Luis', count: 1 },
    ]);
  });

  it('inboxTasks devuelve solo la bandeja', () => {
    const t = makeTask();
    expect(inboxTasks([t, makeTask({ project_id: 'x' })])).toEqual([t]);
  });
});
