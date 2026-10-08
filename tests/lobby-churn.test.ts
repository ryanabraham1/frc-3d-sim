import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRelay, type Relay } from '../server/relay';
import { MemoryStore } from '../server/rankedStore';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import { getSeason } from '../src/seasons';

/** Players joining and leaving rooms in a hurry must never leave a ghost behind. */

let server: Server;
let relay: Relay;
let url: string;
const lobbies: LobbyController[] = [];

beforeEach(async () => {
  // Each controller represents a separate browser tab.
  vi.stubGlobal('sessionStorage', undefined);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', search: '', href: 'http://localhost/' });
  server = createServer();
  relay = attachRelay(server, { rejectOtherPaths: true, rankedStore: new MemoryStore(), reconnectGraceMs: 30000, limits: { connections: 0, creates: 0, badJoins: 0, ranked: 0 } });
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
  l.settings = defaultSettings(getSeason('2026-rebuilt'));
  lobbies.push(l);
  return l;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(15);
  }
};

describe('join/leave churn', () => {
  it('leaves no ghost after many join/leave cycles with the same controller', async () => {
    const host = player();
    await host.create('Host');
    const guest = player();
    for (let i = 0; i < 12; i++) {
      await guest.join(host.client.room, 'Guest');
      await sleep(i % 3 === 0 ? 0 : 20);
      guest.leave();
      await sleep(i % 2 === 0 ? 0 : 15);
    }
    await sleep(300);
    expect(host.lobby!.players.map((p) => p.name)).toEqual(['Host']);
  });

  it('leaving before the join finishes still leaves nothing behind', async () => {
    const host = player();
    await host.create('Host');
    const guest = player();
    for (let i = 0; i < 10; i++) {
      const joining = guest.join(host.client.room, 'Guest');
      await sleep(i * 3);
      guest.leave();
      await joining;
      await sleep(30);
      guest.leave();
    }
    await sleep(400);
    expect(host.lobby!.players.filter((p) => p.name === 'Guest')).toHaveLength(guest.client.room ? 1 : 0);
    expect(guest.status === 'lobby').toBe(!!guest.client.room);
  });

  it('rejoining after a leave shows one copy of the player, not two', async () => {
    const host = player();
    await host.create('Host');
    const guest = player();
    await guest.join(host.client.room, 'Guest');
    await until(() => host.lobby!.players.length === 2);
    guest.leave();
    await guest.join(host.client.room, 'Guest');
    await sleep(300);
    expect(host.lobby!.players.filter((p) => p.name === 'Guest')).toHaveLength(1);
  });

  it('joining while still in another room leaves the old one', async () => {
    const a = player();
    const b = player();
    await a.create('A');
    await b.create('B');
    const guest = player();
    await guest.join(a.client.room, 'Guest');
    await until(() => a.lobby!.players.length === 2);
    await guest.join(b.client.room, 'Guest');
    await sleep(300);
    expect(a.lobby!.players.map((p) => p.name)).toEqual(['A']);
    expect(b.lobby!.players.map((p) => p.name).sort()).toEqual(['B', 'Guest']);
  });

  it('a host that was briefly offline still learns who left meanwhile', async () => {
    const host = player();
    await host.create('Host');
    const guest = player();
    await guest.join(host.client.room, 'Guest');
    await until(() => host.lobby!.players.length === 2);
    (host.client as unknown as { ws: WebSocket }).ws.close(3001); // host's connection drops
    await sleep(30);
    guest.leave(); // the guest leaves while the host is away
    await until(() => host.client.connected && !host.reconnecting, 6000);
    await sleep(300);
    expect(host.lobby!.players.map((p) => p.name)).toEqual(['Host']);
  });
});

describe('lobby host recovery', () => {
  it('transfers room controls and robot choices and can start a match from the recovered lobby', async () => {
    const host = player(); await host.create('Host');
    const guest = player(); await guest.join(host.client.room, 'Guest');
    const code = host.client.room;
    await until(() => host.lobby!.players.length === 2 && host.lobby!.players.some(p => p.name === 'Guest' && p.slot));
    host.setBots(true, 'hard');
    await until(() => guest.lobby?.fillBots === true);
    host.leave();
    await until(() => guest.isHost);
    expect(guest.client.room).toBe(code);
    expect(guest.lobby!.players.map(p => p.name)).toEqual(['Guest']);
    expect(guest.lobby!.players[0].host).toBe(true);
    expect(guest.canStart()).toBe(true);
    let lineup = 0;
    guest.onStart = setup => { lineup = setup.robots.length; };
    guest.startMatch();
    expect(lineup).toBe(6);
  });

  it('a promoted host sends the checkpoint setup to clients and a reconnecting driver retains their station', async () => {
    const host = player(); await host.create('Host');
    const guest = player(); await guest.join(host.client.room, 'Guest');
    const observer = player(); await observer.join(host.client.room, 'Observer');
    await until(() => host.lobby!.players.length === 3 && host.lobby!.players.every(p => p.slot));
    let setup: import('../src/engine/net/protocol').MatchSetup | null = null;
    host.onStart = s => { setup = s; };
    host.startMatch();
    await until(() => observer.lobby?.inMatch === true);
    // GameRecovery is independently verified with all four real season worlds.
    const game = { version: 1, seasonId: '2026-rebuilt', marker: 'same clock and score' } as unknown as import('../src/engine/core/game').GameRecovery;
    host.updateRecovery(game);
    let restored: unknown;
    guest.onRecover = (s, role, state) => { expect(role).toBe('host'); expect(s.seed).toBe(setup!.seed); restored = state; };
    let clientResumes = 0;
    observer.onRecover = (s, role) => { expect(role).toBe('client'); expect(s.seed).toBe(setup!.seed); clientResumes++; };
    await sleep(50);
    host.leave();
    await until(() => !!restored && clientResumes === 1);
    expect(restored).toEqual(game);
    const slot = observer.me!.slot;
    (observer.client as unknown as { ws: WebSocket }).ws.close(3001);
    await until(() => clientResumes === 2, 6000);
    expect(observer.me!.slot).toBe(slot);
    expect(observer.client.hostId).toBe(guest.client.peerId);
  });
});
