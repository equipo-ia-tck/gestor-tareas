import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Api } from '../servidor/api.ts';
import { commentHtml, fieldValue, htmlToText, joinQuery, normalizeBaseUrl, Rally, rallyCategory, toRallyItem } from '../servidor/rally.ts';
import { groupRally, isRallyId, linkedTask, rallyIdsOf, rallyMoves, rallyPushes, taskFromRally, tasksByRallyId, type RallyItem } from '../src/domain/rally';
import { DEFAULT_ITEM_TYPES } from '../src/domain/workflows';
import { makeTask } from './factories';

const BASE = 'https://eu1.rallydev.com';
const story = { _type: 'HierarchicalRequirement', FormattedID: 'US1764574', ObjectID: 111, Name: ' Login SSO ', ScheduleState: 'In-Progress',
  Blocked: false, Project: { _refObjectName: 'Caixa Web' }, Iteration: { _refObjectName: 'Sprint 14' }, Release: null, LastUpdateDate: '2026-10-20T10:00:00.000Z' };

const item = (extra: Partial<RallyItem> = {}): RallyItem => ({
  id: 'US1', objectId: '1', kind: 'US', name: 'Uno', state: 'Defined', done: false, blocked: false, project: null,
  stateOrder: 2, category: 'todo', iteration: null, release: null, assignee: null, owner: null, mine: true, updatedAt: '', url: `${BASE}/#/detail/userstory/1`, ...extra,
});

