import { navigate, type Route } from '../../app/router';
import { downloadBackup } from '../../data/backup';
import { repo } from '../../data/services';
import { addDays } from '../../domain/dates';
import { overdueTasks, peopleIndex } from '../../domain/selectors';
import type { ISODate, Project, Task } from '../../domain/types';

export interface Command {
  id: string;
  title: string;
  section: string;
  /** Palabras extra para la búsqueda difusa. */
  keywords?: string;
  shortcut?: string;
  /** Si existe, el comando pide un texto antes de ejecutarse. */
  input?: { placeholder: string; run: (value: string) => void | Promise<void> };
  run?: () => void | Promise<void>;
}

export interface CommandEnv {
  tasks: Task[];
  projects: Project[];
  today: ISODate;
  openCapture: () => void;
  openShortcuts: () => void;
  toast: (message: string, action?: { label: string; run: () => void | Promise<void> }) => void;
}

/** Cambia la fecha de varias tareas con un único "Deshacer". */
async function moveTasks(env: CommandEnv, tasks: Task[], to: ISODate | null, label: string) {
  if (tasks.length === 0) return env.toast('No hay tareas atrasadas');
  const previous = tasks.map((t) => [t.id, t.due_date] as const);
  for (const t of tasks) await repo.updateTask(t.id, { due_date: to });
  env.toast(`${tasks.length} ${tasks.length === 1 ? 'tarea movida' : 'tareas movidas'} a ${label}`, {
    label: 'Deshacer',
    run: async () => { for (const [id, due] of previous) await repo.updateTask(id, { due_date: due }); },
  });
}

const go = (r: Route) => () => navigate(r);

export function buildCommands(env: CommandEnv): Command[] {
  const overdue = overdueTasks(env.tasks, env.today);
  return [
    { id: 'new-task', section: 'Crear', title: 'Nueva tarea', shortcut: '⌘K', keywords: 'añadir capturar', run: env.openCapture },
    {
      id: 'new-project', section: 'Crear', title: 'Nuevo proyecto', keywords: 'crear',
      input: {
        placeholder: 'Nombre del proyecto',
        run: async (name) => {
          if (!name.trim()) return;
          const p = await repo.createProject(name);
          navigate({ view: 'project', id: p.id });
        },
      },
    },
    { id: 'move-overdue-today', section: 'Tareas', title: 'Mover vencidas a hoy', keywords: 'atrasadas', run: () => moveTasks(env, overdue, env.today, 'hoy') },
    { id: 'move-overdue-tomorrow', section: 'Tareas', title: 'Mover vencidas a mañana', keywords: 'atrasadas', run: () => moveTasks(env, overdue, addDays(env.today, 1), 'mañana') },
    { id: 'move-overdue-none', section: 'Tareas', title: 'Quitar fecha a las vencidas', keywords: 'atrasadas sin fecha', run: () => moveTasks(env, overdue, null, 'sin fecha') },

    { id: 'go-today', section: 'Ir a', title: 'Ir a Hoy', shortcut: 'G H', run: go({ view: 'today' }) },
    { id: 'go-week', section: 'Ir a', title: 'Ir a Próximos 7 días', shortcut: 'G S', keywords: 'semana', run: go({ view: 'week' }) },
    { id: 'go-inbox', section: 'Ir a', title: 'Ir a Bandeja', shortcut: 'G B', keywords: 'entrada', run: go({ view: 'inbox' }) },
    { id: 'go-projects', section: 'Ir a', title: 'Ir a Proyectos', shortcut: 'G P', run: go({ view: 'projects' }) },
    { id: 'go-people', section: 'Ir a', title: 'Ir a Personas', shortcut: 'G E', run: go({ view: 'people' }) },
    { id: 'go-settings', section: 'Ir a', title: 'Ir a Copias y ajustes', shortcut: 'G A', keywords: 'backup configuración', run: go({ view: 'settings' }) },
    ...env.projects.map((p): Command => ({
      id: `go-project-${p.id}`, section: 'Proyectos', title: `Ir a proyecto ${p.name}`, keywords: '#', run: go({ view: 'project', id: p.id }),
    })),
    ...peopleIndex(env.tasks).map(({ name }): Command => ({
      id: `go-person-${name}`, section: 'Personas', title: `Ir a persona @${name}`, run: go({ view: 'person', name }),
    })),

    { id: 'export', section: 'Datos', title: 'Exportar copia', keywords: 'backup json descargar guardar', run: () => downloadBackup(repo) },
    { id: 'shortcuts', section: 'Ayuda', title: 'Atajos de teclado', shortcut: '?', keywords: 'ayuda chuleta', run: env.openShortcuts },
  ];
}
