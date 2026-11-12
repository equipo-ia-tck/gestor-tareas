import { RALLY_COLORS, type RallyCreatableKind } from './rally';
import { fold } from './text';
import type { RequestTemplate } from './types';

/**
 * Intérprete propio de «Crear con petición» (sin IA ni servicios externos): de una frase como «crear feature Login SSO
 * con owner Matías Rodríguez, asignado a Marc Crespo, en defined, proyecto Team Digital, release R2.3, etiquetas QA y
 * Web» saca los campos del alta de Rally. Los nombres (personas, proyecto, release…) quedan como texto: la pantalla los
 * busca en Rally. `unknown` lleva los trozos que no ha sabido leer, para que la persona los revise.
 */
export interface RallyRequest {
  kind: RallyCreatableKind | null;
  name: string;
  /** Nombre a buscar en Rally, o `@me` para «yo / mí». */
  owner?: string;
  assignee?: string;
  project?: string;
  /** Columna o estado: New, Defined, In-Progress, Need Review, Completed, Accepted (o el texto tal cual). */
  state?: string;
  release?: string;
  iteration?: string;
  tags: string[];
  /** FormattedID del padre (US, defecto, portfolio item) y de la feature de una US. */
  parentId?: string;
  featureId?: string;
  estimate?: number;
  /** Feature: talla de Preliminary Estimate (XS, S, M…), y fechas planificadas tal como se han dicho («15 de enero»). */
  preliminaryEstimate?: string;
  plannedStart?: string;
  plannedEnd?: string;
  milestones: string[];
  description?: string;
  notes?: string;
  color?: string;
  ready?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  expedite?: boolean;
  severity?: string;
  priority?: string;
  environment?: string;
  unknown: string[];
}

type Field = 'name' | 'owner' | 'assignee' | 'project' | 'state' | 'release' | 'iteration' | 'tags' | 'parent' | 'estimate'
  | 'preliminary' | 'plannedStart' | 'plannedEnd' | 'milestones'
  | 'description' | 'notes' | 'color' | 'severity' | 'priority' | 'environment' | 'blockedReason';

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';

/** Palabras clave de cada campo (en español e inglés, con y sin tildes, y lo que suele salir al dictar). */
const KEYWORDS: [Field, string][] = [
  ['blockedReason', 'bloquead[oa]\\s+(?:porque|por)|motivo(?:\\s+del?\\s+bloqueo)?|blocked\\s+reason'],
  ['owner', 'owner|owned\\s+by|propietari[oa]|due[ñn][oa]|po'],
  ['assignee', 'as+ign(?:ee|é|e|í|i)|as+ignad[oa](?:\\s+a)?|as+ignar(?:l[oa]|sel[oa])?\\s+a|as+igna(?:l[oa])?\\s+a|assigned\\s+to'],
  ['project', 'proyecto|project'],
  ['state', 'flow\\s*state|schedule\\s*state|estado|state|columna|status'],
  ['release', 'release|versi[oó]n'],
  ['iteration', 'iteraci[oó]n|iteration|sprint'],
  ['tags', 'etiquetas?|tags?'],
  ['parent', 'padre|parent|work\\s*product|dentro\\s+de|hij[oa]\\s+de|colgando\\s+de'],
  ['preliminary', 'preliminary\\s*estimate|estimaci[oó]n\\s+preliminar|pre-?estimaci[oó]n|talla|tama[ñn]o|t-?shirt(?:\\s*size)?|size'],
  ['plannedStart', 'planned\\s*start(?:\\s*date)?|fecha\\s+(?:de\\s+)?inicio|inicio\\s+planificado|empieza(?:\\s+el)?|comienza(?:\\s+el)?|start\\s*date'],
  ['plannedEnd', 'planned\\s*end(?:\\s*date)?|fecha\\s+(?:de\\s+)?fin(?:al)?|fin\\s+planificado|termina(?:\\s+el)?|acaba(?:\\s+el)?|end\\s*date|fecha\\s+de\\s+entrega'],
  ['milestones', 'milestones?|hitos?'],
  ['estimate', 'plan\\s*estimate|estimaci[oó]n|estimate|story\\s*points'],
  ['description', 'descripci[oó]n|description|detalle'],
  ['notes', 'notas?|notes'],
  ['name', 'nombre|t[ií]tulo|title|name|llamad[oa]|que\\s+se\\s+llame'],
  ['color', 'color'],
  ['severity', 'severidad|severity'],
  ['priority', 'prioridad|priority'],
  ['environment', 'entorno|environment'],
];
const KEYWORD_RE = new RegExp(KEYWORDS.map(([, re], i) => `(?<k${i}>${L}(?:${re})${R})`).join('|'), 'giu');

