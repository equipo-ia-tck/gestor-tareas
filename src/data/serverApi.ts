import { sync } from './sync';

/**
 * Llamada al servidor del equipo (servidor/), que hoy solo hace de puente con los conectores: Rally, Confluence,
 * calendario, chats y Microsoft List. Va con la sesión de Supabase (Bearer), y el servidor la comprueba con Supabase.
 */
export async function serverCall<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = (await sync().supabase.auth.getSession()).data.session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || method === 'POST') headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  });
  const json = await res.json().catch(() => null);
  if (json === null) throw new Error('El servidor del equipo no responde. ¿Está en marcha (npm start)?');
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}
