import type { DatabaseSync } from 'node:sqlite';
import type { TeamUser } from './auth.ts';

/**
 * ¿`ownerId` es esta misma persona? Sí si es su id o si es su cuenta de antes de Supabase (la tabla `users` antigua de este
 * servidor, con el mismo email). Así, tras pasar a Supabase, cada uno puede volver a vincular su calendario, chats o lista
 * de OneDrive, que seguían a nombre del id anterior.
 */
export function isSamePerson(db: DatabaseSync, ownerId: string, user: TeamUser): boolean {
  if (ownerId === user.id) return true;
  try {
    const row = db.prepare('SELECT login FROM users WHERE id = ?').get(ownerId) as { login?: string } | undefined;
    return !!row?.login && row.login.trim().toLowerCase() === user.login.trim().toLowerCase();
  } catch {
    // Sin la tabla antigua no hay cuenta de antes que reconocer.
    return false;
  }
}