/** Campos de texto largo: llegan hasta la siguiente palabra clave (con comas incluidas). */
const LONG: Field[] = ['name', 'description', 'notes', 'blockedReason'];

const KINDS: [RallyCreatableKind, string][] = [
  ['DS', 'defect\\s*suite|ds'],
  ['FE', 'features?|feat'],
  ['US', 'user\\s*stor(?:y|ies)|historias?(?:\\s+de\\s+usuario)?|us'],
  ['DE', 'defect[oa]?s?|bugs?|incidencia'],
  ['TS', 'test\\s*sets?|ts'],
  ['TA', 'tareas?|tasks?'],
];

/** Palabras sueltas que unen la frase y no son parte de ningún valor. */
const FILLER = new Set(['con', 'y', 'e', 'en', 'el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'para', 'que', 'un', 'una', 'por',
  'poner', 'pon', 'ponlo', 'ponla', 'ponle', 'ponerlo', 'ponerla', 'and', 'with', 'in', 'the', 'to', 'as', 'como', 'lo', 'le', 'me', 'se',
  'crear', 'crea', 'creame', 'créame', 'creeme', 'hazme', 'haz', 'genera', 'generar', 'quiero', 'necesito', 'create', 'nueva', 'nuevo',
  'otra', 'otro', 'esta', 'este', 'mueve', 'muevelo', 'muévelo', 'dejalo', 'déjalo', 'dejala', 'déjala', 'favor', 'porfa', 'please']);

const STATES: [string, RegExp][] = [
  ['Need Review', /need\s*(?:to\s*)?review|en\s+revision|revision/],
  ['In-Progress', /in[-\s]?progress|en\s+curso|en\s+progreso|progreso|doing/],
  ['Completed', /completed|completad[oa]|terminad[oa]|finalizad[oa]|done/],
  ['Accepted', /accepted|aceptad[oa]/],
  // «undefined» es como suele salir «en defined» al dictar.
  ['Defined', /(?:un)?defined|definid[oa]/],
  ['Blocked', /blocked|bloquead[oa]/],
  ['New', /^new$|^nuev[oa]$/],
];
/** Columna de Rally de un texto («en curso», «undefined»…) o null. */
export function rallyStateOf(text: string): string | null {
  const t = fold(text).trim();
  return STATES.find(([, re]) => re.test(t))?.[0] ?? null;
}
/** Estado dicho sin palabra clave («…, en defined», «con Pommel Undefined»). «new» solo detrás de «en / a / in / to». */
const BARE_STATE = new RegExp(`${L}(?:need\\s*(?:to\\s*)?review|in[-\\s]?progress|en\\s+curso|(?:un)?defined|completed|accepted|(?<=(?:en|a|in|to)\\s+)new)${R}`, 'iu');

const ID_RE = /(?<![\p{L}\p{N}])((?:US|DE|DS|TS|TA|FE|F|PI|I|E)-?\d{1,12})(?![\p{L}\p{N}])/gu;

