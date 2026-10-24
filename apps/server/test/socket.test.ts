import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@movie/shared';
import { createSocketServer } from '../src/socket/server.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('WebSocket-мост TV ↔ пульт', () => {
  const http = createServer();
  const { io, rooms } = createSocketServer(http, { corsOrigins: [], roomGraceMs: 200 });
  let url = '';
  const clients: Client[] = [];

  const client = async (): Promise<Client> => {
    const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(c);
    await new Promise<void>((r) => c.once('connect', () => r()));
    return c;
  };
  const once = <E extends keyof ServerToClientEvents>(c: Client, ev: E, ms = 1000) =>
    new Promise<Parameters<ServerToClientEvents[E]>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout: ${ev}`)), ms);
      // @ts-expect-error — обобщённая подписка
      c.once(ev, (...args) => (clearTimeout(t), resolve(args)));
    });
  const nothing = (c: Client, ev: keyof ServerToClientEvents, ms = 150) =>
    new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error(`unexpected ${ev}`));
      c.once(ev, fail);
      setTimeout(() => (c.off(ev, fail), resolve()), ms);
    });

  before(async () => {
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  after(async () => {
    clients.forEach((c) => c.disconnect());
    rooms.dispose();
    await io.close();
  });

  it('pair → remote_key / text_input / cast_media доходят только до TV', async () => {
    const tv = await client();
    const created = await tv.emitWithAck('room:create');
    assert.ok(created.ok);
    const roomId = created.roomId;

    const phone = await client();
    const other = await client();
    const peers = once(tv, 'room:peers');
    const paired = await phone.emitWithAck('pair', { roomId, deviceName: 'iPhone' });
    assert.ok(paired.ok);
    assert.equal((await peers)[0][0]?.deviceName, 'iPhone');

    const key = once(tv, 'remote_key');
    phone.emit('remote_key', { key: 'left' });
    assert.deepEqual((await key)[0], { key: 'left' });

    const text = once(tv, 'text_input');
    phone.emit('text_input', { value: 'Матрица' });
    assert.equal((await text)[0].value, 'Матрица');

    const cast = once(tv, 'cast_media');
    phone.emit('cast_media', { media: { kind: 'movie', id: 603 } });
    assert.deepEqual((await cast)[0], { media: { kind: 'movie', id: 603 }, autoplay: true });

    // Невалидные данные и непарные сокеты отбрасываются.
    const silent = nothing(tv, 'remote_key');
    phone.emit('remote_key', { key: 'jump' as never });
    other.emit('remote_key', { key: 'up' });
    await silent;
  });

  it('tv_state уходит пультам и отдаётся новому пульту при pair', async () => {
    const tv = await client();
    const created = await tv.emitWithAck('room:create');
    assert.ok(created.ok);
    const phone = await client();
    await phone.emitWithAck('pair', { roomId: created.roomId });

    const state = { screen: 'browse' as const, searchQuery: 'дюна', player: null };
    const got = once(phone, 'tv_state');
    tv.emit('tv_state', state);
    assert.deepEqual((await got)[0], state);

    const late = await client();
    const res = await late.emitWithAck('pair', { roomId: created.roomId });
    assert.ok(res.ok);
    assert.deepEqual(res.tvState, state);

    // Пульт не может выдавать себя за TV.
    const silent = nothing(late, 'tv_state');
    phone.emit('tv_state', { ...state, searchQuery: 'fake' });
    await silent;
  });

  it('TV переподключается по токену, иначе комната закрывается', async () => {
    const tv = await client();
    const created = await tv.emitWithAck('room:create');
    assert.ok(created.ok);
    const phone = await client();
    await phone.emitWithAck('pair', { roomId: created.roomId });

    const offline = once(phone, 'room:tv_presence');
    tv.disconnect();
    assert.deepEqual((await offline)[0], { online: false });

    const tv2 = await client();
    assert.equal((await tv2.emitWithAck('room:resume', { roomId: created.roomId, tvToken: 'x'.repeat(32) })).ok, false);
    const online = once(phone, 'room:tv_presence');
    assert.ok((await tv2.emitWithAck('room:resume', { roomId: created.roomId, tvToken: created.tvToken })).ok);
    assert.deepEqual((await online)[0], { online: true });

    const closed = once(phone, 'room:closed', 1500);
    tv2.disconnect();
    await closed;
    assert.equal(rooms.get(created.roomId), undefined);
  });

  it('pair в несуществующую комнату', async () => {
    const phone = await client();
    const res = await phone.emitWithAck('pair', { roomId: 'abcdefgh' });
    assert.deepEqual(res, { ok: false, error: 'room_not_found' });
  });
});
