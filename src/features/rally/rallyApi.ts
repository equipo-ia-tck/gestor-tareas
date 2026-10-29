import type { RallyCategory, RallyDetail, RallyItem, RallyProject, RallyStatus } from '../../domain/rally';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (json === null) throw new Error('El servidor del equipo no responde.');
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}

/** Conector de Rally del servidor (`servidor/rally.ts`): la clave nunca llega al navegador. */
export const rallyApi = {
  status: () => call<RallyStatus>('GET', '/api/rally'),
  connect: (apiKey: string, baseUrl: string) => call<RallyStatus>('POST', '/api/rally/connect', { apiKey, baseUrl }),
  disconnect: () => call<RallyStatus>('POST', '/api/rally/disconnect', {}),
  move: (id: string, category: RallyCategory) => call<{ item: RallyItem }>('POST', '/api/rally/move', { id, category }).then((r) => r.item),
  lookup: (ids: string[]) => call<{ items: RallyItem[] }>('POST', '/api/rally/lookup', { ids }).then((r) => r.items),
  detail: (item: RallyItem) => call<RallyDetail>('GET', `/api/rally/detail?kind=${item.kind}&id=${item.objectId}`),
  comment: (item: RallyItem, text: string) =>
    call<{ post: RallyDetail['discussion'][number] }>('POST', '/api/rally/comment', { kind: item.kind, objectId: item.objectId, text }).then((r) => r.post),
  attach: (item: RallyItem, file: { name: string; contentType: string; content: string }) =>
    call<{ file: RallyDetail['attachments'][number] }>('POST', '/api/rally/attach', { kind: item.kind, objectId: item.objectId, ...file }).then((r) => r.file),
  projects: () => call<{ projects: RallyProject[] }>('GET', '/api/rally/projects').then((r) => r.projects),
  items: (days: number, projects: string[]) =>
    call<{ items: RallyItem[] }>('GET', `/api/rally/items?days=${days}&projects=${projects.join(',')}`).then((r) => r.items),
};
