import Dexie, { type EntityTable } from 'dexie';
import type { ItemType, Label, Project, Task } from '../domain/types';
import { DEFAULT_ITEM_TYPES } from '../domain/workflows';

export interface KeyValue {
  key: string;
  value: unknown;
}

/** Versión lógica del esquema; se incluye en las copias de seguridad. */
export const SCHEMA_VERSION = 2;

export class TasksDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  labels!: EntityTable<Label, 'name'>;
  item_types!: EntityTable<ItemType, 'id'>;
  /** Ajustes del usuario (entran en las copias). */
  settings!: EntityTable<KeyValue, 'key'>;
  /** Estado local del dispositivo (no entra en las copias): handle del archivo vinculado, etc. */
  meta!: EntityTable<KeyValue, 'key'>;

  constructor(name = 'gestor-tareas') {
    super(name);
    this.version(1).stores({
      projects: 'id, name, archived',
      tasks: 'id, project_id, due_date, status, *people, *tags, series_id, last_touched_at, deleted_at',
      settings: 'key',
      meta: 'key',
    });
    // v2: tipos de elemento con flujo de estados, pasos (checklist) y colores de etiqueta.
    this.version(2)
      .stores({
        tasks: 'id, project_id, due_date, status, *people, *tags, series_id, last_touched_at, deleted_at, type_id, state_id',
        labels: 'name',
        item_types: 'id',
      })
      .upgrade(async (tx) => {
        await tx.table('item_types').bulkPut(DEFAULT_ITEM_TYPES);
        await tx.table('tasks').toCollection().modify((t: Task) => {
          t.type_id ??= 'task';
          t.state_id ??= t.status === 'done' ? 'task-done' : 'task-todo';
          t.checklist ??= [];
        });
      });
    // Base de datos nueva: se crea directamente en la última versión y no pasa por upgrade.
    this.on('populate', (tx) => {
      void tx.table('item_types').bulkAdd(DEFAULT_ITEM_TYPES);
    });
  }
}
