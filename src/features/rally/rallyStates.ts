import { repo } from '../../data/services';
import type { HistoryEntry, HistoryEvent } from '../../data/repository';
import { rallyIdsOf, rallyMoves, rallyPushes, type RallyItem } from '../../domain/rally';
import { rallyApi } from './rallyApi';
import { rememberRally } from './rallyStore';

let running = false;
/** Mientras se aplican cambios que vienen de Rally, el historial no los vuelve a mandar a Rally. */
let applying = false;
/** IDs que se están moviendo en Rally: hasta que termine, lo que llegue de Rally no los toca. */
const pending = new Set<string>();
/**
 * Entradas del historial que vinieron de Rally: deshacerlas (o rehacerlas) solo cambia el gestor, para no revertir en
 * Rally lo que hizo otra persona.
 */
const fromRally = new WeakSet<HistoryEntry>();

/**
 * Pone cada tarea enlazada con Rally en la categoría que tiene allí (Rally manda), en un solo "Deshacer". Con `items`
 * usa esos elementos (los que acaba de cargar la pantalla Rally); sin ellos, pide a Rally los de todas las tareas
 * enlazadas. Devuelve cuántas ha movido.
 */
export async function applyRallyStates(items?: RallyItem[]): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const [tasks, types] = await Promise.all([repo.listTasks(), repo.listItemTypes()]);
    let list = items;
    if (!list) {
      const ids = rallyIdsOf(tasks);
      if (!ids.length) return 0;
      list = await rallyApi.lookup(ids);
    }
    rememberRally(list);
    const moves = rallyMoves(tasks, list.filter((it) => !pending.has(it.id)), types);
    if (!moves.length) return 0;
    const label = moves.length === 1
      ? `${moves[0].item.id} movida a ${moves[0].stateName} como en Rally`
      : `${moves.length} tareas movidas como en Rally`;
    applying = true;
    try {
      await repo.batch(label, async () => {
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
 * Lleva a Rally los cambios de categoría hechos en el gestor (y al deshacer o rehacer). `notify` recibe el resultado
 * de cada elemento; si no se ha podido mover, volverá a su categoría de Rally en la siguiente pasada.
 */
export async function pushToRally(event: HistoryEvent, notify: (message: string) => void) {
  if (applying) {
    if (event.type === 'push') fromRally.add(event.entry);
    return;
  }
  if (fromRally.has(event.entry)) return;
  const pushes = rallyPushes(event.entry.changes, event.type === 'undo', await repo.listItemTypes());
  await Promise.all(pushes.map(async ({ id, category }) => {
    pending.add(id);
    try {
      const item = await rallyApi.move(id, category);
      rememberRally([item]);
      notify(`${id} en Rally: ${item.state}`);
    } catch (e) {
      // Sin Rally conectado no hay nada que avisar.
      if (!/Conecta Rally/.test((e as Error).message)) notify(`No se ha podido mover ${id} en Rally: ${(e as Error).message}`);
    } finally {
      pending.delete(id);
    }
  }));
}
