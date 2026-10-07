import { CheckSquare, Flag } from 'lucide-react';
import { colorFor, initials, labelColor, tint } from '../../domain/colors';
import type { ChecklistItem, ItemType, Priority, WorkflowState } from '../../domain/types';

export const PRIORITY_COLOR: Record<Priority, string> = { 1: '#ef4444', 2: '#f97316', 3: '#3b82f6', 4: '#a1a1aa' };
export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Urgente', 2: 'Alta', 3: 'Media', 4: 'Normal' };

/** Círculo con iniciales y color estable por persona. */
export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const color = colorFor(name);
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-zinc-900"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3, size = 20 }: { names: string[]; max?: number; size?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  return (
    <span className="inline-flex -space-x-1.5" title={names.join(', ')}>
      {shown.map((n) => <Avatar key={n} name={n} size={size} />)}
      {names.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-600 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900"
          style={{ width: size, height: size }}>+{names.length - max}</span>
      )}
    </span>
  );
}

export function LabelChip({ name, colors, onRemove, small }: {
  name: string;
  colors: Map<string, string>;
  onRemove?: () => void;
  small?: boolean;
}) {
  const color = labelColor(name, colors);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'}`}
      style={{ background: tint(color, 0.18), color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {name}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Quitar ${name}`} className="opacity-60 hover:opacity-100">×</button>}
    </span>
  );
}

export function StatePill({ state, onClick }: { state: WorkflowState; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: tint(state.color, 0.18), color: state.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: state.color }} />
      {state.name}
    </Tag>
  );
}

export function TypeBadge({ type }: { type: ItemType }) {
  if (!type.short) return null;
  return (
    <span className="rounded px-1 text-[10px] font-bold tracking-wide text-white" style={{ background: type.color }} title={type.name}>
      {type.short}
    </span>
  );
}

export function PriorityFlag({ priority, showNormal }: { priority: Priority; showNormal?: boolean }) {
  if (priority === 4 && !showNormal) return null;
  return <Flag className="size-3.5 shrink-0" style={{ color: PRIORITY_COLOR[priority] }} fill={priority < 4 ? PRIORITY_COLOR[priority] : 'none'} aria-label={`Prioridad ${PRIORITY_LABEL[priority]}`} />;
}

export function ChecklistProgress({ items }: { items: ChecklistItem[] }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${complete ? 'text-emerald-600 dark:text-emerald-400' : ''}`} title={`${done} de ${items.length} pasos`}>
      <CheckSquare className="size-3" />{done}/{items.length}
    </span>
  );
}
