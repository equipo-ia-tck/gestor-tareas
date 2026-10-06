import { describe, expect, it } from 'vitest';
import { describeRule, firstOccurrence, nextOccurrence } from '../src/domain/recurrence';
import { fold, fuzzyScore, nameKey } from '../src/domain/text';

describe('nextOccurrence', () => {
  it('diaria con intervalo', () => {
    expect(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-10-05')).toBe('2026-10-06');
    expect(nextOccurrence({ freq: 'daily', interval: 3 }, '2026-10-30')).toBe('2026-11-02');
  });

  it('semanal en varios días', () => {
    const r = { freq: 'weekly' as const, interval: 1, weekdays: [1, 4] };
    expect(nextOccurrence(r, '2026-10-05')).toBe('2026-10-08'); // lun → jue
    expect(nextOccurrence(r, '2026-10-08')).toBe('2026-10-12'); // jue → lun
  });

  it('semanal con domingo (fin de semana)', () => {
    const r = { freq: 'weekly' as const, interval: 1, weekdays: [0] };
    expect(nextOccurrence(r, '2026-10-05')).toBe('2026-10-11');
    expect(nextOccurrence(r, '2026-10-11')).toBe('2026-10-18');
  });

  it('cada 2 semanas', () => {
    const r = { freq: 'weekly' as const, interval: 2, weekdays: [1] };
    expect(nextOccurrence(r, '2026-10-05')).toBe('2026-10-19');
  });

  it('mensual ajusta a fin de mes', () => {
    const r = { freq: 'monthly' as const, interval: 1, monthDay: 31 };
    expect(nextOccurrence(r, '2026-10-31')).toBe('2026-11-30');
    expect(nextOccurrence(r, '2027-01-31')).toBe('2027-02-28');
    expect(nextOccurrence({ freq: 'monthly', interval: 1, monthDay: 15 }, '2026-10-05')).toBe('2026-10-15');
  });

  it('firstOccurrence incluye el día de partida si coincide', () => {
    expect(firstOccurrence({ freq: 'weekly', interval: 1, weekdays: [1] }, '2026-10-05')).toBe('2026-10-05');
    expect(firstOccurrence({ freq: 'weekly', interval: 1, weekdays: [3] }, '2026-10-05')).toBe('2026-10-07');
  });

  it('describe reglas en español', () => {
    expect(describeRule({ freq: 'weekly', interval: 1, weekdays: [4, 1] })).toBe('cada lunes y jueves');
    expect(describeRule({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] })).toBe('cada día laborable');
    expect(describeRule({ freq: 'daily', interval: 2 })).toBe('cada 2 días');
    expect(describeRule({ freq: 'monthly', interval: 1, monthDay: 20 })).toBe('cada mes, día 20');
  });
});

describe('texto', () => {
  it('fold y nameKey', () => {
    expect(fold('Fundación')).toBe('fundacion');
    expect(nameKey('Fundación Cadete')).toBe(nameKey('fundacion-cadete'));
  });

  it('fuzzyScore', () => {
    expect(fuzzyScore('', 'lo que sea')).toBe(0);
    expect(fuzzyScore('venc mañ', 'Mover vencidas a mañana')).not.toBeNull();
    expect(fuzzyScore('exp', 'Exportar copia')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Exportar copia')).toBeNull();
    // Coincidencia al principio de palabra puntúa más que una subsecuencia dispersa.
    expect(fuzzyScore('hoy', 'Ir a Hoy')!).toBeGreaterThan(fuzzyScore('hoy', 'Mover a hoja y')!);
  });
});