/** Rally falso: responde a /user y a /artifact y apunta las peticiones. */
function fakeRally(results: Record<string, unknown>[], status = 200) {
  const calls: { url: string; key: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, key: (init.headers as Record<string, string>).ZSESSIONID });
    const body = url.includes('/user') ? { User: { ObjectID: 42, DisplayName: 'Marta García' } }
      : { QueryResult: { Errors: [], Results: results, TotalResultCount: results.length } };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('Rally: servidor', () => {
  it('convierte los resultados de la WSAPI y descarta los tipos que no usamos', () => {
    expect(toRallyItem(story, BASE)).toEqual({
      id: 'US1764574', objectId: '111', kind: 'US', name: 'Login SSO', state: 'In-Progress', stateOrder: 5, category: 'doing', done: false, blocked: false,
      project: 'Caixa Web', iteration: 'Sprint 14', release: null, assignee: null, owner: null, mine: false, updatedAt: '2026-10-20T10:00:00.000Z',
      url: `${BASE}/#/detail/userstory/111`,
    });
    expect(toRallyItem({ ...story, ScheduleState: 'Accepted' }, BASE)?.done).toBe(true);
    expect(toRallyItem({ _type: 'Defect', FormattedID: 'DE9', ObjectID: 9, ScheduleState: 'Defined', State: 'Closed' }, BASE)?.state).toBe('Defined');
    expect(toRallyItem({ _type: 'TestCase', FormattedID: 'TC5', ObjectID: 5 }, BASE)).toMatchObject({ kind: 'TC', state: 'Sin ejecutar', done: false });
    expect(toRallyItem({ _type: 'TestCase', FormattedID: 'TC6', ObjectID: 6, LastVerdict: 'Pass' }, BASE)?.done).toBe(true);
    expect(toRallyItem({ _type: 'PortfolioItem/Feature', FormattedID: 'F1' }, BASE)).toBeNull();
  });

  it('usa la columna del tablero (FlowState) y el Assignee, y marca lo de la persona conectada', () => {
    const user = (id: number, name: string) => ({ _ref: `${BASE}/slm/webservice/v2.0/user/${id}`, _refObjectName: name });
    const it = toRallyItem({
      ...story, FlowState: { _refObjectName: 'Need Review', OrderIndex: 6 }, ScheduleState: 'Accepted',
      Owner: user(1, 'Albert'), c_Assignee: user(42, 'Marc'),
    }, BASE, '42');
    expect(it).toMatchObject({ state: 'Need Review', stateOrder: 6, done: true, assignee: 'Marc', owner: 'Albert', mine: true });
    expect(toRallyItem({ ...story, Owner: user(1, 'Albert') }, BASE, '42')).toMatchObject({ assignee: 'Albert', mine: false });
  });

  it('clasifica en Por hacer, Bloqueado, En curso, Hecho y Accepted', () => {
    expect(rallyCategory('New', 'New', false)).toBe('todo');
    expect(rallyCategory('Defined', 'Defined', false)).toBe('todo');
    expect(rallyCategory('Blocked', 'Defined', false)).toBe('blocked');
    expect(rallyCategory('Need Review', 'In-Progress', true)).toBe('blocked');
    expect(rallyCategory('Need Review', 'In-Progress', false)).toBe('doing');
    expect(rallyCategory('Desarrollo', 'Defined', false)).toBe('doing');
    expect(rallyCategory('Completed', 'Completed', false)).toBe('done');
    expect(rallyCategory('Accepted', 'Accepted', true)).toBe('accepted');
    expect(rallyCategory(null, 'Closed', false)).toBe('accepted');
    expect(rallyCategory(null, 'Pass', false)).toBe('done');
    expect(rallyCategory(null, 'Fail', false)).toBe('blocked');
    expect(rallyCategory(null, 'Sin ejecutar', false)).toBe('todo');
  });

  it('anida las condiciones de dos en dos, como pide la WSAPI', () => {
    expect(joinQuery(['(a)'], 'OR')).toBe('(a)');
    expect(joinQuery(['(a)', '(b)', '(c)'], 'OR')).toBe('(((a) OR (b)) OR (c))');
  });

  it('solo admite direcciones de Rally', () => {
    expect(normalizeBaseUrl('')).toBe(BASE);
    expect(normalizeBaseUrl('rally1.rallydev.com/slm')).toBe('https://rally1.rallydev.com');
    expect(() => normalizeBaseUrl('https://evil.example.com')).toThrow(/Rally/);
    expect(() => normalizeBaseUrl('http://eu1.rallydev.com')).toThrow(/Rally/);
  });

  it('comprueba la clave, la guarda por usuario sin devolverla y consulta lo asignado', async () => {
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    const { fetcher, calls } = fakeRally([story, { _type: 'Milestone', FormattedID: 'MI1' }]);
    const rally = new Rally(db, fetcher);

    await expect(rally.items(marta)).rejects.toThrow(/Conecta/);
    await expect(rally.connect(marta, { apiKey: '  ' })).rejects.toThrow(/clave/);
    const status = await rally.connect(marta, { apiKey: '_secreta1234' });
    expect(status).toEqual({ connected: true, baseUrl: BASE, keyHint: '1234', rallyUser: 'Marta García' });
    expect(JSON.stringify(status)).not.toContain('_secreta');

    calls.length = 0;
    const items = await rally.items(marta, 30);
    expect(items.map((i) => i.id)).toEqual(Array(5).fill('US1764574')); // el Rally falso responde lo mismo a cada tipo
    expect(calls.map((c) => new URL(c.url).pathname.split('/').pop())).toEqual(['hierarchicalrequirement', 'defect', 'task', 'testset', 'testcase']);
    expect(calls[0].key).toBe('_secreta1234');
    const query = (i: number) => new URL(calls[i].url).searchParams.get('query');
    expect(query(0)).toMatch(/^\(\(\(Owner\.ObjectID = 42\) OR \(c_Assignee\.ObjectID = 42\)\) AND \(LastUpdateDate >= "\d{4}-\d{2}-\d{2}"\)\)$/);
    expect(query(3)).toMatch(/^\(\(Owner\.ObjectID = 42\) AND /);

    calls.length = 0;
    await rally.items(marta, 0);
    expect(query(0)).toBe('((Owner.ObjectID = 42) OR (c_Assignee.ObjectID = 42))');

    calls.length = 0;
    await rally.items(marta, 0, ['7', '8', 'mal']);
    expect(query(0)).toBe('((Project.ObjectID = 7) OR (Project.ObjectID = 8))');
    expect(query(4)).toBe('((Project.ObjectID = 7) OR (Project.ObjectID = 8))');

    calls.length = 0;
    await rally.lookup(marta, { ids: ['us-1', 'US1', 'TS9', 'mal', 'DE"x'] });
    expect(calls.map((c) => `${new URL(c.url).pathname.split('/').pop()} ${new URL(c.url).searchParams.get('query')}`)).toEqual([
      'hierarchicalrequirement (FormattedID = "US1")', 'testset (FormattedID = "TS9")',
    ]);

    expect(rally.disconnect(marta).connected).toBe(false);
  });

  it('explica una clave rechazada', async () => {
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    const rally = new Rally(db, fakeRally([], 401).fetcher);
    await expect(rally.connect(marta, { apiKey: '_mala' })).rejects.toThrow(/no acepta la clave/);
    expect(rally.status(marta).connected).toBe(false);
  });
});

describe('Rally: ficha', () => {
  it('pasa el HTML de Rally a texto legible', () => {
    expect(htmlToText('<p>Hola&nbsp;<b>equipo</b></p><ul><li>Uno</li><li>Dos &amp; tres</li></ul><p>Fin<br>línea &#8364; &#x41;</p>'))
      .toBe('Hola equipo\n\n• Uno\n• Dos & tres\nFin\nlínea € A');
    expect(htmlToText('<script>alert(1)</script><div>ok</div><img src="x">')).toBe('ok\n[imagen]');
  });

  it('da formato a los valores y descarta los vacíos y las colecciones', () => {
    expect(fieldValue('2026-10-20T10:30:00.000Z')).toBe('2026-10-20 10:30');
    expect(fieldValue({ _refObjectName: 'Sprint 14' })).toBe('Sprint 14');
    expect(fieldValue(true)).toBe('Sí');
    expect(fieldValue(3)).toBe('3');
    for (const v of [null, '', false, 0, { Count: 2, _ref: 'x' }]) expect(fieldValue(v)).toBeNull();
  });

  it('monta la ficha con los nombres de Rally, textos, etiquetas, hijos, discusión y adjuntos', async () => {
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    const ws = `${BASE}/slm/webservice/v2.0`;
    const col = (path: string, count: number) => ({ _ref: `${ws}/HierarchicalRequirement/111/${path}`, Count: count });
    const responses: Record<string, unknown> = {
      '/user': { User: { ObjectID: 42, DisplayName: 'Marta' } },
      '/hierarchicalrequirement/111': { HierarchicalRequirement: {
        ...story, ObjectUUID: 'x', Blocked: true, BlockedReason: 'Falta figma', c_APPGAR: 'APP1', PlanEstimate: 0,
        Description: '<p>Como usuaria quiero <b>entrar</b></p>', Notes: '', c_Criterios: '<ul><li>Funciona</li></ul>',
        Tags: col('Tags', 1), Discussion: col('Discussion', 1), Attachments: col('Attachments', 1), Tasks: col('Tasks', 1),
        Children: col('Children', 0), TestCases: col('TestCases', 0), Defects: col('Defects', 0),
      } },
      '/typedefinition': { QueryResult: { Errors: [], Results: [{ Attributes: { _ref: `${ws}/TypeDefinition/1/Attributes` } }] } },
      '/TypeDefinition/1/Attributes': { QueryResult: { Errors: [], Results: [
        { ElementName: 'c_APPGAR', Name: 'APPGAR' }, { ElementName: 'c_Criterios', Name: 'Criterios de aceptación' },
        { ElementName: 'Description', Name: 'Description' }, { ElementName: 'ScheduleState', Name: 'Schedule State' },
      ] } },
      '/HierarchicalRequirement/111/Tags': { QueryResult: { Errors: [], Results: [{ Name: 'APP' }] } },
      '/HierarchicalRequirement/111/Discussion': { QueryResult: { Errors: [], Results: [
        { Text: '<p>¿Hay diseño?</p>', User: { _refObjectName: 'Ana' }, CreationDate: '2026-10-21T09:00:00.000Z' },
      ] } },
      '/HierarchicalRequirement/111/Attachments': { QueryResult: { Errors: [], Results: [{ Name: 'login.png', Size: 2048 }] } },
      '/HierarchicalRequirement/111/Tasks': { QueryResult: { Errors: [], Results: [
        { _type: 'Task', FormattedID: 'TA1', ObjectID: 5, Name: 'Maquetar', State: 'Defined' },
      ] } },
    };
    const fetcher = (async (url: string) => {
      const path = new URL(url).pathname.replace('/slm/webservice/v2.0', '');
      return new Response(JSON.stringify(responses[path] ?? { QueryResult: { Errors: [`No existe ${path}`] } }));
    }) as unknown as typeof fetch;
    const rally = new Rally(db, fetcher);
    await rally.connect(marta, { apiKey: '_clave' });

    await expect(rally.detail(marta, 'XX', '111')).rejects.toThrow(/no válido/);
    await expect(rally.detail(marta, 'US', '1;drop')).rejects.toThrow(/no válido/);
    const d = await rally.detail(marta, 'US', '111');
    expect(d.item).toMatchObject({ id: 'US1764574', blocked: true });
    expect(d.blockedReason).toBe('Falta figma');
    expect(d.fields).toContainEqual({ label: 'APPGAR', value: 'APP1' });
    expect(d.fields).toContainEqual({ label: 'Schedule State', value: 'In-Progress' });
    expect(d.fields.map((f) => f.label)).not.toContain('ObjectUUID');
    expect(d.fields.map((f) => f.label)).not.toContain('PlanEstimate');
    expect(d.texts).toEqual([
      { label: 'Description', text: 'Como usuaria quiero entrar' },
      { label: 'Criterios de aceptación', text: '• Funciona' },
    ]);
    expect(d.tags).toEqual(['APP']);
    expect(d.related).toEqual([{ label: 'Tareas', items: [expect.objectContaining({ id: 'TA1', kind: 'TA', state: 'Defined' })] }]);
    expect(d.discussion).toEqual([{ author: 'Ana', date: '2026-10-21T09:00:00.000Z', text: '¿Hay diseño?' }]);
    expect(d.attachments).toEqual([{ name: 'login.png', size: 2048 }]);
  });
});

describe('Rally: mover', () => {
  const ws = `${BASE}/slm/webservice/v2.0`;
  const flows = ['New', 'Defined', 'To Do', 'Blocked', 'In-Progress', 'Need Review', 'Completed', 'Accepted']
    .map((Name, i) => ({ Name, _ref: `${ws}/flowstate/${i + 1}` }));

  async function setup(row: Record<string, unknown>, opts: { readOnly?: boolean } = {}) {
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    const posts: { path: string; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const path = u.pathname.replace('/slm/webservice/v2.0', '');
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push({ path, body });
        if (opts.readOnly) return new Response(JSON.stringify({ OperationResult: { Errors: ['Not authorized to perform action: Invalid key'] } }));
        const patch = Object.values(body)[0] as Record<string, unknown>;
        const flow = flows.find((f) => f._ref === patch.FlowState);
        return new Response(JSON.stringify({ OperationResult: { Errors: [], Object: { ...row, ...patch, ...(flow ? { FlowState: { _refObjectName: flow.Name } } : {}) } } }));
      }
      const results = path === '/user' ? null : path === '/flowstate' ? flows : [row];
      return new Response(JSON.stringify(results ? { QueryResult: { Errors: [], Results: results, TotalResultCount: results.length } } : { User: { ObjectID: 42, DisplayName: 'Marta' } }));
    }) as unknown as typeof fetch;
    const rally = new Rally(db, fetcher);
    await rally.connect(marta, { apiKey: '_clave' });
    return { rally, marta, posts };
  }
  const us = { FormattedID: 'US1', ObjectID: 111, Name: 'Login', ScheduleState: 'In-Progress', FlowState: { _refObjectName: 'Need Review' },
    Blocked: true, Project: { _ref: `${ws}/project/7` } };

  it('mueve a la columna del tablero de la categoría y quita la marca de bloqueo', async () => {
    const { rally, marta, posts } = await setup(us);
    const item = await rally.move(marta, { id: 'US-1', category: 'accepted' });
    expect(posts).toEqual([{ path: '/hierarchicalrequirement/111', body: { HierarchicalRequirement: { FlowState: `${ws}/flowstate/8`, Blocked: false } } }]);
    expect(item.category).toBe('accepted');
    posts.length = 0;
    await rally.move(marta, { id: 'US1', category: 'todo' });
    expect(posts[0].body).toEqual({ HierarchicalRequirement: { FlowState: `${ws}/flowstate/2`, Blocked: false } }); // Defined, no New
  });

  it('no escribe si ya está en esa categoría; las tareas cambian su State', async () => {
    const { rally, marta, posts } = await setup({ ...us, Blocked: false });
    await rally.move(marta, { id: 'US1', category: 'doing' }); // Need Review ya es "En curso"
    expect(posts).toEqual([]);
    const task = await setup({ FormattedID: 'TA5', ObjectID: 5, State: 'Defined', Blocked: false });
    await task.rally.move(task.marta, { id: 'TA5', category: 'accepted' });
    expect(task.posts[0]).toEqual({ path: '/task/5', body: { Task: { State: 'Completed' } } });
    await task.rally.move(task.marta, { id: 'TA5', category: 'blocked' });
    expect(task.posts[1].body).toEqual({ Task: { Blocked: true } });
  });

  it('publica un comentario en la discusión', async () => {
    const { rally, marta, posts } = await setup(us);
    expect(commentHtml('  a < b & "c"\nlínea 2 ')).toBe('a &lt; b &amp; &quot;c&quot;<br />línea 2');
    const post = await rally.comment(marta, { kind: 'US', objectId: '111', text: 'Hola\nqué tal' });
    expect(posts).toEqual([{ path: '/conversationpost/create', body: { ConversationPost: { Artifact: '/hierarchicalrequirement/111', Text: 'Hola<br />qué tal' } } }]);
    expect(post).toMatchObject({ author: 'Marta', text: 'Hola\nqué tal' });
    await expect(rally.comment(marta, { kind: 'US', objectId: '111', text: '  ' })).rejects.toThrow(/Escribe/);
    await expect(rally.comment(marta, { kind: 'XX', objectId: '111', text: 'x' })).rejects.toThrow(/no válido/);
  });

  it('adjunta un archivo en dos pasos (contenido y adjunto)', async () => {
    const { rally, marta, posts } = await setup({ _ref: `${ws}/attachmentcontent/900` });
    const content = Buffer.from('hola').toString('base64');
    const file = await rally.attach(marta, { kind: 'DE', objectId: '5', name: 'C:\\captura.png', contentType: 'image/png', content });
    expect(posts).toEqual([
      { path: '/attachmentcontent/create', body: { AttachmentContent: { Content: content } } },
      { path: '/attachment/create', body: { Attachment: { Artifact: '/defect/5', Content: '/attachmentcontent/900', ContentType: 'image/png', Name: 'captura.png', Size: 4 } } },
    ]);
    expect(file).toEqual({ name: 'captura.png', size: 4 });
    await expect(rally.attach(marta, { kind: 'DE', objectId: '5', name: 'x', content: '!!' })).rejects.toThrow(/no válido/);
  });

  it('rechaza lo que no se puede mover y explica una clave de solo lectura', async () => {
    const { rally, marta } = await setup(us, { readOnly: true });
    await expect(rally.move(marta, { id: 'TC9', category: 'done' })).rejects.toThrow(/test cases/);
    await expect(rally.move(marta, { id: 'US1', category: 'otra' })).rejects.toThrow(/no válido/);
    await expect(rally.move(marta, { id: 'US1', category: 'done' })).rejects.toThrow(/Full Access/);
  });
});

