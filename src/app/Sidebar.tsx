import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Calendar, ChevronDown, ChevronRight, ClipboardCheck, FolderOpen, History, Plus, Inbox, KanbanSquare, NotebookPen, Rocket, Search, Settings, Sun, Users, type LucideIcon } from 'lucide-react';
import { Avatar } from '../components/ui/Badges';
import { useApp } from './AppContext';
import { repo } from '../data/services';
import { useSync } from '../data/sync';
import { useTaskActions } from '../hooks/useTaskActions';
import { usePersistentState } from '../hooks/usePersistentState';
import { projectTree, withDescendants, type ProjectNode } from '../domain/projects';
import { peopleDirectory } from '../domain/people';
import { dropHighlight, useTaskDrop } from '../hooks/useTaskDrop';
import { routeHref, type Route } from './router';
import { inboxTasks, myDayTasks, overdueTasks, tasksDueOn } from '../domain/selectors';
import { isActive } from '../domain/selectors';

function NavItem({ href, active, children, count, dot, icon: Icon, lead, onDropTasks, indent = 0 }: {
  href: string; active: boolean; children: ReactNode; count?: number; dot?: string;
  icon?: LucideIcon; lead?: ReactNode;
  onDropTasks?: (ids: string[]) => void;
  indent?: number;
}) {
  const { over, dropProps } = useTaskDrop(onDropTasks);
  return (
    <a
      href={href}
      {...dropProps}
      style={indent ? { paddingLeft: `${0.5 + indent * 0.9}rem` } : undefined}
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

const Heading = ({ href, children, action }: { href?: string; children: ReactNode; action?: ReactNode }) => (
  <div className="mt-5 mb-1 flex items-center px-2">
    {href
      ? <a href={href} className="flex-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase hover:text-zinc-600 dark:hover:text-zinc-200">{children}</a>
      : <span className="flex-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{children}</span>}
    {action}
  </div>
);

/** "+" junto a Proyectos: crea un proyecto y lo abre. */
/** "+" del título Proyectos; el cuadro para escribir el nombre aparece en su propia línea, debajo. */
function NewProjectForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  async function create(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) {
      const p = await repo.createProject(name.trim());
      window.location.hash = routeHref({ view: 'project', id: p.id });
    }
    onDone();
  }
  return (
    <form onSubmit={create} className="mb-1 px-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del proyecto y Enter"
        onBlur={() => { if (!name.trim()) onDone(); }} onKeyDown={(e) => { if (e.key === 'Escape') onDone(); }}
        className="w-full rounded-md border border-indigo-400 bg-white px-2 py-1 text-sm outline-none dark:bg-zinc-900" />
    </form>
  );
}

/** Proyecto en la barra lateral, con sus subproyectos plegables. */
function ProjectNav({ node, route }: { node: ProjectNode; route: Route }) {
  const { tasks, projects } = useApp();
  const { moveIds } = useTaskActions();
  const [collapsed, setCollapsed] = usePersistentState<boolean>(`sidebar-collapsed:${node.project.id}`, false);
  const p = node.project;
  const ids = withDescendants(p.id, projects);
  const count = tasks.filter((t) => t.project_id && ids.has(t.project_id) && isActive(t)).length;
  return (
    <>
      <div className="group/proj relative">
        {node.children.length > 0 && (
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Desplegar' : 'Plegar'}
            className="absolute top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            style={{ left: `${node.depth * 0.9 - 0.05}rem` }}>
            {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
        <NavItem
          href={routeHref({ view: 'project', id: p.id })}
          active={route.view === 'project' && route.id === p.id}
          dot={p.color}
          indent={node.depth}
          count={count}
          onDropTasks={(taskIds) => void moveIds(taskIds, { project_id: p.id }, `Movida a ${p.name}`)}
        >
          {p.name}
        </NavItem>
      </div>
      {!collapsed && node.children.map((c) => <ProjectNav key={c.project.id} node={c} route={route} />)}
    </>
  );
}

/** Proyectos archivados (plegados): para consultarlos o desarchivarlos. */
function ArchivedProjects() {
  const { allProjects } = useApp();
  const [open, setOpen] = usePersistentState('sidebar-archived', false);
  const archived = allProjects.filter((p) => p.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!archived.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} className="px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
        {open ? '▾' : '▸'} Archivados ({archived.length})
      </button>
      {open && archived.map((p) => (
        <a key={p.id} href={routeHref({ view: 'project', id: p.id })} className="block truncate py-0.5 pr-2 pl-6 text-xs text-zinc-400 hover:underline">{p.name}</a>
      ))}
    </>
  );
}

/** Vistas de uso ocasional, plegadas para no ocupar sitio. */
function MoreSection({ route, releases }: { route: Route; releases: number }) {
  const [open, setOpen] = usePersistentState('sidebar-more', false);
  const active = ['log', 'releases', 'review'].includes(route.view);
  const show = open || active;
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)}
        className="mt-5 mb-1 flex items-center gap-1 px-2 text-left text-xs font-semibold tracking-wide text-zinc-400 uppercase hover:text-zinc-600 dark:hover:text-zinc-200">
        {show ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}Más
      </button>
      {show && (
        <>
          <NavItem icon={ClipboardCheck} href={routeHref({ view: 'review' })} active={route.view === 'review'}>Revisión semanal</NavItem>
          <NavItem icon={Rocket} href={routeHref({ view: 'releases' })} active={route.view === 'releases'} count={releases}>Releases</NavItem>
          <NavItem icon={History} href={routeHref({ view: 'log' })} active={route.view === 'log'}>Registro</NavItem>
        </>
      )}
    </>
  );
}

