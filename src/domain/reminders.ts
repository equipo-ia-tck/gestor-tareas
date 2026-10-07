import { addDays, toISODate, weekdayOf } from './dates';
import type { ISODate, Task } from './types';

/** Recordatorios vencidos (la hora ya pasó) de tareas activas, del más antiguo al más reciente. */
export function dueReminders(tasks: Task[], now: Date): Task[] {
  const t = now.toISOString();
  return tasks
    .filter((x) => x.remind_at && x.remind_at <= t && x.status === 'todo' && !x.deleted_at)
    .sort((a, b) => a.remind_at!.localeCompare(b.remind_at!));
}

/** Próximo recordatorio pendiente (para programar el temporizador). */
export function nextReminderAt(tasks: Task[], now: Date): string | null {
  const t = now.toISOString();
  const next = tasks
    .filter((x) => x.remind_at && x.remind_at > t && x.status === 'todo' && !x.deleted_at)
    .map((x) => x.remind_at!)
    .sort()[0];
  return next ?? null;
}

/** ISO de un día local a una hora local. */
export function atLocal(day: ISODate, hours: number, minutes = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hours, minutes).toISOString();
}

/** Opciones rápidas: en 1 hora, esta tarde, mañana a las 9, el lunes a las 9. */
export function quickReminders(now: Date): { label: string; at: string }[] {
  const today = toISODate(now);
  const inHour = new Date(now.getTime() + 60 * 60_000);
  inHour.setSeconds(0, 0);
  const out = [{ label: 'En 1 hora', at: inHour.toISOString() }];
  if (now.getHours() < 17) out.push({ label: 'Esta tarde (17:00)', at: atLocal(today, 17) });
  out.push({ label: 'Mañana (9:00)', at: atLocal(addDays(today, 1), 9) });
  const toMonday = (8 - weekdayOf(today)) % 7 || 7;
  out.push({ label: 'El lunes (9:00)', at: atLocal(addDays(today, toMonday), 9) });
  return out;
}

/** "Hoy 17:00", "mañana 9:00", "vie 10 oct 9:00". */
export function formatReminder(iso: string, now: Date, formatDay: (d: ISODate, today: ISODate) => string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${formatDay(toISODate(d), toISODate(now))} ${time}`;
}

/** Valor para un <input type="datetime-local"> (hora local, sin segundos). */
export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
