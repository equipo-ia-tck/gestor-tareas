import { useApp } from '../../app/AppContext';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { repo } from '../../data/services';
import { STALE_DAYS, staleTasks } from '../../domain/maintenance';
import type { Task } from '../../domain/types';
import { useTaskActions } from '../../hooks/useTaskActions';

/** Propuestas para archivar: nunca se archivan solas. */
export function StaleBlock() {
  const { tasks, today, projectMap, editTask } = useApp();
  const { update } = useTaskActions();
  const stale = staleTasks(tasks, today);
  if (!stale.length) return null;

  const archive = (ts: Task[]) => update(ts, { status: 'archived' }, 'Tarea archivada');
  // "Mantener" solo actualiza last_touched_at (lo hace el repositorio en cualquier actualización).
  const keep = (ts: Task[]) => repo.batch(ts.length === 1 ? 'Tarea mantenida' : `${ts.length} tareas mantenidas`, async () => {
    for (const t of ts) await repo.updateTask(t.id, {});
  });

  return (
    <Section
      collapsible
      defaultOpen={false}
      title={`Sin tocar desde hace más de ${STALE_DAYS} días · ${stale.length}`}
      aside={<span className="flex gap-1">
        <SmallButton onClick={() => void archive(stale)}>Archivar todas</SmallButton>
        <SmallButton onClick={() => void keep(stale)}>Mantener todas</SmallButton>
      </span>}
    >
      <p className="px-2 pb-1 text-xs text-zinc-500 dark:text-zinc-400">¿Siguen siendo importantes? Archívalas o mantenlas; nada se archiva solo.</p>
      <TaskList
        tasks={stale}
        today={today}
        projects={projectMap}
        onEdit={editTask}
        extra={(t) => (
          <>
            <SmallButton onClick={() => void archive([t])}>Archivar</SmallButton>
            <SmallButton onClick={() => void keep([t])}>Mantener</SmallButton>
          </>
        )}
      />
    </Section>
  );
}
