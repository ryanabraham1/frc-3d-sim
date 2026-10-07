import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachRelay, type Relay } from '../server/relay';
import { NetClient } from '../src/engine/net/netClient';
import type { RelayEvent } from '../src/engine/net/relayProtocol';

let server: Server;
let relay: Relay;
let url: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = createServer();
  relay = attachRelay(server, { rejectOtherPaths: true, reconnectGraceMs: 400, limits: { creates: 6, badJoins: 4 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await relay.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

/** A test peer that queues text events and binary frames. */
async function peer() {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const events: RelayEvent[] = [];
  const bins: Buffer[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d, bin) => {
    if (bin) bins.push(d as Buffer);
    else events.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((r) => ws.once('open', r));
  const next = async <T extends RelayEvent['op']>(op: T): Promise<Extract<RelayEvent, { op: T }>> => {
    for (;;) {
      const i = events.findIndex((e) => e.op === op);
      if (i >= 0) return events.splice(i, 1)[0] as Extract<RelayEvent, { op: T }>;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const nextBin = async (): Promise<Buffer> => {
    while (!bins.length) await new Promise<void>((r) => waiters.push(r));
    return bins.shift()!;
  };
  return { ws, events, bins, next, nextBin, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

describe('relay', () => {
  it('probes readiness over WebSocket without creating a room', async () => {
    expect(await NetClient.probe(url, 1000)).toBe(true);
    expect(relay.roomCount()).toBe(0);
  });

  it('creates a room, joins it and routes messages host <-> clients', async () => {
    const host = await peer();
    host.send({ op: 'create', name: 'Host' });
    const created = await host.next('created');
    expect(created.room).toMatch(/^[A-Z]{4}$/);

    const a = await peer();
    a.send({ op: 'join', room: created.room.toLowerCase(), name: 'Alice' });
    const joined = await a.next('joined');
    expect(joined.hostId).toBe(created.peerId);
    const pj = await host.next('peer-joined');
    expect(pj).toMatchObject({ peerId: joined.peerId, name: 'Alice' });

    const b = await peer();
    b.send({ op: 'join', room: created.room, name: 'Bob' });
    const jb = await b.next('joined');
    await host.next('peer-joined');

    // client → host (even with a `to`, clients can only reach the host)
    a.send({ op: 'send', data: { t: 'hi' }, to: jb.peerId });
    expect(await host.next('msg')).toEqual({ op: 'msg', from: joined.peerId, data: { t: 'hi' } });

    // host → all clients
    host.send({ op: 'send', data: { t: 'all' } });
    expect((await a.next('msg')).data).toEqual({ t: 'all' });
    expect((await b.next('msg')).data).toEqual({ t: 'all' });

    // host → one client
    host.send({ op: 'send', data: { t: 'bob' }, to: jb.peerId });
    expect((await b.next('msg')).data).toEqual({ t: 'bob' });

    // binary: host → all clients; client binary is dropped
    host.ws.send(Buffer.from([1, 2, 3]));
    expect([...(await a.nextBin())]).toEqual([1, 2, 3]);
    expect([...(await b.nextBin())]).toEqual([1, 2, 3]);
    a.ws.send(Buffer.from([9]));
    host.send({ op: 'send', data: { t: 'sync' } });
    await a.next('msg');
    await b.next('msg');
    expect(host.bins.length + a.bins.length + b.bins.length).toBe(0);

    // client leaves → host notified
    a.ws.close();
    expect((await host.next('peer-left')).peerId).toBe(joined.peerId);

    // host leaves → room closed for clients
    host.ws.close();
    expect((await b.next('room-closed')).op).toBe('room-closed');
    await new Promise((r) => setTimeout(r, 20));
    expect(relay.roomCount()).toBe(0);
  });

  it('rejects unknown rooms', async () => {
    const a = await peer();
    a.send({ op: 'join', room: 'ZZZZ', name: 'x' });
    expect((await a.next('error')).message).toMatch(/not found/);
  });

  it('ignores upgrades on other paths', async () => {
    const port = (server.address() as AddressInfo).port;
    const other = new WebSocket(`ws://127.0.0.1:${port}/not-relay`);
    sockets.push(other);
    const res = await new Promise<string>((r) => {
      other.on('open', () => r('open'));
      other.on('error', () => r('error'));
      setTimeout(() => r('timeout'), 300);
    });
    expect(res).not.toBe('open');
  });

  describe('public and private rooms', () => {
    it('lists only public rooms, with the host-published details', async () => {
      const pub = await peer();
      pub.send({ op: 'create', name: 'Pat', meta: { visibility: 'public', title: 'Fast <b>lobby</b>', season: '2026 REBUILT', drivers: 2, seats: 6, bots: true } });
      const created = await pub.next('created');
      const priv = await peer();
      priv.send({ op: 'create', name: 'Quinn' });
      const hidden = await priv.next('created');

      const browser = await peer();
      browser.send({ op: 'list' });
      const { rooms } = await browser.next('rooms');
      expect(rooms.map((r) => r.code)).toEqual([created.room]);
      expect(rooms[0]).toMatchObject({ title: 'Fast blobby/b', host: 'Pat', season: '2026 REBUILT', players: 1, drivers: 2, state: 'lobby', bots: true });
      expect(rooms.some((r) => r.code === hidden.room)).toBe(false);

      // A private room is still joinable by its code, and the host can publish or hide it later.
      browser.send({ op: 'join', room: hidden.room, name: 'Rae' });
      await browser.next('joined');
      priv.send({ op: 'meta', meta: { visibility: 'public', title: '', state: 'match' } });
      const lister = await peer();
      lister.send({ op: 'list' });
      const after = (await lister.next('rooms')).rooms;
      expect(after.map((r) => r.code).sort()).toEqual([created.room, hidden.room].sort());
      const flipped = after.find((r) => r.code === hidden.room)!;
      expect(flipped).toMatchObject({ title: "Quinn's room", players: 2, state: 'match' });
      expect(after[0].code).toBe(created.room); // joinable rooms sort first
      pub.send({ op: 'meta', meta: { visibility: 'private' } });
      lister.send({ op: 'list' });
      expect((await lister.next('rooms')).rooms.map((r) => r.code)).toEqual([hidden.room]);
    });

    it('only the host can change room details', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H', meta: { visibility: 'private' } });
      const created = await host.next('created');
      const guest = await peer();
      guest.send({ op: 'join', room: created.room, name: 'G' });
      await guest.next('joined');
      guest.send({ op: 'meta', meta: { visibility: 'public' } });
      const lister = await peer();
      lister.send({ op: 'list' });
      expect((await lister.next('rooms')).rooms).toEqual([]);
      expect(relay.publicRoomCount()).toBe(0);
    });
  });

  describe('dropped connections', () => {
    it('holds a client seat and resumes it with the token', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      const joined = await a.next('joined');
      await host.next('peer-joined');

      a.ws.terminate();
      expect((await host.next('peer-lost')).peerId).toBe(joined.peerId);

      const again = await peer();
      again.send({ op: 'rejoin', room: created.room, token: joined.token });
      const back = await again.next('joined');
      expect(back).toMatchObject({ peerId: joined.peerId, resumed: true, hostId: created.peerId });
      expect((await host.next('peer-back')).peerId).toBe(joined.peerId);
      host.send({ op: 'send', data: 'hi', to: joined.peerId });
      expect((await again.next('msg')).data).toBe('hi');
      // No peer-left for the seat that came back.
      await new Promise((r) => setTimeout(r, 500));
      expect(host.events.some((e) => e.op === 'peer-left')).toBe(false);
    });

    it('frees the seat when the grace period runs out, and refuses a late rejoin', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      const joined = await a.next('joined');
      a.ws.terminate();
      await host.next('peer-lost');
      expect((await host.next('peer-left')).peerId).toBe(joined.peerId);
      const late = await peer();
      late.send({ op: 'rejoin', room: created.room, token: joined.token });
      expect((await late.next('error')).message).toMatch(/no longer available/);
    });

    it('a deliberate leave frees the seat immediately', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      const joined = await a.next('joined');
      a.ws.close(4000, 'leave');
      expect((await host.next('peer-left')).peerId).toBe(joined.peerId);
      expect(host.events.some((e) => e.op === 'peer-lost')).toBe(false);
    });

    it('keeps the room when the host drops briefly, and closes it when they do not return', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      await a.next('joined');
      host.ws.terminate();
      await a.next('host-lost');
      const hostAgain = await peer();
      hostAgain.send({ op: 'rejoin', room: created.room, token: created.token });
      expect((await hostAgain.next('joined')).peerId).toBe(created.peerId);
      await a.next('host-back');
      expect(relay.roomCount()).toBe(1);

      hostAgain.ws.terminate();
      await a.next('host-lost');
      expect((await a.next('room-closed')).op).toBe('room-closed');
      expect(relay.roomCount()).toBe(0);
    });

    it('rejects rejoin with a wrong token', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      await a.next('joined');
      a.ws.terminate();
      await host.next('peer-lost');
      const thief = await peer();
      thief.send({ op: 'rejoin', room: created.room, token: 'nope' });
      expect((await thief.next('error')).message).toMatch(/no longer available/);
    });
  });

  describe('moderation and limits', () => {
    it('lets the host remove a player, who cannot come back', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      const joined = await a.next('joined');
      host.send({ op: 'kick', peerId: joined.peerId });
      expect((await a.next('room-closed')).reason).toMatch(/removed/);
      expect((await host.next('peer-left')).peerId).toBe(joined.peerId);
      a.send({ op: 'join', room: created.room, name: 'A' });
      expect((await a.next('error')).message).toMatch(/removed/);
    });

    it('ignores a kick from a non-host', async () => {
      const host = await peer();
      host.send({ op: 'create', name: 'H' });
      const created = await host.next('created');
      const a = await peer();
      a.send({ op: 'join', room: created.room, name: 'A' });
      const ja = await a.next('joined');
      const b = await peer();
      b.send({ op: 'join', room: created.room, name: 'B' });
      await b.next('joined');
      b.send({ op: 'kick', peerId: ja.peerId });
      host.send({ op: 'send', data: 'sync' });
      await a.next('msg');
      expect(a.events.some((e) => e.op === 'room-closed')).toBe(false);
    });

    it('limits room creation and bad join guesses per IP', async () => {
      const p = await peer();
      for (let i = 0; i < 6; i++) {
        p.send({ op: 'create', name: 'x' });
        await p.next('created');
      }
      p.send({ op: 'create', name: 'x' });
      expect((await p.next('error')).message).toMatch(/too quickly/);

      const g = await peer();
      for (let i = 0; i < 4; i++) {
        g.send({ op: 'join', room: 'ZZZZ', name: 'g' });
        expect((await g.next('error')).message).toMatch(/not found/);
      }
      g.send({ op: 'join', room: 'ZZZZ', name: 'g' });
      expect((await g.next('error')).message).toMatch(/Too many attempts/);
    });
  });
});
