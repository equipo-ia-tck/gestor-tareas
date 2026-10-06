import { addDays, parseISODate, toISODate, weekdayOf } from './dates';
import type { ISODate, RecurrenceRule } from './types';

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Día `monthDay` del mes, ajustado al último día si no existe (31 → 30, 28…). */
function clampedDate(y: number, m: number, monthDay: number): ISODate {
  const d = new Date(y, m, 1);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), Math.min(monthDay, daysInMonth(d.getFullYear(), d.getMonth()))));
}

/** Lunes de la semana de `iso` (semana de lunes a domingo). */
function mondayOf(iso: ISODate): ISODate {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

function matches(rule: RecurrenceRule, iso: ISODate): boolean {
  switch (rule.freq) {
    case 'daily': return true;
    case 'weekly': return (rule.weekdays ?? []).includes(weekdayOf(iso));
    case 'monthly': {
      const d = parseISODate(iso);
      return clampedDate(d.getFullYear(), d.getMonth(), rule.monthDay ?? 1) === iso;
    }
  }
}

/** Siguiente ocurrencia estrictamente posterior a `after`. */
export function nextOccurrence(rule: RecurrenceRule, after: ISODate): ISODate {
  const interval = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'daily':
      return addDays(after, interval);
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekdayOf(after)];
      const order = (wd: number) => (wd + 6) % 7; // lunes = 0 … domingo = 6
      // Resto de la semana actual.
      const later = days.map(order).filter((o) => o > order(weekdayOf(after))).sort((a, b) => a - b);
      if (later.length) return addDays(mondayOf(after), later[0]);
      // Primera de la siguiente semana válida.
      const first = Math.min(...days.map(order));
      return addDays(mondayOf(after), 7 * interval + first);
    }
    case 'monthly': {
      const d = parseISODate(after);
      const md = rule.monthDay ?? d.getDate();
      const sameMonth = clampedDate(d.getFullYear(), d.getMonth(), md);
      if (sameMonth > after) return sameMonth;
      return clampedDate(d.getFullYear(), d.getMonth() + interval, md);
    }
  }
}

/** Primera ocurrencia en `from` o después. */
export function firstOccurrence(rule: RecurrenceRule, from: ISODate): ISODate {
  return matches(rule, from) ? from : nextOccurrence(rule, from);
}

const WD_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function describeRule(rule: RecurrenceRule): string {
  const every = (unit: string, plural: string) => (rule.interval > 1 ? `cada ${rule.interval} ${plural}` : `cada ${unit}`);
  switch (rule.freq) {
    case 'daily': return every('día', 'días');
    case 'weekly': {
      const wds = rule.weekdays ?? [];
      if (wds.length === 5 && [1, 2, 3, 4, 5].every((d) => wds.includes(d)) && rule.interval === 1) return 'cada día laborable';
      const names = [...wds].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD_NAMES[d]);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0] ?? '';
      return rule.interval > 1 ? `cada ${rule.interval} semanas (${list})` : `cada ${list}`;
    }
    case 'monthly':
      return `${every('mes', 'meses')}, día ${rule.monthDay}`;
  }
}

/**
 * Fecha de la siguiente ocurrencia al completar una recurrente.
 * Se calcula desde su fecha, saltando las ocurrencias que ya han pasado: completar tarde una
 * diaria no deja una cola de días atrasados, pero la de hoy sigue pendiente.
 */
export function nextDueAfterCompletion(rule: RecurrenceRule, due: ISODate | null, today: ISODate): ISODate {
  let next = nextOccurrence(rule, due ?? today);
  while (next < today) next = nextOccurrence(rule, next);
  return next;
}
