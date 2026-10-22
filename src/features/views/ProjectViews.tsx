import { useApp } from '../../app/AppContext';
import { Section, SmallButton } from '../../components/TaskList';
import { repo } from '../../data/services';
import { newNote } from '../notes/NotesView';
import { noteExcerpt, sortNotes } from '../../domain/notes';
import { formatDay } from '../../domain/dates';
import { MenuItem, Popover } from '../../components/ui/Popover';
import { canMoveUnder, flattenTree, MAX_PROJECT_DEPTH, projectTree } from '../../domain/projects';
import { spaceOfProject } from '../../domain/spaces';

/** Mover el proyecto dentro de otro (o al nivel superior). */
export function MoveProject({ id }: { id: string }) {
  const { allProjects, projectMap } = useApp();
  const project = projectMap.get(id)!;
  const options = flattenTree(projectTree(allProjects.filter((p) => !p.archived)))
    .filter((n) => n.project.id !== project.parent_id && canMoveUnder(id, n.project.id, allProjects));
  const move = (parent: string | null, label: string) =>
    void repo.batch(parent ? `Movido dentro de ${label}` : 'Movido al nivel superior', () => repo.updateProject(id, { parent_id: parent }));
  return (
    <Popover align="right" width="w-64" trigger={(toggle) => <SmallButton onClick={toggle}>Mover…</SmallButton>}>
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {project.parent_id && <MenuItem onClick={() => { close(); move(null, ''); }}><span className="text-zinc-500">↑ Nivel superior</span></MenuItem>}
          {options.map((n) => (
            <MenuItem key={n.project.id} onClick={() => { close(); move(n.project.id, n.project.name); }}>
              <span style={{ paddingLeft: `${n.depth * 0.8}rem` }} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: n.project.color }} />{n.project.name}
              </span>
            </MenuItem>
          ))}
          {!options.length && !project.parent_id && <p className="px-2 py-1 text-xs text-zinc-400">No hay otro proyecto donde quepa (máximo {MAX_PROJECT_DEPTH} niveles).</p>}
        </div>
      )}
    </Popover>
  );
}

/**
 * Espacio del proyecto: personal o uno de mis espacios (lo ven y editan todos sus miembros).
 * Los subproyectos heredan el del padre.
 */
export function ProjectSpace({ id }: { id: string }) {
  const { projectMap, spaces } = useApp();
  const project = projectMap.get(id)!;
  const current = spaceOfProject(id, projectMap);
  const space = spaces.find((s) => s.id === current);
  const label = current ? space?.name ?? 'Espacio compartido' : 'Personal';
  if (project.parent_id) {
    return <span className="px-2 text-xs text-zinc-400" title="Los subproyectos están en el espacio de su proyecto principal">{label}</span>;
  }
  const set = (spaceId: string | null, name: string) =>
    void repo.batch(spaceId ? `Proyecto en ${name}` : 'Proyecto personal', () => repo.updateProject(id, { space_id: spaceId }));
  return (
    <Popover align="right" width="w-72" trigger={(toggle) => (
      <SmallButton onClick={toggle}>
        <span className="inline-flex items-center gap-1.5">
          {space && <span className="size-2 rounded-full" style={{ background: space.color }} />}{label}
        </span>
      </SmallButton>
    )}>
      {(close) => (
        <div className="text-sm">
          <MenuItem active={!current} onClick={() => { close(); set(null, ''); }}>Personal <span className="text-xs text-zinc-400">(solo tú)</span></MenuItem>
          {spaces.map((s) => (
            <MenuItem key={s.id} active={s.id === current} onClick={() => { close(); set(s.id, s.name); }}>
              <span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}
              <span className="text-xs text-zinc-400">({s.members.length} {s.members.length === 1 ? 'persona' : 'personas'})</span>
            </MenuItem>
          ))}
          <p className="border-t border-zinc-200 px-2 py-1.5 text-xs text-zinc-500 dark:border-zinc-700">
            En un espacio, todos sus miembros ven y editan el proyecto, sus subproyectos, tareas y notas.
            {!spaces.length && ' Crea o únete a un espacio en Ajustes.'}
          </p>
        </div>
      )}
    </Popover>
  );
}

export function ProjectNotes({ projectIds, projectId }: { projectIds: Set<string>; projectId: string }) {
  const { notes, today } = useApp();
  const mine = sortNotes(notes.filter((n) => n.project_id !== null && projectIds.has(n.project_id) && !n.task_id));
  return (
    <Section
      title={`Notas y actas · ${mine.length}`}
      aside={<SmallButton onClick={() => void newNote('meeting', today, { project_id: projectId })}>+ Acta</SmallButton>}
      collapsible
      defaultOpen={mine.length > 0}
    >
      {!mine.length && <p className="px-2 py-2 text-sm text-zinc-400">Sin notas en este proyecto.</p>}
      <ul>
        {mine.slice(0, 10).map((n) => (
          <li key={n.id}><a href={`#/notes/${n.id}`} className="flex justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <span className="truncate">{n.title || 'Sin título'} <span className="text-xs text-zinc-400">{noteExcerpt(n)}</span></span>
            <span className="shrink-0 text-xs text-zinc-400">{formatDay(n.date, today)}</span>
          </a></li>
        ))}
      </ul>
    </Section>
  );
}
