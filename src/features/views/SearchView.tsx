import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { TaskList } from '../../components/TaskList';
import { isEmptySearch, matchesSearch, parseSearch } from '../../domain/search';
import { sortTasks } from '../../domain/selectors';
import { ViewHeader } from './ViewHeader';
import { Section } from '../../components/TaskList';
import { formatDay } from '../../domain/dates';
import { matchesNote, noteExcerpt, sortNotes } from '../../domain/notes';

export function SearchView({ q }: { q: string }) {
  const { tasks, notes, today, projectMap, editTask } = useApp();
  const query = useMemo(() => parseSearch(q), [q]);
  const results = useMemo(
    () => (isEmptySearch(query) ? [] : sortTasks(tasks.filter((t) => matchesSearch(t, query, projectMap)))),
    [tasks, query, projectMap],
  );

  // Las notas se buscan por palabras (los filtros #, @ y + son de tareas).
  const noteHits = query.words.length ? sortNotes(notes.filter((n) => matchesNote(n, query.words))) : [];

  return (
    <>
      <ViewHeader
        title="Buscar"
        subtitle={isEmptySearch(query) ? 'Escribe en el buscador de la izquierda' : `${results.length} resultado${results.length === 1 ? '' : 's'} para «${q}»`}
      />
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Filtra con <code>#proyecto</code>, <code>@persona</code> o <code>+etiqueta</code>. Añade <code>todas:</code> para incluir completadas.
      </p>
      <TaskList tasks={results} today={today} projects={projectMap} onEdit={editTask} empty={isEmptySearch(query) || noteHits.length ? undefined : 'Nada coincide.'} />
      {noteHits.length > 0 && (
        <div className="mt-6">
          <Section title={`Notas · ${noteHits.length}`}>
            <ul>
              {noteHits.map((n) => (
                <li key={n.id}><a href={`#/notes/${n.id}`} className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <span className="truncate">{n.title || 'Sin título'} <span className="text-xs text-zinc-400">{noteExcerpt(n)}</span></span>
                  <span className="shrink-0 text-xs text-zinc-400">{formatDay(n.date, today)}</span>
                </a></li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </>
  );
}
