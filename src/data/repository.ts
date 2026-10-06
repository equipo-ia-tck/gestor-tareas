import {
  DEFAULT_SETTINGS,
  PROJECT_COLORS,
  type NewTask,
  type Project,
  type Settings,
  type Task,
  type TaskPatch,
} from '../domain/types';
import { BACKUP_APP_ID, settingsSchema, type Backup } from '../domain/schemas';
import type { Table } from 'dexie';
import { SCHEMA_VERSION, TasksDB } from './db';

type TableName = 'tasks' | 'projects';

/** Estado de un registro antes y después de un cambio (undefined = no existía). */
export interface Change {
  table: TableName;
  key: string;
  before: Task | Project | undefined;
  after: Task | Project | undefined;
}

export interface HistoryEntry {
  label: string;
  changes: Change[];
}

export type HistoryEvent = { type: 'push' | 'undo' | 'redo'; entry: HistoryEntry };

/**
 * Único punto de acceso a los datos. Los componentes no tocan Dexie directamente,
 * así se puede sustituir IndexedDB por un backend remoto implementando esta interfaz.
 */
export interface Repository {
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(input: NewTask): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<Task | undefined>;
  setCompleted(id: string, done: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  restoreTask(id: string): Promise<void>;
  purgeDeleted(olderThanDays: number): Promise<number>;

  listProjects(includeArchived?: boolean): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(name: string, color?: string): Promise<Project>;
  updateProject(id: string, patch: Partial<Omit<Project, 'id'>>): Promise<void>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Registra una copia hecha. No dispara onChange para no provocar otra copia automática. */
  markBackup(at?: Date): Promise<void>;

  exportSnapshot(): Promise<Backup>;
  replaceAll(backup: Backup): Promise<void>;

  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  /** Agrupa varias mutaciones en una sola entrada del historial (un solo "Deshacer"). */
  batch<T>(label: string, fn: () => Promise<T>): Promise<T>;
  undo(): Promise<HistoryEntry | null>;
  redo(): Promise<HistoryEntry | null>;
  onHistory(listener: (e: HistoryEvent) => void): () => void;

  /** Se llama tras cada cambio en los datos que deben respaldarse. */
  onChange(listener: () => void): () => void;
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const SETTINGS_KEY = 'settings';
const HISTORY_LIMIT = 100;

export class DexieRepository implements Repository {
  private listeners = new Set<() => void>();
  private historyListeners = new Set<(e: HistoryEvent) => void>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private group: HistoryEntry | null = null;
  readonly db: TasksDB;

  constructor(db: TasksDB = new TasksDB()) {
    this.db = db;
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  // ---------- Historial (deshacer / rehacer) ----------

  onHistory(listener: (e: HistoryEvent) => void) {
    this.historyListeners.add(listener);
    return () => void this.historyListeners.delete(listener);
  }

  private notify(e: HistoryEvent) {
    for (const l of this.historyListeners) l(e);
  }

  private record(change: Change, defaultLabel: string) {
    if (this.group) {
      this.group.changes.push(change);
      return;
    }
    this.push({ label: defaultLabel, changes: [change] });
  }

  private push(entry: HistoryEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.notify({ type: 'push', entry });
  }

  async batch<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.group) return fn(); // anidado: se suma al grupo exterior
    const group: HistoryEntry = { label, changes: [] };
    this.group = group;
    try {
      return await fn();
    } finally {
      this.group = null;
      if (group.changes.length) this.push(group);
    }
  }

  private async apply(entry: HistoryEntry, side: 'before' | 'after') {
    const changes = side === 'before' ? [...entry.changes].reverse() : entry.changes;
    await this.db.transaction('rw', this.db.tasks, this.db.projects, async () => {
      for (const c of changes) {
        const table = this.db[c.table] as unknown as Table<Task | Project, string>;
        const value = c[side];
        if (value === undefined) await table.delete(c.key);
        else await table.put(value);
      }
    });
    this.emit();
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    await this.apply(entry, 'before');
    this.redoStack.push(entry);
    this.notify({ type: 'undo', entry });
    return entry;
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    await this.apply(entry, 'after');
    this.undoStack.push(entry);
    this.notify({ type: 'redo', entry });
    return entry;
  }

  // ---------- Tareas ----------

  async listTasks() {
    return (await this.db.tasks.toArray()).filter((t) => !t.deleted_at);
  }

  getTask(id: string) {
    return this.db.tasks.get(id);
  }

  async createTask(input: NewTask) {
    const ts = now();
    const task: Task = {
      project_id: null,
      notes: '',
      due_date: null,
      priority: 4,
      estimated_minutes: null,
      people: [],
      tags: [],
      status: 'todo',
      recurrence_rule: null,
      series_id: null,
      sort_order: Date.now(),
      raw_input: input.title,
      completed_at: null,
      deleted_at: null,
      ...input,
      title: input.title.trim(),
      id: uuid(),
      created_at: ts,
      updated_at: ts,
      last_touched_at: ts,
    };
    await this.db.tasks.add(task);
    this.record({ table: 'tasks', key: task.id, before: undefined, after: task }, 'Tarea creada');
    this.emit();
    return task;
  }

  /** Actualiza una tarea y registra el cambio. `touch` = cuenta como "tocada" (por defecto sí). */
  private async patchTask(id: string, patch: TaskPatch, label: string, touch = true) {
    const before = await this.db.tasks.get(id);
    if (!before) return undefined;
    const ts = now();
    await this.db.tasks.update(id, touch ? { ...patch, updated_at: ts, last_touched_at: ts } : patch);
    const after = await this.db.tasks.get(id);
    this.record({ table: 'tasks', key: id, before, after }, label);
    this.emit();
    return after;
  }

  updateTask(id: string, patch: TaskPatch) {
    return this.patchTask(id, patch, 'Tarea actualizada');
  }

  async setCompleted(id: string, done: boolean) {
    await this.patchTask(
      id,
      done ? { status: 'done', completed_at: now() } : { status: 'todo', completed_at: null },
      done ? 'Tarea completada' : 'Tarea marcada como pendiente',
    );
  }

  async deleteTask(id: string) {
    await this.patchTask(id, { deleted_at: now() }, 'Tarea eliminada', false);
  }

  async restoreTask(id: string) {
    await this.patchTask(id, { deleted_at: null }, 'Tarea restaurada', false);
  }

  /** Borrado definitivo de lo eliminado hace tiempo. No pasa por el historial. */
  async purgeDeleted(olderThanDays: number) {
    const limit = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const n = await this.db.tasks.where('deleted_at').below(limit).delete();
    if (n) this.emit();
    return n;
  }

  // ---------- Proyectos ----------

  async listProjects(includeArchived = false) {
    const all = await this.db.projects.toArray();
    return all
      .filter((p) => includeArchived || !p.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  getProject(id: string) {
    return this.db.projects.get(id);
  }

  async createProject(name: string, color?: string) {
    const count = await this.db.projects.count();
    const project: Project = {
      id: uuid(),
      name: name.trim(),
      color: color ?? PROJECT_COLORS[count % PROJECT_COLORS.length],
      archived: false,
      created_at: now(),
    };
    await this.db.projects.add(project);
    this.record({ table: 'projects', key: project.id, before: undefined, after: project }, 'Proyecto creado');
    this.emit();
    return project;
  }

  async updateProject(id: string, patch: Partial<Omit<Project, 'id'>>) {
    const before = await this.db.projects.get(id);
    if (!before) return;
    await this.db.projects.update(id, patch);
    const after = await this.db.projects.get(id);
    this.record({ table: 'projects', key: id, before, after }, 'Proyecto actualizado');
    this.emit();
  }

  // ---------- Ajustes (fuera del historial: no son acciones sobre tareas) ----------

  async getSettings(): Promise<Settings> {
    const row = await this.db.settings.get(SETTINGS_KEY);
    const parsed = settingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async updateSettings(patch: Partial<Settings>) {
    const next = await this.writeSettings(patch);
    this.emit();
    return next;
  }

  async markBackup(at = new Date()) {
    await this.writeSettings({ last_backup_at: at.toISOString() });
  }

  private async writeSettings(patch: Partial<Settings>) {
    const current = await this.getSettings();
    const next: Settings = { ...current, ...patch, ui: { ...current.ui, ...patch.ui } };
    await this.db.settings.put({ key: SETTINGS_KEY, value: next });
    return next;
  }

  // ---------- Copias ----------

  async exportSnapshot(): Promise<Backup> {
    return {
      app: BACKUP_APP_ID,
      schema_version: SCHEMA_VERSION,
      exported_at: now(),
      projects: await this.db.projects.toArray(),
      tasks: await this.db.tasks.toArray(),
      settings: await this.getSettings(),
    };
  }

  /** Sustituye todos los datos. Vacía el historial: deshacer no puede cruzar una importación. */
  async replaceAll(backup: Backup) {
    await this.db.transaction('rw', this.db.projects, this.db.tasks, this.db.settings, async () => {
      await Promise.all([this.db.projects.clear(), this.db.tasks.clear(), this.db.settings.clear()]);
      await this.db.projects.bulkAdd(backup.projects);
      await this.db.tasks.bulkAdd(backup.tasks);
      await this.db.settings.put({ key: SETTINGS_KEY, value: backup.settings });
    });
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  // ---------- Meta (local al dispositivo) ----------

  async getMeta<T>(key: string) {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown) {
    await this.db.meta.put({ key, value });
  }
}

export const repo = new DexieRepository();
