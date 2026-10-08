import { useApp } from '../../app/AppContext';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { addDays } from '../../domain/dates';
import { nextMonday } from '../../domain/maintenance';
import { overdueTasks } from '../../domain/selectors';
import { useTaskActions } from '../../hooks/useTaskActions';
import { useCommandCenter } from '../command/CommandCenter';

/** Las vencidas no se acumulan en rojo: se agrupan aquí con acciones de un clic. */
export function OverdueBlock() {
  const { tasks, today, projectMap, editTask } = useApp();
  const { reschedule, remove } = useTaskActions();
  const { open } = useCommandCenter();
  // Las atrasadas que ya elegiste para Mi día no se repiten aquí.
  const overdue = overdueTasks(tasks, today).filter((t) => t.my_day !== today);
  if (!overdue.length) return null;

  return (
    <Section
      title={`Se te quedaron atrás · ${overdue.length}`}
      aside={
        <span className="flex gap-1">
          <SmallButton onClick={() => void reschedule(overdue, today)}>Todas a hoy</SmallButton>
          <SmallButton title="Repartir en los próximos días según tu capacidad" onClick={() => open({ kind: 'distribute' })}>Repartir…</SmallButton>
        </span>
      }
    >
      <TaskList
        tasks={overdue}
        today={today}
        projects={projectMap}
        onEdit={editTask}
        extra={(t) => (
          <>
            <SmallButton onClick={() => void reschedule([t], today)}>Hoy</SmallButton>
            <SmallButton onClick={() => void reschedule([t], addDays(today, 1))}>Mañana</SmallButton>
            <SmallButton title="El lunes que viene" onClick={() => void reschedule([t], nextMonday(today))}>Semana que viene</SmallButton>
            <SmallButton onClick={() => void reschedule([t], null)}>Sin fecha</SmallButton>
            <SmallButton onClick={() => void remove([t])}>Eliminar</SmallButton>
          </>
        )}
      />
    </Section>
  );
}
