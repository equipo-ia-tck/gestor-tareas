import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, MessageSquare, RefreshCw, Search, Users, Video } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useWideLayout } from '../../app/Layout';
import { Avatar } from '../../components/ui/Badges';
import { repo } from '../../data/services';
import { useSync } from '../../data/sync';
import { chatTitle, isUnread, type TeamsChat, type TeamsMessage } from '../../domain/teamsChats';
import { fold } from '../../domain/text';
import { teamsLinkProps, useTeamsApp } from '../../hooks/useTeamsApp';

interface ChatsStatus { linked: boolean; found: boolean }

async function call<T>(method: 'GET' | 'POST', path: string): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
  const json = await res.json().catch(() => null);
  if (json === null) throw new Error('El servidor del equipo no responde.');
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}

/** Chats del servidor (`servidor/chats.ts`). */
const chatsApi = {
  status: () => call<ChatsStatus>('GET', '/api/chats'),
  link: () => call<ChatsStatus>('POST', '/api/chats/link'),
  unlink: () => call<ChatsStatus>('POST', '/api/chats/unlink'),
  data: () => call<{ chats: TeamsChat[]; updatedAt: string }>('GET', '/api/chats/data'),
};

/** El flujo escribe cada 5 minutos: se vuelve a leer cada minuto (el servidor solo relee el archivo si ha cambiado). */
const EVERY_MS = 60_000;
/** Sin escribir más de 20 minutos: el flujo o la sincronización de OneDrive se han parado. */
const STALE_MS = 20 * 60_000;

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// Reloj compartido para los "hace X min".
let now = Date.now();
const clock = new Set<() => void>();
setInterval(() => { now = Date.now(); for (const l of clock) l(); }, 30_000);
const useNow = () => useSyncExternalStore((l) => { clock.add(l); return () => void clock.delete(l); }, () => now);

/**
 * Chats de Teams en solo lectura: los recientes a la izquierda y los mensajes del elegido a la derecha. Cada mensaje se
 * puede convertir en tarea; para responder, se abre el chat en Teams.
 */
