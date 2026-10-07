import { actionItems, plainLine } from './markdown';
import type { Note, Task } from './types';

/** Líneas con contenido de una sección del acta ("Decisiones", "Notas"…). */
function sectionLines(body: string, name: string): string[] {
  const lines = body.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const raw of lines) {
    const h = /^\s*#{1,3}\s+(.*)$/.exec(raw);
    if (h) { inside = h[1].trim().toLowerCase().startsWith(name.toLowerCase()); continue; }
    if (!inside) continue;
    const t = plainLine(raw).replace(/\[\[t:[\w-]+\]\]/g, '').trim();
    if (t && !/^\[[ xX]\]/.test(t)) out.push(t);
  }
  return out;
}

/** Quita la marca @ de las menciones ("@Diana-Pérez" → "Diana Pérez"). */
const unmention = (s: string) => s.replace(/(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_\-.]*[\p{L}\p{N}_])/gu, (_, n: string) => n.replace(/-/g, ' '));

/**
 * Resumen del acta en texto plano para pegar en Teams (o en un correo): asistentes, decisiones
 * y acciones con su estado (si la acción está enlazada a una tarea, manda el estado de la tarea).
 */
export function meetingSummary(note: Note, tasks: Map<string, Task> = new Map()): string {
  const date = note.date.split('-').reverse().join('/');
  const out = [`${note.title || 'Reunión'} · ${date}`];
  if (note.people.length) out.push(`Asistentes: ${note.people.join(', ')}`);
  const decisions = sectionLines(note.body, 'Decisi');
  if (decisions.length) out.push('', 'Decisiones:', ...decisions.map((d) => `• ${unmention(d)}`));
  const actions = actionItems(note.body);
  if (actions.length) {
    out.push('', 'Acciones:');
    for (const a of actions) {
      const task = a.taskId ? tasks.get(a.taskId) : undefined;
      const done = task ? task.status === 'done' : a.checked;
      const due = task?.due_date ? ` (${task.due_date.split('-').reverse().slice(0, 2).join('/')})` : '';
      out.push(`${done ? '☑' : '☐'} ${unmention(plainLine(`- ${a.text}`))}${due}`);
    }
  }
  return out.join('\n');
}

/** Enlace para abrir en Teams un chat con esas personas, con tema y mensaje precargados. */
export function teamsChatUrl(emails: string[], topic?: string, message?: string): string | null {
  const valid = emails.map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (!valid.length) return null;
  const params = new URLSearchParams({ users: valid.join(',') });
  if (topic && valid.length > 1) params.set('topicName', topic.slice(0, 100));
  // Teams admite mensajes precargados; se acortan para no superar el límite de longitud de la URL.
  if (message) params.set('message', message.length > 1200 ? `${message.slice(0, 1190)}…` : message);
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}

/** Enlace de una reunión de Teams dentro de un texto (descripción o ubicación del evento). */
export function findTeamsLink(text: string): string | null {
  return /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"<>)\]]+/i.exec(text)?.[0] ?? null;
}
