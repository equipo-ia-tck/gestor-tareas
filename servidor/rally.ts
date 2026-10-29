import type { DatabaseSync } from 'node:sqlite';
import type { RallyCategory, RallyDetail, RallyItem, RallyKind, RallyProject, RallyStatus } from '../src/domain/rally.ts';
import { ApiError } from './api.ts';
import type { TeamUser } from './visibility.ts';

/**
 * Conector de Rally (WSAPI v2) con la clave personal de cada usuario. La clave se guarda solo aquí (nunca vuelve
 * al navegador) y las consultas salen del servidor, así no hay problemas de CORS. Lee lo asignado a la persona o todo
 * lo de los proyectos que elija, y escribe tres cosas: la columna de un elemento cuando se mueve en el gestor, los
 * comentarios que se publican en su discusión y los archivos que se adjuntan.
 */

/** Rally de Europa (el que usamos); se puede cambiar al conectar. */
export const DEFAULT_RALLY_URL = 'https://eu1.rallydev.com';
const PAGE = 200;
/** Tamaño máximo de un adjunto (va en base64 dentro de un JSON de como mucho 50 MB). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 5;

type Fetch = typeof fetch;
type RallyObject = Record<string, unknown>;

/**
 * `_type` de Rally → prefijo y ruta de la página de detalle. `assignee`: el tipo tiene el campo personalizado
 * "Assignee", que es el que se usa para asignar (el Owner suele ser quien lo pidió).
 */
const KINDS: Record<string, { kind: RallyKind; path: string; typeName: string; assignee?: boolean }> = {
  hierarchicalrequirement: { kind: 'US', path: 'userstory', typeName: 'HierarchicalRequirement', assignee: true },
  defect: { kind: 'DE', path: 'defect', typeName: 'Defect', assignee: true },
  task: { kind: 'TA', path: 'task', typeName: 'Task', assignee: true },
  testset: { kind: 'TS', path: 'testset', typeName: 'TestSet' },
  testcase: { kind: 'TC', path: 'testcase', typeName: 'TestCase' },
};
/** Columna del tablero a la que se mueve cada categoría (la primera que exista en el proyecto). */
const TARGET_FLOW: Record<RallyCategory, string[]> = {
  todo: ['defined', 'to do', 'new'],
  blocked: ['blocked'],
  doing: ['in-progress', 'in progress'],
  done: ['completed'],
  accepted: ['accepted'],
};
/** Si el proyecto no tiene columnas propias: ScheduleState (y State en las tareas, que no tienen Accepted). */
const TARGET_SCHEDULE: Record<RallyCategory, string | null> = { todo: 'Defined', blocked: null, doing: 'In-Progress', done: 'Completed', accepted: 'Accepted' };
const TARGET_TASK_STATE: Record<RallyCategory, string | null> = { todo: 'Defined', blocked: null, doing: 'In-Progress', done: 'Completed', accepted: 'Completed' };
const CATEGORIES = Object.keys(TARGET_FLOW) as RallyCategory[];

/** Colecciones que se muestran como elementos relacionados en la ficha. */
const RELATED: [string, string][] = [['Children', 'User Stories hijas'], ['Tasks', 'Tareas'], ['TestCases', 'Test Cases'], ['Defects', 'Defectos']];
/** Campos internos o que la ficha ya muestra en otro sitio. */
const HIDDEN = new Set(['ObjectID', 'ObjectUUID', 'VersionId', 'Subscription', 'Workspace', 'DisplayColor', 'DragAndDropRank', 'RevisionHistory',
  'ScheduleStatePrefix', 'Name', 'FormattedID', 'LatestDiscussionAgeInMinutes', 'Blocked', 'BlockedReason', 'Recycled', 'HasParent',
  'Expedite', 'Ready', 'Connections']);
const ASSIGNEE_FIELD = 'c_Assignee';
const DONE = new Set(['accepted', 'completed', 'released', 'closed', 'pass']);
/** Orden de las columnas cuando no hay FlowState (tablero sin columnas propias). */
const SCHEDULE = ['idea', 'new', 'submitted', 'defined', 'open', 'in-progress', 'fixed', 'completed', 'accepted', 'released', 'closed'];
const FETCH = 'FormattedID,Name,FlowState,OrderIndex,ScheduleState,State,LastVerdict,Blocked,Project,Iteration,Release,'
  + 'LastUpdateDate,ObjectID,Owner,c_Assignee';

