import { DEFAULT_TYPE_ID, type ISODate, type NewTask, type Task } from './types';

/** Conector de Confluence Data Center (`servidor/confluence.ts`): estado de la conexión de cada usuario. */
export interface ConfluenceStatus {
  connected: boolean;
  baseUrl: string;
  /** Últimos caracteres del token, para reconocerlo sin mostrarlo. */
  tokenHint: string | null;
  user: string | null;
}

/** Tarea de Confluence (las casillas de las páginas) asignada a la persona, con su página. */
export interface ConfluenceTask {
  /** ID global de la tarea en Confluence. */
  id: string;
  text: string;
  done: boolean;
  dueDate: ISODate | null;
  createdAt: string | null;
  pageId: string | null;
  pageTitle: string | null;
  space: string | null;
  /** Enlace a la página (Confluence no tiene enlace a la tarea suelta). */
  url: string | null;
}

/** Dirección por defecto: el Confluence de CaixaBank (solo accesible desde su red). */
export const DEFAULT_CONFLUENCE_URL = 'https://confluence.cloud.lacaixa.es/confluence';

/** ID externo con el que se reconoce en el gestor una tarea traída de Confluence. */
export const confluenceKey = (task: Pick<ConfluenceTask, 'id'>) => `CF-${task.id}`;

/** Tarea del gestor enlazada con esa tarea de Confluence (por su ID externo), si la hay. */
export function linkedConfluenceTask(task: ConfluenceTask, tasks: Task[]): Task | undefined {
  const key = confluenceKey(task);
  return tasks.find((t) => !t.deleted_at && t.external_id === key);
}

/** Tarea nueva del gestor a partir de una de Confluence: texto, fecha, enlace a la página y de dónde sale. */
export function taskFromConfluence(task: ConfluenceTask, projectId: string | null): NewTask {
  const firstLine = task.text.split('\n').map((l) => l.trim()).find(Boolean) ?? task.text;
  return {
    title: firstLine.length > 200 ? `${firstLine.slice(0, 199)}…` : firstLine,
    external_id: confluenceKey(task),
    url: task.url,
    type_id: DEFAULT_TYPE_ID,
    project_id: projectId,
    due_date: task.dueDate,
    notes: [
      task.pageTitle && `De Confluence: ${task.pageTitle}${task.space ? ` (${task.space})` : ''}`,
      task.text.trim() !== firstLine && task.text.trim(),
    ].filter(Boolean).join('\n\n'),
    raw_input: confluenceKey(task),
  };
}
