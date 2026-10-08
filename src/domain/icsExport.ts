import { atLocal } from './reminders';
import type { Task } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
/** Fecha y hora UTC en formato iCalendar: 20261009T070000Z. */
const icsUtc = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliega líneas largas (máximo 75 caracteres, las siguientes empiezan por espacio). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

export interface IcsContext {
  /** Ruta del proyecto ("caixa / Sprint 14"), si tiene. */
  projectPath?: string;
  now?: Date;
}

/**
 * Evento de calendario (.ics) para llevar una tarea a Outlook y que avise aunque la app esté
 * cerrada. Con recordatorio: a esa hora (30 min). Sin él, con fecha: ese día a las 9:00 (15 min).
 * La alarma salta al empezar el evento. Devuelve null si la tarea no tiene fecha ni aviso.
 */
export function taskToIcs(task: Task, ctx: IcsContext = {}): string | null {
  let start: string;
  let minutes: number;
  if (task.remind_at) { start = task.remind_at; minutes = 30; }
  else if (task.due_date) { start = atLocal(task.due_date, 9); minutes = 15; }
  else return null;
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  const title = task.external_id ? `${task.external_id} · ${task.title}` : task.title;
  const description = [
    ctx.projectPath && `Proyecto: ${ctx.projectPath}`,
    task.people.length > 0 && `Personas: ${task.people.join(', ')}`,
    task.due_date && `Fecha límite: ${task.due_date.split('-').reverse().join('/')}`,
    task.notes && `\n${task.notes}`,
    '\n(Creado desde Tareas)',
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gestor de tareas//ES',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${task.id}@gestor-tareas`,
    `DTSTAMP:${icsUtc((ctx.now ?? new Date()).toISOString())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(title)}`,
    'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Nombre de archivo sencillo a partir del título. */
export const icsFileName = (task: Pick<Task, 'title'>) =>
  `${task.title.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarea'}.ics`;
