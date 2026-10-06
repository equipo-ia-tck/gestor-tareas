import type { ISODate } from '../domain/types';
import { estimateMinutes, findDate, SYMBOL_PATTERNS } from './patterns';

export type FieldParse<T> = { ok: true; value: T } | { ok: false };

/**
 * Fecha escrita en un campo: "mañana", "vie", "15 oct", "2026-10-20"…
 * Vacío o "sin fecha" = quitar la fecha.
 */
export function parseDateText(text: string, today: ISODate): FieldParse<ISODate | null> {
  const t = text.trim();
  if (!t || /^(sin\s+fecha|ninguna|nada|-)$/i.test(t)) return { ok: true, value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: true, value: t };
  // Abreviaturas de día de la semana solas, cómodas al teclear.
  const abbr: Record<string, string> = { lun: 'lunes', mar: 'martes', mie: 'miércoles', mié: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', sáb: 'sábado', dom: 'domingo' };
  const expanded = abbr[t.toLowerCase()] ?? t;
  const m = findDate(expanded, today, () => false);
  return m ? { ok: true, value: m.value } : { ok: false };
}

/** Estimación escrita en un campo: "30m", "2h", "1h30", "~45", "90". Vacío = quitar. */
export function parseEstimateText(text: string): FieldParse<number | null> {
  const t = text.trim().replace(/^~/, '');
  if (!t) return { ok: true, value: null };
  const re = new RegExp(`^${SYMBOL_PATTERNS.estimate.source}$`, 'u');
  const m = re.exec(`~${t}`);
  const min = m ? estimateMinutes(m) : null;
  return min === null ? { ok: false } : { ok: true, value: min };
}

/** "Diana, @Luis,  ana" → ["Diana", "Luis", "ana"] sin duplicados. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(',').map((x) => x.trim().replace(/^[@+#]/, '')).filter(Boolean))];
}
