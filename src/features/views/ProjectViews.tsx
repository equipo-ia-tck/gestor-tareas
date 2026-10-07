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
import { ViewHeader } from './ViewHeader';

export function ProjectsView() {
  const { allProjects, tasks } = useApp();
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const count = (id: string) => tasks.filter((t) => t.project_id === id && isActive(t)).length;
  const visible = allProjects.filter((p) => showArchived || !p.archived);

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
        {visible.map((p) => (
          <li key={p.id}>
            <a href={routeHref({ view: 'project', id: p.id })} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
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

  if (!project) return <p className="text-sm text-zinc-500">Proyecto no encontrado.</p>;

  const mine = tasks.filter((t) => t.project_id === id);
  const active = sortTasks(mine.filter(isActive));
  // Lista al estilo Asana: secciones por grupo de estado (cada fila muestra su estado concreto).
  const byCategory = (cat: StateCategory) => active.filter((t) => stateOf(itemTypes, t).category === cat);
  const done = mine.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const list = { today, projects: projectMap, onEdit: editTask, hideProject: true };

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
            <SmallButton onClick={() => { setName(project.name); setRenaming(true); }}>Renombrar</SmallButton>
            <SmallButton onClick={() => void toggleArchive()}>{project.archived ? 'Desarchivar' : 'Archivar'}</SmallButton>
          </>
        }
      />
      {mode === 'board' ? (
        <>
          <div className="mb-4"><TypeTabs value={typeId} onChange={setTypeId} tasks={mine} /></div>
          <Board tasks={mine} type={findType(itemTypes, typeId)} defaults={{ project_id: id }} showProject={false} />
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

const CATEGORY_SECTIONS: { cat: StateCategory; title: string; color: string }[] = [
  { cat: 'doing', title: 'En curso', color: '#3b82f6' },
  { cat: 'blocked', title: 'Bloqueadas', color: '#ef4444' },
  { cat: 'todo', title: 'Por hacer', color: '#94a3b8' },
];
