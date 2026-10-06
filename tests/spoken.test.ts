import { describe, expect, it } from 'vitest';
import { normalizeSpoken } from '../src/parser/spoken';
import { parseCapture } from '../src/parser/parseCapture';

describe('normalizeSpoken', () => {
  it.each([
    ['llamar a Diana prioridad uno', 'llamar a Diana !1'],
    ['revisar informe con prioridad alta', 'revisar informe !2'],
    ['preparar demo proyecto caixa', 'preparar demo #caixa'],
    ['enviar acta del proyecto cadete', 'enviar acta #cadete'],
    ['leer documento media hora', 'leer documento ~30m'],
    ['preparar charla dos horas', 'preparar charla ~2h'],
    ['repasar notas 45 minutos', 'repasar notas ~45m'],
    ['estudiar una hora y media', 'estudiar ~90m'],
    ['comprar pan', 'comprar pan'],
  ])('%s → %s', (spoken, expected) => {
    expect(normalizeSpoken(spoken)).toBe(expected);
  });

  it('no convierte plazos en estimaciones', () => {
    expect(normalizeSpoken('llamar dentro de dos horas')).toBe('llamar dentro de dos horas');
  });

  it('el resultado pasa por el parser de captura', () => {
    const [t] = parseCapture(normalizeSpoken('mañana preparar demo proyecto caixa prioridad uno dos horas'), {
      today: '2026-10-05', projects: [{ id: 'p', name: 'caixa' }], people: [],
    });
    expect(t).toMatchObject({ title: 'preparar demo', due_date: '2026-10-06', priority: 1, estimated_minutes: 120 });
    expect(t.project?.id).toBe('p');
  });
});
