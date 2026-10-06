import { useApp } from '../../app/AppContext';
import { repo } from '../../data/services';
import { formatDay, formatMinutes } from '../../domain/dates';
import { dailySummary } from '../../domain/maintenance';

/** Panel breve la primera vez que se abre la app cada día. Al cerrarlo no vuelve hasta mañana. */
export function DailySummary() {
  const { tasks, today, settings, projectMap, editTask } = useApp();
  if (settings.ui.summary_dismissed_on === today) return null;
  const s = dailySummary(tasks, today, settings);
  if (!s.top.length && !s.overdueCount) return null;

  const dismiss = () => void repo.updateSettings({ ui: { ...settings.ui, summary_dismissed_on: today } });

  return (
    <section aria-label="Resumen del día" className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="mb-2 flex items-start justify-between gap-4">
        <h2 className="text-sm font-semibold">Tu día</h2>
        <button onClick={dismiss} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Entendido ×</button>
      </div>
      {s.top.length > 0 && (
        <ol className="mb-3 space-y-1 text-sm">
          {s.top.map((t, i) => {
            const p = t.project_id ? projectMap.get(t.project_id) : undefined;
            return (
              <li key={t.id} className="flex items-baseline gap-2">
                <span className="w-4 text-xs text-zinc-400">{i + 1}.</span>
                <button className="text-left hover:underline" onClick={() => editTask(t)}>{t.title}</button>
                <span className="text-xs text-zinc-500">
                  {t.priority < 4 && `!${t.priority} · `}
                  {t.due_date ? formatDay(t.due_date, today) : 'sin fecha'}
                  {p && ` · #${p.name}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {s.dueTodayCount} para hoy
        {s.overdueCount > 0 && ` · ${s.overdueCount} atrasada${s.overdueCount === 1 ? '' : 's'}`}
        {s.capacity > 0 ? ` · ${formatMinutes(s.load)} estimados de ${formatMinutes(s.capacity)}` : ' · hoy no es día laborable'}
      </p>
      {s.overloaded && s.capacity > 0 && (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          Hoy estás por encima de tu capacidad en {formatMinutes(s.load - s.capacity)}. Mueve algo a otro día o usa «Repartir».
        </p>
      )}
    </section>
  );
}
