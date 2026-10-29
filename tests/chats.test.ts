import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Api } from '../servidor/api.ts';
import { Chats } from '../servidor/chats.ts';
import { chatTitle, isUnread, teamsText, trimTeamsChats } from '../src/domain/teamsChats';

// Lo que devuelve Graph (vía «Enviar una solicitud HTTP de Microsoft Graph»): /me/chats?$expand=lastMessagePreview
const meetingChat = {
  id: '19:meeting_a@thread.v2', topic: 'Equipo · daily', chatType: 'meeting', createdDateTime: '2026-10-01T08:00:00Z',
  lastUpdatedDateTime: '2026-10-29T09:10:00Z', webUrl: 'https://teams.microsoft.com/l/chat/19%3Ameeting_a%40thread.v2/0',
  viewpoint: { isHidden: false, lastMessageReadDateTime: '2026-10-29T09:00:00Z' },
  lastMessagePreview: {
    id: '3', createdDateTime: '2026-10-29T09:05:00Z', isDeleted: false, messageType: 'message', eventDetail: null,
    from: { user: { displayName: 'Diana Pérez' } }, body: { contentType: 'html', content: '<p>Os paso el informe <emoji alt="👍"></emoji></p>' },
  },
};
const groupChat = {
  id: '19:group_b@thread.v2', topic: null, chatType: 'group', lastUpdatedDateTime: '2026-10-28T16:00:00Z', webUrl: null,
  viewpoint: { lastMessageReadDateTime: '2026-10-28T17:00:00Z' },
  lastMessagePreview: { id: '9', createdDateTime: '2026-10-28T16:00:00Z', messageType: 'message', from: { user: { displayName: 'Ana López' } }, body: { contentType: 'text', content: 'Vale' } },
};
// /me/chats/{id}/messages
const messages = {
  '@odata.count': 3,
  value: [
    { id: '3', createdDateTime: '2026-10-29T09:05:00Z', messageType: 'message', from: { user: { displayName: 'Diana Pérez' } },
      body: { contentType: 'html', content: '<p>Os paso el informe <emoji alt="👍"></emoji></p><attachment id="x"></attachment>' } },
    { id: '2', createdDateTime: '2026-10-29T09:00:00Z', messageType: 'systemEventMessage', from: null, body: { contentType: 'html', content: '<systemEventMessage/>' } },
    { id: '1', createdDateTime: '2026-10-29T08:55:00Z', messageType: 'message', from: { user: { displayName: 'Luis Gómez' } },
      body: { contentType: 'html', content: '<div>¿Cómo va el <b>informe</b>?<br>Lo necesito &amp; rápido</div>' } },
    { id: '0', createdDateTime: '2026-10-29T08:50:00Z', messageType: 'message', deletedDateTime: '2026-10-29T08:51:00Z', from: null, body: { contentType: 'html', content: '' } },
  ],
};

describe('chats de Teams: lectura', () => {
  it('texto sin HTML: emojis, saltos, entidades y adjuntos', () => {
    expect(teamsText({ contentType: 'html', content: '<div>¿Cómo va el <b>informe</b>?<br>Lo necesito &amp; rápido</div>' })).toBe('¿Cómo va el informe?\nLo necesito & rápido');
    expect(teamsText({ contentType: 'html', content: '<p>Ok <emoji alt="👍"></emoji></p><attachment id="1"></attachment>' })).toBe('Ok 👍\n[adjunto]');
    expect(teamsText({ contentType: 'text', content: ' hola ' })).toBe('hola');
  });

  it('acepta la lista de chats tal cual ({ value }) y la lista de { chat, messages }', () => {
    const solo = trimTeamsChats({ '@odata.count': 2, value: [groupChat, meetingChat] });
    expect(solo.map((c) => c.id)).toEqual([meetingChat.id, groupChat.id]); // el más reciente primero
    expect(solo[0]).toMatchObject({ topic: 'Equipo · daily', type: 'meeting', messages: [], lastMessage: { from: 'Diana Pérez', text: 'Os paso el informe 👍' } });

    const [full] = trimTeamsChats([{ chat: meetingChat, messages }]);
    expect(full.messages.map((m) => [m.id, m.system])).toEqual([['1', false], ['2', true], ['3', false]]); // sin el borrado, en orden
    expect(full.members).toEqual(['Luis Gómez', 'Diana Pérez']);
    expect(full.lastMessage?.text).toBe('Os paso el informe 👍\n[adjunto]');
  });

  it('título y no leídos', () => {
    const [meeting, group] = trimTeamsChats([meetingChat, groupChat]);
    expect(chatTitle(group, 'Luis Gómez')).toBe('Ana López');
    expect(chatTitle(meeting, null)).toBe('Equipo · daily');
    expect(isUnread(meeting, 'Luis Gómez')).toBe(true); // 09:05 > leído a las 09:00
    expect(isUnread(group, 'Luis Gómez')).toBe(false);
    expect(trimTeamsChats('no')).toEqual([]);
  });
});

describe('chats de Teams: servidor', () => {
  it('vincula el archivo a una sola cuenta, lo relee al cambiar y avisa si no es JSON', async () => {
    const db = new DatabaseSync(':memory:');
    const api = new Api(db);
    const marta = api.register({ login: 'marta@vml.com', name: 'Marta', password: 'contraseña-larga', code: api.teamCode }).user;
    const luis = api.register({ login: 'luis@vml.com', name: 'Luis', password: 'contraseña-larga', code: api.teamCode }).user;
    const path = join(mkdtempSync(join(tmpdir(), 'chats-')), 'chats.json');
    writeFileSync(path, JSON.stringify({ value: [meetingChat] }));
    const chats = new Chats(db, () => path);
    expect(chats.status(marta)).toEqual({ linked: false, found: true });
    await expect(chats.chats(marta)).rejects.toThrow(/Vincula/);
    chats.link(marta);
    expect(() => chats.link(luis)).toThrow(/otra cuenta/);
    expect((await chats.chats(marta)).chats).toHaveLength(1);
    writeFileSync(path, '﻿' + JSON.stringify([{ chat: meetingChat, messages }, groupChat]));
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    const second = await chats.chats(marta);
    expect(second.chats).toHaveLength(2);
    expect(second.updatedAt).toMatch(/^\d{4}-/);
    writeFileSync(path, '{ a medias');
    utimesSync(path, new Date(), new Date(Date.now() + 10000));
    await expect(chats.chats(marta)).rejects.toThrow(/JSON/);
    chats.unlink(marta);
    expect(chats.status(marta).linked).toBe(false);
    expect(new Chats(db, () => null).status(luis)).toEqual({ linked: false, found: false });
  });
});
