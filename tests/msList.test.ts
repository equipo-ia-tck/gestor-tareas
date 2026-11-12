import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Api } from './fakeAccounts.ts';
import { changesPathFor, MsList, pendingChanges, withPending } from '../servidor/msList.ts';
import {
  guessCategory, guessStatusColumn, listMoves, listPushes, statusValues, taskFromListItem, valueForCategory, type MsListConfig,
} from '../src/domain/msList';
import { msFieldText, parseMsList, type MsListItem } from '../src/domain/msListParse';
import { DEFAULT_ITEM_TYPES } from '../src/domain/workflows';
import { makeTask } from './factories';

/** Salida de «Obtener elementos» de SharePoint (recortada), con una columna de opción, una persona y las internas. */
const sharepoint = {
  value: [
    { '@odata.etag': '"1"', ItemInternalId: '7', ID: 7, Title: 'Revisar contrato', Estado: { '@odata.type': '#x', Id: 1, Value: 'En curso' },
      'Estado#Id': 1, Responsable: { Claims: 'i:0#', DisplayName: 'Ana Ruiz', Email: 'ana@wpp.com' }, Fecha_x0020_l_x00ed_mite: '2026-11-20T00:00:00Z',
      Etiquetas: [{ Value: 'Legal' }, { Value: 'Urgente' }], Modified: '2026-11-10T10:00:00Z', '{Link}': 'https://wpp.sharepoint.com/lista/7', OData__UIVersionString: '1.0' },
    { ID: 8, Title: 'Preparar demo', Estado: { Value: 'Pendiente' } },
    { ID: 9, Title: '', Estado: { Value: 'Completado' } },
    { Title: 'Sin ID' },
  ],
};

describe('Microsoft List: lectura', () => {
  it('convierte la salida de SharePoint (opciones, personas, listas, fechas) y quita las columnas internas', () => {
    const items = parseMsList(sharepoint);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: '7', title: 'Revisar contrato', url: 'https://wpp.sharepoint.com/lista/7', modified: '2026-11-10T10:00:00Z',
      fields: { Estado: 'En curso', Responsable: 'Ana Ruiz', Fecha_x0020_l_x00ed_mite: '2026-11-20', Etiquetas: 'Legal, Urgente' },
    });
    expect(items[2].title).toBe('Elemento 9');
    expect(parseMsList({ body: { value: [{ ID: 1, Title: 'x' }] } })).toHaveLength(1);
    expect(parseMsList([{ Id: 2, Title: 'y' }])[0].id).toBe('2');
    expect(parseMsList('basura')).toEqual([]);
    expect(msFieldText(true)).toBe('Sí');
  });
});

describe('Microsoft List: cambios pendientes', () => {
  const items = parseMsList(sharepoint);
  const change = (id: string, valor: string, at = '2026-11-10T11:00:00Z') => ({ id, campo: 'Estado', valor, titulo: 't', at });

  it('solo quedan los que la lista aún no refleja (y del mismo elemento, el último)', () => {
    expect(pendingChanges(items, [change('7', 'Completado'), change('8', 'Pendiente'), change('99', 'Completado')]))
      .toEqual([change('7', 'Completado')]);
    expect(pendingChanges(items, [change('7', 'Completado'), change('7', 'En curso')])).toEqual([]);
  });

  it('los elementos salen con el valor pendiente puesto', () => {
    const shown = withPending(items, [change('8', 'En curso')]);
    expect(shown.find((i) => i.id === '8')!.fields.Estado).toBe('En curso');
    expect(shown.find((i) => i.id === '7')).toBe(items[0]);
  });
});

