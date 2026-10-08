import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import { addDays } from '../../domain/dates';
import type { Priority, Task } from '../../domain/types';
import { useTaskActions } from '../../hooks/useTaskActions';
import { isEditable } from '../command/CommandCenter';

export type EditableField = 'title' | 'date' | 'project' | 'estimate' | 'people' | 'tags';

interface Modifiers { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

interface SelectionApi {
  selected: ReadonlySet<string>;
  focused: string | null;
  editing: { id: string; field: EditableField } | null;
  click: (id: string, mods: Modifiers) => void;
  clear: () => void;
  selectAll: () => void;
  startEdit: (id: string, field: EditableField) => void;
  stopEdit: () => void;
  /** Tareas afectadas por una acción sobre `id`: toda la selección si la incluye; si no, solo esa. */
  targetsFor: (id?: string | null) => Task[];
}

const Ctx = createContext<SelectionApi | null>(null);

export function useSelection() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSelection fuera de SelectionProvider');
  return v;
}

/** Ids de tareas visibles, en el orden en que aparecen en pantalla. */
export function visibleTaskIds(): string[] {
  const ids = [...document.querySelectorAll<HTMLElement>('main [data-task-id]')].map((el) => el.dataset.taskId!);
  return [...new Set(ids)];
}

const scrollToTask = (id: string) =>
  requestAnimationFrame(() => document.querySelector(`main [data-task-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));

export function SelectionProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const { tasks, today, editTask } = useApp();
  const actions = useTaskActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [editing, setEditing] = useState<SelectionApi['editing']>(null);
  const anchor = useRef<string | null>(null);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const clear = useCallback(() => {
    setSelected(new Set());
    setFocused(null);
    setEditing(null);
    anchor.current = null;
  }, []);

  // Al cambiar de vista se empieza de cero.
  useEffect(clear, [resetKey, clear]);

  const focusOnly = useCallback((id: string) => {
    setSelected(new Set([id]));
    setFocused(id);
    anchor.current = id;
    scrollToTask(id);
  }, []);

  const extendTo = useCallback((id: string, keep: boolean) => {
    const order = visibleTaskIds();
    const from = order.indexOf(anchor.current ?? id);
    const to = order.indexOf(id);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    setSelected((prev) => new Set(keep ? [...prev, ...range] : range));
    setFocused(id);
    scrollToTask(id);
  }, []);

  const click = useCallback((id: string, m: Modifiers) => {
    if (m.shiftKey && anchor.current) return extendTo(id, m.metaKey || m.ctrlKey);
    if (m.metaKey || m.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setFocused(id);
      anchor.current = id;
      return;
    }
    focusOnly(id);
  }, [extendTo, focusOnly]);

  const selectAll = useCallback(() => {
    const ids = visibleTaskIds();
    setSelected(new Set(ids));
    if (!focused && ids.length) setFocused(ids[0]);
  }, [focused]);

  const targetsFor = useCallback((id?: string | null) => {
    const ref = id ?? focused;
    const ids = ref && !selected.has(ref) ? [ref] : selected.size ? [...selected] : ref ? [ref] : [];
    return ids.map((x) => byId.get(x)).filter((t): t is Task => !!t);
  }, [focused, selected, byId]);

  const startEdit = useCallback((id: string, field: EditableField) => {
    setFocused(id);
    setEditing({ id, field });
  }, []);
  const stopEdit = useCallback(() => setEditing(null), []);

  // ---- Teclado
  const state = useRef({ selected, focused, editing, targetsFor });
  state.current = { selected, focused, editing, targetsFor };

  useEffect(() => {
    /** Tras completar o eliminar, el foco pasa a la siguiente tarea visible. */
    const focusAfter = (ids: string[]) => {
      const order = visibleTaskIds();
      const last = Math.max(...ids.map((i) => order.indexOf(i)));
      const next = order.slice(last + 1).find((i) => !ids.includes(i)) ?? order.slice(0, last).reverse().find((i) => !ids.includes(i));
      if (next) focusOnly(next); else clear();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const { focused: f, editing: ed, targetsFor: targets, selected: sel } = state.current;
      if (ed) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod) {
        if (key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); }
        return;
      }
      if (e.altKey) return;

      const order = visibleTaskIds();
      const move = (delta: number) => {
        if (!order.length) return;
        const i = f ? order.indexOf(f) : -1;
        const next = order[i < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(Math.max(i + delta, 0), order.length - 1)];
        if (e.shiftKey) extendTo(next, true); else focusOnly(next);
      };

      const handled = (fn: () => void) => { e.preventDefault(); fn(); };
      switch (key) {
        case 'ArrowDown': case 'j': case 'J': return handled(() => move(1));
        case 'ArrowUp': case 'k': case 'K': return handled(() => move(-1));
        case 'Escape': if (f || sel.size) handled(clear); return;
      }
      if (!f) return;
      const ts = targets();
      switch (key) {
        case 'Enter': return handled(() => setEditing({ id: f, field: 'title' }));
        case 'e': { const t = byId.get(f); if (t) handled(() => editTask(t)); return; }
        case 'x': case ' ':
          return handled(() => setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(f)) next.delete(f); else next.add(f);
            return next;
          }));
        case 'c': return handled(() => { focusAfter(ts.map((t) => t.id)); void actions.toggleDone(ts); });
        case 'Delete': case 'Backspace': return handled(() => { focusAfter(ts.map((t) => t.id)); void actions.remove(ts); });
        case 'd': return handled(() => setEditing({ id: f, field: 'date' }));
        case 'm': return handled(() => setEditing({ id: f, field: 'project' }));
        case 't': return handled(() => void actions.reschedule(ts, today));
        case 'a': return handled(() => void actions.toggleMyDay(ts, today));
        case 'T': return handled(() => void actions.reschedule(ts, addDays(today, 1)));
        case '1': case '2': case '3': case '4':
          return handled(() => void actions.update(ts, { priority: Number(key) as Priority }, `Prioridad ${key}`));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, byId, clear, editTask, extendTo, focusOnly, selectAll, today]);

  const api = useMemo<SelectionApi>(
    () => ({ selected, focused, editing, click, clear, selectAll, startEdit, stopEdit, targetsFor }),
    [selected, focused, editing, click, clear, selectAll, startEdit, stopEdit, targetsFor],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