const tidy = (s: string) => {
  const words = s.replace(/["«»“”]/g, ' ').replace(/[\s:]+/g, ' ').trim().split(' ');
  while (words.length && (FILLER.has(fold(words[0])) || /^[,;.]$/.test(words[0]))) words.shift();
  while (words.length && (FILLER.has(fold(words[words.length - 1])) || /^[,;.]$/.test(words[words.length - 1]))) words.pop();
  return words.join(' ').replace(/^[,;.\s]+|[,;.\s]+$/g, '');
};
const tidyEnd = (s: string) => {
  const words = s.replace(/\s+/g, ' ').replace(/^[\s:,;]+/, '').trim().split(' ');
  while (words.length && (FILLER.has(fold(words[words.length - 1])) || /^[,;.]$/.test(words[words.length - 1]))) words.pop();
  return words.join(' ').replace(/[,;\s]+$/g, '');
};
const person = (s: string) => (/^(?:yo|mi|mí|me|myself|me mismo|a mi|a mí)$/i.test(fold(s).trim()) ? '@me' : s);

/** Plantillas de «Crear con petición»: una por tipo, con todos los campos que tiene (los tests comprueban que se leen enteras). */
export const REQUEST_TEMPLATES: { kind: RallyCreatableKind; label: string; text: string }[] = [
  // Sin Ready ni Blocked, y sin valores de ejemplo que no existan en Rally (sprint, milestones, padre o feature inventados).
  // El Assignee es «mí»: la persona de la clave de Rally conectada.
  { kind: 'FE', label: 'Feature', text: 'crear feature "Login con SSO" con owner Matías Rodríguez, proyecto Team.Digital Data, estado Discovering, release 2026-Q4, preliminary estimate M, fecha de inicio 1 de diciembre, fecha fin 2026-12-20, etiquetas QA y Web, color azul, descripción Acceso único con la cuenta corporativa, notas Revisar con seguridad' },
  { kind: 'US', label: 'User Story', text: 'crear user story "Exportar informe a CSV" con owner Matías Rodríguez, asignado a mí, proyecto Team.Digital Data, estado Defined, release 2026-Q4, 5 puntos, padre US1764574, etiquetas QA y Web, color verde, urgente, descripción Botón para descargar el informe en CSV, notas Formato acordado con negocio' },
  { kind: 'DE', label: 'Defect', text: 'crear defecto "Error 500 al guardar el perfil" con owner Matías Rodríguez, asignado a mí, proyecto Team.Digital Data, estado In-Progress, release 2026-Q4, 2 puntos, padre US1764574, severidad Major Problem, prioridad High, etiquetas QA, color rojo, urgente, descripción Al pulsar Guardar en el perfil sale un error 500, notas Pasa solo en Chrome' },
  { kind: 'DS', label: 'Defect Suite', text: 'crear defect suite "Regresión del login" con owner Matías Rodríguez, asignado a mí, proyecto Team.Digital Data, estado Defined, release 2026-Q4, 3 puntos, etiquetas QA y Regresión, color naranja, urgente, descripción Agrupa los defectos de la regresión del login, notas Cerrar cuando estén todos validados' },
  { kind: 'TS', label: 'Test Set', text: 'crear test set "Pruebas de regresión del login" con owner Matías Rodríguez, asignado a mí, proyecto Team.Digital Data, estado Defined, release 2026-Q4, 8 puntos, etiquetas QA y Automatizadas, color morado, descripción Casos de prueba de la regresión, notas Ejecutar en preproducción' },
  { kind: 'TA', label: 'Task', text: 'crear tarea "Revisar logs del servidor" con owner Matías Rodríguez, asignado a mí, padre US1764574, estado In-Progress, estimación 4, etiquetas QA, color gris, descripción Buscar el error 500 en los logs de producción, notas Pedir acceso a sistemas' },
];

/** Plantillas de la persona (sus ajustes) o, si no ha cambiado nada, las de serie. */
export function requestTemplates(own: RequestTemplate[] | null | undefined): RequestTemplate[] {
  return own ?? REQUEST_TEMPLATES.map((t) => ({ id: t.kind, label: t.label, text: t.text }));
}

export function parseRallyRequest(input: string): RallyRequest {
  const text = input.replace(/\s+/g, ' ').trim();
  const out: RallyRequest = { kind: null, name: '', tags: [], milestones: [], unknown: [] };
  // Lo entrecomillado es el nombre y no se mira por dentro.
  let free = text;
  const quoted = /["«“]([^"»”]+)["»”]/.exec(text);
  if (quoted) { out.name = quoted[1].trim(); free = text.replace(quoted[0], ' ¶ '); }

  // Trozos por palabra clave: [inicio de la clave, fin de la clave, campo].
  const marks = [...free.matchAll(KEYWORD_RE)].map((m) => {
    const i = Number(Object.entries(m.groups!).find(([, v]) => v !== undefined)![0].slice(1));
    return { start: m.index!, end: m.index! + m[0].length, field: KEYWORDS[i][0] };
  });
  const pool: string[] = [free.slice(0, marks[0]?.start ?? free.length)];
  marks.forEach((m, i) => {
    const until = marks[i + 1]?.start ?? free.length;
    let value = free.slice(m.end, until);
    if (!LONG.includes(m.field)) {
      // Un solo valor: hasta la primera coma o «con / y» (las etiquetas admiten varias, separadas por coma o «y»).
      const cut = m.field === 'tags' || m.field === 'milestones' ? /\s+(?:con|with)\s+|[;\n]/i.exec(value) : /,|;|\s(?:con|with|y|and)\s/i.exec(value);
      if (cut) { pool.push(value.slice(cut.index)); value = value.slice(0, cut.index); }
    }
    // Los textos largos (nombre, descripción, notas, motivo) se quedan como están; solo se quita la unión del final.
    const v = LONG.includes(m.field) ? tidyEnd(value) : tidy(value);
    if (!v) return;
    switch (m.field) {
      case 'owner': out.owner = person(v); break;
      case 'assignee': out.assignee = person(v); break;
      case 'project': out.project = v; break;
      case 'state': out.state = rallyStateOf(value) ?? rallyStateOf(v) ?? v; break;
      case 'release': out.release = v; break;
      case 'iteration': out.iteration = v; break;
      case 'tags':
        for (const t of v.split(/\s*(?:,|\sy\s|\sand\s)\s*/i).map(tidy).filter(Boolean)) {
          // «…, 5 puntos» al final de la lista es la estimación, no una etiqueta.
          const pts = /^(\d+(?:[.,]\d+)?)\s*(?:puntos|points|pts|sp)$/i.exec(t);
          if (pts) out.estimate ??= Number(pts[1].replace(',', '.'));
          else out.tags.push(t);
        }
        break;
      case 'parent': { const id = [...v.matchAll(ID_RE)][0]?.[1]; if (id) setParent(out, id); else out.unknown.push(`padre «${v}»`); break; }
      // «estimación M» (sin número) es la talla de una feature.
      case 'estimate': { const n = /\d+(?:[.,]\d+)?/.exec(v); if (n) out.estimate = Number(n[0].replace(',', '.')); else out.preliminaryEstimate = v; break; }
      case 'preliminary': out.preliminaryEstimate = v; break;
      case 'plannedStart': out.plannedStart = v; break;
      case 'plannedEnd': out.plannedEnd = v; break;
      case 'milestones': out.milestones.push(...v.split(/\s*(?:,|\sy\s|\sand\s)\s*/i).map(tidy).filter(Boolean)); break;
      case 'description': out.description = v; break;
      case 'notes': out.notes = v; break;
      case 'name': if (!out.name) out.name = v; break;
      case 'color': { const c = RALLY_COLORS.find((x) => fold(v).startsWith(fold(x.name))); if (c) out.color = c.hex; else out.unknown.push(`color «${v}»`); break; }
      case 'severity': out.severity = v; break;
      case 'priority': out.priority = v; break;
      case 'environment': out.environment = v; break;
      case 'blockedReason': out.blocked = true; out.blockedReason = v; break;
    }
  });

  // Lo que queda sin palabra clave: tipo, nombre, IDs, estado suelto, marcas. «§» separa lo de antes de la primera
  // palabra clave (de donde sale el nombre) del resto.
  let rest = `${pool[0]} § ${pool.slice(1).join(' , ')}`;
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.slice(0, m.index) + ' , ' + rest.slice(m.index + m[0].length); return m; };
  const kindRe = (re: string) => new RegExp(`${L}(?:${re})${R}`, 'iu');
  const found = KINDS.map(([kind, re]) => ({ kind, re, at: rest.search(kindRe(re)) })).filter((k) => k.at >= 0).sort((a, b) => a.at - b.at)[0];
  if (found) { out.kind = found.kind; take(kindRe(found.re)); }
  // «feature F123», «la US US456»: la palabra del tipo delante de un ID no es parte del nombre.
  rest = rest.replace(/(?<![\p{L}\p{N}])(?:(?:la|el)\s+)?(?:features?|user\s*story|historia|us|defect[oa]?|test\s*set|portfolio\s*item)\s+(?=(?:US|DE|DS|TS|TA|FE|F|PI)-?\d)/giu, ' ');
  for (const m of [...rest.matchAll(ID_RE)]) setParent(out, m[1]);
  rest = rest.replace(ID_RE, ' , ');
  if (!out.state) { const m = take(BARE_STATE); if (m) out.state = rallyStateOf(m[0]) ?? m[0]; }
  if (take(kindRe('ready'))) out.ready = true;
  if (take(kindRe('expedite|urgente'))) out.expedite = true;
  if (take(kindRe('bloquead[oa]|blocked'))) out.blocked = true;
  const pts = take(/(\d+(?:[.,]\d+)?)\s*(?:puntos|points|pts|sp)(?![\p{L}])/iu);
  if (pts && out.estimate === undefined) out.estimate = Number(pts[1].replace(',', '.'));
  // La feature solo es un campo de las US; en el resto, un ID de feature es el padre.
  if (out.kind !== 'US' && out.featureId) { out.parentId ??= out.featureId; delete out.featureId; }

  const split = (s: string) => s.split(/\s*[,;¶]\s*/).map(tidy).filter((p) => /[\p{L}\p{N}]/u.test(p));
  const [head, tail = ''] = rest.split('§');
  const headPieces = split(head);
  if (!out.name && headPieces.length) out.name = headPieces.shift()!;
  out.unknown.push(...headPieces, ...split(tail));
  return out;
}

function setParent(out: RallyRequest, raw: string) {
  const id = raw.replace(/-/g, '').toUpperCase();
  // La feature de una US va en su campo; el resto es el padre.
  if (/^FE?\d/.test(id) && out.kind !== 'FE' && !out.featureId) out.featureId = id;
  else if (!out.parentId) out.parentId = id;
}
