import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { attachRelay, type Relay } from '../server/relay';
import { MemoryStore } from '../server/rankedStore';
import type { RelayEvent } from '../src/engine/net/relayProtocol';

let server: Server;
let relay: Relay;
let store: MemoryStore;
let url: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = createServer();
  store = new MemoryStore();
  relay = attachRelay(server, {
    rejectOtherPaths: true,
    reconnectGraceMs: 400,
    rankedStore: store,
    ranked: { tickMs: 40, reportWindowMs: 300 },
    limits: { connections: 0, creates: 0, badJoins: 0, ranked: 0 },
  });
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

async function peer(letter = 'a') {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const events: RelayEvent[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d, bin) => {
    if (!bin) events.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((r) => ws.once('open', r));
  const next = async <T extends RelayEvent['op']>(op: T, ms = 2000): Promise<Extract<RelayEvent, { op: T }>> => {
    const end = Date.now() + ms;
    for (;;) {
      const i = events.findIndex((e) => e.op === op);
      if (i >= 0) return events.splice(i, 1)[0] as Extract<RelayEvent, { op: T }>;
      if (Date.now() > end) throw new Error(`timed out waiting for ${op}; got ${events.map((e) => e.op).join(',')}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  const secret = letter.repeat(32);
  return { ws, events, next, secret, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}
type Peer = Awaited<ReturnType<typeof peer>>;

async function queue(p: Peer, name: string, mode = '1v1') {
  p.send({ op: 'queue', mode, name, secret: p.secret });
  await p.next('queued');
}

/** Two players matched in 1v1; returns who got host. */
async function match1v1() {
  const a = await peer('a');
  const b = await peer('b');
  await queue(a, 'Ann');
  await queue(b, 'Bob');
  const ma = await a.next('matched');
  const mb = await b.next('matched');
  const host = ma.peerId === ma.hostId ? a : b;
  const guest = host === a ? b : a;
  return { a, b, ma, mb, host, guest };
}

describe('ranked relay', () => {
  it('registers a profile with starting ratings', async () => {
    const p = await peer('c');
    p.send({ op: 'profile', name: 'Cy', secret: p.secret });
    const prof = await p.next('profile');
    expect(prof.persistent).toBe(false);
    expect(prof.rating).toMatchObject({ rating: 1000, games: 0 });
    expect(prof.standing).toBeNull();
    expect(prof.season).toBe('2026-rebuilt');
  });

  it('rejects a malformed secret', async () => {
    const p = await peer();
    p.send({ op: 'queue', mode: '1v1', name: 'x', secret: 'short' });
    expect((await p.next('error')).message).toMatch(/player key/);
  });

  it('matches two players into one private room with a host and opposing teams', async () => {
    const { ma, mb } = await match1v1();
    expect(ma.room).toBe(mb.room);
    expect(ma.hostId).toBe(mb.hostId);
    expect([ma.peerId, mb.peerId]).toContain(ma.hostId);
    expect(new Set([ma.team, mb.team])).toEqual(new Set(['red', 'blue']));
    expect(ma.roster.map((r) => r.name).sort()).toEqual(['Ann', 'Bob']);
    expect(relay.roomCount()).toBe(1);
    expect(relay.publicRoomCount()).toBe(0);
  });

  it('forms 2v2 only when four players are queued, balancing the teams', async () => {
    const ps = await Promise.all(['a', 'b', 'c', 'd'].map((l) => peer(l)));
    for (const [i, p] of ps.entries()) await queue(p, `P${i}`, '2v2');
    const ms = await Promise.all(ps.map((p) => p.next('matched')));
    expect(new Set(ms.map((m) => m.room)).size).toBe(1);
    expect(ms.filter((m) => m.team === 'red')).toHaveLength(2);
  });

  it('keeps the same device out of two searches at once', async () => {
    const a = await peer('a');
    await queue(a, 'Ann');
    const dup = await peer('a');
    dup.send({ op: 'queue', mode: '1v1', name: 'Ann', secret: dup.secret });
    expect((await dup.next('error')).message).toMatch(/another tab/);
  });

  it('cancelling leaves the queue; a closed socket does too', async () => {
    const a = await peer('a');
    await queue(a, 'Ann');
    a.send({ op: 'unqueue' });
    await a.next('unqueued');
    const b = await peer('b');
    await queue(b, 'Bob');
    b.ws.terminate();
    await new Promise((r) => setTimeout(r, 150));
    const c = await peer('c');
    await queue(c, 'Cy');
    const d = await peer('d');
    await queue(d, 'Di');
    // c and d are the only ones left and should be matched with each other.
    const m = await d.next('matched');
    expect(m.roster.map((r) => r.name).sort()).toEqual(['Cy', 'Di']);
  });

  it('applies Elo when host and opponent agree, and the next profile shows it', async () => {
    const { a, b, host, guest } = await match1v1();
    host.send({ op: 'result', winner: 'red', red: 80, blue: 60 });
    guest.send({ op: 'result', winner: 'red', red: 80, blue: 60 });
    const r1 = await a.next('rating');
    const r2 = await b.next('rating');
    expect(r1.status).toBe('final');
    expect(r1.delta + r2.delta).toBe(0);
    expect([r1.result, r2.result].sort()).toEqual(['loss', 'win']);
    const winner = r1.result === 'win' ? a : b;
    winner.send({ op: 'profile', name: 'W', secret: winner.secret });
    const prof = await winner.next('profile');
    expect(prof.rating).toMatchObject({ rating: 1020, games: 1, wins: 1 });
    expect(prof.rating.modes['1v1']).toMatchObject({ games: 1, wins: 1 });
    expect(prof.rating.modes['2v2'].games).toBe(0);
    expect(store.matches[0]).toMatchObject({ status: 'final', outcome: 'red', redScore: 80 });
  });

  it('voids the match when the players disagree', async () => {
    const { a, b, host, guest } = await match1v1();
    host.send({ op: 'result', winner: 'red', red: 80, blue: 60 });
    guest.send({ op: 'result', winner: 'blue', red: 60, blue: 80 });
    const r = await a.next('rating');
    await b.next('rating');
    expect(r).toMatchObject({ status: 'void', delta: 0, result: 'none' });
  });

  it('voids when the host reports and nobody corroborates in time', async () => {
    const { a, host } = await match1v1();
    host.send({ op: 'result', winner: 'red', red: 1, blue: 0 });
    const r = await (host === a ? a : a).next('rating', 3000);
    expect(r.status).toBe('void');
  });

  it('a player who disconnects for good loses; the other player wins', async () => {
    const { a, b, host, guest } = await match1v1();
    guest.ws.close(4000, 'leave');
    const rh = await host.next('rating');
    expect(rh).toMatchObject({ status: 'abandoned', result: 'win' });
    expect(rh.delta).toBeGreaterThan(0);
    void a;
    void b;
    const stats = await store.getRating((await store.leaderboard(5, 0))[0]?.playerId ?? '');
    expect(stats.games).toBeGreaterThanOrEqual(1);
  });

  it('a host who disappears loses', async () => {
    const { host, guest } = await match1v1();
    host.ws.close(4000, 'leave');
    const rg = await guest.next('rating');
    expect(rg).toMatchObject({ status: 'abandoned', result: 'win' });
  });

  it('a brief drop does not forfeit', async () => {
    const { host, guest } = await match1v1();
    guest.ws.terminate();
    await host.next('peer-lost');
    await new Promise((r) => setTimeout(r, 100));
    expect(host.events.some((e) => e.op === 'rating')).toBe(false);
  });

  it('lets a finished player queue again', async () => {
    const { host, guest, a } = await match1v1();
    host.send({ op: 'result', winner: 'tie', red: 5, blue: 5 });
    guest.send({ op: 'result', winner: 'tie', red: 5, blue: 5 });
    await a.next('rating');
    guest.ws.close(4000, 'leave');
    const again = await peer(guest.secret[0]);
    await queue(again, 'Again');
  });

  it('profiles carry my leaderboard position per mode', async () => {
    const a = await peer('a');
    a.send({ op: 'profile', name: 'Ann', secret: a.secret });
    const first = await a.next('profile');
    expect(first.standing).toBeNull(); // nothing played yet
    const { playerIdFor } = await import('../server/ranked');
    const me = playerIdFor(a.secret);
    await store.touchPlayer('rival', 'Rival');
    const win = (id: string, after: number) => store.saveMatch({ mode: '2v2', season: 's', outcome: 'red', redScore: 0, blueScore: 0, status: 'final', players: [] }, [{ playerId: id, before: after - 10, after, delta: 10, result: 'win' }]);
    await win('rival', 1100);
    await win(me, 1050);
    a.send({ op: 'profile', name: 'Ann', secret: a.secret });
    const prof = await a.next('profile');
    expect(prof.standing).toEqual({ rank: 2, total: 2 });
    expect(prof.rating).toMatchObject({ rating: 1050, games: 1, wins: 1 });
  });

  it('one rating is shared by every mode and appears on one leaderboard', async () => {
    const a = await peer('a');
    a.send({ op: 'profile', name: 'Ann', secret: a.secret });
    await a.next('profile');
    const { playerIdFor } = await import('../server/ranked');
    const me = playerIdFor(a.secret);
    const win = (mode: '1v1' | '2v2' | '3v3', before: number, after: number) =>
      store.saveMatch({ mode, season: 's', outcome: 'red', redScore: 0, blueScore: 0, status: 'final', players: [] }, [{ playerId: me, before, after, delta: after - before, result: 'win' }]);
    await win('1v1', 1000, 1020);
    await win('3v3', 1020, 1034);
    a.send({ op: 'profile', name: 'Ann', secret: a.secret });
    const prof = await a.next('profile');
    expect(prof.rating).toMatchObject({ rating: 1034, games: 2, wins: 2, peak: 1034 });
    expect(prof.rating.modes['1v1'].games).toBe(1);
    expect(prof.rating.modes['3v3'].games).toBe(1);
    a.send({ op: 'leaderboard', secret: a.secret });
    const lb = await a.next('leaderboard');
    expect(lb.rows).toHaveLength(1);
    expect(lb.rows[0]).toMatchObject({ name: 'Ann', rating: 1034, games: 2, me: true });
  });

  it('serves a leaderboard that marks the requester', async () => {
    const a = await peer('a');
    await store.touchPlayer('x', 'Xavier');
    for (let i = 0; i < 5; i++)
      await store.saveMatch({ mode: '1v1', season: 's', outcome: 'red', redScore: 0, blueScore: 0, status: 'final', players: [] }, [{ playerId: 'x', before: 1000, after: 1000 + i, delta: 1, result: 'win' }]);
    a.send({ op: 'leaderboard', secret: a.secret });
    const lb = await a.next('leaderboard');
    expect(lb.rows.map((r) => r.name)).toEqual(['Xavier']);
    expect(lb.rows[0].me).toBeUndefined();
  });
});

describe('ranked rate limits with the default limits', () => {
  it('two players behind one IP can poll their profile and still queue and match', async () => {
    const s2 = createServer();
    const r2 = attachRelay(s2, { rejectOtherPaths: true, rankedStore: new MemoryStore(), ranked: { tickMs: 40 } }); // default limits
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
    const u2 = `ws://127.0.0.1:${(s2.address() as AddressInfo).port}/ws`;
    const mk = async (letter: string) => {
      const ws = new WebSocket(u2);
      sockets.push(ws);
      const events: RelayEvent[] = [];
      ws.on('message', (d, bin) => {
        if (!bin) events.push(JSON.parse(d.toString()));
      });
      await new Promise((r) => ws.once('open', r));
      return { ws, events, secret: letter.repeat(32), send: (o: unknown) => ws.send(JSON.stringify(o)) };
    };
    try {
      const a = await mk('a');
      const b = await mk('b');
      // What the Ranked page does for a couple of minutes: profile + leaderboard every 5 s, from each browser.
      for (let i = 0; i < 24; i++) {
        for (const p of [a, b]) {
          p.send({ op: 'profile', name: 'x', secret: p.secret });
          p.send({ op: 'leaderboard', secret: p.secret });
        }
      }
      await new Promise((r) => setTimeout(r, 200));
      a.send({ op: 'queue', mode: '1v1', name: 'A', secret: a.secret });
      b.send({ op: 'queue', mode: '1v1', name: 'B', secret: b.secret });
      await new Promise((r) => setTimeout(r, 400));
      expect(a.events.some((e) => e.op === 'error')).toBe(false);
      expect(b.events.some((e) => e.op === 'error')).toBe(false);
      expect(a.events.some((e) => e.op === 'matched')).toBe(true);
      expect(b.events.some((e) => e.op === 'matched')).toBe(true);
    } finally {
      await r2.close();
      s2.closeAllConnections();
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });
});
