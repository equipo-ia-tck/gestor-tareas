import { useApp } from '../../app/AppContext';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, TaskList } from '../../components/TaskList';
import { formatMinutes, isWorkday, parseISODate, weekdayName } from '../../domain/dates';
import { completedOn, tasksDueOn, totalMinutes } from '../../domain/selectors';
import { useTaskActions } from '../../hooks/useTaskActions';
import { OverdueBlock } from '../maintenance/OverdueBlock';
import { StaleBlock } from '../maintenance/StaleBlock';
import { LoadBar } from './LoadBar';
import { ViewHeader } from './ViewHeader';

export function TodayView() {
  const { tasks, today, projectMap, settings, editTask } = useApp();
  const { moveIds } = useTaskActions();
  const dueToday = tasksDueOn(tasks, today);
  const done = completedOn(tasks, today);
  const load = totalMinutes(dueToday);
  const capacity = isWorkday(today, settings.workdays) ? settings.capacity_minutes : 0;
  const d = parseISODate(today);
  const list = { today, projects: projectMap, onEdit: editTask };

  return (
    <>
      <ViewHeader
        title="Hoy"
        subtitle={`${weekdayName(today, true)} ${d.getDate()} de ${d.toLocaleDateString('es-ES', { month: 'long' })}`}
      />
      <QuickAdd defaults={{ due_date: today }} placeholder="Añadir para hoy… (#proyecto @persona !1 ~30m)" />

      <OverdueBlock />

      <Section
        title={`Para hoy · ${dueToday.length}`}
        aside={<LoadBar load={load} capacity={capacity} />}
        onDropTasks={(ids) => void moveIds(ids, { due_date: today }, 'Movida a hoy')}
      >
        <TaskList {...list} tasks={dueToday} hideDate empty="Nada previsto para hoy." />
        {capacity > 0 && load > capacity && (
          <p className="px-2 pt-1 text-xs text-amber-600 dark:text-amber-400">
            Hoy tienes {formatMinutes(load)} estimados y tu capacidad es de {formatMinutes(capacity)}.
          </p>
        )}
      </Section>

      {done.length > 0 && (
        <Section title={`Completadas hoy · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList {...list} tasks={done} hideDate />
        </Section>
      )}

      <StaleBlock />
    </>
  );
}
