import { useEffect } from 'react';
import { useToast } from '../../components/Toast';
import { repo } from '../../data/services';
import { isEditable } from '../command/CommandCenter';

/**
 * Conecta el historial del repositorio con la UI: aviso con "Deshacer" tras cada cambio
 * y Ctrl/Cmd+Z (deshacer), Ctrl/Cmd+Shift+Z o Ctrl+Y (rehacer) fuera de los campos de texto.
 */
export function HistoryBridge() {
  const toast = useToast();

  useEffect(() => repo.onHistory(({ type, entry }) => {
    if (type === 'push' && entry.silent) return;
    if (type === 'push') toast(entry.label, { label: 'Deshacer', run: () => void repo.undo() });
    else if (type === 'undo') toast(`Deshecho: ${entry.label}`, { label: 'Rehacer', run: () => void repo.redo() });
    else toast(`Rehecho: ${entry.label}`, { label: 'Deshacer', run: () => void repo.undo() });
  }), [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); void repo.undo(); }
      else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey)) { e.preventDefault(); void repo.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
