import { useState } from 'react';

/** Estado recordado en este navegador (preferencias de vista). Si localStorage falla, funciona en memoria. */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const storageKey = `gestor-tareas:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* sin almacenamiento: solo en memoria */ }
  };
  return [value, set];
}
