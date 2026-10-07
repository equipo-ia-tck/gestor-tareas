import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { ColorPalette } from '../../components/TaskDetailPanel';
import { Popover } from '../../components/ui/Popover';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import { DEFAULT_TYPE_ID, type ItemType, type StateCategory, type WorkflowState } from '../../domain/types';

const CATEGORIES: { value: StateCategory; label: string }[] = [
  { value: 'todo', label: 'Pendiente' },
  { value: 'doing', label: 'En curso' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'done', label: 'Terminado' },
];

const small = 'rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900';

/** Tipos de elemento (Tarea, US, TS…) y sus estados: lo que define las columnas del tablero. */
export function TypesCard() {
  const { itemTypes, tasks } = useApp();
  const [name, setName] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) await repo.createItemType(name);
    setName('');
  }

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="mb-1 text-sm font-semibold">Tipos y estados</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        Cada tipo tiene su flujo; los estados son las columnas del tablero. La categoría decide si un estado cuenta como pendiente,
        en curso, bloqueado o terminado (terminado = completada). La plantilla de enlace convierte el ID externo en un enlace:
        usa <code>{'{id}'}</code>, p. ej. <code>https://empresa.atlassian.net/browse/{'{id}'}</code>.
      </p>
      <div className="space-y-4">
        {itemTypes.map((t) => <TypeEditor key={t.id} type={t} count={tasks.filter((x) => x.type_id === t.id).length} />)}
      </div>
      <form onSubmit={create} className="mt-4 flex gap-2">
        <input className={`${inputClass} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo tipo (p. ej. Defecto)" />
        <button className="rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">Añadir tipo</button>
      </form>
    </section>
  );
}

function TypeEditor({ type, count }: { type: ItemType; count: number }) {
  const save = (patch: Partial<ItemType>) => void repo.saveItemType({ ...type, ...patch });
  const saveStates = (states: WorkflowState[]) => save({ states });
  const setState = (i: number, patch: Partial<WorkflowState>) => saveStates(type.states.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const next = [...type.states];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    saveStates(next);
  };

  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/60">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Popover width="w-auto" trigger={(toggle) => <button type="button" onClick={toggle} className="size-5 rounded-full" style={{ background: type.color }} aria-label="Color del tipo" />}>
          {(close) => <ColorPalette current={type.color} onPick={(c) => { close(); save({ color: c }); }} />}
        </Popover>
        <BlurInput className={`${small} w-36 font-medium`} value={type.name} onSave={(v) => v && save({ name: v })} aria-label="Nombre del tipo" />
        <BlurInput className={`${small} w-16 font-mono uppercase`} value={type.short} placeholder="ABR" onSave={(v) => save({ short: v.toUpperCase().slice(0, 4) })} aria-label="Abreviatura" />
        <BlurInput className={`${small} min-w-48 flex-1 text-xs`} value={type.url_template ?? ''} placeholder="Plantilla de enlace: https://…/browse/{id}" onSave={(v) => save({ url_template: v || undefined })} aria-label="Plantilla de enlace" />
        <span className="text-xs text-zinc-400">{count} elemento{count === 1 ? '' : 's'}</span>
        {type.id !== DEFAULT_TYPE_ID && (
          <button type="button" title="Eliminar tipo (sus elementos pasan a Tarea)"
            onClick={() => { if (window.confirm(`¿Eliminar el tipo ${type.name}? Sus ${count} elementos pasarán a Tarea.`)) void repo.deleteItemType(type.id); }}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-800"><Trash2 className="size-4" /></button>
        )}
      </div>
      <ul className="space-y-1">
        {type.states.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 pl-7">
            <Popover width="w-auto" trigger={(toggle) => <button type="button" onClick={toggle} className="size-3.5 rounded-full" style={{ background: s.color }} aria-label={`Color de ${s.name}`} />}>
              {(close) => <ColorPalette current={s.color} onPick={(c) => { close(); setState(i, { color: c }); }} />}
            </Popover>
            <BlurInput className={`${small} w-40`} value={s.name} onSave={(v) => v && setState(i, { name: v })} aria-label="Nombre del estado" />
            <select className={`${small} w-32`} value={s.category} onChange={(e) => setState(i, { category: e.target.value as StateCategory })} aria-label="Categoría">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30" aria-label="Subir"><ArrowUp className="size-3.5" /></button>
            <button type="button" disabled={i === type.states.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 disabled:opacity-30" aria-label="Bajar"><ArrowDown className="size-3.5" /></button>
            {type.states.length > 1 && (
              <button type="button" title="Eliminar estado (sus elementos pasan al equivalente)" onClick={() => saveStates(type.states.filter((_, j) => j !== i))}
                className="rounded p-0.5 text-zinc-400 hover:text-red-600"><Trash2 className="size-3.5" /></button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => saveStates([...type.states, { id: crypto.randomUUID(), name: 'Nuevo estado', color: '#64748b', category: 'doing' }])}
        className="mt-1 ml-7 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><Plus className="size-3.5" />Añadir estado</button>
    </div>
  );
}

/** Input que guarda al salir (o con Enter) y se restablece con Esc. */
function BlurInput({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input {...rest} value={v} onChange={(e) => setV(e.target.value)}
      onFocus={() => setV(value)}
      onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value); e.currentTarget.blur(); } }} />
  );
}
