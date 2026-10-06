import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TasksDB } from '../src/data/db';
import { DexieRepository } from '../src/data/repository';
import { parseBackup } from '../src/data/backup';

let repo: DexieRepository;

beforeEach(() => {
  repo = new DexieRepository(new TasksDB(`test-${crypto.randomUUID()}`));
});

describe('DexieRepository', () => {
  it('crea tareas con valores por defecto y guarda el texto original', async () => {
    const t = await repo.createTask({ title: '  llamar al dentista ' });
    expect(t).toMatchObject({ title: 'llamar al dentista', priority: 4, status: 'todo', project_id: null });
    expect(t.raw_input).toBe('  llamar al dentista ');
    expect(await repo.listTasks()).toHaveLength(1);
  });

  it('actualiza last_touched_at al editar', async () => {
    const t = await repo.createTask({ title: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const u = await repo.updateTask(t.id, { title: 'b' });
    expect(u?.title).toBe('b');
    expect(u!.last_touched_at > t.last_touched_at).toBe(true);
  });

  it('completa y descompleta', async () => {
    const t = await repo.createTask({ title: 'a' });
    await repo.setCompleted(t.id, true);
    expect(await repo.getTask(t.id)).toMatchObject({ status: 'done' });
    expect((await repo.getTask(t.id))?.completed_at).not.toBeNull();
    await repo.setCompleted(t.id, false);
    expect(await repo.getTask(t.id)).toMatchObject({ status: 'todo', completed_at: null });
  });

  it('borra de forma suave, restaura y purga', async () => {
    const t = await repo.createTask({ title: 'a' });
    await repo.deleteTask(t.id);
    expect(await repo.listTasks()).toHaveLength(0);
    await repo.restoreTask(t.id);
    expect(await repo.listTasks()).toHaveLength(1);
    await repo.deleteTask(t.id);
    expect(await repo.purgeDeleted(30)).toBe(0);
    expect(await repo.purgeDeleted(-1)).toBe(1);
    expect(await repo.getTask(t.id)).toBeUndefined();
  });

  it('gestiona proyectos y archivados', async () => {
    const p = await repo.createProject('caixa');
    await repo.createProject('alfa');
    expect((await repo.listProjects()).map((x) => x.name)).toEqual(['alfa', 'caixa']);
    await repo.updateProject(p.id, { archived: true });
    expect(await repo.listProjects()).toHaveLength(1);
    expect(await repo.listProjects(true)).toHaveLength(2);
  });

  it('devuelve ajustes por defecto y los fusiona', async () => {
    expect((await repo.getSettings()).capacity_minutes).toBe(360);
    await repo.updateSettings({ capacity_minutes: 300 });
    const s = await repo.getSettings();
    expect(s.capacity_minutes).toBe(300);
    expect(s.workdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('avisa de los cambios, salvo al registrar una copia', async () => {
    const spy = vi.fn();
    repo.onChange(spy);
    await repo.createTask({ title: 'a' });
    expect(spy).toHaveBeenCalledTimes(1);
    await repo.markBackup();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await repo.getSettings()).last_backup_at).not.toBeNull();
  });

  it('exporta e importa sin pérdidas (ida y vuelta)', async () => {
    const p = await repo.createProject('caixa');
    await repo.createTask({ title: 'a', project_id: p.id, people: ['Diana'], due_date: '2026-10-06' });
    await repo.createTask({ title: 'b' });
    const snapshot = await repo.exportSnapshot();
    const parsed = parseBackup(JSON.stringify(snapshot));
    expect(parsed.ok).toBe(true);

    const other = new DexieRepository(new TasksDB(`test-${crypto.randomUUID()}`));
    await other.createTask({ title: 'se sobrescribe' });
    if (parsed.ok) await other.replaceAll(parsed.backup);
    const tasks = await other.listTasks();
    expect(tasks.map((t) => t.title).sort()).toEqual(['a', 'b']);
    expect(await other.listProjects()).toHaveLength(1);
  });
});
