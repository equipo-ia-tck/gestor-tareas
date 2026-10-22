import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { CaptureGuide } from '../capture/CaptureGuide';
import { QuickAdd } from '../../components/QuickAdd';
import { SmallButton, TaskList } from '../../components/TaskList';
import { addDays } from '../../domain/dates';
import { inboxTasks } from '../../domain/selectors';
import { useTaskActions } from '../../hooks/useTaskActions';
import { ViewHeader } from './ViewHeader';

export function InboxView() {
  const { tasks, today, projectMap, editTask } = useApp();
  const { reschedule } = useTaskActions();
  const inbox = inboxTasks(tasks);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);

  return (
    <>
      <ViewHeader title="Bandeja" subtitle="Tareas sin fecha ni proyecto" />
      <QuickAdd seed={seed} />
      <CaptureGuide onExample={(text) => setSeed({ text, n: Date.now() })} />
      <TaskList
        tasks={inbox}
        today={today}
        projects={projectMap}
        onEdit={editTask}
        empty="La bandeja está vacía."
        extra={(t) => (
          <>
            <SmallButton onClick={() => void reschedule([t], today)}>Hoy</SmallButton>
            <SmallButton onClick={() => void reschedule([t], addDays(today, 1))}>Mañana</SmallButton>
          </>
        )}
      />
    </>
  );
}
