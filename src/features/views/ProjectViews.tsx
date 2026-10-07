import { useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate, routeHref } from '../../app/router';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import { isActive, sortTasks } from '../../domain/selectors';
import { PROJECT_COLORS } from '../../domain/types';
import { useWideLayout } from '../../app/Layout';
import { ViewSwitcher, type DisplayMode } from '../../components/ui/ViewSwitcher';
import { usePersistentState } from '../../hooks/usePersistentState';
import type { StateCategory } from '../../domain/types';
import { findType, stateOf } from '../../domain/workflows';
import { Board, TypeTabs } from '../board/Board';
import { newNote } from '../notes/NotesView';
import { noteExcerpt, sortNotes } from '../../domain/notes';
import { formatDay } from '../../domain/dates';
import { ViewHeader } from './ViewHeader';
import { MenuItem, Popover } from '../../components/ui/Popover';
import { ancestry, canMoveUnder, flattenTree, MAX_PROJECT_DEPTH, projectTree, withDescendants } from '../../domain/projects';
import type { Project } from '../../domain/types';

export function ProjectsView() {
  const { allProjects, tasks } = useApp();
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const count = (id: string) => tasks.filter((t) => t.project_id === id && isActive(t)).length;
  const visible = flattenTree(projectTree(allProjects.filter((p) => showArchived || !p.archived)));

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await repo.createProject(name);
    setName('');
    navigate({ view: 'project', id: p.id });
  }

  return (
    <>
      <ViewHeader
        title="Proyectos"
        actions={<SmallButton onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Ocultar archivados' : 'Ver archivados'}</SmallButton>}
      />
      <form onSubmit={create} className="mb-5 flex gap-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo proyecto" />
        <button className="rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">Crear</button>
      </form>
      <ul>
        {visible.map(({ project: p, depth }) => (
          <li key={p.id}>
            <a href={routeHref({ view: 'project', id: p.id })} style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="size-2.5 rounded-full" style={{ background: p.color }} />
              <span className={`flex-1 ${p.archived ? 'text-zinc-400' : ''}`}>{p.name}{p.archived && ' (archivado)'}</span>
              <span className="text-xs text-zinc-400">{count(p.id)}</span>
            </a>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="px-2 text-sm text-zinc-400">Aún no hay proyectos.</p>}
    </>
  );
}

export function ProjectView({ id }: { id: string }) {
  const { tasks, projectMap, today, editTask } = useApp();
  const project = projectMap.get(id);
  const { itemTypes } = useApp();
  const [mode, setMode] = usePersistentState<DisplayMode>(`project-mode:${id}`, 'list');
  const [typeId, setTypeId] = usePersistentState(`project-type:${id}`, 'task');
  useWideLayout(mode === 'board');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const { allProjects } = useApp();
  const [includeSubs, setIncludeSubs] = usePersistentState(`project-subs:${id}`, true);

  if (!project) return <p className="text-sm text-zinc-500">Proyecto no encontrado.</p>;

  const children = allProjects.filter((p) => p.parent_id === id && !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  // Con "incluir subproyectos", el proyecto muestra también las tareas de sus descendientes.
  const scope = includeSubs ? withDescendants(id, allProjects) : new Set([id]);
  const mine = tasks.filter((t) => t.project_id !== null && scope.has(t.project_id));
  const active = sortTasks(mine.filter(isActive));
  // Lista al estilo Asana: secciones por grupo de estado (cada fila muestra su estado concreto).
  const byCategory = (cat: StateCategory) => active.filter((t) => stateOf(itemTypes, t).category === cat);
  const done = mine.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const list = { today, projects: projectMap, onEdit: editTask, contextProjectId: id };

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && name.trim() !== project!.name) await repo.batch('Proyecto renombrado', () => repo.updateProject(id, { name: name.trim() }));
    setRenaming(false);
  }

  async function toggleArchive() {
    const archived = !project!.archived;
    await repo.batch(archived ? 'Proyecto archivado' : 'Proyecto desarchivado', () => repo.updateProject(id, { archived }));
  }

  async function cycleColor() {
    const i = PROJECT_COLORS.indexOf(project!.color);
    await repo.updateProject(id, { color: PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length] });
  }

  return (
    <>
      {project.parent_id && (
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500" aria-label="Ruta del proyecto">
          {ancestry(id, projectMap).slice(0, -1).map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <a href={routeHref({ view: 'project', id: a.id })} className="hover:underline">{a.name}</a><span>›</span>
            </span>
          ))}
        </nav>
      )}
      <ViewHeader
        title={renaming ? (
          <form onSubmit={rename}>
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} onBlur={rename}
              onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }} />
          </form>
        ) : (
          <span className="flex items-center gap-2">
            <button title="Cambiar color" onClick={() => void cycleColor()} className="size-3 rounded-full" style={{ background: project.color }} />
            <span onDoubleClick={() => { setName(project.name); setRenaming(true); }}>{project.name}</span>
            {project.archived && <span className="text-sm font-normal text-zinc-400">(archivado)</span>}
          </span>
        )}
        subtitle={`${active.length} pendientes · ${done.length} completadas`}
        actions={
          <>
            <ViewSwitcher value={mode} onChange={setMode} />
            <MoveProject id={id} />
            <SmallButton onClick={() => { setName(project.name); setRenaming(true); }}>Renombrar</SmallButton>
            <SmallButton onClick={() => void toggleArchive()}>{project.archived ? 'Desarchivar' : 'Archivar'}</SmallButton>
          </>
        }
      />
      <Subprojects parentId={id} subprojects={children} includeSubs={includeSubs} onToggleSubs={setIncludeSubs} />
      {mode === 'board' ? (
        <>
          <div className="mb-4"><TypeTabs value={typeId} onChange={setTypeId} tasks={mine} /></div>
          <Board tasks={mine} type={findType(itemTypes, typeId)} defaults={{ project_id: id }} showProject={includeSubs && children.length > 0} />
        </>
      ) : (
      <>
      <QuickAdd defaults={{ project_id: id }} placeholder={`Añadir tarea a ${project.name}`} />
      {CATEGORY_SECTIONS.map(({ cat, title, color }) => {
        const items = byCategory(cat);
        if (!items.length && cat !== 'todo') return null;
        return (
          <Section key={cat} title={<span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color }} />{title} · {items.length}</span>}
            onDropTasks={(ids) => void moveToCategory(ids, cat, title)}>
            <TaskList {...list} tasks={items} empty="—" />
          </Section>
        );
      })}
      {done.length > 0 && (
        <Section title={`Completadas · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList {...list} tasks={done} />
        </Section>
      )}
      <ProjectNotes projectIds={scope} projectId={id} />
      </>
      )}
    </>
  );

  /** Soltar en una sección: cada tarea pasa al primer estado de ese grupo dentro de su propio flujo. */
  async function moveToCategory(ids: string[], cat: StateCategory, title: string) {
    await repo.batch(`${ids.length === 1 ? 'Movida' : `${ids.length} tareas movidas`} a ${title.toLowerCase()}`, async () => {
      for (const taskId of ids) {
        const t = tasks.find((x) => x.id === taskId);
        const state = t && findType(itemTypes, t.type_id).states.find((st) => st.category === cat);
        if (state) await repo.setState(taskId, state.id);
      }
    });
  }
}

/** Subproyectos del proyecto: tarjetas con su avance y alta de uno nuevo. */
function Subprojects({ parentId, subprojects: children, includeSubs, onToggleSubs }: {
  parentId: string;
  subprojects: Project[];
  includeSubs: boolean;
  onToggleSubs: (v: boolean) => void;
}) {
  const { tasks, allProjects, projectMap } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const depth = ancestry(parentId, projectMap).length;
  const canAdd = depth < MAX_PROJECT_DEPTH;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) await repo.createProject(name.trim(), { parent_id: parentId });
    setName('');
    setAdding(false);
  }

  if (!children.length && !canAdd) return null;
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Subproyectos · {children.length}</h3>
        {children.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="checkbox" checked={includeSubs} onChange={(e) => onToggleSubs(e.target.checked)} />Ver también sus tareas aquí
          </label>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((c) => {
          const ids = withDescendants(c.id, allProjects);
          const own = tasks.filter((t) => t.project_id && ids.has(t.project_id) && t.status !== 'archived');
          const done = own.filter((t) => t.status === 'done').length;
          const pending = own.length - done;
          const subs = allProjects.filter((p) => p.parent_id === c.id && !p.archived).length;
          return (
            <a key={c.id} href={routeHref({ view: 'project', id: c.id })}
              className="rounded-lg border border-zinc-200 bg-white p-3 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900" style={{ borderLeft: `3px solid ${c.color}` }}>
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{pending} pendiente{pending === 1 ? '' : 's'}{subs ? ` · ${subs} subproyecto${subs === 1 ? '' : 's'}` : ''}</p>
              {own.length > 0 && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full" style={{ width: `${(done / own.length) * 100}%`, background: c.color }} />
                </div>
              )}
            </a>
          );
        })}
        {canAdd && (adding ? (
          <form onSubmit={add} className="rounded-lg border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del subproyecto"
              onBlur={() => { if (!name.trim()) setAdding(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="rounded-lg border border-dashed border-zinc-300 p-3 text-left text-sm text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700">
            + Subproyecto
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mover el proyecto dentro de otro (o al nivel superior). */
function MoveProject({ id }: { id: string }) {
  const { allProjects, projectMap } = useApp();
  const project = projectMap.get(id)!;
  const options = flattenTree(projectTree(allProjects.filter((p) => !p.archived)))
    .filter((n) => n.project.id !== project.parent_id && canMoveUnder(id, n.project.id, allProjects));
  const move = (parent: string | null, label: string) =>
    void repo.batch(parent ? `Movido dentro de ${label}` : 'Movido al nivel superior', () => repo.updateProject(id, { parent_id: parent }));
  return (
    <Popover align="right" width="w-64" trigger={(toggle) => <SmallButton onClick={toggle}>Mover…</SmallButton>}>
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {project.parent_id && <MenuItem onClick={() => { close(); move(null, ''); }}><span className="text-zinc-500">↑ Nivel superior</span></MenuItem>}
          {options.map((n) => (
            <MenuItem key={n.project.id} onClick={() => { close(); move(n.project.id, n.project.name); }}>
              <span style={{ paddingLeft: `${n.depth * 0.8}rem` }} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: n.project.color }} />{n.project.name}
              </span>
            </MenuItem>
          ))}
          {!options.length && !project.parent_id && <p className="px-2 py-1 text-xs text-zinc-400">No hay otro proyecto donde quepa (máximo {MAX_PROJECT_DEPTH} niveles).</p>}
        </div>
      )}
    </Popover>
  );
}

function ProjectNotes({ projectIds, projectId }: { projectIds: Set<string>; projectId: string }) {
  const { notes, today } = useApp();
  const mine = sortNotes(notes.filter((n) => n.project_id !== null && projectIds.has(n.project_id) && !n.task_id));
  return (
    <Section
      title={`Notas y actas · ${mine.length}`}
      aside={<SmallButton onClick={() => void newNote('meeting', today, { project_id: projectId })}>+ Acta</SmallButton>}
      collapsible
      defaultOpen={mine.length > 0}
    >
      {!mine.length && <p className="px-2 py-2 text-sm text-zinc-400">Sin notas en este proyecto.</p>}
      <ul>
        {mine.slice(0, 10).map((n) => (
          <li key={n.id}><a href={`#/notes/${n.id}`} className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <span className="truncate">{n.title || 'Sin título'} <span className="text-xs text-zinc-400">{noteExcerpt(n)}</span></span>
            <span className="shrink-0 text-xs text-zinc-400">{formatDay(n.date, today)}</span>
          </a></li>
        ))}
      </ul>
    </Section>
  );
}

const CATEGORY_SECTIONS: { cat: StateCategory; title: string; color: string }[] = [
  { cat: 'doing', title: 'En curso', color: '#3b82f6' },
  { cat: 'blocked', title: 'Bloqueadas', color: '#ef4444' },
  { cat: 'todo', title: 'Por hacer', color: '#94a3b8' },
];
