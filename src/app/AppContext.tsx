import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ISODate, Project, Settings, Task } from '../domain/types';
import { useProjects, useSettings, useTasks, useToday } from '../hooks/useData';
import { TaskEditor } from '../components/TaskEditor';

interface AppData {
  tasks: Task[];
  /** Todos los proyectos, incluidos los archivados (para resolver nombres). */
  allProjects: Project[];
  /** Proyectos activos. */
  projects: Project[];
  projectMap: Map<string, Project>;
  settings: Settings;
  today: ISODate;
  editTask: (task: Task) => void;
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
  const settings = useSettings();
  const today = useToday();
  const [editingId, setEditingId] = useState<string | null>(null);

  const value = useMemo<AppData>(() => ({
    tasks,
    allProjects,
    projects: allProjects.filter((p) => !p.archived),
    projectMap: new Map(allProjects.map((p) => [p.id, p])),
    settings,
    today,
    editTask: (t) => setEditingId(t.id),
  }), [tasks, allProjects, settings, today]);

  const editing = editingId ? tasks.find((t) => t.id === editingId) : undefined;

  return (
    <Ctx.Provider value={value}>
      {children}
      {editing && (
        <TaskEditor key={editing.id} task={editing} projects={allProjects} onClose={() => setEditingId(null)} />
      )}
    </Ctx.Provider>
  );
}
