import Dexie, { type EntityTable } from 'dexie';
import type { ActivityEntry, ItemType, Label, Note, Person, Project, Release, Task } from '../domain/types';
import { DEFAULT_ITEM_TYPES, TOPIC_TYPE } from '../domain/workflows';

export interface KeyValue {
  key: string;
  value: unknown;
}

/** Versión lógica del esquema; se incluye en las copias de seguridad. */
export const SCHEMA_VERSION = 7;

export class TasksDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  labels!: EntityTable<Label, 'name'>;
  item_types!: EntityTable<ItemType, 'id'>;
  releases!: EntityTable<Release, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  people!: EntityTable<Person, 'name'>;
  activity!: EntityTable<ActivityEntry, 'id'>;
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
        await tx.table('item_types').bulkPut(DEFAULT_ITEM_TYPES.filter((t) => t.id !== TOPIC_TYPE.id));
        await tx.table('tasks').toCollection().modify((t: Task) => {
          t.type_id ??= 'task';
          t.state_id ??= t.status === 'done' ? 'task-done' : 'task-todo';
          t.checklist ??= [];
        });
      });
    // v3: ID externo, enlace y release en las tareas; tabla de releases.
    this.version(3)
      .stores({
        tasks: 'id, project_id, due_date, status, *people, *tags, series_id, last_touched_at, deleted_at, type_id, state_id, release_id, external_id',
        releases: 'id, date, project_id',
      })
      .upgrade(async (tx) => {
        await tx.table('tasks').toCollection().modify((t: Task) => {
          t.external_id ??= null;
          t.url ??= null;
          t.release_id ??= null;
        });
      });
    // v4: notas y actas, fichas de persona y el tipo "Tema".
    this.version(4)
      .stores({
        notes: 'id, date, project_id, kind, *people, deleted_at',
        people: 'name',
      })
      .upgrade(async (tx) => {
        if (!(await tx.table('item_types').get(TOPIC_TYPE.id))) await tx.table('item_types').add(TOPIC_TYPE);
      });
    // v5: recordatorios y registro de actividad.
    this.version(5)
      .stores({
        tasks: 'id, project_id, due_date, status, *people, *tags, series_id, last_touched_at, deleted_at, type_id, state_id, release_id, external_id, remind_at',
        activity: 'id, date, task_id, kind',
      })
      .upgrade(async (tx) => {
        await tx.table('tasks').toCollection().modify((t: Task) => { t.remind_at ??= null; });
      });
    // v6: subproyectos, notas de elementos y de reunión, email en las fichas.
    this.version(6)
      .stores({
        projects: 'id, name, archived, parent_id',
        notes: 'id, date, project_id, kind, *people, deleted_at, task_id',
      })
      .upgrade(async (tx) => {
        await tx.table('projects').toCollection().modify((p: Project) => { p.parent_id ??= null; });
        await tx.table('notes').toCollection().modify((n: Note) => { n.task_id ??= null; n.meeting_url ??= null; });
        await tx.table('people').toCollection().modify((p: Person) => { p.email ??= ''; });
      });
    // v7: el tipo "Tema" pasa a llamarse "Para hablar" (si no lo había renombrado la usuaria) y "Mi día".
    this.version(7)
      .stores({})
      .upgrade(async (tx) => {
        const topic = await tx.table('item_types').get(TOPIC_TYPE.id);
        if (topic && topic.name === 'Tema') await tx.table('item_types').update(TOPIC_TYPE.id, { name: TOPIC_TYPE.name, short: TOPIC_TYPE.short });
      });
    // Base de datos nueva: se crea directamente en la última versión y no pasa por upgrade.
    this.on('populate', (tx) => {
      void tx.table('item_types').bulkAdd(DEFAULT_ITEM_TYPES);
    });
  }
}
