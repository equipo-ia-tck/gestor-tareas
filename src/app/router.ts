import { useEffect, useState } from 'react';

export type Route =
  | { view: 'today' }
  | { view: 'week' }
  | { view: 'board' }
  | { view: 'releases' }
  | { view: 'log' }
  | { view: 'notes'; id?: string }
  | { view: 'calendar' }
  | { view: 'inbox' }
  | { view: 'projects' }
  | { view: 'project'; id: string }
  | { view: 'people' }
  | { view: 'person'; name: string }
  | { view: 'settings' }
  | { view: 'search'; q: string };

/** Enrutado por hash: funciona en local, en GitHub Pages y offline sin configuración. */
export function parseHash(hash: string): Route {
  const [view, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const arg = rest.join('/');
  switch (view) {
    case 'week': return { view: 'week' };
    case 'board': return { view: 'board' };
    case 'releases': return { view: 'releases' };
    case 'log': return { view: 'log' };
    case 'notes': return arg ? { view: 'notes', id: decodeURIComponent(arg) } : { view: 'notes' };
    case 'calendar': return { view: 'calendar' };
    case 'inbox': return { view: 'inbox' };
    case 'projects': return { view: 'projects' };
    case 'project': return arg ? { view: 'project', id: decodeURIComponent(arg) } : { view: 'projects' };
    case 'people': return { view: 'people' };
    case 'person': return arg ? { view: 'person', name: decodeURIComponent(arg) } : { view: 'people' };
    case 'settings': return { view: 'settings' };
    case 'search': return { view: 'search', q: decodeURIComponent(arg ?? '') };
    default: return { view: 'today' };
  }
}

export function routeHref(r: Route): string {
  switch (r.view) {
    case 'project': return `#/project/${encodeURIComponent(r.id)}`;
    case 'person': return `#/person/${encodeURIComponent(r.name)}`;
    case 'search': return `#/search/${encodeURIComponent(r.q)}`;
    case 'notes': return r.id ? `#/notes/${encodeURIComponent(r.id)}` : '#/notes';
    default: return `#/${r.view}`;
  }
}

export const navigate = (r: Route) => { window.location.hash = routeHref(r); };

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
