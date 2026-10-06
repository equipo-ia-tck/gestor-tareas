import { describe, expect, it } from 'vitest';
import { needsBackupReminder, parseBackup } from '../src/data/backup';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { makeTask } from './factories';

const valid = () => ({
  app: 'gestor-tareas',
  schema_version: 1,
  exported_at: '2026-10-05T10:00:00.000Z',
  projects: [{ id: 'p1', name: 'caixa', color: '#000', archived: false, created_at: '2026-10-01T00:00:00Z' }],
  tasks: [makeTask({ project_id: 'p1' }), makeTask({ status: 'done' })],
  settings: DEFAULT_SETTINGS,
});

describe('parseBackup', () => {
  it('acepta una copia válida y resume su contenido', () => {
    const r = parseBackup(JSON.stringify(valid()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toMatchObject({ projects: 1, activeTasks: 1, doneTasks: 1, totalTasks: 2 });
  });

  it('rechaza JSON mal formado', () => {
    expect(parseBackup('{nope')).toEqual({ ok: false, error: 'El archivo no es un JSON válido.' });
  });

  it('rechaza archivos de otra app', () => {
    const r = parseBackup(JSON.stringify({ ...valid(), app: 'otra' }));
    expect(r.ok).toBe(false);
  });

  it('rechaza tareas con campos inválidos', () => {
    const data = valid();
    (data.tasks[0] as unknown as { priority: number }).priority = 7;
    const r = parseBackup(JSON.stringify(data));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tasks.0.priority');
  });

  it('rechaza versiones de esquema futuras', () => {
    const r = parseBackup(JSON.stringify({ ...valid(), schema_version: 99 }));
    expect(r.ok).toBe(false);
  });

  it('rechaza tareas que apuntan a proyectos inexistentes', () => {
    const data = valid();
    data.projects = [];
    expect(parseBackup(JSON.stringify(data)).ok).toBe(false);
  });

  it('completa con valores por defecto los campos opcionales ausentes', () => {
    const data = valid() as Record<string, unknown>;
    data.settings = {};
    const r = parseBackup(JSON.stringify(data));
    expect(r.ok && r.backup.settings.capacity_minutes).toBe(360);
  });
});

describe('needsBackupReminder', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('no avisa si no hay datos', () => expect(needsBackupReminder(null, false, now)).toBe(false));
  it('avisa si nunca se ha hecho copia', () => expect(needsBackupReminder(null, true, now)).toBe(true));
  it('avisa pasados 7 días', () => {
    expect(needsBackupReminder('2026-10-02T12:00:00Z', true, now)).toBe(true);
    expect(needsBackupReminder('2026-10-04T12:00:00Z', true, now)).toBe(false);
  });
});
