import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { addDays, addMonths, formatDay, isoWeek, isWorkday, monthGrid, parseISODate } from '../../domain/dates';
import { nextMonday } from '../../domain/maintenance';
import type { ISODate } from '../../domain/types';
import { parseDateText } from '../../parser/fields';
import { Popover } from './Popover';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

interface Props {
  value: ISODate | null;
  onChange: (value: ISODate | null) => void;
  /** Permite elegir "Sin fecha". */
  clearable?: boolean;
  autoFocus?: boolean;
}

/**
 * Calendario mensual con número de semana, opciones rápidas y campo de texto que entiende
 * lenguaje natural ("vie", "15 oct", "sin fecha"). Enter en el texto aplica la fecha escrita.
 */
export function DatePicker({ value, onChange, clearable = true, autoFocus = true }: Props) {
  const { today, settings, tasks } = useApp();
  const [month, setMonth] = useState<ISODate>(value ?? today);
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseDateText(text, today) : null;
  const grid = monthGrid(month);
  const currentMonth = parseISODate(month).getMonth();
  const title = parseISODate(month).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  // Carga de cada día (tareas pendientes) para ver de un vistazo qué días están llenos.
  const load = new Map<string, number>();
  for (const t of tasks) if (t.due_date && t.status === 'todo') load.set(t.due_date, (load.get(t.due_date) ?? 0) + 1);

  const quick: { label: string; value: ISODate | null }[] = [
    { label: 'Hoy', value: today },
    { label: 'Mañana', value: addDays(today, 1) },
    { label: 'Lunes', value: nextMonday(today) },
    { label: 'En 1 semana', value: addDays(today, 7) },
    ...(clearable ? [{ label: 'Sin fecha', value: null }] : []),
  ];

  return (
    <div className="w-72 p-1" onKeyDown={(e) => e.stopPropagation()}>
      <input
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed?.ok) { e.preventDefault(); onChange(parsed.value); }
        }}
        placeholder="Escribe: mañana, vie, 15 oct…"
        className="mb-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900"
      />
      {parsed && (
        <p className={`mb-1 px-1 text-xs ${parsed.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
          {parsed.ok ? `Enter → ${parsed.value ? formatDay(parsed.value, today) : 'sin fecha'}` : 'No entiendo esa fecha'}
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-1">
        {quick.map((q) => (
          <button key={q.label} type="button" onClick={() => onChange(q.value)}
            className={`rounded-full px-2 py-0.5 text-xs ${q.value === value ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes anterior"><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => setMonth(today)} className="text-sm font-medium first-letter:uppercase hover:underline" title="Ir a hoy">{title}</button>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes siguiente"><ChevronRight className="size-4" /></button>
      </div>
      <table className="w-full table-fixed text-center text-xs">
        <thead>
          <tr className="text-zinc-400">
            <th className="w-7 font-normal" title="Semana">S</th>
            {WEEKDAYS.map((d) => <th key={d} className="font-medium">{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              <td className="text-[10px] text-zinc-400">{isoWeek(week[0])}</td>
              {week.map((day) => {
                const inMonth = parseISODate(day).getMonth() === currentMonth;
                const selected = day === value;
                const isToday = day === today;
                const n = load.get(day) ?? 0;
                return (
                  <td key={day} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => onChange(day)}
                      title={n ? `${n} tarea${n === 1 ? '' : 's'} ese día` : undefined}
                      className={`relative flex h-7 w-full items-center justify-center rounded-md
                        ${selected ? 'bg-indigo-600 font-semibold text-white' : isToday ? 'font-semibold text-indigo-600 ring-1 ring-indigo-400 dark:text-indigo-400' : ''}
                        ${!selected && !inMonth ? 'text-zinc-300 dark:text-zinc-600' : ''}
                        ${!selected && inMonth && !isWorkday(day, settings.workdays) ? 'text-zinc-400' : ''}
                        ${!selected ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800' : ''}`}
                    >
                      {parseISODate(day).getDate()}
                      {n > 0 && !selected && <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-indigo-400" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Botón que muestra la fecha y abre el calendario en un desplegable. */
export function DateButton({ value, onChange, placeholder = 'Sin fecha', className = '', clearable = true, align = 'left', render }: {
  value: ISODate | null;
  onChange: (value: ISODate | null) => void;
  placeholder?: string;
  className?: string;
  clearable?: boolean;
  align?: 'left' | 'right';
  render?: (value: ISODate | null) => ReactNode;
}) {
  const { today } = useApp();
  return (
    <Popover align={align} width="w-auto" trigger={(toggle) => (
      <button type="button" onClick={toggle} className={className}>
        {render ? render(value) : value ? formatDay(value, today) : <span className="text-zinc-400">{placeholder}</span>}
      </button>
    )}>
      {(close) => <DatePicker value={value} clearable={clearable} onChange={(v) => { close(); onChange(v); }} />}
    </Popover>
  );
}