export function ChatsView() {
  useWideLayout('full');
  const { user } = useSync();
  const me = user?.name ?? null;
  const [status, setStatus] = useState<ChatsStatus | null>(null);
  const [data, setData] = useState<{ chats: TeamsChat[]; updatedAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const current = useNow();

  async function load() {
    setLoading(true);
    try {
      const s = await chatsApi.status();
      setStatus(s);
      if (s.linked) { setData(await chatsApi.data()); setError(null); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), EVERY_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  async function link() {
    setError(null);
    try { setStatus(await chatsApi.link()); await load(); } catch (e) { setError((e as Error).message); }
  }

  const chats = useMemo(() => {
    const q = fold(query.trim());
    const all = data?.chats ?? [];
    return q ? all.filter((c) => fold(`${chatTitle(c, me)} ${c.members.join(' ')} ${c.lastMessage?.text ?? ''}`).includes(q)) : all;
  }, [data, query, me]);
  const open = chats.find((c) => c.id === selected) ?? chats[0] ?? null;

  if (status && !status.linked) {
    return (
      <div className="mx-auto max-w-xl pt-10 text-sm">
        <h1 className="mb-2 flex items-center gap-2 text-xl font-semibold"><MessageSquare className="size-5" />Chats de Teams</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Un flujo de Power Automate guarda tus chats recientes en <code>OneDrive/Gestor/chats.json</code>; OneDrive lo sincroniza a este
          ordenador y el gestor lo lee de aquí. Solo lectura: para responder se abre el chat en Teams. Los mensajes no salen de tus cuentas
          de WPP.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {status.found ? '✓ Archivo encontrado en tu OneDrive.' : 'Aún no hay Gestor/chats.json en tu OneDrive: crea el flujo y ejecútalo una vez.'}
        </p>
        <button type="button" onClick={() => void link()} disabled={!status.found}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
          Vincular a mi cuenta
        </button>
        {error && <p className="mt-3 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      </div>
    );
  }

  const stale = data && current - new Date(data.updatedAt).getTime() > STALE_MS;

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Lista de chats */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="shrink-0 space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-lg font-semibold">Chats</h1>
            <button type="button" onClick={() => void load()} title="Volver a leer" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {data && (
            <p className={`text-xs ${stale ? 'text-amber-600' : 'text-zinc-500'}`} title={new Date(data.updatedAt).toLocaleString('es-ES')}>
              Actualizado {ago(data.updatedAt, current)}{stale ? ': el flujo o OneDrive no están actualizando' : ''}
            </p>
          )}
          {error && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{error}</p>}
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar…"
              className="w-full rounded-md border border-zinc-300 bg-white py-1 pr-2 pl-7 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
          </label>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {chats.map((c) => {
            const title = chatTitle(c, me);
            const unread = isUnread(c, me);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setSelected(c.id)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 ${open?.id === c.id ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''}`}>
                  {c.type === 'oneOnOne' ? <Avatar name={title} size={32} /> : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {c.type === 'meeting' ? <Video className="size-4" /> : <Users className="size-4" />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`}>{title}</span>
                      {c.lastMessage && <span className="shrink-0 text-[11px] text-zinc-400">{when(c.lastMessage.at)}</span>}
                    </span>
                    <span className={`block truncate text-xs ${unread ? 'font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-500'}`}>
                      {c.lastMessage ? `${c.lastMessage.from && c.type !== 'oneOnOne' ? `${c.lastMessage.from.split(' ')[0]}: ` : ''}${c.lastMessage.text}` : 'Sin mensajes'}
                    </span>
                  </span>
                  {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-indigo-600" title="Sin leer" />}
                </button>
              </li>
            );
          })}
          {data && !chats.length && <li className="p-4 text-sm text-zinc-400">{query ? 'Ningún chat coincide.' : 'El archivo aún no tiene chats.'}</li>}
        </ul>
      </aside>

      {/* Mensajes */}
      <section className="flex min-w-0 flex-1 flex-col">
        {open ? <Conversation key={open.id} chat={open} me={me} /> : <p className="m-auto text-sm text-zinc-400">{data ? 'Elige un chat.' : 'Cargando…'}</p>}
      </section>
    </div>
  );
}

function Conversation({ chat, me }: { chat: TeamsChat; me: string | null }) {
  const [teamsApp] = useTeamsApp();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.messages.length]);
  const title = chatTitle(chat, me);
  const messages = chat.messages.length ? chat.messages : chat.lastMessage ? [chat.lastMessage] : [];

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{title}</h2>
          {chat.members.length > 0 && <p className="truncate text-xs text-zinc-500">{chat.members.join(', ')}</p>}
        </div>
        {chat.webUrl && (
          <a {...teamsLinkProps(chat.webUrl, teamsApp)} className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#5b5fc7] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4b4fb7]">
            <MessageSquare className="size-4" />Responder en Teams
          </a>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!chat.messages.length && chat.lastMessage && (
          <p className="text-center text-xs text-zinc-400">El flujo solo trae el último mensaje de este chat.</p>
        )}
        {messages.map((m) => <Message key={m.id} message={m} chat={chat} title={title} mine={!!me && m.from?.toLowerCase() === me.toLowerCase()} />)}
        <div ref={end} />
      </div>
    </>
  );
}

function Message({ message: m, chat, title, mine }: { message: TeamsMessage; chat: TeamsChat; title: string; mine: boolean }) {
  const { editTask } = useApp();
  if (m.system) return <p className="text-center text-xs text-zinc-400">{m.text} · {when(m.at)}</p>;

  async function toTask() {
    const firstLine = m.text.split('\n').find((l) => l.trim())?.trim() ?? 'Mensaje de Teams';
    const date = new Date(m.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    let created = null as Awaited<ReturnType<typeof repo.createTask>> | null;
    await repo.batch('Tarea desde Teams', async () => {
      created = await repo.createTask({
        title: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
        people: m.from && !mine ? [m.from] : [],
        notes: `De: chat de Teams «${title}» · ${m.from ?? ''} · ${date}${chat.webUrl ? `\n${chat.webUrl}` : ''}\n\n> ${m.text.replace(/\n/g, '\n> ')}`,
      });
    });
    if (created) editTask(created);
  }

  return (
    <div className={`group flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && <Avatar name={m.from ?? '?'} size={28} />}
      <div className={`max-w-[75%] min-w-0 ${mine ? 'items-end text-right' : ''} flex flex-col`}>
        <span className="mb-0.5 text-[11px] text-zinc-500">{mine ? '' : `${m.from ?? 'Alguien'} · `}{when(m.at)}</span>
        <div className={`rounded-lg px-3 py-2 text-left text-sm break-words whitespace-pre-wrap ${mine ? 'bg-indigo-100 dark:bg-indigo-950' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
          {m.text}
        </div>
        <button type="button" onClick={() => void toTask()}
          className="mt-0.5 inline-flex items-center gap-1 self-start text-[11px] text-indigo-600 opacity-0 group-hover:opacity-100 hover:underline focus:opacity-100 dark:text-indigo-400">
          <ArrowRight className="size-3" />Tarea
        </button>
      </div>
    </div>
  );
}
