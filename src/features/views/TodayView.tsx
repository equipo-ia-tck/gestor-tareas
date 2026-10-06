import { useApp } from '../../app/AppContext';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { addDays, formatMinutes, parseISODate, weekdayName } from '../../domain/dates';
import { completedOn, overdueTasks, tasksDueOn, totalMinutes } from '../../domain/selectors';
import { useTaskActions } from '../../hooks/useTaskActions';
import { LoadBar } from './LoadBar';
import { ViewHeader } from './ViewHeader';

export function TodayView() {
  const { tasks, today, projectMap, settings, editTask } = useApp();
  const { reschedule, moveIds } = useTaskActions();
  const overdue = overdueTasks(tasks, today);
  const dueToday = tasksDueOn(tasks, today);
  const done = completedOn(tasks, today);
  const load = totalMinutes(dueToday);
  const d = parseISODate(today);
  const list = { today, projects: projectMap, onEdit: editTask };

  return (
    <>
      <ViewHeader
        title="Hoy"
        subtitle={`${weekdayName(today, true)} ${d.getDate()} de ${d.toLocaleDateString('es-ES', { month: 'long' })}`}
      />
      <QuickAdd defaults={{ due_date: today }} placeholder="Añadir para hoy… (#proyecto @persona !1 ~30m)" />

      {overdue.length > 0 && (
        <Section title={`Se te quedaron atrás · ${overdue.length}`}>
          <TaskList
            {...list}
            tasks={overdue}
            extra={(t) => (
              <>
                <SmallButton onClick={() => void reschedule([t], today)}>Hoy</SmallButton>
                <SmallButton onClick={() => void reschedule([t], addDays(today, 1))}>Mañana</SmallButton>
              </>
            )}
          />
        </Section>
      )}

      <Section
        title={`Para hoy · ${dueToday.length}`}
        aside={<LoadBar load={load} capacity={settings.capacity_minutes} />}
        onDropTasks={(ids) => void moveIds(ids, { due_date: today }, 'Movida a hoy')}
      >
        <TaskList {...list} tasks={dueToday} hideDate empty="Nada previsto para hoy." />
      </Section>

      {done.length > 0 && (
        <Section title={`Completadas hoy · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList {...list} tasks={done} hideDate />
        </Section>
      )}
      {load > settings.capacity_minutes && (
        <p className="px-2 text-xs text-amber-600 dark:text-amber-400">
          Hoy tienes {formatMinutes(load)} estimados y tu capacidad es de {formatMinutes(settings.capacity_minutes)}.
        </p>
      )}
    </>
  );
}
