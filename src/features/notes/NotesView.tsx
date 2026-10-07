import { ProjectOptions } from '../../components/ui/ProjectOptions';
import { DateButton } from '../../components/ui/DatePicker';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckSquare, FileText, ListChecks, MessageSquare, Pin, Plus, Search, Trash2, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useWideLayout } from '../../app/Layout';
import { navigate } from '../../app/router';
import { AvatarStack, StatePill } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { formatDay } from '../../domain/dates';
import { actionItems } from '../../domain/markdown';
import { defaultNoteTitle, matchesNote, meetingTemplate, noteExcerpt, sortNotes } from '../../domain/notes';
import { knownPeople } from '../../domain/selectors';
import { fold, nameKey } from '../../domain/text';
import { TOPIC_TYPE_ID, type Note, type NoteKind } from '../../domain/types';
import { stateOf } from '../../domain/workflows';
import { createTasksFromActions, toggleAction } from './noteActions';
import { IcsImport } from './IcsImport';
import { MeetingLink, ShareMeeting } from './MeetingTools';
import { taskLabel } from './TaskNotes';
import { TypeBadge } from '../../components/ui/Badges';
import { findType } from '../../domain/workflows';
import { NoteEditor } from './NoteEditor';

/** Crea una nota o un acta (con plantilla) y la abre. */
export async function newNote(kind: NoteKind, today: string, fields: Partial<Note> = {}) {
  const n = await repo.createNote({
    date: today, kind, title: defaultNoteTitle(kind, today),
    body: kind === 'meeting' ? meetingTemplate(fields.people ?? []) : '',
    ...fields,
  });
  navigate({ view: 'notes', id: n.id });
  return n;
}

/** Notas y actas: lista a la izquierda, nota abierta a la derecha. */
export function NotesView({ id }: { id?: string }) {
  useWideLayout(true);
  const { notes, tasks, today } = useApp();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<NoteKind | 'item' | ''>('');
  const [projectId, setProjectId] = useState('');

  const list = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    // Las notas de un elemento pertenecen al proyecto de ese elemento (aunque se mueva).
    const projectOf = (n: Note) => (n.task_id ? tasks.find((t) => t.id === n.task_id)?.project_id ?? n.project_id : n.project_id);
    const kindOk = (n: Note) => !kind || (kind === 'item' ? !!n.task_id : n.kind === kind && !n.task_id);
    return sortNotes(notes.filter((n) =>
      kindOk(n) && (!projectId || projectOf(n) === projectId) && (!words.length || matchesNote(n, words))));
  }, [notes, tasks, query, kind, projectId]);
  const current = id ? notes.find((n) => n.id === id) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Notas</h1>
          <div className="flex gap-1">
            <button type="button" onClick={() => void newNote('meeting', today)} className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-indigo-500">
              <Plus className="size-4" />Acta
            </button>
            <button type="button" onClick={() => void newNote('note', today)} className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
              <Plus className="size-4" />Nota
            </button>
            <IcsImport />
          </div>
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en notas…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1 pr-2 pl-7 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="mb-3 flex gap-1.5 text-xs">
          {([['', 'Todas'], ['meeting', 'Actas'], ['note', 'Notas'], ['item', 'De elementos']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-full px-2.5 py-0.5 ${kind === k ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{label}</button>
          ))}
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ml-auto rounded-md border border-zinc-200 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-900" aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            <ProjectOptions />
          </select>
        </div>
        <ul className="space-y-1">
          {list.map((n) => <NoteItem key={n.id} note={n} active={n.id === id} />)}
          {!list.length && <li className="px-2 py-6 text-center text-sm text-zinc-400">{notes.length ? 'Nada coincide.' : 'Aún no hay notas. Crea un acta para tu próxima reunión.'}</li>}
        </ul>
      </aside>
      <section className="min-w-0">
        {current ? <NotePage key={current.id} note={current} /> : (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
            <FileText className="mb-2 size-6" />Elige una nota o crea un acta nueva
          </div>
        )}
      </section>
    </div>
  );
}