/** Solo servidores de Rally (`https://*.rallydev.com`), sin ruta. */
export function normalizeBaseUrl(input: unknown): string {
  const raw = String(input ?? '').trim() || DEFAULT_RALLY_URL;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ApiError(400, 'La dirección de Rally no es válida.');
  }
  if (url.protocol !== 'https:' || !/(^|\.)rallydev\.com$/.test(url.hostname)) {
    throw new ApiError(400, 'La dirección debe ser de Rally (https://…rallydev.com).');
  }
  return url.origin;
}

const refName = (v: unknown) => (v && typeof v === 'object' ? String((v as RallyObject)._refObjectName ?? '') || null : null);
const refId = (v: unknown) => (v && typeof v === 'object' ? String((v as RallyObject)._ref ?? '').split('/').pop() ?? null : null);

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Texto legible a partir del HTML de Rally (párrafos, saltos y listas), sin etiquetas. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<img[^>]*>/gi, '[imagen]')
    .replace(/<\/(p|div|h\d|tr|ul|ol|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => e[0] === '#'
      ? String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === 'x' ? 2 : 1), e[1].toLowerCase() === 'x' ? 16 : 10))
      : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML de un comentario escrito en el gestor (texto plano: se escapa y los saltos de línea pasan a `<br>`). */
export function commentHtml(text: string): string {
  return text.trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '<br />');
}

const isHtml = (v: string) => /<\/?[a-z][^>]*>/i.test(v);

/** Valor legible de un campo de la WSAPI (null si está vacío, a cero o es una colección). */
export function fieldValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '' || v === false || v === 0) return null;
  if (v === true) return 'Sí';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace('T', ' ');
    return v;
  }
  if (typeof v === 'object') {
    const o = v as RallyObject;
    if (o.Count !== undefined) return null;
    return refName(o);
  }
  return null;
}

/**
 * Categoría del gestor a partir de la columna del tablero y el estado: Accepted (o Released/Closed), Hecho (Completed o
 * test pasado), Bloqueado (columna Blocked, marcado como bloqueado sin terminar o test fallido), En curso (In-Progress,
 * Need Review…) y Por hacer (el resto: New, Defined…).
 */
export function rallyCategory(flow: string | null, schedule: string, blocked: boolean): RallyCategory {
  const f = (flow ?? '').toLowerCase();
  const s = schedule.toLowerCase();
  if (['accepted', 'released', 'closed'].includes(s) || f === 'accepted') return 'accepted';
  if (s === 'completed' || s === 'pass' || f === 'completed') return 'done';
  if (blocked || f.includes('block') || s === 'fail' || s === 'blocked') return 'blocked';
  if (s === 'in-progress' || s === 'fixed' || /progress|review|desarrollo|curso|test|qa/.test(f)) return 'doing';
  return 'todo';
}

/** Une condiciones de la WSAPI, que solo admite dos por paréntesis: ((a OR b) OR c). */
export const joinQuery = (parts: string[], op: 'AND' | 'OR') => parts.reduce((acc, p) => `(${acc} ${op} ${p})`);

/**
 * Convierte un resultado de la WSAPI en un elemento del gestor (null si es de un tipo que no usamos). `meId`: ObjectID
 * de la persona conectada, para marcar lo suyo.
 */
export function toRallyItem(o: RallyObject, baseUrl: string, meId: string | null = null): RallyItem | null {
  const info = KINDS[String(o._type ?? '').toLowerCase()];
  if (!info) return null;
  const schedule = String(o.ScheduleState ?? o.State ?? o.LastVerdict ?? '') || (info.kind === 'TC' ? 'Sin ejecutar' : '');
  const flow = o.FlowState as RallyObject | null | undefined;
  const scheduleOrder = SCHEDULE.indexOf(schedule.toLowerCase());
  return {
    id: String(o.FormattedID ?? ''),
    objectId: String(o.ObjectID ?? ''),
    kind: info.kind,
    name: String(o.Name ?? '').trim() || String(o.FormattedID ?? ''),
    state: refName(flow) ?? schedule,
    stateOrder: typeof flow?.OrderIndex === 'number' ? flow.OrderIndex : scheduleOrder < 0 ? 99 : scheduleOrder,
    category: rallyCategory(refName(flow), schedule, o.Blocked === true),
    done: DONE.has(schedule.toLowerCase()),
    blocked: o.Blocked === true,
    project: refName(o.Project),
    iteration: refName(o.Iteration),
    release: refName(o.Release),
    assignee: refName(o.c_Assignee) ?? refName(o.Owner),
    owner: refName(o.Owner),
    mine: meId !== null && (refId(o.c_Assignee) === meId || refId(o.Owner) === meId),
    updatedAt: String(o.LastUpdateDate ?? ''),
    url: `${baseUrl}/#/detail/${info.path}/${o.ObjectID}`,
  };
}

