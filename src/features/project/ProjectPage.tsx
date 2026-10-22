import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, FileText, LayoutGrid, List, KanbanSquare, Plus } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useWideLayout } from '../../app/Layout';
import { routeHref } from '../../app/router';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, SmallButton, TaskList } from '../../components/TaskList';
import { AvatarStack, PriorityFlag, StatePill, TypeBadge } from '../../components/ui/Badges';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import { addDays, formatDay } from '../../domain/dates';
import { noteExcerpt, sortNotes } from '../../domain/notes';
import { ancestry, flattenTree, MAX_PROJECT_DEPTH, projectTree, withDescendants } from '../../domain/projects';
import { isActive, sortTasks } from '../../domain/selectors';
import { PROJECT_COLORS, type Note, type Project, type Task } from '../../domain/types';
import { findType, stateOf } from '../../domain/workflows';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useTaskActions } from '../../hooks/useTaskActions';
import { setDraggedTasks, useTaskDrop } from '../../hooks/useTaskDrop';
import { parseCapture } from '../../parser/parseCapture';
import { Board, CategoryBoard } from '../board/Board';
import { submitCapture } from '../capture/submitCapture';
import { ItemNotes } from '../notes/ItemNotes';
import { ViewHeader } from '../views/ViewHeader';
import { MoveProject, ProjectNotes, ProjectSpace } from '../views/ProjectViews';

type Mode = 'summary' | 'list' | 'board';
const CARD_TASKS = 6;

