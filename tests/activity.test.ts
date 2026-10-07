import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { TasksDB } from '../src/data/db';
import { DexieRepository } from '../src/data/repository';
import { activityFor, dailyLog, isEmptyDay, postponeCounts } from '../src/domain/activity';
import { todayISO } from '../src/domain/dates';
import { atLocal, dueReminders, nextReminderAt, quickReminders, toDatetimeLocal } from '../src/domain/reminders';
import type { ActivityEntry } from '../src/domain/types';
import { makeTask } from './factories';

let repo: DexieRepository;
beforeEach(() => { repo = new DexieRepository(new TasksDB(`v5-${crypto.randomUUID()}`)); });

describe('activityFor', () => {
  const base = makeTask({ due_date: '2026-10-07' });
  it('creada, completada, reabierta', () => {
    expect(activityFor(undefined, base).map((e) => e.kind)).toEqual(['created']);
    const done = { ...base, status: 'done' as const, state_id: 'task-done' };
    expect(activityFor(base, done).map((e) => e.kind)).toEqual(['completed']);
    expect(activityFor(done, base).map((e) => e.kind)).toEqual(['reopened']);
  });

  it('pospuesta solo si la fecha se retrasa o se quita', () => {
    expect(activityFor(base, { ...base, due_date: '2026-10-09' })).toEqual([{ kind: 'postponed', from: '2026-10-07', to: '2026-10-09' }]);
    expect(activityFor(base, { ...base, due_date: null })).toEqual([{ kind: 'postponed', from: '2026-10-07', to: null }]);
    expect(activityFor(base, { ...base, due_date: '2026-10-05' })).toEqual([]);
    expect(activityFor({ ...base, due_date: null }, base)).toEqual([]);
  });

  it('eliminada, archivada y cambio de estado', () => {
    expect(activityFor(base, { ...base, deleted_at: 'x' }).map((e) => e.kind)).toEqual(['deleted']);
    expect(activityFor(base, { ...base, status: 'archived' }).map((e) => e.kind)).toEqual(['archived']);
    expect(activityFor(base, { ...base, state_id: 'task-doing' })).toEqual([{ kind: 'state', from: 'task-todo', to: 'task-doing' }]);
  });
});

describe('registro diario', () => {
  const e = (kind: ActivityEntry['kind'], task: string, at: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: crypto.randomUUID(), at, date: at.slice(0, 10), kind, task_id: task, title: task, project_id: null, from: null, to: null, ...extra,
  });
  it('agrupa por día y descuenta lo completado y reabierto el mismo día', () => {
    const entries = [
      e('completed', 'a', '2026-10-07T09:00:00Z'),
      e('completed', 'b', '2026-10-07T10:00:00Z'),
      e('reopened', 'b', '2026-10-07T11:00:00Z'),
      e('postponed', 'c', '2026-10-07T12:00:00Z', { from: '2026-10-07', to: '2026-10-08' }),
      e('postponed', 'c', '2026-10-07T13:00:00Z', { from: '2026-10-08', to: '2026-10-10' }),
      e('deleted', 'd', '2026-10-06T09:00:00Z'),
    ];
    const [d7, d6, d5] = dailyLog(entries, [], '2026-10-05', '2026-10-07');
    expect(d7.completed.map((x) => x.task_id)).toEqual(['a']);
    expect(d7.postponed).toHaveLength(1);
    expect(d7.postponed[0]).toMatchObject({ from: '2026-10-07', to: '2026-10-10' });
    expect(d6.dropped.map((x) => x.task_id)).toEqual(['d']);
    expect(isEmptyDay(d5)).toBe(true);
    expect(postponeCounts(entries).get('c')).toBe(2);
  });
});

describe('registro en el repositorio', () => {
  it('apunta lo que pasa y deshacer lo quita', async () => {
    const t = await repo.createTask({ title: 'informe', due_date: '2026-10-07' });
    await repo.updateTask(t.id, { due_date: '2026-10-09' });
    await repo.setCompleted(t.id, true);
    const kinds = (await repo.listActivity()).map((x) => x.kind).sort();
    expect(kinds).toEqual(['completed', 'created', 'postponed']); // completar no apunta además un cambio de estado
    await repo.undo();
    expect((await repo.listActivity()).map((x) => x.kind).sort()).toEqual(['created', 'postponed']);
    const today = todayISO();
    expect((await repo.listActivity(today)).every((x) => x.date === today)).toBe(true);
  });

  it('migración v4 → v5 añade remind_at', async () => {
    const name = `mig5-${crypto.randomUUID()}`;
    const v4 = new Dexie(name);
    v4.version(4).stores({ projects: 'id', tasks: 'id', settings: 'key', meta: 'key', labels: 'name', item_types: 'id', releases: 'id', notes: 'id', people: 'name' });
    await v4.table('tasks').add({ id: 'a', title: 'x', status: 'todo' });
    v4.close();
    const db = new TasksDB(name);
    expect((await db.tasks.get('a'))?.remind_at).toBeNull();
    expect(await db.activity.count()).toBe(0);
  });
});

describe('recordatorios', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  it('vencidos y siguiente', () => {
    const a = makeTask({ remind_at: '2026-10-07T09:00:00.000Z' });
    const b = makeTask({ remind_at: '2026-10-07T12:00:00.000Z' });
    const c = makeTask({ remind_at: '2026-10-07T08:00:00.000Z', status: 'done' });
    expect(dueReminders([a, b, c], now)).toEqual([a]);
    expect(nextReminderAt([a, b, c], now)).toBe('2026-10-07T12:00:00.000Z');
  });

  it('opciones rápidas y formato local', () => {
    const local = new Date(2026, 9, 7, 10, 30); // miércoles 10:30 local
    const opts = quickReminders(local);
    expect(opts.map((o) => o.label)).toEqual(['En 1 hora', 'Esta tarde (17:00)', 'Mañana (9:00)', 'El lunes (9:00)']);
    expect(new Date(opts[2].at).getHours()).toBe(9);
    expect(new Date(opts[3].at).getDay()).toBe(1);
    expect(toDatetimeLocal(atLocal('2026-10-08', 9, 5))).toBe('2026-10-08T09:05');
  });
});
