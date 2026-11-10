import type { ConfluenceStatus, ConfluenceTask } from '../../domain/confluence';

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

/** Conector de Confluence del servidor (`servidor/confluence.ts`): el token nunca llega al navegador. */
export const confluenceApi = {
  status: () => call<ConfluenceStatus>('GET', '/api/confluence'),
  connect: (token: string, baseUrl: string) => call<ConfluenceStatus>('POST', '/api/confluence/connect', { token, baseUrl }),
  disconnect: () => call<ConfluenceStatus>('POST', '/api/confluence/disconnect', {}),
  tasks: (done: boolean) => call<{ tasks: ConfluenceTask[] }>('GET', `/api/confluence/tasks?done=${done ? '1' : '0'}`).then((r) => r.tasks),
};
