/**
 * Markdown mínimo para notas y actas, sin dependencias y sin innerHTML: se convierte en
 * bloques e inlines que la UI pinta como elementos React.
 * Extensiones propias: @persona, #proyecto, claves tipo Jira (US-123) y enlaces a tareas [[t:id]].
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'mention'; name: string }
  | { type: 'project'; name: string }
  | { type: 'key'; key: string }
  | { type: 'tasklink'; id: string };

interface Base { line: number; indent: number }

export type Block =
  | (Base & { type: 'heading'; level: 1 | 2 | 3; inline: Inline[]; text: string })
  | (Base & { type: 'paragraph'; inline: Inline[] })
  | (Base & { type: 'bullet'; inline: Inline[] })
  | (Base & { type: 'ordered'; n: number; inline: Inline[] })
  | (Base & { type: 'task'; checked: boolean; inline: Inline[]; taskId: string | null })
  | (Base & { type: 'quote'; inline: Inline[] })
  | (Base & { type: 'hr' })
  | (Base & { type: 'blank' });

/**
 * Enlace de una acción con su tarea. Puede estar en cualquier punto de la línea (si se escribe
 * detrás de él, el enlace no se pierde); en el editor se dibuja invisible.
 */
const TASK_MARKER = /\s*\[\[t:([\w-]+)\]\]/;
const TASK_MARKERS = /\s*\[\[t:[\w-]+\]\]/g;

/** Separa el texto de una acción de su enlace a tarea (esté donde esté). */
function splitMarker(text: string): { body: string; taskId: string | null } {
  const m = TASK_MARKER.exec(text);
  return { body: text.replace(TASK_MARKERS, '').replace(/\s+$/, ''), taskId: m?.[1] ?? null };
}
export const MENTION_RE = /(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu;

const INLINE_RE = new RegExp(
  [
    '`(?<code>[^`]+)`',
    '\\[\\[t:(?<task>[\\w-]+)\\]\\]',
    '\\[(?<ltext>[^\\]]+)\\]\\((?<lhref>https?:\\/\\/[^)\\s]+)\\)',
    '(?<url>https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?])',
    '\\*\\*(?<bold>.+?)\\*\\*',
    '(?<![\\p{L}\\p{N}_])_(?<it1>[^_]+)_(?![\\p{L}\\p{N}_])',
    '(?<![\\p{L}\\p{N}_*])\\*(?<it2>[^*\\s][^*]*)\\*(?![\\p{L}\\p{N}_*])',
    '(?<![\\p{L}\\p{N}_.])@(?<mention>[\\p{L}\\p{N}_\\-.]*[\\p{L}\\p{N}_])',
    '(?<![\\p{L}\\p{N}_&/])#(?<project>[\\p{L}\\p{N}_\\-.]*[\\p{L}\\p{N}_])',
    '(?<![\\p{L}\\p{N}_\\-])(?<key>[A-Z][A-Z0-9]{0,9}-\\d{1,7})(?![\\p{L}\\p{N}_\\-])',
  ].join('|'),
  'gu',
);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let pos = 0;
  const push = (t: string) => { if (t) out.push({ type: 'text', text: t }); };
  for (const m of text.matchAll(INLINE_RE)) {
    push(text.slice(pos, m.index));
    const g = m.groups!;
    if (g.code !== undefined) out.push({ type: 'code', text: g.code });
    else if (g.task !== undefined) out.push({ type: 'tasklink', id: g.task });
    else if (g.ltext !== undefined) out.push({ type: 'link', text: g.ltext, href: g.lhref });
    else if (g.url !== undefined) out.push({ type: 'link', text: g.url.replace(/^https?:\/\//, ''), href: g.url });
    else if (g.bold !== undefined) out.push({ type: 'bold', children: parseInline(g.bold) });
    else if (g.it1 !== undefined || g.it2 !== undefined) out.push({ type: 'italic', children: parseInline(g.it1 ?? g.it2) });
    else if (g.mention !== undefined) out.push({ type: 'mention', name: g.mention });
    else if (g.project !== undefined) out.push({ type: 'project', name: g.project });
    else if (g.key !== undefined) out.push({ type: 'key', key: g.key });
    pos = m.index + m[0].length;
  }
  push(text.slice(pos));
  return out;
}

export function parseMarkdown(text: string): Block[] {
  return text.split('\n').map((raw, line): Block => {
    const indent = Math.floor((raw.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0) / 2);
    const s = raw.trim();
    if (!s) return { type: 'blank', line, indent };
    if (/^(-{3,}|\*{3,})$/.test(s)) return { type: 'hr', line, indent };
    const h = /^(#{1,3})\s+(.*)$/.exec(s);
    if (h) return { type: 'heading', level: h[1].length as 1 | 2 | 3, inline: parseInline(h[2]), text: h[2], line, indent };
    const task = /^[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(s);
    if (task) {
      const { body, taskId } = splitMarker(task[2]);
      return { type: 'task', checked: task[1] !== ' ', inline: parseInline(body), taskId, line, indent };
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(s);
    if (bullet) return { type: 'bullet', inline: parseInline(bullet[1]), line, indent };
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(s);
    if (ordered) return { type: 'ordered', n: Number(ordered[1]), inline: parseInline(ordered[2]), line, indent };
    const quote = /^>\s?(.*)$/.exec(s);
    if (quote) return { type: 'quote', inline: parseInline(quote[1]), line, indent };
    return { type: 'paragraph', inline: parseInline(s), line, indent };
  });
}

/** Personas mencionadas con @, sin duplicados (en el orden en que aparecen). */
export function extractMentions(text: string): string[] {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const name = m[1].replace(/-/g, ' ');
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

export interface ActionItem {
  line: number;
  /** Texto de la acción, sin casilla ni marcador de tarea. */
  text: string;
  checked: boolean;
  taskId: string | null;
}

/** Acciones de una nota: las líneas `- [ ] …`. */
export function actionItems(text: string): ActionItem[] {
  return text.split('\n').flatMap((raw, line) => {
    const m = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(raw);
    if (!m) return [];
    const { body, taskId } = splitMarker(m[2]);
    return body.trim() ? [{ line, text: body.trim(), checked: m[1] !== ' ', taskId }] : [];
  });
}

/** Enlaza la acción de la línea `line` con una tarea (añade `[[t:id]]` al final). */
export function setTaskMarker(text: string, line: number, taskId: string): string {
  const lines = text.split('\n');
  if (lines[line] === undefined) return text;
  lines[line] = `${lines[line].replace(TASK_MARKERS, '').trimEnd()} [[t:${taskId}]]`;
  return lines.join('\n');
}

/** Marca o desmarca la casilla de la línea `line`. */
export function setChecked(text: string, line: number, checked: boolean): string {
  const lines = text.split('\n');
  if (lines[line] === undefined) return text;
  lines[line] = lines[line].replace(/^(\s*[-*+]\s+)\[[ xX]\]/, `$1[${checked ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** Título de la sección (encabezado más cercano por encima) de una línea. */
export function sectionOf(text: string, line: number): string | null {
  const lines = text.split('\n');
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const h = /^\s*#{1,3}\s+(.*)$/.exec(lines[i]);
    if (h) return h[1].trim();
  }
  return null;
}

/** Texto plano de una línea (para resúmenes y búsqueda): sin marcas ni marcadores de tarea. */
export function plainLine(raw: string): string {
  return raw
    .replace(TASK_MARKERS, '')
    .replace(/^\s*(#{1,3}|[-*+](\s+\[[ xX]\])?|\d+[.)]|>)\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
