import { useState, type FormEvent } from 'react';
import { Copy, LogOut, RefreshCw, Shield, UserMinus } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { sync, useSync } from '../../data/sync';
import { PROJECT_COLORS } from '../../domain/types';
import type { Space } from '../../domain/spaces';

const button = 'inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';
const field = 'rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900';

/** Espacios de equipo: miembros, invitación, crear, unirse y salir. Y la cuenta (cerrar sesión). */
export function SpacesCard() {
  const { user, spaces, isAdmin, adminCode } = useSync();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer.');
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="mb-2 text-sm font-semibold">Espacios de equipo</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        Lo tuyo es privado. Un proyecto que pones en un espacio (desde la página del proyecto) lo ven y editan todos sus
        miembros, con sus subproyectos. Además, al poner a una cuenta en «Personas» de una tarea (o mencionarla con @ en una
        nota) se le comparte eso suelto. «Mi día», recordatorios, fichas y ajustes son siempre solo tuyos.
      </p>

      <div className="space-y-3">
        {spaces.map((s) => <SpaceItem key={s.id} space={s} run={run} />)}
        {!spaces.length && <p className="text-sm text-zinc-500">Aún no estás en ningún espacio.</p>}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CreateSpace run={run} />
        <JoinSpace run={run} />
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-700">
        <span className="text-zinc-500">Sesión de <strong className="text-zinc-800 dark:text-zinc-200">{user?.name}</strong> ({user?.login})</span>
        <button type="button" onClick={() => void sync().logout()} className={button}><LogOut className="size-3.5" />Cerrar sesión</button>
        {isAdmin && adminCode && (
          <span className="text-xs text-zinc-500">
            Administras el servidor. Código de administración: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{adminCode}</code> (no lo compartas)
          </span>
        )}
      </div>
    </section>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function SpaceItem({ space, run }: { space: Space; run: Run }) {
  const { user, team } = useSync();
  const toast = useToast();
  const admin = space.role === 'admin';
  const nameOf = (id: string) => team.find((u) => u.id === id)?.name ?? 'Cuenta borrada';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(space.inviteCode);
      toast('Código copiado');
    } catch {
      toast(`Código: ${space.inviteCode}`);
    }
  };
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-3 rounded-full" style={{ background: space.color }} />
        <strong className="text-sm">{space.name}</strong>
        <span className="text-xs text-zinc-500">{admin ? 'Administras' : 'Miembro'} · {space.members.length} {space.members.length === 1 ? 'persona' : 'personas'}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" onClick={() => void copy()} className={button} title="Pásalo a quien quieras invitar">
            <Copy className="size-3.5" />Invitación <code className="text-xs">{space.inviteCode}</code>
          </button>
          {admin && (
            <button type="button" title="El código anterior deja de valer" className={button}
              onClick={() => void run(() => sync().updateSpace(space.id, { newCode: true }), 'Código nuevo creado')}>
              <RefreshCw className="size-3.5" />Cambiar código
            </button>
          )}
          <button type="button" className={button} onClick={() => void run(() => sync().leaveSpace(space.id), `Has salido de ${space.name}`)}>
            Salir
          </button>
        </span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-sm">
        {space.members.map((m) => (
          <li key={m.id} className="flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 dark:bg-zinc-800">
            {nameOf(m.id)}{m.id === user?.id && ' (tú)'}
            {m.role === 'admin' && <Shield className="size-3 text-indigo-500" aria-label="Administra" />}
            {admin && m.id !== user?.id && (
              <>
                <button type="button" title={m.role === 'admin' ? 'Quitar como administradora' : 'Hacer administradora'} className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={() => void run(() => sync().setRole(space.id, m.id, m.role === 'admin' ? 'member' : 'admin'))}>
                  <Shield className="size-3" />
                </button>
                <button type="button" title="Quitar del espacio" className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={() => void run(() => sync().removeMember(space.id, m.id), `${nameOf(m.id)} ya no está en ${space.name}`)}>
                  <UserMinus className="size-3" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateSpace({ run }: { run: Run }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run(async () => { await sync().createSpace(name.trim(), color); setName(''); }, 'Espacio creado');
  };
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <label htmlFor="space-name" className="block text-xs text-zinc-500">Crear un espacio (p. ej. Excelencia, Pagos)</label>
      <div className="flex gap-1.5">
        <input id="space-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del espacio" className={`${field} min-w-0 flex-1`} />
        <select aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} className={field} style={{ color }}>
          {PROJECT_COLORS.map((c) => <option key={c} value={c} style={{ color: c }}>●</option>)}
        </select>
        <button type="submit" className={button}>Crear</button>
      </div>
    </form>
  );
}

function JoinSpace({ run }: { run: Run }) {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    void run(async () => { await sync().joinSpace(code.trim()); setCode(''); }, 'Te has unido al espacio');
  };
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <label htmlFor="space-code" className="block text-xs text-zinc-500">Unirme a un espacio con su invitación</label>
      <div className="flex gap-1.5">
        <input id="space-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-1234" className={`${field} min-w-0 flex-1 uppercase`} />
        <button type="submit" className={button}>Unirme</button>
      </div>
    </form>
  );
}
