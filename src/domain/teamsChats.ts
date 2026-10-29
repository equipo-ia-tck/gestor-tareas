/**
 * Chats de Teams exportados por un flujo de Power Automate (acción «Enviar una solicitud HTTP de Microsoft Graph» con
 * `/me/chats?$expand=lastMessagePreview` y, por chat, `/me/chats/{id}/messages`), guardados en OneDrive/Gestor/chats.json.
 * El servidor los recorta con `trimTeamsChats` (texto sin HTML, sin adjuntos) y la app solo los muestra. Solo lectura.
 *
 * Formatos aceptados (el flujo no tiene que transformar nada):
 * - la respuesta de la lista de chats tal cual: `{ value: [chat] }` o `[chat]` (solo con el último mensaje);
 * - una lista de `{ chat, messages }`, donde `messages` es la respuesta de mensajes (`{ value: [...] }`) o una lista;
 * - un chat con sus mensajes dentro (`chat.messages`).
 * Sin imports de valores: lo importa el servidor (Node sin compilar).
 */

export interface TeamsMessage {
  id: string;
  /** Nombre de quien lo escribe (null en mensajes del sistema o de apps sin nombre). */
  from: string | null;
  /** Instante ISO (UTC). */
  at: string;
  text: string;
  /** Avisos del sistema: alguien se unió, empezó la reunión… */
  system: boolean;
}

export interface TeamsChat {
  id: string;
  /** Tema del chat (los de grupo y reunión suelen tenerlo; los individuales no). */
  topic: string | null;
  type: 'oneOnOne' | 'group' | 'meeting' | 'other';
  /** Enlace para abrir el chat en Teams. */
  webUrl: string | null;
  /** Última actividad (ISO). */
  updatedAt: string;
  /** Personas del chat, si el flujo las trae (`$expand=members`) o salen de los mensajes. */
  members: string[];
  lastMessage: TeamsMessage | null;
  /** Mensajes de más antiguo a más reciente (vacío si el flujo solo trae la lista de chats). */
  messages: TeamsMessage[];
  /** Cuándo leí el chat por última vez (Graph: viewpoint.lastMessageReadDateTime), para marcar lo no leído. */
  readAt: string | null;
}

type Raw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v)?.value) ? (obj(v)!.value as unknown[]) : []);

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MAX_TEXT = 4000;

/** Texto de un mensaje de Teams (HTML con emojis, menciones, citas y adjuntos) sin etiquetas. */
export function teamsText(body: unknown): string {
  const b = obj(body);
  const content = str(b?.content);
  if (!content) return '';
  if (str(b?.contentType).toLowerCase() !== 'html') return content.trim().slice(0, MAX_TEXT);
  return content
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<emoji[^>]*alt="([^"]*)"[^>]*>(?:<\/emoji>)?/gi, '$1')
    .replace(/<attachment[^>]*>(?:<\/attachment>)?/gi, '[adjunto]')
    .replace(/<img[^>]*>/gi, '[imagen]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|blockquote|h\d|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#'
      ? String.fromCodePoint(parseInt(e.slice(e[1].toLowerCase() === 'x' ? 2 : 1), e[1].toLowerCase() === 'x' ? 16 : 10))
      : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

function message(v: unknown): TeamsMessage | null {
  const m = obj(v);
  if (!m) return null;
  const at = str(m.createdDateTime);
  if (!at || m.isDeleted === true || m.deletedDateTime) return null;
  const type = str(m.messageType);
  const system = !!type && type !== 'message';
  const from = obj(m.from);
  const name = str(obj(from?.user)?.displayName) || str(obj(from?.application)?.displayName) || null;
  const text = teamsText(m.body);
  if (!text && !system) return null;
  return { id: str(m.id) || at, from: name, at, text: text || (system ? 'Aviso de Teams' : ''), system };
}

const TYPES: Record<string, TeamsChat['type']> = { oneonone: 'oneOnOne', group: 'group', meeting: 'meeting' };

function chat(raw: Raw, extra: unknown): TeamsChat | null {
  const id = str(raw.id);
  if (!id) return null;
  const messages = [...list(raw.messages), ...list(extra)]
    .map(message)
    .filter((m): m is TeamsMessage => !!m)
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) => a.at.localeCompare(b.at));
  const preview = message(raw.lastMessagePreview);
  const lastMessage = [...messages].reverse().find((m) => !m.system) ?? preview ?? messages[messages.length - 1] ?? null;
  const members = list(raw.members).map((x) => str(obj(x)?.displayName)).filter(Boolean);
  for (const m of messages) if (m.from && !m.system && !members.includes(m.from)) members.push(m.from);
  if (preview?.from && !members.includes(preview.from)) members.push(preview.from);
  const updatedAt = [str(raw.lastUpdatedDateTime), lastMessage?.at ?? '', str(raw.createdDateTime)].filter(Boolean).sort().pop() ?? '';
  return {
    id,
    topic: str(raw.topic).trim() || null,
    type: TYPES[str(raw.chatType).toLowerCase()] ?? 'other',
    webUrl: str(raw.webUrl) || null,
    updatedAt,
    members,
    lastMessage,
    messages,
    readAt: str(obj(raw.viewpoint)?.lastMessageReadDateTime) || null,
  };
}

/** Del JSON del flujo a chats recortados, del más reciente al más antiguo. Ignora lo que no se entienda. */
export function trimTeamsChats(json: unknown): TeamsChat[] {
  const out = new Map<string, TeamsChat>();
  for (const item of list(json)) {
    const o = obj(item);
    if (!o) continue;
    // { chat, messages } o el chat directamente.
    const c = obj(o.chat) ? chat(obj(o.chat)!, o.messages) : chat(o, null);
    if (c && !out.has(c.id)) out.set(c.id, c);
  }
  return [...out.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Título que se enseña: el tema o, si no tiene, las demás personas del chat. */
export function chatTitle(c: TeamsChat, me: string | null): string {
  if (c.topic) return c.topic;
  const others = c.members.filter((m) => !me || m.toLowerCase() !== me.toLowerCase());
  return others.join(', ') || (c.type === 'oneOnOne' ? 'Chat' : 'Chat de grupo');
}

/** Hay mensajes de otras personas posteriores a la última lectura. */
export function isUnread(c: TeamsChat, me: string | null): boolean {
  const m = c.lastMessage;
  if (!m || m.system || !c.readAt) return false;
  if (me && m.from?.toLowerCase() === me.toLowerCase()) return false;
  return m.at > c.readAt;
}
