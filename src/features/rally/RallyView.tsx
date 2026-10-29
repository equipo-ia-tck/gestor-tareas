import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, Layers, Plus, RefreshCw, Unplug } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { ActionButton, Section } from '../../components/TaskList';
import { Avatar } from '../../components/ui/Badges';
import { ProjectOptions } from '../../components/ui/ProjectOptions';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import {
  groupRally, linkedTask, RALLY_KINDS, taskFromRally, tasksByRallyId,
  type RallyGroupBy, type RallyItem, type RallyKind, type RallyProject, type RallyStatus,
} from '../../domain/rally';
import { usePersistentState } from '../../hooks/usePersistentState';
import type { Task } from '../../domain/types';
import { useWideLayout } from '../../app/Layout';
import { ViewHeader } from '../views/ViewHeader';
import { RallyDetailPanel } from './RallyDetailPanel';
import { rallyApi } from './rallyApi';
import { applyRallyStates } from './rallyStates';

const REFRESH_MS = 5 * 60_000;

/**
 * Rally: lo asignado a la persona o lo de los proyectos elegidos en el banner, con "Añadir al gestor" para traer cada
 * elemento como tarea (con su ID y enlace).
 */
export function RallyView() {
  const [status, setStatus] = useState<RallyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rallyApi.status().then(setStatus, (e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <ViewHeader
        title={<span className="inline-flex items-center gap-2"><Layers className="size-5 text-indigo-500" />Rally</span>}
        subtitle={status?.connected ? `Conectado como ${status.rallyUser}` : 'Conecta tu cuenta de Rally con una clave de API'}
        actions={status?.connected && (
          <ActionButton icon={<Unplug className="size-4" />} title="Borra la clave del servidor"
            onClick={() => { if (confirm('¿Desconectar Rally? Se borra tu clave del servidor. Las tareas ya añadidas se quedan.')) void rallyApi.disconnect().then(setStatus); }}>
            Desconectar
          </ActionButton>
        )}
      />
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {status && (status.connected ? <RallyItems /> : <ConnectForm initialUrl={status.baseUrl} onConnected={setStatus} />)}
    </>
  );
}

function ConnectForm({ initialUrl, onConnected }: { initialUrl: string; onConnected: (s: RallyStatus) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConnected(await rallyApi.connect(apiKey, baseUrl));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-700">
        <h2 className="mb-2 font-semibold">Cómo conseguir la clave de API</h2>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
          <li>Abre <a className="text-indigo-600 hover:underline" href="https://eu1.rallydev.com/login" target="_blank" rel="noreferrer">eu1.rallydev.com/login</a> y entra con tu usuario.</li>
          <li>Haz clic en <b>API Keys</b> (arriba a la derecha de esa página, o en tu perfil de Rally).</li>
          <li>Pulsa <b>Create New API Key</b>, ponle una descripción (p. ej. «Gestor de tareas») y elige <b>Read-Only</b>.</li>
          <li>Copia la clave (empieza por <code>_</code>) y pégala aquí debajo.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">
          La clave se guarda solo en el servidor del gestor y nunca vuelve al navegador. Si no ves «API Keys», el administrador
          de Rally del cliente las ha restringido y hay que pedírselo. Si tu Rally tiene otra dirección, cámbiala abajo.
        </p>
      </section>
      <form onSubmit={submit} className="space-y-2">
        <input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Clave de API de Rally" autoComplete="off" />
        <input className={inputClass} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://eu1.rallydev.com" aria-label="Dirección de Rally" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !apiKey.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? 'Comprobando…' : 'Conectar'}
        </button>
      </form>
    </div>
  );
}

const chipClass = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs font-medium ${on
  ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'}`;

const NO_ONE = '__nadie';
const GROUP_LABEL: Record<RallyGroupBy, string> = { category: 'categoría', state: 'columna de Rally', iteration: 'iteración', assignee: 'persona' };

function RallyItems() {
  const { tasks, itemTypes, projects, editTask, closeDetail } = useApp();
  const [rallyProjects, setRallyProjects] = useState<RallyProject[] | null>(null);
  const [items, setItems] = useState<RallyItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selected, setSelected] = usePersistentState<string[]>('rally-projects', []);
  const [kinds, setKinds] = usePersistentState<RallyKind[]>('rally-kinds', RALLY_KINDS.map((k) => k.kind));
  const [hideDone, setHideDone] = usePersistentState('rally-hide-done', false);
  const [onlyMine, setOnlyMine] = usePersistentState('rally-only-mine', false);
  const [person, setPerson] = useState('');
  const [groupBy, setGroupBy] = usePersistentState<RallyGroupBy>('rally-group-by', 'category');
  const [days, setDays] = usePersistentState('rally-days', 90);
  const [projectId, setProjectId] = usePersistentState('rally-project', '');
  // Elemento abierto en el panel de la derecha.
  const [open, setOpen] = useState<RallyItem | null>(null);
  const closePanel = useCallback(() => setOpen(null), []);
  // Con el panel abierto, la vista usa todo el ancho y el panel es una columna más (como en el Tablero).
  useWideLayout(!!open);

  useEffect(() => {
    rallyApi.projects().then(setRallyProjects, (e: Error) => setError(e.message));
  }, []);

  // Proyectos elegidos que siguen existiendo (en una cadena, para no recargar en cada render).
  const projectKey = rallyProjects ? selected.filter((id) => rallyProjects.some((p) => p.id === id)).join(',') : null;
  const projectMode = !!projectKey;

  const load = useCallback(async () => {
    if (projectKey === null) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await rallyApi.items(days, projectKey ? projectKey.split(',') : []);
      setItems(loaded);
      // De paso, las tareas enlazadas se ponen en la categoría que tienen en Rally.
      void applyRallyStates(loaded).catch(() => {});
      setLoadedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days, projectKey]);

  useEffect(() => {
    setItems(null);
    setPerson('');
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const byId = useMemo(() => tasksByRallyId(tasks), [tasks]);
  const base = (items ?? []).filter((it) => (!hideDone || !it.done) && (!projectMode || !onlyMine || it.mine)
    && (!person || (person === NO_ONE ? !it.assignee : it.assignee === person)));
  const visible = base.filter((it) => kinds.includes(it.kind));
  const people = [...new Set((items ?? []).map((it) => it.assignee).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b, 'es'));
  const toAdd = visible.filter((it) => !it.done && !linkedTask(it, byId));
  const target = projects.some((p) => p.id === projectId) ? projectId : null;

  const colorOf = (kind: RallyKind) => itemTypes.find((t) => t.short && t.short.toUpperCase() === kind)?.color ?? '#71717a';
  const show = (it: RallyItem) => { closeDetail(); setOpen(it); };
  const openTask = (task: Task) => { setOpen(null); editTask(task); };
  const toggleProject = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const add = (list: RallyItem[]) => repo.batch(list.length === 1 ? `${list[0].id} añadida desde Rally` : `${list.length} añadidas desde Rally`, async () => {
    for (const it of list) await repo.createTask(taskFromRally(it, itemTypes, target));
  });

  return (
    <div className={open ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_460px] xl:items-start xl:gap-6' : ''}>
      <div className="min-w-0">
      <section className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-indigo-700 uppercase dark:text-indigo-300">Qué ver de Rally</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chipClass(!projectMode)} onClick={() => setSelected([])} title="Lo que tiene Assignee u Owner = tú">Asignado a mí</button>
          {rallyProjects?.map((p) => (
            <button key={p.id} type="button" className={chipClass(selected.includes(p.id))} onClick={() => toggleProject(p.id)}>{p.name}</button>
          ))}
          {rallyProjects === null && <span className="text-xs text-zinc-400">Cargando proyectos…</span>}
        </div>
        {projectMode && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Solo lo mío
            </label>
            <select className={`${inputClass} w-56 py-1`} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Persona" disabled={onlyMine}>
              <option value="">Todas las personas</option>
              {people.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value={NO_ONE}>Sin asignar</option>
            </select>
          </div>
        )}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {RALLY_KINDS.map(({ kind, label }) => {
          const on = kinds.includes(kind);
          return (
            <button key={kind} type="button" title={label} onClick={() => setKinds(on ? kinds.filter((k) => k !== kind) : [...kinds, kind])}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 text-zinc-500 dark:border-zinc-600'}`}>
              {kind} · {base.filter((it) => it.kind === kind).length}
            </button>
          );
        })}
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ocultar terminadas
        </label>
        <select className={`${inputClass} w-auto py-0.5 text-xs`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periodo">
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
          <option value={365}>Último año</option>
          <option value={0}>Todo</option>
        </select>
        <select className={`${inputClass} w-auto py-0.5 text-xs`} value={groupBy} onChange={(e) => setGroupBy(e.target.value as RallyGroupBy)} aria-label="Agrupar por">
          {(Object.keys(GROUP_LABEL) as RallyGroupBy[]).map((g) => <option key={g} value={g}>Agrupar por {GROUP_LABEL[g]}</option>)}
        </select>
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
        <span className="text-xs text-zinc-400">Las tareas añadidas se mueven solas a la categoría que tengan en Rally.</span>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {items === null && !error && <p className="text-sm text-zinc-500">Cargando de Rally…</p>}
      {items !== null && visible.length === 0 && (
        <p className="text-sm text-zinc-500">
          {projectMode ? 'No hay nada en estos proyectos con estos filtros.' : 'No hay nada asignado a ti (Assignee u Owner) con estos filtros. Prueba con el periodo «Todo» o elige un proyecto arriba.'}
        </p>
      )}

      {visible.length > 0 && (
        <div className="-mx-2 mb-1 hidden gap-2 border-b border-zinc-200 px-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase md:flex dark:border-zinc-700">
          <span className="w-7" /><span className="w-24">ID</span><span className="flex-1">Name</span><span className="w-40">Owner</span>
          <span className="w-36 text-right">Estado</span><span className="w-24" />
        </div>
      )}
      {groupRally(visible, groupBy).map((g) => (
        <Section key={g.key ?? '-'} collapsible title={`${g.key ?? (groupBy === 'iteration' ? 'Sin iteración' : 'Sin asignar')} · ${g.items.length}`}>
          {g.items.length === 0 && <p className="py-1 text-xs text-zinc-400">Nada en esta categoría.</p>}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {g.items.map((it) => {
              const task = linkedTask(it, byId);
              return (
                <li key={it.objectId} data-rally-row onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) show(it); }}
                  className={`-mx-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${it.done ? 'opacity-60' : ''} ${open?.objectId === it.objectId ? 'bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-950/50 dark:ring-indigo-800' : ''}`}>
                  <span className="w-7 shrink-0 rounded px-1 text-center text-[10px] font-bold text-white" style={{ background: colorOf(it.kind) }}>{it.kind}</span>
                  <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex w-24 shrink-0 items-center gap-0.5 font-mono text-xs text-indigo-600 hover:underline" title="Abrir en Rally">
                    {it.id}<ExternalLink className="size-3" />
                  </a>
                  {/* Columnas fijas (ID, Owner, Estado) para que cuadren con la cabecera; lo variable va junto al nombre. */}
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate" title={it.name}>{it.name}</span>
                    {groupBy !== 'assignee' && it.assignee && it.assignee !== it.owner && (
                      <span className={`hidden max-w-32 shrink-0 truncate text-xs md:inline ${it.mine ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}`} title={`Assignee en Rally: ${it.assignee}`}>
                        → {it.mine ? 'Tú' : it.assignee}
                      </span>
                    )}
                    {!projectMode && it.project && <span className="hidden max-w-40 shrink-0 truncate text-xs text-zinc-400 lg:inline" title={it.project}>{it.project}</span>}
                  </span>
                  <span className="hidden w-40 shrink-0 items-center gap-1.5 text-xs text-zinc-600 md:inline-flex dark:text-zinc-300" title="Owner en Rally">
                    {it.owner ? <><Avatar name={it.owner} size={18} /><span className="truncate">{it.owner}</span></> : <span className="text-zinc-400">Sin owner</span>}
                  </span>
                  <span className="flex w-36 shrink-0 justify-end">
                    {(groupBy !== 'state' || it.blocked) && (
                      <span className={`truncate rounded-full px-2 py-0.5 text-xs ${it.blocked ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
                        title={it.blocked ? `Bloqueada · ${it.state}` : it.state}>
                        {it.blocked ? (groupBy === 'state' ? 'Bloqueada' : `Bloqueada · ${it.state}`) : it.state}
                      </span>
                    )}
                  </span>
                  {task ? (
                    <button type="button" onClick={() => openTask(task)} className="w-24 shrink-0 rounded-md px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
                      {task.status === 'done' ? '✓ Hecha aquí' : 'En el gestor'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void add([it])} className="inline-flex w-24 shrink-0 items-center justify-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
                      <Plus className="size-3" />Añadir
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      </div>

      {open && (
        <RallyDetailPanel
          item={open}
          task={linkedTask(open, byId)}
          color={colorOf(open.kind)}
          onSelect={setOpen}
          onAdd={() => void add([open])}
          onOpenTask={() => { const t = linkedTask(open, byId); if (t) openTask(t); }}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
