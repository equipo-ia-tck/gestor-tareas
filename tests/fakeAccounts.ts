import { randomUUID } from 'node:crypto';
import type { TeamUser } from '../servidor/auth.ts';

/**
 * Cuentas de prueba para los tests de los conectores. Las cuentas de verdad viven en Supabase; a los conectores solo
 * les hace falta la cuenta de la sesión (id, email y nombre).
 */
export class Api {
  teamCode = '';
  constructor(_db?: unknown) {}
  register(input: { login: string; name: string; password?: string; code?: string }): { user: TeamUser } {
    return { user: { id: randomUUID(), login: input.login, name: input.name } };
  }
}
