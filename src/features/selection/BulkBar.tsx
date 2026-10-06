import { useApp } from '../../app/AppContext';
import { addDays } from '../../domain/dates';
import type { Priority } from '../../domain/types';
import { useTaskActions } from '../../hooks/useTaskActions';
import { useSelection } from './SelectionContext';

const btn = 'rounded px-2 py-1 hover:bg-white/15 dark:hover:bg-black/10';

/** Barra de acciones en bloque cuando hay dos o más tareas seleccionadas. */
export function BulkBar() {
  const { today } = useApp();
  const { selected, focused, clear, startEdit, targetsFor } = useSelection();
  const { toggleDone, reschedule, remove, update } = useTaskActions();
  const targets = targetsFor(null);
  if (selected.size < 2 || targets.length < 2) return null;
  const anchorId = focused && selected.has(focused) ? focused : targets[0].id;

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 flex justify-center px-4" onClick={(e) => e.stopPropagation()}>
      <div role="toolbar" aria-label="Acciones en bloque"
        className="flex flex-wrap items-center gap-1 rounded-xl bg-zinc-900 px-3 py-1.5 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900">
        <span className="mr-2 font-medium">{targets.length} seleccionadas</span>
        <button className={btn} title="C" onClick={() => void toggleDone(targets)}>Completar</button>
        <button className={btn} title="T" onClick={() => void reschedule(targets, today)}>Hoy</button>
        <button className={btn} title="Shift+T" onClick={() => void reschedule(targets, addDays(today, 1))}>Mañana</button>
        <button className={btn} title="D" onClick={() => startEdit(anchorId, 'date')}>Fecha…</button>
        <button className={btn} title="M" onClick={() => startEdit(anchorId, 'project')}>Proyecto…</button>
        <span className="mx-1 opacity-40">|</span>
        {([1, 2, 3, 4] as Priority[]).map((p) => (
          <button key={p} className={btn} title={`Prioridad ${p} (${p})`} onClick={() => void update(targets, { priority: p }, `Prioridad ${p}`)}>!{p}</button>
        ))}
        <span className="mx-1 opacity-40">|</span>
        <button className={`${btn} text-red-300 dark:text-red-600`} title="Supr" onClick={() => void remove(targets)}>Eliminar</button>
        <button className={btn} title="Esc" aria-label="Quitar selección" onClick={clear}>×</button>
      </div>
    </div>
  );
}
