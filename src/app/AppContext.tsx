import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { labelColorMap } from '../domain/colors';
import { postponeCounts } from '../domain/activity';
import { isEffectivelyArchived } from '../domain/projects';
import type { ActivityEntry, ISODate, ItemType, Label, Note, Person, Project, Release, Settings, Task } from '../domain/types';
import { useActivity, useItemTypes, useLabels, useNotes, usePeople, useProjects, useReleases, useSettings, useTasks, useToday } from '../hooks/useData';

interface AppData {
  tasks: Task[];
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
  const tasks = useTasks();
  const allProjects = useProjects(true);
  const itemTypes = useItemTypes();
  const labels = useLabels();
  const releases = useReleases();
  const notes = useNotes();
  const peopleCards = usePeople();
  const activity = useActivity();
  const settings = useSettings();
  const today = useToday();
  const [detailId, setDetailId] = useState<string | null>(null);

  const value = useMemo<AppData>(() => ({
    tasks,
    allProjects,
    // Activos: ni el proyecto ni ninguno de sus antepasados está archivado.
    projects: allProjects.filter((p) => !isEffectivelyArchived(p.id, new Map(allProjects.map((x) => [x.id, x])))),
    projectMap: new Map(allProjects.map((p) => [p.id, p])),
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
  }), [tasks, allProjects, itemTypes, releases, notes, peopleCards, activity, labels, settings, today, detailId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
