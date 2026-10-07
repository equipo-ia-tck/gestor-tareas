import { useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Rocket, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { QuickAdd } from '../../components/QuickAdd';
import { Section, TaskList } from '../../components/TaskList';
import { MenuItem, Popover } from '../../components/ui/Popover';
import { TypeBadge } from '../../components/ui/Badges';
import { inputClass } from '../../components/ui/styles';
import { repo } from '../../data/services';
import { formatDay } from '../../domain/dates';
import { groupReleases, releaseCountdown, releaseProgress } from '../../domain/releases';
import { sortTasks } from '../../domain/selectors';
import type { Release, ReleaseStatus } from '../../domain/types';
import { ViewHeader } from '../views/ViewHeader';

const STATUS: Record<ReleaseStatus, { label: string; cls: string }> = {
  planned: { label: 'Planificada', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  released: { label: 'Publicada', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  cancelled: { label: 'Cancelada', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' },
};

/** "Cuándo sale todo": entregas con fecha y el estado de sus US/TS. */
export function ReleasesView() {
  const { releases, projects, today } = useApp();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const { upcoming, overdue, finished } = groupReleases(releases, today);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await repo.createRelease(name, { date: date || null, project_id: projectId || null });
    setName('');
    setDate('');
  }

  return (
    <>
      <ViewHeader title="Releases" subtitle="Qué sale, cuándo y en qué estado está cada US y TS" />
      <form onSubmit={create} className="mb-6 flex flex-wrap gap-2">
        <input className={`${inputClass} w-48 flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva release (p. ej. R2.3)" />
        <input type="date" className={`${inputClass} w-40`} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" />
        <select className={`${inputClass} w-44`} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
          <option value="">Sin proyecto</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">Crear</button>
      </form>

      {releases.length === 0 && (
        <p className="text-sm text-zinc-500">
          Aún no hay releases. Créalas aquí o al capturar con <code>^nombre</code> (p. ej. «US-1234 login SSO ^R2.3»).
        </p>
      )}
      {overdue.length > 0 && (
        <Section title={`Pasada la fecha sin publicar · ${overdue.length}`}>
          <div className="space-y-3">{overdue.map((r) => <ReleaseCard key={r.id} release={r} late />)}</div>
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title={`Próximas · ${upcoming.length}`}>
          <div className="space-y-3">{upcoming.map((r) => <ReleaseCard key={r.id} release={r} />)}</div>
        </Section>
      )}
      {finished.length > 0 && (
        <Section title={`Publicadas o canceladas · ${finished.length}`} collapsible defaultOpen={false}>
          <div className="space-y-3">{finished.map((r) => <ReleaseCard key={r.id} release={r} />)}</div>
        </Section>
      )}
    </>
  );
}

function ReleaseCard({ release, late }: { release: Release; late?: boolean }) {
  const { tasks, itemTypes, projectMap, today, editTask } = useApp();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(release.name);
  const progress = releaseProgress(release.id, tasks, itemTypes);
  const project = release.project_id ? projectMap.get(release.project_id) : undefined;
  const items = sortTasks(tasks.filter((t) => t.release_id === release.id && t.status !== 'archived'));
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <article className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${late ? 'border-amber-300 dark:border-amber-800' : 'border-zinc-200 dark:border-zinc-800'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <Rocket className="size-4 text-lime-600" />
        {renaming ? (
          <input autoFocus className={`${inputClass} w-48`} value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => { setRenaming(false); if (name.trim() && name !== release.name) void repo.updateRelease(release.id, { name: name.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(release.name); setRenaming(false); } }} />
        ) : (
          <h3 className="cursor-text text-base font-semibold" onDoubleClick={() => setRenaming(true)} title="Doble clic para renombrar">{release.name}</h3>
        )}
        <Popover trigger={(toggle) => (
          <button type="button" onClick={toggle} className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[release.status].cls}`}>{STATUS[release.status].label}</button>
        )}>
          {(close) => (Object.keys(STATUS) as ReleaseStatus[]).map((s) => (
            <MenuItem key={s} active={s === release.status} onClick={() => { close(); void repo.updateRelease(release.id, { status: s }); }}>{STATUS[s].label}</MenuItem>
          ))}
        </Popover>
        {project && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><span className="size-2 rounded-sm" style={{ background: project.color }} />{project.name}</span>}
        <span className="flex-1" />
        <input type="date" value={release.date ?? ''} onChange={(e) => void repo.updateRelease(release.id, { date: e.target.value || null })}
          className="rounded-md border border-transparent bg-transparent px-1 text-sm text-zinc-600 hover:border-zinc-200 dark:text-zinc-300 dark:hover:border-zinc-700" aria-label="Fecha de la release" />
        <span className={`text-xs font-medium ${late ? 'text-amber-600' : 'text-zinc-500'}`}>{release.status === 'planned' ? releaseCountdown(release, today) : release.date ? formatDay(release.date, today) : ''}</span>
        <button type="button" title="Eliminar release" onClick={() => void repo.deleteRelease(release.id)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"><Trash2 className="size-4" /></button>
      </header>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-zinc-500">{progress.done}/{progress.total} terminadas{progress.blocked ? ` · ${progress.blocked} bloqueadas` : ''}</span>
      </div>

      {progress.byType.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {progress.byType.map(({ type, states, total }) => (
            <div key={type.id} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate">{type.short ? <TypeBadge type={type} /> : null} {type.name}</span>
              <div className="flex h-3 flex-1 overflow-hidden rounded">
                {states.map(({ state, count }) => (
                  <div key={state.id} title={`${state.name}: ${count}`} style={{ width: `${(count / total) * 100}%`, background: state.color }} />
                ))}
              </div>
              <span className="flex flex-wrap gap-x-2 text-zinc-500">
                {states.map(({ state, count }) => <span key={state.id}><span style={{ color: state.color }}>●</span> {state.name} {count}</span>)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-3 flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {items.length ? `Ver ${items.length} elemento${items.length === 1 ? '' : 's'}` : 'Añadir elementos'}
      </button>
      {open && (
        <div className="mt-2">
          <QuickAdd defaults={{ release_id: release.id, project_id: release.project_id }} placeholder={`Añadir a ${release.name}: US-1234 título…`} />
          <TaskList tasks={items} today={today} projects={projectMap} onEdit={editTask} />
        </div>
      )}
    </article>
  );
}
