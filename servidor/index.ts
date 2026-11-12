// Servidor del equipo: sirve la app compilada (dist/) y la API (/api) en http://localhost:4173.
// Los datos se guardan en servidor/datos/equipo.sqlite (fuera de Git).
// Uso: `npm start` (compila y arranca). Para abrirlo a la red local: GESTOR_HOST=0.0.0.0 npm start.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Api, ApiError, type Change } from './api.ts';
import { Calendar } from './calendar.ts';
import { Chats } from './chats.ts';
import { Confluence } from './confluence.ts';
import { MsList } from './msList.ts';
import { Rally } from './rally.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const DATA = process.env.GESTOR_DATOS ? resolve(process.env.GESTOR_DATOS) : join(ROOT, 'servidor', 'datos');
const PORT = Number(process.env.PORT ?? 4173);
const HOSTS = process.env.GESTOR_HOST ? [process.env.GESTOR_HOST] : ['127.0.0.1', '::1'];
const COOKIE = 'gestor_sesion';

mkdirSync(join(DATA, 'copias'), { recursive: true });
const db = new DatabaseSync(join(DATA, 'equipo.sqlite'));
const api = new Api(db);
const rally = new Rally(db);
const calendar = new Calendar(db);
const chats = new Chats(db);
const confluence = new Confluence(db);
const msList = new MsList(db);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

const cookieOf = (req: IncomingMessage) =>
  /(?:^|;\s*)gestor_sesion=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
