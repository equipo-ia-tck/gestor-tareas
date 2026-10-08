import { describe, expect, it } from 'vitest';
import { peopleDirectory } from '../src/domain/people';
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
      { name: 'Diana', tasks: 2, notes: 1 },
      { name: 'Luis', tasks: 1, notes: 0 },
      { name: 'Marcos Porto', tasks: 0, notes: 2 },
      { name: 'Ana', tasks: 0, notes: 1 },
      { name: 'Ana López', tasks: 0, notes: 0 },
    ]);
  });
});
