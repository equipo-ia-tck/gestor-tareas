import { useMemo, useState, type KeyboardEvent } from 'react';
import { AlignLeft, Calendar, Plus, Repeat } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { AvatarStack, ChecklistProgress, LabelChip, PriorityFlag, TypeBadge } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { tint } from '../../domain/colors';
import { diffDays, formatDay } from '../../domain/dates';
import { knownPeople, sortTasks } from '../../domain/selectors';
import type { ItemType, NewTask, Task, WorkflowState } from '../../domain/types';
import { findType, stateOf } from '../../domain/workflows';
import { setDraggedTasks, useTaskDrop } from '../../hooks/useTaskDrop';
import { parseCapture } from '../../parser/parseCapture';
import { submitCapture } from '../capture/submitCapture';

/** Las completadas hace más de esto no se muestran en la columna "hecho" (para no saturarla). */
const DONE_VISIBLE_DAYS = 14;

interface Props {
  tasks: Task[];
  type: ItemType;
  /** Valores para las tarjetas nuevas (p. ej. el proyecto). */
  defaults?: Partial<NewTask>;
  showProject?: boolean;
}

/** Tablero kanban: una columna por estado del tipo; arrastrar una tarjeta cambia su estado. */
export function Board({ tasks, type, defaults, showProject = true }: Props) {
  const { itemTypes, today } = useApp();
  const columns = useMemo(() => {
    const byState = new Map<string, Task[]>(type.states.map((s) => [s.id, []]));
    for (const t of tasks) {
      if (t.deleted_at || t.status === 'archived' || findType(itemTypes, t.type_id).id !== type.id) continue;
      if (t.status === 'done' && t.completed_at && diffDays(t.completed_at.slice(0, 10), today) > DONE_VISIBLE_DAYS) continue;
      byState.get(stateOf(itemTypes, t).id)?.push(t);
    }
    return type.states.map((s) => ({ state: s, tasks: sortTasks(byState.get(s.id) ?? []) }));
  }, [tasks, type, itemTypes, today]);

  return (
    <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-4">
      {columns.map(({ state, tasks: colTasks }) => (
        <Column key={state.id} state={state} type={type} tasks={colTasks} defaults={defaults} showProject={showProject} />
      ))}
    </div>
  );
}

function Column({ state, type, tasks, defaults, showProject }: {
  state: WorkflowState;
  type: ItemType;
  tasks: Task[];
  defaults?: Partial<NewTask>;
  showProject: boolean;
}) {
  const { over, dropProps } = useTaskDrop((ids) => {
    void repo.batch(ids.length === 1 ? `Movida a ${state.name}` : `${ids.length} tareas movidas a ${state.name}`, async () => {
      for (const id of ids) await repo.setState(id, state.id);
    });
  });

  return (
    <section
      {...dropProps}
      aria-label={state.name}
      className={`flex w-64 shrink-0 flex-col rounded-xl p-2 transition-colors ${over ? 'ring-2 ring-indigo-400' : ''}`}
      style={{ background: tint(state.color, over ? 0.22 : 0.1) }}
    >
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className="size-2.5 rounded-full" style={{ background: state.color }} />
        <h3 className="text-sm font-semibold">{state.name}</h3>
        <span className="text-xs text-zinc-500">{tasks.length}</span>
      </header>
      <ul className="flex min-h-8 flex-col gap-2">
        {tasks.map((t) => <Card key={t.id} task={t} showProject={showProject} />)}
      </ul>
      <AddCard state={state} type={type} defaults={defaults} />
    </section>
  );
}

function Card({ task, showProject }: { task: Task; showProject: boolean }) {
  const { itemTypes, projectMap, labelColors, today, editTask, detailId } = useApp();
  const type = findType(itemTypes, task.type_id);
  const project = task.project_id ? projectMap.get(task.project_id) : undefined;
  const done = task.status === 'done';
  const late = !done && task.due_date !== null && task.due_date < today;
  const dueToday = !done && task.due_date === today;

  return (
    <li
      draggable
      onDragStart={(e) => setDraggedTasks(e, [task.id])}
      onClick={() => editTask(task)}
      className={`cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm transition hover:shadow-md dark:bg-zinc-900
        ${detailId === task.id ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-zinc-200 dark:border-zinc-700'}`}
      style={project && showProject ? { borderLeft: `3px solid ${project.color}` } : undefined}
    >
      {task.tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">{task.tags.map((t) => <LabelChip key={t} name={t} colors={labelColors} small />)}</div>
      )}
      <p className={`flex items-start gap-1.5 text-sm leading-snug ${done ? 'text-zinc-400 line-through' : ''}`}>
        <TypeBadge type={type} />
        <span className="flex-1">{task.title}</span>
        <PriorityFlag priority={task.priority} />
      </p>
      {showProject && project && <p className="mt-1 truncate text-[11px] text-zinc-500">{project.name}</p>}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {task.due_date && (
          <span className={`inline-flex items-center gap-0.5 rounded px-1 ${late ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : dueToday ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : ''}`}>
            <Calendar className="size-3" />{formatDay(task.due_date, today)}
          </span>
        )}
        <ChecklistProgress items={task.checklist} />
        {task.notes && <AlignLeft className="size-3" />}
        {task.recurrence_rule && <Repeat className="size-3" />}
        <span className="flex-1" />
        <AvatarStack names={task.people} size={20} />
      </div>
    </li>
  );
}

function AddCard({ state, type, defaults }: { state: WorkflowState; type: ItemType; defaults?: Partial<NewTask> }) {
  const { tasks, projects, today } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  async function submit() {
    const parsed = parseCapture(text, { today, projects, people: knownPeople(tasks) }).filter((p) => p.title);
    if (!parsed.length) return;
    await repo.batch(parsed.length === 1 ? `Tarjeta creada en ${state.name}` : `${parsed.length} tarjetas creadas`, () =>
      submitCapture(parsed, { ...defaults, type_id: type.id, state_id: state.id }));
    setText('');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setText(''); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-black/5 dark:hover:bg-white/5">
        <Plus className="size-4" />Añadir tarjeta
      </button>
    );
  }
  return (
    <div className="mt-2">
      <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
        onBlur={() => { if (!text.trim()) setOpen(false); }}
        placeholder="Título… (admite mañana, @persona, !1, +etiqueta)"
        className="w-full resize-none rounded-lg border border-zinc-300 bg-white p-2 text-sm shadow-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={() => void submit()} className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500">Añadir</button>
        <button type="button" onClick={() => { setOpen(false); setText(''); }} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-black/5">Cancelar</button>
      </div>
    </div>
  );
}

/** Pestañas de tipo (Tarea / US / TS) con el número de elementos pendientes de cada uno. */
export function TypeTabs({ value, onChange, tasks }: { value: string; onChange: (id: string) => void; tasks: Task[] }) {
  const { itemTypes } = useApp();
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
      {itemTypes.map((t) => {
        const n = tasks.filter((x) => x.type_id === t.id && x.status === 'todo' && !x.deleted_at).length;
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm ${value === t.id ? 'bg-white font-medium shadow-sm dark:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
            <span className="size-2 rounded-full" style={{ background: t.color }} />{t.name}
            {n > 0 && <span className="text-xs text-zinc-400">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
