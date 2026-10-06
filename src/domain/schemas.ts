import { z } from 'zod';
import { DEFAULT_SETTINGS } from './types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato YYYY-MM-DD');
const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha y hora no válida');

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string(),
  archived: z.boolean(),
  created_at: isoDateTime,
});

export const taskSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().nullable(),
  title: z.string(),
  notes: z.string().default(''),
  due_date: isoDate.nullable(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  estimated_minutes: z.number().int().min(0).nullable(),
  people: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  status: z.enum(['todo', 'done', 'archived']),
  recurrence_rule: recurrenceSchema.nullable().default(null),
  series_id: z.string().nullable().default(null),
  sort_order: z.number().default(0),
  raw_input: z.string().default(''),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  completed_at: isoDateTime.nullable(),
  last_touched_at: isoDateTime,
  deleted_at: isoDateTime.nullable().default(null),
});

export const settingsSchema = z.object({
  capacity_minutes: z.number().int().min(0).max(1440).default(DEFAULT_SETTINGS.capacity_minutes),
  workdays: z.array(z.number().int().min(0).max(6)).default(DEFAULT_SETTINGS.workdays),
  last_backup_at: isoDateTime.nullable().default(null),
  ui: z
    .object({
      summary_dismissed_on: isoDate.nullable().default(null),
      dictation_enabled: z.boolean().default(false),
    })
    .default(DEFAULT_SETTINGS.ui),
});

export const BACKUP_APP_ID = 'gestor-tareas';

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schema_version: z.number().int().min(1),
  exported_at: isoDateTime,
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  settings: settingsSchema,
});

export type Backup = z.infer<typeof backupSchema>;
