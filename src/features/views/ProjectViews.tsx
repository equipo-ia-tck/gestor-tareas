import { useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate, routeHref } from '../../app/router';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { inputClass } from '../../components/TaskEditor';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { isActive, sortTasks } from '../../domain/selectors';
import { PROJECT_COLORS } from '../../domain/types';
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
  const toast = useToast();
  const project = projectMap.get(id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  if (!project) return <p className="text-sm text-zinc-500">Proyecto no encontrado.</p>;

  const mine = tasks.filter((t) => t.project_id === id);
  const active = sortTasks(mine.filter(isActive));
  const undated = active.filter((t) => !t.due_date);
  const dated = active.filter((t) => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const done = mine.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const list = { today, projects: projectMap, onEdit: editTask, hideProject: true };

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) await repo.updateProject(id, { name: name.trim() });
    setRenaming(false);
  }

  async function toggleArchive() {
    const archived = !project!.archived;
    await repo.updateProject(id, { archived });
    if (archived) toast('Proyecto archivado', { label: 'Deshacer', run: () => repo.updateProject(id, { archived: false }) });
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
            <SmallButton onClick={() => { setName(project.name); setRenaming(true); }}>Renombrar</SmallButton>
            <SmallButton onClick={() => void toggleArchive()}>{project.archived ? 'Desarchivar' : 'Archivar'}</SmallButton>
          </>
        }
      />
      <QuickAdd defaults={{ project_id: id }} placeholder={`Añadir tarea a ${project.name}`} />
      <Section title={`Sin fecha · ${undated.length}`}>
        <TaskList {...list} tasks={undated} empty="—" />
      </Section>
      {dated.length > 0 && (
        <Section title={`Con fecha · ${dated.length}`}>
          <TaskList {...list} tasks={dated} />
        </Section>
      )}
      {done.length > 0 && (
        <Section title={`Completadas · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList {...list} tasks={done} />
        </Section>
      )}
    </>
  );
}
