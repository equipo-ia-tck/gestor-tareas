/** Notificaciones del sistema (solo mientras la app está abierta: no hay servidor de push). */

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  notificationsSupported() ? Notification.permission : 'unsupported';

/** Pide permiso si aún no se ha decidido. Debe llamarse desde un clic. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  return Notification.permission === 'granted';
}

export function showNotification(title: string, body: string, onClick: () => void) {
  if (notificationPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: './pwa-192.png', tag: `${title}-${body}` });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch {
    /* algunos navegadores solo permiten notificaciones desde el service worker */
  }
}
