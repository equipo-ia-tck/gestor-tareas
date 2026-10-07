import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Calendar, CalendarDays, FolderOpen, Inbox, KanbanSquare, Rocket, Search, Settings, Sun, Users, type LucideIcon } from 'lucide-react';
import { Avatar } from '../components/ui/Badges';
import { useApp } from './AppContext';
import { useTaskActions } from '../hooks/useTaskActions';
import { dropHighlight, useTaskDrop } from '../hooks/useTaskDrop';
import { routeHref, type Route } from './router';
import { inboxTasks, overdueTasks, peopleIndex, tasksDueOn } from '../domain/selectors';
import { isActive } from '../domain/selectors';

function NavItem({ href, active, children, count, dot, icon: Icon, lead, onDropTasks }: {
  href: string; active: boolean; children: ReactNode; count?: number; dot?: string;
  icon?: LucideIcon; lead?: ReactNode;
  onDropTasks?: (ids: string[]) => void;
}) {
  const { over, dropProps } = useTaskDrop(onDropTasks);
  return (
    <a
      href={href}
      {...dropProps}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${over ? dropHighlight : active ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60'}`}
    >
      {Icon && <Icon className={`size-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} />}
      {dot && <span className="ml-1 size-2.5 shrink-0 rounded-sm" style={{ background: dot }} />}
      {lead}
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
  const { tasks, projects, today, releases } = useApp();
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
    <nav className="flex h-full flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-4 flex items-center gap-2 px-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">✓</span>
        <span className="text-sm font-semibold">Tareas</span>
      </div>
      <form onSubmit={search} className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          id="global-search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { onQuery(''); e.currentTarget.blur(); } }}
          placeholder="Buscar  /"
          aria-label="Buscar tareas"
          className="w-full rounded-md border border-zinc-200 bg-white py-1 pr-2 pl-7 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <NavItem icon={Sun} href={routeHref({ view: 'today' })} active={is('today')} count={tasksDueOn(tasks, today).length + overdueTasks(tasks, today).length}
        onDropTasks={(ids) => void moveIds(ids, { due_date: today }, 'Movida a hoy')}>Hoy</NavItem>
      <NavItem icon={CalendarDays} href={routeHref({ view: 'week' })} active={is('week')}>Próximos 7 días</NavItem>
      <NavItem icon={Inbox} href={routeHref({ view: 'inbox' })} active={is('inbox')} count={inboxTasks(tasks).length}
        onDropTasks={(ids) => void moveIds(ids, { due_date: null, project_id: null }, 'Movida a la bandeja')}>Bandeja</NavItem>
      <NavItem icon={KanbanSquare} href={routeHref({ view: 'board' })} active={is('board')}>Tablero</NavItem>
      <NavItem icon={Calendar} href={routeHref({ view: 'calendar' })} active={is('calendar')}>Calendario</NavItem>
      <NavItem icon={Rocket} href={routeHref({ view: 'releases' })} active={is('releases')}
        count={releases.filter((r) => r.status === 'planned').length}>Releases</NavItem>

      <Heading href={routeHref({ view: 'projects' })}><FolderOpen className="mr-1.5 inline size-3.5" />Proyectos</Heading>
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

      <Heading href={routeHref({ view: 'people' })}><Users className="mr-1.5 inline size-3.5" />Personas</Heading>
      {people.map((p) => (
        <NavItem key={p.name} href={routeHref({ view: 'person', name: p.name })} active={route.view === 'person' && route.name === p.name} count={p.count}
          lead={<Avatar name={p.name} size={18} />}>
          {p.name}
        </NavItem>
      ))}

      <div className="mt-auto pt-4">
        <NavItem icon={Settings} href={routeHref({ view: 'settings' })} active={is('settings')}>Copias y ajustes</NavItem>
      </div>
    </nav>
  );
}
