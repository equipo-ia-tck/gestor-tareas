import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useApp } from './AppContext';
import { useTaskActions } from '../hooks/useTaskActions';
import { dropHighlight, useTaskDrop } from '../hooks/useTaskDrop';
import { routeHref, type Route } from './router';
import { inboxTasks, overdueTasks, peopleIndex, tasksDueOn } from '../domain/selectors';
import { isActive } from '../domain/selectors';

function NavItem({ href, active, children, count, dot, onDropTasks }: {
  href: string; active: boolean; children: ReactNode; count?: number; dot?: string;
  onDropTasks?: (ids: string[]) => void;
}) {
  const { over, dropProps } = useTaskDrop(onDropTasks);
  return (
    <a
      href={href}
      {...dropProps}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${over ? dropHighlight : active ? 'bg-zinc-200 font-medium dark:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60'}`}
    >
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      <span className="flex-1 truncate">{children}</span>
      {count ? <span className="text-xs text-zinc-400">{count}</span> : null}
    </a>
  );
}

const Heading = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className="mt-5 mb-1 block px-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase hover:text-zinc-600 dark:hover:text-zinc-200">
    {children}
  </a>
);

export function Sidebar({ route }: { route: Route }) {
  const { tasks, projects, today } = useApp();
  const is = (v: Route['view']) => route.view === v;
  const people = peopleIndex(tasks).slice(0, 8);
  const { moveIds } = useTaskActions();
  const [query, setQuery] = useState(route.view === 'search' ? route.q : '');

  useEffect(() => { if (route.view !== 'search') setQuery(''); }, [route.view]);

  function search(e: FormEvent) {
    e.preventDefault();
  }
  function onQuery(q: string) {
    setQuery(q);
    window.location.replace(routeHref(q ? { view: 'search', q } : { view: 'today' }));
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-3 px-2 text-sm font-semibold">✓ Tareas</div>
      <form onSubmit={search} className="mb-3">
        <input
          id="global-search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { onQuery(''); e.currentTarget.blur(); } }}
          placeholder="Buscar  /"
          aria-label="Buscar tareas"
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <NavItem href={routeHref({ view: 'today' })} active={is('today')} count={tasksDueOn(tasks, today).length + overdueTasks(tasks, today).length}
        onDropTasks={(ids) => void moveIds(ids, { due_date: today }, 'Movida a hoy')}>Hoy</NavItem>
      <NavItem href={routeHref({ view: 'week' })} active={is('week')}>Próximos 7 días</NavItem>
      <NavItem href={routeHref({ view: 'inbox' })} active={is('inbox')} count={inboxTasks(tasks).length}
        onDropTasks={(ids) => void moveIds(ids, { due_date: null, project_id: null }, 'Movida a la bandeja')}>Bandeja</NavItem>

      <Heading href={routeHref({ view: 'projects' })}>Proyectos</Heading>
      {projects.map((p) => (
        <NavItem
          key={p.id}
          href={routeHref({ view: 'project', id: p.id })}
          active={route.view === 'project' && route.id === p.id}
          dot={p.color}
          count={tasks.filter((t) => t.project_id === p.id && isActive(t)).length}
          onDropTasks={(ids) => void moveIds(ids, { project_id: p.id }, `Movida a ${p.name}`)}
        >
          {p.name}
        </NavItem>
      ))}
      {projects.length === 0 && <a href={routeHref({ view: 'projects' })} className="px-2 text-xs text-zinc-400 hover:underline">+ Crear proyecto</a>}

      <Heading href={routeHref({ view: 'people' })}>Personas</Heading>
      {people.map((p) => (
        <NavItem key={p.name} href={routeHref({ view: 'person', name: p.name })} active={route.view === 'person' && route.name === p.name} count={p.count}>
          @{p.name}
        </NavItem>
      ))}

      <div className="mt-auto pt-4">
        <NavItem href={routeHref({ view: 'settings' })} active={is('settings')}>Copias y ajustes</NavItem>
      </div>
    </nav>
  );
}
