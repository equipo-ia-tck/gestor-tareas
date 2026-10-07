import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { labelColorMap } from '../domain/colors';
import type { ISODate, ItemType, Label, Project, Release, Settings, Task } from '../domain/types';
import { useItemTypes, useLabels, useProjects, useReleases, useSettings, useTasks, useToday } from '../hooks/useData';

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
  const settings = useSettings();
  const today = useToday();
  const [detailId, setDetailId] = useState<string | null>(null);

  const value = useMemo<AppData>(() => ({
    tasks,
    allProjects,
    projects: allProjects.filter((p) => !p.archived),
    projectMap: new Map(allProjects.map((p) => [p.id, p])),
    itemTypes,
    releases,
    releaseMap: new Map(releases.map((r) => [r.id, r])),
    labels,
    labelColors: labelColorMap(labels),
    settings,
    today,
    detailId: detailId && tasks.some((t) => t.id === detailId) ? detailId : null,
    editTask: (t) => setDetailId(t.id),
    closeDetail: () => setDetailId(null),
  }), [tasks, allProjects, itemTypes, releases, labels, settings, today, detailId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
