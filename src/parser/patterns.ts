import * as chronoEs from 'chrono-node/es';
import { addDays, parseISODate, toISODate, weekdayOf } from '../domain/dates';
import type { ISODate, RecurrenceRule } from '../domain/types';

/** Fronteras de palabra compatibles con tildes y ñ (\b de JS solo entiende ASCII). */
const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';

export const WEEKDAYS: [RegExp, number][] = [
  [/^lun/i, 1], [/^mar/i, 2], [/^mi/i, 3], [/^jue/i, 4], [/^vie/i, 5], [/^s/i, 6], [/^dom/i, 0],
];
const WD = 'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?';

const weekdayNumber = (s: string) => WEEKDAYS.find(([re]) => re.test(s))![1];

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTH = 'ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sept?(?:iembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?';
const monthIndex = (s: string) => {
  const k = s.toLowerCase().slice(0, 3);
  return k === 'set' ? 8 : MONTHS.indexOf(k);
};

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')}`;
const toNumber = (s: string) => NUMBER_WORDS[s.toLowerCase()] ?? parseInt(s, 10);

export interface Match<T> {
  start: number;
  end: number;
  value: T;
}

interface Rule<T> {
  re: RegExp;
  value: (m: RegExpExecArray, today: ISODate) => T | null;
}

const rx = (src: string) => new RegExp(`${B}(?:${src})${E}`, 'giu');

