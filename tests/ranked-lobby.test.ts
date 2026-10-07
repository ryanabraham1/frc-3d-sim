import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRelay, type Relay } from '../server/relay';
import { MemoryStore } from '../server/rankedStore';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import { currentStep, draftDone, draftOptions } from '../src/engine/net/ranked';
import type { MatchSetup } from '../src/engine/net/protocol';
import { getSeason } from '../src/seasons';

let server: Server;
let relay: Relay;
let store: MemoryStore;
let url: string;
const lobbies: LobbyController[] = [];

beforeEach(async () => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', search: '', href: 'http://localhost/' });
  server = createServer();
  store = new MemoryStore();
  relay = attachRelay(server, { rejectOtherPaths: true, rankedStore: store, ranked: { tickMs: 40, reportWindowMs: 500 }, limits: { connections: 0, creates: 0, badJoins: 0, ranked: 0 } });
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

function player(name: string) {
  const l = new LobbyController();
  l.relayUrl = url;
  l.serverState = 'online';
  l.settings = defaultSettings(getSeason('2026-rebuilt'));
  l.playerName = name;
  lobbies.push(l);
  return l;
}

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
};

describe('ranked through the lobby', () => {
  it('queues, drafts, places, starts and rates a 1v1', async () => {
    const a = player('Ann');
    const b = player('Bob');
    a.setRankedMode('1v1');
    b.setRankedMode('1v1');
    const starts: MatchSetup[] = [];
    a.onStart = (s) => starts.push(s);
    b.onStart = (s) => starts.push(s);
    await a.findMatch('Ann');
    await b.findMatch('Bob');
    expect(a.ranked.searching).toBe(true);

    await until(() => !!a.lobby?.ranked && !!b.lobby?.ranked);
    const host = a.isHost ? a : b;
    const guest = host === a ? b : a;
    expect(host.lobby!.ranked!.phase).toBe('draft');
    expect(host.lobby!.players.map((p) => p.slot).sort()).toEqual(['blue1', 'red1']);
    expect(host.lobby!.visibility).toBe('private');
    // Ratings are not editable by the room.
    const before = JSON.stringify(host.lobby!.players.map((p) => p.slot));
    guest.client.send({ t: 'lobby-set', robot: guest.settings!.robot, autoRoutine: 'none', manualAuto: false, slot: 'blue3' });
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify(host.lobby!.players.map((p) => p.slot))).toBe(before);

    // Play the draft: whoever's turn it is takes the first option.
    const season = getSeason('2026-rebuilt');
    const byPeer = (id: string) => [a, b].find((l) => l.client.peerId === id)!;
    let guard = 0;
    while (!draftDone(host.lobby!.ranked!.draft) && guard++ < 20) {
      const d = host.lobby!.ranked!.draft;
      const step = currentStep(d)!;
      const who = host.lobby!.players.find((p) => p.slot === step.slot)!;
      // A wrong-seat attempt is refused.
      const other = [a, b].find((l) => l.client.peerId !== who.peerId)!;
      const idx = d.index;
      other.draft(draftOptions(d, step.slot)[0]);
      await new Promise((r) => setTimeout(r, 60));
      expect(host.lobby!.ranked!.draft.index).toBe(idx);
      byPeer(who.peerId).draft(draftOptions(d, step.slot)[0]);
      await until(() => host.lobby!.ranked!.draft.index === idx + 1 || draftDone(host.lobby!.ranked!.draft));
    }
    expect(host.lobby!.ranked!.draft.picks).toHaveLength(2);
    await until(() => !!host.lobby!.placing && !!guest.lobby?.placing);
    expect(season.startArea).toBeTruthy();
    host.place(null, true);
    guest.place(null, true);
    await until(() => starts.length === 2, 8000);
    expect(starts[0].robots).toHaveLength(2);
    expect(starts[0].robots.every((r) => !r.bot)).toBe(true);
    expect(host.lobby!.ranked!.phase).toBe('playing');

    host.reportResult('red', 70, 50);
    guest.reportResult('red', 70, 50);
    await until(() => !!a.ranked.lastResult && !!b.ranked.lastResult);
    const results = [a.ranked.lastResult!, b.ranked.lastResult!];
    expect(results.map((r) => r.status)).toEqual(['final', 'final']);
    expect(results.map((r) => r.result).sort()).toEqual(['loss', 'win']);
    expect(results[0].delta + results[1].delta).toBe(0);
  });

  it('auto-plays a draft turn that times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const l = player('Solo');
      // Drive the host-side draft directly: no network needed.
      (l as unknown as { client: { peerId: string; hostId: string } }).client.peerId = 'h';
      (l as unknown as { client: { peerId: string; hostId: string } }).client.hostId = 'h';
      (l as unknown as { hostRankedRoom(e: unknown): void }).hostRankedRoom({ room: 'TEST', peerId: 'h', mode: '1v1', roster: [{ peerId: 'h', name: 'Solo', team: 'red', rating: 1000, games: 0 }] });
      const d = l.lobby!.ranked!.draft;
      expect(d.index).toBe(0);
      vi.advanceTimersByTime(15_400);
      expect(l.lobby!.ranked!.draft.index).toBe(1);
      vi.advanceTimersByTime(15_400);
      expect(l.lobby!.ranked!.draft.index).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