/** Proyecto: todo lo que contiene (también sus subproyectos) en una sola pantalla. */
export function ProjectView({ id }: { id: string }) {
  const { tasks, notes, allProjects, projectMap, today } = useApp();
  const project = projectMap.get(id);
  const [mode, setMode] = usePersistentState<Mode>(`project-view:${id}`, 'summary');
  useWideLayout(mode !== 'list');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  if (!project) return <p className="text-sm text-zinc-500">Proyecto no encontrado.</p>;

  const scope = withDescendants(id, allProjects);
  const mine = tasks.filter((t) => t.project_id !== null && scope.has(t.project_id) && t.status !== 'archived');
  const active = mine.filter(isActive);

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && name.trim() !== project!.name) await repo.batch('Proyecto renombrado', () => repo.updateProject(id, { name: name.trim() }));
    setRenaming(false);
  }
  const cycleColor = () => {
    const i = PROJECT_COLORS.indexOf(project.color);
    void repo.updateProject(id, { color: PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length] });
  };
  const toggleArchive = () =>
    void repo.batch(project.archived ? 'Proyecto desarchivado' : 'Proyecto archivado', () => repo.updateProject(id, { archived: !project.archived }));

  return (
    <>
      {project.parent_id && (
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500" aria-label="Ruta del proyecto">
          {ancestry(id, projectMap).slice(0, -1).map((a) => (
            <span key={a.id} className="flex items-center gap-1"><a href={routeHref({ view: 'project', id: a.id })} className="hover:underline">{a.name}</a><span>›</span></span>
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
            <button title="Cambiar color" onClick={cycleColor} className="size-3 rounded-full" style={{ background: project.color }} />
            <span onDoubleClick={() => { setName(project.name); setRenaming(true); }}>{project.name}</span>
            {project.archived && <span className="text-sm font-normal text-zinc-400">(archivado)</span>}
          </span>
        )}
        actions={
          <>
            <ModeSwitch value={mode} onChange={setMode} />
            <ProjectSpace id={id} />
            <MoveProject id={id} />
            <SmallButton onClick={() => { setName(project.name); setRenaming(true); }}>Renombrar</SmallButton>
            <SmallButton onClick={toggleArchive}>{project.archived ? 'Desarchivar' : 'Archivar'}</SmallButton>
          </>
        }
      />
      <Stats tasks={mine} notes={notes.filter((n) => !n.deleted_at && ((n.project_id && scope.has(n.project_id)) || (n.task_id && mine.some((t) => t.id === n.task_id))))} today={today} />
      {mode === 'summary' && <Summary project={project} />}
      {mode === 'list' && <ProjectList project={project} tasks={mine} />}
      {mode === 'board' && <ProjectBoard project={project} tasks={mine} hasChildren={scope.size > 1} />}
      <div className="mt-6">
        <ItemNotes taskIds={new Set(mine.map((t) => t.id))} />
        <ProjectNotes projectIds={scope} projectId={id} />
      </div>
      {active.length === 0 && mode !== 'summary' && <p className="mt-2 text-sm text-zinc-400">No hay nada pendiente en este proyecto.</p>}
    </>
  );
}

function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const item = (m: Mode, label: string, Icon: typeof List) => (
    <button type="button" onClick={() => onChange(m)} aria-pressed={value === m}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${value === m ? 'bg-white font-medium shadow-sm dark:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
      <Icon className="size-4" />{label}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
      {item('summary', 'Resumen', LayoutGrid)}
      {item('list', 'Lista', List)}
      {item('board', 'Tablero', KanbanSquare)}
    </div>
  );
}

/** Cifras del proyecto completo (con subproyectos). */
function Stats({ tasks, notes, today }: { tasks: Task[]; notes: Note[]; today: string }) {
  const { itemTypes } = useApp();
  const active = tasks.filter(isActive);
  const cat = (c: string) => active.filter((t) => stateOf(itemTypes, t).category === c).length;
  const late = active.filter((t) => t.due_date && t.due_date < today).length;
  const weekAgo = addDays(today, -6);
  const doneWeek = tasks.filter((t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= weekAgo).length;
  const tile = (icon: ReactNode, label: string, value: number, cls = '') => (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">{icon}{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
  return (
    <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {tile(<Clock className="size-3.5" />, 'Pendientes', active.length)}
      {tile(<span className="size-2 rounded-full bg-blue-500" />, 'En curso', cat('doing'))}
      {tile(<span className="size-2 rounded-full bg-red-500" />, 'Bloqueadas', cat('blocked'), cat('blocked') ? 'text-red-600' : '')}
      {tile(<AlertTriangle className="size-3.5" />, 'Atrasadas', late, late ? 'text-amber-600' : '')}
      {tile(<CheckCircle2 className="size-3.5 text-emerald-500" />, 'Hechas (7 días)', doneWeek)}
      {tile(<FileText className="size-3.5" />, 'Notas', notes.length)}
    </div>
  );
}

// ---------------------------------------------------------------- Resumen

interface Area {
  key: string;
  project: Project;
  label: string;
  /** Proyectos que cuenta la tarjeta (el subproyecto y sus descendientes; o solo el padre en "General"). */
  ids: Set<string>;
  children: Project[];
}

/** Una tarjeta por subproyecto (más "General" con lo que cuelga directamente del proyecto). */
function Summary({ project }: { project: Project }) {
  const { allProjects } = useApp();
  const kids = allProjects.filter((p) => p.parent_id === project.id && !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const areas: Area[] = [
    { key: 'direct', project, label: kids.length ? 'General' : project.name, ids: new Set([project.id]), children: [] },
    ...kids.map((k) => ({
      key: k.id, project: k, label: k.name, ids: withDescendants(k.id, allProjects),
      children: flattenTree(projectTree(allProjects.filter((p) => !p.archived && withDescendants(k.id, allProjects).has(p.id) && p.id !== k.id))).map((n) => n.project),
    })),
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {areas.map((a) => <AreaCard key={a.key} area={a} isDirect={a.key === 'direct'} />)}
      <AddSubproject parent={project} />
    </div>
  );
}

function AreaCard({ area, isDirect }: { area: Area; isDirect: boolean }) {
  const { tasks, notes, itemTypes, today } = useApp();
  const { moveIds } = useTaskActions();
  const [expanded, setExpanded] = useState(false);
  const { over, dropProps } = useTaskDrop((ids) => void moveIds(ids, { project_id: area.project.id }, `Movida a ${area.project.name}`));

  const all = tasks.filter((t) => t.project_id !== null && area.ids.has(t.project_id) && t.status !== 'archived');
  const open = sortTasks(all.filter(isActive)).sort((a, b) => Number(!!b.due_date && b.due_date < today) - Number(!!a.due_date && a.due_date < today));
  const done = all.filter((t) => t.status === 'done').length;
  const blocked = open.filter((t) => stateOf(itemTypes, t).category === 'blocked').length;
  const doing = open.filter((t) => stateOf(itemTypes, t).category === 'doing').length;
  const taskIds = new Set(all.map((t) => t.id));
  const areaNotes = sortNotes(notes.filter((n) => !n.deleted_at && ((n.project_id !== null && area.ids.has(n.project_id) && !n.task_id) || (n.task_id && taskIds.has(n.task_id))))).slice(0, 3);
  const shown = expanded ? open : open.slice(0, CARD_TASKS);
  const pct = all.length ? (done / all.length) * 100 : 0;

  return (
    <article {...dropProps}
      className={`flex flex-col rounded-xl border bg-white shadow-sm dark:bg-zinc-900 ${over ? 'border-indigo-400 ring-2 ring-indigo-300' : 'border-zinc-200 dark:border-zinc-800'}`}
      style={{ borderTop: `4px solid ${area.project.color}` }}>
      <header className="px-3 pt-2.5">
        <div className="flex items-center gap-2">
          {isDirect
            ? <h3 className="flex-1 truncate text-sm font-semibold">{area.label}</h3>
            : <a href={routeHref({ view: 'project', id: area.project.id })} className="flex-1 truncate text-sm font-semibold hover:underline">{area.label}</a>}
          <span className="text-xs text-zinc-400">{open.length} pend.{done ? ` · ${done} hechas` : ''}</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full" style={{ width: `${pct}%`, background: area.project.color }} />
        </div>
        {(doing > 0 || blocked > 0 || area.children.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {doing > 0 && <span className="rounded bg-blue-50 px-1.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">{doing} en curso</span>}
            {blocked > 0 && <span className="rounded bg-red-50 px-1.5 text-red-700 dark:bg-red-950 dark:text-red-300">{blocked} bloqueada{blocked === 1 ? '' : 's'}</span>}
            {area.children.map((c) => (
              <a key={c.id} href={routeHref({ view: 'project', id: c.id })} className="rounded bg-zinc-100 px-1.5 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">› {c.name}</a>
            ))}
          </div>
        )}
      </header>
      <ul className="mt-2 flex-1 px-1.5">
        {shown.map((t) => <CompactTask key={t.id} task={t} />)}
        {!open.length && <li className="px-2 py-2 text-xs text-zinc-400">Nada pendiente.</li>}
      </ul>
      {open.length > CARD_TASKS && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="mx-3 mb-1 text-left text-xs text-zinc-500 hover:underline">
          {expanded ? 'Ver menos' : `Ver ${open.length - CARD_TASKS} más`}
        </button>
      )}
      <CardQuickAdd projectId={area.project.id} />
      {areaNotes.length > 0 && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {areaNotes.map((n) => (
            <a key={n.id} href={`#/notes/${n.id}`} className="flex items-center gap-1.5 truncate py-0.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              <FileText className="size-3 shrink-0" /><span className="truncate">{n.title || noteExcerpt(n) || 'Nota'}</span>
              <span className="ml-auto shrink-0 text-zinc-400">{formatDay(n.date, today)}</span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

/** Fila compacta: casilla para completar, clic para abrir el panel, se puede arrastrar a otra tarjeta. */
function CompactTask({ task }: { task: Task }) {
  const { itemTypes, today, editTask, detailId } = useApp();
  const { toggleDone } = useTaskActions();
  const type = findType(itemTypes, task.type_id);
  const state = stateOf(itemTypes, task);
  const late = task.due_date && task.due_date < today;
  return (
    <li draggable onDragStart={(e) => setDraggedTasks(e, [task.id])}
      className={`group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${detailId === task.id ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''}`}>
      <button type="button" aria-label="Completar" onClick={() => void toggleDone([task])}
        className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-zinc-300 hover:border-emerald-500 dark:border-zinc-600">
        <Check className="size-2.5 text-emerald-500 opacity-0 group-hover:opacity-60" />
      </button>
      <button type="button" onClick={() => editTask(task)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
        <TypeBadge type={type} />
        <span className="truncate">{task.title}</span>
        <PriorityFlag priority={task.priority} />
      </button>
      {(type.short || state.category !== 'todo') && <StatePill state={state} />}
      {task.due_date && <span className={`shrink-0 text-[11px] ${late ? 'font-medium text-amber-600' : 'text-zinc-400'}`}>{formatDay(task.due_date, today)}</span>}
      <AvatarStack names={task.people} max={2} size={18} />
    </li>
  );
}

function CardQuickAdd({ projectId }: { projectId: string }) {
  const { projects, today, itemTypes, releases, mentionables } = useApp();
  const [text, setText] = useState('');
  async function submit() {
    const parsed = parseCapture(text, { today, projects, people: mentionables, types: itemTypes, releases }).filter((p) => p.title);
    if (!parsed.length) return;
    await repo.batch(parsed.length === 1 ? 'Tarea creada' : `${parsed.length} tareas creadas`, () => submitCapture(parsed, { project_id: projectId }));
    setText('');
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); void submit(); }
    if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); }
  };
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      <Plus className="size-3.5 shrink-0 text-zinc-400" />
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Añadir tarea (mañana, @persona, US-123…)"
        className="w-full bg-transparent py-1 text-xs outline-none placeholder:text-zinc-400" />
    </div>
  );
}

function AddSubproject({ parent }: { parent: Project }) {
  const { projectMap } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (ancestry(parent.id, projectMap).length >= MAX_PROJECT_DEPTH) return null;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) await repo.createProject(name.trim(), { parent_id: parent.id });
    setName('');
    setAdding(false);
  }
  return adding ? (
    <form onSubmit={add} className="flex items-start rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del subproyecto"
        onBlur={() => { if (!name.trim()) setAdding(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
    </form>
  ) : (
    <button type="button" onClick={() => setAdding(true)}
      className="flex min-h-24 items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700">
      <Plus className="size-4" />Subproyecto
    </button>
  );
}

// ---------------------------------------------------------------- Lista y tablero

/** Lista agrupada por subproyecto (cada grupo con su ruta). */
function ProjectList({ project, tasks }: { project: Project; tasks: Task[] }) {
  const { allProjects, projectMap, today, editTask } = useApp();
  const { moveIds } = useTaskActions();
  const nodes = flattenTree(projectTree(allProjects.filter((p) => !p.archived && withDescendants(project.id, allProjects).has(p.id))));
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  return (
    <>
      <QuickAdd defaults={{ project_id: project.id }} placeholder={`Añadir tarea a ${project.name}`} />
      {nodes.map(({ project: p }) => {
        const items = sortTasks(tasks.filter((t) => t.project_id === p.id && isActive(t)));
        if (!items.length && p.id !== project.id) return null;
        const path = ancestry(p.id, projectMap).slice(ancestry(project.id, projectMap).length).map((a) => a.name).join(' › ');
        return (
          <Section key={p.id}
            title={<span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: p.color }} />{p.id === project.id ? 'General' : path} · {items.length}</span>}
            onDropTasks={(ids) => void moveIds(ids, { project_id: p.id }, `Movida a ${p.name}`)}>
            <TaskList tasks={items} today={today} projects={projectMap} onEdit={editTask} contextProjectId={p.id} empty="—" />
          </Section>
        );
      })}
      {done.length > 0 && (
        <Section title={`Completadas · ${done.length}`} collapsible defaultOpen={false}>
          <TaskList tasks={done} today={today} projects={projectMap} onEdit={editTask} contextProjectId={project.id} />
        </Section>
      )}
    </>
  );
}

/** Tablero del proyecto: todos los tipos juntos (por grupo de estado) o los estados de un tipo. */
function ProjectBoard({ project, tasks, hasChildren }: { project: Project; tasks: Task[]; hasChildren: boolean }) {
  const { itemTypes } = useApp();
  const [typeIds, setTypeIds] = usePersistentState<string[]>(`project-board-types:${project.id}`, []);
  const single = typeIds.length === 1 ? itemTypes.find((t) => t.id === typeIds[0]) : undefined;
  const visible = typeIds.length ? tasks.filter((t) => typeIds.includes(findType(itemTypes, t.type_id).id)) : tasks;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {itemTypes.map((t) => {
          const on = typeIds.includes(t.id);
          const n = tasks.filter((x) => x.type_id === t.id && x.status === 'todo').length;
          return (
            <button key={t.id} type="button" onClick={() => setTypeIds(on ? typeIds.filter((x) => x !== t.id) : [...typeIds, t.id])}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-sm ${on ? 'font-medium text-white' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'}`}
              style={on ? { background: t.color, borderColor: t.color } : undefined}>
              {on ? <Check className="size-3.5" /> : <span className="size-2 rounded-full" style={{ background: t.color }} />}{t.name}
              <span className={on ? 'text-white/80' : 'text-zinc-400'}>{n}</span>
            </button>
          );
        })}
        {typeIds.length > 0 && <button type="button" onClick={() => setTypeIds([])} className="text-xs text-zinc-500 hover:underline">todos los tipos</button>}
      </div>
      {single
        ? <Board tasks={visible} type={single} defaults={{ project_id: project.id }} showProject={hasChildren} />
        : <CategoryBoard tasks={visible} defaults={{ project_id: project.id }} showProject={hasChildren} />}
    </>
  );
}

