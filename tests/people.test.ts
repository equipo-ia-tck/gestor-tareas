import { describe, expect, it } from 'vitest';
import { peopleDirectory } from '../src/domain/people';
import { rallyOwners } from '../src/domain/rally';
import type { Note } from '../src/domain/types';
import { makeTask } from './factories';

const note = (people: string[]): Note => ({
  id: crypto.randomUUID(), title: '', body: '', kind: 'note', date: '2026-10-08', project_id: null, people, pinned: false,
  task_id: null, meeting_url: null, sort_order: null, created_at: '', updated_at: '', deleted_at: null,
});

describe('directorio de personas', () => {
  it('une tareas, menciones en notas y fichas', () => {
    const dir = peopleDirectory(
      [makeTask({ people: ['Diana'] }), makeTask({ people: ['diana', 'Luis'] }), makeTask({ people: ['Luis'], status: 'done' })],
      [note(['Diana']), note(['Marcos Porto']), note(['marcos porto', 'Ana'])],
      [{ name: 'Ana López', role: '', notes: '', email: '' }, { name: 'Luis', role: 'Dev', notes: '', email: '' }],
    );
    expect(dir).toEqual([
      { name: 'Diana', tasks: 2, notes: 1, rally: 0 },
      { name: 'Luis', tasks: 1, notes: 0, rally: 0 },
      { name: 'Marcos Porto', tasks: 0, notes: 2, rally: 0 },
      { name: 'Ana', tasks: 0, notes: 1, rally: 0 },
      { name: 'Ana López', tasks: 0, notes: 0, rally: 0 },
    ]);
  });

  it('añade a los Owners de Rally de las tareas enlazadas, sin contar dos veces', () => {
    const tasks = [
      makeTask({ external_id: 'US-1' }),
      makeTask({ external_id: 'US2', people: ['Carla Ruiz'] }),
      makeTask({ external_id: 'US3', status: 'done' }),
      makeTask({ external_id: 'US4' }),
      makeTask({ external_id: 'otra-cosa' }),
      makeTask({ external_id: 'US5', deleted_at: '2026-10-01T00:00:00Z' }),
    ];
    const owners: Record<string, string> = { US1: 'Carla Ruiz', US2: 'carla ruiz', US3: 'Elena', US4: 'Elena', US5: 'Borrada' };
    const map = rallyOwners(tasks, (id) => owners[id]);
    expect([...map.values()]).toEqual(['Carla Ruiz', 'carla ruiz', 'Elena', 'Elena']);
    expect(peopleDirectory(tasks, [], [], map)).toEqual([
      { name: 'Carla Ruiz', tasks: 1, notes: 0, rally: 1 },
      { name: 'Elena', tasks: 0, notes: 0, rally: 1 },
    ]);
  });
});

describe('renombrar y unir personas', async () => {
  const { renameInList, renameMentions } = await import('../src/domain/people');
  const { TasksDB } = await import('../src/data/db');
  const { DexieRepository } = await import('../src/data/repository');

  it('menciones y listas', () => {
    expect(renameMentions('hablar con @Diana-Pérez y @diana-perez; @Luis', 'Diana Pérez', 'Diana')).toBe('hablar con @Diana y @Diana; @Luis');
    expect(renameInList(['Diana Pérez', 'Diana', 'Luis'], 'Diana Pérez', 'Diana')).toEqual(['Diana', 'Luis']);
  });

  it('une a dos personas en tareas, notas y fichas, y se puede deshacer', async () => {
    const repo = new DexieRepository(new TasksDB(`ppl-${crypto.randomUUID()}`));
    const t = await repo.createTask({ title: 'x', people: ['Diana Pérez', 'Luis'] });
    const n = await repo.createNote({ date: '2026-10-08', body: '@Diana-Pérez pide la demo' });
    await repo.savePerson({ name: 'Diana Pérez', role: '', notes: 'del calendario', email: 'diana@empresa.com' });
    await repo.savePerson({ name: 'Diana', role: 'PO', notes: '', email: '' });
    await repo.renamePerson('Diana Pérez', 'Diana');
    expect((await repo.getTask(t.id))?.people).toEqual(['Diana', 'Luis']);
    expect((await repo.getNote(n.id))?.body).toBe('@Diana pide la demo');
    expect((await repo.getNote(n.id))?.people).toEqual(['Diana']);
    expect(await repo.listPeople()).toEqual([{ name: 'Diana', role: 'PO', notes: 'del calendario', email: 'diana@empresa.com' }]);
    await repo.undo();
    expect((await repo.getTask(t.id))?.people).toEqual(['Diana Pérez', 'Luis']);
    expect((await repo.listPeople()).map((p) => p.name).sort()).toEqual(['Diana', 'Diana Pérez']);
  });
});
