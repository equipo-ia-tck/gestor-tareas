import { useState, type FormEvent, type ReactNode } from 'react';
import { repo } from '../data/services';
import type { Priority, Project, Task, TaskStatus } from '../domain/types';
import { useTaskActions } from '../hooks/useTaskActions';
import { Modal } from './Modal';

export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800';

const splitList = (s: string) => [...new Set(s.split(',').map((x) => x.trim().replace(/^[@+#]/, '')).filter(Boolean))];

interface Props {
  task: Task;
  projects: Project[];
  onClose: () => void;
}

/** Editor completo de una tarea. En la fase 3 se complementa con edición en línea. */
export function TaskEditor({ task, projects, onClose }: Props) {
  const { remove } = useTaskActions();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [due, setDue] = useState(task.due_date ?? '');
  const [projectId, setProjectId] = useState(task.project_id ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [estimate, setEstimate] = useState(task.estimated_minutes?.toString() ?? '');
  const [people, setPeople] = useState(task.people.join(', '));
  const [tags, setTags] = useState(task.tags.join(', '));
  const [status, setStatus] = useState<TaskStatus>(task.status);

  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = parseInt(estimate, 10);
    await repo.updateTask(task.id, {
      title: title.trim(),
      notes,
      due_date: due || null,
      project_id: projectId || null,
      priority,
      estimated_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      people: splitList(people),
      tags: splitList(tags),
      status,
      completed_at: status === 'done' ? (task.completed_at ?? new Date().toISOString()) : null,
    });
    onClose();
  }

  return (
    <Modal title="Editar tarea" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <input autoFocus className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" />
        <textarea className={`${inputClass} min-h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Proyecto">
            <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Sin proyecto</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archivado)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className={inputClass} value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              <option value={1}>!1 Urgente</option>
              <option value={2}>!2 Alta</option>
              <option value={3}>!3 Media</option>
              <option value={4}>!4 Normal</option>
            </select>
          </Field>
          <Field label="Estimación (min)">
            <input type="number" min={0} step={5} className={inputClass} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Personas (separadas por comas)">
            <input className={inputClass} value={people} onChange={(e) => setPeople(e.target.value)} />
          </Field>
          <Field label="Etiquetas (separadas por comas)">
            <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              <option value="todo">Pendiente</option>
              <option value="done">Completada</option>
              <option value="archived">Archivada</option>
            </select>
          </Field>
        </div>
        {task.raw_input && task.raw_input.trim() !== task.title && (
          <p className="text-xs text-zinc-500">Texto original: <span className="font-mono">{task.raw_input}</span></p>
        )}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="text-sm text-red-600 hover:underline"
            onClick={() => { void remove([task]); onClose(); }}
          >
            Eliminar
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
            <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Guardar</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
