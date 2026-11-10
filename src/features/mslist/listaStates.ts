import { repo } from '../../data/services';
import type { HistoryEntry, HistoryEvent } from '../../data/repository';
import { LIST_CATEGORIES, listMoves, listPushes, statusValues, valueForCategory } from '../../domain/msList';
import type { MsListItem } from '../../domain/msListParse';
import { listaApi, loadListaConfig } from './listaApi';

let running = false;
/** Mientras se aplican cambios que vienen de la lista, el historial no los vuelve a mandar. */
let applying = false;
/** Entradas que vinieron de la lista: deshacerlas solo cambia el gestor. */
const fromList = new WeakSet<HistoryEntry>();
/** Últimos elementos leídos (para saber qué valores tiene la columna de estado al escribir). */
let lastItems: MsListItem[] = [];

/**
 * Pone cada tarea enlazada en la categoría que tiene su elemento en la lista (la lista manda), en un solo «Deshacer».
 * Con `items` usa esos (los que acaba de cargar la pantalla); sin ellos, los pide al servidor. Devuelve cuántas mueve.
 */
export async function applyListStates(items?: MsListItem[]): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const config = loadListaConfig();
    if (!config.statusColumn) return 0;
    const list = items ?? (await listaApi.items()).items;
    lastItems = list;
    const [tasks, types] = await Promise.all([repo.listTasks(), repo.listItemTypes()]);
    const moves = listMoves(tasks, list, config, types);
    if (!moves.length) return 0;
    applying = true;
    try {
      await repo.batch(moves.length === 1 ? `Movida a ${moves[0].stateName} como en la lista` : `${moves.length} tareas movidas como en la lista`, async () => {
        for (const m of moves) await repo.setState(m.task.id, m.stateId);
      });
    } finally {
      applying = false;
    }
    return moves.length;
  } finally {
    running = false;
  }
}

/**
 * Lleva a la lista los cambios de categoría hechos en el gestor: apunta el valor nuevo de la columna de estado y el
 * segundo flujo lo aplica (tarda unos minutos). `notify` recibe el resultado de cada elemento.
 */
export async function pushToList(event: HistoryEvent, notify: (message: string) => void) {
  if (applying) {
    if (event.type === 'push') fromList.add(event.entry);
    return;
  }
  if (fromList.has(event.entry)) return;
  const pushes = listPushes(event.entry.changes, event.type === 'undo', await repo.listItemTypes());
  if (!pushes.length) return;
  const config = loadListaConfig();
  if (!config.statusColumn) return;
  if (!lastItems.length) lastItems = (await listaApi.items().catch(() => null))?.items ?? [];
  const values = statusValues(lastItems, config.statusColumn);
  await Promise.all(pushes.map(async ({ id, category }) => {
    const valor = valueForCategory(category, values, config);
    const label = LIST_CATEGORIES.find((c) => c.category === (category === 'accepted' ? 'done' : category))?.label ?? category;
    if (!valor) {
      notify(`El elemento ${id} no se ha cambiado en la lista: ningún valor de «${config.statusColumn}» corresponde a ${label}.`);
      return;
    }
    try {
      await listaApi.change(id, config.statusColumn!, valor);
      notify(`Elemento ${id}: «${valor}» se aplicará en la lista en unos minutos`);
    } catch (e) {
      if (!/Vincula/.test((e as Error).message)) notify(`No se ha podido apuntar el cambio del elemento ${id}: ${(e as Error).message}`);
    }
  }));
}
