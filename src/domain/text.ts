/** Minúsculas y sin tildes, para comparar sin importar cómo se escriba. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Clave de nombre: "Fundación Cadete" y "fundacion-cadete" coinciden. */
export const nameKey = (s: string) => fold(s).trim().replace(/[\s_-]+/g, '-');

/** Forma de escribir un nombre como token (#proyecto, @persona): sin espacios. */
export const tokenName = (s: string) => s.trim().replace(/\s+/g, '-');

/**
 * Búsqueda difusa: cada palabra de la consulta debe aparecer como subsecuencia.
 * Devuelve null si no coincide; mayor puntuación = mejor coincidencia.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = fold(query).trim();
  if (!q) return 0;
  const t = fold(target);
  let total = 0;
  for (const word of q.split(/\s+/)) {
    const s = wordScore(word, t);
    if (s === null) return null;
    total += s;
  }
  return total;
}

function wordScore(word: string, t: string): number | null {
  const idx = t.indexOf(word);
  if (idx >= 0) {
    const atWordStart = idx === 0 || /[^a-z0-9]/.test(t[idx - 1]);
    return 100 + word.length * 4 + (atWordStart ? 30 : 0) - idx * 0.1;
  }
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of word) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === prev + 1 ? 5 : 1;
    if (found === 0 || /[^a-z0-9]/.test(t[found - 1])) score += 3;
    prev = found;
    ti = found + 1;
  }
  return score;
}
