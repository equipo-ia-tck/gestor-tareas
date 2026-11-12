import { describe, expect, it } from 'vitest';
import { parseRallyRequest, rallyStateOf, REQUEST_TEMPLATES, requestTemplates } from '../src/domain/rallyRequest';

describe('Crear con petición (intérprete propio)', () => {
  it('lee la frase de ejemplo: tipo, owner, assignee y «undefined» como Defined', () => {
    const r = parseRallyRequest('crear feature con owner Matías Rodríguez, asigní Marc Crespo, con Pommel Undefined');
    expect(r).toMatchObject({ kind: 'FE', owner: 'Matías Rodríguez', assignee: 'Marc Crespo', state: 'Defined', name: '' });
    expect(r.unknown).toEqual(['Pommel']);
  });

  it('nombre, proyecto, release, iteración, etiquetas, puntos y padre', () => {
    const r = parseRallyRequest('Crea una US Login con SSO en el proyecto Team.Digital Data, release R2.3, sprint 14, etiquetas QA, Web y Mobile, 5 puntos, padre US1764574, ready');
    expect(r).toMatchObject({
      kind: 'US', name: 'Login con SSO', project: 'Team.Digital Data', release: 'R2.3', iteration: '14',
      tags: ['QA', 'Web', 'Mobile'], estimate: 5, parentId: 'US1764574', ready: true,
    });
    expect(r.unknown).toEqual([]);
  });

  it('nombre entre comillas, descripción larga, yo como owner y estado por palabra clave', () => {
    const r = parseRallyRequest('nuevo defecto "Error al guardar, a veces" owner yo, asignado a Ana López estado en curso, severidad Major, descripción falla al pulsar guardar, sale un 500');
    expect(r).toMatchObject({
      kind: 'DE', name: 'Error al guardar, a veces', owner: '@me', assignee: 'Ana López', state: 'In-Progress', severity: 'Major',
      description: 'falla al pulsar guardar, sale un 500',
    });
  });

  it('feature de una US, tarea dentro de un defecto y bloqueo con motivo', () => {
    expect(parseRallyRequest('user story Pagos F123 need review')).toMatchObject({ kind: 'US', name: 'Pagos', featureId: 'F123', state: 'Need Review' });
    expect(parseRallyRequest('tarea Revisar logs dentro de DE-55, bloqueada porque falta acceso')).toMatchObject({
      kind: 'TA', name: 'Revisar logs', parentId: 'DE55', blocked: true, blockedReason: 'falta acceso' });
    expect(parseRallyRequest('defect suite Regresión color rojo')).toMatchObject({ kind: 'DS', name: 'Regresión', color: '#ee1c25' });
  });

  it('feature: Preliminary Estimate, fechas planificadas y milestones', () => {
    const r = parseRallyRequest('crear feature Login SSO con owner Matías Rodríguez, release 2026-q4, preliminary estimate M, fecha de inicio 1 de diciembre, fecha fin 2026-12-20, milestones Go live y Piloto, descripcion akaak');
    expect(r).toMatchObject({
      kind: 'FE', name: 'Login SSO', owner: 'Matías Rodríguez', release: '2026-q4', preliminaryEstimate: 'M',
      plannedStart: '1 de diciembre', plannedEnd: '2026-12-20', milestones: ['Go live', 'Piloto'], description: 'akaak',
    });
    expect(r.unknown).toEqual([]);
    expect(parseRallyRequest('feature Pagos estimación preliminar XL').preliminaryEstimate).toBe('XL');
    const l = parseRallyRequest('feature Pagos estimación L');
    expect(l.preliminaryEstimate).toBe('L');
    expect(l.estimate).toBeUndefined();
    expect(parseRallyRequest('feature Pagos talla S, empieza el lunes, termina el 30 de enero')).toMatchObject({
      preliminaryEstimate: 'S', plannedStart: 'lunes', plannedEnd: '30 de enero' });
  });

  it('estados en español e inglés', () => {
    expect(rallyStateOf('undefined')).toBe('Defined');
    expect(rallyStateOf('en curso')).toBe('In-Progress');
    expect(rallyStateOf('Completada')).toBe('Completed');
    expect(rallyStateOf('nueva')).toBe('New');
    expect(rallyStateOf('cualquier cosa')).toBeNull();
  });

  it('las plantillas de cada tipo se leen enteras, sin Ready ni Blocked y asignadas a quien tiene la clave', () => {
    const t = Object.fromEntries(REQUEST_TEMPLATES.map((x) => [x.kind, parseRallyRequest(x.text)]));
    for (const [kind, r] of Object.entries(t)) {
      expect(r.kind, kind).toBe(kind);
      expect(r.unknown, kind).toEqual([]);
      expect(r.owner, kind).toBe('Matías Rodríguez');
      expect(r.ready, kind).toBeUndefined();
      expect(r.blocked, kind).toBeUndefined();
      expect(r.iteration, kind).toBeUndefined();
      expect(r.milestones, kind).toEqual([]);
      expect(r.assignee, kind).toBe(kind === 'FE' ? undefined : '@me');
    }
    expect(t.FE).toMatchObject({ name: 'Login con SSO', project: 'Team.Digital Data', release: '2026-Q4', preliminaryEstimate: 'M',
      plannedStart: '1 de diciembre', plannedEnd: '2026-12-20', tags: ['QA', 'Web'], color: '#105cab',
      description: 'Acceso único con la cuenta corporativa', notes: 'Revisar con seguridad' });
    expect(t.FE.state).toBe('Discovering');
    expect(t.FE.parentId).toBeUndefined();
    expect(t.US).toMatchObject({ name: 'Exportar informe a CSV', state: 'Defined', estimate: 5, parentId: 'US1764574', expedite: true,
      color: '#4a7c1e', notes: 'Formato acordado con negocio' });
    expect(t.US.featureId).toBeUndefined();
    expect(t.DE).toMatchObject({ name: 'Error 500 al guardar el perfil', state: 'In-Progress', estimate: 2, parentId: 'US1764574', severity: 'Major Problem',
      priority: 'High', expedite: true, description: 'Al pulsar Guardar en el perfil sale un error 500', notes: 'Pasa solo en Chrome' });
    expect(t.DE.environment).toBeUndefined();
    expect(t.DS).toMatchObject({ name: 'Regresión del login', tags: ['QA', 'Regresión'], estimate: 3, color: '#f76c02', expedite: true });
    expect(t.TS).toMatchObject({ name: 'Pruebas de regresión del login', tags: ['QA', 'Automatizadas'], estimate: 8, notes: 'Ejecutar en preproducción' });
    expect(t.TA).toMatchObject({ name: 'Revisar logs del servidor', parentId: 'US1764574', state: 'In-Progress', estimate: 4, color: '#848689',
      notes: 'Pedir acceso a sistemas' });
  });

  it('plantillas propias o las de serie', () => {
    expect(requestTemplates(null).map((t) => t.label)).toEqual(['Feature', 'User Story', 'Defect', 'Defect Suite', 'Test Set', 'Task']);
    const own = [{ id: 'a', label: 'Mi US', text: 'crear US "X"' }];
    expect(requestTemplates(own)).toBe(own);
    expect(requestTemplates([])).toEqual([]);
  });
});
