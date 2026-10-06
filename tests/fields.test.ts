import { describe, expect, it } from 'vitest';
import { parseDateText, parseEstimateText, parseList } from '../src/parser/fields';

const today = '2026-10-05';

describe('campos editables', () => {
  it.each([
    ['', null], ['sin fecha', null], ['mañana', '2026-10-06'], ['vie', '2026-10-09'],
    ['15 oct', '2026-10-15'], ['2026-12-01', '2026-12-01'], ['el jueves', '2026-10-08'],
  ])('fecha "%s"', (text, value) => {
    expect(parseDateText(text, today)).toEqual({ ok: true, value });
  });

  it('fecha no reconocida', () => {
    expect(parseDateText('cuando pueda', today)).toEqual({ ok: false });
  });

  it.each([['30m', 30], ['2h', 120], ['1h30', 90], ['~45', 45], ['', null]])('estimación "%s"', (text, value) => {
    expect(parseEstimateText(text)).toEqual({ ok: true, value });
  });

  it('estimación no válida', () => {
    expect(parseEstimateText('mucho')).toEqual({ ok: false });
    expect(parseEstimateText('2h y algo')).toEqual({ ok: false });
  });

  it('listas', () => {
    expect(parseList('Diana, @Luis,  , Diana')).toEqual(['Diana', 'Luis']);
  });
});
