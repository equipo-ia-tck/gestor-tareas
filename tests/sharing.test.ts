import { describe, expect, it } from 'vitest';

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
