import { useEffect, useState } from 'react';
import { WeekView } from '../views/WeekView';
import { ChevronLeft, ChevronRight, Rocket } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useWideLayout } from '../../app/Layout';
import { TypeBadge } from '../../components/ui/Badges';
import { addMonths, isWorkday, monthGrid, parseISODate } from '../../domain/dates';
import { sortTasks } from '../../domain/selectors';
import type { ISODate, Task } from '../../domain/types';
import { findType } from '../../domain/workflows';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useTaskActions } from '../../hooks/useTaskActions';
import { dropHighlight, setDraggedTasks, useTaskDrop } from '../../hooks/useTaskDrop';
import { ViewHeader } from '../views/ViewHeader';

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MAX_VISIBLE = 4;

/** Calendario mensual con vencimientos y releases. Arrastrar una tarea a otro día cambia su fecha. */
/** Calendario con dos vistas: Semana (lunes a domingo, en lista) y Mes (cuadrícula). */
export function CalendarView({ initial }: { initial?: 'week' | 'month' }) {
  const [mode, setMode] = usePersistentState<'week' | 'month'>('calendar-mode', initial ?? 'week');
  // Si se llega desde #/week o G S, se abre la semana.
  useEffect(() => { if (initial) setMode(initial); }, [initial]); // setMode guarda en localStorage
  return (
    <>
      <div className="mb-3 inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {(['week', 'month'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            className={`rounded-md px-3 py-1 text-sm ${mode === m ? 'bg-white font-medium shadow-sm dark:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
            {m === 'week' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>
      {mode === 'week' ? <WeekView /> : <MonthView />}
    </>
  );
}

function MonthView() {
  useWideLayout(true);
  const { tasks, releases, today } = useApp();
  const [month, setMonth] = usePersistentState<ISODate>('calendar-month', today);
  const [showDone, setShowDone] = usePersistentState('calendar-done', false);
  const grid = monthGrid(month);
  const current = parseISODate(month).getMonth();
  const raw = parseISODate(month).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);

  const byDay = new Map<ISODate, Task[]>();
  for (const t of tasks) {
    if (!t.due_date || t.deleted_at || t.status === 'archived' || (!showDone && t.status === 'done')) continue;
    byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  }

  return (
    <>
      <ViewHeader
        title={title}
        subtitle="Vencimientos y releases. Arrastra una tarea a otro día para moverla."
        actions={
          <>
            <label className="mr-2 flex items-center gap-1.5 text-xs text-zinc-500">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Completadas
            </label>
            <button type="button" onClick={() => setMonth(addMonths(month, -1))} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes anterior"><ChevronLeft className="size-4" /></button>
            <button type="button" onClick={() => setMonth(today)} className="rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Hoy</button>
            <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes siguiente"><ChevronRight className="size-4" /></button>
          </>
        }
      />
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        {grid.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-zinc-200 last:border-0 dark:border-zinc-800">
            {week.map((day) => (
              <DayCell
                key={day}
                day={day}
                inMonth={parseISODate(day).getMonth() === current}
                tasks={sortTasks(byDay.get(day) ?? [])}
                releases={releases.filter((r) => r.date === day && r.status !== 'cancelled')}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function DayCell({ day, inMonth, tasks, releases }: {
  day: ISODate;
  inMonth: boolean;
  tasks: Task[];
  releases: { id: string; name: string; status: string }[];
}) {
  const { today, settings, itemTypes, projectMap, editTask, detailId } = useApp();
  const { moveIds } = useTaskActions();
  const { over, dropProps } = useTaskDrop((ids) => void moveIds(ids, { due_date: day }, 'Fecha cambiada'));
  const isToday = day === today;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tasks : tasks.slice(0, MAX_VISIBLE);
  const extra = tasks.length - visible.length;

  return (
    <div
      {...dropProps}
      className={`min-h-28 border-r border-zinc-200 p-1 last:border-r-0 dark:border-zinc-800
        ${inMonth ? '' : 'bg-zinc-50/70 text-zinc-400 dark:bg-zinc-900/40'}
        ${!isWorkday(day, settings.workdays) && inMonth ? 'bg-zinc-50/40 dark:bg-zinc-900/20' : ''}
        ${over ? dropHighlight : ''}`}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs ${isToday ? 'bg-indigo-600 font-semibold text-white' : ''}`}>
          {parseISODate(day).getDate()}
        </span>
      </div>
      <ul className="space-y-0.5">
        {releases.map((r) => (
          <li key={r.id} className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] font-semibold ${r.status === 'released' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300'}`}>
            <Rocket className="size-3 shrink-0" />{r.name}
          </li>
        ))}
        {visible.map((t) => {
          const project = t.project_id ? projectMap.get(t.project_id) : undefined;
          const late = t.status === 'todo' && day < today;
          return (
            <li key={t.id}>
              <button
                type="button"
                draggable
                onDragStart={(e) => setDraggedTasks(e, [t.id])}
                onClick={() => editTask(t)}
                title={t.title}
                className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800
                  ${t.status === 'done' ? 'text-zinc-400 line-through' : late ? 'text-amber-700 dark:text-amber-400' : ''}
                  ${detailId === t.id ? 'ring-1 ring-indigo-400' : ''}`}
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: project?.color ?? '#a1a1aa' }} />
                <TypeBadge type={findType(itemTypes, t.type_id)} />
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          );
        })}
        {extra > 0 && (
          <li>
            <button type="button" onClick={() => setExpanded(true)} className="px-1 text-[11px] text-zinc-500 hover:underline">+{extra} más</button>
          </li>
        )}
      </ul>
    </div>
  );
}
