/**
 * Lectura de una Microsoft List (SharePoint) tal como la guarda Power Automate con «Obtener elementos» en
 * `OneDrive/Gestor/lista.json`. Sin imports de valores: lo usa también el servidor (Node sin compilar).
 */

/** Elemento de la lista con sus columnas ya convertidas a texto. */
export interface MsListItem {
  /** ID del elemento en SharePoint (numérico, como texto). */
  id: string;
  title: string;
  /** Columna → valor legible (opción, persona, fecha…), sin las columnas internas de SharePoint. */
  fields: Record<string, string>;
  /** Enlace al elemento en SharePoint (`{Link}`), si viene. */
  url: string | null;
  modified: string | null;
}

/** Cambio pendiente de aplicar en la lista (lo escribe el servidor y lo aplica el segundo flujo). */
export interface MsListChange {
  id: string;
  /** Columna que cambia (la de estado). */
  campo: string;
  valor: string;
  /** Título actual: «Actualizar elemento» lo pide aunque no cambie. */
  titulo: string;
  at: string;
}

/** Nombre legible de una columna: SharePoint codifica espacios y tildes (`Fecha_x0020_l_x00ed_mite` → «Fecha límite»). */
export const columnLabel = (name: string) => name.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** Columnas internas de SharePoint que no se enseñan. */
const HIDDEN = new Set(['ID', 'Id', 'id', 'Title', 'Modified', 'Created', 'Author', 'Editor', 'GUID', 'ComplianceAssetId',
  'ContentTypeId', 'FileSystemObjectType', 'ServerRedirectedEmbedUri', 'ServerRedirectedEmbedUrl', 'Attachments', 'ItemInternalId']);

const isHidden = (key: string) => HIDDEN.has(key) || /^[{@]/.test(key) || key.includes('#') || /^OData_/.test(key) || key.startsWith('_');

/** Valor de una columna como texto: opción (`Value`), persona (`DisplayName`), listas separadas por comas, fechas ISO cortas. */
export function msFieldText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T00:00:00Z?$/.test(v) ? v.slice(0, 10) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v === true ? 'Sí' : v === false ? 'No' : String(v);
  if (Array.isArray(v)) return v.map(msFieldText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o.Value ?? o.DisplayName ?? o.Title ?? o.Email ?? o.Label ?? '');
  }
  return '';
}

/**
 * Elementos de la lista. Acepta la salida de «Obtener elementos» (`{ value: [...] }`), la de un HTTP (`{ body: { value } }`)
 * o directamente un array. Lo que no tiene ID se descarta.
 */
export function parseMsList(json: unknown): MsListItem[] {
  const root = json as Record<string, unknown> | unknown[] | null;
  const rows = Array.isArray(root) ? root
    : Array.isArray(root?.value) ? root.value
      : Array.isArray((root?.body as Record<string, unknown> | undefined)?.value) ? (root!.body as { value: unknown[] }).value
        : [];
  const items: MsListItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = String(o.ID ?? o.Id ?? o.id ?? '').trim();
    if (!id) continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (isHidden(k)) continue;
      const text = msFieldText(v).trim();
      if (text) fields[k] = text;
    }
    items.push({
      id,
      title: msFieldText(o.Title).trim() || `Elemento ${id}`,
      fields,
      url: typeof o['{Link}'] === 'string' ? o['{Link}'] as string : null,
      modified: typeof o.Modified === 'string' ? o.Modified : null,
    });
  }
  return items;
}

/** Cambios del archivo de cambios (`{ cambios: [...] }` o un array), los que tienen ID, columna y valor. */
export function parseMsListChanges(json: unknown): MsListChange[] {
  const root = json as Record<string, unknown> | unknown[] | null;
  const rows = Array.isArray(root) ? root : Array.isArray(root?.cambios) ? root.cambios : [];
  return rows.filter((c): c is MsListChange => !!c && typeof c === 'object'
    && typeof (c as MsListChange).id === 'string' && typeof (c as MsListChange).campo === 'string' && typeof (c as MsListChange).valor === 'string');
}
