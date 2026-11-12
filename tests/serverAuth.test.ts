import { describe, expect, it } from 'vitest';
import { bearerOf, SupabaseAuth } from '../servidor/auth.ts';

/** Supabase de mentira: responde a rpc/me según el token. */
function fakeSupabase() {
  const calls: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const token = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    calls.push(token);
    const body = token === 'buena' ? { user: { id: 'u1', login: 'marta@vml.com', name: 'Marta' }, disabled: false }
      : token === 'desactivada' ? { user: { id: 'u2', login: 'x@vml.com', name: 'X' }, disabled: true }
      : token === 'sin-alta' ? null : undefined;
    return new Response(body === undefined ? '{"message":"JWT expired"}' : JSON.stringify(body), { status: body === undefined ? 401 : 200 });
  }) as typeof fetch;
  return { calls, auth: new SupabaseAuth({ url: 'https://x.supabase.co', key: 'anon' }, fetchImpl) };
}

describe('sesión del servidor con Supabase', () => {
  it('reconoce la cuenta de una sesión válida y la recuerda un rato', async () => {
    const { auth, calls } = fakeSupabase();
    expect(await auth.userFor('buena')).toEqual({ id: 'u1', login: 'marta@vml.com', name: 'Marta' });
    await auth.userFor('buena');
    expect(calls).toEqual(['buena']);
  });

  it('rechaza sesiones caducadas, cuentas desactivadas o sin alta, y peticiones sin sesión', async () => {
    const { auth } = fakeSupabase();
    expect(await auth.userFor('caducada')).toBeNull();
    expect(await auth.userFor('desactivada')).toBeNull();
    expect(await auth.userFor('sin-alta')).toBeNull();
    expect(await auth.userFor(undefined)).toBeNull();
  });

  it('lee el token de la cabecera Authorization', () => {
    expect(bearerOf('Bearer abc.def')).toBe('abc.def');
    expect(bearerOf('bearer xyz')).toBe('xyz');
    expect(bearerOf(undefined)).toBeUndefined();
    expect(bearerOf('Basic abc')).toBeUndefined();
  });
});

describe('SupabaseAuth sin conexión', () => {
  it('explica que no llega a Supabase (503)', async () => {
    const auth = new SupabaseAuth({ url: 'https://x.supabase.co', key: 'k' }, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    await expect(auth.userFor('t')).rejects.toMatchObject({ status: 503 });
  });
});
