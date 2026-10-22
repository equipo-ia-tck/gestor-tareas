import { nameKey } from './text';

/** Cuenta del servidor del equipo. */
export interface TeamMember { id: string; login: string; name: string }

/**
 * Igual que en el servidor (servidor/visibility.ts): una persona mencionada es una cuenta solo si coincide
 * su nombre completo o su usuario (email). El nombre de pila no basta, para no compartir con quien no es.
 */
export function isMember(person: string, u: TeamMember): boolean {
  const k = nameKey(person);
  return k === nameKey(u.name) || k === nameKey(u.login);
}

/**
 * Con quién se comparte algo: el dueño (si no soy yo) y las cuentas mencionadas (menos yo y el dueño).
 * Sin dueño conocido, el dueño soy yo (lo acabo de crear).
 */
export function shareInfo(people: string[], ownerId: string | undefined, me: TeamMember | null, team: TeamMember[]) {
  const owner = ownerId && ownerId !== me?.id ? team.find((u) => u.id === ownerId) ?? null : null;
  const ownerKey = ownerId ?? me?.id;
  const others = team.filter((u) => u.id !== me?.id && u.id !== ownerKey && people.some((p) => isMember(p, u)));
  return { owner, with: others };
}