/** Primera ocurrencia (en orden de reglas) que no solape con rangos bloqueados. */
function findFirst<T>(rules: Rule<T>[], text: string, today: ISODate, blocked: (s: number, e: number) => boolean): Match<T> | null {
  let best: Match<T> | null = null;
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (blocked(start, end)) continue;
      const value = rule.value(m, today);
      if (value === null) continue;
      // Gana la que aparece antes; a igualdad, la más larga.
      if (!best || start < best.start || (start === best.start && end > best.end)) best = { start, end, value };
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Fechas

function nextWeekday(today: ISODate, wd: number, allowToday: boolean): ISODate {
  let diff = (wd - weekdayOf(today) + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return addDays(today, diff);
}

function lastDayOfMonth(today: ISODate): ISODate {
  const d = parseISODate(today);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Fecha día/mes; sin año, si ya ha pasado se entiende el año siguiente. */
function dayMonth(day: number, month: number, year: number | null, today: ISODate): ISODate | null {
  if (month < 0 || month > 11 || day < 1) return null;
  const t = parseISODate(today);
  let y = year ?? t.getFullYear();
  if (y < 100) y += 2000;
  const d = new Date(y, month, day);
  if (d.getMonth() !== month) return null; // 31 de febrero, etc.
  let iso = toISODate(d);
  if (year === null && iso < today) iso = toISODate(new Date(y + 1, month, day));
  return iso;
}

const DATE_RULES: Rule<ISODate>[] = [
  { re: rx('pasado\\s+ma[nñ]ana'), value: (_, t) => addDays(t, 2) },
  { re: rx('esta\\s+(?:ma[nñ]ana|tarde|noche)|hoy'), value: (_, t) => t },
  // "por la mañana" / "de la mañana" es una franja horaria, no una fecha.
  { re: new RegExp(`${B}(?<!la\\s)(?<!esta\\s)ma[nñ]ana${E}`, 'giu'), value: (_, t) => addDays(t, 1) },
  {
    // "los lunes" (plural, costumbre) no es una fecha concreta.
    re: new RegExp(`${B}(?<!los\\s)(?<!las\\s)(?:(el|este)\\s+)?(?:(pr[oó]ximo)\\s+)?(${WD})(?:\\s+(que\\s+viene|pr[oó]ximo))?${E}`, 'giu'),
    value: (m, t) => {
      if (/^(s[aá]bados|domingos)$/i.test(m[3])) return null;
      const wd = weekdayNumber(m[3]);
      const isThis = m[1]?.toLowerCase() === 'este' && !m[2] && !m[4];
      // "el lunes" dicho en lunes = el de la semana siguiente (para hoy ya existe "hoy").
      return nextWeekday(t, wd, isThis);
    },
  },
  { re: rx('(?:a\\s+|para\\s+)?(?:el\\s+)?(?:fin|final)\\s+de(?:l)?\\s+mes'), value: (_, t) => lastDayOfMonth(t) },
  { re: rx('(?:el\\s+|este\\s+)?fin\\s+de\\s+semana'), value: (_, t) => nextWeekday(t, 6, true) },
  { re: rx('(?:la\\s+)?(?:semana\\s+que\\s+viene|pr[oó]xima\\s+semana)'), value: (_, t) => nextWeekday(t, 1, false) },
  {
    re: rx(`(?:dentro\\s+de|en)\\s+(${NUM})\\s+(d[ií]as?|semanas?|mes(?:es)?)`),
    value: (m, t) => {
      const n = toNumber(m[1]);
      const unit = m[2].toLowerCase();
      if (unit.startsWith('d')) return addDays(t, n);
      if (unit.startsWith('s')) return addDays(t, 7 * n);
      const d = parseISODate(t);
      return toISODate(new Date(d.getFullYear(), d.getMonth() + n, d.getDate()));
    },
  },
  {
    re: rx(`(?:el\\s+)?(\\d{1,2})(?:\\s+de)?\\s+(${MONTH})\\.?(?:\\s+(?:de(?:l)?\\s+)?(\\d{4}))?`),
    value: (m, t) => dayMonth(parseInt(m[1], 10), monthIndex(m[2]), m[3] ? parseInt(m[3], 10) : null, t),
  },
  {
    re: rx('(?:el\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?'),
    value: (m, t) => dayMonth(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : null, t),
  },
];

export function findDate(text: string, today: ISODate, blocked: (s: number, e: number) => boolean): Match<ISODate> | null {
  const own = findFirst(DATE_RULES, text, today, blocked);
  if (own) return own;
  // Respaldo: chrono, solo para fechas con día seguro y algún número (evita falsos positivos como "a las 5").
  const ref = parseISODate(today);
  for (const r of chronoEs.parse(text, ref, { forwardDate: true })) {
    const end = r.index + r.text.length;
    if (!/\d/.test(r.text) || !r.start.isCertain('day') || !r.start.isCertain('month')) continue;
    if (blocked(r.index, end)) continue;
    return { start: r.index, end, value: toISODate(r.start.date()) };
  }
  return null;
}

// ---------------------------------------------------------------- Recurrencia

const weekdaysIn = (s: string) => [...new Set([...s.matchAll(new RegExp(WD, 'giu'))].map((m) => weekdayNumber(m[0])))];

const RECURRENCE_RULES: Rule<RecurrenceRule>[] = [
  {
    re: rx('cada\\s+d[ií]a\\s+laborable|todos\\s+los\\s+d[ií]as\\s+laborables|entre\\s+semana|de\\s+lunes\\s+a\\s+viernes'),
    value: () => ({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }),
  },
  {
    re: rx(`(?:cada|todos\\s+los|todas\\s+las)\\s+(?:${WD})(?:(?:\\s*,\\s*|\\s+y\\s+)(?:${WD}))*`),
    value: (m) => ({ freq: 'weekly', interval: 1, weekdays: weekdaysIn(m[0]) }),
  },
  {
    re: rx(`(?:el\\s+)?(?:d[ií]a\\s+)?(\\d{1,2})\\s+de\\s+cada\\s+mes|(?:cada|todos\\s+los)\\s+d[ií]as?\\s+(\\d{1,2})(?:\\s+de\\s+cada\\s+mes)?`),
    value: (m) => {
      const day = parseInt(m[1] ?? m[2], 10);
      return day >= 1 && day <= 31 ? { freq: 'monthly', interval: 1, monthDay: day } : null;
    },
  },
  { re: rx('cada\\s+d[ií]a|todos\\s+los\\s+d[ií]as|a\\s+diario|diariamente'), value: () => ({ freq: 'daily', interval: 1 }) },
  {
    re: rx(`cada\\s+(${NUM})\\s+d[ií]as`),
    value: (m) => ({ freq: 'daily', interval: toNumber(m[1]) }),
  },
  {
    re: rx(`cada\\s+(${NUM})\\s+semanas`),
    value: (m, t) => ({ freq: 'weekly', interval: toNumber(m[1]), weekdays: [weekdayOf(t)] }),
  },
  {
    re: rx('cada\\s+semana|todas\\s+las\\s+semanas|semanalmente'),
    value: (_, t) => ({ freq: 'weekly', interval: 1, weekdays: [weekdayOf(t)] }),
  },
  {
    re: rx(`cada\\s+(${NUM})\\s+meses`),
    value: (m, t) => ({ freq: 'monthly', interval: toNumber(m[1]), monthDay: parseISODate(t).getDate() }),
  },
  {
    re: rx('cada\\s+mes|todos\\s+los\\s+meses|mensualmente'),
    value: (_, t) => ({ freq: 'monthly', interval: 1, monthDay: parseISODate(t).getDate() }),
  },
];

export function findRecurrence(text: string, today: ISODate, blocked: (s: number, e: number) => boolean) {
  return findFirst(RECURRENCE_RULES, text, today, blocked);
}

// ---------------------------------------------------------------- Recordatorio

/** "recuérdame a las 17:00", "avísame a las 9", "aviso 18.30h". Devuelve hora y minutos. */
const REMINDER_RE = new RegExp(
  `${B}(?:recu[eé]rdame|recordarme|av[ií]same|aviso)(?:\\s+(?:a\\s+las?|a))?\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:h(?:oras?)?)?${E}`,
  'giu',
);

export function findReminder(text: string, blocked: (s: number, e: number) => boolean): Match<{ h: number; m: number }> | null {
  REMINDER_RE.lastIndex = 0;
  for (const m of text.matchAll(REMINDER_RE)) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) continue;
    if (blocked(m.index, m.index + m[0].length)) continue;
    return { start: m.index, end: m.index + m[0].length, value: { h, m: min } };
  }
  return null;
}

// ---------------------------------------------------------------- Tokens con símbolo

export const SYMBOL_PATTERNS = {
  // "#caixa" o, con subproyectos, "#caixa/sprint-14".
  project: /(?<![\p{L}\p{N}_&/])#([\p{L}\p{N}_\-./]*[\p{L}\p{N}_])/gu,
  person: /(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu,
  priority: /(?<!\S)!([1-4])(?![\p{L}\p{N}_])/gu,
  estimate: /(?<!\S)~(\d+(?:[.,]\d+)?)(h|m|min)?(?:(\d{1,2})(?:m|min)?)?(?![\p{L}\p{N}_])/gu,
  tag: /(?<!\S)\+([\p{L}\p{N}_\-]*[\p{L}\p{N}_])/gu,
  // Clave de Jira/Xray/ADO en mayúsculas: "US-1234", "QA2-17"; y las de Rally sin guion ("US1764574",
  // "TS92615", "DE125701", "TA123", "TC456", "F789"). Las minúsculas ("covid-19") no cuentan. El grupo 1 es el prefijo.
  key: /(?<![\p{L}\p{N}_\-])((?:US|TS|DE|TA|TC|F)(?=\d{3,9}(?![\p{L}\p{N}_\-]))|[A-Z][A-Z0-9]{0,9}(?=-\d{1,7}(?![\p{L}\p{N}_\-])))-?\d{1,9}(?![\p{L}\p{N}_\-])/gu,
  release: /(?<!\S)\^([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu,
};

/** "~30m" → 30, "~2h" → 120, "~1h30" → 90, "~1,5h" → 90, "~45" → 45. */
export function estimateMinutes(m: RegExpExecArray): number | null {
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = m[2]?.toLowerCase();
  let minutes = unit === 'h' ? n * 60 + (m[3] ? parseInt(m[3], 10) : 0) : n;
  if (unit !== 'h' && m[3]) return null; // "~30m15" no tiene sentido
  minutes = Math.round(minutes);
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}
