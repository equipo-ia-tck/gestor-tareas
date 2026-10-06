/** Fecha local sin hora, formato YYYY-MM-DD. Evita errores de zona horaria. */
export type ISODate = string;
/** Marca de tiempo ISO 8601 completa. */
export type ISODateTime = string;

export type TaskStatus = 'todo' | 'done' | 'archived';
export type Priority = 1 | 2 | 3 | 4;

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** 0 = domingo … 6 = sábado. Solo para freq 'weekly'. */
  weekdays?: number[];
  /** Día del mes (1-31). Solo para freq 'monthly'. */
  monthDay?: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  created_at: ISODateTime;
}

export interface Task {
  id: string;
  project_id: string | null;
  title: string;
  notes: string;
  due_date: ISODate | null;
  priority: Priority;
  estimated_minutes: number | null;
  people: string[];
  tags: string[];
  status: TaskStatus;
  recurrence_rule: RecurrenceRule | null;
  /** Enlaza las ocurrencias de una misma tarea recurrente. */
  series_id: string | null;
  /** Orden manual dentro de una lista (arrastrar y soltar). */
  sort_order: number;
  raw_input: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  completed_at: ISODateTime | null;
  last_touched_at: ISODateTime;
  /** Borrado suave: permite deshacer. Se purga pasados 30 días. */
  deleted_at: ISODateTime | null;
}

export interface Settings {
  capacity_minutes: number;
  /** 0 = domingo … 6 = sábado. */
  workdays: number[];
  last_backup_at: ISODateTime | null;
  ui: {
    summary_dismissed_on: ISODate | null;
    dictation_enabled: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  capacity_minutes: 360,
  workdays: [1, 2, 3, 4, 5],
  last_backup_at: null,
  ui: { summary_dismissed_on: null, dictation_enabled: false },
};

export type NewTask = Partial<Omit<Task, 'id' | 'created_at' | 'updated_at' | 'last_touched_at'>> & {
  title: string;
};

export type TaskPatch = Partial<Omit<Task, 'id' | 'created_at'>>;

export const PROJECT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#8b5cf6', '#14b8a6', '#84cc16', '#f97316',
];
