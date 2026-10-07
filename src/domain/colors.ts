import { nameKey } from './text';
import type { Label } from './types';

/** Paleta para etiquetas y personas: tonos saturados que se leen bien en claro y oscuro. */
export const LABEL_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b',
];

function hash(s: string): number {
  let h = 0;
  for (const ch of nameKey(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Color estable derivado del nombre (la misma etiqueta o persona siempre tiene el mismo color). */
export const colorFor = (name: string) => LABEL_COLORS[hash(name) % LABEL_COLORS.length];

export function labelColor(name: string, labels: Label[] | Map<string, string>): string {
  const custom = labels instanceof Map ? labels.get(nameKey(name)) : labels.find((l) => nameKey(l.name) === nameKey(name))?.color;
  return custom ?? colorFor(name);
}

export const labelColorMap = (labels: Label[]) => new Map(labels.map((l) => [nameKey(l.name), l.color]));

/** "Ana María López" → "AM". */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Fondo suave a partir de un color hex (para chips y columnas). */
export const tint = (hex: string, alpha = 0.15) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