function NoteItem({ note, active }: { note: Note; active: boolean }) {
  const { projectMap, today, tasks, itemTypes } = useApp();
  const task = note.task_id ? tasks.find((t) => t.id === note.task_id) : undefined;
  const projectId = task?.project_id ?? note.project_id;
  const project = projectId ? projectMap.get(projectId) : undefined;
  const actions = actionItems(note.body);
  const Icon = note.kind === 'meeting' ? Users : FileText;
  return (
    <li>
      <a href={`#/notes/${note.id}`} className={`block rounded-lg px-2.5 py-2 ${active ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'}`}>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {task ? <TypeBadge type={findType(itemTypes, task.type_id)} /> : <Icon className="size-3.5 shrink-0 text-zinc-400" />}
          <span className="truncate">{task ? taskLabel(task) : note.title || 'Sin título'}</span>
          {note.pinned && <Pin className="size-3 shrink-0 text-amber-500" />}
        </div>
        {noteExcerpt(note) && <p className="mt-0.5 truncate text-xs text-zinc-500">{noteExcerpt(note)}</p>}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
          <span>{formatDay(note.date, today)}</span>
          {project && <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: project.color }} />{project.name}</span>}
          {actions.length > 0 && <span className="inline-flex items-center gap-0.5"><CheckSquare className="size-3" />{actions.filter((a) => a.checked).length}/{actions.length}</span>}
          <span className="flex-1" />
          <AvatarStack names={note.people} size={16} />
        </div>
      </a>
    </li>
  );
}

