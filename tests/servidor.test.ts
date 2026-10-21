import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { Api } from '../servidor/api.ts';
import { isUser } from '../servidor/visibility.ts';

let api: Api;
const signup = (login: string, name: string) => api.register({ login, name, password: 'contraseña-larga', code: api.teamCode }).user;

beforeEach(() => {
  api = new Api(new DatabaseSync(':memory:'));
});

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, people: [], project_id: null, my_day: null, remind_at: null, ...extra });
const keys = (changes: { table: string; key: string; data: unknown }[]) => changes.filter((c) => c.data).map((c) => `${c.table}:${c.key}`).sort();

describe('servidor del equipo', () => {
  it('crea cuentas solo con el código del equipo y comprueba la contraseña', () => {
    expect(() => api.register({ login: 'x', name: 'X', password: 'contraseña-larga', code: 'MAL' })).toThrow(/código/);
    const marta = signup('marta', 'Marta García');
    expect(() => signup('marta', 'Otra')).toThrow(/ya existe/);
    expect(() => api.login({ login: 'marta', password: 'otra-cosa' })).toThrow(/incorrectos/);
    const { token } = api.login({ login: 'MARTA', password: 'contraseña-larga' });
    expect(api.userForToken(token)?.id).toBe(marta.id);
    api.logout(token);
    expect(api.userForToken(token)).toBeNull();
  });

  it('reconoce a un compañero por nombre completo, de pila o usuario', () => {
    const u = { id: '1', login: 'mark.r', name: 'Mark Ruiz' };
    expect(['Mark', 'mark ruiz', 'Mark-Ruiz', 'mark.r'].every((p) => isUser(p, u))).toBe(true);
    expect(isUser('Marcos', u)).toBe(false);
  });

  it('todo es privado salvo lo que menciona a un compañero (con su proyecto)', () => {
    const marta = signup('marta', 'Marta García');
    const mark = signup('mark', 'Mark Ruiz');
    api.push(marta, [
      { table: 'projects', key: 'p1', data: { id: 'p1', name: 'Pagos', parent_id: 'p0' } },
      { table: 'projects', key: 'p0', data: { id: 'p0', name: 'Cliente', parent_id: null } },
      { table: 'projects', key: 'p2', data: { id: 'p2', name: 'Privado', parent_id: null } },
      { table: 'tasks', key: 'privada', data: task('privada', { project_id: 'p2' }) },
      { table: 'tasks', key: 'compartida', data: task('compartida', { people: ['Mark'], project_id: 'p1', my_day: '2026-10-21' }) },
      { table: 'notes', key: 'acta', data: { id: 'acta', title: 'Acta', people: ['Mark Ruiz'], project_id: null } },
      { table: 'people', key: 'Mike', data: { name: 'Mike', role: 'Valida' } },
      { table: 'item_types', key: 'us', data: { id: 'us', name: 'User Story' } },
    ]);
    expect(keys(api.pull(mark, 0).changes)).toEqual(['item_types:us', 'notes:acta', 'projects:p0', 'projects:p1', 'tasks:compartida']);
    // "Mi día" es de cada uno: a Mark le llega vacío; a Marta, el suyo.
    expect(api.pull(mark, 0).changes.find((c) => c.key === 'compartida')?.data).toMatchObject({ my_day: null });
    expect(api.pull(marta, 0).changes.find((c) => c.key === 'compartida')?.data).toMatchObject({ my_day: '2026-10-21' });
  });

  it('el compartido puede editar, no ve lo ajeno y deja de verlo si le quitan la mención', () => {
    const marta = signup('marta', 'Marta García');
    const mark = signup('mark', 'Mark Ruiz');
    api.push(marta, [
      { table: 'tasks', key: 't', data: task('t', { people: ['Mark'] }) },
      { table: 'tasks', key: 'secreta', data: task('secreta') },
    ]);
    const r = api.push(mark, [
      { table: 'tasks', key: 't', data: task('t', { people: ['Mark'], title: 'editada por Mark' }) },
      { table: 'tasks', key: 'secreta', data: task('secreta', { title: 'hack' }) },
    ]);
    expect(r.rejected).toEqual(['tasks:secreta']);
    const mine = api.pull(marta, 0).changes;
    expect(mine.find((c) => c.key === 't')).toMatchObject({ owner: marta.id, data: { title: 'editada por Mark' } });
    expect(mine.find((c) => c.key === 'secreta')?.data).toMatchObject({ title: 'secreta' });

    const since = api.version;
    api.push(marta, [{ table: 'tasks', key: 't', data: task('t', { people: [] }) }]);
    expect(api.pull(mark, since).changes).toEqual([{ table: 'tasks', key: 't', data: null, owner: null }]);
  });

  it('las fichas y ajustes son de cada uno aunque tengan la misma clave', () => {
    const marta = signup('marta', 'Marta García');
    const mark = signup('mark', 'Mark Ruiz');
    api.push(marta, [{ table: 'settings', key: 'settings', data: { key: 'settings', value: { capacity_minutes: 300 } } }]);
    api.push(mark, [{ table: 'settings', key: 'settings', data: { key: 'settings', value: { capacity_minutes: 480 } } }]);
    expect(api.pull(marta, 0).changes).toMatchObject([{ table: 'settings', data: { value: { capacity_minutes: 300 } } }]);
    expect(api.pull(mark, 0).changes).toMatchObject([{ table: 'settings', data: { value: { capacity_minutes: 480 } } }]);
  });

  it('solo manda lo que ha cambiado desde la última versión', () => {
    const marta = signup('marta', 'Marta García');
    api.push(marta, [{ table: 'tasks', key: 'a', data: task('a') }]);
    const v = api.version;
    api.push(marta, [{ table: 'tasks', key: 'b', data: task('b') }, { table: 'tasks', key: 'a', data: null }]);
    expect(api.pull(marta, v).changes.map((c) => [c.key, c.data === null])).toEqual([['b', false], ['a', true]]);
  });
});

describe('compartir en la app', () => {
  it('dice de quién es y con quién se comparte', async () => {
    const { shareInfo } = await import('../src/domain/sharing');
    const team = [{ id: 'm', login: 'marta', name: 'Marta García' }, { id: 'k', login: 'mark', name: 'Mark Ruiz' }, { id: 'd', login: 'dani', name: 'Dani' }];
    expect(shareInfo(['Mark', 'Mike'], undefined, team[0], team)).toEqual({ owner: null, with: [team[1]] });
    expect(shareInfo(['Marta', 'Dani'], 'k', team[0], team)).toEqual({ owner: team[1], with: [team[2]] });
  });
});