describe('Microsoft List: servidor', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'lista-'));
    const file = join(dir, 'Gestor', 'lista.json');
    mkdirSync(join(dir, 'Gestor'));
    writeFileSync(file, `﻿${JSON.stringify(sharepoint)}`);
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    return { lista: new MsList(db, () => file), marta, file };
  }

  it('vincula el archivo, lee los elementos y apunta los cambios en Gestor/cambios', async () => {
    const { lista, marta, file } = setup();
    await expect(lista.items(marta)).rejects.toThrow(/Vincula/);
    expect(lista.link(marta)).toEqual({ linked: true, found: true });
    const first = await lista.items(marta);
    expect(first.items.map((i) => i.id)).toEqual(['7', '8', '9']);
    expect(first.pending).toEqual([]);

    await lista.change(marta, { id: '8', campo: 'Estado', valor: 'En curso' });
    const written = JSON.parse(readFileSync(changesPathFor(file), 'utf8'));
    expect(changesPathFor(file)).toBe(join(file, '..', 'cambios', 'lista-cambios.json'));
    expect(written.cambios).toMatchObject([{ id: '8', campo: 'Estado', valor: 'En curso', titulo: 'Preparar demo' }]);
    const after = await lista.items(marta);
    expect(after.items.find((i) => i.id === '8')!.fields.Estado).toBe('En curso');
    expect(after.pending).toHaveLength(1);

    // El flujo aplica el cambio y la exportación siguiente ya lo trae: el cambio se borra del archivo.
    const updated = structuredClone(sharepoint);
    updated.value[1].Estado = { Value: 'En curso' };
    writeFileSync(file, JSON.stringify(updated));
    const later = new Date(Date.now() + 5000);
    (await import('node:fs')).utimesSync(file, later, later);
    expect((await lista.items(marta)).pending).toEqual([]);
    expect(JSON.parse(readFileSync(changesPathFor(file), 'utf8')).cambios).toEqual([]);
  });

  it('rechaza cambios mal formados o de elementos que no existen', async () => {
    const { lista, marta } = setup();
    lista.link(marta);
    await expect(lista.change(marta, { id: 'x', campo: 'Estado', valor: 'a' })).rejects.toThrow(/no válido/);
    await expect(lista.change(marta, { id: '8', campo: '', valor: 'a' })).rejects.toThrow(/no válido/);
    await expect(lista.change(marta, { id: '123', campo: 'Estado', valor: 'a' })).rejects.toThrow(/ya no está/);
  });
});

describe('Microsoft List: en el gestor', () => {
  const items = parseMsList(sharepoint);
  const config: MsListConfig = { statusColumn: 'Estado', map: { Pendiente: 'todo' } };
  const types = DEFAULT_ITEM_TYPES;

  it('adivina la columna de estado y la categoría de cada valor', () => {
    expect(guessStatusColumn(items)).toBe('Estado');
    const other: MsListItem[] = [1, 2, 3].map((i) => ({ id: String(i), title: 't', url: null, modified: null,
      fields: { Notas: `texto ${i}`, Fase_x0020_actual: i === 3 ? 'Cerrada' : 'Abierta' } }));
    expect(guessStatusColumn(other)).toBe('Fase_x0020_actual');
    expect(['Pendiente', 'En curso', 'En espera', 'Completado', 'Cerrada'].map(guessCategory)).toEqual(['todo', 'doing', 'blocked', 'done', 'done']);
    expect(statusValues(items, 'Estado')).toEqual(['En curso', 'Pendiente', 'Completado']);
    expect(valueForCategory('done', statusValues(items, 'Estado'), config)).toBe('Completado');
    expect(valueForCategory('accepted', statusValues(items, 'Estado'), config)).toBe('Completado');
    expect(valueForCategory('blocked', statusValues(items, 'Estado'), config)).toBeNull();
  });

  it('la lista manda: mueve las tareas enlazadas a la categoría de su elemento', () => {
    const linked = makeTask({ external_id: 'LS-7' }); // en la lista: En curso
    const same = makeTask({ external_id: 'LS-8' }); // en la lista: Pendiente, ya está por hacer
    const accepted = makeTask({ external_id: 'LS-9', status: 'done', state_id: 'task-accepted' }); // Completado = hecho
    const moves = listMoves([linked, same, accepted, makeTask({ external_id: 'US1' })], items, config, types);
    expect(moves.map((m) => [m.task.external_id, m.stateId])).toEqual([['LS-7', 'task-doing']]);
    expect(listMoves([linked], items, { statusColumn: null, map: {} }, types)).toEqual([]);
  });

  it('al mover una tarea enlazada aquí (o deshacerlo), pide el cambio en la lista', () => {
    const before = makeTask({ external_id: 'LS-8' });
    const after = { ...before, state_id: 'task-done', status: 'done' as const };
    expect(listPushes([{ table: 'tasks', before, after }], false, types)).toEqual([{ id: '8', category: 'done' }]);
    expect(listPushes([{ table: 'tasks', before, after }], true, types)).toEqual([{ id: '8', category: 'todo' }]);
    expect(listPushes([{ table: 'tasks', before: makeTask(), after: makeTask() }], false, types)).toEqual([]);
  });

  it('crea la tarea con el título, el enlace y las demás columnas en las notas', () => {
    expect(taskFromListItem(items[0], config, 'p1', 'Contratos')).toMatchObject({
      title: 'Revisar contrato', external_id: 'LS-7', url: 'https://wpp.sharepoint.com/lista/7', project_id: 'p1',
      notes: 'De Contratos (elemento 7)\nResponsable: Ana Ruiz\nFecha límite: 2026-11-20\nEtiquetas: Legal, Urgente',
    });
  });
});
