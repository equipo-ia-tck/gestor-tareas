import { describe, expect, it } from 'vitest';
import { activeFilterCount, applyFilter, EMPTY_FILTER, groupTasks } from '../src/domain/filters';
import type { Project, TaskFilter } from '../src/domain/types';
import { DEFAULT_ITEM_TYPES } from '../src/domain/workflows';
import { makeTask } from './factories';

const today = '2026-10-07';
const projects: Project[] = [
  { id: 'c', name: 'caixa', parent_id: null, color: '#f00', archived: false, created_at: '' },
  { id: 's', name: 'Sprint 14', parent_id: 'c', color: '#f00', archived: false, created_at: '' },
  { id: 'x', name: 'personal', parent_id: null, color: '#0f0', archived: false, created_at: '' },
];
const ctx = { today, projects, types: DEFAULT_ITEM_TYPES };

const tasks = [
  makeTask({ title: 'tarea caixa', project_id: 'c', due_date: '2026-10-05' }),
  makeTask({ title: 'US login', type_id: 'us', state_id: 'us-qa', project_id: 's', people: ['Diana'], tags: ['sprint-14'], due_date: today }),
  makeTask({ title: 'TS mfa', type_id: 'ts', state_id: 'ts-failed', project_id: 's', people: ['Diana', 'Luis'], release_id: 'r1' }),
  makeTask({ title: 'tema plan', type_id: 'topic', state_id: 'topic-pending', people: ['Diana'] }),
  makeTask({ title: 'hecha', status: 'done', project_id: 'x', due_date: '2026-10-10' }),
];
const f = (patch: Partial<TaskFilter>) => applyFilter(tasks, { ...EMPTY_FILTER, ...patch }, ctx).map((t) => t.title);

describe('filtro de "Todo"', () => {
  it('sin filtros: todo lo pendiente de todos los tipos', () => {
    expect(f({})).toHaveLength(4);
    expect(f({ includeDone: true })).toHaveLength(5);
  });

  it('por tipo (varios a la vez)', () => {
    expect(f({ types: ['us', 'ts'] }).sort()).toEqual(['TS mfa', 'US login']);
    expect(f({ types: ['topic'] })).toEqual(['tema plan']);
  });

  it('por categoría de estado; "done" incluye completadas', () => {
    expect(f({ categories: ['blocked'] })).toEqual(['TS mfa']);
    expect(f({ categories: ['done'] })).toEqual(['hecha']);
  });

  it('un proyecto incluye sus subproyectos', () => {
    expect(f({ projects: ['c'] }).sort()).toEqual(['TS mfa', 'US login', 'tarea caixa']);
    expect(f({ projects: ['s'] }).sort()).toEqual(['TS mfa', 'US login']);
  });

  it('persona, etiqueta, release y texto', () => {
    expect(f({ people: ['diana'] })).toHaveLength(3);
    expect(f({ tags: ['sprint-14'] })).toEqual(['US login']);
    expect(f({ releases: ['r1'] })).toEqual(['TS mfa']);
    expect(f({ text: 'LOGIN' })).toEqual(['US login']);
  });

  it('fechas', () => {
    expect(f({ due: 'overdue' })).toEqual(['tarea caixa']);
    expect(f({ due: 'today' })).toEqual(['US login']);
    expect(f({ due: 'none' }).sort()).toEqual(['TS mfa', 'tema plan']);
    expect(f({ due: 'week', includeDone: true })).toEqual(['US login', 'hecha']);
  });

  it('cuenta los filtros activos', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, types: ['us'], due: 'today', text: 'x' })).toBe(3);
  });
});

describe('agrupar', () => {
  const pending = applyFilter(tasks, EMPTY_FILTER, ctx);
  const labels = (by: TaskFilter['groupBy']) => groupTasks(pending, by, ctx).map((g) => `${g.label}:${g.tasks.length}`);

  it('por tipo, en el orden de los tipos', () => {
    expect(labels('type')).toEqual(['Tarea:1', 'User Story:1', 'Test Scenario:1', 'Para hablar:1']);
  });

  it('por proyecto con ruta y "Sin proyecto" al final', () => {
    expect(labels('project')).toEqual(['caixa:1', 'caixa / Sprint 14:2', 'Sin proyecto:1']);
  });

  it('por persona (una tarea puede estar en varios grupos)', () => {
    expect(labels('person')).toEqual(['Diana:3', 'Luis:1', 'Sin persona:1']);
  });

  it('por fecha y por estado', () => {
    expect(labels('due')).toEqual(['Atrasadas:1', 'Hoy:1', 'Sin fecha:2']);
    expect(labels('state')).toEqual(['Por hacer:1', 'US · En QA:1', 'TS · Fallido:1', 'HABLAR · Pendiente:1']);
  });
});
