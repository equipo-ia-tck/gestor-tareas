import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { ColorPalette } from '../../components/TaskDetailPanel';
import { LabelChip } from '../../components/ui/Badges';
import { Popover } from '../../components/ui/Popover';
import { repo } from '../../data/services';
import { labelColor } from '../../domain/colors';
import { nameKey } from '../../domain/text';

/** Etiquetas en uso o con color propio: cambiar color, renombrar o eliminar (en todas las tareas). */
export function LabelsCard() {
  const { tasks, labels, labelColors } = useApp();
  const rows = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const l of labels) counts.set(nameKey(l.name), { name: l.name, count: 0 });
    for (const t of tasks) for (const g of t.tags) {
      const k = nameKey(g);
      const row = counts.get(k) ?? { name: g, count: 0 };
      if (t.status === 'todo') row.count++;
      counts.set(k, row);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  }, [tasks, labels]);

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="mb-1 text-sm font-semibold">Etiquetas</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">Se crean al escribir <code>+etiqueta</code> o desde el panel de una tarea. Haz clic en el color para cambiarlo.</p>
      {rows.length === 0 ? <p className="text-sm text-zinc-400">Aún no hay etiquetas.</p> : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => <LabelRow key={nameKey(r.name)} name={r.name} count={r.count} color={labelColor(r.name, labelColors)} colors={labelColors} />)}
        </ul>
      )}
    </section>
  );
}

function LabelRow({ name, count, color, colors }: { name: string; count: number; color: string; colors: Map<string, string> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <li className="flex items-center gap-3 py-1.5">
      <Popover width="w-auto" trigger={(toggle) => (
        <button type="button" onClick={toggle} className="size-5 rounded-full" style={{ background: color }} aria-label={`Color de ${name}`} />
      )}>
        {(close) => <ColorPalette current={color} onPick={(c) => { close(); void repo.setLabelColor(name, c); }} />}
      </Popover>
      {editing ? (
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onBlur={() => { setEditing(false); void repo.renameLabel(name, value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setValue(name); setEditing(false); } }}
          className="rounded border border-indigo-400 bg-transparent px-1 text-sm outline-none" />
      ) : (
        <button type="button" onClick={() => setEditing(true)} title="Renombrar"><LabelChip name={name} colors={colors} /></button>
      )}
      <span className="flex-1 text-xs text-zinc-400">{count} pendiente{count === 1 ? '' : 's'}</span>
      <button type="button" title="Eliminar de todas las tareas" onClick={() => void repo.deleteLabel(name)}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"><Trash2 className="size-4" /></button>
    </li>
  );
}
