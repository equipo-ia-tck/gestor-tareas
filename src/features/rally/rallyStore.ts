import { useMemo, useSyncExternalStore } from 'react';
import { isRallyId, rallyOwners, type RallyItem } from '../../domain/rally';
import type { Task } from '../../domain/types';

/**
 * Último estado conocido en Rally de cada elemento (por ID, sin guion y en mayúsculas), solo en memoria. Lo llenan la
 * sincronización, la pantalla Rally y el panel de la tarea; lo leen las tarjetas del Tablero ("Owned By") y Personas.
 * Los Owners se recuerdan además en localStorage, para que Personas no espere a la primera consulta a Rally.
 */
const items = new Map<string, RallyItem>();
const listeners = new Set<() => void>();
let version = 0;

const OWNERS_KEY = 'rally-owners';
const owners = new Map<string, string>(readOwners());

function readOwners(): [string, string][] {
  try {
    const raw = JSON.parse(localStorage.getItem(OWNERS_KEY) ?? '{}') as Record<string, unknown>;
    return Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string');
  } catch {
    return [];
  }
}

const norm = (id: string) => id.replace(/-/g, '').toUpperCase();

export function rememberRally(list: RallyItem[]) {
  if (!list.length) return;
  let ownersChanged = false;
  for (const it of list) {
    const id = norm(it.id);
    items.set(id, it);
    if ((owners.get(id) ?? null) !== it.owner) {
      if (it.owner) owners.set(id, it.owner);
      else owners.delete(id);
      ownersChanged = true;
    }
  }
  if (ownersChanged) {
    try { localStorage.setItem(OWNERS_KEY, JSON.stringify(Object.fromEntries(owners))); } catch { /* sin almacenamiento: solo en memoria */ }
  }
  version++;
  for (const l of listeners) l();
}

/** Último estado conocido de un elemento (fuera de React). */
export function rallyItem(id: string): RallyItem | undefined {
  return items.get(norm(id));
}

const subscribe = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };

/** Elemento de Rally de una tarea enlazada (undefined si no tiene ID de Rally o aún no se ha consultado). */
export function useRallyItem(externalId: string | null): RallyItem | undefined {
  useSyncExternalStore(subscribe, () => version);
  return isRallyId(externalId) ? items.get(norm(externalId)) : undefined;
}

/** Owner en Rally de cada tarea enlazada (id de la tarea → nombre), para Personas. */
export function useRallyOwners(tasks: Task[]): Map<string, string> {
  const v = useSyncExternalStore(subscribe, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` cambia cuando llegan datos nuevos de Rally
  return useMemo(() => rallyOwners(tasks, (id) => owners.get(id)), [tasks, v]);
}

/** Para listas (Tablero «Como en Rally»): función que da el elemento de Rally de un ID; cambia cuando llegan datos. */
export function useRallyLookup(): (externalId: string | null) => RallyItem | undefined {
  const v = useSyncExternalStore(subscribe, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` cambia cuando llegan datos nuevos de Rally
  return useMemo(() => (externalId) => (isRallyId(externalId) ? items.get(norm(externalId)) : undefined), [v]);
}
