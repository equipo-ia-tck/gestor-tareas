import type { ReactNode } from 'react';
import { formatDay, formatMinutes } from '../domain/dates';
import type { ISODate, Project, Task } from '../domain/types';
import { routeHref } from '../app/router';
import { useTaskActions } from '../hooks/useTaskActions';

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

export function TaskRow({ task, today, projects, onEdit, hideDate, hideProject, extra }: Props) {
  const { toggleDone, remove } = useTaskActions();
  const done = task.status === 'done';
  const project = task.project_id ? projects.get(task.project_id) : undefined;
  const late = !done && task.due_date !== null && task.due_date < today;

  return (
    <li className="group flex items-start gap-3 border-b border-zinc-100 px-2 py-1.5 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
      <button
        aria-label={done ? 'Marcar como pendiente' : 'Completar'}
        onClick={() => void toggleDone(task)}
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${PRIORITY_RING[task.priority]} ${done ? 'bg-zinc-400 dark:bg-zinc-500' : ''}`}
      >
        {done && <span className="text-[9px] leading-none text-white">✓</span>}
      </button>

      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onEdit(task)}>
        <div className={`text-sm ${done ? 'text-zinc-400 line-through' : ''}`}>{task.title || <em className="text-zinc-400">Sin título</em>}</div>
        <div className="flex flex-wrap items-center gap-x-2.5 text-xs text-zinc-500 dark:text-zinc-400">
          {!hideDate && task.due_date && (
            <span className={late ? 'text-amber-600 dark:text-amber-400' : ''}>{formatDay(task.due_date, today)}</span>
          )}
          {task.recurrence_rule && <span title="Recurrente">↻</span>}
          {!hideProject && project && (
            <a href={routeHref({ view: 'project', id: project.id })} onClick={(e) => e.stopPropagation()} className="hover:underline">
              <span style={{ color: project.color }}>#</span>{project.name}
            </a>
          )}
          {task.people.map((p) => (
            <a key={p} href={routeHref({ view: 'person', name: p })} onClick={(e) => e.stopPropagation()} className="hover:underline">@{p}</a>
          ))}
          {task.tags.map((t) => <span key={t}>+{t}</span>)}
          {task.estimated_minutes ? <span>~{formatMinutes(task.estimated_minutes)}</span> : null}
          {task.notes && <span title={task.notes}>≡</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        {extra}
        <button
          aria-label="Eliminar"
          title="Eliminar"
          onClick={() => void remove(task)}
          className="rounded px-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"
        >
          ×
        </button>
      </div>
    </li>
  );
}
