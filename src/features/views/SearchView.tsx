import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { TaskList } from '../../components/TaskList';
import { isEmptySearch, matchesSearch, parseSearch } from '../../domain/search';
import { sortTasks } from '../../domain/selectors';
import { ViewHeader } from './ViewHeader';

export function SearchView({ q }: { q: string }) {
  const { tasks, today, projectMap, editTask } = useApp();
  const query = useMemo(() => parseSearch(q), [q]);
  const results = useMemo(
    () => (isEmptySearch(query) ? [] : sortTasks(tasks.filter((t) => matchesSearch(t, query, projectMap)))),
    [tasks, query, projectMap],
  );

  return (
    <>
      <ViewHeader
        title="Buscar"
        subtitle={isEmptySearch(query) ? 'Escribe en el buscador de la izquierda' : `${results.length} resultado${results.length === 1 ? '' : 's'} para «${q}»`}
      />
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Filtra con <code>#proyecto</code>, <code>@persona</code> o <code>+etiqueta</code>. Añade <code>todas:</code> para incluir completadas.
      </p>
      <TaskList tasks={results} today={today} projects={projectMap} onEdit={editTask} empty={isEmptySearch(query) ? undefined : 'Nada coincide.'} />
    </>
  );
}
