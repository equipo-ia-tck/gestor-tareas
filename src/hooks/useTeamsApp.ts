import { teamsAppUrl } from '../domain/teams';
import { usePersistentState } from './usePersistentState';

/** Abrir los enlaces de Teams en la app (sin pestaña en el navegador). De este dispositivo; activado por defecto. */
export function useTeamsApp() {
  return usePersistentState('teams-app', true);
}

/** Atributos de un enlace de Teams: en la app, sin pestaña nueva; si no, en una pestaña del navegador. */
export function teamsLinkProps(url: string, app: boolean) {
  return app ? { href: teamsAppUrl(url) } : { href: url, target: '_blank', rel: 'noopener noreferrer' };
}

/** Abre un enlace de Teams desde código (sin pestaña en blanco si va a la app). */
export function openTeams(url: string, app: boolean) {
  if (app) window.location.href = teamsAppUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
