import { useMemo } from 'react';
import { repo } from '../data/services';
import { useToast } from '../components/Toast';
import type { ISODate, Task } from '../domain/types';

/** Acciones frecuentes sobre tareas con aviso "Deshacer". */
export function useTaskActions() {
  const toast = useToast();
  return useMemo(() => ({
    async toggleDone(task: Task) {
      const done = task.status !== 'done';
      await repo.setCompleted(task.id, done);
      if (done) toast('Tarea completada', { label: 'Deshacer', run: () => repo.setCompleted(task.id, false) });
    },
    async remove(task: Task) {
      await repo.deleteTask(task.id);
      toast('Tarea eliminada', { label: 'Deshacer', run: () => repo.restoreTask(task.id) });
    },
    async reschedule(task: Task, due: ISODate | null) {
      const prev = task.due_date;
      await repo.updateTask(task.id, { due_date: due });
      toast(due ? 'Fecha cambiada' : 'Fecha quitada', {
        label: 'Deshacer',
        run: async () => { await repo.updateTask(task.id, { due_date: prev }); },
      });
    },
  }), [toast]);
}