export class Rally {
  private db: DatabaseSync;
  private fetch: Fetch;

  constructor(db: DatabaseSync, fetcher: Fetch = fetch) {
    this.db = db;
    this.fetch = fetcher;
    db.exec(`CREATE TABLE IF NOT EXISTS rally_accounts (user_id TEXT PRIMARY KEY, api_key TEXT NOT NULL, base_url TEXT NOT NULL,
      rally_user_id TEXT NOT NULL, rally_user TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  }

  private account(user: TeamUser) {
    return this.db.prepare('SELECT * FROM rally_accounts WHERE user_id = ?').get(user.id) as
      { api_key: string; base_url: string; rally_user_id: string; rally_user: string } | undefined;
  }

  status(user: TeamUser): RallyStatus {
    const a = this.account(user);
    return a ? { connected: true, baseUrl: a.base_url, keyHint: a.api_key.slice(-4), rallyUser: a.rally_user }
      : { connected: false, baseUrl: DEFAULT_RALLY_URL, keyHint: null, rallyUser: null };
  }

  private async get(baseUrl: string, apiKey: string, path: string): Promise<RallyObject> {
    let res: Response;
    try {
      res = await this.fetch(`${baseUrl}/slm/webservice/v2.0${path}`, { headers: { ZSESSIONID: apiKey, Accept: 'application/json' } });
    } catch {
      throw new ApiError(502, 'No se puede conectar con Rally. Revisa la conexión (o la VPN) y la dirección.');
    }
    if (res.status === 401 || res.status === 403) throw new ApiError(400, 'Rally no acepta la clave: revísala o crea una nueva.');
    if (!res.ok) throw new ApiError(502, `Rally ha respondido con un error (${res.status}).`);
    const json = await res.json().catch(() => null) as RallyObject | null;
    if (!json) throw new ApiError(502, 'Rally no ha devuelto datos válidos.');
    const errors = (json.QueryResult as RallyObject | undefined)?.Errors as string[] | undefined;
    if (errors?.length) throw new ApiError(502, `Rally: ${errors.join(' ')}`);
    return json;
  }

  /** Escribe en Rally (crear o actualizar) y devuelve el objeto resultante. */
  private async post(a: { base_url: string; api_key: string }, path: string, body: unknown): Promise<RallyObject> {
    let res: Response;
    try {
      res = await this.fetch(`${a.base_url}/slm/webservice/v2.0${path}`, {
        method: 'POST',
        headers: { ZSESSIONID: a.api_key, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(502, 'No se puede conectar con Rally. Revisa la conexión (o la VPN).');
    }
    const json = await res.json().catch(() => null) as RallyObject | null;
    // Actualizar devuelve OperationResult y crear, CreateResult.
    const result = (json?.OperationResult ?? json?.CreateResult) as RallyObject | undefined;
    const errors = (result?.Errors ?? []) as string[];
    const denied = res.status === 401 || res.status === 403 || errors.some((e) => /not authorized|permission|read.?only|unauthorized/i.test(e));
    if (denied) throw new ApiError(400, 'Rally no deja modificar con esta clave: tiene que ser de acceso total (Full Access).');
    if (errors.length) throw new ApiError(502, `Rally: ${errors.join(' ')}`);
    if (!res.ok || !result?.Object) throw new ApiError(502, `Rally ha respondido con un error (${res.status}).`);
    return result.Object as RallyObject;
  }

  /** Comprueba la clave pidiendo el usuario de Rally y la guarda. */
  async connect(user: TeamUser, input: { apiKey?: unknown; baseUrl?: unknown }): Promise<RallyStatus> {
    const apiKey = String(input.apiKey ?? '').trim();
    if (!apiKey) throw new ApiError(400, 'Pega la clave de API de Rally.');
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const me = (await this.get(baseUrl, apiKey, '/user')).User as RallyObject | undefined;
    if (!me?.ObjectID) throw new ApiError(400, 'Rally no ha devuelto tu usuario con esa clave.');
    const name = String(me.DisplayName || me._refObjectName || me.UserName || '');
    this.db.prepare(`INSERT INTO rally_accounts (user_id, api_key, base_url, rally_user_id, rally_user, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET api_key = excluded.api_key, base_url = excluded.base_url, rally_user_id = excluded.rally_user_id,
      rally_user = excluded.rally_user, updated_at = excluded.updated_at`)
      .run(user.id, apiKey, baseUrl, String(me.ObjectID), name, new Date().toISOString());
    return this.status(user);
  }

  disconnect(user: TeamUser): RallyStatus {
    this.db.prepare('DELETE FROM rally_accounts WHERE user_id = ?').run(user.id);
    return this.status(user);
  }

  private connected(user: TeamUser) {
    const a = this.account(user);
    if (!a) throw new ApiError(400, 'Conecta Rally con tu clave de API.');
    return a;
  }

  /** Proyectos abiertos a los que tiene acceso la clave. */
  async projects(user: TeamUser): Promise<RallyProject[]> {
    const a = this.connected(user);
    const params = new URLSearchParams({ query: '(State = "Open")', fetch: 'Name,ObjectID', order: 'Name', pagesize: String(PAGE) });
    const rows = (((await this.get(a.base_url, a.api_key, `/project?${params}`)).QueryResult as RallyObject)?.Results ?? []) as RallyObject[];
    return rows.map((p) => ({ id: String(p.ObjectID), name: String(p.Name ?? '') }));
  }

  /**
   * Actualizado en los últimos `days` días (0 = todo), más reciente primero: sin `projects`, lo asignado a la persona
   * (Assignee u Owner); con `projects` (ObjectID), todo lo de esos proyectos. Una consulta por tipo, porque no todos
   * tienen el campo Assignee.
   */
  async items(user: TeamUser, days = 90, projects: string[] = []): Promise<RallyItem[]> {
    const a = this.connected(user);
    const ids = projects.filter((p) => /^\d+$/.test(p));
    const owner = `(Owner.ObjectID = ${a.rally_user_id})`;
    const since = days > 0 ? new Date(Date.now() - Math.min(days, 3650) * 86_400_000).toISOString().slice(0, 10) : null;
    const recent = (who: string) => (since ? `(${who} AND (LastUpdateDate >= "${since}"))` : who);
    const inProjects = ids.length ? joinQuery(ids.map((id) => `(Project.ObjectID = ${id})`), 'OR') : null;
    const items: RallyItem[] = [];
    for (const [type, info] of Object.entries(KINDS)) {
      const query = recent(inProjects ?? (info.assignee ? `(${owner} OR (${ASSIGNEE_FIELD}.ObjectID = ${a.rally_user_id}))` : owner));
      // Un Rally sin el campo Assignee rechaza la consulta: entonces basta con el Owner.
      const rows = await this.query(a, type, query).catch((e: unknown) => {
        if (info.assignee && e instanceof ApiError && e.message.includes(ASSIGNEE_FIELD)) return this.query(a, type, recent(owner));
        throw e;
      });
      for (const r of rows) {
        const item = toRallyItem({ _type: type, ...r }, a.base_url, a.rally_user_id);
        if (item) items.push(item);
      }
    }
    return items.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  }

  /**
   * Elementos por su ID ("US1764574", "DE9"…), para sincronizar las tareas del gestor enlazadas con Rally. Se agrupan
   * por tipo y se piden de 40 en 40 (la consulta va en la URL).
   */
  async lookup(user: TeamUser, input: { ids?: unknown }): Promise<RallyItem[]> {
    const a = this.connected(user);
    const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map((id) => String(id).replace(/-/g, '').toUpperCase()))]
      .filter((id) => /^(US|DE|TA|TS|TC)\d{1,12}$/.test(id))
      .slice(0, 1000);
    const items: RallyItem[] = [];
    for (const [type, info] of Object.entries(KINDS)) {
      const mine = ids.filter((id) => id.startsWith(info.kind));
      for (let i = 0; i < mine.length; i += 40) {
        const query = joinQuery(mine.slice(i, i + 40).map((id) => `(FormattedID = "${id}")`), 'OR');
        for (const r of await this.query(a, type, query)) {
          const item = toRallyItem({ _type: type, ...r }, a.base_url, a.rally_user_id);
          if (item) items.push(item);
        }
      }
    }
    return items;
  }

  /** Columnas del tablero de un proyecto, en caché. */
  private flows = new Map<string, Promise<{ name: string; ref: string }[]>>();
  private flowStates(a: { base_url: string; api_key: string }, projectId: string) {
    const key = `${a.base_url} ${projectId}`;
    if (!this.flows.has(key)) {
      const params = new URLSearchParams({ query: `(Project.ObjectID = ${projectId})`, fetch: 'Name', order: 'OrderIndex', pagesize: '100' });
      const load = this.get(a.base_url, a.api_key, `/flowstate?${params}`).then((r) =>
        (((r.QueryResult as RallyObject)?.Results ?? []) as RallyObject[]).map((f) => ({ name: String(f.Name ?? ''), ref: String(f._ref ?? '') })));
      load.catch(() => this.flows.delete(key));
      this.flows.set(key, load);
    }
    return this.flows.get(key)!;
  }

  /**
   * Mueve un elemento a la columna de una categoría (cuando se mueve su tarea en el gestor). No escribe si ya está en
   * esa categoría. Al sacarlo de Bloqueado se le quita la marca de bloqueo; las tareas de Rally cambian su State.
   */
  async move(user: TeamUser, input: { id?: unknown; category?: unknown }): Promise<RallyItem> {
    const a = this.connected(user);
    const id = String(input.id ?? '').replace(/-/g, '').toUpperCase();
    const category = input.category as RallyCategory;
    const entry = Object.entries(KINDS).find(([, info]) => id.startsWith(info.kind));
    if (!entry || !/^[A-Z]{2}\d{1,12}$/.test(id) || !CATEGORIES.includes(category)) throw new ApiError(400, 'Movimiento de Rally no válido.');
    const [type, info] = entry;
    if (info.kind === 'TC') throw new ApiError(400, 'Los test cases no tienen columna en Rally: se mueven con su resultado.');
    const [o] = await this.query(a, type, `(FormattedID = "${id}")`);
    if (!o) throw new ApiError(404, `${id} no existe en Rally.`);
    const current = toRallyItem({ _type: type, ...o }, a.base_url, a.rally_user_id)!;
    if (current.category === category) return current;

    const patch: RallyObject = {};
    if (type === 'task') {
      if (TARGET_TASK_STATE[category]) patch.State = TARGET_TASK_STATE[category];
    } else {
      const projectId = refId(o.Project);
      const flows = projectId ? await this.flowStates(a, projectId) : [];
      const flow = TARGET_FLOW[category].map((n) => flows.find((f) => f.name.toLowerCase() === n)).find(Boolean);
      if (flow) patch.FlowState = flow.ref;
      else if (TARGET_SCHEDULE[category]) patch.ScheduleState = TARGET_SCHEDULE[category];
    }
    if (category === 'blocked' && !patch.FlowState) patch.Blocked = true;
    if (category !== 'blocked' && o.Blocked === true) patch.Blocked = false;
    const updated = await this.post(a, `/${type}/${o.ObjectID}?fetch=${FETCH}`, { [info.typeName]: patch });
    return toRallyItem({ _type: type, ...updated }, a.base_url, a.rally_user_id)!;
  }

  /** Publica un comentario en la discusión de un elemento, como el usuario de la clave. */
  async comment(user: TeamUser, input: { kind?: unknown; objectId?: unknown; text?: unknown }): Promise<RallyDetail['discussion'][number]> {
    const a = this.connected(user);
    const entry = Object.entries(KINDS).find(([, info]) => info.kind === input.kind);
    if (!entry || !/^\d+$/.test(String(input.objectId))) throw new ApiError(400, 'Elemento de Rally no válido.');
    const text = String(input.text ?? '').trim();
    if (!text) throw new ApiError(400, 'Escribe el comentario.');
    if (text.length > 10_000) throw new ApiError(400, 'El comentario es demasiado largo.');
    const post = await this.post(a, '/conversationpost/create?fetch=Text,User,CreationDate',
      { ConversationPost: { Artifact: `/${entry[0]}/${input.objectId}`, Text: commentHtml(text) } });
    return {
      author: refName(post.User) ?? a.rally_user,
      date: String(post.CreationDate ?? new Date().toISOString()),
      text: htmlToText(String(post.Text ?? commentHtml(text))),
    };
  }

  /**
   * Adjunta un archivo a un elemento. Rally lo pide en dos pasos: primero el contenido (en base64) y después el adjunto
   * que lo enlaza con el elemento, con su nombre, tipo y tamaño.
   */
  async attach(user: TeamUser, input: { kind?: unknown; objectId?: unknown; name?: unknown; contentType?: unknown; content?: unknown }):
    Promise<RallyDetail['attachments'][number]> {
    const a = this.connected(user);
    const entry = Object.entries(KINDS).find(([, info]) => info.kind === input.kind);
    if (!entry || !/^\d+$/.test(String(input.objectId))) throw new ApiError(400, 'Elemento de Rally no válido.');
    const name = String(input.name ?? '').split(/[\\/]/).pop()!.trim().slice(0, 250);
    const content = String(input.content ?? '');
    if (!name || !content || !/^[A-Za-z0-9+/]+=*$/.test(content)) throw new ApiError(400, 'Archivo no válido.');
    const size = Buffer.from(content, 'base64').length;
    if (!size) throw new ApiError(400, 'El archivo está vacío.');
    if (size > MAX_ATTACHMENT_BYTES) throw new ApiError(400, 'El archivo pasa de 25 MB: adjúntalo directamente en Rally.');
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(String(input.contentType ?? '')) ? String(input.contentType) : 'application/octet-stream';
    const stored = await this.post(a, '/attachmentcontent/create', { AttachmentContent: { Content: content } });
    const ref = this.relative(a, stored._ref) ?? `/attachmentcontent/${String(stored.ObjectID ?? '')}`;
    const file = await this.post(a, '/attachment/create?fetch=Name,Size',
      { Attachment: { Artifact: `/${entry[0]}/${input.objectId}`, Content: ref, ContentType: contentType, Name: name, Size: size } });
    return { name: String(file.Name ?? name), size: Number(file.Size ?? size) };
  }

  /** Nombre visible de cada campo de un tipo (ElementName → Name), en caché por servidor y tipo. */
  private labels = new Map<string, Promise<Map<string, string>>>();
  private fieldLabels(a: { base_url: string; api_key: string }, typeName: string) {
    const key = `${a.base_url} ${typeName}`;
    if (!this.labels.has(key)) {
      const load = (async () => {
        const def = ((await this.get(a.base_url, a.api_key, `/typedefinition?query=${encodeURIComponent(`(ElementName = ${typeName})`)}&fetch=Attributes`))
          .QueryResult as RallyObject)?.Results as RallyObject[] | undefined;
        const ref = this.relative(a, (def?.[0]?.Attributes as RallyObject | undefined)?._ref);
        const attrs = ref ? await this.collection(a, ref, 'Name,ElementName') : [];
        return new Map(attrs.map((x) => [String(x.ElementName), String(x.Name)]));
      })();
      load.catch(() => this.labels.delete(key)); // si falla, se reintenta la próxima vez
      this.labels.set(key, load);
    }
    return this.labels.get(key)!;
  }

  /** Ruta relativa a la WSAPI de una referencia de Rally (solo del mismo servidor). */
  private relative(a: { base_url: string }, ref: unknown): string | null {
    const prefix = `${a.base_url}/slm/webservice/v2.0`;
    return typeof ref === 'string' && ref.startsWith(`${prefix}/`) ? ref.slice(prefix.length) : null;
  }

  private async collection(a: { base_url: string; api_key: string }, ref: string, fetchFields: string, order?: string): Promise<RallyObject[]> {
    const params = new URLSearchParams({ fetch: fetchFields, pagesize: String(PAGE), ...(order ? { order } : {}) });
    return (((await this.get(a.base_url, a.api_key, `${ref}?${params}`)).QueryResult as RallyObject)?.Results ?? []) as RallyObject[];
  }

  /** Ficha completa de un elemento: todos los campos con valor, textos, etiquetas, hijos, discusión y adjuntos. */
  async detail(user: TeamUser, kind: unknown, objectId: unknown): Promise<RallyDetail> {
    const a = this.connected(user);
    const entry = Object.entries(KINDS).find(([, info]) => info.kind === kind);
    if (!entry || !/^\d+$/.test(String(objectId))) throw new ApiError(400, 'Elemento de Rally no válido.');
    const [type, info] = entry;
    const [o, labels] = await Promise.all([
      this.get(a.base_url, a.api_key, `/${type}/${objectId}?fetch=true`).then((r) => r[info.typeName] as RallyObject | undefined),
      this.fieldLabels(a, info.typeName).catch(() => new Map<string, string>()),
    ]);
    if (!o) throw new ApiError(404, 'Ese elemento ya no existe en Rally.');
    const item = toRallyItem({ _type: type, ...o }, a.base_url, a.rally_user_id)!;
    const label = (k: string) => labels.get(k) ?? k.replace(/^c_/, '');

    const fields: RallyDetail['fields'] = [];
    const texts: RallyDetail['texts'] = [];
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_') || HIDDEN.has(k)) continue;
      if (typeof v === 'string' && (isHtml(v) || v.length > 120 || k === 'Description' || k === 'Notes')) {
        const text = htmlToText(v);
        if (text) texts.push({ label: label(k), text });
        continue;
      }
      const value = fieldValue(v);
      if (value !== null) fields.push({ label: label(k), value });
    }
    // Descripción y notas primero, como en Rally.
    const first = [label('Description'), label('Notes')];
    texts.sort((x, y) => (first.indexOf(x.label) + 1 || 9) - (first.indexOf(y.label) + 1 || 9));
    fields.sort((x, y) => x.label.localeCompare(y.label, 'es'));

    const sub = (k: string) => {
      const c = o[k] as RallyObject | undefined;
      return c && Number(c.Count) > 0 ? this.relative(a, c._ref) : null;
    };
    const fetchSub = (k: string, fetchFields: string, order?: string) => {
      const ref = sub(k);
      return ref ? this.collection(a, ref, fetchFields, order).catch(() => []) : Promise.resolve([] as RallyObject[]);
    };
    const [tags, posts, files, ...lists] = await Promise.all([
      fetchSub('Tags', 'Name'),
      fetchSub('Discussion', 'Text,User,CreationDate', 'CreationDate'),
      fetchSub('Attachments', 'Name,Size'),
      ...RELATED.map(([k]) => fetchSub(k, FETCH)),
    ]);
    return {
      item,
      blockedReason: item.blocked ? String(o.BlockedReason ?? '') || null : null,
      fields,
      texts,
      tags: tags.map((t) => String(t.Name ?? '')).filter(Boolean),
      related: RELATED.map(([, l], i) => ({
        label: l,
        items: lists[i].map((r) => toRallyItem(r, a.base_url, a.rally_user_id)).filter((x): x is RallyItem => !!x),
      })).filter((g) => g.items.length),
      discussion: posts.map((p) => ({ author: refName(p.User), date: String(p.CreationDate ?? ''), text: htmlToText(String(p.Text ?? '')) })),
      attachments: files.map((f) => ({ name: String(f.Name ?? ''), size: Number(f.Size ?? 0) })),
    };
  }

  private async query(a: { base_url: string; api_key: string }, type: string, query: string): Promise<RallyObject[]> {
    const params = new URLSearchParams({
      query,
      fetch: FETCH,
      order: 'LastUpdateDate DESC',
      pagesize: String(PAGE),
    });
    const rows: RallyObject[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      params.set('start', String(page * PAGE + 1));
      const result = (await this.get(a.base_url, a.api_key, `/${type}?${params}`)).QueryResult as RallyObject;
      const batch = (result?.Results ?? []) as RallyObject[];
      rows.push(...batch);
      if (batch.length < PAGE || (page + 1) * PAGE >= Number(result?.TotalResultCount ?? 0)) break;
    }
    return rows;
  }
}
