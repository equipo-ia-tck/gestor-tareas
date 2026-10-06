import { useApp } from '../../app/AppContext';
import { routeHref } from '../../app/router';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, TaskList } from '../../components/TaskList';
import { isActive, peopleIndex, samePerson, sortTasks } from '../../domain/selectors';
import { ViewHeader } from './ViewHeader';

export function PeopleView() {
  const { tasks } = useApp();
  const people = peopleIndex(tasks);
  return (
    <>
      <ViewHeader title="Personas" subtitle="Personas mencionadas en tareas pendientes" />
      <ul>
        {people.map((p) => (
          <li key={p.name}>
            <a href={routeHref({ view: 'person', name: p.name })} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="flex-1">@{p.name}</span>
              <span className="text-xs text-zinc-400">{p.count}</span>
            </a>
          </li>
        ))}
      </ul>
      {people.length === 0 && (
        <p className="px-2 text-sm text-zinc-400">Aún no hay personas. Escribe @nombre al capturar una tarea.</p>
      )}
    </>
  );
}

export function PersonView({ name }: { name: string }) {
  const { tasks, today, projectMap, editTask } = useApp();
  const mine = tasks.filter((t) => t.people.some((p) => samePerson(p, name)));
  const active = sortTasks(mine.filter(isActive));
  const done = mine.filter((t) => t.status === 'done');
  const list = { today, projects: projectMap, onEdit: editTask };

  return (
    <>
      <ViewHeader title={`@${name}`} subtitle={`${active.length} pendientes`} />
      <QuickAdd defaults={{ people: [name] }} placeholder={`Añadir tarea con ${name}`} />
      <Section title="Pendientes">
        <TaskList {...list} tasks={active} empty="Nada pendiente con esta persona." />
      </Section>
      {done.length > 0 && (
        <Section title={`Completadas · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList {...list} tasks={done} />
        </Section>
      )}
    </>
  );
}
