import Dexie, { type EntityTable } from 'dexie';
import type { Project, Task } from '../domain/types';

export interface KeyValue {
  key: string;
  value: unknown;
}

/** Versión lógica del esquema; se incluye en las copias de seguridad. */
export const SCHEMA_VERSION = 1;

export class TasksDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
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
    // Migraciones futuras:
    // this.version(2).stores({...}).upgrade(tx => tx.table('tasks').toCollection().modify(t => {...}));
  }
}