function NotePage({ note }: { note: Note }) {
  const { tasks, projects, today, itemTypes, releases } = useApp();
  const [title, setTitle] = useState(note.title);
  useEffect(() => setTitle(note.title), [note.title]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const ctx = { today, projects, people: knownPeople(tasks), types: itemTypes, releases };
  const actions = actionItems(note.body);
  const unlinked = actions.filter((a) => !a.taskId);

  return (
    <article className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {(['meeting', 'note'] as NoteKind[]).map((k) => (
            <button key={k} type="button" onClick={() => void repo.updateNote(note.id, { kind: k })}
              className={`rounded px-2 py-0.5 text-xs ${note.kind === k ? 'bg-white font-medium shadow-sm dark:bg-zinc-900' : 'text-zinc-500'}`}>{k === 'meeting' ? 'Acta' : 'Nota'}</button>
          ))}
        </div>
        <DateButton value={note.date} clearable={false} onChange={(d) => d && void repo.updateNote(note.id, { date: d })}
          className="rounded-md border border-transparent px-1.5 py-0.5 text-zinc-600 hover:border-zinc-200 dark:text-zinc-300 dark:hover:border-zinc-700" />
        <select value={note.project_id ?? ''} onChange={(e) => void repo.updateNote(note.id, { project_id: e.target.value || null })}
          className="rounded-md border border-transparent bg-transparent px-1 text-zinc-600 hover:border-zinc-200 dark:text-zinc-300 dark:hover:border-zinc-700" aria-label="Proyecto">
          <option value="">Sin proyecto</option>
          <ProjectOptions />
        </select>
        {note.people.length > 0 && <span className="flex items-center gap-1.5 text-xs text-zinc-500"><AvatarStack names={note.people} max={6} size={20} /></span>}
        <span className="flex-1" />
        {note.kind === 'meeting' && <ShareMeeting note={note} />}
        <button type="button" title={note.pinned ? 'Desfijar' : 'Fijar arriba'} onClick={() => void repo.updateNote(note.id, { pinned: !note.pinned })}
          className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${note.pinned ? 'text-amber-500' : 'text-zinc-400'}`}><Pin className="size-4" /></button>
        <button type="button" title="Eliminar" onClick={() => { void repo.deleteNote(note.id); navigate({ view: 'notes' }); }}
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"><Trash2 className="size-4" /></button>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título"
        onBlur={() => { if (title.trim() !== note.title) void repo.updateNote(note.id, { title: title.trim() }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="mb-3 w-full bg-transparent text-2xl font-bold outline-none placeholder:text-zinc-300" />
      {note.task_id && <TaskOrigin taskId={note.task_id} />}
      {note.kind === 'meeting' && <MeetingLink note={note} />}

      <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
        <NoteEditor
          note={note}
          onToggle={(line, taskId) => void toggleAction(note, line, taskId, taskMap)}
          onMakeTask={(line) => void createTasksFromActions(note, ctx, actions.find((a) => a.line === line))}
        />
        <div className="space-y-5 text-sm">
          <SidePanel icon={<ListChecks className="size-4" />} title={`Acciones · ${actions.filter((a) => (a.taskId ? taskMap.get(a.taskId)?.status === 'done' : a.checked)).length}/${actions.length}`}>
            {actions.length === 0 && <p className="text-xs text-zinc-400">Escribe acciones con <code>- [ ] …</code> (admiten @persona, fechas y !1).</p>}
            {unlinked.length > 0 && (
              <button type="button" onClick={() => void createTasksFromActions(note, ctx)}
                className="mb-2 w-full rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500">
                Convertir {unlinked.length} en tarea{unlinked.length === 1 ? '' : 's'}
              </button>
            )}
            <LinkedTasks ids={actions.flatMap((a) => (a.taskId ? [a.taskId] : []))} />
          </SidePanel>
          <AttendeeTopics people={note.people} />
        </div>
      </div>
    </article>
  );
}

/** En una nota de un elemento: de qué US/TS es (abre su panel). */
function TaskOrigin({ taskId }: { taskId: string }) {
  const { tasks, itemTypes, editTask } = useApp();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return <p className="mb-3 text-xs text-zinc-400">Nota de un elemento eliminado.</p>;
  const type = findType(itemTypes, task.type_id);
  return (
    <button type="button" onClick={() => editTask(task)}
      className="mb-3 flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1 text-sm hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
      <span className="text-xs text-zinc-500">Nota de</span><TypeBadge type={type} /><span className="font-medium">{taskLabel(task)}</span>
      <StatePill state={stateOf(itemTypes, task)} />
    </button>
  );
}

function SidePanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{icon}{title}</h3>
      {children}
    </section>
  );
}

function LinkedTasks({ ids }: { ids: string[] }) {
  const { tasks, itemTypes, editTask } = useApp();
  const linked = ids.map((i) => tasks.find((t) => t.id === i)).filter((t) => !!t);
  if (!linked.length) return null;
  return (
    <ul className="space-y-1">
      {linked.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => editTask(t)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <span className={`flex-1 truncate ${t.status === 'done' ? 'text-zinc-400 line-through' : ''}`}>{t.title}</span>
            <StatePill state={stateOf(itemTypes, t)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** En una reunión: los temas pendientes que tenías con cada asistente. */
function AttendeeTopics({ people }: { people: string[] }) {
  const { tasks } = useApp();
  const topics = tasks.filter((t) => t.type_id === TOPIC_TYPE_ID && t.status === 'todo' && t.people.some((p) => people.some((a) => nameKey(a) === nameKey(p))));
  if (!people.length) return null;
  return (
    <SidePanel icon={<MessageSquare className="size-4" />} title="Temas pendientes con los asistentes">
      {!topics.length && <p className="text-xs text-zinc-400">Ninguno. Añádelos desde la ficha de cada persona.</p>}
      <ul className="space-y-1">
        {topics.map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-xs">
            <button type="button" title="Marcar como hablado" onClick={() => void repo.setCompleted(t.id, true)}
              className="mt-0.5 size-3.5 shrink-0 rounded-full border border-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950" />
            <span className="flex-1">{t.title} <span className="text-zinc-400">· {t.people.join(', ')}</span></span>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}
