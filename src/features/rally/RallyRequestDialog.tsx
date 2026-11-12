import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import type { ISODate } from '../../domain/types';
import { parseDateText } from '../../parser/fields';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { repo } from '../../data/services';
import type { RequestTemplate } from '../../domain/types';
import type { RallyPick, RallyProject, RallyRef } from '../../domain/rally';
import { parseRallyRequest, requestTemplates, type RallyRequest } from '../../domain/rallyRequest';
import { fold } from '../../domain/text';
import { PARENT, type RallyPrefill } from './RallyCreateForm';
import { Dialog } from './RallyPickers';
import { rallyApi } from './rallyApi';

const KIND_LABEL = { FE: 'Feature', US: 'User Story', DE: 'Defect', DS: 'Defect Suite', TS: 'Test Set', TA: 'Task' } as const;

const key = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');
/** El más parecido: igual, empieza por o contiene (el de nombre más corto, que suele ser el exacto). */
function best<T>(list: T[], name: string, nameOf: (t: T) => string): T | undefined {
  const k = key(name);
  if (!k) return undefined;
  const score = (t: T) => { const n = key(nameOf(t)); return n === k ? 0 : n.startsWith(k) ? 1 : n.includes(k) ? 2 : k.includes(n) && n.length > 3 ? 3 : 9; };
  return list.map((t) => ({ t, s: score(t), l: nameOf(t).length })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.l - b.l)[0]?.t;
}

async function findUser(name: string): Promise<RallyRef | undefined> {
  return best(await rallyApi.searchUsers(name), name, (u) => u.name);
}
async function findTag(name: string): Promise<RallyRef | undefined> {
  return best((await rallyApi.tags(name, 1)).items, name, (t) => t.name);
}
async function findItem(id: string, types: string[]): Promise<RallyPick | undefined> {
  const r = await rallyApi.pick({ types, q: id, project: '', release: '', page: 1 });
  return r.items.find((x) => x.id.toUpperCase() === id) ?? r.items[0];
}

