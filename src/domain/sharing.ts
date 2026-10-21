import { nameKey } from './text';

/** Compañero del equipo (cuenta en el servidor). */
export interface TeamMember { id: string; login: string; name: string }

/** Igual que en el servidor (servidor/visibility.ts): nombre completo, nombre de pila o usuario. */
export function isMember(person: string, u: TeamMember): boolean {
  const k = nameKey(person);
  return k === nameKey(u.name) || k === nameKey(u.name.split(/\s+/)[0] ?? '') || k === nameKey(u.login);
}

/**
 * Con quién se comparte algo: el dueño (si no soy yo) y los compañeros mencionados (menos yo y el dueño).
 * Sin dueño conocido, el dueño soy yo (lo acabo de crear).
 */
export function shareInfo(people: string[], ownerId: string | undefined, me: TeamMember | null, team: TeamMember[]) {
  const owner = ownerId && ownerId !== me?.id ? team.find((u) => u.id === ownerId) ?? null : null;
  const ownerKey = ownerId ?? me?.id;
  const others = team.filter((u) => u.id !== me?.id && u.id !== ownerKey && people.some((p) => isMember(p, u)));
  return { owner, with: others };
}
