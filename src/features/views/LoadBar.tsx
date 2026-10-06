import { formatMinutes } from '../../domain/dates';

/** Carga estimada frente a capacidad. */
export function LoadBar({ load, capacity }: { load: number; capacity: number }) {
  if (capacity === 0) {
    return <span>{load > 0 ? `${formatMinutes(load)} · día libre` : 'Día libre'}</span>;
  }
  const ratio = load / capacity;
  const color = ratio > 1 ? 'bg-red-500' : ratio > 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className="flex items-center gap-2" title={`${formatMinutes(load)} de ${formatMinutes(capacity)}`}>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span className={`block h-full ${color}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </span>
      <span className={ratio > 1 ? 'text-red-600 dark:text-red-400' : ''}>
        {formatMinutes(load)} / {formatMinutes(capacity)}
      </span>
    </span>
  );
}
