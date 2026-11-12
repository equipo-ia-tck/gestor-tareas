import { useRef, useState } from 'react';
import { CalendarPlus, Check } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { addDays, formatDay } from '../../domain/dates';
import { parseIcs, type CalendarEvent } from '../../domain/ics';
import { meetingTemplate } from '../../domain/notes';
import { nameKey } from '../../domain/text';
import type { Note, Person } from '../../domain/types';

/** Acta ya creada para una reunión: una de tipo reunión con el mismo título ese día. */
export const meetingNoteFor = (e: CalendarEvent, notes: Note[]) =>
  notes.find((n) => n.kind === 'meeting' && !n.deleted_at && n.date === e.date && nameKey(n.title) === nameKey(e.title));

/**
 * Crea el acta de una reunión (fecha, asistentes, hora y enlace para unirse) y guarda los emails de los asistentes en sus
 * fichas, sin pisar uno ya puesto (para los chats de Teams). Va dentro del lote de quien la llama.
 */
export async function createMeetingNote(e: CalendarEvent, peopleCards: Person[]): Promise<Note> {
  const names = e.attendees.map((a) => a.name);
  const n = await repo.createNote({
    kind: 'meeting', date: e.date, title: e.title, meeting_url: e.url,
    body: `${meetingTemplate(names)}${e.time ? `\n\n> ${e.time}${e.location && !e.location.startsWith('http') ? ` · ${e.location}` : ''}` : ''}`,
  });
  for (const a of e.attendees) {
    const card = peopleCards.find((c) => nameKey(c.name) === nameKey(a.name));
    if (a.email && !card?.email) await repo.savePerson({ name: a.name, role: card?.role ?? '', notes: card?.notes ?? '', email: a.email });
  }
  return n;
}

/**
 * Importar reuniones de Teams/Outlook desde un archivo .ics: cada reunión elegida se convierte en
 * un acta con su fecha, asistentes y enlace para unirse. Los emails de los asistentes se guardan
 * en sus fichas (para poder abrir chats de Teams).
 */
export function IcsImport() {
  const { notes, peopleCards, today } = useApp();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const key = (e: CalendarEvent) => `${e.uid}|${e.date}`;
  /** Ya importada: hay un acta con el mismo título ese día. */
  const exists = (e: CalendarEvent) => !!meetingNoteFor(e, notes);

  /** Preselección: de cada serie, solo su próxima reunión, y solo las de los próximos 7 días. */
  function preselect(found: CalendarEvent[]): string[] {
    const seen = new Set<string>();
    return found
      .filter((e) => e.date >= today && e.date <= addDays(today, 7) && !exists(e))
      .filter((e) => (seen.has(e.uid) ? false : (seen.add(e.uid), true)))
      .map(key);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const found = parseIcs(await file.text(), addDays(today, -14), addDays(today, 30));
      if (!found.length) setError('No hay reuniones entre hace 2 semanas y dentro de 30 días en ese archivo.');
      setEvents(found);
      setPicked(new Set(preselect(found)));
    } catch {
      setError('No se pudo leer el archivo. ¿Es un .ics de calendario?');
    }
    if (input.current) input.current.value = '';
  }

  async function importPicked() {
    const chosen = (events ?? []).filter((e) => picked.has(key(e)));
    let first: string | null = null;
    await repo.batch(`${chosen.length} reunion${chosen.length === 1 ? '' : 'es'} importada${chosen.length === 1 ? '' : 's'}`, async () => {
      for (const e of chosen) {
        const n = await createMeetingNote(e, peopleCards);
        first ??= n.id;
      }
    });
    setEvents(null);
    toast(`${chosen.length} acta${chosen.length === 1 ? '' : 's'} creada${chosen.length === 1 ? '' : 's'}`);
    if (first) navigate({ view: 'notes', id: first });
  }

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <button type="button" onClick={() => input.current?.click()} title="Importar reuniones de Teams/Outlook (.ics)"
        className="flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
        <CalendarPlus className="size-4" />.ics
      </button>
      <input ref={input} type="file" accept=".ics,text/calendar" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {(events || error) && (
        <Modal title="Importar reuniones" onClose={() => { setEvents(null); setError(null); }} wide>
          {error && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{error}</p>}
          {events && events.length > 0 && (
            <>
              <p className="mb-2 text-xs text-zinc-500">Elige las reuniones para las que quieres un acta. Están marcadas las de los próximos 7 días (de las que se repiten, solo la siguiente); las ya importadas aparecen atenuadas.</p>
              <ul className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                {events.map((e) => {
                  const k = key(e);
                  const done = exists(e);
                  return (
                    <li key={k}>
                      <label className={`flex cursor-pointer items-start gap-3 px-1 py-2 ${done ? 'opacity-50' : ''}`}>
                        <input type="checkbox" checked={picked.has(k)} disabled={done} onChange={() => toggle(k)} className="mt-1" />
                        <span className="w-28 shrink-0 text-xs text-zinc-500">{formatDay(e.date, today)}{e.time ? ` · ${e.time}` : ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{e.title} {done && <Check className="inline size-3.5 text-emerald-500" />}</span>
                          <span className="block truncate text-xs text-zinc-400">{e.attendees.map((a) => a.name).join(', ') || 'Sin asistentes'}{e.url ? ' · Teams' : ''}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <details className="mt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer">¿Cómo saco el .ics de Outlook o Teams?</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Una reunión: ábrela en Outlook y usa <em>Guardar como</em> o arrástrala al escritorio.</li>
              <li>Todo el calendario (Outlook en la web): Configuración → Calendario → Calendarios compartidos → Publicar un calendario → descargar el enlace ICS.</li>
              <li>Outlook de escritorio (Windows): Archivo → Guardar calendario.</li>
            </ul>
            <p className="mt-1">El archivo solo se lee en tu navegador; no se envía a ningún sitio.</p>
          </details>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setEvents(null); setError(null); }} className="rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
            {events && events.length > 0 && (
              <button type="button" disabled={!picked.size} onClick={() => void importPicked()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                Crear {picked.size} acta{picked.size === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
