/**
 * Traduce expresiones habladas a la sintaxis de captura, porque al dictar no se pueden "decir"
 * símbolos: "prioridad uno" → "!1", "proyecto caixa" → "#caixa", "media hora" → "~30m".
 * Se aplica solo al texto dictado; lo escrito a mano no cambia.
 */
const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cuarenta_y_cinco: 45 };
const toNum = (s: string) => NUM[s.toLowerCase().replace(/\s+/g, '_')] ?? parseInt(s, 10);
const NUM_RE = '(\\d+|un|una|uno|dos|tres|cuatro|cinco|diez|quince|veinte|treinta|cuarenta(?:\\s+y\\s+cinco)?)';
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

export function normalizeSpoken(text: string): string {
  return text
    .replace(new RegExp(`${B}(?:con\\s+)?prioridad\\s+(1|2|3|4|uno|dos|tres|cuatro|urgente|alta|media|baja)${E}`, 'giu'), (_, p: string) => {
      const map: Record<string, number> = { urgente: 1, alta: 2, media: 3, baja: 4 };
      return `!${map[p.toLowerCase()] ?? toNum(p)}`;
    })
    .replace(new RegExp(`${B}(?:en\\s+el\\s+|del\\s+|para\\s+el\\s+)?proyecto\\s+([\\p{L}\\p{N}_-]+)`, 'giu'), '#$1')
    .replace(new RegExp(`${B}(?:una\\s+)?hora\\s+y\\s+media${E}`, 'giu'), '~90m')
    .replace(new RegExp(`${B}media\\s+hora${E}`, 'giu'), '~30m')
    .replace(new RegExp(`${B}${NUM_RE}\\s+(minutos?|horas?)${E}`, 'giu'), (m, n: string, unit: string, offset: number, all: string) => {
      // "dentro de 2 horas" / "en 3 horas" son plazos, no estimaciones.
      if (/(dentro\s+de|en)\s+$/i.test(all.slice(Math.max(0, offset - 12), offset))) return m;
      const value = toNum(n);
      return /^h/i.test(unit) ? `~${value}h` : `~${value}m`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
