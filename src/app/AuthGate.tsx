import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { repo } from '../data/services';
import { sync } from '../data/sync';

type Phase = 'loading' | 'down' | 'login' | 'ask-upload' | 'ready';

/** Pide sesión antes de abrir la app y, la primera vez en este navegador, decide qué hacer con sus datos. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [counts, setCounts] = useState({ tasks: 0, notes: 0 });

  const enter = async () => {
    const step = await sync().prepare();
    if (step === 'ask-upload') {
      setCounts({ tasks: await repo.db.tasks.count(), notes: await repo.db.notes.count() });
      return setPhase('ask-upload');
    }
    await open();
  };
  const open = async () => {
    await sync().start();
    void repo.purgeDeleted(30);
    setPhase('ready');
  };
  const check = async () => {
    setPhase('loading');
    try {
      if (await sync().me()) await enter();
      else setPhase('login');
    } catch {
      setPhase('down');
    }
  };
  useEffect(() => { void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'ready') return <>{children}</>;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">✓</span>
          <span className="font-semibold">Tareas del equipo</span>
        </div>
        {phase === 'loading' && <p className="text-sm text-zinc-500">Conectando…</p>}
        {phase === 'down' && (
          <div className="space-y-3 text-sm">
            <p>No se puede conectar con el servidor del equipo.</p>
            <p className="text-zinc-500">Comprueba que está en marcha (<code>npm start</code> en la terminal) y vuelve a intentarlo.</p>
            <button type="button" onClick={() => void check()} className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-500">Reintentar</button>
          </div>
        )}
        {phase === 'login' && <LoginForm onDone={() => void enter()} />}
        {phase === 'ask-upload' && (
          <UploadQuestion counts={counts} onUpload={async () => { await sync().uploadAll(); await open(); }}
            onEmpty={async () => { await sync().startEmpty(); await open(); }} />
        )}
      </div>
    </div>
  );
}

const input = 'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950';

function LoginForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ login: '', password: '', name: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof form) => ({ id: `auth-${k}`, value: form[k], onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }) });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = mode === 'login' ? await sync().login(form.login, form.password) : await sync().register(form);
      if (user) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 text-sm">
      <div className="grid grid-cols-2 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {(['login', 'register'] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setError(null); }}
            className={`rounded px-2 py-1.5 ${mode === m ? 'bg-white font-medium shadow-sm dark:bg-zinc-950' : 'text-zinc-500'}`}>
            {m === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        ))}
      </div>
      {mode === 'register' && (
        <label className="block space-y-1" htmlFor="auth-name">
          <span className="text-zinc-600 dark:text-zinc-400">Tu nombre completo</span>
          <input {...field('name')} required autoComplete="name" placeholder="Marta García" className={input} />
          <span className="block text-xs text-zinc-500">Si alguien te pone en «Personas» de una tarea (o te menciona en una nota) con este nombre o tu email, te la comparte.</span>
        </label>
      )}
      <label className="block space-y-1" htmlFor="auth-login">
        <span className="text-zinc-600 dark:text-zinc-400">Usuario</span>
        <input {...field('login')} required autoComplete="username" autoCapitalize="none" placeholder="Tu email del trabajo" className={input} />
      </label>
      <label className="block space-y-1" htmlFor="auth-password">
        <span className="text-zinc-600 dark:text-zinc-400">Contraseña</span>
        <input {...field('password')} required type="password" minLength={mode === 'register' ? 8 : undefined}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} />
      </label>
      {mode === 'register' && (
        <label className="block space-y-1" htmlFor="auth-code">
          <span className="text-zinc-600 dark:text-zinc-400">Invitación</span>
          <input {...field('code')} required autoCapitalize="characters" placeholder="ABCD-1234" className={input} />
          <span className="block text-xs text-zinc-500">El código de invitación de tu espacio: te lo pasa alguien que ya está dentro (Ajustes → Espacios). Al crear la cuenta entras en ese espacio.</span>
        </label>
      )}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
        {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta y entrar'}
      </button>
    </form>
  );
}

function UploadQuestion({ counts, onUpload, onEmpty }: {
  counts: { tasks: number; notes: number }; onUpload: () => Promise<void>; onEmpty: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => { setBusy(true); void fn().finally(() => setBusy(false)); };
  return (
    <div className="space-y-3 text-sm">
      <p>
        En este navegador hay <strong>{counts.tasks} tareas</strong> y <strong>{counts.notes} notas</strong> de antes de tener cuenta.
      </p>
      <p className="text-zinc-500">Si las subes, pasan a ser tuyas y privadas. Solo verán algo tus compañeros si les mencionas.</p>
      <button type="button" disabled={busy} onClick={() => run(onUpload)} className="w-full rounded-md bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
        {busy ? 'Subiendo…' : 'Subirlas a mi cuenta'}
      </button>
      <button type="button" disabled={busy} onClick={() => run(onEmpty)} className="w-full rounded-md border border-zinc-300 py-2 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800">
        Empezar vacía
      </button>
      <p className="text-xs text-zinc-500">Si empiezas vacía, se guarda una copia de lo que había en el servidor (carpeta servidor/datos/copias).</p>
    </div>
  );
}