/** Busca en Rally lo que la frase nombra (personas, proyecto, etiquetas, padre) y prepara el formulario. */
export async function resolveRequest(req: RallyRequest, source: string, projects: RallyProject[], fallbackProject: string | null, today: ISODate): Promise<RallyPrefill> {
  const warnings = [...req.unknown.map((u) => `No entendido: «${u}»`)];
  if (!req.kind) warnings.push('No se dice el tipo: se deja el que estaba (cámbialo arriba si hace falta).');
  if (!req.name) warnings.push('Falta el nombre.');
  const project = req.project ? best(projects, req.project, (p) => p.name) : undefined;
  if (req.project && !project) warnings.push(`Proyecto «${req.project}» no encontrado entre tus proyectos de Rally.`);
  const person = async (name: string | undefined, label: string) => {
    if (!name) return undefined;
    if (name === '@me') return '@me' as const;
    try {
      const u = await findUser(name);
      if (!u) warnings.push(`${label} «${name}» no encontrado en Rally.`);
      return u;
    } catch (e) { warnings.push(`${label} «${name}»: ${(e as Error).message}`); return undefined; }
  };
  const kind = req.kind ?? undefined;
  const parentTypes = (kind && PARENT[kind]?.types.map((t) => t.key)) ?? ['US', 'DE', 'PI'];
  const [owner, assignee, tags, parent, feature] = await Promise.all([
    person(req.owner, 'Owner'),
    kind === 'FE' ? Promise.resolve(undefined) : person(req.assignee, 'Assignee'),
    Promise.all(req.tags.map(async (t) => {
      try { const f = await findTag(t); if (!f) warnings.push(`Etiqueta «${t}» no existe en Rally.`); return f; } catch { warnings.push(`Etiqueta «${t}»: no se ha podido buscar.`); return undefined; }
    })),
    req.parentId ? findItem(req.parentId, parentTypes).catch(() => undefined) : Promise.resolve(undefined),
    req.featureId ? findItem(req.featureId, ['F']).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  if (kind === 'FE' && req.assignee) warnings.push('Las features no tienen Assignee: se ignora.');
  if (req.parentId && !parent) warnings.push(`Padre ${req.parentId} no encontrado en Rally.`);
  if (req.featureId && !feature) warnings.push(`Feature ${req.featureId} no encontrada en Rally.`);
  // Fechas planificadas con el mismo lector de fechas que la captura («1 de diciembre», «lunes», «2026-12-20»).
  const date = (raw: string | undefined, label: string) => {
    if (!raw) return undefined;
    const r = parseDateText(raw, today);
    if (r.ok && r.value) return r.value;
    warnings.push(`${label} «${raw}»: no es una fecha que entienda.`);
    return undefined;
  };
  const plannedStart = date(req.plannedStart, 'Planned Start Date');
  const plannedEnd = date(req.plannedEnd, 'Planned End Date');
  if (kind && kind !== 'FE' && (req.plannedStart || req.plannedEnd)) warnings.push('Las fechas planificadas solo son de las features.');
  const defect = Object.fromEntries(([['Severity', req.severity], ['Priority', req.priority], ['Environment', req.environment]] as const)
    .filter((e): e is [typeof e[0], string] => !!e[1]));
  return {
    source, kind, name: req.name || undefined, projectId: project?.id ?? fallbackProject ?? undefined,
    owner, assignee, state: req.state, release: req.release, iteration: req.iteration,
    tags: tags.filter((t): t is RallyRef => !!t), parent, feature, estimate: req.estimate,
    preliminaryEstimate: req.preliminaryEstimate, plannedStart, plannedEnd, milestones: req.milestones, description: req.description, notes: req.notes,
    color: req.color, ready: req.ready, blocked: req.blocked, blockedReason: req.blockedReason, expedite: req.expedite,
    defect: Object.keys(defect).length ? defect : undefined, warnings,
  };
}

/**
 * «Crear con petición»: se escribe lo que se quiere crear en una frase y el intérprete propio (`parseRallyRequest`, sin IA
 * ni servicios externos) lo lee. Se ve al momento qué ha entendido; «Rellenar formulario» busca en Rally las personas,
 * etiquetas y el padre, y abre «Nuevo elemento» relleno para revisarlo y crearlo a mano.
 */
export function RallyRequestDialog({ projects, defaultProjectId, onReady, onClose }: {
  projects: RallyProject[];
  defaultProjectId: string | null;
  onReady: (prefill: RallyPrefill) => void;
  onClose: () => void;
}) {
  const { today, settings } = useApp();
  const templates = requestTemplates(settings.rally_templates);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = text.trim() ? parseRallyRequest(text) : null;

  const go = async () => {
    if (!req || busy) return;
    setBusy(true);
    setError(null);
    try {
      onReady(await resolveRequest(req, text.trim(), projects, defaultProjectId, today));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const rows: [string, string | undefined][] = req ? [
    ['Tipo', req.kind ? KIND_LABEL[req.kind] : undefined],
    ['Nombre', req.name || undefined],
    ['Owner', req.owner === '@me' ? 'Yo' : req.owner],
    ['Assignee', req.assignee === '@me' ? 'Yo' : req.assignee],
    ['Proyecto', req.project],
    ['Estado', req.state],
    ['Release', req.release],
    ['Iteración', req.iteration],
    ['Etiquetas', req.tags.join(', ') || undefined],
    ['Padre', req.parentId],
    ['Feature', req.featureId],
    ['Estimación', req.estimate?.toString()],
    ['Preliminary Estimate', req.preliminaryEstimate],
    ['Planned Start', req.plannedStart],
    ['Planned End', req.plannedEnd],
    ['Milestones', req.milestones.join(', ') || undefined],
    ['Ready', req.ready ? 'Sí' : undefined],
    ['Blocked', req.blocked ? (req.blockedReason ? `Sí · ${req.blockedReason}` : 'Sí') : undefined],
    ['Expedite', req.expedite ? 'Sí' : undefined],
    ['Severidad', req.severity],
    ['Prioridad', req.priority],
    ['Entorno', req.environment],
    ['Descripción', req.description],
    ['Notas', req.notes],
  ] : [];
  const understood = rows.filter(([, v]) => v);

  if (editing) return <TemplatesEditor initial={templates} current={text} onClose={() => setEditing(false)} />;

  return (
    <Dialog title="Crear con petición" width="max-w-xl" onClose={onClose}>
      <div className="min-h-0 space-y-3 overflow-y-auto">
        <p className="text-xs text-zinc-500">Escribe qué quieres crear. Se interpreta aquí mismo (sin IA) y se abre el formulario relleno para que lo revises.</p>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Petición"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go(); } }}
          placeholder="crear feature Login SSO con owner Matías Rodríguez, asignado a Marc Crespo, en defined"
          className="w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
        <details open={!req} className="group">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-500 select-none">
            Plantillas (pulsa una para usarla y cambia lo que haga falta)
            <button type="button" onClick={(e) => { e.preventDefault(); setEditing(true); }}
              className="ml-2 inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 font-normal text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <Pencil className="size-3" />Modificar plantillas
            </button>
          </summary>
          <div className="mt-1 space-y-1">
            {templates.length === 0 && <p className="text-xs text-zinc-400">No tienes plantillas. Añádelas con «Modificar plantillas».</p>}
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => setText(t.text)}
                className="flex w-full items-start gap-2 rounded-md bg-zinc-100 px-2 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                <span className="w-20 shrink-0 font-semibold text-[#1e64c8] dark:text-blue-300">{t.label}</span><span>{t.text}</span>
              </button>
            ))}
            <p className="pt-1 text-[11px] text-zinc-400">
              Entiende: el tipo (feature, US, defecto, defect suite, test set, tarea), nombre (mejor entre comillas), owner, asignado a, proyecto,
              estado o columna (new, defined, en curso, need review, completed, accepted), release, sprint, etiquetas, padre (US123, PI45) y feature
              (F45), puntos, preliminary estimate o talla (XS, S, M…), fecha de inicio y fecha fin, milestones, ready, bloqueada porque…, urgente,
              color, severidad, prioridad, entorno, descripción y notas (estas dos, mejor al final). «yo» eres tú.
            </p>
          </div>
        </details>
        {req && (
          <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
            <p className="mb-1 text-xs font-semibold text-zinc-500">Lo que he entendido</p>
            {understood.length ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {understood.map(([k, v]) => <div key={k} className="contents"><dt className="text-zinc-500">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
              </dl>
            ) : <p className="text-sm text-zinc-400">Nada todavía.</p>}
            {req.unknown.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Sin entender: {req.unknown.map((u) => `«${u}»`).join(', ')}</p>}
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
        <button type="button" disabled={!req || busy} onClick={() => void go()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1e64c8] px-3 py-1.5 font-medium text-white hover:bg-[#1a56ad] disabled:opacity-50">
          <Wand2 className="size-4" />{busy ? 'Buscando en Rally…' : 'Rellenar formulario'}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * «Modificar plantillas»: las de la persona (en sus ajustes, así le siguen en cualquier navegador y entran en las copias).
 * Nombre y frase de cada una, orden con flechas o arrastrando, añadir (también la petición que se estaba escribiendo),
 * eliminar y volver a las de serie. Debajo de cada frase se ve qué entiende el intérprete, para no guardar una que no lee.
 */
function TemplatesEditor({ initial, current, onClose }: { initial: RequestTemplate[]; current: string; onClose: () => void }) {
  const [list, setList] = useState(initial);
  const [dragged, setDragged] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = (i: number, p: Partial<RequestTemplate>) => setList((l) => l.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const move = (from: number, to: number) => setList((l) => {
    if (to < 0 || to >= l.length || from === to) return l;
    const next = [...l];
    const [t] = next.splice(from, 1);
    next.splice(to, 0, t);
    return next;
  });
  const add = (text = '') => setList((l) => [...l, { id: crypto.randomUUID(), label: '', text }]);
  const save = async () => {
    setSaving(true);
    const clean = list.filter((t) => t.text.trim()).map((t) => ({ ...t, label: t.label.trim() || kindLabel(t.text), text: t.text.trim() }));
    await repo.updateSettings({ rally_templates: clean });
    onClose();
  };
  const reset = () => setList(requestTemplates(null));

  return (
    <Dialog title="Modificar plantillas" width="max-w-2xl" onClose={onClose}>
      <p className="mb-2 text-xs text-zinc-500">Son tuyas: cada persona tiene las suyas. Arrastra (o usa las flechas) para cambiar el orden en que salen.</p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {list.map((t, i) => {
          const r = t.text.trim() ? parseRallyRequest(t.text) : null;
          return (
            <div key={t.id} data-template onDragOver={(e) => { if (dragged !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragged !== null) move(dragged, i); setDragged(null); }}
              className={`flex gap-2 rounded-md border p-2 ${dragged === i ? 'border-indigo-400 opacity-50' : 'border-zinc-200 dark:border-zinc-700'}`}>
              <div className="flex flex-col items-center gap-0.5 pt-1 text-zinc-400">
                {/* Solo se arrastra por el asa: así se puede seleccionar texto en los campos. */}
                <span draggable title="Arrastra para cambiar el orden" className="cursor-grab"
                  onDragStart={(e) => { setDragged(i); e.dataTransfer.effectAllowed = 'move'; const row = e.currentTarget.closest('[data-template]'); if (row) e.dataTransfer.setDragImage(row, 16, 16); }}
                  onDragEnd={() => setDragged(null)}>
                  <GripVertical className="size-4" aria-hidden />
                </span>
                <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Subir" className="rounded p-0.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="size-3.5" /></button>
                <button type="button" disabled={i === list.length - 1} onClick={() => move(i, i + 1)} aria-label="Bajar" className="rounded p-0.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="size-3.5" /></button>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <input value={t.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder={kindLabel(t.text) || 'Nombre de la plantilla'} aria-label="Nombre de la plantilla"
                    className="w-56 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-sm font-semibold dark:border-zinc-600 dark:bg-zinc-800" />
                  <span className="flex-1" />
                  <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Eliminar plantilla" title="Eliminar"
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><Trash2 className="size-4" /></button>
                </div>
                <textarea value={t.text} onChange={(e) => patch(i, { text: e.target.value })} rows={3} aria-label="Frase de la plantilla"
                  placeholder="crear user story &quot;Nombre&quot; con owner …, asignado a …, proyecto …, estado Defined"
                  className="w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800" />
                {r && (
                  <p className={`text-[11px] ${r.unknown.length || !r.kind ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-400'}`}>
                    {r.kind ? KIND_LABEL[r.kind] : 'Sin tipo'}{r.name ? ` · «${r.name}»` : ''}
                    {r.unknown.length > 0 && ` · sin entender: ${r.unknown.map((u) => `«${u}»`).join(', ')}`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm text-zinc-400">Sin plantillas.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => add()} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
          <Plus className="size-4" />Añadir
        </button>
        {current.trim() && (
          <button type="button" onClick={() => add(current.trim())} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
            <Plus className="size-4" />Añadir la petición escrita
          </button>
        )}
        <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <RotateCcw className="size-4" />Volver a las de serie
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
        <button type="button" disabled={saving} onClick={() => void save()}
          className="rounded-md bg-[#1e64c8] px-3 py-1.5 font-medium text-white hover:bg-[#1a56ad] disabled:opacity-50">Guardar</button>
      </div>
    </Dialog>
  );
}

/** Nombre por defecto de una plantilla: su tipo («User Story»). */
function kindLabel(text: string): string {
  const kind = text.trim() ? parseRallyRequest(text).kind : null;
  return kind ? KIND_LABEL[kind] : '';
}
