import { describe, expect, it } from 'vitest';
import { matchesSearch, parseSearch } from '../src/domain/search';
import type { Project } from '../src/domain/types';
import { makeTask } from './factories';

const projects = new Map<string, Project>([
  ['p1', { id: 'p1', name: 'Caixa', color: '#000', archived: false, created_at: '' }],
]);

const t1 = makeTask({ title: 'Revisar informe trimestral', project_id: 'p1', people: ['Diana'], tags: ['urgente'] });
const t2 = makeTask({ title: 'Comprar café', notes: 'el de Colombia', checklist: [{ id: 'c', text: 'molido fino', done: false }] });
const t3 = makeTask({ title: 'Informe antiguo', status: 'done' });
const all = [t1, t2, t3];
const search = (q: string) => all.filter((t) => matchesSearch(t, parseSearch(q), projects)).map((t) => t.id);

describe('búsqueda', () => {
  it('busca en título y notas sin importar tildes ni mayúsculas', () => {
    expect(search('INFORME')).toEqual([t1.id]);
    expect(search('colombia')).toEqual([t2.id]);
    expect(search('cafe')).toEqual([t2.id]);
    expect(search('molido')).toEqual([t2.id]);
  });

  it('todas las palabras deben coincidir', () => {
    expect(search('informe café')).toEqual([]);
  });

  it('filtra por proyecto, persona y etiqueta (por prefijo)', () => {
    expect(search('#cai')).toEqual([t1.id]);
    expect(search('@diana')).toEqual([t1.id]);
    expect(search('+urg')).toEqual([t1.id]);
    expect(search('@luis')).toEqual([]);
  });

  it('las palabras también encuentran el nombre del proyecto o la persona', () => {
    expect(search('caixa')).toEqual([t1.id]);
    expect(search('diana')).toEqual([t1.id]);
  });

  it('excluye completadas salvo con "todas:"', () => {
    expect(search('informe todas:')).toEqual([t1.id, t3.id]);
  });
});
