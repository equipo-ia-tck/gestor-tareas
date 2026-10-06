import { useMemo, useState, type KeyboardEvent } from 'react';
import { useApp } from '../app/AppContext';
import { repo } from '../data/services';
import { formatDay, formatMinutes } from '../domain/dates';
import { fuzzyScore, nameKey } from '../domain/text';
import type { Task, TaskPatch } from '../domain/types';
import type { EditableField } from '../features/selection/SelectionContext';
import { useTaskActions } from '../hooks/useTaskActions';
import { parseDateText, parseEstimateText, parseList } from '../parser/fields';

const fieldInput =
  'w-full rounded border border-indigo-400 bg-white px-1.5 py-0.5 text-sm outline-none ring-1 ring-indigo-400 dark:bg-zinc-900';

interface Props {
  task: Task;
  field: Exclude<EditableField, 'title'>;
  /** Tareas a las que se aplica (varias si hay selección múltiple). */
  targets: Task[];
  onClose: () => void;
}

const LABELS: Record<Props['field'], string> = {
  date: 'Fecha', project: 'Proyecto', estimate: 'Estimación', people: 'Personas', tags: 'Etiquetas',
};

/** Editor en línea de un campo de la tarea. Enter aplica, Esc cancela. */
export function FieldEditor({ task, field, targets, onClose }: Props) {
  const { update } = useTaskActions();
  const count = targets.length > 1 ? ` · ${targets.length} tareas` : '';

  async function apply(patch: TaskPatch, label: string) {
    await update(targets, patch, label);
    onClose();
  }

  return (
    <div className="mt-1 max-w-sm" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="mb-0.5 text-[11px] text-zinc-500">{LABELS[field]}{count}</div>
      {field === 'project'
        ? <ProjectPicker current={task.project_id} onPick={(id, name) => apply({ project_id: id }, id ? `Movida a ${name}` : 'Proyecto quitado')} onClose={onClose} />
        : <TextField task={task} field={field} apply={apply} onClose={onClose} />}
    </div>
  );
}

function TextField({ task, field, apply, onClose }: {
  task: Task;
  field: 'date' | 'estimate' | 'people' | 'tags';
  apply: (patch: TaskPatch, label: string) => Promise<void>;
  onClose: () => void;
}) {
  const { today } = useApp();
  const initial = {
    date: task.due_date ? formatDay(task.due_date, today).toLowerCase() : '',
    estimate: task.estimated_minutes ? `${task.estimated_minutes}m` : '',
    people: task.people.join(', '),
    tags: task.tags.join(', '),
  }[field];
  const [text, setText] = useState(field === 'date' ? '' : initial);

  const preview = useMemo(() => {
    if (field === 'date') {
      const r = parseDateText(text, today);
      return r.ok ? { ok: true, label: r.value ? formatDay(r.value, today) : 'sin fecha', patch: { due_date: r.value } } : { ok: false, label: 'No entiendo esa fecha' };
    }
    if (field === 'estimate') {
      const r = parseEstimateText(text);
      return r.ok ? { ok: true, label: r.value ? formatMinutes(r.value) : 'sin estimación', patch: { estimated_minutes: r.value } } : { ok: false, label: 'Usa 30m, 2h o 1h30' };
    }
    return { ok: true, label: '', patch: { [field]: parseList(text) } };
  }, [field, text, today]);

  const labels = { date: 'Fecha cambiada', estimate: 'Estimación cambiada', people: 'Personas cambiadas', tags: 'Etiquetas cambiadas' };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      // En fecha, Enter sin escribir nada cierra sin cambiar.
      if (field === 'date' && !text.trim()) return onClose();
      if (preview.ok && preview.patch) void apply(preview.patch, labels[field]);
    }
  }

  const placeholders = {
    date: `${initial ? `Ahora: ${initial}. ` : ''}mañana, vie, 15 oct, sin fecha…`,
    estimate: '30m, 2h, 1h30…',
    people: 'Diana, Luis…',
    tags: 'urgente, casa…',
  };

  return (
    <div className="flex items-center gap-2">
      <input autoFocus className={fieldInput} value={text} placeholder={placeholders[field]}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={onClose} />
      {text && preview.label && (
        <span className={`shrink-0 text-xs ${preview.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}`}>→ {preview.label}</span>
      )}
    </div>
  );
}

function ProjectPicker({ current, onPick, onClose }: {
  current: string | null;
  onPick: (id: string | null, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { projects } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const options = useMemo(() => {
    const list: { id: string | null; name: string; create?: boolean }[] = [];
    if (!query) list.push({ id: null, name: 'Sin proyecto' });
    projects
      .map((p) => ({ p, s: fuzzyScore(query, p.name) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .forEach(({ p }) => list.push({ id: p.id, name: p.name }));
    if (query.trim() && !projects.some((p) => nameKey(p.name) === nameKey(query))) {
      list.push({ id: null, name: query.trim(), create: true });
    }
    return list;
  }, [projects, query]);

  async function pick(i: number) {
    const o = options[i];
    if (!o) return;
    if (o.create) {
      // Crear el proyecto y mover forman una sola entrada del historial (FieldEditor.apply la abre).
      await repo.batch(`Movida a ${o.name}`, async () => {
        const p = await repo.createProject(o.name);
        await onPick(p.id, p.name);
      });
      return;
    }
    await onPick(o.id, o.name);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(options.length, 1);
      setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') { e.preventDefault(); void pick(selected); }
  }

  return (
    <div className="relative">
      <input autoFocus className={fieldInput} value={query} placeholder="Buscar o crear proyecto…"
        onChange={(e) => { setQuery(e.target.value); setSelected(0); }} onKeyDown={onKeyDown} onBlur={onClose} />
      <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {options.map((o, i) => (
          <li key={`${o.id}-${o.name}`}
            onMouseDown={(e) => { e.preventDefault(); void pick(i); }}
            onMouseEnter={() => setSelected(i)}
            className={`cursor-pointer px-2 py-1 ${i === selected ? 'bg-indigo-50 dark:bg-indigo-900/40' : ''} ${o.id === current && !o.create ? 'font-medium' : ''}`}>
            {o.create ? <>Crear proyecto <strong>{o.name}</strong></> : o.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
