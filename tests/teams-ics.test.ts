import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/domain/ics';
import { notesByTask, notesForTask } from '../src/domain/notes';
import { findTeamsLink, meetingSummary, teamsChatUrl } from '../src/domain/teams';
import type { Note } from '../src/domain/types';
import { makeTask } from './factories';

const note = (extra: Partial<Note>): Note => ({
  id: crypto.randomUUID(), title: 'Daily', body: '', kind: 'meeting', date: '2026-10-07', project_id: null, people: [],
  pinned: false, task_id: null, meeting_url: null, created_at: '2026-10-07T09:00:00Z', updated_at: '', deleted_at: null, ...extra,
});

describe('notas de elementos', () => {
  it('por elemento, las más recientes primero; grupos por la nota más reciente', () => {
    const a1 = note({ task_id: 'a', date: '2026-10-01' });
    const a2 = note({ task_id: 'a', date: '2026-10-05' });
    const b1 = note({ task_id: 'b', date: '2026-10-06' });
    const other = note({ task_id: 'c', date: '2026-10-07' });
    const gone = note({ task_id: 'a', deleted_at: 'x' });
    expect(notesForTask('a', [a1, a2, gone]).map((n) => n.date)).toEqual(['2026-10-05', '2026-10-01']);
    expect(notesByTask(new Set(['a', 'b']), [a1, a2, b1, other]).map((g) => [g.taskId, g.notes.length])).toEqual([['b', 1], ['a', 2]]);
  });
});

describe('Teams', () => {
  const body = `**Asistentes:** @Diana @Luis

## Decisiones
- @Diana: el **login** va en la R2.3

## Acciones
- [ ] enviar resumen a @Diana [[t:t1]]
- [x] actualizar tablero`;

  it('resumen del acta con decisiones y acciones (estado de la tarea enlazada)', () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'done', due_date: '2026-10-08' })]]);
    expect(meetingSummary(note({ title: 'Revisión sprint', body, people: ['Diana', 'Luis'] }), tasks)).toBe([
      'Revisión sprint · 07/10/2026',
      'Asistentes: Diana, Luis',
      '',
      'Decisiones:',
      '• Diana: el login va en la R2.3',
      '',
      'Acciones:',
      '☑ enviar resumen a Diana (08/10)',
      '☑ actualizar tablero',
    ].join('\n'));
  });

  it('enlace de chat con varias personas, tema y mensaje', () => {
    const url = teamsChatUrl(['diana@empresa.com', ' luis@empresa.com', 'no-es-email'], 'Revisión', 'Hola');
    expect(url).toBe('https://teams.microsoft.com/l/chat/0/0?users=diana%40empresa.com%2Cluis%40empresa.com&topicName=Revisi%C3%B3n&message=Hola');
    expect(teamsChatUrl(['no-es-email'])).toBeNull();
  });

  it('encuentra el enlace de reunión de Teams en un texto', () => {
    expect(findTeamsLink('Unirse: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x <fin>'))
      .toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x');
    expect(findTeamsLink('sin enlace')).toBeNull();
  });
});

describe('archivo .ics', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:a1',
    'SUMMARY:Revisión sprint 14',
    'DTSTART;TZID=Romance Standard Time:20261008T100000',
    'ORGANIZER;CN="Diana Pérez":mailto:diana@empresa.com',
    'ATTENDEE;ROLE=REQ-PARTICIPANT;CN=Luis Gómez:mailto:luis@empresa.com',
    'DESCRIPTION:Únete: https://teams.microsoft.com/l/meetup-join/19%3a',
    ' meeting_xyz%40thread.v2/0\\nAgenda\\, temas',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:daily',
    'SUMMARY:Daily QA',
    'DTSTART:20261005T070000Z',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6',
    'EXDATE:20261009T070000Z',
    'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/daily',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:c',
    'SUMMARY:Cancelada',
    'STATUS:CANCELLED',
    'DTSTART;VALUE=DATE:20261008',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:old',
    'SUMMARY:Antigua',
    'DTSTART;VALUE=DATE:20250101',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const events = parseIcs(ics, '2026-10-01', '2026-10-31');

  it('lee título, fecha, hora, asistentes y enlace de Teams (con líneas plegadas)', () => {
    const e = events.find((x) => x.uid === 'a1')!;
    expect(e).toMatchObject({ title: 'Revisión sprint 14', date: '2026-10-08', time: '10:00' });
    expect(e.attendees).toEqual([{ name: 'Diana Pérez', email: 'diana@empresa.com' }, { name: 'Luis Gómez', email: 'luis@empresa.com' }]);
    expect(e.url).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_xyz%40thread.v2/0');
    expect(e.description).toContain('Agenda, temas');
  });

  it('expande las recurrentes en la ventana y respeta EXDATE y COUNT', () => {
    const daily = events.filter((x) => x.uid === 'daily').map((x) => x.date);
    expect(daily).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-16']);
    expect(events.find((x) => x.uid === 'daily')!.time).toBe('09:00'); // 07:00 UTC = 09:00 en Madrid (horario de verano)
  });

  it('ignora canceladas y eventos fuera de la ventana', () => {
    expect(events.map((x) => x.title)).not.toContain('Cancelada');
    expect(events.map((x) => x.title)).not.toContain('Antigua');
  });
});
