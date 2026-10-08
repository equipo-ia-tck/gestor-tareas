import { describe, expect, it } from 'vitest';
import {
  dailySummary, distributeOverdue, nextMonday, nextOccurrenceTask, staleTasks,
} from '../src/domain/maintenance';
import { nextDueAfterCompletion } from '../src/domain/recurrence';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { makeTask } from './factories';

const today = '2026-10-05'; // lunes

describe('recurrentes al completar', () => {
  const weeklyMon = { freq: 'weekly' as const, interval: 1, weekdays: [1] };

  it('la siguiente ocurrencia parte de la fecha de la tarea', () => {
    expect(nextDueAfterCompletion(weeklyMon, '2026-10-05', today)).toBe('2026-10-12');
    expect(nextDueAfterCompletion({ freq: 'daily', interval: 1 }, '2026-10-05', today)).toBe('2026-10-06');
  });

  it('completar tarde salta las ocurrencias pasadas, sin pasar de hoy', () => {
    expect(nextDueAfterCompletion({ freq: 'daily', interval: 1 }, '2026-10-01', today)).toBe('2026-10-05');
    expect(nextDueAfterCompletion(weeklyMon, '2026-09-21', '2026-10-07')).toBe('2026-10-12');
  });

  it('copia los campos y enlaza la serie', () => {
    const t = makeTask({ title: 'revisar', recurrence_rule: weeklyMon, due_date: today, people: ['Diana'], priority: 1, series_id: 's1' });
    expect(nextOccurrenceTask(t, today)).toMatchObject({
      title: 'revisar', due_date: '2026-10-12', people: ['Diana'], priority: 1, series_id: 's1', recurrence_rule: weeklyMon,
    });
    expect(nextOccurrenceTask(makeTask(), today)).toBeNull();
  });
});

describe('repartir atrasadas', () => {
  const settings = { ...DEFAULT_SETTINGS, capacity_minutes: 120 };

  it('ordena por prioridad y antigüedad y respeta la capacidad', () => {
    const a = makeTask({ title: 'a', due_date: '2026-10-01', priority: 3, estimated_minutes: 60 });
    const b = makeTask({ title: 'b', due_date: '2026-10-02', priority: 1, estimated_minutes: 90 });
    const c = makeTask({ title: 'c', due_date: '2026-09-20', priority: 3, estimated_minutes: 60 });
    const plan = distributeOverdue([a, b, c], today, settings);
    expect(plan.map((p) => [p.task.title, p.date])).toEqual([
      ['b', '2026-10-05'], // prioridad 1 primero, cabe hoy (90/120)
      ['c', '2026-10-06'], // más antigua que a; hoy solo quedan 30
      ['a', '2026-10-06'],
    ]);
  });

  it('tiene en cuenta lo ya previsto y salta fines de semana', () => {
    const friday = '2026-10-09';
    const planned = makeTask({ due_date: friday, estimated_minutes: 120 });
    const late = makeTask({ due_date: '2026-10-05', estimated_minutes: 60 });
    const plan = distributeOverdue([planned, late], friday, settings);
    expect(plan.map((p) => p.date)).toEqual(['2026-10-12']);
  });

  it('las tareas sin estimación cuentan 30 minutos', () => {
    const ts = [1, 2, 3, 4, 5].map((i) => makeTask({ title: `t${i}`, due_date: '2026-10-01' }));
    const plan = distributeOverdue(ts, today, settings);
    expect(plan.filter((p) => p.date === today)).toHaveLength(4);
    expect(plan.filter((p) => p.date === '2026-10-06')).toHaveLength(1);
  });

  it('una tarea mayor que la capacidad va al día con más hueco', () => {
    const big = makeTask({ due_date: '2026-10-01', estimated_minutes: 600 });
    expect(distributeOverdue([big], today, settings)[0].date).toBe(today);
  });

  it('sin atrasadas o sin días laborables, nada', () => {
    expect(distributeOverdue([makeTask({ due_date: today })], today, settings)).toEqual([]);
    expect(distributeOverdue([makeTask({ due_date: '2026-10-01' })], today, { ...settings, workdays: [] })).toEqual([]);
  });
});

describe('tareas obsoletas', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  it('propone las activas sin tocar en más de 30 días, sin las atrasadas', () => {
    const old = makeTask({ last_touched_at: '2026-08-01T00:00:00Z' });
    const recent = makeTask({ last_touched_at: '2026-09-20T00:00:00Z' });
    const oldDone = makeTask({ last_touched_at: '2026-08-01T00:00:00Z', status: 'done' });
    const oldLate = makeTask({ last_touched_at: '2026-08-01T00:00:00Z', due_date: '2026-08-02' });
    expect(staleTasks([old, recent, oldDone, oldLate], today, now)).toEqual([old]);
  });
});

describe('resumen del día', () => {
  it('top 3 por prioridad, vencimiento y antigüedad, con aviso de sobrecarga', () => {
    const tasks = [
      makeTask({ title: 'hoy p4', due_date: today, estimated_minutes: 300 }),
      makeTask({ title: 'atrasada p2', due_date: '2026-10-01', priority: 2 }),
      makeTask({ title: 'hoy p1', due_date: today, priority: 1, estimated_minutes: 120 }),
      makeTask({ title: 'futura p1', due_date: '2026-10-08', priority: 1 }),
      makeTask({ title: 'futura p4', due_date: '2026-10-08' }),
    ];
    const s = dailySummary(tasks, today, DEFAULT_SETTINGS);
    expect(s.top.map((t) => t.title)).toEqual(['hoy p1', 'atrasada p2', 'hoy p4']);
    expect(s).toMatchObject({ overdueCount: 1, dueTodayCount: 2, load: 420, capacity: 360, overloaded: true });
  });

  it('completa con prioridades altas de los próximos días', () => {
    const s = dailySummary([makeTask({ title: 'futura p1', due_date: '2026-10-08', priority: 1 })], today, DEFAULT_SETTINGS);
    expect(s.top.map((t) => t.title)).toEqual(['futura p1']);
    expect(s.overloaded).toBe(false);
  });
});

describe('fechas', () => {
  it('nextMonday', () => {
    expect(nextMonday('2026-10-05')).toBe('2026-10-12');
    expect(nextMonday('2026-10-11')).toBe('2026-10-12');
    expect(nextMonday('2026-10-09')).toBe('2026-10-12');
  });
});

describe('revisión semanal', () => {
  it('toca de viernes a lunes si no se ha hecho desde el viernes', async () => {
    const { reviewDue } = await import('../src/domain/maintenance');
    expect(reviewDue(null, '2026-10-07')).toBe(false); // miércoles
    expect(reviewDue(null, '2026-10-09')).toBe(true); // viernes
    expect(reviewDue('2026-10-09', '2026-10-12')).toBe(false); // hecha el viernes, lunes siguiente
    expect(reviewDue('2026-10-08', '2026-10-12')).toBe(true); // hecha el jueves: no cuenta
    expect(reviewDue('2026-10-02', '2026-10-10')).toBe(true); // de la semana anterior
  });
});
