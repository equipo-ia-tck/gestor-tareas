import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './api.ts';

/**
 * Quién hace cada petición. Las cuentas viven en Supabase: la app manda su sesión (`Authorization: Bearer …`) y el
 * servidor se la enseña a Supabase (función `me()`), que responde con la cuenta si la sesión es válida y la cuenta está
 * activa. Se recuerda un minuto para no preguntar en cada petición. El servidor no guarda contraseñas ni sesiones.
 */

export interface TeamUser { id: string; login: string; name: string }

const CACHE_MS = 60_000;

/** Lee VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY del entorno o del archivo .env del proyecto. */
export function supabaseConfig(root: string): { url: string; key: string } {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* sin .env: se usan las variables de entorno */ }
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Falta la configuración de Supabase (.env: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY).');
  return { url: url.replace(/\/$/, ''), key };
}

type Fetch = typeof fetch;

export class SupabaseAuth {
  private url: string;
  private key: string;
  private fetch: Fetch;
  private cache = new Map<string, { user: TeamUser | null; until: number }>();

  constructor(config: { url: string; key: string }, fetchImpl: Fetch = fetch) {
    this.url = config.url;
    this.key = config.key;
    this.fetch = fetchImpl;
  }

  /** Cuenta de la sesión, o null si no hay sesión, ha caducado o la cuenta está desactivada o sin dar de alta. */
  async userFor(token: string | undefined): Promise<TeamUser | null> {
    if (!token) return null;
    const hit = this.cache.get(token);
    if (hit && hit.until > Date.now()) return hit.user;
    let res: Response;
    try {
      res = await this.fetch(`${this.url}/rest/v1/rpc/me`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      throw new ApiError(503, `No se puede conectar con Supabase (${new URL(this.url).host}). Revisa la conexión o que el proyecto no esté en pausa.`);
    }
    let user: TeamUser | null = null;
    if (res.ok) {
      const me = (await res.json().catch(() => null)) as { user?: TeamUser; disabled?: boolean } | null;
      if (me?.user && !me.disabled) user = { id: me.user.id, login: me.user.login, name: me.user.name };
    } else if (res.status >= 500) {
      throw new ApiError(503, `Supabase no responde (${res.status}).`);
    }
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(token, { user, until: Date.now() + CACHE_MS });
    return user;
  }
}

export const bearerOf = (header: string | undefined) => /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
