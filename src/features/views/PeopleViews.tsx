import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CheckSquare, FileText, Layers, MessageCircle, MessageSquare, Plus, Quote, UserCog, Users } from 'lucide-react';
import { MenuItem, Popover } from '../../components/ui/Popover';
import { fuzzyScore } from '../../domain/text';
import { navigate } from '../../app/router';
import { teamsChatUrl } from '../../domain/teams';
import { useApp } from '../../app/AppContext';
import { routeHref } from '../../app/router';
import { Section, TaskList } from '../../components/TaskList';
import { Avatar } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { formatDay } from '../../domain/dates';
import { meetingsWith, mentionsOf } from '../../domain/notes';
import { peopleDirectory } from '../../domain/people';
import { isActive, samePerson, sortTasks } from '../../domain/selectors';
import { nameKey } from '../../domain/text';
import { TOPIC_TYPE_ID } from '../../domain/types';
import { newNote } from '../notes/NotesView';
import { useRallyOwners } from '../rally/rallyStore';
import { teamsLinkProps, useTeamsApp } from '../../hooks/useTeamsApp';
import { ViewHeader } from './ViewHeader';

export function PeopleView() {
  const { tasks, notes, peopleCards } = useApp();
  // Personas con tareas, mencionadas en notas, con ficha u Owners en Rally de las tareas enlazadas.
  const rallyOwners = useRallyOwners(tasks);
  const people = peopleDirectory(tasks, notes, peopleCards, rallyOwners);
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
                <p>{p.tasks} tarea{p.tasks === 1 ? '' : 's'}{p.notes ? ` · ${p.notes} nota${p.notes === 1 ? '' : 's'}` : ''}</p>
                {p.rally > 0 && <p className="text-indigo-600 dark:text-indigo-400">Owner de {p.rally} en Rally</p>}
                {topics(p.name) > 0 && <p className="text-amber-600">{topics(p.name)} para hablar</p>}
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
  // Tareas enlazadas con Rally de las que es Owner allí (las que ya la tienen en Personas salen arriba).
  const rallyOwners = useRallyOwners(tasks);
  const owned = tasks.filter((t) => !mine.includes(t) && samePerson(rallyOwners.get(t.id) ?? '', name));
  const ownedActive = sortTasks(owned.filter(isActive));
  const ownedDone = owned.filter((t) => t.status === 'done');
  const said = mentionsOf(name, notes);
  const [teamsApp] = useTeamsApp();
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
        {card?.email && teamsChatUrl([card.email]) && (
          <a {...teamsLinkProps(teamsChatUrl([card.email])!, teamsApp)}
            className="flex items-center gap-1 rounded-md bg-[#5b5fc7] px-2.5 py-1 text-sm font-medium text-white hover:bg-[#4b4fb7]">
            <MessageCircle className="size-4" />Chat en Teams
          </a>
        )}
        <RenamePerson name={name} />
        <button type="button" onClick={() => void newNote('meeting', today, { people: [name], title: `Reunión con ${name}` })}
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
          <Users className="size-4" />Nueva reunión
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Section title={<span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5 text-amber-500" />Para hablar · {topics.length}</span>}>
            <TopicAdd name={name} />
            <TaskList {...list} tasks={topics} empty="Nada pendiente de hablar." />
            {talked.length > 0 && <p className="px-2 pt-1 text-xs text-zinc-400">Hablados: {talked.slice(0, 5).map((t) => t.title).join(' · ')}{talked.length > 5 ? '…' : ''}</p>}
          </Section>
          <Section title={<span className="inline-flex items-center gap-1.5"><CheckSquare className="size-3.5" />Tareas · {active.length}</span>}>
            <TaskList {...list} tasks={active} empty="Nada pendiente con esta persona." />
          </Section>
          {owned.length > 0 && (
            <Section title={<span className="inline-flex items-center gap-1.5"><Layers className="size-3.5 text-indigo-500" />Owner en Rally · {ownedActive.length}</span>}>
              <TaskList {...list} tasks={ownedActive} empty="Nada pendiente de lo que lleva en Rally." />
              {ownedDone.length > 0 && <p className="px-2 pt-1 text-xs text-zinc-400">Y {ownedDone.length} terminada{ownedDone.length === 1 ? '' : 's'} en el gestor.</p>}
            </Section>
          )}
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
                <li key={`${m.note.id}-${m.line}`} className="group text-sm">
                  <p className="leading-snug">{m.text}</p>
                  <MentionActions name={name} text={m.text} noteTitle={m.note.title} projectId={m.note.project_id} />
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

/** Convertir una línea de una nota en tarea o tema de esta persona (si no lo es ya). */
function MentionActions({ name, text, noteTitle, projectId }: { name: string; text: string; noteTitle: string; projectId: string | null }) {
  const { tasks } = useApp();
  // "@Diana: revisar los TS" → "revisar los TS" (la persona ya va en el campo Personas).
  const title = text.replace(/^@[\p{L}\p{N}_\-.]+[:,]?\s*/u, '').replace(/(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu, (_, n: string) => n.replace(/-/g, ' ')).trim();
  const exists = tasks.find((t) => nameKey(t.title) === nameKey(title) && t.people.some((p) => samePerson(p, name)));
  if (!title) return null;
  if (exists) return <span className="mr-2 text-[11px] text-emerald-600">✓ {exists.type_id === TOPIC_TYPE_ID ? 'Está en Para hablar' : 'Ya es una tarea'}</span>;
  const create = (topic: boolean) => repo.batch(topic ? 'Añadido a Para hablar' : 'Tarea creada', () => repo.createTask({
    title, people: [name], type_id: topic ? TOPIC_TYPE_ID : undefined, project_id: topic ? null : projectId, notes: `De: ${noteTitle || 'nota'}`,
  }));
  return (
    <span className="mr-2 inline-flex gap-1 opacity-60 group-hover:opacity-100">
      <button type="button" onClick={() => void create(false)} className="rounded bg-indigo-50 px-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300">→ Tarea</button>
      <button type="button" onClick={() => void create(true)} className="rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300">→ Para hablar</button>
    </span>
  );
}

/** Renombrar a la persona o unirla con otra (p. ej. "Diana Pérez" del calendario con "Diana"). */
function RenamePerson({ name }: { name: string }) {
  const { tasks, notes, peopleCards } = useApp();
  const [value, setValue] = useState('');
  const others = peopleDirectory(tasks, notes, peopleCards).filter((p) => nameKey(p.name) !== nameKey(name));
  const matches = value.trim() ? others.filter((p) => fuzzyScore(value, p.name) !== null).slice(0, 6) : others.slice(0, 6);
  const exact = others.find((p) => nameKey(p.name) === nameKey(value));
  async function apply(to: string, close: () => void) {
    if (!to.trim()) return;
    await repo.renamePerson(name, to.trim());
    close();
    setValue('');
    navigate({ view: 'person', name: to.trim() });
  }
  return (
    <Popover align="right" width="w-72" trigger={(toggle) => (
      <button type="button" onClick={toggle} className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
        <UserCog className="size-4" />Renombrar o unir…
      </button>
    )}>
      {(close) => (
        <div className="p-1">
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Nuevo nombre o persona con la que unir"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(exact?.name ?? value, close); } }}
            className="mb-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
          <p className="px-1 pb-1 text-[11px] text-zinc-400">Unir con:</p>
          {matches.map((p) => (
            <MenuItem key={p.name} onClick={() => void apply(p.name, close)}>
              <Avatar name={p.name} size={18} /><span className="flex-1 truncate">{p.name}</span>
              <span className="text-[11px] text-zinc-400">{p.tasks} tareas</span>
            </MenuItem>
          ))}
          {value.trim() && !exact && (
            <MenuItem onClick={() => void apply(value, close)}>Renombrar a <strong>{value.trim()}</strong></MenuItem>
          )}
          <p className="px-1 pt-1 text-[11px] text-zinc-400">Cambia el nombre en sus tareas, menciones de notas y ficha. Se puede deshacer.</p>
        </div>
      )}
    </Popover>
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

function RoleField({ name, value, notes, email = '' }: { name: string; value: string; notes: string; email?: string }) {
  const [role, setRole] = useState(value);
  const [text, setText] = useState(notes);
  const [mail, setMail] = useState(email);
  useEffect(() => { setRole(value); setText(notes); setMail(email); }, [value, notes, email]);
  const save = () => {
    if (role !== value || text !== notes || mail !== email) void repo.savePerson({ name, role: role.trim(), notes: text, email: mail.trim() });
  };
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  return (
    <div className="mt-0.5 space-y-1">
      <div className="flex flex-wrap gap-x-4">
        <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={save} onKeyDown={blurOnEnter}
          placeholder="Rol (p. ej. Product Owner, Dev, QA…)" className="w-56 bg-transparent text-sm text-zinc-500 outline-none placeholder:text-zinc-400 focus:text-zinc-900 dark:focus:text-zinc-100" />
        <input value={mail} onChange={(e) => setMail(e.target.value)} onBlur={save} onKeyDown={blurOnEnter} type="email"
          placeholder="email (para chatear en Teams)" className="w-64 bg-transparent text-sm text-zinc-500 outline-none placeholder:text-zinc-400 focus:text-zinc-900 dark:focus:text-zinc-100" />
      </div>
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
    await repo.batch('Añadido a Para hablar', () => repo.createTask({ title: text.trim(), type_id: TOPIC_TYPE_ID, people: [name] }));
    setText('');
  }
  return (
    <form onSubmit={add} className="mb-1 flex items-center gap-2 px-2">
      <Plus className="size-4 text-zinc-400" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Algo que hablar con ${name}…`}
        className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400" />
    </form>
  );
}
