import { MessageSquareText } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Section } from '../../components/TaskList';
import { ExternalChip, StatePill, TypeBadge } from '../../components/ui/Badges';
import { formatDay } from '../../domain/dates';
import { notesByTask } from '../../domain/notes';
import { findType, stateOf } from '../../domain/workflows';
import { Markdown } from './Markdown';

/** Notas de las US, TS y tareas de un proyecto, agrupadas por elemento y ordenadas por fecha. */
export function ItemNotes({ taskIds }: { taskIds: Set<string> }) {
  const { tasks, notes, itemTypes, today, editTask } = useApp();
  const groups = notesByTask(taskIds, notes);
  const total = groups.reduce((s, g) => s + g.notes.length, 0);
  return (
    <Section title={<span className="inline-flex items-center gap-1.5"><MessageSquareText className="size-3.5" />Notas por elemento · {total}</span>} collapsible defaultOpen={total > 0}>
      {!groups.length && <p className="px-2 py-2 text-sm text-zinc-400">Las notas que añadas en el panel de una US, TS o tarea aparecerán aquí, agrupadas por elemento.</p>}
      <div className="space-y-3">
        {groups.map(({ taskId, notes: list }) => {
          const task = tasks.find((t) => t.id === taskId);
          if (!task) return null;
          const type = findType(itemTypes, task.type_id);
          return (
            <article key={taskId} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <TypeBadge type={type} />
                <ExternalChip task={task} type={type} />
                <button type="button" onClick={() => editTask(task)} className={`min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline ${task.status === 'done' ? 'text-zinc-400 line-through' : ''}`}>
                  {task.title}
                </button>
                <StatePill state={stateOf(itemTypes, task)} />
                <span className="text-xs text-zinc-400">{list.length} nota{list.length === 1 ? '' : 's'}</span>
              </header>
              <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {list.map((n) => (
                  <li key={n.id} className="grid grid-cols-[88px_1fr] gap-3 px-3 py-2">
                    <a href={`#/notes/${n.id}`} className="pt-0.5 text-xs text-zinc-500 hover:underline">{formatDay(n.date, today)}</a>
                    <div className="min-w-0"><Markdown text={n.body} /></div>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
