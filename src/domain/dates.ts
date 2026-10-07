import type { ISODate } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Medianoche local del día indicado. */
export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(iso: ISODate): number {
  return parseISODate(iso).getDay();
}

/** Días enteros de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

export function isWorkday(iso: ISODate, workdays: number[]): boolean {
  return workdays.includes(weekdayOf(iso));
}

/** Los `count` próximos días laborables empezando en `from` (incluido). */
export function nextWorkdays(from: ISODate, count: number, workdays: number[]): ISODate[] {
  const out: ISODate[] = [];
  if (workdays.length === 0) return out;
  let d = from;
  while (out.length < count) {
    if (isWorkday(d, workdays)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function weekdayName(iso: ISODate, long = false): string {
  return (long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[weekdayOf(iso)];
}

/** "Hoy", "Mañana", "Ayer", "vie 9 oct" o "9 oct 2027" si es otro año. */
export function formatDay(iso: ISODate, today: ISODate): string {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const d = parseISODate(iso);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  if (d.getFullYear() !== parseISODate(today).getFullYear()) return `${base} ${d.getFullYear()}`;
  return `${WEEKDAYS_SHORT[d.getDay()]} ${base}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Semanas (de lunes a domingo) que cubren el mes de `anyDay`, como matriz de fechas. */
export function monthGrid(anyDay: ISODate): ISODate[][] {
  const d = parseISODate(anyDay);
  const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  let start = addDays(first, -((weekdayOf(first) + 6) % 7));
  const weeks: ISODate[][] = [];
  while (start <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    start = addDays(start, 7);
  }
  return weeks;
}

/** Mismo día del mes anterior/siguiente (ajustado a fin de mes). */
export function addMonths(iso: ISODate, n: number): ISODate {
  const d = parseISODate(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)));
}
