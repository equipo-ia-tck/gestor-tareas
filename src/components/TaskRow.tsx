import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { formatDay, formatMinutes } from '../domain/dates';
import { describeRule } from '../domain/recurrence';
import type { ISODate, Project, Task } from '../domain/types';
import { useSelection, type EditableField } from '../features/selection/SelectionContext';
import { useTaskActions } from '../hooks/useTaskActions';
import { setDraggedTasks } from '../hooks/useTaskDrop';
import { FieldEditor } from './FieldEditor';

const PRIORITY_RING: Record<number, string> = {
  1: 'border-red-500',
  2: 'border-orange-400',
  3: 'border-sky-500',
  4: 'border-zinc-300 dark:border-zinc-600',
};

interface Props {
  task: Task;
  today: ISODate;
  projects: Map<string, Project>;
  onEdit: (task: Task) => void;
  hideDate?: boolean;
  hideProject?: boolean;
  /** Botones extra a la derecha (p. ej. "Hoy" en atrasadas). */
  extra?: ReactNode;
}

const INTERACTIVE = 'button, input, select, textarea, a, [role="listbox"]';

/**
 * Fila de tarea. Clic selecciona (Shift: rango, Cmd/Ctrl: añadir), doble clic edita el campo
 * bajo el ratón, se puede arrastrar (con toda la selección) a días, proyectos o la bandeja.
 */
export function TaskRow({ task, today, projects, onEdit, hideDate, hideProject, extra }: Props) {
  const { selected, focused, editing, click, startEdit, stopEdit, targetsFor } = useSelection();
  const { toggleDone, remove, update } = useTaskActions();
  const done = task.status === 'done';
  const project = task.project_id ? projects.get(task.project_id) : undefined;
  const late = !done && task.due_date !== null && task.due_date < today;
  const isSelected = selected.has(task.id);
  const isFocused = focused === task.id;
  const editField = editing?.id === task.id ? editing.field : null;

  function onClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    click(task.id, e);
  }

  function onDoubleClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    const field = (e.target as HTMLElement).closest<HTMLElement>('[data-field]')?.dataset.field as EditableField | undefined;
    startEdit(task.id, field ?? 'title');
  }

  const chip = (field: EditableField, content: ReactNode, className = '') => (
    <span data-field={field} title="Doble clic para editar" className={`cursor-default rounded px-0.5 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 ${className}`}>
      {content}
    </span>
  );

  return (
    <li
      data-task-id={task.id}
      aria-selected={isSelected}
      draggable={!editField}
      onDragStart={(e) => setDraggedTasks(e, targetsFor(task.id).map((t) => t.id))}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`group flex items-start gap-3 border-b border-zinc-100 px-2 py-1.5 select-none last:border-0 dark:border-zinc-800
        ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}
        ${isFocused ? 'shadow-[inset_2px_0_0_0] shadow-indigo-500' : ''}`}
    >
      <button
        aria-label={done ? 'Marcar como pendiente' : 'Completar'}
        onClick={() => void toggleDone(isSelected ? targetsFor(task.id) : [task])}
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${PRIORITY_RING[task.priority]} ${done ? 'bg-zinc-400 dark:bg-zinc-500' : ''}`}
      >
        {done && <span className="text-[9px] leading-none text-white">✓</span>}
      </button>

      <div className="min-w-0 flex-1">
        {editField === 'title' ? (
          <TitleEditor task={task} onSave={(title) => { stopEdit(); if (title && title !== task.title) void update([task], { title }, 'Título cambiado'); }} onCancel={stopEdit} />
        ) : (
          <div data-field="title" className={`text-sm ${done ? 'text-zinc-400 line-through' : ''}`}>
            {task.title || <em className="text-zinc-400">Sin título</em>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
          {!hideDate && task.due_date && chip('date', formatDay(task.due_date, today), late ? 'text-amber-600 dark:text-amber-400' : '')}
          {task.recurrence_rule && <span title={describeRule(task.recurrence_rule)}>↻</span>}
          {!hideProject && project && chip('project', <><span style={{ color: project.color }}>#</span>{project.name}</>)}
          {task.people.length > 0 && chip('people', task.people.map((p) => `@${p}`).join(' '))}
          {task.tags.length > 0 && chip('tags', task.tags.map((t) => `+${t}`).join(' '))}
          {task.estimated_minutes ? chip('estimate', `~${formatMinutes(task.estimated_minutes)}`) : null}
          {task.notes && <span title={task.notes}>≡</span>}
        </div>
        {editField && editField !== 'title' && (
          <FieldEditor task={task} field={editField} targets={targetsFor(task.id)} onClose={stopEdit} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        {extra}
        <button aria-label="Editar todo" title="Editar todo (E)" onClick={() => onEdit(task)}
          className="rounded px-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200">
          ⋯
        </button>
        <button aria-label="Eliminar" title="Eliminar (Supr)" onClick={() => void remove(isSelected ? targetsFor(task.id) : [task])}
          className="rounded px-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700">
          ×
        </button>
      </div>
    </li>
  );
}

function TitleEditor({ task, onSave, onCancel }: { task: Task; onSave: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(task.title);
  // Evita que el blur al desmontar guarde después de cancelar con Esc.
  const closed = useRef(false);
  const finish = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (save) onSave(value.trim()); else onCancel();
  };
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onFocus={(e) => e.currentTarget.select()}
      className="w-full rounded border border-indigo-400 bg-white px-1 text-sm outline-none ring-1 ring-indigo-400 dark:bg-zinc-900"
    />
  );
}