const sessionCookie = (token: string, maxAge = 30 * 86_400) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50 * 1024 * 1024) throw new ApiError(413, 'Demasiados datos de golpe.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'La petición no es JSON válido.');
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'POST /api/register' || route === 'POST /api/login') {
    const body = await readJson(req);
    const { user, token } = route === 'POST /api/register' ? api.register(body) : api.login(body);
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (route === 'POST /api/logout') {
    api.logout(cookieOf(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  const user = api.userForToken(cookieOf(req));
  if (!user) throw new ApiError(401, 'Inicia sesión.');
  switch (route) {
    case 'GET /api/me': {
      const admin = api.isAdmin(user);
      return send(res, 200, { user, team: api.team(), spaces: api.spaces(user), isAdmin: admin, adminCode: admin ? api.teamCode : null });
    }
    case 'GET /api/pull':
      return send(res, 200, {
        ...api.pull(user, Number(url.searchParams.get('since') ?? 0) || 0), team: api.team(), spaces: api.spaces(user),
      });
    case 'POST /api/password':
      return send(res, 200, api.changePassword(user, await readJson(req)));
    case 'GET /api/admin':
      return send(res, 200, { users: api.adminUsers(user), spaces: api.adminSpaces(user), adminCode: api.teamCode });
    case 'POST /api/admin/role':
      return send(res, 200, { users: api.setAdmin(user, await readJson(req)) });
    case 'POST /api/admin/disable':
      return send(res, 200, { users: api.setDisabled(user, await readJson(req)) });
    case 'POST /api/admin/password':
      return send(res, 200, api.resetPassword(user, await readJson(req)));
    case 'POST /api/admin/code':
      return send(res, 200, api.regenerateAdminCode(user));
    case 'POST /api/spaces':
      return send(res, 200, { spaces: api.createSpace(user, await readJson(req)) });
    case 'POST /api/spaces/join':
      return send(res, 200, { spaces: api.joinSpace(user, await readJson(req)) });
    case 'POST /api/push': {
      const body = await readJson(req);
      return send(res, 200, api.push(user, Array.isArray(body.changes) ? (body.changes as Change[]) : []));
    }
    case 'GET /api/rally':
      return send(res, 200, rally.status(user));
    case 'POST /api/rally/connect':
      return send(res, 200, await rally.connect(user, await readJson(req)));
    case 'POST /api/rally/disconnect':
      return send(res, 200, rally.disconnect(user));
    case 'GET /api/rally/projects':
      return send(res, 200, { projects: await rally.projects(user) });
    case 'POST /api/rally/move': {
      const body = await readJson(req);
      try {
        const item = await rally.move(user, body);
        if (body.dryRun !== true) console.log(`[Rally] ${user.login}: ${String(body.id)} → ${String(body.category)} · ahora "${item.state}" (${item.category})`);
        return send(res, 200, { item });
      } catch (e) {
        console.log(`[Rally] ${user.login}: ${String(body.id)} → ${String(body.category)} · ERROR: ${(e as Error).message}`);
        throw e;
      }
    }
    case 'POST /api/rally/create': {
      const body = await readJson(req);
      try {
        const item = await rally.create(user, body);
        console.log(`[Rally] ${user.login}: creado ${item.id} "${item.name}"`);
        return send(res, 200, { item });
      } catch (e) {
        console.log(`[Rally] ${user.login}: crear ${String(body.kind)} · ERROR: ${(e as Error).message}`);
        throw e;
      }
    }
    case 'POST /api/rally/flag': {
      const body = await readJson(req);
      const item = await rally.flag(user, body);
      console.log(`[Rally] ${user.login}: ${String(body.id)} · Ready ${item.ready ? 'sí' : 'no'} · Blocked ${item.blocked ? 'sí' : 'no'}`);
      return send(res, 200, { item });
    }
    case 'POST /api/rally/need-review': {
      const body = await readJson(req);
      const done = await rally.needReview(user, body);
      console.log(`[Rally] ${user.login}: ${String(body.id)} → Need Review + Blocked (${String(body.defectId)})${done.commentError ? ` · comentario falló: ${done.commentError}` : ''}`);
      return send(res, 200, done);
    }
    case 'POST /api/rally/message': {
      const body = await readJson(req);
      const done = await rally.messagePost(user, body);
      console.log(`[Rally] ${user.login}: mensaje en ${String(body.id)}${done.mentioned.length ? ` · menciona a ${done.mentioned.join(', ')}` : ''}`);
      return send(res, 200, done);
    }
    case 'POST /api/rally/move-comment': {
      const body = await readJson(req);
      const done = await rally.moveCommentPost(user, body);
      console.log(`[Rally] ${user.login}: comentario de movimiento en ${String(body.id)}${done.analyst ? ` · analista ${done.analyst}` : ''}`);
      return send(res, 200, done);
    }
    case 'POST /api/rally/comment': {
      const body = await readJson(req);
      try {
        const post = await rally.comment(user, body);
        console.log(`[Rally] ${user.login}: comentario en ${String(body.kind)} ${String(body.objectId)}`);
        return send(res, 200, { post });
      } catch (e) {
        console.log(`[Rally] ${user.login}: comentario en ${String(body.kind)} ${String(body.objectId)} · ERROR: ${(e as Error).message}`);
        throw e;
      }
    }
    case 'POST /api/rally/attach': {
      const body = await readJson(req);
      try {
        const file = await rally.attach(user, body);
        console.log(`[Rally] ${user.login}: adjunto "${file.name}" en ${String(body.kind)} ${String(body.objectId)}`);
        return send(res, 200, { file });
      } catch (e) {
        console.log(`[Rally] ${user.login}: adjunto en ${String(body.kind)} ${String(body.objectId)} · ERROR: ${(e as Error).message}`);
        throw e;
      }
    }
    case 'GET /api/lista':
      return send(res, 200, msList.status(user));
    case 'POST /api/lista/link':
      return send(res, 200, msList.link(user));
    case 'POST /api/lista/unlink':
      return send(res, 200, msList.unlink(user));
    case 'GET /api/lista/items':
      return send(res, 200, await msList.items(user));
    case 'POST /api/lista/change':
      return send(res, 200, await msList.change(user, await readJson(req)));
    case 'GET /api/confluence':
      return send(res, 200, confluence.status(user));
    case 'POST /api/confluence/connect':
      return send(res, 200, await confluence.connect(user, await readJson(req)));
    case 'POST /api/confluence/disconnect':
      return send(res, 200, confluence.disconnect(user));
    case 'GET /api/confluence/tasks':
      return send(res, 200, { tasks: await confluence.tasks(user, { done: url.searchParams.get('done') }) });
    case 'GET /api/chats':
      return send(res, 200, chats.status(user));
    case 'POST /api/chats/link':
      return send(res, 200, chats.link(user));
    case 'POST /api/chats/unlink':
      return send(res, 200, chats.unlink(user));
    case 'GET /api/chats/data':
      return send(res, 200, await chats.chats(user));
    case 'GET /api/calendar':
      return send(res, 200, calendar.status(user));
    case 'POST /api/calendar/connect':
      return send(res, 200, await calendar.connect(user, await readJson(req)));
    case 'POST /api/calendar/disconnect':
      return send(res, 200, calendar.disconnect(user));
    case 'POST /api/calendar/file/link':
      return send(res, 200, calendar.linkFile(user));
    case 'POST /api/calendar/file/unlink':
      return send(res, 200, calendar.unlinkFile(user));
    case 'GET /api/calendar/events':
      return send(res, 200, await calendar.events(user));
    case 'GET /api/calendar/ics':
      return send(res, 200, { ics: await calendar.ics(user, url.searchParams.get('fresh') === '1') });
    case 'POST /api/rally/lookup':
      return send(res, 200, { items: await rally.lookup(user, await readJson(req)) });
    case 'GET /api/rally/users':
      return send(res, 200, { users: await rally.searchUsers(user, url.searchParams.get('q')) });
    case 'GET /api/rally/pick':
      return send(res, 200, await rally.searchArtifacts(user, Object.fromEntries(url.searchParams)));
    case 'GET /api/rally/tags':
      return send(res, 200, await rally.searchTags(user, Object.fromEntries(url.searchParams)));
    case 'GET /api/rally/form':
      return send(res, 200, await rally.formOptions(user, url.searchParams.get('kind'), url.searchParams.get('project')));
    case 'GET /api/rally/detail':
      return send(res, 200, await rally.detail(user, url.searchParams.get('kind'), url.searchParams.get('id')));
    case 'GET /api/rally/items': {
      const projects = (url.searchParams.get('projects') ?? '').split(',').filter(Boolean);
      const tags = url.searchParams.getAll('tag').filter(Boolean);
      return send(res, 200, await rally.itemsReport(user, Number(url.searchParams.get('days') ?? 90) || 0, projects, tags));
    }
    case 'POST /api/snapshot': {
      // Copia de seguridad de lo que había en el navegador antes de vaciarlo (por si acaso).
      const body = await readJson(req);
      const file = join(DATA, 'copias', `${user.login}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify(body, null, 2));
      return send(res, 200, { ok: true });
    }
  }
  // Acciones sobre un espacio: /api/spaces/<id>/<acción>
  const m = /^POST \/api\/spaces\/([\w-]+)\/(update|remove|role|admin-join)$/.exec(route);
  if (m) {
    const body = await readJson(req);
    const spaces = m[2] === 'update' ? api.updateSpace(user, m[1], body) : m[2] === 'remove' ? api.removeMember(user, m[1], body)
      : m[2] === 'admin-join' ? api.adminJoinSpace(user, m[1]) : api.setRole(user, m[1], body);
    return send(res, 200, { spaces });
  }
  throw new ApiError(404, 'No existe.');
}

function serveStatic(res: ServerResponse, url: URL) {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('La app no está compilada. Ejecuta `npm start`.');
  }
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const name = file.slice(DIST.length);
  // index.html y el service worker siempre frescos; los archivos con hash, en caché para siempre.
  const cache = name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  res.end(readFileSync(file));
}

const server = (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url);
  handleApi(req, res, url).catch((e: unknown) => {
    if (e instanceof ApiError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Error del servidor. Mira la terminal.' });
  });
};

let started = 0;
for (const host of HOSTS) {
  createServer(server)
    .on('error', (e: NodeJS.ErrnoException) => {
      if (host === '::1' && e.code === 'EADDRNOTAVAIL') return; // sin IPv6: basta con 127.0.0.1
      console.error(`No se pudo abrir el puerto ${PORT} en ${host}: ${e.message}`);
      process.exitCode = 1;
    })
    .listen(PORT, host, () => {
      if (started++) return;
      console.log(`\n✓ Gestor del equipo en http://localhost:${PORT}`);
      console.log(`  Código de administración (crea cuentas administradoras): ${api.teamCode}`);
      console.log('  Los compañeros entran con la invitación de su espacio (Ajustes → Espacios).');
      console.log('  Deja esta ventana abierta mientras uséis la app.\n');
    });
}
