import type { RallyCategory, RallyCreatableKind, RallyCreateInput, RallyDetail, RallyFormOptions, RallyItem, RallyKind, RallyPick, RallyProject, RallyRef, RallyStatus } from '../../domain/rally';
import { serverCall as call } from '../../data/serverApi';


/** Conector de Rally del servidor (`servidor/rally.ts`): la clave nunca llega al navegador. */
export const rallyApi = {
  status: () => call<RallyStatus>('GET', '/api/rally'),
  connect: (apiKey: string, baseUrl: string) => call<RallyStatus>('POST', '/api/rally/connect', { apiKey, baseUrl }),
  disconnect: () => call<RallyStatus>('POST', '/api/rally/disconnect', {}),
  /** `blockedReason`: al bloquear, el motivo que se escribe en Rally (el texto del comentario). */
  move: (id: string, category: RallyCategory, dryRun = false, blockedReason?: string) =>
    call<{ item: RallyItem }>('POST', '/api/rally/move', { id, category, ...(dryRun ? { dryRun } : {}), ...(blockedReason ? { blockedReason } : {}) }).then((r) => r.item),
  lookup: (ids: string[]) => call<{ items: RallyItem[] }>('POST', '/api/rally/lookup', { ids }).then((r) => r.items),
  detail: (item: RallyItem) => call<RallyDetail>('GET', `/api/rally/detail?kind=${item.kind}&id=${item.objectId}`),
  create: (input: RallyCreateInput | { kind: 'TA'; name: string; parentId: string; assignToMe: boolean }) =>
    call<{ item: RallyItem }>('POST', '/api/rally/create', input).then((r) => r.item),
  searchUsers: (q: string) => call<{ users: RallyRef[] }>('GET', `/api/rally/users?q=${encodeURIComponent(q)}`).then((r) => r.users),
  pick: (filter: { types: string[]; q: string; project: string; release: string; page: number }) =>
    call<{ items: RallyPick[]; total: number }>('GET', `/api/rally/pick?${new URLSearchParams({ ...filter, types: filter.types.join(','), page: String(filter.page) })}`),
  tags: (q: string, page: number) => call<{ items: RallyRef[]; total: number }>('GET', `/api/rally/tags?q=${encodeURIComponent(q)}&page=${page}`),
  formOptions: (kind: RallyCreatableKind, projectId: string) =>
    call<RallyFormOptions>('GET', `/api/rally/form?kind=${kind}&project=${projectId}`),
  /** Botones Ready y Blocked (sin cambiar de columna). `reason`: motivo al bloquear (el texto del comentario). */
  flag: (id: string, change: { ready?: boolean; blocked?: boolean; reason?: string }) =>
    call<{ item: RallyItem }>('POST', '/api/rally/flag', { id, ...change }).then((r) => r.item),
  /** Comentario de un movimiento con el Owner (PO) y, si se elige, el analista. */
  moveComment: (id: string, text: string, analyst: RallyRef | null) =>
    call<{ text: string; owner: string | null; analyst: string | null }>('POST', '/api/rally/move-comment', { id, text, analyst }),
  comment: (item: RallyItem, text: string) =>
    call<{ post: RallyDetail['discussion'][number] }>('POST', '/api/rally/comment', { kind: item.kind, objectId: item.objectId, text }).then((r) => r.post),
  attach: (item: RallyItem, file: { name: string; contentType: string; content: string }) =>
    call<{ file: RallyDetail['attachments'][number] }>('POST', '/api/rally/attach', { kind: item.kind, objectId: item.objectId, ...file }).then((r) => r.file),
  projects: () => call<{ projects: RallyProject[] }>('GET', '/api/rally/projects').then((r) => r.projects),
  items: (days: number, projects: string[], tags: string[] = []) =>
    call<{ items: RallyItem[]; truncated: { kind: RallyKind; total: number; shown: number }[] }>('GET', `/api/rally/items?${new URLSearchParams([['days', String(days)], ['projects', projects.join(',')], ...tags.map((t) => ['tag', t])])}`)

};

/** Contenido de un archivo en base64 (sin la cabecera `data:…;base64,`). */
export const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
  reader.onerror = () => reject(new Error(`No se ha podido leer ${file.name}.`));
  reader.readAsDataURL(file);
});

/** Límite del servidor (`MAX_ATTACHMENT_BYTES` en servidor/rally.ts). */
export const MAX_UPLOAD = 25 * 1024 * 1024;
