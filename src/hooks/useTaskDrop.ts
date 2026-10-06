import { useState, type DragEvent } from 'react';

export const TASK_MIME = 'application/x-gestor-task-ids';

export function setDraggedTasks(e: DragEvent, ids: string[]) {
  e.dataTransfer.setData(TASK_MIME, JSON.stringify(ids));
  e.dataTransfer.setData('text/plain', `${ids.length} tarea(s)`);
  e.dataTransfer.effectAllowed = 'move';
}

/** Convierte un elemento en destino de tareas arrastradas. `over` = hay una tarea encima. */
export function useTaskDrop(onDrop?: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  if (!onDrop) return { over: false, dropProps: {} };
  return {
    over,
    dropProps: {
      onDragOver(e: DragEvent) {
        if (!e.dataTransfer.types.includes(TASK_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave(e: DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop(e: DragEvent) {
        const raw = e.dataTransfer.getData(TASK_MIME);
        setOver(false);
        if (!raw) return;
        e.preventDefault();
        onDrop(JSON.parse(raw) as string[]);
      },
    },
  };
}

export const dropHighlight = 'ring-2 ring-indigo-400 ring-inset bg-indigo-50/60 dark:bg-indigo-950/40 rounded-md';
