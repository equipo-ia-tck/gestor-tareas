import { backupSchema, type Backup } from '../domain/schemas';
import { isActive } from '../domain/selectors';
import { SCHEMA_VERSION } from './db';
import type { Repository } from './repository';

export interface BackupSummary {
  exportedAt: string;
  projects: number;
  activeTasks: number;
  doneTasks: number;
  totalTasks: number;
}

export type ParseResult =
  | { ok: true; backup: Backup; summary: BackupSummary }
  | { ok: false; error: string };

/** Valida un JSON de copia antes de importarlo. Nunca toca la base de datos. */
export function parseBackup(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    return { ok: false, error: `El archivo no es una copia válida (${path || 'raíz'}: ${issue.message}).` };
  }
  const backup = result.data;
  if (backup.schema_version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `La copia es de una versión más nueva de la app (esquema ${backup.schema_version}).`,
    };
  }
  const ids = new Set(backup.projects.map((p) => p.id));
  const orphan = backup.tasks.find((t) => t.project_id && !ids.has(t.project_id));
  if (orphan) {
    return { ok: false, error: `La tarea "${orphan.title}" apunta a un proyecto que no existe.` };
  }
  const live = backup.tasks.filter((t) => !t.deleted_at);
  return {
    ok: true,
    backup,
    summary: {
      exportedAt: backup.exported_at,
      projects: backup.projects.length,
      activeTasks: live.filter(isActive).length,
      doneTasks: live.filter((t) => t.status === 'done').length,
      totalTasks: live.length,
    },
  };
}

export const backupFileName = (d = new Date()) =>
  `tareas-${d.toISOString().slice(0, 10)}.json`;

export async function serializeBackup(repo: Repository): Promise<string> {
  return JSON.stringify(await repo.exportSnapshot(), null, 2);
}

/** Descarga la copia como archivo y registra la fecha. */
export async function downloadBackup(repo: Repository) {
  const blob = new Blob([await serializeBackup(repo)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  a.click();
  URL.revokeObjectURL(url);
  await repo.markBackup();
}

export const BACKUP_REMINDER_DAYS = 7;

export function needsBackupReminder(lastBackupAt: string | null, hasData: boolean, now = new Date()) {
  if (!hasData) return false;
  if (!lastBackupAt) return true;
  return now.getTime() - Date.parse(lastBackupAt) > BACKUP_REMINDER_DAYS * 86_400_000;
}

/** Pide al navegador que no borre los datos bajo presión de espacio. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
