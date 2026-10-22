import type { JSONContent } from '@tiptap/core';
import { parseMarkdown, type Block, type Inline } from '../../domain/markdown';

/**
 * Conversión entre el Markdown con el que se guardan las notas y el editor con formato (TipTap).
 * Las notas se siguen guardando en Markdown: así no cambian las acciones `- [ ]`, las @menciones, el
 * "quién dijo qué", la búsqueda ni las copias. Solo cambia cómo se escriben.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(nodes: Inline[]): string {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text': return esc(n.text);
      case 'bold': return `<strong>${inlineHtml(n.children)}</strong>`;
      case 'italic': return `<em>${inlineHtml(n.children)}</em>`;
      case 'code': return `<code>${esc(n.text)}</code>`;
      case 'link': return `<a href="${esc(n.href)}">${esc(n.text)}</a>`;
      case 'mention': return esc(`@${n.name}`);
      case 'project': return esc(`#${n.name}`);
      case 'key': return esc(n.key);
      case 'tasklink': return `<span data-task-link="${esc(n.id)}"></span>`;
    }
  }).join('');
}

type ListKind = 'ul' | 'ol' | 'task';
interface ListItem { html: string; checked: boolean; children: ListNode[] }
interface ListNode { kind: ListKind; items: ListItem[] }

const listKind = (b: Block): ListKind | null => (b.type === 'bullet' ? 'ul' : b.type === 'ordered' ? 'ol' : b.type === 'task' ? 'task' : null);

/** Agrupa líneas de lista consecutivas en listas anidadas según su sangría. */
function buildLists(blocks: Block[], start: number, indent: number, isDone: (b: Block) => boolean): [ListNode[], number] {
  const out: ListNode[] = [];
  let i = start;
  while (i < blocks.length) {
    const b = blocks[i];
    const kind = listKind(b);
    if (!kind || b.indent < indent) break;
    if (b.indent > indent) {
      const last = out[out.length - 1]?.items.at(-1);
      const [nested, next] = buildLists(blocks, i, b.indent, isDone);
      if (last) last.children.push(...nested); else out.push(...nested);
      i = next;
      continue;
    }
    const inline = 'inline' in b ? inlineHtml(b.inline) + (b.type === 'task' && b.taskId ? `<span data-task-link="${esc(b.taskId)}"></span>` : '') : '';
    const item: ListItem = { html: inline, checked: isDone(b), children: [] };
    const current = out[out.length - 1];
    if (current && current.kind === kind) current.items.push(item); else out.push({ kind, items: [item] });
    i++;
  }
  return [out, i];
}

function listHtml(node: ListNode): string {
  const items = node.items.map((it) => {
    const inner = `<p>${it.html}</p>${it.children.map(listHtml).join('')}`;
    return node.kind === 'task' ? `<li data-type="taskItem" data-checked="${it.checked}">${inner}</li>` : `<li>${inner}</li>`;
  }).join('');
  if (node.kind === 'task') return `<ul data-type="taskList">${items}</ul>`;
  return node.kind === 'ol' ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
}

/**
 * Markdown → HTML para cargar en el editor. `taskDone` da el estado real de una acción enlazada a una
 * tarea (así la casilla refleja si la tarea está hecha).
 */
export function markdownToHtml(md: string, taskDone?: (taskId: string) => boolean | undefined): string {
  const blocks = parseMarkdown(md);
  const isDone = (b: Block) => (b.type === 'task' ? (b.taskId ? taskDone?.(b.taskId) ?? b.checked : b.checked) : false);
  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (listKind(b)) {
      const [lists, next] = buildLists(blocks, i, b.indent, isDone);
      parts.push(...lists.map(listHtml));
      i = next;
      continue;
    }
    if (b.type === 'quote') {
      const ps: string[] = [];
      while (i < blocks.length && blocks[i].type === 'quote') ps.push(`<p>${inlineHtml((blocks[i] as Extract<Block, { type: 'quote' }>).inline)}</p>`), i++;
      parts.push(`<blockquote>${ps.join('')}</blockquote>`);
      continue;
    }
    if (b.type === 'heading') parts.push(`<h${b.level}>${inlineHtml(b.inline)}</h${b.level}>`);
    else if (b.type === 'hr') parts.push('<hr>');
    else if (b.type === 'blank') parts.push('<p></p>');
    else if (b.type === 'paragraph') parts.push(`<p>${inlineHtml(b.inline)}</p>`);
    i++;
  }
  // Una línea vacía al final no hace falta como párrafo.
  while (parts.length > 1 && parts[parts.length - 1] === '<p></p>') parts.pop();
  return parts.join('');
}

// ---------------------------------------------------------------- Editor → Markdown

const MARKS: Record<string, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], code: ['`', '`'] };

function inlineMd(content: JSONContent[] = []): string {
  let out = '';
  let open: string[] = [];
  let href = '';
  const close = (keep: string[]) => {
    while (open.length && !keep.includes(open[open.length - 1])) {
      const m = open.pop()!;
      out += m === 'link' ? `](${href})` : MARKS[m]?.[1] ?? '';
    }
  };
  for (const n of content) {
    if (n.type === 'text') {
      const marks = (n.marks ?? []).map((m) => m.type).filter((t) => t === 'link' || t in MARKS);
      const link = n.marks?.find((m) => m.type === 'link');
      // Se cierran las marcas que ya no siguen (o todas si cambia el enlace) y se abren las nuevas.
      close(link && link.attrs?.href !== href ? [] : marks);
      for (const m of ['link', 'bold', 'italic', 'code']) {
        if (!marks.includes(m) || open.includes(m)) continue;
        if (m === 'link') { href = String(link!.attrs?.href ?? ''); out += '['; } else out += MARKS[m][0];
        open.push(m);
      }
      out += n.text ?? '';
    } else {
      close([]);
      if (n.type === 'taskLink') out += `${out && !out.endsWith(' ') ? ' ' : ''}[[t:${n.attrs?.id}]]`;
      else if (n.type === 'hardBreak') out += ' ';
    }
  }
  close([]);
  return out;
}

function blockMd(node: JSONContent, indent: number): string[] {
  const pad = '  '.repeat(indent);
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph': return [pad + inlineMd(children)];
    case 'heading': return [`${'#'.repeat(Number(node.attrs?.level ?? 2))} ${inlineMd(children)}`];
    case 'horizontalRule': return ['---'];
    case 'blockquote': return children.flatMap((c) => blockMd(c, 0).map((l) => `> ${l}`));
    case 'codeBlock': return ['```', ...inlineMd(children).split('\n'), '```'];
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      let n = Number(node.attrs?.start ?? 1);
      return children.flatMap((item) => {
        const [first, ...rest] = item.content ?? [];
        const marker = node.type === 'orderedList' ? `${n++}. ` : node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- ';
        const head = `${pad}${marker}${first?.type === 'paragraph' ? inlineMd(first.content) : ''}`;
        const more = (first && first.type !== 'paragraph' ? [first, ...rest] : rest).flatMap((c) => blockMd(c, indent + 1));
        return [head, ...more];
      });
    }
    default: return children.length ? children.flatMap((c) => blockMd(c, indent)) : [];
  }
}

/** Documento del editor → Markdown (una línea por párrafo, como el resto de la app). */
export function docToMarkdown(doc: JSONContent): string {
  return (doc.content ?? []).flatMap((n) => blockMd(n, 0)).join('\n').replace(/\s+$/, '');
}
