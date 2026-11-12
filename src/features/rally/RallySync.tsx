import { useEffect } from 'react';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { rallyApi } from './rallyApi';
import { applyRallyStates, pushToRally } from './rallyStates';

const EVERY_MS = 5 * 60_000;

/**
 * Sin interfaz, solo si la cuenta tiene Rally conectado. En los dos sentidos: cada 5 minutos (y al volver a la ventana)
 * mueve las tareas enlazadas a la categoría que tienen en Rally, y cuando se mueve una aquí (o se deshace) la mueve en
 * Rally. Los errores al leer se ignoran en silencio (la pantalla Rally ya los muestra); los de escribir se avisan.
 */
export function RallySync() {
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => { void applyRallyStates().catch(() => {}); };
    const onFocus = () => { if (document.visibilityState === 'visible') run(); };
    // Escucha siempre (aunque Rally se conecte después de abrir la app): sin conexión, el servidor responde
    // "Conecta Rally" y no se avisa de nada.
    const stopHistory = repo.onHistory((e) => { void pushToRally(e, (message) => toast(message)); });
    rallyApi.status().then((s) => {
      if (!alive || !s.connected) return;
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
