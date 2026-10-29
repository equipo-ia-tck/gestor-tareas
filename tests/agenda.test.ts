import { describe, expect, it } from 'vitest';
import { hourRange, layoutDay, minutesOf } from '../src/domain/agenda';

const r = (s: string, e: string) => ({ s, e });
const layout = (xs: { s: string; e: string }[]) =>
  layoutDay(xs, (x) => ({ start: minutesOf(x.s), end: minutesOf(x.e) })).map((b) => `${b.item.s} ${b.col}/${b.cols}`);

describe('agenda por horas', () => {
  it('las que no se solapan ocupan todo el ancho', () => {
    expect(layout([r('10:00', '10:30'), r('09:30', '10:00')])).toEqual(['09:30 0/1', '10:00 0/1']);
  });

  it('las que se solapan van en columnas y reutilizan las que quedan libres', () => {
    expect(layout([r('09:30', '10:00'), r('09:30', '10:30'), r('10:00', '11:00'), r('12:00', '12:30')]))
      .toEqual(['09:30 0/2', '09:30 1/2', '10:00 1/2', '12:00 0/1']); // la de 10:00 ocupa la columna que deja libre la de 9:30–10:00
  });

  it('da al menos 15 minutos y amplía el horario si hace falta', () => {
    const [b] = layoutDay([1], () => ({ start: 600, end: 600 }));
    expect(b.end - b.start).toBe(15);
    expect(hourRange([{ start: 7 * 60 + 30, end: 20 * 60 + 10 }])).toEqual([7, 21]);
    expect(hourRange([])).toEqual([8, 19]);
  });
});
