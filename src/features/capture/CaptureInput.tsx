import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { formatDay, formatMinutes } from '../../domain/dates';
import { describeRule } from '../../domain/recurrence';
import { knownPeople } from '../../domain/selectors';
import { fuzzyScore, nameKey, tokenName } from '../../domain/text';
import type { NewTask } from '../../domain/types';
import { parseCapture } from '../../parser/parseCapture';
import { tokenKey, type ParsedTask, type Token, type TokenKind } from '../../parser/types';
import { submitCapture } from './submitCapture';

export const TOKEN_STYLE: Record<TokenKind, string> = {
  date: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  recurrence: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200',
  project: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  person: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  priority: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  estimate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  tag: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/60 dark:text-fuchsia-200',
};

interface Props {
  defaults?: Partial<NewTask>;
  placeholder?: string;
  autoFocus?: boolean;
  /** Tras crear las tareas (p. ej. cerrar el modal). */
  onDone?: () => void;
  onCancel?: () => void;
  /** El texto empieza por ">": pasar a la paleta de comandos. */
  onCommandMode?: (query: string) => void;
  large?: boolean;
}

interface Suggestion {
  label: ReactNode;
  insert: string;
}

/** Barra de captura con sintaxis rápida: resaltado en vivo, autocompletado y chips. */
export function CaptureInput({ defaults, placeholder, autoFocus, onDone, onCancel, onCommandMode, large }: Props) {
  const { tasks, projects, today } = useApp();
  const toast = useToast();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [ignore, setIgnore] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const people = useMemo(() => knownPeople(tasks), [tasks]);
  const parsed = useMemo(
    () => parseCapture(text, { today, projects, people, ignore }),
    [text, today, projects, people, ignore],
  );
  const tokens = parsed.flatMap((p) => p.tokens);

  // ---- Autocompletado de #proyecto y @persona
  const trigger = useMemo(() => {
    const m = /(?:^|[\s(])([#@])([\p{L}\p{N}_\-.]*)$/u.exec(text.slice(0, caret));
    return m ? { symbol: m[1], query: m[2], start: caret - m[2].length - 1 } : null;
  }, [text, caret]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger || dismissedAt === trigger.start) return [];
    const pool = trigger.symbol === '#' ? projects.map((p) => p.name) : people;
    const ranked = pool
      .map((name) => ({ name, score: fuzzyScore(trigger.query, name) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, 6);
    const items: Suggestion[] = ranked.map(({ name }) => ({ label: `${trigger.symbol}${name}`, insert: tokenName(name) }));
    const exact = pool.some((n) => nameKey(n) === nameKey(trigger.query));
    if (trigger.symbol === '#' && trigger.query && !exact) {
      items.push({ label: <>Crear proyecto <strong>#{trigger.query}</strong></>, insert: trigger.query });
    }
    return items;
  }, [trigger, dismissedAt, projects, people]);

  const showSuggestions = suggestions.length > 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function change(value: string, pos: number) {
    if (value.startsWith('>') && onCommandMode) {
      onCommandMode(value.slice(1));
      return;
    }
    setText(value);
    setCaret(pos);
    setSelected(0);
    if (!value.trim()) setIgnore([]);
  }

  function accept(s: Suggestion) {
    if (!trigger) return;
    const before = text.slice(0, trigger.start + 1) + s.insert + ' ';
    const after = text.slice(caret).replace(/^[\p{L}\p{N}_\-.]*/u, '').replace(/^ /, '');
    const value = before + after;
    setText(value);
    setCaret(before.length);
    requestAnimationFrame(() => ref.current?.setSelectionRange(before.length, before.length));
  }

  async function submit() {
    const valid = parsed.filter((p) => p.title);
    if (valid.length === 0) return;
    const created = await submitCapture(valid, defaults);
    setText('');
    setIgnore([]);
    const where = destination(valid[0], defaults);
    toast(
      created.length === 1 ? `Tarea creada${where ? ` en ${where}` : ''}` : `${created.length} tareas creadas`,
      { label: 'Deshacer', run: async () => { for (const t of created) await repo.deleteTask(t.id); } },
    );
    onDone?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSuggestions) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = suggestions.length;
        setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        accept(suggestions[Math.min(selected, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(trigger!.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      if (onCancel) { e.preventDefault(); onCancel(); }
      else if (text) { e.preventDefault(); setText(''); setIgnore([]); }
      else ref.current?.blur();
    }
  }

  const textSize = large ? 'text-base' : 'text-sm';
  const box = `${textSize} px-3 py-2 leading-6 whitespace-pre-wrap break-words`;

  return (
    <div className="relative">
      <div className={`relative rounded-lg border border-zinc-200 bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900`}>
        <div aria-hidden className={`${box} pointer-events-none absolute inset-0 overflow-hidden`}>
          <Highlighted text={text} tokens={tokens} />
        </div>
        <textarea
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          spellCheck={false}
          placeholder={placeholder ?? 'Nueva tarea: mañana llamar a @Diana #proyecto !1 ~30m'}
          aria-label="Capturar tarea"
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className={`${box} relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-zinc-900 outline-none placeholder:text-zinc-400 dark:caret-zinc-100`}
        />
      </div>

      {showSuggestions && (
        <ul role="listbox" className="absolute z-20 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => { e.preventDefault(); accept(s); }}
              onMouseEnter={() => setSelected(i)}
              className={`cursor-pointer px-3 py-1 ${i === selected ? 'bg-indigo-50 dark:bg-indigo-900/40' : ''}`}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {parsed.length > 0 && !showSuggestions && (
        <Preview
          parsed={parsed}
          today={today}
          defaults={defaults}
          onRemove={(t) => setIgnore((xs) => [...xs, tokenKey(t)])}
        />
      )}
    </div>
  );
}

/** Copia visual del texto con los tokens coloreados (va detrás del textarea transparente). */
function Highlighted({ text, tokens }: { text: string; tokens: Token[] }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const t of tokens) {
    if (t.start > pos) parts.push(text.slice(pos, t.start));
    parts.push(<mark key={t.start} className={`rounded-sm ${TOKEN_STYLE[t.kind]}`}>{text.slice(t.start, t.end)}</mark>);
    pos = t.end;
  }
  parts.push(text.slice(pos));
  // Espacio final para que un salto de línea al final tenga altura.
  return <>{parts}{' '}</>;
}

function destination(p: ParsedTask, defaults?: Partial<NewTask>): string | null {
  if (p.due_date || defaults?.due_date || p.project || defaults?.project_id) return null;
  return 'la bandeja';
}

function Preview({ parsed, today, defaults, onRemove }: {
  parsed: ParsedTask[];
  today: string;
  defaults?: Partial<NewTask>;
  onRemove: (t: Token) => void;
}) {
  return (
    <ul className="mt-2 space-y-1.5 text-sm">
      {parsed.map((p, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5">
          {parsed.length > 1 && <span className="text-xs text-zinc-400">{i + 1}.</span>}
          <span className={p.title ? '' : 'text-amber-600 italic'}>{p.title || 'Falta el título'}</span>
          {p.tokens.map((t) => (
            <Chip key={t.start} kind={t.kind} onRemove={() => onRemove(t)}>{chipLabel(t, p, today)}</Chip>
          ))}
          {destination(p, defaults) && <span className="text-xs text-zinc-400">→ Bandeja</span>}
        </li>
      ))}
    </ul>
  );
}

function chipLabel(t: Token, p: ParsedTask, today: string): string {
  switch (t.kind) {
    case 'date': return `📅 ${formatDay(p.due_date!, today)}`;
    case 'recurrence': return `↻ ${describeRule(p.recurrence!)}${p.tokens.some((x) => x.kind === 'date') ? '' : ` · desde ${formatDay(p.due_date!, today).toLowerCase()}`}`;
    case 'project': return p.project?.id ? `#${p.project.name}` : `#${p.project?.name} (nuevo)`;
    case 'person': return t.text;
    case 'priority': return `Prioridad ${p.priority}`;
    case 'estimate': return `~${formatMinutes(p.estimated_minutes!)}`;
    case 'tag': return t.text;
  }
}

function Chip({ kind, children, onRemove }: { kind: TokenKind; children: ReactNode; onRemove: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs ${TOKEN_STYLE[kind]}`}>
      {children}
      <button
        type="button"
        tabIndex={-1}
        title="Descartar: tratar como texto"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="rounded-full px-1 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}
