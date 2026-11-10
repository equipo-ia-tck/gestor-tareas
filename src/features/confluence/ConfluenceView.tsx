import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Plus, RefreshCw, Search, Unplug } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/TaskList';
import { ProjectOptions } from '../../components/ui/ProjectOptions';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import {
  DEFAULT_CONFLUENCE_URL, linkedConfluenceTask, taskFromConfluence, type ConfluenceStatus, type ConfluenceTask,
} from '../../domain/confluence';
import { fold } from '../../domain/text';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ViewHeader } from '../views/ViewHeader';
import { confluenceApi } from './confluenceApi';

const REFRESH_MS = 5 * 60_000;
const ALL = '';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
};

/**
 * Confluence: las tareas (casillas de las páginas) asignadas a la persona, con su página y su fecha, y «Añadir al
 * gestor» para traerlas como tareas (con el enlace a la página).
 */
export function ConfluenceView() {
  const [status, setStatus] = useState<ConfluenceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    confluenceApi.status().then(setStatus, (e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <ViewHeader
        title={<span className="inline-flex items-center gap-2"><FileText className="size-5 text-sky-600" />Confluence</span>}
        subtitle={status?.connected ? `Conectado como ${status.user}` : 'Conecta tu Confluence con un Personal Access Token'}
        actions={status?.connected && (
          <ActionButton icon={<Unplug className="size-4" />} title="Borra el token del servidor"
            onClick={() => { if (confirm('¿Desconectar Confluence? Se borra tu token del servidor. Las tareas ya añadidas se quedan.')) void confluenceApi.disconnect().then(setStatus); }}>
            Desconectar
          </ActionButton>
        )}
      />
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {status && (status.connected ? <ConfluenceTasks /> : <ConnectForm initialUrl={status.baseUrl} onConnected={setStatus} />)}
    </>
  );
}

function ConnectForm({ initialUrl, onConnected }: { initialUrl: string; onConnected: (s: ConfluenceStatus) => void }) {
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState(initialUrl || DEFAULT_CONFLUENCE_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConnected(await confluenceApi.connect(token, baseUrl));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-700">
        <h2 className="mb-2 font-semibold">Cómo conseguir el token</h2>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
          <li>Abre Confluence y entra con tu usuario.</li>
          <li>Pulsa tu foto (arriba a la derecha) → <b>Configuración</b> → <b>Personal Access Tokens</b>.</li>
          <li>Pulsa <b>Crear token</b>, ponle un nombre (p. ej. «Gestor de tareas») y, si te lo pide, una caducidad.</li>
          <li>Copia el token (solo se ve una vez) y pégalo aquí debajo.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">
          El token se guarda solo en el servidor del gestor y nunca vuelve al navegador. El servidor tiene que poder llegar a
          Confluence: si solo se abre desde la VPN o el escritorio virtual del cliente, el gestor también tiene que estar ahí.
        </p>
      </section>
      <form onSubmit={submit} className="space-y-2">
        <input className={inputClass} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Personal Access Token de Confluence" autoComplete="off" />
        <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULT_CONFLUENCE_URL} aria-label="Dirección de Confluence" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !token.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? 'Comprobando…' : 'Conectar'}
        </button>
      </form>
    </div>
  );
}

function ConfluenceTasks() {
  const { tasks, editTask, projects } = useApp();
  const [items, setItems] = useState<ConfluenceTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [showDone, setShowDone] = usePersistentState('confluence-show-done', false);
  const [space, setSpace] = usePersistentState('confluence-space', ALL);
  const [projectId, setProjectId] = usePersistentState('confluence-project', '');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await confluenceApi.tasks(showDone));
      setLoadedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showDone]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const spaces = useMemo(() => [...new Set((items ?? []).map((t) => t.space).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'es')), [items]);
  const query = fold(q.trim());
  const visible = (items ?? []).filter((t) => (space === ALL || t.space === space)
    && (!query || fold(`${t.text} ${t.pageTitle ?? ''} ${t.space ?? ''}`).includes(query)));
  const toAdd = visible.filter((t) => !t.done && !linkedConfluenceTask(t, tasks));
  const target = projects.some((p) => p.id === projectId) ? projectId : null;
  const now = today();

  const add = (list: ConfluenceTask[]) => repo.batch(list.length === 1 ? 'Añadida desde Confluence' : `${list.length} añadidas desde Confluence`, async () => {
    for (const t of list) await repo.createTask(taskFromConfluence(t, target));
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-900">
          <Search className="size-3.5 text-zinc-400" />
          <input className="w-56 bg-transparent py-1 text-sm outline-none" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por texto o página…" aria-label="Filtrar tareas de Confluence" />
        </div>
        <select className={`${inputClass} w-auto py-1`} value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Espacio">
          <option value={ALL}>Todos los espacios</option>
          {spaces.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Incluir completadas
        </label>
        <span className="ml-auto inline-flex items-center gap-2">
          {loadedAt && <span className="text-xs text-zinc-400">Actualizado {loadedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>}
          <ActionButton icon={<RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void load()}>Actualizar</ActionButton>
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
        <span className="text-zinc-500">Añadir al gestor en</span>
        <select className={`${inputClass} w-48 py-1`} value={target ?? ''} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto de destino">
          <option value="">Bandeja (sin proyecto)</option>
          <ProjectOptions />
        </select>
        {toAdd.length > 0 && <ActionButton icon={<Plus className="size-4" />} onClick={() => void add(toAdd)}>Añadir las {toAdd.length} pendientes que se ven</ActionButton>}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {items === null && !error && <p className="text-sm text-zinc-500">Cargando de Confluence…</p>}
      {items !== null && visible.length === 0 && <p className="text-sm text-zinc-500">No tienes tareas de Confluence {showDone ? '' : 'pendientes '}con estos filtros.</p>}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {visible.map((t) => {
          const task = linkedConfluenceTask(t, tasks);
          const overdue = !t.done && !!t.dueDate && t.dueDate < now;
          return (
            <li key={t.id} className={`-mx-2 flex items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${t.done ? 'opacity-60' : ''}`}>
              <span className={`mt-0.5 size-4 shrink-0 rounded border ${t.done ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-400'}`} aria-label={t.done ? 'Completada' : 'Pendiente'} />
              <div className="min-w-0 flex-1">
                <p className={`whitespace-pre-line ${t.done ? 'line-through' : ''}`}>{t.text}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline" title="Abrir la página en Confluence">
                      {t.pageTitle ?? 'Abrir página'}<ExternalLink className="size-3" />
                    </a>
                  ) : t.pageTitle}
                  {t.space && <span>· {t.space}</span>}
                </p>
              </div>
              {t.dueDate && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${overdue ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                  {formatDay(t.dueDate)}
                </span>
              )}
              {task ? (
                <button type="button" onClick={() => editTask(task)} className="w-24 shrink-0 rounded-md px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
                  {task.status === 'done' ? '✓ Hecha aquí' : 'En el gestor'}
                </button>
              ) : (
                <button type="button" onClick={() => void add([t])} className="inline-flex w-24 shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
                  <Plus className="size-3" />Añadir
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
