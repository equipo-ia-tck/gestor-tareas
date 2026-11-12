import type { ConfluenceStatus, ConfluenceTask } from '../../domain/confluence';
import { serverCall as call } from '../../data/serverApi';


/** Conector de Confluence del servidor (`servidor/confluence.ts`): el token nunca llega al navegador. */
export const confluenceApi = {
  status: () => call<ConfluenceStatus>('GET', '/api/confluence'),
  connect: (token: string, baseUrl: string) => call<ConfluenceStatus>('POST', '/api/confluence/connect', { token, baseUrl }),
  disconnect: () => call<ConfluenceStatus>('POST', '/api/confluence/disconnect', {}),
  tasks: (done: boolean) => call<{ tasks: ConfluenceTask[] }>('GET', `/api/confluence/tasks?done=${done ? '1' : '0'}`).then((r) => r.tasks),
};