export function Sidebar({ route }: { route: Route }) {
  const { tasks, projects, today, releases } = useApp();
  const [addingProject, setAddingProject] = useState(false);
  const is = (v: Route['view']) => route.view === v;
  const { notes, peopleCards } = useApp();
  // Todas las personas: con tareas, mencionadas en notas o con ficha.
  const allPeople = peopleDirectory(tasks, notes, peopleCards);
  const [showAllPeople, setShowAllPeople] = usePersistentState('sidebar-all-people', false);
  const people = showAllPeople ? allPeople : allPeople.slice(0, 10);
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
          placeholder="Buscar todo  /"
          aria-label="Buscar tareas"
          className="w-full rounded-md border border-zinc-200 bg-white py-1 pr-2 pl-7 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
      <SpaceSwitcher />
      <NavItem icon={Sun} href={routeHref({ view: 'today' })} active={is('today')} count={new Set([...tasksDueOn(tasks, today), ...overdueTasks(tasks, today), ...myDayTasks(tasks, today)].map((t) => t.id)).size}
        onDropTasks={(ids) => void moveIds(ids, { due_date: today }, 'Movida a hoy')}>Hoy</NavItem>
      <NavItem icon={Inbox} href={routeHref({ view: 'inbox' })} active={is('inbox')} count={inboxTasks(tasks).length}
        onDropTasks={(ids) => void moveIds(ids, { due_date: null, project_id: null }, 'Movida a la bandeja')}>Bandeja</NavItem>
      <NavItem icon={KanbanSquare} href={routeHref({ view: 'board' })} active={is('board') || is('all')}>Tablero</NavItem>
      <NavItem icon={Calendar} href={routeHref({ view: 'calendar' })} active={is('calendar') || is('week')}>Calendario</NavItem>
      <NavItem icon={NotebookPen} href={routeHref({ view: 'notes' })} active={is('notes')}>Notas</NavItem>

      <Heading action={
        <button type="button" onClick={() => setAddingProject(true)} title="Nuevo proyecto" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700">
          <Plus className="size-3.5" />
        </button>
      }><FolderOpen className="mr-1.5 inline size-3.5" />Proyectos</Heading>
      {addingProject && <NewProjectForm onDone={() => setAddingProject(false)} />}
      {projectTree(projects).map((node) => <ProjectNav key={node.project.id} node={node} route={route} />)}
      {projects.length === 0 && <p className="px-2 text-xs text-zinc-400">Crea uno con el +</p>}
      <ArchivedProjects />
      {projects.length === 0 && <a href={routeHref({ view: 'projects' })} className="px-2 text-xs text-zinc-400 hover:underline">+ Crear proyecto</a>}

      <Heading href={routeHref({ view: 'people' })}><Users className="mr-1.5 inline size-3.5" />Personas</Heading>
      {people.map((p) => (
        <NavItem key={p.name} href={routeHref({ view: 'person', name: p.name })} active={route.view === 'person' && route.name === p.name} count={p.tasks}
          lead={<Avatar name={p.name} size={18} />}>
          {p.name}
        </NavItem>
      ))}
      {allPeople.length > 10 && (
        <button type="button" onClick={() => setShowAllPeople(!showAllPeople)} className="px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          {showAllPeople ? 'Ver menos' : `Ver las ${allPeople.length}`}
        </button>
      )}

      <MoreSection route={route} releases={releases.filter((r) => r.status === 'planned').length} />

      <div className="mt-auto pt-4">
        <SyncBadge />
        <NavItem icon={Settings} href={routeHref({ view: 'settings' })} active={is('settings')}>Copias y ajustes</NavItem>
      </div>
    </nav>
  );
}

/** Quién ha entrado y si los cambios están guardados en el servidor. */
function SyncBadge() {
  const { user, status } = useSync();
  if (!user) return null;
  const label = { ok: 'Guardado', saving: 'Guardando…', offline: 'Sin conexión: los cambios esperan' }[status];
  const dot = { ok: 'bg-emerald-500', saving: 'bg-amber-400', offline: 'bg-red-500' }[status];
  return (
    <div className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-zinc-500" title={label}>
      <Avatar name={user.name} size={18} />
      <span className="min-w-0 flex-1 truncate">{user.name}</span>
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className={status === 'offline' ? 'text-red-600 dark:text-red-400' : ''}>{status === 'offline' ? 'Sin conexión' : label}</span>
    </div>
  );
}

/** Filtro por espacio: todo, lo personal o un espacio. Afecta a todas las vistas. */
function SpaceSwitcher() {
  const { spaces, spaceFilter, setSpaceFilter } = useApp();
  if (!spaces.length) return null;
  const options = [
    { id: 'all', name: 'Todo', color: null },
    { id: 'personal', name: 'Personal', color: null },
    ...spaces.map((s) => ({ id: s.id, name: s.name, color: s.color })),
  ];
  return (
    <div role="radiogroup" aria-label="Espacio" className="mb-2 flex flex-wrap gap-1 px-1">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={spaceFilter === o.id} onClick={() => setSpaceFilter(o.id)}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${spaceFilter === o.id
            ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}>
          {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} />}
          {o.name}
        </button>
      ))}
    </div>
  );
}
