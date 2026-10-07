import { firstOccurrence } from '../domain/recurrence';
import { nameKey } from '../domain/text';
import type { ISODate, Priority, RecurrenceRule } from '../domain/types';
import { estimateMinutes, findDate, findRecurrence, SYMBOL_PATTERNS, type Match } from './patterns';
import { tokenKey, type CaptureContext, type ParseCapture, type ParsedTask, type Token, type TokenKind } from './types';

/**
 * Convierte el texto de la barra de captura en tareas.
 * Varias tareas se separan con ";" o saltos de línea.
 */
export const parseCapture: ParseCapture = (text, ctx) => {
  const out: ParsedTask[] = [];
  for (const m of text.matchAll(/[^;\n]+/g)) {
    if (m[0].trim()) out.push(parseSegment(m[0], m.index, ctx));
  }
  return out;
};

const SINGLE: TokenKind[] = ['project', 'priority', 'estimate', 'key', 'release'];

function parseSegment(seg: string, offset: number, ctx: CaptureContext): ParsedTask {
  const ignore = new Set(ctx.ignore ?? []);
  const reserved: [number, number][] = [];
  const tokens: Token[] = [];
  const blocked = (s: number, e: number) => reserved.some(([rs, re]) => s < re && e > rs);
  const reserve = (s: number, e: number) => reserved.push([s, e]);

  let project: ParsedTask['project'] = null;
  const people: string[] = [];
  /** Nombre normalizado de cada token @persona, por posición, para el título. */
  const personNames = new Map<number, string>();
  const tags: string[] = [];
  let priority: Priority | null = null;
  let estimate: number | null = null;
  let externalId: string | null = null;
  let typeId: string | null = null;
  let release: ParsedTask['release'] = null;

  const addToken = (kind: TokenKind, start: number, end: number): boolean => {
    const text = seg.slice(start, end);
    reserve(start, end);
    if (ignore.has(tokenKey({ kind, text }))) return false;
    if (SINGLE.includes(kind) && tokens.some((t) => t.kind === kind)) return false;
    tokens.push({ kind, start, end, text });
    return true;
  };

  // 1. Tokens con símbolo: no son ambiguos y tienen preferencia.
  for (const kind of ['project', 'person', 'priority', 'estimate', 'tag', 'key', 'release'] as const) {
    const re = SYMBOL_PATTERNS[kind];
    re.lastIndex = 0;
    for (const m of seg.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (blocked(start, end)) continue;
      if (kind === 'estimate') {
        const min = estimateMinutes(m as RegExpExecArray);
        if (min === null) continue; // mal escrito: se queda como texto
        if (addToken(kind, start, end)) estimate = min;
        continue;
      }
      if (!addToken(kind, start, end)) continue;
      const value = m[1];
      if (kind === 'project') {
        const found = ctx.projects.find((p) => nameKey(p.name) === nameKey(value));
        project = found ? { id: found.id, name: found.name } : { id: null, name: value };
      } else if (kind === 'person') {
        const known = ctx.people.find((p) => nameKey(p) === nameKey(value)) ?? value.replace(/-/g, ' ');
        personNames.set(start, known);
        if (!people.some((p) => nameKey(p) === nameKey(known))) people.push(known);
      } else if (kind === 'priority') {
        priority = Number(value) as Priority;
      } else if (kind === 'tag') {
        if (!tags.includes(value)) tags.push(value);
      } else if (kind === 'key') {
        externalId = m[0];
        typeId = ctx.types?.find((t) => t.short && t.short.toUpperCase() === value)?.id ?? null;
      } else if (kind === 'release') {
        const found = ctx.releases?.find((r) => nameKey(r.name) === nameKey(value));
        release = found ? { id: found.id, name: found.name } : { id: null, name: value };
      }
    }
  }

  // 2. Recurrencia y 3. fecha. Si un fragmento se descarta, se reserva como texto y se busca otro.
  const findWords = <T,>(kind: TokenKind, find: (b: typeof blocked) => Match<T> | null): Match<T> | null => {
    for (;;) {
      const m = find(blocked);
      if (!m) return null;
      if (addToken(kind, m.start, m.end)) return m;
    }
  };

  const recurrenceMatch = findWords('recurrence', (b) => findRecurrence(seg, ctx.today, b));
  const dateMatch = findWords('date', (b) => findDate(seg, ctx.today, b));
  let recurrence: RecurrenceRule | null = recurrenceMatch?.value ?? null;

  // "cada mes" / "cada semana" junto a una fecha: se ancla en esa fecha, no en hoy.
  if (recurrenceMatch && dateMatch) {
    const again = findRecurrence(seg.slice(recurrenceMatch.start, recurrenceMatch.end), dateMatch.value, () => false);
    if (again) recurrence = again.value;
  }

  let due: ISODate | null = dateMatch?.value ?? null;
  if (!due && recurrence) due = firstOccurrence(recurrence, ctx.today);

  return {
    title: buildTitle(seg, tokens, personNames),
    raw_input: seg.trim(),
    due_date: due,
    project,
    people,
    tags,
    priority,
    estimated_minutes: estimate,
    recurrence,
    external_id: externalId,
    type_id: typeId,
    release,
    tokens: tokens
      .map((t) => ({ ...t, start: t.start + offset, end: t.end + offset }))
      .sort((a, b) => a.start - b.start),
  };
}

const KEEPS_PERSON = /(?:^|\s)(?:a|al|con|para|de|del|según|y|e|o|u|ni|por|sobre|entre|que)\s+$/i;

/** Quita los tokens del texto. Las personas tras preposición se quedan como nombre ("a @Diana" → "a Diana"). */
function buildTitle(seg: string, tokens: Token[], personNames: Map<number, string>): string {
  let out = '';
  let pos = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    out += seg.slice(pos, t.start);
    // La persona se queda en el título solo si la frase la necesita ("a @Diana", "con @Luis");
    // si va suelta ("revisar login @Diana") es solo un dato y se quita.
    if (t.kind === 'person' && KEEPS_PERSON.test(seg.slice(0, t.start))) out += personNames.get(t.start) ?? t.text.slice(1);
    pos = t.end;
  }
  out += seg.slice(pos);
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:;])/g, '$1')
    .replace(/^[\s,.:;–-]+|[\s,:;–-]+$/g, '')
    .trim();
}
