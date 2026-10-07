import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bold, CheckSquare, Heading2, List, Pencil, Eye } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { repo } from '../../data/services';
import { knownPeople } from '../../domain/selectors';
import { fuzzyScore, tokenName } from '../../domain/text';
import type { Note } from '../../domain/types';
import { Markdown } from './Markdown';

const AUTOSAVE_MS = 700;

/**
 * Editor de notas: al escribir, el Markdown se colorea en vivo (encabezados, listas, acciones,
 * @personas, #proyectos); al salir se ve formateado. Se guarda solo mientras escribes.
 */
export function NoteEditor({ note, onToggle, onMakeTask }: {
  note: Note;
  onToggle: (line: number, taskId: string | null) => void;
  onMakeTask: (line: number) => void;
}) {
  const { tasks } = useApp();
  const [editing, setEditing] = useState(!note.body.trim());
  const [text, setText] = useState(note.body);
  const [caret, setCaret] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Si la nota cambia desde fuera (deshacer, convertir acciones…) y no hay cambios sin guardar, se recarga.
  useEffect(() => { if (pending.current === null) setText(note.body); }, [note.body]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null && pending.current !== note.body) void repo.updateNote(note.id, { body: pending.current }, { silent: true });
    pending.current = null;
  };
  // Guardar lo pendiente al cerrar la nota.
  useEffect(() => () => flush(), []);

  const change = (value: string, pos?: number) => {
    setText(value);
    if (pos !== undefined) setCaret(pos);
    pending.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };

  // Al entrar en modo edición, el cursor va al final (lo habitual es seguir escribiendo).
  useLayoutEffect(() => {
    const el = ref.current;
    if (editing && el) el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`;
  }, [text, editing]);

  // ---- Autocompletado de @persona
  const people = useMemo(() => knownPeople(tasks), [tasks]);
  const trigger = /(?:^|\s)@([\p{L}\p{N}_\-.]*)$/u.exec(text.slice(0, caret));
  const suggestions = trigger ? people.filter((p) => fuzzyScore(trigger[1], p) !== null).slice(0, 5) : [];
  const [sel, setSel] = useState(0);

  function insertAt(start: number, end: number, insert: string, caretOffset = insert.length) {
    const value = text.slice(0, start) + insert + text.slice(end);
    change(value, start + caretOffset);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(start + caretOffset, start + caretOffset); });
  }

  function acceptMention(name: string) {
    if (!trigger) return;
    insertAt(caret - trigger[1].length, caret, `${tokenName(name)} `);
  }

  /** Antepone un prefijo a la línea actual (encabezado, lista, acción). */
  function linePrefix(prefix: string) {
    const el = ref.current;
    const pos = el?.selectionStart ?? text.length;
    const start = text.lastIndexOf('\n', pos - 1) + 1;
    const line = text.slice(start).split('\n')[0];
    const stripped = line.replace(/^(#{1,3}\s|[-*+]\s+\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)/, '');
    insertAt(start, start + line.length, prefix + stripped, prefix.length + stripped.length);
  }

  function wrapBold() {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = text.slice(a, b) || 'texto';
    insertAt(a, b, `**${sel}**`, sel.length + 4);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptMention(suggestions[Math.min(sel, suggestions.length - 1)]); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapBold(); return; }
    if (e.key === 'Escape') { e.preventDefault(); flush(); setEditing(false); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Continuar listas y acciones; Enter en un elemento vacío lo termina.
      const pos = e.currentTarget.selectionStart;
      const start = text.lastIndexOf('\n', pos - 1) + 1;
      const line = text.slice(start, pos);
      const m = /^(\s*)([-*+]\s+\[[ xX]\]\s|[-*+]\s|(\d+)([.)])\s)(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[5].trim()) { insertAt(start, pos, ''); return; }
      const next = m[3] ? `${Number(m[3]) + 1}${m[4]} ` : m[2].replace(/\[[xX]\]/, '[ ]');
      insertAt(pos, pos, `\n${m[1]}${next}`);
    }
  }

  if (!editing) {
    return (
      <div className="group relative">
        <Toolbar editing={false} onToggleMode={() => setEditing(true)} />
        <div onClick={() => setEditing(true)} className="min-h-60 cursor-text rounded-lg px-1 py-2 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40">
          {text.trim() ? <Markdown text={text} onToggle={onToggle} onMakeTask={onMakeTask} /> : <p className="text-sm text-zinc-400">Haz clic para escribir…</p>}
        </div>
      </div>
    );
  }

  const box = 'px-3 py-2 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words';
  return (
    <div>
      <Toolbar editing onToggleMode={() => { flush(); setEditing(false); }}
        onHeading={() => linePrefix('## ')} onBold={wrapBold} onList={() => linePrefix('- ')} onTask={() => linePrefix('- [ ] ')} />
      <div className="relative rounded-lg border border-zinc-200 bg-white focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        <div aria-hidden className={`${box} pointer-events-none absolute inset-0 overflow-hidden`}><Highlight text={text} /></div>
        <textarea
          ref={ref}
          autoFocus
          value={text}
          spellCheck
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => { flush(); }}
          placeholder="Escribe en Markdown: ## Título, - lista, - [ ] acción, @persona, #proyecto, **negrita**"
          className={`${box} relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-zinc-900 outline-none placeholder:font-sans placeholder:text-zinc-400 dark:caret-zinc-100`}
        />
        {suggestions.length > 0 && (
          <ul className="absolute right-2 bottom-2 z-10 w-56 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {suggestions.map((p, i) => (
              <li key={p}><button type="button" onMouseDown={(e) => { e.preventDefault(); acceptMention(p); }}
                className={`w-full px-3 py-1 text-left ${i === sel ? 'bg-indigo-50 dark:bg-indigo-900/40' : ''}`}>@{p}</button></li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-400">Se guarda solo · Esc para ver con formato · Enter continúa listas y acciones · Cmd/Ctrl+B negrita</p>
    </div>
  );
}

function Toolbar({ editing, onToggleMode, onHeading, onBold, onList, onTask }: {
  editing: boolean;
  onToggleMode: () => void;
  onHeading?: () => void;
  onBold?: () => void;
  onList?: () => void;
  onTask?: () => void;
}) {
  const btn = 'rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';
  return (
    <div className="mb-1 flex items-center gap-0.5">
      {editing && (
        <>
          <button type="button" title="Encabezado" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={onHeading}><Heading2 className="size-4" /></button>
          <button type="button" title="Negrita (Cmd/Ctrl+B)" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={onBold}><Bold className="size-4" /></button>
          <button type="button" title="Lista" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={onList}><List className="size-4" /></button>
          <button type="button" title="Acción (- [ ])" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={onTask}><CheckSquare className="size-4" /></button>
          <span className="flex-1" />
        </>
      )}
      {!editing && <span className="flex-1" />}
      <button type="button" className={`${btn} flex items-center gap-1 text-xs`} onClick={onToggleMode}>
        {editing ? <><Eye className="size-3.5" />Ver</> : <><Pencil className="size-3.5" />Editar</>}
      </button>
    </div>
  );
}

/** Copia coloreada del texto para el modo edición (mismas métricas: solo cambia el color). */
function Highlight({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          <LineHighlight line={line} />
          {i < lines.length - 1 ? '\n' : ' '}
        </span>
      ))}
    </>
  );
}

function LineHighlight({ line }: { line: string }): ReactNode {
  if (/^\s*#{1,3}\s/.test(line)) return <span className="text-indigo-600 dark:text-indigo-400">{line}</span>;
  const task = /^(\s*[-*+]\s+\[[ xX]\])(.*)$/.exec(line);
  if (task) return <><span className="text-emerald-600">{task[1]}</span>{inline(task[2])}</>;
  const list = /^(\s*(?:[-*+]|\d+[.)])\s)(.*)$/.exec(line);
  if (list) return <><span className="text-zinc-400">{list[1]}</span>{inline(list[2])}</>;
  if (/^\s*>/.test(line)) return <span className="text-zinc-500">{line}</span>;
  return inline(line);
}

function inline(text: string): ReactNode[] {
  const re = /(\[\[t:[\w-]+\]\]|\*\*[^*]+\*\*|`[^`]+`|(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_\-.]*[\p{L}\p{N}_]|(?<![\p{L}\p{N}_&/])#[\p{L}\p{N}_\-.]*[\p{L}\p{N}_]|(?<![\p{L}\p{N}_-])[A-Z][A-Z0-9]{0,9}-\d{1,7}(?![\p{L}\p{N}_-]))/gu;
  const out: ReactNode[] = [];
  let pos = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(pos, m.index));
    const t = m[0];
    const cls = t.startsWith('[[') ? 'text-zinc-300 dark:text-zinc-600'
      : t.startsWith('**') ? 'text-zinc-900 dark:text-white bg-yellow-100/60 dark:bg-yellow-900/30'
      : t.startsWith('`') ? 'text-rose-600'
      : t.startsWith('@') ? 'text-sky-600 dark:text-sky-400'
      : t.startsWith('#') ? 'text-violet-600 dark:text-violet-400'
      : 'text-cyan-700 dark:text-cyan-400';
    out.push(<span key={m.index} className={cls}>{t}</span>);
    pos = m.index + t.length;
  }
  out.push(text.slice(pos));
  return out;
}
