import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/domain/ics';
import { icsFileName, taskToIcs } from '../src/domain/icsExport';
import { makeTask } from './factories';

const now = new Date('2026-10-08T10:00:00Z');

describe('exportar a Outlook (.ics)', () => {
  it('sin fecha ni aviso no genera nada', () => {
    expect(taskToIcs(makeTask(), { now })).toBeNull();
  });

  it('con fecha: ese día a las 9:00 hora local, 15 min, con alarma', () => {
    const ics = taskToIcs(makeTask({ id: 't1', title: 'Conciliar pagos', due_date: '2026-10-15', people: ['Diana'] }), { now, projectPath: 'caixa / Pagos' })!;
    expect(ics).toContain('DTSTART:20261015T070000Z'); // 9:00 en Madrid (horario de verano)
    expect(ics).toContain('DTEND:20261015T071500Z');
    expect(ics).toContain('UID:t1@gestor-tareas');
    expect(ics).toContain('TRIGGER:-PT0M');
    expect(ics).toContain('Proyecto: caixa / Pagos');
  });

  it('con recordatorio: a esa hora, y escapa comas y saltos de línea', () => {
    const ics = taskToIcs(makeTask({ title: 'Revisar US, TS', external_id: 'US-12', remind_at: '2026-10-09T15:30:00.000Z', notes: 'línea 1\nlínea 2' }), { now })!;
    expect(ics).toContain('DTSTART:20261009T153000Z');
    expect(ics).toContain('SUMMARY:US-12 · Revisar US\\, TS');
    expect(ics).toContain('línea 1\\nlínea 2');
  });

  it('el archivo generado se puede volver a leer (formato válido)', () => {
    const ics = taskToIcs(makeTask({ title: 'Demo con negocio', due_date: '2026-10-15' }), { now })!;
    const [e] = parseIcs(ics, '2026-10-01', '2026-10-31');
    expect(e).toMatchObject({ title: 'Demo con negocio', date: '2026-10-15', time: '09:00' });
  });

  it('nombre de archivo', () => {
    expect(icsFileName({ title: 'Revisión: login SSO ¡ya!' })).toBe('Revision-login-SSO-ya.ics');
  });
});
