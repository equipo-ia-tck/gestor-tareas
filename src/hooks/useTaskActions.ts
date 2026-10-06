import { useMemo } from 'react';
import { repo } from '../data/services';
import type { ISODate, Task, TaskPatch } from '../domain/types';

const n = (count: number, one: string, many: string) => (count === 1 ? one : `${count} ${many}`);

/** Acciones sobre una o varias tareas. Cada una es una sola entrada del historial. */
export function useTaskActions() {
  return useMemo(() => ({
    async toggleDone(tasks: Task[]) {
      if (!tasks.length) return;
      const done = tasks.some((t) => t.status !== 'done');
      await repo.batch(
        done ? n(tasks.length, 'Tarea completada', 'tareas completadas') : n(tasks.length, 'Tarea pendiente', 'tareas pendientes'),
        async () => { for (const t of tasks) await repo.setCompleted(t.id, done); },
      );
    },
    async remove(tasks: Task[]) {
      if (!tasks.length) return;
      await repo.batch(n(tasks.length, 'Tarea eliminada', 'tareas eliminadas'), async () => {
        for (const t of tasks) await repo.deleteTask(t.id);
      });
    },
    async reschedule(tasks: Task[], due: ISODate | null) {
      if (!tasks.length) return;
      const label = due ? n(tasks.length, 'Fecha cambiada', 'tareas reprogramadas') : n(tasks.length, 'Fecha quitada', 'tareas sin fecha');
      await repo.batch(label, async () => { for (const t of tasks) await repo.updateTask(t.id, { due_date: due }); });
    },
    /** Para arrastrar y soltar: se reciben ids. */
    async moveIds(ids: string[], patch: TaskPatch, label: string) {
      if (!ids.length) return;
      const plural = label.startsWith('Movida') ? `${ids.length} tareas movidas${label.slice('Movida'.length)}` : `${ids.length} tareas actualizadas`;
      await repo.batch(ids.length === 1 ? label : plural, async () => {
        for (const id of ids) await repo.updateTask(id, patch);
      });
    },
    async update(tasks: Task[], patch: TaskPatch, label = 'Tarea actualizada') {
      if (!tasks.length) return;
      await repo.batch(tasks.length === 1 ? label : `${tasks.length} tareas actualizadas`, async () => {
        for (const t of tasks) await repo.updateTask(t.id, patch);
      });
    },
  }), []);
}
