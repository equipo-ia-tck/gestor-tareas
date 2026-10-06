import { useApp } from '../../app/AppContext';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, TaskList } from '../../components/TaskList';
import { formatDay, formatMinutes } from '../../domain/dates';
import { overdueTasks, weekPlan } from '../../domain/selectors';
import { LoadBar } from './LoadBar';
import { ViewHeader } from './ViewHeader';

export function WeekView() {
  const { tasks, today, projectMap, settings, editTask } = useApp();
  const plan = weekPlan(tasks, today, settings);
  const overdue = overdueTasks(tasks, today).length;
  const totalLoad = plan.reduce((s, d) => s + d.load, 0);
  const totalCap = plan.reduce((s, d) => s + d.capacity, 0);

  return (
    <>
      <ViewHeader
        title="Próximos 7 días"
        subtitle={`${formatMinutes(totalLoad)} estimados de ${formatMinutes(totalCap)} disponibles${overdue ? ` · ${overdue} atrasadas en Hoy` : ''}`}
      />
      <QuickAdd placeholder="Añadir tarea: el jueves preparar demo ~2h" />
      {plan.map((day) => (
        <Section
          key={day.date}
          title={`${formatDay(day.date, today)}${day.tasks.length ? ` · ${day.tasks.length}` : ''}`}
          aside={<LoadBar load={day.load} capacity={day.capacity} />}
        >
          <TaskList tasks={day.tasks} today={today} projects={projectMap} onEdit={editTask} hideDate empty="—" />
        </Section>
      ))}
    </>
  );
}
