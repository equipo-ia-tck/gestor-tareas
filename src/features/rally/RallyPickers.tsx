import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Plus, Search, UserRound, X } from 'lucide-react';
import { Popover } from '../../components/ui/Popover';
import { inputClass } from '../../components/ui/styles';
import type { RallyPick, RallyProject, RallyRef } from '../../domain/rally';
import { usePersistentState } from '../../hooks/usePersistentState';
import { rallyApi } from './rallyApi';

const PAGE = 50;

/** Valor que cambia solo cuando se deja de escribir un momento (para no consultar Rally a cada tecla). */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchBox({ value, onChange, placeholder = 'Buscar' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  // El desplegable se crea oculto hasta que se coloca (y ahí autoFocus no funciona): se enfoca justo después.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-indigo-500 bg-white px-2 ring-1 ring-indigo-500 dark:bg-zinc-800">
      <Search className="size-4 text-indigo-600" />
      <input ref={input} className="w-full bg-transparent py-1.5 text-sm outline-none" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

const Heading = ({ children }: { children: ReactNode }) => (
  <p className="px-2 pt-2 pb-1 text-xs font-bold tracking-wide text-zinc-600 uppercase dark:text-zinc-300">{children}</p>
);

/** «Mostrando 1 - 50 de 1.350» con flechas de página, como en Rally. */
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const from = total ? (page - 1) * PAGE + 1 : 0;
  const to = Math.min(page * PAGE, total);
  return (
    <div className="flex items-center justify-end gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
      <span>Mostrando {from} - {to} de {total.toLocaleString('es-ES')}</span>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-zinc-300 p-0.5 disabled:opacity-40 dark:border-zinc-600" aria-label="Página anterior"><ChevronLeft className="size-4" /></button>
      <button type="button" disabled={to >= total} onClick={() => onPage(page + 1)} className="rounded border border-zinc-300 p-0.5 disabled:opacity-40 dark:border-zinc-600" aria-label="Página siguiente"><ChevronRight className="size-4" /></button>
    </div>
  );
}

/** Ventana por encima del panel de alta (portal: Esc la cierra a ella sola y no al panel). */
export function Dialog({ title, onClose, onEscape, width = 'max-w-2xl', children }: {
  title: string; onClose: () => void; width?: string; children: ReactNode;
  /** Esc hace esto en vez de cerrar (p. ej. salir de un campo en edición). */
  onEscape?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); (onEscape ?? onClose)(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onEscape]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[8vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`flex max-h-[84vh] w-full ${width} flex-col rounded-lg bg-white p-4 text-sm text-zinc-900 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100`}>
        <div className="mb-2 flex items-center">
          <h2 className="flex-1 text-sm font-bold tracking-wide uppercase">{title}</h2>
          <button type="button" onClick={onClose} className="text-indigo-600 dark:text-indigo-300" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const fieldBox = 'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-left dark:border-zinc-600 dark:bg-zinc-800';
const chip = 'inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200';

/**
 * Owner / Assignee como en Rally: «Quick picks» (sin nadie y tú), miembros del equipo del proyecto y, al escribir,
 * cualquier persona de Rally por nombre, usuario o email.
 */
export function PersonPicker({ value, onChange, me, team, label, loading }: {
  value: RallyRef | null;
  onChange: (v: RallyRef | null) => void;
  me: RallyRef | null;
  team: RallyRef[];
  label: string;
  loading: boolean;
}) {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [found, setFound] = useState<RallyRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.length < 2) { setFound(null); return; }
    let live = true;
    setError(null);
    rallyApi.searchUsers(query).then((u) => live && setFound(u), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [query]);

  const match = (u: RallyRef) => u.name.toLowerCase().includes(q.trim().toLowerCase());
  const members = team.filter((u) => u.ref !== me?.ref && match(u));
  const others = (found ?? []).filter((u) => u.ref !== me?.ref && !team.some((t) => t.ref === u.ref));
  const option = (u: RallyRef | null, close: () => void) => (
    <button key={u?.ref ?? 'none'} type="button" onClick={() => { onChange(u); setQ(''); close(); }}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${(value?.ref ?? null) === (u?.ref ?? null) ? 'bg-slate-200 dark:bg-zinc-700' : ''}`}>
      {u ? <><UserRound className="size-4 text-zinc-400" /> {u.name}</> : '— Sin nadie —'}
    </button>
  );

  return (
    <Popover width="w-80" className="relative block" trigger={(toggle) => (
      <button type="button" onClick={toggle} disabled={loading} aria-label={label} className={`${inputClass} flex items-center gap-2 text-left disabled:opacity-60`}>
        {loading ? 'Cargando…' : value ? <><UserRound className="size-4 text-zinc-400" /> {value.name}</> : '— Sin nadie —'}
      </button>
    )}>
      {(close) => (
        <div className="p-1">
          <SearchBox value={q} onChange={setQ} />
          <div className="max-h-72 overflow-y-auto">
            {(!q.trim() || (me && match(me))) && (
              <>
                <Heading>Quick picks</Heading>
                {!q.trim() && option(null, close)}
                {me && match(me) && option(me, close)}
              </>
            )}
            {members.length > 0 && <><Heading>Team members</Heading>{members.map((u) => option(u, close))}</>}
            {others.length > 0 && <><Heading>Más personas en Rally</Heading>{others.map((u) => option(u, close))}</>}
            {q.trim().length === 1 && <p className="px-2 py-1 text-xs text-zinc-400">Escribe al menos 2 letras para buscar en todo Rally.</p>}
            {query.length >= 2 && found === null && !error && <p className="px-2 py-1 text-xs text-zinc-400">Buscando en Rally…</p>}
            {found !== null && !members.length && !others.length && !(me && match(me)) && <p className="px-2 py-1 text-xs text-zinc-400">Nadie con ese nombre.</p>}
            {error && <p className="px-2 py-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}

/**
 * Campo «Parent» (o Feature, Work Product…): el elemento elegido y un «+» que abre «Elegir padre», con tipo, proyecto,
 * buscador por palabra o ID, release y la lista paginada.
 */
export function ParentField({ value, onChange, types, projects, projectId, releases, title, allProjects }: {
  value: RallyPick | null;
  onChange: (v: RallyPick | null) => void;
  types: { key: string; label: string }[];
  projects: RallyProject[];
  projectId: string;
  releases: RallyRef[];
  title: string;
  /** Buscar de entrada en todos los proyectos (el padre de una feature suele estar en un proyecto de nivel superior). */
  allProjects?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={fieldBox}>
        {value ? (
          <span className={`${chip} max-w-full`}>
            <b>{value.id}</b> <span className="truncate">{value.name}</span>
            <button type="button" onClick={() => onChange(null)} aria-label={`Quitar ${value.id}`}><X className="size-3" /></button>
          </span>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="flex flex-1 items-center rounded p-1 text-indigo-600 dark:text-indigo-300" aria-label={title}>
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {open && <ParentDialog title={title} types={types} projects={projects} projectId={projectId} releases={releases} allProjects={allProjects}
        onClose={() => setOpen(false)} onPick={(p) => { onChange(p); setOpen(false); }} />}
    </>
  );
}

function ParentDialog({ title, types, projects, projectId, releases, allProjects, onPick, onClose }: {
  title: string;
  types: { key: string; label: string }[];
  projects: RallyProject[];
  projectId: string;
  releases: RallyRef[];
  allProjects?: boolean;
  onPick: (p: RallyPick) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState('all');
  const [project, setProject] = useState(allProjects ? '' : projectId);
  const [release, setRelease] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: RallyPick[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Las releases que hay son las del proyecto del formulario: el filtro solo vale si se busca en ese proyecto.
  const releaseFilter = project === projectId ? release : '';

  useEffect(() => { setPage(1); }, [type, project, releaseFilter, query]);
  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    rallyApi.pick({ types: type === 'all' ? types.map((t) => t.key) : [type], q: query, project, release: releaseFilter.split('/').pop() ?? '', page })
      .then((r) => live && setResult(r), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [type, project, releaseFilter, query, page, types]);

  const label = 'mb-0.5 block text-xs font-bold tracking-wide text-zinc-600 uppercase dark:text-zinc-300';
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label><span className={label}>Tipo</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)} disabled={types.length < 2}>
            {types.length > 1 && <option value="all">Todos</option>}
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label><span className={label}>Proyecto</span>
          <select className={inputClass} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Todos los proyectos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label><span className={label}>&nbsp;</span>
          <SearchBox value={q} onChange={setQ} placeholder="Buscar por palabra o ID" />
        </label>
        {project === projectId && releases.length > 0 && (
          <label className="sm:col-start-3"><span className={label}>Release</span>
            <select className={inputClass} value={release} onChange={(e) => setRelease(e.target.value)}>
              <option value="">Cualquiera</option>
              {releases.map((r) => <option key={r.ref} value={r.ref}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto border-y border-zinc-200 dark:border-zinc-700">
        {error && <p className="p-2 text-red-600">{error}</p>}
        {!result && !error && <p className="p-2 text-zinc-400">Buscando en Rally…</p>}
        {result?.items.length === 0 && <p className="p-2 text-zinc-400">No hay nada con estos filtros.</p>}
        {result?.items.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p)}
            className="grid w-full grid-cols-[6rem_minmax(0,1fr)_10rem] gap-3 border-b border-zinc-100 px-2 py-1.5 text-left hover:bg-indigo-50 dark:border-zinc-800 dark:hover:bg-indigo-950">
            <span className="text-zinc-700 dark:text-zinc-200">{p.id}</span>
            <span className="truncate" title={p.name}>{p.name}</span>
            <span className="truncate text-zinc-500">{p.project}</span>
          </button>
        ))}
      </div>
      <div className="mt-2"><Pager page={page} total={result?.total ?? 0} onPage={setPage} /></div>
    </Dialog>
  );
}

/**
 * Campo de varios valores (Tags, Milestones): chips y un «+» que abre «Elegir valores», con buscador, recientes,
 * disponibles con casillas y paginación. `load` busca en Rally (o en la lista ya cargada).
 */
export function ValuesField({ value, onChange, load, recentKey, title }: {
  value: RallyRef[];
  onChange: (v: RallyRef[]) => void;
  load: (q: string, page: number) => Promise<{ items: RallyRef[]; total: number }>;
  recentKey: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = usePersistentState<RallyRef[]>(recentKey, []);
  return (
    <>
      <div className={fieldBox}>
        {value.map((v) => (
          <span key={v.ref} className={chip}>
            {v.name}
            <button type="button" onClick={() => onChange(value.filter((x) => x.ref !== v.ref))} aria-label={`Quitar ${v.name}`}><X className="size-3" /></button>
          </span>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="flex flex-1 items-center rounded p-1 text-indigo-600 dark:text-indigo-300" aria-label={title}>
          <Plus className="size-4" />
        </button>
      </div>
      {open && (
        <ValuesDialog title={title} initial={value} recent={recent} load={load} onClose={() => setOpen(false)}
          onDone={(chosen) => {
            onChange(chosen);
            setRecent([...chosen, ...recent.filter((r) => !chosen.some((c) => c.ref === r.ref))].slice(0, 8));
            setOpen(false);
          }} />
      )}
    </>
  );
}

function ValuesDialog({ title, initial, recent, load, onDone, onClose }: {
  title: string;
  initial: RallyRef[];
  recent: RallyRef[];
  load: (q: string, page: number) => Promise<{ items: RallyRef[]; total: number }>;
  onDone: (v: RallyRef[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(initial);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: RallyRef[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    load(query, page).then((r) => live && setResult(r), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [query, page, load]);

  const isOn = (v: RallyRef) => chosen.some((c) => c.ref === v.ref);
  const toggle = (v: RallyRef) => setChosen((list) => (isOn(v) ? list.filter((c) => c.ref !== v.ref) : [...list, v]));
  const row = (v: RallyRef) => (
    <label key={v.ref} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
      <input type="checkbox" checked={isOn(v)} onChange={() => toggle(v)} /> <span className="truncate">{v.name}</span>
    </label>
  );
  const recentShown = recent.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const alreadySet = initial.filter((v) => !recentShown.some((r) => r.ref === v.ref));

  return (
    <Dialog title={title} onClose={onClose} width="max-w-sm">
      <SearchBox value={q} onChange={setQ} />
      <div className="mt-1 min-h-40 flex-1 overflow-y-auto">
        {/* Nada cambia de sitio al marcar: así el siguiente clic cae donde se espera. «Ya puestas» son las que
            tenía el campo al abrir y no salen en recientes. */}
        {alreadySet.length > 0 && <><Heading>Ya puestas</Heading>{alreadySet.map(row)}</>}
        {recentShown.length > 0 && <><Heading>Recientes</Heading>{recentShown.map(row)}</>}
        <Heading>Disponibles</Heading>
        {error && <p className="px-2 text-red-600">{error}</p>}
        {!result && !error && <p className="px-2 text-zinc-400">Buscando en Rally…</p>}
        {result?.items.length === 0 && <p className="px-2 text-zinc-400">Nada con ese nombre.</p>}
        {result?.items.map(row)}
      </div>
      <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-700"><Pager page={page} total={result?.total ?? 0} onPage={setPage} /></div>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => onDone(chosen)} className="rounded-md bg-[#1e64c8] px-4 py-1.5 font-medium text-white hover:bg-[#1a56ad]">Hecho</button>
      </div>
    </Dialog>
  );
}

/** `load` para una lista ya cargada (Milestones): filtra por nombre y pagina en el navegador. */
export const localLoad = (list: RallyRef[]) => async (q: string, page: number) => {
  const all = list.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return { items: all.slice((page - 1) * PAGE, page * PAGE), total: all.length };
};
