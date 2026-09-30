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
  relay = attachRelay(server, { rejectOtherPaths: true });
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
});
