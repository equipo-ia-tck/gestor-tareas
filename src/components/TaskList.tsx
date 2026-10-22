import { useState, type ReactNode } from 'react';
import type { ISODate, Project, Task } from '../domain/types';
import { dropHighlight, useTaskDrop } from '../hooks/useTaskDrop';
import { TaskRow } from './TaskRow';

interface Props {
  tasks: Task[];
  today: ISODate;
  projects: Map<string, Project>;
  onEdit: (task: Task) => void;
  empty?: ReactNode;
  hideDate?: boolean;
  hideProject?: boolean;
  /** Proyecto de la vista: su chip no se muestra en las filas (sí el de los subproyectos). */
  contextProjectId?: string;
  extra?: (task: Task) => ReactNode;
}

export function TaskList({ tasks, empty, extra, ...rest }: Props) {
  if (tasks.length === 0) {
    return empty ? <p className="px-2 py-3 text-sm text-zinc-400">{empty}</p> : null;
  }
  return (
    <ul>
      {tasks.map((t) => <TaskRow key={t.id} task={t} extra={extra?.(t)} {...rest} />)}
    </ul>
  );
}

export function Section({ title, aside, children, collapsible, defaultOpen = true, onDropTasks, prominent }: {
  title: ReactNode;
  /** Cabecera más visible (bloques principales de una página, como las notas de un proyecto). */
  prominent?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Si existe, se pueden soltar tareas en la sección. */
  onDropTasks?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { over, dropProps } = useTaskDrop(onDropTasks);
  return (
    <section className={`mb-6 ${over ? dropHighlight : ''}`} {...dropProps}>
      <header className={prominent
        ? 'mb-2 flex items-center justify-between gap-3 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70'
        : 'mb-1 flex items-baseline justify-between gap-3 border-b border-zinc-200 px-2 pb-1 dark:border-zinc-700'}>
        <h3
          className={`${prominent ? 'text-sm font-semibold text-zinc-800 dark:text-zinc-100' : 'text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400'} ${collapsible ? 'cursor-pointer select-none' : ''}`}
          onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        >
          {collapsible && <span className="mr-1 inline-block w-3">{open ? '▾' : '▸'}</span>}
          {title}
        </h3>
        {aside && <div className="text-xs text-zinc-500 dark:text-zinc-400">{aside}</div>}
      </header>
      {open && children}
    </section>
  );
}

/** Botón de acción visible (con borde e icono), para las acciones de una página. */
export const ActionButton = ({ onClick, children, title, icon }: { onClick: () => void; children: ReactNode; title?: string; icon?: ReactNode }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-sm text-zinc-700 shadow-sm hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
  >
    {icon}{children}
  </button>
);

export const SmallButton = ({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) => (
  <button
    title={title}
    onClick={onClick}
    className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
  >
    {children}
  </button>
);
