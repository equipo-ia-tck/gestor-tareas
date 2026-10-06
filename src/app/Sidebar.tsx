import type { ReactNode } from 'react';
import { useApp } from './AppContext';
import { routeHref, type Route } from './router';
import { inboxTasks, overdueTasks, peopleIndex, tasksDueOn } from '../domain/selectors';
import { isActive } from '../domain/selectors';

function NavItem({ href, active, children, count, dot }: {
  href: string; active: boolean; children: ReactNode; count?: number; dot?: string;
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${active ? 'bg-zinc-200 font-medium dark:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60'}`}
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

  return (
    <nav className="flex h-full flex-col overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-4 px-2 text-sm font-semibold">✓ Tareas</div>
      <NavItem href={routeHref({ view: 'today' })} active={is('today')} count={tasksDueOn(tasks, today).length + overdueTasks(tasks, today).length}>Hoy</NavItem>
      <NavItem href={routeHref({ view: 'week' })} active={is('week')}>Próximos 7 días</NavItem>
      <NavItem href={routeHref({ view: 'inbox' })} active={is('inbox')} count={inboxTasks(tasks).length}>Bandeja</NavItem>

      <Heading href={routeHref({ view: 'projects' })}>Proyectos</Heading>
      {projects.map((p) => (
        <NavItem
          key={p.id}
          href={routeHref({ view: 'project', id: p.id })}
          active={route.view === 'project' && route.id === p.id}
          dot={p.color}
          count={tasks.filter((t) => t.project_id === p.id && isActive(t)).length}
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
