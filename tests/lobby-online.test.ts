import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRelay, type Relay } from '../server/relay';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import { NetClient } from '../src/engine/net/netClient';
import { SEASONS } from '../src/seasons';

/** The real LobbyController + NetClient against a real relay (Node's global WebSocket). */

let server: Server;
let relay: Relay;
let url: string;
const lobbies: LobbyController[] = [];

beforeEach(async () => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', search: '', href: 'http://localhost/' });
  server = createServer();
  relay = attachRelay(server, { rejectOtherPaths: true, reconnectGraceMs: 6000 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  for (const l of lobbies.splice(0)) l.client.close();
  await relay.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  vi.unstubAllGlobals();
});

function player() {
  const l = new LobbyController();
  l.relayUrl = url;
  l.serverState = 'online';
  l.settings = defaultSettings(SEASONS[0]);
  lobbies.push(l);
  return l;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
};

describe('online lobbies', () => {
  it('quick play hosts a public lobby when none exists, then the next player joins it', async () => {
    const a = player();
    await a.quickPlay('Ann');
    expect(a.status).toBe('lobby');
    expect(a.isHost).toBe(true);
    expect(a.lobby!.visibility).toBe('public');

    const b = player();
    await b.quickPlay('Bob');
    expect(b.isHost).toBe(false);
    expect(b.client.room).toBe(a.client.room);
    await until(() => a.lobby!.players.length === 2);
    await until(() => b.lobby?.players.length === 2);
  });

  it('a private room is not offered to quick play but is joinable by code', async () => {
    const a = player();
    await a.create('Ann', 'private');
    await until(() => relay.roomCount() === 1);
    expect(relay.publicRoomCount()).toBe(0);

    const b = player();
    await b.quickPlay('Bob');
    expect(b.isHost).toBe(true);
    expect(b.client.room).not.toBe(a.client.room);

    const c = player();
    await c.join(a.client.room, 'Cy');
    await until(() => a.lobby!.players.length === 2);
  });

  it('shows host edits to visibility in the public list', async () => {
    const a = player();
    await a.create('Ann', 'private', 'Open practice');
    const watcher = new NetClient();
    await watcher.connect(url);
    const list = () =>
      new Promise<string[]>((resolve) => {
        const off = watcher.on('rooms', ({ rooms }) => (off(), resolve(rooms.map((r) => r.title))));
        watcher.list();
      });
    expect(await list()).toEqual([]);
    a.setVisibility('public');
    await until(() => relay.publicRoomCount() === 1);
    expect(await list()).toEqual(['Open practice']);
    watcher.close();
  });

  it('host chat reaches everyone, trimmed and rate limited', async () => {
    const a = player();
    await a.create('Ann');
    const b = player();
    await b.join(a.client.room, 'Bob');
    await until(() => b.lobby?.players.length === 2);
    b.sendChat('  hello <b>team</b>  ');
    await until(() => (a.lobby!.chat ?? []).some((c) => c.from === 'Bob'));
    expect(a.lobby!.chat!.find((c) => c.from === 'Bob')!.text).toBe('hello b team /b');
    await until(() => (b.lobby!.chat ?? []).some((c) => c.from === 'Bob'));
    b.sendChat('spam 1');
    b.sendChat('spam 2');
    await new Promise((r) => setTimeout(r, 100));
    expect((a.lobby!.chat ?? []).filter((c) => c.text.startsWith('spam')).length).toBeLessThanOrEqual(1);
  });

  it('removes a kicked player and keeps them out', async () => {
    const a = player();
    await a.create('Ann');
    const b = player();
    await b.join(a.client.room, 'Bob');
    await until(() => a.lobby!.players.length === 2);
    a.kick(b.client.peerId);
    await until(() => a.lobby!.players.length === 1);
    await until(() => b.status === 'idle');
    expect(b.error).toMatch(/removed/);
    await b.join(a.client.room, 'Bob');
    expect(b.error).toMatch(/removed/);
  });

  it('a client whose socket drops resumes the same seat', async () => {
    const a = player();
    await a.create('Ann');
    const b = player();
    await b.join(a.client.room, 'Bob');
    await until(() => a.lobby!.players.length === 2);
    const bobId = b.client.peerId;
    const lost = vi.fn();
    const back = vi.fn();
    a.client.on('peer-lost', lost);
    a.client.on('peer-back', back);

    // Kill the socket without a deliberate leave.
    (b.client as unknown as { ws: WebSocket }).ws.close(3001);
    await until(() => lost.mock.calls.length === 1);
    await until(() => b.client.connected && !b.reconnecting, 6000);
    expect(back).toHaveBeenCalledTimes(1);
    expect(b.client.peerId).toBe(bobId);
    expect(a.lobby!.players.map((p) => p.peerId)).toContain(bobId);
    // Lobby traffic flows again in both directions.
    b.sendChat('back');
    await until(() => (a.lobby!.chat ?? []).some((c) => c.text === 'back'));
  });

  it('a host whose socket drops keeps the room and the lobby', async () => {
    const a = player();
    await a.create('Ann', 'public');
    const b = player();
    await b.join(a.client.room, 'Bob');
    await until(() => b.lobby?.players.length === 2);
    const lost = vi.fn();
    const back = vi.fn();
    b.client.on('host-lost', lost);
    b.client.on('host-back', back);
    (a.client as unknown as { ws: WebSocket }).ws.close(3001);
    await until(() => back.mock.calls.length === 1, 6000);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(a.client.connected && !a.reconnecting).toBe(true);
    expect(b.hostAway).toBe(false);
    expect(a.isHost).toBe(true);
    expect(relay.roomCount()).toBe(1);
    expect(relay.publicRoomCount()).toBe(1);
  });
});
