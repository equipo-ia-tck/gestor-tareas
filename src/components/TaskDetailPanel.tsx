import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  AlignLeft, Calendar, Check, CheckSquare, Clock, Flag, Folder, GripVertical, Plus, Repeat, Tag, Trash2, User, X,
} from 'lucide-react';
import { useApp } from '../app/AppContext';
import { repo } from '../data/services';
import { LABEL_COLORS, labelColor } from '../domain/colors';
import { formatDay, formatMinutes } from '../domain/dates';
import { describeRule } from '../domain/recurrence';
import { knownPeople } from '../domain/selectors';
import { fuzzyScore, nameKey } from '../domain/text';
import type { ChecklistItem, Priority, Task } from '../domain/types';
import { findType, stateOf } from '../domain/workflows';
import { parseDateText, parseEstimateText } from '../parser/fields';
import { isEditable } from '../features/command/CommandCenter';
import { Avatar, LabelChip, PRIORITY_COLOR, PRIORITY_LABEL, StatePill } from './ui/Badges';
import { MenuItem, Popover } from './ui/Popover';

const fieldBox = 'rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800';
const inputBox = 'w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900';

/** Panel lateral con todos los campos de la tarea (al estilo Asana). Cada cambio se guarda y se puede deshacer. */
export function TaskDetailPanel() {
  const { tasks, detailId, closeDetail } = useApp();
  const task = tasks.find((t) => t.id === detailId);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !isEditable(e.target) && !document.querySelector('[role="dialog"]')) closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDetail]);

  if (!task) return null;
  return <PanelBody key={task.id} task={task} onClose={closeDetail} />;
}

function PanelBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const { itemTypes, today } = useApp();
  const type = findType(itemTypes, task.type_id);
  const state = stateOf(itemTypes, task);
  const update = (patch: Partial<Task>, label: string) => repo.batch(label, () => repo.updateTask(task.id, patch));

  return (
    <aside
      aria-label="Detalle de la tarea"
      // Esc dentro de un campo: primero sale del campo; un segundo Esc cierra el panel.
      onKeyDown={(e) => { if (e.key === 'Escape' && isEditable(e.target)) (e.target as HTMLElement).blur(); }}
      className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void repo.setCompleted(task.id, task.status !== 'done')}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${task.status === 'done' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-zinc-300 hover:border-emerald-500 hover:text-emerald-700 dark:border-zinc-600'}`}
        >
          <Check className="size-3.5" />{task.status === 'done' ? 'Completada' : 'Marcar como completada'}
        </button>
        <div className="flex-1" />
        <button type="button" title="Eliminar" onClick={() => { void repo.deleteTask(task.id); onClose(); }}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"><Trash2 className="size-4" /></button>
        <button type="button" title="Cerrar (Esc)" onClick={onClose}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="size-4" /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Tipo y estado */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
            {itemTypes.map((t) => (
              <button key={t.id} type="button" onClick={() => void repo.setType(task.id, t.id)}
                className={`rounded px-2 py-0.5 text-xs font-medium ${t.id === type.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                style={t.id === type.id ? { background: t.color } : undefined}>
                {t.short || t.name}
              </button>
            ))}
          </div>
          <Popover trigger={(toggle) => <StatePill state={state} onClick={toggle} />}>
            {(close) => type.states.map((s) => (
              <MenuItem key={s.id} active={s.id === state.id} onClick={() => { close(); void repo.setState(task.id, s.id); }}>
                <span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}
                {s.id === state.id && <Check className="ml-auto size-3.5" />}
              </MenuItem>
            ))}
          </Popover>
        </div>

        <TitleField task={task} />

        {/* Propiedades */}
        <dl className="mt-3 grid grid-cols-[110px_1fr] items-center gap-x-2 gap-y-1 text-sm">
          <Prop icon={<Calendar className="size-4" />} label="Fecha"><DateField task={task} /></Prop>
          <Prop icon={<Folder className="size-4" />} label="Proyecto"><ProjectField task={task} /></Prop>
          <Prop icon={<Flag className="size-4" />} label="Prioridad">
            <div className="flex gap-1">
              {([1, 2, 3, 4] as Priority[]).map((p) => (
                <button key={p} type="button" title={PRIORITY_LABEL[p]} onClick={() => void update({ priority: p }, `Prioridad ${p}`)}
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium ${task.priority === p ? 'text-white' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'}`}
                  style={task.priority === p ? { background: PRIORITY_COLOR[p], borderColor: PRIORITY_COLOR[p] } : undefined}>
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </Prop>
          <Prop icon={<User className="size-4" />} label="Personas"><PeopleField task={task} /></Prop>
          <Prop icon={<Tag className="size-4" />} label="Etiquetas"><LabelsField task={task} /></Prop>
          <Prop icon={<Clock className="size-4" />} label="Estimación"><EstimateField task={task} /></Prop>
          {task.recurrence_rule && (
            <Prop icon={<Repeat className="size-4" />} label="Se repite">
              <span className="flex items-center gap-2 px-2">
                {describeRule(task.recurrence_rule)}
                <button type="button" className="text-xs text-zinc-400 hover:text-red-600" onClick={() => void update({ recurrence_rule: null }, 'Recurrencia quitada')}>Quitar</button>
              </span>
            </Prop>
          )}
        </dl>

        <Section icon={<CheckSquare className="size-4" />} title="Pasos"><Checklist task={task} /></Section>
        <Section icon={<AlignLeft className="size-4" />} title="Notas"><NotesField task={task} /></Section>

        <footer className="mt-6 space-y-0.5 border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
          <p>Creada {new Date(task.created_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          {task.completed_at && <p>Completada {new Date(task.completed_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          {task.due_date && task.status === 'todo' && task.due_date < today && <p className="text-amber-600">Atrasada desde {formatDay(task.due_date, today).toLowerCase()}</p>}
          {task.raw_input && task.raw_input.trim() !== task.title && <p>Texto original: <span className="font-mono">{task.raw_input}</span></p>}
        </footer>
      </div>
    </aside>
  );
}

function Prop({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">{icon}{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{icon}{title}</h3>
      {children}
    </section>
  );
}

function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

function TitleField({ task }: { task: Task }) {
  const [value, setValue] = useState(task.title);
  const ref = useAutosize(value);
  useEffect(() => setValue(task.title), [task.title]);
  const save = () => {
    const v = value.trim();
    if (v && v !== task.title) void repo.batch('Título cambiado', () => repo.updateTask(task.id, { title: v }));
    else setValue(task.title);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setValue(task.title); e.currentTarget.blur(); } }}
      aria-label="Título"
      className={`-mx-2 w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md bg-transparent px-2 py-1 text-xl font-semibold outline-none hover:bg-zinc-50 focus:bg-zinc-50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900 ${task.status === 'done' ? 'text-zinc-400 line-through' : ''}`}
    />
  );
}

/** Campo de texto que se edita al hacer clic y se guarda con Enter o al salir. */
function InlineText({ display, initial, placeholder, parse, onSave }: {
  display: ReactNode;
  initial: string;
  placeholder: string;
  parse?: (text: string) => { ok: boolean; preview?: string };
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  if (!editing) {
    return <button type="button" className={`${fieldBox} w-full text-left`} onClick={() => { setText(initial); setEditing(true); }}>{display}</button>;
  }
  const result = parse?.(text);
  const finish = (save: boolean) => {
    setEditing(false);
    if (save && (!result || result.ok)) onSave(text);
  };
  return (
    <div className="flex items-center gap-2">
      <input autoFocus className={inputBox} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.preventDefault(); finish(false); } }} />
      {text && result?.preview && <span className={`shrink-0 text-xs ${result.ok ? 'text-emerald-600' : 'text-amber-600'}`}>{result.preview}</span>}
    </div>
  );
}

function DateField({ task }: { task: Task }) {
  const { today } = useApp();
  const late = task.status === 'todo' && task.due_date && task.due_date < today;
  return (
    <InlineText
      initial=""
      placeholder="mañana, vie, 15 oct, sin fecha…"
      display={task.due_date
        ? <span className={late ? 'text-amber-600' : ''}>{formatDay(task.due_date, today)}</span>
        : <span className="text-zinc-400">Sin fecha</span>}
      parse={(t) => {
        const r = parseDateText(t, today);
        return { ok: r.ok, preview: r.ok ? `→ ${r.value ? formatDay(r.value, today) : 'sin fecha'}` : 'No entiendo la fecha' };
      }}
      onSave={(t) => {
        if (!t.trim()) return;
        const r = parseDateText(t, today);
        if (r.ok) void repo.batch(r.value ? 'Fecha cambiada' : 'Fecha quitada', () => repo.updateTask(task.id, { due_date: r.value }));
      }}
    />
  );
}

function EstimateField({ task }: { task: Task }) {
  return (
    <InlineText
      initial={task.estimated_minutes ? `${task.estimated_minutes}m` : ''}
      placeholder="30m, 2h, 1h30…"
      display={task.estimated_minutes ? formatMinutes(task.estimated_minutes) : <span className="text-zinc-400">Sin estimar</span>}
      parse={(t) => {
        const r = parseEstimateText(t);
        return { ok: r.ok, preview: r.ok ? '' : 'Usa 30m, 2h o 1h30' };
      }}
      onSave={(t) => {
        const r = parseEstimateText(t);
        if (r.ok && r.value !== task.estimated_minutes) void repo.batch('Estimación cambiada', () => repo.updateTask(task.id, { estimated_minutes: r.value }));
      }}
    />
  );
}

function ProjectField({ task }: { task: Task }) {
  const { projects, projectMap } = useApp();
  const current = task.project_id ? projectMap.get(task.project_id) : undefined;
  const [query, setQuery] = useState('');
  const list = projects
    .map((p) => ({ p, s: fuzzyScore(query, p.name) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => b.s! - a.s!)
    .map((x) => x.p);
  const move = (id: string | null, name: string) => repo.batch(id ? `Movida a ${name}` : 'Proyecto quitado', () => repo.updateTask(task.id, { project_id: id }));
  return (
    <Popover width="w-64" trigger={(toggle) => (
      <button type="button" className={`${fieldBox} flex w-full items-center gap-2 text-left`} onClick={toggle}>
        {current ? <><span className="size-2.5 rounded-sm" style={{ background: current.color }} />{current.name}</> : <span className="text-zinc-400">Sin proyecto</span>}
      </button>
    )}>
      {(close) => (
        <>
          <input autoFocus className={`${inputBox} mb-1`} placeholder="Buscar o crear…" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (list[0]) { await move(list[0].id, list[0].name); close(); }
              else if (query.trim()) {
                await repo.batch(`Movida a ${query.trim()}`, async () => {
                  const p = await repo.createProject(query.trim());
                  await repo.updateTask(task.id, { project_id: p.id });
                });
                close();
              }
            }} />
          <div className="max-h-56 overflow-y-auto">
            {!query && <MenuItem onClick={() => { close(); void move(null, ''); }}><span className="text-zinc-400">Sin proyecto</span></MenuItem>}
            {list.map((p) => (
              <MenuItem key={p.id} active={p.id === task.project_id} onClick={() => { close(); void move(p.id, p.name); }}>
                <span className="size-2.5 rounded-sm" style={{ background: p.color }} />{p.name}
              </MenuItem>
            ))}
            {query.trim() && !projects.some((p) => nameKey(p.name) === nameKey(query)) && (
              <p className="px-2 py-1 text-xs text-zinc-400">Enter para crear «{query.trim()}»</p>
            )}
          </div>
        </>
      )}
    </Popover>
  );
}

/** Chips con buscador para añadir (personas o etiquetas). */
function ChipsField({ values, suggestions, placeholder, renderChip, onChange, addLabel }: {
  values: string[];
  suggestions: string[];
  placeholder: string;
  renderChip: (value: string, remove: () => void) => ReactNode;
  onChange: (next: string[], label: string) => void;
  addLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const options = useMemo(() => suggestions
    .filter((s) => !values.some((v) => nameKey(v) === nameKey(s)))
    .map((s) => ({ s, score: fuzzyScore(text, s) }))
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score! - a.score!)
    .slice(0, 6)
    .map((x) => x.s), [suggestions, values, text]);

  const add = (v: string) => {
    const value = v.trim().replace(/^[@+#]/, '');
    if (value && !values.some((x) => nameKey(x) === nameKey(value))) onChange([...values, value], `${addLabel} ${value}`);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(options[0] && text && fuzzyScore(text, options[0]) !== null && nameKey(options[0]).startsWith(nameKey(text)) ? options[0] : text); }
    if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setText(''); }
    if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1), 'Quitado');
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
      {values.map((v) => renderChip(v, () => onChange(values.filter((x) => x !== v), `Quitado ${v}`)))}
      {adding ? (
        <div className="relative">
          <input autoFocus className={`${inputBox} w-40`} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            onBlur={() => { if (text.trim()) add(text); setAdding(false); }} />
          {options.length > 0 && (
            <ul className="absolute z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {options.map((o) => (
                <li key={o}><button type="button" onMouseDown={(e) => { e.preventDefault(); add(o); }} className="w-full px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">{o}</button></li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
          <Plus className="size-3" />Añadir
        </button>
      )}
    </div>
  );
}

function PeopleField({ task }: { task: Task }) {
  const { tasks } = useApp();
  return (
    <ChipsField
      values={task.people}
      suggestions={knownPeople(tasks)}
      placeholder="Nombre…"
      addLabel="Añadida"
      onChange={(people, label) => void repo.batch(label, () => repo.updateTask(task.id, { people }))}
      renderChip={(name, remove) => (
        <span key={name} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1.5 pl-0.5 text-xs dark:bg-zinc-800">
          <Avatar name={name} size={18} />{name}
          <button type="button" onClick={remove} className="text-zinc-400 hover:text-zinc-700" aria-label={`Quitar ${name}`}>×</button>
        </span>
      )}
    />
  );
}

function LabelsField({ task }: { task: Task }) {
  const { tasks, labels, labelColors } = useApp();
  const all = useMemo(() => [...new Set([...labels.map((l) => l.name), ...tasks.flatMap((t) => t.tags)])], [labels, tasks]);
  return (
    <ChipsField
      values={task.tags}
      suggestions={all}
      placeholder="Etiqueta…"
      addLabel="Etiqueta"
      onChange={(tags, label) => void repo.batch(label, () => repo.updateTask(task.id, { tags }))}
      renderChip={(name, remove) => (
        <Popover key={name} width="w-auto" trigger={(toggle) => (
          <span onClick={toggle} className="cursor-pointer" title="Clic para cambiar el color"><LabelChip name={name} colors={labelColors} onRemove={remove} /></span>
        )}>
          {(close) => <ColorPalette current={labelColor(name, labelColors)} onPick={(c) => { close(); void repo.setLabelColor(name, c); }} />}
        </Popover>
      )}
    />
  );
}

export function ColorPalette({ current, onPick }: { current: string; onPick: (color: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1 p-1">
      {LABEL_COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)} aria-label={`Color ${c}`}
          className={`size-6 rounded-full ${c === current ? 'ring-2 ring-zinc-900 ring-offset-2 dark:ring-white dark:ring-offset-zinc-900' : ''}`} style={{ background: c }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Pasos

function Checklist({ task }: { task: Task }) {
  const [text, setText] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const items = task.checklist;
  const save = (checklist: ChecklistItem[], label: string) => repo.batch(label, () => repo.updateTask(task.id, { checklist }));
  const done = items.filter((i) => i.done).length;

  const add = () => {
    const t = text.trim();
    if (!t) return;
    void save([...items, { id: crypto.randomUUID(), text: t, done: false }], 'Paso añadido');
    setText('');
  };

  function onDrop(e: DragEvent, to: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === to) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(to, 0, moved);
    setDragIndex(null);
    void save(next, 'Pasos reordenados');
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="text-xs text-zinc-500">{done}/{items.length}</span>
        </div>
      )}
      <ul>
        {items.map((item, i) => (
          <li key={item.id} draggable onDragStart={() => setDragIndex(i)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)}
            className={`group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${dragIndex === i ? 'opacity-40' : ''}`}>
            <GripVertical className="size-3.5 shrink-0 cursor-grab text-zinc-300 opacity-0 group-hover:opacity-100" />
            <button type="button" aria-label={item.done ? 'Desmarcar paso' : 'Completar paso'}
              onClick={() => void save(items.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)), item.done ? 'Paso pendiente' : 'Paso completado')}
              className={`flex size-4 shrink-0 items-center justify-center rounded border ${item.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 dark:border-zinc-600'}`}>
              {item.done && <Check className="size-3" />}
            </button>
            <StepText item={item} onSave={(t) => void save(items.map((x) => (x.id === item.id ? { ...x, text: t } : x)), 'Paso editado')} />
            <button type="button" aria-label="Eliminar paso" onClick={() => void save(items.filter((x) => x.id !== item.id), 'Paso eliminado')}
              className="text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><X className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center gap-2 px-1">
        <Plus className="size-4 shrink-0 text-zinc-400" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir paso"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-zinc-400" />
      </div>
    </div>
  );
}

function StepText({ item, onSave }: { item: ChecklistItem; onSave: (text: string) => void }) {
  const [value, setValue] = useState(item.text);
  useEffect(() => setValue(item.text), [item.text]);
  return (
    <input value={value} onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value.trim() && value !== item.text) onSave(value.trim()); else setValue(item.text); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValue(item.text); e.currentTarget.blur(); } }}
      className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${item.done ? 'text-zinc-400 line-through' : ''}`} />
  );
}

function NotesField({ task }: { task: Task }) {
  const [value, setValue] = useState(task.notes);
  const ref = useAutosize(value);
  useEffect(() => setValue(task.notes), [task.notes]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={3}
      placeholder="Contexto, enlaces, lo que se habló…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value !== task.notes) void repo.batch('Notas guardadas', () => repo.updateTask(task.id, { notes: value })); }}
      className="w-full resize-none rounded-md border border-transparent bg-zinc-50 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:bg-zinc-900"
    />
  );
}