describe('Rally: gestor', () => {
  it('mueve las tareas enlazadas a la categoría que tienen en Rally', () => {
    const T = DEFAULT_ITEM_TYPES;
    const us = makeTask({ id: 'a', external_id: 'US1', type_id: 'us', state_id: 'us-dev' });
    const igual = makeTask({ id: 'b', external_id: 'US-2', type_id: 'us', state_id: 'us-dev' });
    const tema = makeTask({ id: 'c', external_id: 'DE3', type_id: 'topic', state_id: 'topic-pending' });
    const archivada = makeTask({ id: 'd', external_id: 'US4', status: 'archived' });
    const sinRally = makeTask({ id: 'e', external_id: null });
    const items = [
      item({ id: 'US1', category: 'accepted' }), item({ id: 'US2', category: 'doing' }),
      item({ id: 'DE3', kind: 'DE', category: 'accepted' }), item({ id: 'US4', category: 'accepted' }),
    ];
    const moves = rallyMoves([us, igual, tema, archivada, sinRally], items, T);
    // "Para hablar" no tiene Accepted: va a su estado de hecho.
    expect(moves.map((m) => `${m.task.id}→${m.stateId}`)).toEqual(['a→us-accepted', 'c→topic-done']);
    // Reabierta en Rally: vuelve al primer estado de esa categoría.
    expect(rallyMoves([makeTask({ external_id: 'US1', type_id: 'us', state_id: 'us-accepted', status: 'done' })], [item({ id: 'US1', category: 'todo' })], T)
      .map((m) => m.stateId)).toEqual(['us-backlog']);
    // Sin la categoría en su tipo (Para hablar no tiene "Bloqueado"), no se mueve.
    expect(rallyMoves([tema], [item({ id: 'DE3', kind: 'DE', category: 'blocked' })], T)).toEqual([]);
  });

  it('manda a Rally los cambios de categoría hechos en el gestor, también al deshacer', () => {
    const T = DEFAULT_ITEM_TYPES;
    const before = makeTask({ id: 'a', external_id: 'US-1', type_id: 'us', state_id: 'us-dev' });
    const after = { ...before, state_id: 'us-accepted', status: 'done' as const };
    const mismaCategoria = makeTask({ id: 'b', external_id: 'US2', type_id: 'us', state_id: 'us-dev' });
    const changes = [
      { table: 'tasks', before, after },
      { table: 'activity', before: undefined, after: { id: 'x' } },
      { table: 'tasks', before: mismaCategoria, after: { ...mismaCategoria, state_id: 'us-qa' } }, // En curso → En curso
      { table: 'tasks', before: undefined, after: makeTask({ external_id: 'US3', type_id: 'us', state_id: 'us-dev' }) }, // alta
      { table: 'tasks', before: makeTask({ external_id: 'TC4', state_id: 'task-todo' }), after: makeTask({ external_id: 'TC4', state_id: 'task-doing' }) },
      { table: 'tasks', before: makeTask({ external_id: 'JIRA-5', state_id: 'task-todo' }), after: makeTask({ external_id: 'JIRA-5', state_id: 'task-doing' }) },
    ];
    expect(rallyPushes(changes, false, T)).toEqual([{ id: 'US1', category: 'accepted' }]);
    expect(rallyPushes(changes, true, T)).toEqual([{ id: 'US1', category: 'doing' }]);
    // Completar y pasar a Accepted en la misma entrada: se manda Accepted; al deshacer, vuelve a En curso.
    const prod = { ...before, state_id: 'us-prod', status: 'done' as const };
    const twoSteps = [{ table: 'tasks', before, after: prod }, { table: 'tasks', before: prod, after }];
    expect(rallyPushes(twoSteps, false, T)).toEqual([{ id: 'US1', category: 'accepted' }]);
    expect(rallyPushes(twoSteps, true, T)).toEqual([{ id: 'US1', category: 'doing' }]);
  });

  it('reconoce los IDs de Rally (para mostrar su ficha en el panel de la tarea)', () => {
    for (const id of ['US1764574', 'us-12', 'DE9', 'TS215889', 'TA1', 'TC7']) expect(isRallyId(id)).toBe(true);
    for (const id of [null, undefined, '', 'JIRA-5', 'US', 'F789', 'US1 extra']) expect(isRallyId(id)).toBe(false);
  });

  it('solo pide a Rally los IDs de las tareas activas, sin repetir', () => {
    expect(rallyIdsOf([
      makeTask({ external_id: 'US-1' }), makeTask({ external_id: 'us1' }), makeTask({ external_id: 'TS22' }),
      makeTask({ external_id: 'JIRA-5' }), makeTask({ external_id: 'DE9', status: 'archived' }), makeTask({ external_id: 'TC7', deleted_at: '2026-10-01T00:00:00Z' }),
    ])).toEqual(['US1', 'TS22']);
  });

  it('reconoce las tareas ya traídas aunque el ID lleve guion', () => {
    const byId = tasksByRallyId([makeTask({ external_id: 'US-1' }), makeTask({ external_id: null })]);
    expect(linkedTask(item(), byId)?.external_id).toBe('US-1');
    expect(linkedTask(item({ id: 'US2' }), byId)).toBeUndefined();
  });

  it('crea la tarea con el tipo por prefijo, el ID, el enlace y el proyecto elegido', () => {
    const us = DEFAULT_ITEM_TYPES.find((t) => t.short === 'US')!;
    const t = taskFromRally(item({ project: 'Caixa', iteration: 'Sprint 14' }), DEFAULT_ITEM_TYPES, 'p1');
    expect(t).toMatchObject({ title: 'Uno', external_id: 'US1', url: `${BASE}/#/detail/userstory/1`, type_id: us.id, project_id: 'p1' });
    expect(t.notes).toBe('Proyecto en Rally: Caixa\nIteración: Sprint 14');
    expect(taskFromRally(item({ kind: 'DE' }), DEFAULT_ITEM_TYPES, null).type_id).toBe('task');
  });

  it('agrupa por categoría (siempre las cinco), por columna (en el orden del tablero), por iteración (la más reciente primero) o por persona', () => {
    const list = [
      item({ state: 'Need Review', stateOrder: 6, iteration: null, assignee: 'Marc' }),
      item({ state: 'New', stateOrder: 1, iteration: 'Sprint 9', assignee: null }),
      item({ state: 'Defined', stateOrder: 2, iteration: 'Sprint 14', assignee: 'Ana' }),
    ];
    expect(groupRally(list, 'state').map((g) => g.key)).toEqual(['New', 'Defined', 'Need Review']);
    const byCategory = groupRally([item({ category: 'accepted' }), item({ category: 'blocked' }), item({ category: 'accepted' })], 'category');
    expect(byCategory.map((g) => `${g.key} ${g.items.length}`)).toEqual(['Por hacer 0', 'Bloqueado 1', 'En curso 0', 'Hecho 0', 'Accepted 2']);
    expect(groupRally(list, 'iteration').map((g) => g.key)).toEqual(['Sprint 14', 'Sprint 9', null]);
    expect(groupRally(list, 'assignee').map((g) => g.key)).toEqual(['Ana', 'Marc', null]);
  });

  it('apunta el Assignee en la tarea solo si no es de la persona conectada', () => {
    expect(taskFromRally(item({ mine: false, assignee: 'Ana' }), DEFAULT_ITEM_TYPES, null).notes).toBe('Assignee en Rally: Ana');
    expect(taskFromRally(item({ assignee: 'Marc' }), DEFAULT_ITEM_TYPES, null).notes).toBe('');
  });
});
