import { useState } from 'react';
import { autosave } from '../../data/services';
import { useAutosaveState } from './SettingsView';

/** Aviso de copia automática en archivo pendiente de permiso (solo si se vinculó un archivo en Ajustes). */
export function BackupReminder() {
  const fs = useAutosaveState();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const bar = 'mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200';
  const link = 'font-medium underline-offset-2 hover:underline';

  if (fs.status === 'needs-permission') {
    return (
      <div className={bar}>
        <span className="flex-1">La copia automática en <strong>{fs.fileName}</strong> está en pausa.</span>
        <button className={link} onClick={() => void autosave.reactivate()}>Reactivar copia automática</button>
        <button className="opacity-60 hover:opacity-100" onClick={() => setHidden(true)} aria-label="Ocultar">×</button>
      </div>
    );
  }

  // Ya no se recuerda exportar: los datos se guardan en Supabase. Exportar sigue en Ajustes.
  return null;
}
