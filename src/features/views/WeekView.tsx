import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, TaskList } from '../../components/TaskList';
import { addDays, formatDay, formatMinutes, isoWeek, mondayOf, parseISODate, weekdayName } from '../../domain/dates';
import { overdueTasks, sortTasks, weekPlan } from '../../domain/selectors';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useTaskActions } from '../../hooks/useTaskActions';
import { MeetingItem, OutlookControls } from '../calendar/Meetings';
import { useMeetings } from '../calendar/outlook';
import type { ISODate } from '../../domain/types';
import { LoadBar } from './LoadBar';
import { ViewHeader } from './ViewHeader';

const short = (iso: string) => parseISODate(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

/** Semana de lunes a domingo, con flechas para ir a otras semanas. */
export function WeekView() {
  const { tasks, today, projectMap, settings, editTask } = useApp();
  const { moveIds } = useTaskActions();
  const [start, setStart] = useState(() => mondayOf(today));
  const plan = weekPlan(tasks, start, settings);
  const overdue = overdueTasks(tasks, today).length;
  const totalLoad = plan.reduce((s, d) => s + d.load, 0);
  const totalCap = plan.reduce((s, d) => s + d.capacity, 0);
  const isCurrent = start === mondayOf(today);
  const end = addDays(start, 6);
  // Lo completado ese día también se ve (tachado), para saber cómo fue la semana.
  const doneOn = (date: ISODate) => sortTasks(tasks.filter((t) => t.status === 'done' && !t.deleted_at && t.due_date === date));
  const [showMeetings, setShowMeetings] = usePersistentState('calendar-meetings', true);
  const meetings = useMeetings(start, end);

  return (
    <>
      <ViewHeader
        title={isCurrent ? 'Esta semana' : `Semana ${isoWeek(start)}`}
        subtitle={`Semana ${isoWeek(start)} · ${short(start)} – ${short(end)} · ${formatMinutes(totalLoad)} de ${formatMinutes(totalCap)}${isCurrent && overdue ? ` · ${overdue} atrasadas en Hoy` : ''}`}
        actions={
          <>
            <OutlookControls show={showMeetings} setShow={setShowMeetings} />
            <button type="button" onClick={() => setStart(addDays(start, -7))} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Semana anterior"><ChevronLeft className="size-4" /></button>
            {!isCurrent && <button type="button" onClick={() => setStart(mondayOf(today))} className="rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Esta semana</button>}
            <button type="button" onClick={() => setStart(addDays(start, 7))} className="rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Semana siguiente"><ChevronRight className="size-4" /></button>
          </>
        }
      />
      <QuickAdd placeholder="Añadir tarea: el jueves preparar demo ~2h" />
      {plan.map((day) => {
        const past = day.date < today;
        const done = doneOn(day.date);
        const label = `${weekdayName(day.date, true)} ${parseISODate(day.date).getDate()}`;
        return (
          <Section
            key={day.date}
            title={
              <span className={`inline-flex items-center gap-2 ${past ? 'opacity-60' : ''}`}>
                <span className={day.date === today ? 'text-indigo-600 dark:text-indigo-400' : ''}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
                {day.date === today && <span className="rounded bg-indigo-600 px-1.5 text-[10px] font-semibold text-white normal-case">Hoy</span>}
                {day.tasks.length > 0 && <span className="text-zinc-400">· {day.tasks.length}</span>}
              </span>
            }
            aside={!past && <LoadBar load={day.load} capacity={day.capacity} />}
            onDropTasks={(ids) => void moveIds(ids, { due_date: day.date }, `Movida a ${formatDay(day.date, today).toLowerCase()}`)}
          >
            {showMeetings && (meetings.get(day.date)?.length ?? 0) > 0 && (
              <ul className="mb-1 space-y-0.5">
                {meetings.get(day.date)!.map((m) => <li key={`${m.uid}|${m.time}`}><MeetingItem event={m} /></li>)}
              </ul>
            )}
            <TaskList tasks={[...day.tasks, ...done]} today={today} projects={projectMap} onEdit={editTask} hideDate empty={meetings.get(day.date)?.length && showMeetings ? '' : '—'} />
          </Section>
        );
      })}
    </>
  );
}
