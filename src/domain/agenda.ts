/** Colocación de reuniones en una agenda por horas (como la semana de Outlook). Funciones puras. */

/** Minutos desde medianoche de "HH:MM". */
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Duración que se da a una reunión sin hora de fin. */
export const DEFAULT_MEETING_MINUTES = 30;

export interface AgendaBlock<T> {
  item: T;
  /** Minutos desde medianoche. */
  start: number;
  end: number;
  /** Columna dentro de su grupo de reuniones que se solapan, y número de columnas del grupo. */
  col: number;
  cols: number;
}

/**
 * Coloca las reuniones de un día: las que se solapan se reparten en columnas, una al lado de otra (cada una en la
 * primera columna libre), y todas las del grupo comparten el ancho. Las que no se solapan ocupan todo el ancho.
 */
export function layoutDay<T>(items: T[], range: (item: T) => { start: number; end: number }): AgendaBlock<T>[] {
  const blocks = items
    .map((item) => {
      const r = range(item);
      return { item, start: r.start, end: Math.max(r.end, r.start + 15), col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof blocks = [];
  let columns: number[] = []; // fin de la última reunión de cada columna
  let groupEnd = -1;
  const close = () => { for (const b of group) b.cols = columns.length; };
  for (const b of blocks) {
    if (b.start >= groupEnd) { close(); group = []; columns = []; }
    let col = columns.findIndex((end) => end <= b.start);
    if (col === -1) { col = columns.length; columns.push(b.end); } else columns[col] = b.end;
    b.col = col;
    group.push(b);
    groupEnd = Math.max(groupEnd, b.end);
  }
  close();
  return blocks;
}

/** Horas que se muestran: de 8 a 19 como mínimo, ampliadas para que quepan todas las reuniones. */
export function hourRange(blocks: { start: number; end: number }[], from = 8, to = 19): [number, number] {
  let a = from;
  let b = to;
  for (const x of blocks) {
    a = Math.min(a, Math.floor(x.start / 60));
    b = Math.max(b, Math.ceil(x.end / 60));
  }
  return [a, Math.min(b, 24)];
}
