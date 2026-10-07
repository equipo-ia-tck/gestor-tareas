import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, FileText, GitCommitHorizontal, PlusCircle, Undo2, XCircle } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { StatePill } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { addDays, formatDay, mondayOf, parseISODate } from '../../domain/dates';
import { dailyLog, isEmptyDay, type DayLog } from '../../domain/activity';
import type { ActivityEntry } from '../../domain/types';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ViewHeader } from '../views/ViewHeader';


/** Registro: lo que se hizo, lo que se pospuso y lo que se dejó, día a día. */
export function LogView() {
  const { activity, notes, today } = useApp();
  const [weekStart, setWeekStart] = usePersistentState('log-week', mondayOf(today));
  const weekEnd = addDays(weekStart, 6);
  const to = weekEnd > today ? today : weekEnd;
  const days = weekStart > today ? [] : dailyLog(activity, notes, weekStart, to);
  const sum = (k: keyof Pick<DayLog, 'completed' | 'postponed' | 'dropped' | 'created'>) => days.reduce((s, d) => s + d[k].length, 0);
  const isCurrent = weekStart === mondayOf(today);

  return (
    <>
      <ViewHeader
        title="Registro"
        subtitle={`Semana del ${formatDay(weekStart, today).toLowerCase()} al ${formatDay(weekEnd, today).toLowerCase()}`}
        actions={
          <>
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Semana anterior"><ChevronLeft className="size-4" /></button>
            {!isCurrent && <button type="button" onClick={() => setWeekStart(mondayOf(today))} className="rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Esta semana</button>}
            <button type="button" disabled={isCurrent} onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-md p-1.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label="Semana siguiente"><ChevronRight className="size-4" /></button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<CheckCircle2 className="size-4 text-emerald-500" />} label="Hechas" value={sum('completed')} />
        <Stat icon={<Undo2 className="size-4 text-amber-500" />} label="Pospuestas" value={sum('postponed')} />
        <Stat icon={<XCircle className="size-4 text-zinc-400" />} label="Abandonadas" value={sum('dropped')} />
        <Stat icon={<PlusCircle className="size-4 text-indigo-500" />} label="Nuevas" value={sum('created')} />
      </div>
      {days.length === 0 && <p className="text-sm text-zinc-400">Semana futura.</p>}
      <div className="space-y-4">{days.map((d) => <Day key={d.date} day={d} />)}</div>
      {!activity.length && (
        <p className="mt-6 text-sm text-zinc-400">El registro empieza a llenarse a partir de ahora: cada tarea que completes, pospongas o abandones queda apuntada aquí.</p>
      )}
    </>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">{icon}{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Day({ day }: { day: DayLog }) {
  const { today } = useApp();
  const d = parseISODate(day.date);
  const title = `${formatDay(day.date, today)}${day.date === today || day.date === addDays(today, -1) ? ` · ${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}`;
  if (isEmptyDay(day)) {
    return <p className="px-1 text-xs text-zinc-400">{title} · sin actividad</p>;
  }
  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-sm font-semibold first-letter:uppercase">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Group icon={<CheckCircle2 className="size-3.5 text-emerald-500" />} title="Hecho" items={day.completed} render={(e) => <Entry e={e} />} />
        <Group icon={<Undo2 className="size-3.5 text-amber-500" />} title="Pospuesto" items={day.postponed} render={(e) => <Entry e={e} postponed />} />
        <Group icon={<XCircle className="size-3.5 text-zinc-400" />} title="Dejado de hacer" items={day.dropped} render={(e) => <Entry e={e} dropped />} />
        <Group icon={<GitCommitHorizontal className="size-3.5 text-sky-500" />} title="Cambios de estado" items={day.states} render={(e) => <StateEntry e={e} />} />
        <Group icon={<PlusCircle className="size-3.5 text-indigo-500" />} title="Nuevas" items={day.created} render={(e) => <Entry e={e} />} />
        {day.notes.length > 0 && (
          <div>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase"><FileText className="size-3.5" />Notas · {day.notes.length}</h3>
            <ul className="space-y-0.5">
              {day.notes.map((n) => <li key={n.id}><a href={`#/notes/${n.id}`} className="text-sm hover:underline">{n.title || 'Sin título'}</a></li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Group({ icon, title, items, render }: { icon: ReactNode; title: string; items: ActivityEntry[]; render: (e: ActivityEntry) => ReactNode }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{icon}{title} · {items.length}</h3>
      <ul className="space-y-0.5">{items.map((e) => <li key={e.id}>{render(e)}</li>)}</ul>
    </div>
  );
}

function Entry({ e, postponed: isPostponed, dropped }: { e: ActivityEntry; postponed?: boolean; dropped?: boolean }) {
  const { tasks, projectMap, today, editTask, postponed } = useApp();
  const task = tasks.find((t) => t.id === e.task_id);
  const project = e.project_id ? projectMap.get(e.project_id) : undefined;
  const times = postponed.get(e.task_id) ?? 0;
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {project && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: project.color }} title={project.name} />}
      {task ? <button type="button" onClick={() => editTask(task)} className="min-w-0 truncate text-left hover:underline">{e.title}</button> : <span className="truncate text-zinc-500">{e.title}</span>}
      {isPostponed && (
        <span className="shrink-0 text-xs text-zinc-400">
          {e.from ? formatDay(e.from, today).toLowerCase() : '—'} <ArrowRight className="inline size-3" /> {e.to ? formatDay(e.to, today).toLowerCase() : 'sin fecha'}
          {times > 1 && <span className="ml-1 text-amber-600">({times}×)</span>}
        </span>
      )}
      {dropped && (
        <span className="shrink-0 text-xs text-zinc-400">
          {e.kind === 'deleted' ? 'eliminada' : 'archivada'}
          {e.kind === 'deleted' && !task && (
            <button type="button" onClick={() => void repo.batch('Tarea restaurada', () => repo.restoreTask(e.task_id))} className="ml-1 text-indigo-600 hover:underline dark:text-indigo-400">restaurar</button>
          )}
        </span>
      )}
    </div>
  );
}

function StateEntry({ e }: { e: ActivityEntry }) {
  const { itemTypes, tasks, editTask } = useApp();
  const states = itemTypes.flatMap((t) => t.states);
  const from = states.find((s) => s.id === e.from);
  const to = states.find((s) => s.id === e.to);
  const task = tasks.find((t) => t.id === e.task_id);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {task ? <button type="button" onClick={() => editTask(task)} className="truncate hover:underline">{e.title}</button> : <span className="truncate">{e.title}</span>}
      {from && <StatePill state={from} />}<ArrowRight className="size-3 text-zinc-400" />{to && <StatePill state={to} />}
    </div>
  );
}
