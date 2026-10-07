import { useApp } from '../../app/AppContext';
import { useWideLayout } from '../../app/Layout';
import { usePersistentState } from '../../hooks/usePersistentState';
import { findType } from '../../domain/workflows';
import { ViewHeader } from '../views/ViewHeader';
import { Board, TypeTabs } from './Board';

/** Tablero global: todas las tareas de todos los proyectos, filtrables por proyecto. */
export function BoardView() {
  useWideLayout(true);
  const { tasks, projects, itemTypes, releases } = useApp();
  const [releaseFilter, setReleaseFilter] = usePersistentState<string>('board-release', '');
  const [typeId, setTypeId] = usePersistentState('board-type', 'task');
  const [projectFilter, setProjectFilter] = usePersistentState<string[]>('board-projects', []);
  const visible = tasks
    .filter((t) => !projectFilter.length || (t.project_id && projectFilter.includes(t.project_id)))
    .filter((t) => !releaseFilter || t.release_id === releaseFilter);
  const toggle = (id: string) => setProjectFilter(projectFilter.includes(id) ? projectFilter.filter((x) => x !== id) : [...projectFilter, id]);

  return (
    <>
      <ViewHeader title="Tablero" subtitle="Arrastra las tarjetas entre columnas para cambiar su estado" actions={<TypeTabs value={typeId} onChange={setTypeId} tasks={visible} />} />
      {projects.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">Proyectos:</span>
          <button type="button" onClick={() => setProjectFilter([])}
            className={`rounded-full px-2.5 py-0.5 text-xs ${!projectFilter.length ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
            Todos
          </button>
          {projects.map((p) => {
            const on = projectFilter.includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${on ? 'font-medium' : 'border-transparent bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                style={on ? { borderColor: p.color, color: p.color } : undefined}>
                <span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}
              </button>
            );
          })}
        </div>
      )}
      {releases.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Release:</span>
          <select value={releaseFilter} onChange={(e) => setReleaseFilter(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todas</option>
            {releases.map((r) => <option key={r.id} value={r.id}>{r.name}{r.status !== 'planned' ? ' (cerrada)' : ''}</option>)}
          </select>
        </div>
      )}
      <Board tasks={visible} type={findType(itemTypes, typeId)} defaults={releaseFilter ? { release_id: releaseFilter } : undefined} />
    </>
  );
}
