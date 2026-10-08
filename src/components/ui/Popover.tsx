import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/**
 * Desplegable anclado a su disparador. Se dibuja en una capa por encima de todo (portal con
 * posición fija), así no lo recorta ningún panel con scroll, y se recoloca para caber en pantalla:
 * si no cabe a la derecha se desplaza, y si no cabe debajo se abre hacia arriba.
 * Se cierra con clic fuera o Esc. `trigger` recibe la función para abrir/cerrar.
 */
export function Popover({ trigger, children, align = 'left', width = 'w-56' }: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let left = align === 'right' ? a.right - w : a.left;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - w - MARGIN);
    let top = a.bottom + 4;
    if (top + h > window.innerHeight - MARGIN && a.top - h - 4 >= MARGIN) top = a.top - h - 4;
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    setPos({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };
    // Si el panel cambia de tamaño (p. ej. el calendario cambia de mes), se recoloca.
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <div ref={anchor} className="relative inline-block">
      {trigger(() => setOpen((o) => !o), open)}
      {open && createPortal(
        <div
          ref={panel}
          data-popover
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className={`z-50 ${width} max-w-[calc(100vw-16px)] rounded-lg border border-zinc-200 bg-white p-1 text-sm text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100`}
        >
          {children(close)}
        </div>,
        document.body,
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
