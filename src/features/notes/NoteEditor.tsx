import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, CheckSquare, Heading2, Italic, List, ListOrdered } from 'lucide-react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useApp } from '../../app/AppContext';
import { repo } from '../../data/services';
import { actionItems } from '../../domain/markdown';
import { fuzzyScore, tokenName } from '../../domain/text';
import type { Note } from '../../domain/types';
import { docToMarkdown, markdownToHtml } from './richText';

const AUTOSAVE_MS = 700;

/** Enlace de una acción con su tarea (`[[t:id]]`): no se ve en el texto, solo un icono discreto. */
const TaskLink = Node.create({
  name: 'taskLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => el.getAttribute('data-task-link') } }),
  parseHTML: () => [{ tag: 'span[data-task-link]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(
    { 'data-task-link': HTMLAttributes.id, class: 'note-tasklink', title: 'Enlazada a una tarea', contenteditable: 'false' },
  ), '↗'],
});

/** Colorea @personas, #proyectos e IDs (US1234, US-12) mientras se escribe. */
const TOKEN_RE = /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_\-.]*[\p{L}\p{N}_]|(?<![\p{L}\p{N}_&/])#[\p{L}\p{N}_\-.]*[\p{L}\p{N}_]|(?<![\p{L}\p{N}_-])(?:(?:US|TS|DE|TA|TC|F)\d{3,9}|[A-Z][A-Z0-9]{0,9}-\d{1,7})(?![\p{L}\p{N}_-])/gu;
const Tokens = Extension.create({
  name: 'noteTokens',
  addProseMirrorPlugins: () => [new Plugin({
    key: new PluginKey('noteTokens'),
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          for (const m of node.text.matchAll(TOKEN_RE)) {
            const cls = m[0].startsWith('@') ? 'note-mention' : m[0].startsWith('#') ? 'note-project' : 'note-key';
            decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: cls }));
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  })],
});

interface MentionState { query: string; from: number; to: number; left: number; top: number }

/**
 * Editor de notas con formato (como OneNote o Notion): no se ve el Markdown, pero se guarda en Markdown.
 * Las casillas de acciones enlazadas a una tarea la completan o la reabren. Se guarda solo.
 */
export function NoteEditor({ note }: { note: Note }) {
  const { mentionables, tasks } = useApp();
  const taskStatus = useMemo(() => new Map(tasks.map((t) => [t.id, t.status === 'done'])), [tasks]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const saved = useRef(note.body);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [sel, setSel] = useState(0);
  const mentionRef = useRef<{ list: string[]; state: MentionState | null; sel: number }>({ list: [], state: null, sel: 0 });

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null && pending.current !== saved.current) {
      void repo.updateNote(note.id, { body: pending.current }, { silent: true });
      saved.current = pending.current;
    }
    pending.current = null;
  };

  /** Al marcar o desmarcar la casilla de una acción enlazada, la tarea se completa o se reabre. */
  const syncLinkedTasks = (before: string, after: string) => {
    const old = new Map(actionItems(before).filter((a) => a.taskId).map((a) => [a.taskId!, a.checked]));
    for (const a of actionItems(after)) {
      if (!a.taskId || old.get(a.taskId) === undefined || old.get(a.taskId) === a.checked) continue;
      if (taskStatus.get(a.taskId) !== a.checked) void repo.setCompleted(a.taskId, a.checked);
    }
  };

  const updateMention = (editor: Editor) => {
    const { $from, empty } = editor.state.selection;
    const before = empty ? $from.parent.textBetween(0, $from.parentOffset, undefined, '￼') : '';
    const m = /(?:^|\s)@([\p{L}\p{N}_\-.]*)$/u.exec(before);
    if (!m) { setMention(null); return; }
    const coords = editor.view.coordsAtPos($from.pos);
    setMention({ query: m[1], from: $from.pos - m[1].length, to: $from.pos, left: coords.left, top: coords.bottom });
    setSel(0);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true }, codeBlock: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Escribe aquí. Usa la barra de arriba o: «## » título, «- » lista, «[] » acción, @persona…' }),
      TaskLink,
      Tokens,
    ],
    content: markdownToHtml(note.body, (id) => taskStatus.get(id)),
    editorProps: {
      attributes: { class: 'note-editor', spellcheck: 'true' },
      handleKeyDown: (_view, e) => {
        const m = mentionRef.current;
        if (m.state && m.list.length) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const next = (m.sel + (e.key === 'ArrowDown' ? 1 : m.list.length - 1)) % m.list.length;
            setSel(next);
            return true;
          }
          if (e.key === 'Enter' || e.key === 'Tab') { acceptMention(m.list[Math.min(m.sel, m.list.length - 1)]); return true; }
          if (e.key === 'Escape') { setMention(null); return true; }
        }
        // Que las teclas de atajos de la app no se activen al escribir.
        e.stopPropagation();
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const md = docToMarkdown(editor.getJSON());
      syncLinkedTasks(pending.current ?? saved.current, md);
      pending.current = md;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
      updateMention(editor);
    },
    onSelectionUpdate: ({ editor }) => updateMention(editor),
    onBlur: () => { flush(); setTimeout(() => setMention(null), 150); },
  });

  // Si la nota cambia desde fuera (deshacer, convertir acciones en tareas…) y no hay cambios sin guardar, se recarga.
  useEffect(() => {
    if (!editor || pending.current !== null || note.body === saved.current) return;
    saved.current = note.body;
    editor.commands.setContent(markdownToHtml(note.body, (id) => taskStatus.get(id)), { emitUpdate: false });
  }, [note.body, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar lo pendiente al cerrar la nota.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = mention ? mentionables.filter((p) => fuzzyScore(mention.query, p) !== null).slice(0, 6) : [];
  mentionRef.current = { list, state: mention, sel };

  function acceptMention(name: string) {
    const m = mentionRef.current.state;
    if (!editor || !m) return;
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, `${tokenName(name)} `).run();
    setMention(null);
  }

  if (!editor) return null;
  const btn = (active: boolean) => `rounded-md p-1.5 ${active ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`;
  const tool = (title: string, active: boolean, run: () => void, icon: React.ReactNode) => (
    <button type="button" title={title} aria-pressed={active} className={btn(active)} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  );
  return (
    <div className="relative">
      <div className="sticky top-0 z-10 mb-2 flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/95 px-1 py-0.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        {tool('Título', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="size-4" />)}
        {tool('Negrita (Cmd/Ctrl+B)', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold className="size-4" />)}
        {tool('Cursiva (Cmd/Ctrl+I)', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic className="size-4" />)}
        {tool('Lista', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List className="size-4" />)}
        {tool('Lista numerada', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="size-4" />)}
        {tool('Acción (casilla que se puede convertir en tarea)', editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), <CheckSquare className="size-4" />)}
        <span className="ml-auto pr-2 text-xs text-zinc-400">Se guarda solo · @ para mencionar</span>
      </div>
      <EditorContent editor={editor} />
      {mention && list.length > 0 && (
        <ul role="listbox" style={{ position: 'fixed', left: mention.left, top: mention.top + 4 }}
          className="z-50 w-60 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {list.map((p, i) => (
            <li key={p}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); acceptMention(p); }}
                className={`w-full px-3 py-1 text-left ${i === sel ? 'bg-indigo-50 dark:bg-indigo-900/40' : ''}`}>@{p}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
