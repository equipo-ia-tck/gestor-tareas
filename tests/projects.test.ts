import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { TasksDB } from '../src/data/db';
import { DexieRepository } from '../src/data/repository';
import {
  ancestry, canMoveUnder, flattenTree, isEffectivelyArchived, projectPath, projectTree, resolveProjectToken, withDescendants,
} from '../src/domain/projects';
import type { Project } from '../src/domain/types';

const p = (id: string, name: string, parent_id: string | null = null, archived = false): Project =>
  ({ id, name, parent_id, archived, color: '#000', created_at: '' });

// caixa › sprint 14 › login ; caixa › sprint 15 ; personal
const all = [p('c', 'caixa'), p('s14', 'Sprint 14', 'c'), p('l', 'Login', 's14'), p('s15', 'Sprint 15', 'c'), p('x', 'personal')];
const map = new Map(all.map((x) => [x.id, x]));

describe('árbol de proyectos', () => {
  it('construye y aplana el árbol con profundidad', () => {
    const flat = flattenTree(projectTree(all)).map((n) => `${'-'.repeat(n.depth)}${n.project.name}`);
    expect(flat).toEqual(['caixa', '-Sprint 14', '--Login', '-Sprint 15', 'personal']);
  });

  it('descendientes, antepasados y ruta', () => {
    expect([...withDescendants('c', all)].sort()).toEqual(['c', 'l', 's14', 's15']);
    expect(ancestry('l', map).map((x) => x.id)).toEqual(['c', 's14', 'l']);
    expect(projectPath('l', map)).toBe('caixa / Sprint 14 / Login');
  });

  it('un padre archivado archiva a sus hijos', () => {
    const m = new Map([...all.map((x) => [x.id, x] as const), ['c', p('c', 'caixa', null, true)]]);
    expect(isEffectivelyArchived('l', m)).toBe(true);
    expect(isEffectivelyArchived('x', m)).toBe(false);
  });

  it('impide ciclos y más de 3 niveles', () => {
    expect(canMoveUnder('c', 'l', all)).toBe(false); // ciclo
    expect(canMoveUnder('x', 'l', all)).toBe(false); // sería nivel 4
    expect(canMoveUnder('x', 's15', all)).toBe(true);
    expect(canMoveUnder('s14', 'x', all)).toBe(true); // s14 + login = 2 niveles bajo personal
    expect(canMoveUnder('l', null, all)).toBe(true);
  });

  it('resuelve #nombre y #padre/hijo', () => {
    expect(resolveProjectToken('login', all)?.id).toBe('l');
    expect(resolveProjectToken('sprint-14/login', all)?.id).toBe('l');
    expect(resolveProjectToken('caixa/sprint-15', all)?.id).toBe('s15');
    expect(resolveProjectToken('caixa', all)?.id).toBe('c');
    expect(resolveProjectToken('otro/login', all)).toBeUndefined();
  });
});

describe('repositorio', () => {
  let repo: DexieRepository;
  beforeEach(() => { repo = new DexieRepository(new TasksDB(`v6-${crypto.randomUUID()}`)); });

  it('un subproyecto hereda el color del padre', async () => {
    const c = await repo.createProject('caixa', { color: '#123456' });
    const s = await repo.createProject('Sprint 14', { parent_id: c.id });
    expect(s).toMatchObject({ parent_id: c.id, color: '#123456' });
  });

  it('migración v5 → v6', async () => {
    const name = `mig6-${crypto.randomUUID()}`;
    const v5 = new Dexie(name);
    v5.version(5).stores({ projects: 'id', tasks: 'id', settings: 'key', meta: 'key', labels: 'name', item_types: 'id', releases: 'id', notes: 'id', people: 'name', activity: 'id' });
    await v5.table('projects').add({ id: 'c', name: 'caixa', color: '#000', archived: false, created_at: '' });
    await v5.table('notes').add({ id: 'n', title: 't', body: '', kind: 'note', date: '2026-10-07', project_id: null, people: [], pinned: false, created_at: '', updated_at: '', deleted_at: null });
    await v5.table('people').add({ name: 'Diana', role: '', notes: '' });
    v5.close();
    const db = new TasksDB(name);
    expect(await db.projects.get('c')).toMatchObject({ parent_id: null });
    expect(await db.notes.get('n')).toMatchObject({ task_id: null, meeting_url: null });
    expect(await db.people.get('Diana')).toMatchObject({ email: '' });
  });
});
