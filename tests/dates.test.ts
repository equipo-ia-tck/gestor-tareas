import { describe, expect, it } from 'vitest';
import {
  addDays, diffDays, formatDay, formatMinutes, nextWorkdays, todayISO, weekdayOf,
} from '../src/domain/dates';

describe('dates', () => {
  it('suma días cruzando meses y el cambio de hora de octubre', () => {
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // cambio de hora 25/10
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calcula diferencias y día de la semana', () => {
    expect(diffDays('2026-10-05', '2026-10-09')).toBe(4);
    expect(diffDays('2026-10-24', '2026-10-27')).toBe(3);
    expect(weekdayOf('2026-10-05')).toBe(1); // lunes
  });

  it('usa la fecha local para hoy', () => {
    expect(todayISO(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });

  it('salta fines de semana en nextWorkdays', () => {
    expect(nextWorkdays('2026-10-09', 3, [1, 2, 3, 4, 5])).toEqual([
      '2026-10-09', '2026-10-12', '2026-10-13',
    ]);
    expect(nextWorkdays('2026-10-09', 3, [])).toEqual([]);
  });

  it('formatea días relativos', () => {
    const today = '2026-10-05';
    expect(formatDay('2026-10-05', today)).toBe('Hoy');
    expect(formatDay('2026-10-06', today)).toBe('Mañana');
    expect(formatDay('2026-10-04', today)).toBe('Ayer');
    expect(formatDay('2026-10-09', today)).toBe('vie 9 oct');
    expect(formatDay('2027-01-15', today)).toBe('15 ene 2027');
  });

  it('formatea minutos', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
});

describe('calendario', () => {
  it('monthGrid empieza en lunes y cubre el mes', async () => {
    const { monthGrid } = await import('../src/domain/dates');
    const g = monthGrid('2026-10-15');
    expect(g[0][0]).toBe('2026-09-28');
    expect(g.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(g).toHaveLength(5);
    expect(g.flat()).toContain('2026-10-31');
  });

  it('addMonths ajusta a fin de mes', async () => {
    const { addMonths } = await import('../src/domain/dates');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-07', -1)).toBe('2026-09-07');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('semana ISO', () => {
  it.each([
    ['2026-10-07', 41], ['2026-01-01', 1], ['2027-01-01', 53], ['2026-12-28', 53], ['2027-01-04', 1], ['2024-12-30', 1],
  ])('%s → semana %i', async (iso, week) => {
    const { isoWeek } = await import('../src/domain/dates');
    expect(isoWeek(iso)).toBe(week);
  });
});

describe('mondayOf', () => {
  it.each([['2026-10-07', '2026-10-05'], ['2026-10-05', '2026-10-05'], ['2026-10-11', '2026-10-05'], ['2026-11-01', '2026-10-26']])('%s → %s', async (d, m) => {
    const { mondayOf } = await import('../src/domain/dates');
    expect(mondayOf(d)).toBe(m);
  });
});
