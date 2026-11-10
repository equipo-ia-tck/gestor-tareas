import { useEffect } from 'react';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { listaApi } from './listaApi';
import { applyListStates, pushToList } from './listaStates';

const EVERY_MS = 2 * 60_000;

/**
 * Sin interfaz, solo si la cuenta tiene la lista vinculada. En los dos sentidos: cada 2 minutos (y al volver a la ventana)
 * mueve las tareas enlazadas a la categoría de su elemento, y cuando se mueve una aquí apunta el cambio para la lista.
 */
export function ListaSync() {
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => { void applyListStates().catch(() => {}); };
    const onFocus = () => { if (document.visibilityState === 'visible') run(); };
    const stopHistory = repo.onHistory((e) => { void pushToList(e, (message) => toast(message)); });
    listaApi.status().then((s) => {
      if (!alive || !s.linked) return;
      run();
      timer = setInterval(run, EVERY_MS);
      window.addEventListener('focus', onFocus);
    }, () => {});
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      stopHistory();
    };
  }, [toast]);
  return null;
}
