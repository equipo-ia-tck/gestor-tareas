import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Api } from './fakeAccounts.ts';
import { Confluence, normalizeConfluenceUrl, toConfluenceTask, toIsoDate } from '../servidor/confluence.ts';
import { linkedConfluenceTask, taskFromConfluence, type ConfluenceTask } from '../src/domain/confluence';
import { makeTask } from './factories';

const BASE = 'https://confluence.cloud.lacaixa.es/confluence';

function setup(handler: (u: URL, init: RequestInit) => Response | Promise<Response>) {
  const db = new DatabaseSync(':memory:');
  const api = new Api(db);
  const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
  const calls: { url: URL; auth: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, auth: (init.headers as Record<string, string>).Authorization });
    return handler(u, init);
  }) as unknown as typeof fetch;
  return { confluence: new Confluence(db, fetcher), marta, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Confluence: servidor', () => {
  it('normaliza la dirección (quita la parte de la interfaz) y exige https', () => {
    expect(normalizeConfluenceUrl('https://confluence.cloud.lacaixa.es/confluence/#all-updates')).toBe(BASE);
    expect(normalizeConfluenceUrl('confluence.cloud.lacaixa.es/confluence/display/EQ/Inicio')).toBe(BASE);
    expect(normalizeConfluenceUrl('')).toBe(BASE);
    expect(() => normalizeConfluenceUrl('http://confluence.local')).toThrow(/https/);
  });

  it('convierte las tareas de la API (texto sin HTML, fecha local, página)', () => {
    expect(toIsoDate(Date.UTC(2026, 10, 20, 10))).toBe('2026-11-20');
    expect(toIsoDate(null)).toBeNull();
    expect(toConfluenceTask({ globalId: 77, contentId: 123, status: 'incomplete', body: '<span>Revisar <b>login</b> con <ac:link>@Ana</ac:link></span>', dueDate: Date.UTC(2026, 10, 20, 10) }))
      .toMatchObject({ id: '77', text: 'Revisar login con @Ana', done: false, dueDate: '2026-11-20', pageId: '123' });
    expect(toConfluenceTask({ id: 5, status: 'complete' })).toMatchObject({ id: '5', done: true, text: '(tarea sin texto)' });
    expect(toConfluenceTask({})).toBeNull();
  });

  it('conecta con el token (Bearer), lo guarda sin devolverlo y rechaza un token que deja anónimo', async () => {
    const { confluence, marta, calls } = setup((u) => (u.pathname.endsWith('/rest/api/user/current')
      ? json({ type: 'known', userKey: 'k-marta', username: 'U0123', displayName: 'Marta García' }) : json({})));
    const status = await confluence.connect(marta, { token: '  secreto-1234 ', baseUrl: `${BASE}/#all-updates` });
    expect(status).toEqual({ connected: true, baseUrl: BASE, tokenHint: '1234', user: 'Marta García' });
    expect(calls[0].auth).toBe('Bearer secreto-1234');
    expect(JSON.stringify(status)).not.toContain('secreto');

    const anon = setup(() => json({ type: 'anonymous' }));
    await expect(anon.confluence.connect(anon.marta, { token: 'malo' })).rejects.toThrow(/anónimo/);
    const denied = setup(() => json({}, 401));
    await expect(denied.confluence.connect(denied.marta, { token: 'malo' })).rejects.toThrow(/no acepta el token/);
  });

  it('explica que sin la red del cliente no se llega a Confluence', async () => {
    const { confluence, marta } = setup(() => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND'); });
    await expect(confluence.connect(marta, { token: 'x' })).rejects.toThrow(/confluence\.cloud\.lacaixa\.es.*VPN o desde su escritorio virtual/);
  });

  it('trae las tareas asignadas con su página y las ordena por fecha', async () => {
    const { confluence, marta, calls } = setup((u) => {
      if (u.pathname.endsWith('/rest/api/user/current')) return json({ userKey: 'k-marta', displayName: 'Marta' });
      if (u.pathname.endsWith('/rest/api/inlinetasks/search')) {
        return json({ results: [
          { globalId: 1, contentId: 10, status: 'incomplete', body: 'Sin fecha', createDate: 1 },
          { globalId: 2, contentId: 11, status: 'incomplete', body: 'Urgente', dueDate: Date.UTC(2026, 10, 12, 10) },
          { globalId: 3, contentId: 10, status: 'incomplete', body: 'Más tarde', dueDate: Date.UTC(2026, 11, 1, 10) },
        ] });
      }
      if (u.pathname.endsWith('/rest/api/content/search')) {
        return json({ results: [
          { id: '10', title: 'Acta 10/11', space: { key: 'EQ', name: 'Equipo Digital' }, _links: { webui: '/display/EQ/Acta' } },
          { id: '11', title: 'Plan Bizum', space: { key: 'BZ', name: 'Bizum' }, _links: { webui: '/pages/viewpage.action?pageId=11' } },
        ] });
      }
      return json({}, 404);
    });
    await confluence.connect(marta, { token: 't' });
    calls.length = 0;
    const tasks = await confluence.tasks(marta);
    expect(tasks.map((t) => t.text)).toEqual(['Urgente', 'Más tarde', 'Sin fecha']);
    expect(tasks[0]).toMatchObject({ pageTitle: 'Plan Bizum', space: 'Bizum', url: `${BASE}/pages/viewpage.action?pageId=11` });
    expect(tasks[1]).toMatchObject({ pageTitle: 'Acta 10/11', space: 'Equipo Digital', url: `${BASE}/display/EQ/Acta` });
    const search = calls.find((c) => c.url.pathname.endsWith('/inlinetasks/search'))!;
    expect(Object.fromEntries(search.url.searchParams)).toMatchObject({ assignee: 'k-marta', status: 'incomplete', limit: '100' });
    expect(calls.find((c) => c.url.pathname.endsWith('/content/search'))!.url.searchParams.get('cql')).toBe('id in (10,11)');
  });

  it('sin conectar, pide el token', async () => {
    const { confluence, marta } = setup(() => json({}));
    await expect(confluence.tasks(marta)).rejects.toThrow(/Conecta Confluence/);
  });
});

describe('Confluence: en el gestor', () => {
  const cf = (extra: Partial<ConfluenceTask> = {}): ConfluenceTask => ({
    id: '77', text: 'Revisar login\ncon el equipo de QA', done: false, dueDate: '2026-11-20', createdAt: null,
    pageId: '10', pageTitle: 'Acta 10/11', space: 'Equipo Digital', url: `${BASE}/display/EQ/Acta`, ...extra,
  });

  it('crea la tarea con la primera línea, la fecha, el enlace y de qué página sale', () => {
    expect(taskFromConfluence(cf(), 'p1')).toMatchObject({
      title: 'Revisar login', external_id: 'CF-77', url: `${BASE}/display/EQ/Acta`, due_date: '2026-11-20', project_id: 'p1',
      notes: 'De Confluence: Acta 10/11 (Equipo Digital)\n\nRevisar login\ncon el equipo de QA',
    });
    expect(taskFromConfluence(cf({ text: 'Una sola línea' }), null).notes).toBe('De Confluence: Acta 10/11 (Equipo Digital)');
  });

  it('reconoce la tarea ya añadida por su ID externo', () => {
    const tasks = [makeTask({ external_id: 'CF-77' }), makeTask({ external_id: 'CF-1', deleted_at: '2026-11-01T00:00:00Z' })];
    expect(linkedConfluenceTask(cf(), tasks)?.external_id).toBe('CF-77');
    expect(linkedConfluenceTask(cf({ id: '1' }), tasks)).toBeUndefined();
  });
});
