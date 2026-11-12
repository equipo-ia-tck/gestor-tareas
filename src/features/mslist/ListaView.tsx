import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, ListChecks, Plus, RefreshCw, Search, Settings2, Unplug } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { ActionButton } from '../../components/TaskList';
import { ProjectOptions } from '../../components/ui/ProjectOptions';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import {
  categoryOfValue, guessStatusColumn, itemCategory, LIST_CATEGORIES, listColumns, listKey, statusValues, taskFromListItem,
  type MsListConfig,
} from '../../domain/msList';
import { columnLabel, type MsListItem } from '../../domain/msListParse';
import { fold } from '../../domain/text';
import type { StateCategory } from '../../domain/types';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ViewHeader } from '../views/ViewHeader';
import { listaApi, loadListaConfig, saveListaConfig, type ListaData, type ListaStatus } from './listaApi';
import { applyListStates } from './listaStates';

const REFRESH_MS = 60_000;
const STALE_MS = 20 * 60_000;
const CATEGORY_COLOR: Record<string, string> = {
  todo: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  doing: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  blocked: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/**
 * Microsoft List por Power Automate y OneDrive (sin permisos de Microsoft): los elementos con su estado, cambiar el
 * estado (se aplica en la lista en unos minutos) y «Añadir al gestor», con el estado sincronizado en los dos sentidos.
 */
export function ListaView() {
  const [status, setStatus] = useState<ListaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listaApi.status().then(setStatus, (e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <ViewHeader
        title={<span className="inline-flex items-center gap-2"><ListChecks className="size-5 text-teal-600" />Lista</span>}
        subtitle={status?.linked ? 'Microsoft List por Power Automate y OneDrive' : 'Conecta una Microsoft List con dos flujos de Power Automate'}
        actions={status?.linked && (
          <ActionButton icon={<Unplug className="size-4" />} title="Deja de leer el archivo de la lista"
            onClick={() => { if (confirm('¿Desvincular la lista? Las tareas ya añadidas se quedan.')) void listaApi.unlink().then(setStatus); }}>
            Desvincular
          </ActionButton>
        )}
      />
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {status && (status.linked ? <ListaItems /> : <Setup status={status} onLinked={setStatus} />)}
    </>
  );
}

function Setup({ status, onLinked }: { status: ListaStatus; onLinked: (s: ListaStatus) => void }) {
  const [error, setError] = useState<string | null>(null);
  const step = 'font-semibold text-zinc-800 dark:text-zinc-100';
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-1 font-semibold">1. Flujo «Gestor · exportar lista»</h2>
        <p className="mb-2 text-zinc-500">Lo más fácil: duplica tu flujo del calendario (que ya funciona) y cambia la acción que lee.</p>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
          <li><span className={step}>Periódicamente</span>: cada 5 minutos.</li>
          <li><span className={step}>SharePoint → Obtener elementos</span>: tu sitio y tu lista. En «Mostrar todo», <b>Recuento superior</b> = 5000.</li>
          <li>Guarda el resultado en <code>OneDrive/Gestor/lista.json</code> igual que guarda el calendario (misma acción), con el contenido
            <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">body(&apos;Obtener_elementos&apos;)</code> como expresión.</li>
        </ol>
      </section>
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-1 font-semibold">2. Flujo «Gestor · aplicar cambios a la lista»</h2>
        <p className="mb-2 text-zinc-500">Para que lo que cambies aquí llegue a la lista. Si de momento solo quieres verla, sáltatelo.</p>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-300">
          <li><span className={step}>OneDrive para la Empresa → Cuando se modifica un archivo</span>, carpeta <code>/Gestor/cambios</code>.</li>
          <li><span className={step}>Obtener contenido de archivo mediante ruta</span>: <code>/Gestor/cambios/lista-cambios.json</code>.</li>
          <li><span className={step}>Redactar</span> con la expresión
            <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">json(body(&apos;Obtener_contenido_de_archivo_mediante_ruta&apos;))</code>.</li>
          <li><span className={step}>Aplicar a cada uno</span> sobre <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">outputs(&apos;Redactar&apos;)?[&apos;cambios&apos;]</code> y,
            dentro, <span className={step}>SharePoint → Actualizar elemento</span>: tu sitio y lista; <b>Id</b> = <code>item()?[&apos;id&apos;]</code>,
            <b> Título</b> = <code>item()?[&apos;titulo&apos;]</code> y en tu columna de estado <code>item()?[&apos;valor&apos;]</code>.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">Si «Redactar» da error de formato, usa
          <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">json(base64ToString(body(&apos;Obtener_contenido_de_archivo_mediante_ruta&apos;)?[&apos;$content&apos;]))</code>.</p>
        <p className="mt-2 text-xs text-zinc-500">El gestor crea la carpeta <code>Gestor/cambios</code> la primera vez que cambias un estado. Cada cambio tarda unos minutos en llegar a la lista.</p>
      </section>
      <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900 dark:bg-teal-950/40">
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {status.found ? '✓ Archivo Gestor/lista.json encontrado en tu OneDrive.' : 'Aún no hay Gestor/lista.json en tu OneDrive: crea el primer flujo y ejecútalo una vez.'}
        </p>
        <button type="button" disabled={!status.found}
          onClick={() => { setError(null); listaApi.link().then(onLinked, (e: Error) => setError(e.message)); }}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
          Vincular a mi cuenta
        </button>
        {error && <p className="mt-3 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      </div>
    </div>
  );
}

function ListaItems() {
  const { tasks, editTask, projects } = useApp();
  const [data, setData] = useState<ListaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfigState] = useState<MsListConfig>(loadListaConfig);
  const [showConfig, setShowConfig] = useState(false);
  const [q, setQ] = useState('');
  const [valueFilter, setValueFilter] = useState('');
  const [hideDone, setHideDone] = usePersistentState('lista-hide-done', true);
  const [projectId, setProjectId] = usePersistentState('lista-project', '');
  const [busy, setBusy] = useState<string | null>(null);

  const setConfig = (c: MsListConfig) => { setConfigState(c); saveListaConfig(c); };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await listaApi.items();
      setData(d);
      void applyListStates(d.items).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  // Si aún no se ha elegido, se propone la columna que parece de estado (y se guarda en cuanto se toca algo).
  const statusColumn = config.statusColumn ?? guessStatusColumn(items);
  const effective: MsListConfig = { ...config, statusColumn };
  const columns = listColumns(items);
  const values = statusValues(items, statusColumn);
  const extraColumns = columns.filter((c) => c !== statusColumn).slice(0, 3);
  const pendingIds = new Set((data?.pending ?? []).map((c) => c.id));
  const linked = useMemo(() => new Map(tasks.filter((t) => !t.deleted_at && t.external_id).map((t) => [t.external_id!, t])), [tasks]);
  const target = projects.some((p) => p.id === projectId) ? projectId : null;

  const query = fold(q.trim());
  const visible = items.filter((it) => (!hideDone || itemCategory(it, effective) !== 'done')
    && (!valueFilter || (statusColumn && it.fields[statusColumn]) === valueFilter)
    && (!query || fold(`${it.id} ${it.title} ${Object.values(it.fields).join(' ')}`).includes(query)));
  const toAdd = visible.filter((it) => !linked.has(listKey(it.id)));

  const add = async (list: MsListItem[]) => {
    await repo.batch(list.length === 1 ? `${list[0].title} añadida desde la lista` : `${list.length} añadidas desde la lista`, async () => {
      for (const it of list) await repo.createTask(taskFromListItem(it, effective, target));
    });
    // Que cada tarea nueva quede ya en el estado de su elemento.
    void applyListStates(items).catch(() => {});
  };

  const changeStatus = async (it: MsListItem, valor: string) => {
    if (!statusColumn) return;
    setBusy(it.id);
    setError(null);
    try {
      if (!config.statusColumn) setConfig(effective);
      await listaApi.change(it.id, statusColumn, valor);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // La columna adivinada se guarda en cuanto llega la lista, así la sincronización en segundo plano ya la usa.
  useEffect(() => {
    if (!config.statusColumn && statusColumn) setConfig({ statusColumn, map: config.map });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia la columna propuesta
  }, [statusColumn]);

  const stale = data && Date.now() - new Date(data.updatedAt).getTime() > STALE_MS;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-900">
          <Search className="size-3.5 text-zinc-400" />
          <input className="w-56 bg-transparent py-1 text-sm outline-none" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar la lista" />
        </div>
        {values.length > 0 && (
          <select className={`${inputClass} w-auto py-1`} value={valueFilter} onChange={(e) => setValueFilter(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ocultar terminados
        </label>
        <span className="ml-auto inline-flex items-center gap-2">
          {data && <span className={`text-xs ${stale ? 'font-medium text-amber-600' : 'text-zinc-400'}`} title="Cuándo escribió el flujo el archivo por última vez">
            Lista actualizada {ago(data.updatedAt)}{stale ? ' (¿el flujo está activo?)' : ''}
          </span>}
          <ActionButton icon={<Settings2 className="size-4" />} onClick={() => setShowConfig(!showConfig)}>Estados</ActionButton>
          <ActionButton icon={<RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void load()}>Actualizar</ActionButton>
        </span>
      </div>

      {(showConfig || (data && !statusColumn)) && (
        <section className="mb-4 rounded-lg border border-teal-200 bg-teal-50/50 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/30">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-medium">Columna de estado</span>
            <select className={`${inputClass} w-56 py-1`} value={statusColumn ?? ''} aria-label="Columna de estado"
              onChange={(e) => setConfig({ statusColumn: e.target.value || null, map: {} })}>
              <option value="">Elige la columna…</option>
              {columns.map((c) => <option key={c} value={c}>{columnLabel(c)}</option>)}
            </select>
          </div>
          {values.length > 0 && (
            <>
              <p className="mb-1 text-xs text-zinc-500">A qué categoría del gestor corresponde cada valor (para mover las tareas enlazadas en los dos sentidos):</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {values.map((v) => (
                  <label key={v} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={v}>{v}</span>
                    <select className={`${inputClass} w-36 py-0.5 text-xs`} value={categoryOfValue(v, effective)} aria-label={`Categoría de ${v}`}
                      onChange={(e) => setConfig({ statusColumn, map: { ...config.map, [v]: e.target.value as StateCategory } })}>
                      {LIST_CATEGORIES.map((c) => <option key={c.category} value={c.category}>{c.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">Al mover una tarea en el gestor, se pone en la lista el primer valor de su categoría (en este orden).</p>
            </>
          )}
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
        <span className="text-zinc-500">Añadir al gestor en</span>
        <select className={`${inputClass} w-48 py-1`} value={target ?? ''} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto de destino">
          <option value="">Bandeja (sin proyecto)</option>
          <ProjectOptions />
        </select>
        {toAdd.length > 0 && <ActionButton icon={<Plus className="size-4" />} onClick={() => void add(toAdd)}>Añadir los {toAdd.length} que se ven</ActionButton>}
        {(data?.pending.length ?? 0) > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-300">{data!.pending.length} {data!.pending.length === 1 ? 'cambio esperando' : 'cambios esperando'} a aplicarse en la lista</span>
        )}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {!data && !error && <p className="text-sm text-zinc-500">Leyendo la lista…</p>}
      {data && visible.length === 0 && <p className="text-sm text-zinc-500">No hay elementos con estos filtros.</p>}

      {visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] font-semibold tracking-wide text-zinc-400 uppercase dark:border-zinc-700">
                <th className="w-14 py-1 pr-2">ID</th>
                <th className="py-1 pr-2">Título</th>
                {statusColumn && <th className="w-44 py-1 pr-2">{columnLabel(statusColumn)}</th>}
                {extraColumns.map((c) => <th key={c} className="hidden max-w-40 py-1 pr-2 lg:table-cell">{columnLabel(c)}</th>)}
                <th className="w-24 py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((it) => {
                const task = linked.get(listKey(it.id));
                const value = statusColumn ? it.fields[statusColumn] ?? '' : '';
                const category = itemCategory(it, effective);
                return (
                  <tr key={it.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <td className="py-1.5 pr-2 font-mono text-xs text-zinc-500">{it.id}</td>
                    <td className="py-1.5 pr-2">
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-indigo-600 hover:underline">{it.title}<ExternalLink className="size-3 text-zinc-400" /></a>
                      ) : it.title}
                    </td>
                    {statusColumn && (
                      <td className="py-1.5 pr-2">
                        <select value={value} disabled={busy === it.id} onChange={(e) => void changeStatus(it, e.target.value)} aria-label={`Estado de ${it.title}`}
                          className={`w-full rounded-full border-0 px-2 py-0.5 text-xs ${CATEGORY_COLOR[category] ?? CATEGORY_COLOR.todo}`}>
                          {!value && <option value="">—</option>}
                          {values.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        {pendingIds.has(it.id) && <span className="mt-0.5 block text-[11px] text-amber-600" title="Apuntado: el segundo flujo lo aplicará en la lista">pendiente de aplicar</span>}
                      </td>
                    )}
                    {extraColumns.map((c) => <td key={c} className="hidden max-w-40 truncate py-1.5 pr-2 text-xs text-zinc-500 lg:table-cell" title={it.fields[c]}>{it.fields[c]}</td>)}
                    <td className="py-1.5 text-right">
                      {task ? (
                        <button type="button" onClick={() => editTask(task)} className="rounded-md px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">
                          {task.status === 'done' ? '✓ Hecha aquí' : 'En el gestor'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void add([it])} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
                          <Plus className="size-3" />Añadir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
