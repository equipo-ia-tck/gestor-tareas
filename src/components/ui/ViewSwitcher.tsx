import { KanbanSquare, List } from 'lucide-react';

export type DisplayMode = 'list' | 'board';

export function ViewSwitcher({ value, onChange }: { value: DisplayMode; onChange: (v: DisplayMode) => void }) {
  const item = (mode: DisplayMode, label: string, Icon: typeof List) => (
    <button type="button" onClick={() => onChange(mode)} aria-pressed={value === mode}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${value === mode ? 'bg-white font-medium shadow-sm dark:bg-zinc-900' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'}`}>
      <Icon className="size-4" />{label}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
      {item('list', 'Lista', List)}
      {item('board', 'Tablero', KanbanSquare)}
    </div>
  );
}
