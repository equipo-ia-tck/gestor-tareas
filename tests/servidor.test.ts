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
    const marta = signup('marta@vml.com', 'Marta García');
    expect(() => signup('marta@vml.com', 'Otra')).toThrow(/ya existe/);
    expect(signup('Marta.Garcia@vml.com', 'Marta G').login).toBe('marta.garcia@vml.com');
    expect(() => signup('con espacios', 'X')).toThrow(/email/);
    expect(() => api.login({ login: 'marta@vml.com', password: 'otra-cosa' })).toThrow(/incorrectos/);
    const { token } = api.login({ login: 'MARTA@vml.com', password: 'contraseña-larga' });
    expect(api.userForToken(token)?.id).toBe(marta.id);
    api.logout(token);
    expect(api.userForToken(token)).toBeNull();
  });

  it('reconoce una cuenta solo por nombre completo o usuario (no por el nombre de pila)', () => {
    const u = { id: '1', login: 'mark.r@vml.com', name: 'Mark Ruiz' };
    expect(['mark ruiz', 'Mark-Ruiz', 'Mark.R@vml.com'].every((p) => isUser(p, u))).toBe(true);
    expect(isUser('Mark', u)).toBe(false);
    expect(isUser('Marcos', u)).toBe(false);
  });

  it('todo es privado salvo lo que menciona a un compañero (con su proyecto)', () => {
    const marta = signup('marta@vml.com', 'Marta García');
    const mark = signup('mark@vml.com', 'Mark Ruiz');
    api.push(marta, [
      { table: 'projects', key: 'p1', data: { id: 'p1', name: 'Pagos', parent_id: 'p0' } },
      { table: 'projects', key: 'p0', data: { id: 'p0', name: 'Cliente', parent_id: null } },
      { table: 'projects', key: 'p2', data: { id: 'p2', name: 'Privado', parent_id: null } },
      { table: 'tasks', key: 'privada', data: task('privada', { project_id: 'p2' }) },
      { table: 'tasks', key: 'compartida', data: task('compartida', { people: ['Mark Ruiz'], project_id: 'p1', my_day: '2026-10-21' }) },
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
    const marta = signup('marta@vml.com', 'Marta García');
    const mark = signup('mark@vml.com', 'Mark Ruiz');
    api.push(marta, [
      { table: 'tasks', key: 't', data: task('t', { people: ['Mark Ruiz'] }) },
      { table: 'tasks', key: 'secreta', data: task('secreta') },
    ]);
    const r = api.push(mark, [
      { table: 'tasks', key: 't', data: task('t', { people: ['Mark Ruiz'], title: 'editada por Mark' }) },
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
    const marta = signup('marta@vml.com', 'Marta García');
    const mark = signup('mark@vml.com', 'Mark Ruiz');
    api.push(marta, [{ table: 'settings', key: 'settings', data: { key: 'settings', value: { capacity_minutes: 300 } } }]);
    api.push(mark, [{ table: 'settings', key: 'settings', data: { key: 'settings', value: { capacity_minutes: 480 } } }]);
    expect(api.pull(marta, 0).changes).toMatchObject([{ table: 'settings', data: { value: { capacity_minutes: 300 } } }]);
    expect(api.pull(mark, 0).changes).toMatchObject([{ table: 'settings', data: { value: { capacity_minutes: 480 } } }]);
  });

  it('solo manda lo que ha cambiado desde la última versión', () => {
    const marta = signup('marta@vml.com', 'Marta García');
    api.push(marta, [{ table: 'tasks', key: 'a', data: task('a') }]);
    const v = api.version;
    api.push(marta, [{ table: 'tasks', key: 'b', data: task('b') }, { table: 'tasks', key: 'a', data: null }]);
    expect(api.pull(marta, v).changes.map((c) => [c.key, c.data === null])).toEqual([['b', false], ['a', true]]);
  });
});

describe('espacios de equipo', () => {
  const join = (code: string, login: string, name: string) => api.register({ login, name, password: 'contraseña-larga', code }).user;

  it('los miembros ven todo lo de los proyectos del espacio (también subproyectos)', () => {
    const marta = signup('marta@vml.com', 'Marta García');
    const [exc] = api.createSpace(marta, { name: 'Excelencia' });
    const mark = join(exc.inviteCode, 'mark@vml.com', 'Mark Ruiz');
    const ana = join(api.createSpace(marta, { name: 'Pagos' }).find((s) => s.name === 'Pagos')!.inviteCode, 'ana@vml.com', 'Ana Pérez');
    api.push(marta, [
      { table: 'projects', key: 'p', data: { id: 'p', name: 'Revisiones', parent_id: null, space_id: exc.id } },
      { table: 'projects', key: 'sub', data: { id: 'sub', name: 'Uri', parent_id: 'p' } },
      { table: 'tasks', key: 'a', data: task('a', { project_id: 'sub' }) },
      { table: 'tasks', key: 'privada', data: task('privada') },
    ]);
    expect(keys(api.pull(mark, 0).changes)).toEqual(['projects:p', 'projects:sub', 'tasks:a']);
    expect(keys(api.pull(ana, 0).changes)).toEqual([]);
    // Un miembro puede editar lo del espacio aunque no sea suyo.
    expect(api.push(mark, [{ table: 'tasks', key: 'a', data: task('a', { project_id: 'sub', title: 'hecha por Mark' }) }]).rejected).toEqual([]);
    expect(api.spaces(mark)).toMatchObject([{ name: 'Excelencia', role: 'member' }]);
  });

  it('al cambiar lo que ve alguien, su siguiente petición lo recibe todo de nuevo', () => {
    const marta = signup('marta@vml.com', 'Marta García');
    const [exc] = api.createSpace(marta, { name: 'Excelencia' });
    const mark = signup('mark@vml.com', 'Mark Ruiz');
    api.push(marta, [
      { table: 'projects', key: 'p', data: { id: 'p', name: 'Revisiones', parent_id: null, space_id: null } },
      { table: 'tasks', key: 'a', data: task('a', { project_id: 'p' }) },
    ]);
    const cursor = api.pull(mark, 0).version;
    api.joinSpace(mark, { code: exc.inviteCode });
    // Marta lleva el proyecto al espacio: Mark recibe el proyecto y sus tareas antiguas.
    api.push(marta, [{ table: 'projects', key: 'p', data: { id: 'p', name: 'Revisiones', parent_id: null, space_id: exc.id } }]);
    const r = api.pull(mark, cursor);
    expect(r.reset).toBe(true);
    expect(keys(r.changes)).toEqual(['projects:p', 'tasks:a']);
    // Si sale del espacio, deja de verlo.
    api.removeMember(mark, exc.id, {});
    const r2 = api.pull(mark, r.version);
    expect(r2.reset).toBe(true);
    expect(keys(r2.changes)).toEqual([]);
  });

  it('solo se puede llevar un proyecto a un espacio propio, y siempre queda un administrador', () => {
    const marta = signup('marta@vml.com', 'Marta García');
    const mark = signup('mark@vml.com', 'Mark Ruiz');
    const [exc] = api.createSpace(marta, { name: 'Excelencia' });
    const r = api.push(mark, [{ table: 'projects', key: 'p', data: { id: 'p', name: 'X', parent_id: null, space_id: exc.id } }]);
    expect(r.rejected).toEqual(['projects:p']);
    api.joinSpace(mark, { code: exc.inviteCode });
    expect(() => api.removeMember(marta, exc.id, {})).toThrow(/administradora/);
    expect(() => api.removeMember(mark, exc.id, { userId: marta.id })).toThrow(/administra/);
    expect(() => api.register({ login: 'x@vml.com', name: 'X', password: 'contraseña-larga', code: 'NO-EXISTE' })).toThrow(/invitación/);
    const [nuevo] = api.updateSpace(marta, exc.id, { newCode: true });
    expect(nuevo.inviteCode).not.toBe(exc.inviteCode);
  });
});

describe('compartir en la app', () => {
  it('dice de quién es y con quién se comparte', async () => {
    const { shareInfo } = await import('../src/domain/sharing');
    const team = [{ id: 'm', login: 'marta@vml.com', name: 'Marta García' }, { id: 'k', login: 'mark@vml.com', name: 'Mark Ruiz' }, { id: 'd', login: 'dani@vml.com', name: 'Dani' }];
    expect(shareInfo(['Mark Ruiz', 'Mike'], undefined, team[0], team)).toEqual({ owner: null, with: [team[1]] });
    expect(shareInfo(['Mark'], undefined, team[0], team)).toEqual({ owner: null, with: [] });
    expect(shareInfo(['Marta García', 'dani'], 'k', team[0], team)).toEqual({ owner: team[1], with: [team[2]] });
  });

  it('sabe de qué espacio es cada cosa (los subproyectos heredan)', async () => {
    const { spaceOfProject, matchesSpace } = await import('../src/domain/spaces');
    const projects = new Map([
      ['p', { id: 'p', name: 'P', color: '', archived: false, created_at: '', parent_id: null, space_id: 'exc' }],
      ['s', { id: 's', name: 'S', color: '', archived: false, created_at: '', parent_id: 'p' }],
      ['x', { id: 'x', name: 'X', color: '', archived: false, created_at: '', parent_id: null }],
    ]);
    expect([spaceOfProject('s', projects), spaceOfProject('x', projects), spaceOfProject(null, projects)]).toEqual(['exc', null, null]);
    expect([matchesSpace('exc', 'all'), matchesSpace(null, 'personal'), matchesSpace('exc', 'personal'), matchesSpace('exc', 'exc')]).toEqual([true, true, false, true]);
  });
});
