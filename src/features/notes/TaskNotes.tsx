import { useState, type KeyboardEvent } from 'react';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { repo } from '../../data/services';
import { formatDay } from '../../domain/dates';
import { notesForTask } from '../../domain/notes';
import type { Note, Task } from '../../domain/types';
import { Markdown } from './Markdown';

const area = 'w-full resize-y rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900';

/** Etiqueta de un elemento para títulos de notas: "US-1234 · Login con SSO". */
export const taskLabel = (t: Pick<Task, 'external_id' | 'title'>) => (t.external_id ? `${t.external_id} · ${t.title}` : t.title);

/** Notas fechadas de un elemento (como los comentarios de Jira): alta, edición y borrado. */
export function TaskNotes({ task, compact }: { task: Task; compact?: boolean }) {
  const { notes, today } = useApp();
  const mine = notesForTask(task.id, notes);
  const [text, setText] = useState('');

  async function add() {
    if (!text.trim()) return;
    await repo.createNote({ date: today, kind: 'note', title: taskLabel(task), body: text.trim(), task_id: task.id, project_id: task.project_id });
    setText('');
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); }
  };

  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={text ? 3 : 1}
        placeholder="Añadir nota (Markdown, @persona…) · Cmd/Ctrl+Enter" className={area} />
      {text.trim() && (
        <div className="mt-1 flex justify-end">
          <button type="button" onClick={() => void add()} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">Añadir nota</button>
        </div>
      )}
      <ul className={`mt-2 ${compact ? 'space-y-2' : 'space-y-3'}`}>
        {mine.map((n) => <NoteItem key={n.id} note={n} today={today} />)}
      </ul>
    </div>
  );
}

function NoteItem({ note, today }: { note: Note; today: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const save = () => {
    setEditing(false);
    if (text.trim() !== note.body) void repo.updateNote(note.id, { body: text.trim() });
  };
  return (
    <li className="group rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
        <span className="font-medium text-zinc-500">{formatDay(note.date, today)}</span>
        <span>{new Date(note.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="flex-1" />
        <span className="flex gap-1 opacity-0 group-hover:opacity-100">
          <a href={`#/notes/${note.id}`} title="Abrir en Notas" className="rounded p-0.5 hover:text-zinc-700"><ExternalLink className="size-3" /></a>
          <button type="button" title="Editar" onClick={() => { setText(note.body); setEditing(true); }} className="rounded p-0.5 hover:text-zinc-700"><Pencil className="size-3" /></button>
          <button type="button" title="Eliminar" onClick={() => void repo.deleteNote(note.id)} className="rounded p-0.5 hover:text-red-600"><Trash2 className="size-3" /></button>
        </span>
      </div>
      {editing ? (
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} className={area}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); setText(note.body); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          }} />
      ) : (
        <div onDoubleClick={() => { setText(note.body); setEditing(true); }}><Markdown text={note.body} /></div>
      )}
    </li>
  );
}
