import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Desplegable anclado a su disparador. Se cierra con clic fuera o Esc.
 * `trigger` recibe la función para abrir/cerrar.
 */
export function Popover({ trigger, children, align = 'left', width = 'w-56' }: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div className={`absolute z-40 mt-1 ${width} ${align === 'right' ? 'right-0' : 'left-0'} rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, active }: { onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${active ? 'font-medium' : ''}`}
    >
      {children}
    </button>
  );
}
