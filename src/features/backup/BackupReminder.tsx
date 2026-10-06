import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { routeHref } from '../../app/router';
import { downloadBackup, needsBackupReminder } from '../../data/backup';
import { autosave, repo } from '../../data/services';
import { useAutosaveState } from './SettingsView';

/** Aviso discreto: copia con más de 7 días, o copia automática pendiente de permiso. */
export function BackupReminder() {
  const { settings, tasks } = useApp();
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

  if (!needsBackupReminder(settings.last_backup_at, tasks.length > 0)) return null;
  const days = settings.last_backup_at
    ? Math.floor((Date.now() - Date.parse(settings.last_backup_at)) / 86_400_000)
    : null;

  return (
    <div className={bar}>
      <span className="flex-1">
        {days === null ? 'Aún no has hecho ninguna copia de seguridad.' : `Hace ${days} días de tu última copia de seguridad.`}
      </span>
      <button className={link} onClick={() => void downloadBackup(repo)}>Exportar ahora</button>
      <a className={link} href={routeHref({ view: 'settings' })}>Opciones</a>
      <button className="opacity-60 hover:opacity-100" onClick={() => setHidden(true)} aria-label="Ocultar">×</button>
    </div>
  );
}
