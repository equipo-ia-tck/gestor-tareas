import type { MsListConfig } from '../../domain/msList';
import type { MsListChange, MsListItem } from '../../domain/msListParse';

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

export interface ListaStatus { linked: boolean; found: boolean }
export interface ListaData { items: MsListItem[]; updatedAt: string; pending: MsListChange[] }

/** Microsoft List por OneDrive (`servidor/msList.ts`). */
export const listaApi = {
  status: () => call<ListaStatus>('GET', '/api/lista'),
  link: () => call<ListaStatus>('POST', '/api/lista/link', {}),
  unlink: () => call<ListaStatus>('POST', '/api/lista/unlink', {}),
  items: () => call<ListaData>('GET', '/api/lista/items'),
  change: (id: string, campo: string, valor: string) => call<{ pending: MsListChange[] }>('POST', '/api/lista/change', { id, campo, valor }),
};

const CONFIG_KEY = 'gestor-tareas:lista-config';
const EMPTY: MsListConfig = { statusColumn: null, map: {} };

/** Columna de estado y correspondencia de valores, guardadas en este navegador (se leen también fuera de React). */
export function loadListaConfig(): MsListConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<MsListConfig> : {};
    return { statusColumn: parsed.statusColumn ?? null, map: parsed.map ?? {} };
  } catch {
    return EMPTY;
  }
}

export function saveListaConfig(config: MsListConfig) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* sin almacenamiento */ }
}
