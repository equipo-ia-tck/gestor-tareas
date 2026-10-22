import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { repo } from '../data/services';
import { labelColorMap } from '../domain/colors';
import { postponeCounts } from '../domain/activity';
import { isEffectivelyArchived } from '../domain/projects';
import { knownPeople } from '../domain/selectors';
import { matchesSpace, spaceOf, spaceOfProject, type Space, type SpaceFilter } from '../domain/spaces';
import { useSync } from '../data/sync';
import { usePersistentState } from '../hooks/usePersistentState';
import type { ActivityEntry, ISODate, ItemType, Label, Note, Person, Project, Release, Settings, Task } from '../domain/types';
import { useActivity, useItemTypes, useLabels, useNotes, usePeople, useProjects, useReleases, useSettings, useTasks, useToday } from '../hooks/useData';

interface AppData {
  /** Tareas del espacio elegido en el filtro (todas con "Todo"). */
  tasks: Task[];
  /** Espacios de los que soy miembro y el filtro actual ("all", "personal" o el id de un espacio). */
  spaces: Space[];
  spaceFilter: SpaceFilter;
  setSpaceFilter: (f: SpaceFilter) => void;
  /** Personas para sugerir al mencionar: las de las tareas y todas las cuentas del equipo. */
  mentionables: string[];
  /** Todos los proyectos, incluidos los archivados (para resolver nombres). */
  allProjects: Project[];
  /** Proyectos activos. */
  projects: Project[];
  projectMap: Map<string, Project>;
  itemTypes: ItemType[];
  releases: Release[];
  releaseMap: Map<string, Release>;
  notes: Note[];
  /** Fichas de persona guardadas (rol, notas). */
  peopleCards: Person[];
  activity: ActivityEntry[];
  /** Veces que se ha pospuesto cada tarea. */
  postponed: Map<string, number>;
  labels: Label[];
  /** nameKey(etiqueta) → color personalizado. */
  labelColors: Map<string, string>;
  settings: Settings;
  today: ISODate;
  /** Tarea abierta en el panel de detalle. */
  detailId: string | null;
  /** Abre la tarea en el panel de detalle lateral. */
  editTask: (task: Task) => void;
  closeDetail: () => void;
}

const Ctx = createContext<AppData | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fuera de AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const allTasks = useTasks();
  const allProjects = useProjects(true);
  const { spaces, team, user } = useSync();
  // El filtro es de cada cuenta (en un navegador compartido no se hereda el de la anterior).
  const [storedFilter, setSpaceFilter] = usePersistentState<SpaceFilter>(`space-filter:${user?.id ?? ''}`, 'all');
  // Si dejo de estar en el espacio filtrado, se vuelve a "Todo".
  const spaceFilter = storedFilter === 'all' || storedFilter === 'personal' || spaces.some((s) => s.id === storedFilter) ? storedFilter : 'all';
  const allNotes = useNotes();
  // Con un espacio elegido en el filtro, los proyectos nuevos (desde cualquier sitio) van a ese espacio.
  useEffect(() => { repo.defaultSpaceId = spaceFilter === 'all' || spaceFilter === 'personal' ? null : spaceFilter; }, [spaceFilter]);
  const itemTypes = useItemTypes();
  const labels = useLabels();
  const releases = useReleases();
  const peopleCards = usePeople();
  const activity = useActivity();
  const settings = useSettings();
  const today = useToday();
  const [detailId, setDetailId] = useState<string | null>(null);

  const value = useMemo<AppData>(() => {
    const projectMap = new Map(allProjects.map((p) => [p.id, p]));
    const tasks = allTasks.filter((t) => matchesSpace(spaceOf(t, projectMap), spaceFilter));
    const notes = allNotes.filter((n) => matchesSpace(spaceOf(n, projectMap), spaceFilter));
    return {
    tasks,
    spaces,
    spaceFilter,
    setSpaceFilter,
    mentionables: [...new Set([...knownPeople(allTasks), ...team.map((u) => u.name)])],
    allProjects,
    // Activos (ni el proyecto ni sus antepasados archivados) y del espacio elegido.
    projects: allProjects.filter((p) => !isEffectivelyArchived(p.id, projectMap) && matchesSpace(spaceOfProject(p.id, projectMap), spaceFilter)),
    projectMap,
    itemTypes,
    releases,
    releaseMap: new Map(releases.map((r) => [r.id, r])),
    notes,
    peopleCards,
    activity,
    postponed: postponeCounts(activity),
    labels,
    labelColors: labelColorMap(labels),
    settings,
    today,
    detailId: detailId && tasks.some((t) => t.id === detailId) ? detailId : null,
    editTask: (t) => setDetailId(t.id),
    closeDetail: () => setDetailId(null),
  };
  }, [allTasks, allProjects, allNotes, spaces, team, spaceFilter, setSpaceFilter, itemTypes, releases, peopleCards, activity, labels, settings, today, detailId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
