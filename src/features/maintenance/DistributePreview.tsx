import { useMemo } from 'react';
import { useApp } from '../../app/AppContext';
import { repo } from '../../data/services';
import { formatDay, formatMinutes } from '../../domain/dates';
import { DEFAULT_ESTIMATE_MINUTES, distributeOverdue } from '../../domain/maintenance';
import { tasksDueOn } from '../../domain/selectors';
import { LoadBar } from '../views/LoadBar';

/** Vista previa de "Repartir": nada cambia hasta pulsar Aplicar. */
export function DistributePreview({ onClose }: { onClose: () => void }) {
  const { tasks, today, settings } = useApp();
  const plan = useMemo(() => distributeOverdue(tasks, today, settings), [tasks, today, settings]);

  const days = useMemo(() => {
    const byDay = new Map<string, typeof plan>();
    for (const a of plan) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);
    return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => {
      const existing = tasksDueOn(tasks, date).reduce((s, t) => s + (t.estimated_minutes ?? DEFAULT_ESTIMATE_MINUTES), 0);
      const added = items.reduce((s, a) => s + (a.task.estimated_minutes ?? DEFAULT_ESTIMATE_MINUTES), 0);
      return { date, items, load: existing + added };
    });
  }, [plan, tasks]);

  async function apply() {
    await repo.batch(`${plan.length} atrasadas repartidas`, async () => {
      for (const a of plan) await repo.updateTask(a.task.id, { due_date: a.date });
    });
    onClose();
  }

  return (
    <div className="p-5">
      <h2 className="mb-1 text-base font-semibold">Repartir atrasadas</h2>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Por prioridad y antigüedad, en los próximos días laborables sin pasar de {formatMinutes(settings.capacity_minutes)} al día.
        Las tareas sin estimación cuentan {DEFAULT_ESTIMATE_MINUTES} min.
      </p>
      {plan.length === 0 ? (
        <p className="text-sm text-zinc-500">No hay tareas atrasadas{settings.workdays.length ? '' : ' o no tienes días laborables configurados'}.</p>
      ) : (
        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {days.map((d) => (
            <section key={d.date}>
              <header className="mb-1 flex items-baseline justify-between border-b border-zinc-200 pb-1 text-xs dark:border-zinc-700">
                <span className="font-semibold tracking-wide text-zinc-500 uppercase">{formatDay(d.date, today)}</span>
                <LoadBar load={d.load} capacity={settings.capacity_minutes} />
              </header>
              <ul className="text-sm">
                {d.items.map(({ task }) => (
                  <li key={task.id} className="flex justify-between gap-3 py-0.5">
                    <span className="truncate">{task.priority < 4 && <span className="mr-1 text-xs text-red-500">!{task.priority}</span>}{task.title}</span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      era {formatDay(task.due_date!, today).toLowerCase()} · {formatMinutes(task.estimated_minutes ?? DEFAULT_ESTIMATE_MINUTES)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
        {plan.length > 0 && (
          <button autoFocus onClick={() => void apply()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            Aplicar ({plan.length})
          </button>
        )}
      </div>
    </div>
  );
}
