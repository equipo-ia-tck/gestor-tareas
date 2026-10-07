import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckSquare, FileText, MessageSquare, Plus, Quote, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { routeHref } from '../../app/router';
import { Section, TaskList } from '../../components/TaskList';
import { Avatar } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { formatDay } from '../../domain/dates';
import { meetingsWith, mentionsOf } from '../../domain/notes';
import { isActive, peopleIndex, samePerson, sortTasks } from '../../domain/selectors';
import { nameKey } from '../../domain/text';
import { TOPIC_TYPE_ID } from '../../domain/types';
import { newNote } from '../notes/NotesView';
import { ViewHeader } from './ViewHeader';

export function PeopleView() {
  const { tasks, notes, peopleCards } = useApp();
  const people = peopleIndex(tasks);
  // Incluir también a quien solo aparece en notas o tiene ficha.
  for (const n of [...notes.flatMap((x) => x.people), ...peopleCards.map((c) => c.name)]) {
    if (!people.some((p) => samePerson(p.name, n))) people.push({ name: n, count: 0 });
  }
  const role = (name: string) => peopleCards.find((c) => nameKey(c.name) === nameKey(name))?.role;
  const topics = (name: string) => tasks.filter((t) => t.type_id === TOPIC_TYPE_ID && t.status === 'todo' && t.people.some((p) => samePerson(p, name))).length;

  return (
    <>
      <ViewHeader title="Personas" subtitle="Con quién trabajas, qué tienes pendiente con cada una y qué ha dicho" />
      <ul className="grid gap-2 sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.name}>
            <a href={routeHref({ view: 'person', name: p.name })} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800">
              <Avatar name={p.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-xs text-zinc-500">{role(p.name) || 'Sin rol'}</p>
              </div>
              <div className="text-right text-xs text-zinc-500">
                <p>{p.count} tarea{p.count === 1 ? '' : 's'}</p>
                {topics(p.name) > 0 && <p className="text-amber-600">{topics(p.name)} tema{topics(p.name) === 1 ? '' : 's'}</p>}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {people.length === 0 && <p className="px-2 text-sm text-zinc-400">Aún no hay personas. Escribe @nombre al capturar una tarea o en una nota.</p>}
    </>
  );
}

export function PersonView({ name }: { name: string }) {
  const { tasks, notes, peopleCards, today, projectMap, editTask } = useApp();
  const card = peopleCards.find((c) => nameKey(c.name) === nameKey(name));
  const mine = tasks.filter((t) => t.people.some((p) => samePerson(p, name)));
  const topics = sortTasks(mine.filter((t) => t.type_id === TOPIC_TYPE_ID && isActive(t)));
  const talked = mine.filter((t) => t.type_id === TOPIC_TYPE_ID && t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const active = sortTasks(mine.filter((t) => t.type_id !== TOPIC_TYPE_ID && isActive(t)));
  const done = mine.filter((t) => t.type_id !== TOPIC_TYPE_ID && t.status === 'done');
  const said = mentionsOf(name, notes);
  const meetings = meetingsWith(name, notes);
  const list = { today, projects: projectMap, onEdit: editTask };

  return (
    <>
      <header className="mb-6 flex items-start gap-4">
        <Avatar name={name} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{name}</h1>
          <RoleField name={name} value={card?.role ?? ''} notes={card?.notes ?? ''} email={card?.email} />
        </div>
        <button type="button" onClick={() => void newNote('meeting', today, { people: [name], title: `Reunión con ${name}` })}
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
          <Users className="size-4" />Nueva reunión
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Section title={<span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5 text-amber-500" />Temas pendientes · {topics.length}</span>}>
            <TopicAdd name={name} />
            <TaskList {...list} tasks={topics} empty="Nada pendiente de hablar." />
            {talked.length > 0 && <p className="px-2 pt-1 text-xs text-zinc-400">Hablados: {talked.slice(0, 5).map((t) => t.title).join(' · ')}{talked.length > 5 ? '…' : ''}</p>}
          </Section>
          <Section title={<span className="inline-flex items-center gap-1.5"><CheckSquare className="size-3.5" />Tareas · {active.length}</span>}>
            <TaskList {...list} tasks={active} empty="Nada pendiente con esta persona." />
          </Section>
          {done.length > 0 && (
            <Section title={`Completadas · ${done.length}`} collapsible defaultOpen={false}>
              <TaskList {...list} tasks={done} />
            </Section>
          )}
        </div>

        <div className="space-y-5">
          <Card icon={<Quote className="size-4" />} title={`Lo que dijo o se habló · ${said.length}`}>
            {!said.length && <p className="text-xs text-zinc-400">Las líneas de tus notas que mencionan a @{name.replace(/\s+/g, '-')} aparecerán aquí.</p>}
            <ul className="space-y-2">
              {said.slice(0, 30).map((m) => (
                <li key={`${m.note.id}-${m.line}`} className="text-sm">
                  <p className="leading-snug">{m.text}</p>
                  <a href={`#/notes/${m.note.id}`} className="text-[11px] text-zinc-400 hover:underline">
                    {formatDay(m.note.date, today)} · {m.note.title || 'nota'}{m.section ? ` · ${m.section}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <Card icon={<FileText className="size-4" />} title={`Reuniones y notas · ${meetings.length}`}>
            {!meetings.length && <p className="text-xs text-zinc-400">Ninguna todavía.</p>}
            <ul className="space-y-1">
              {meetings.slice(0, 15).map((n) => (
                <li key={n.id}><a href={`#/notes/${n.id}`} className="flex justify-between gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span className="truncate">{n.title || 'Sin título'}</span><span className="shrink-0 text-xs text-zinc-400">{formatDay(n.date, today)}</span>
                </a></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{icon}{title}</h3>
      {children}
    </section>
  );
}

function RoleField({ name, value, notes, email }: { name: string; value: string; notes: string; email?: string }) {
  const [role, setRole] = useState(value);
  const [text, setText] = useState(notes);
  useEffect(() => { setRole(value); setText(notes); }, [value, notes]);
  const save = () => { if (role !== value || text !== notes) void repo.savePerson({ name, role: role.trim(), notes: text, email: email ?? '' }); };
  return (
    <div className="mt-0.5 space-y-1">
      <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        placeholder="Rol (p. ej. Product Owner, Dev, QA…)" className="w-full max-w-sm bg-transparent text-sm text-zinc-500 outline-none placeholder:text-zinc-400 focus:text-zinc-900 dark:focus:text-zinc-100" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={text ? 2 : 1}
        placeholder="Notas sobre la persona: contexto, cómo prefiere trabajar…"
        className="w-full max-w-xl resize-none bg-transparent text-sm text-zinc-600 outline-none placeholder:text-zinc-400 dark:text-zinc-300" />
    </div>
  );
}

function TopicAdd({ name }: { name: string }) {
  const [text, setText] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await repo.batch('Tema añadido', () => repo.createTask({ title: text.trim(), type_id: TOPIC_TYPE_ID, people: [name] }));
    setText('');
  }
  return (
    <form onSubmit={add} className="mb-1 flex items-center gap-2 px-2">
      <Plus className="size-4 text-zinc-400" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Tema para hablar con ${name}…`}
        className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400" />
    </form>
  );
}
