import { createHash } from 'node:crypto';
import {
  balanceTeams,
  isRankedMode,
  MODE_SIZE,
  LEADERBOARD_MIN_GAMES,
  LEADERBOARD_SIZE,
  RANKED_SEASON_ID,
  rateMatch,
  type Outcome,
  type RankedMode,
  type RankedParticipant,
  type Team,
} from '../src/engine/net/ranked.ts';
import {
  cleanName,
  type LeaderEntry,
  type RankedRosterEntry,
  type RelayEvent,
} from '../src/engine/net/relayProtocol.ts';
import { Matchmaker, type QueueEntry } from './matchmaker.ts';
import type { MatchRecord, RankedStore } from './rankedStore.ts';

/**
 * Ranked matchmaking, results and ratings, layered on the relay. The relay stays game-agnostic: it gives this
 * service a few hooks (send an event, seat players in a room) and tells it when peers leave.
 *
 * Trust model: the simulation runs in the host's browser. The relay therefore only accepts a result when the
 * host and at least half of the other drivers report the same winner; otherwise the match is voided. Leaving
 * a ranked match before a result exists counts as a loss for the leaver.
 */

export interface RankedDeps {
  store: RankedStore;
  send(peerId: string, ev: RelayEvent): void;
  /** Is this peer's socket still connected? */
  isOpen(peerId: string): boolean;
  /**
   * Seat `memberIds` in a new private room hosted by `hostId`. Returns the room code and each member's
   * reconnect token, or null if someone is no longer available.
   */
  seat(hostId: string, memberIds: string[]): { code: string; tokens: Map<string, string> } | null;
  log?: (msg: string) => void;
  now?: () => number;
  /** How often the queue is scanned (ms). */
  tickMs?: number;
  /** Wait for result reports this long after the first one (ms). */
  reportWindowMs?: number;
  /** Void a match that never reports a result after this long (ms). */
  maxMatchMs?: number;
}

interface Waiting {
  peerId: string;
  playerId: string;
  name: string;
  games: number;
}

interface Member {
  playerId: string;
  name: string;
  team: Team;
  rating: number;
  games: number;
}

interface Report {
  winner: Outcome;
  red: number;
  blue: number;
}

interface ActiveMatch {
  code: string;
  mode: RankedMode;
  hostId: string;
  members: Map<string, Member>;
  reports: Map<string, Report>;
  abandoned: Set<string>;
  finalized: boolean;
  reportTimer: ReturnType<typeof setTimeout> | null;
  ageTimer: ReturnType<typeof setTimeout> | null;
}

const SECRET = /^[0-9a-f]{32,128}$/;
export const playerIdFor = (secret: string): string => createHash('sha256').update(secret).digest('hex').slice(0, 32);

export class RankedService {
  private readonly deps: RankedDeps;
  private readonly mm = new Matchmaker<Waiting>();
  private readonly matches = new Map<string, ActiveMatch>();
  /** peerId → ranked room code. */
  private readonly inMatch = new Map<string, string>();
  /** playerId → peerId, for queued players and live matches (one device, one game at a time). */
  private readonly active = new Map<string, string>();
  private readonly tick: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private statusAt = 0;

  constructor(deps: RankedDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.tick = setInterval(() => this.matchmake(), deps.tickMs ?? 1500);
    this.tick.unref?.();
  }

  close(): void {
    clearInterval(this.tick);
    for (const m of this.matches.values()) {
      if (m.reportTimer) clearTimeout(m.reportTimer);
      if (m.ageTimer) clearTimeout(m.ageTimer);
    }
    this.matches.clear();
  }

  private log(msg: string): void {
    this.deps.log?.(`ranked: ${msg}`);
  }

  private identify(peerId: string, secret: unknown): string | null {
    if (typeof secret !== 'string' || !SECRET.test(secret)) {
      this.deps.send(peerId, { op: 'error', message: 'Ranked needs a valid player key — reload the page and try again' });
      return null;
    }
    return playerIdFor(secret);
  }

  async profile(peerId: string, secret: unknown, name: unknown): Promise<void> {
    const playerId = this.identify(peerId, secret);
    if (!playerId) return;
    const clean = cleanName(name);
    try {
      const rating = await this.deps.store.touchPlayer(playerId, clean);
      // Where I stand on the season leaderboard (once I've played).
      const st = rating.games >= LEADERBOARD_MIN_GAMES ? await this.deps.store.rankOf(playerId, LEADERBOARD_MIN_GAMES) : null;
      this.deps.send(peerId, { op: 'profile', persistent: this.deps.store.persistent, name: clean, season: RANKED_SEASON_ID, rating, standing: st ? { rank: st.rank, total: st.total } : null });
    } catch (e) {
      this.log(`profile failed: ${(e as Error).message}`);
      this.deps.send(peerId, { op: 'error', message: 'Ratings are unavailable right now' });
    }
  }

  async leaderboard(peerId: string, secret?: unknown): Promise<void> {
    const me = typeof secret === 'string' && SECRET.test(secret) ? playerIdFor(secret) : null;
    try {
      const rows = await this.deps.store.leaderboard(LEADERBOARD_SIZE, LEADERBOARD_MIN_GAMES);
      // Names were filtered when set, but old rows (or a bad store) are re-checked on the way out.
      const entries: LeaderEntry[] = rows.map((r) => ({ name: cleanName(r.name), rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, peak: r.peak, ...(me && r.playerId === me ? { me: true } : {}) }));
      const standing = me ? await this.deps.store.rankOf(me, LEADERBOARD_MIN_GAMES) : null;
      this.deps.send(peerId, { op: 'leaderboard', season: RANKED_SEASON_ID, rows: entries, ...(standing ? { you: { rank: standing.rank, total: standing.total, rating: standing.row.rating, games: standing.row.games } } : {}) });
    } catch (e) {
      this.log(`leaderboard failed: ${(e as Error).message}`);
      this.deps.send(peerId, { op: 'leaderboard', season: RANKED_SEASON_ID, rows: [] });
    }
  }

  async queue(peerId: string, mode: unknown, name: unknown, secret: unknown): Promise<void> {
    if (!isRankedMode(mode)) return this.deps.send(peerId, { op: 'error', message: 'Unknown ranked mode' });
    const playerId = this.identify(peerId, secret);
    if (!playerId) return;
    if (this.inMatch.has(peerId)) return this.deps.send(peerId, { op: 'error', message: 'You are already in a ranked match' });
    const holder = this.active.get(playerId);
    if (holder && holder !== peerId) return this.deps.send(peerId, { op: 'error', message: 'This player is already searching or playing in another tab' });
    this.active.set(playerId, peerId);
    const clean = cleanName(name);
    try {
      const rating = await this.deps.store.touchPlayer(playerId, clean);
      // The peer may have left (or cancelled) while we were reading the database.
      if (!this.deps.isOpen(peerId) || this.active.get(playerId) !== peerId) return;
      this.mm.add(mode, { id: peerId, rating: rating.rating, since: this.now(), data: { peerId, playerId, name: clean, games: rating.games } });
      this.modeOf.set(peerId, mode);
      this.deps.send(peerId, { op: 'queued', mode, waiting: this.mm.size(mode) });
      this.matchmake();
    } catch (e) {
      this.log(`queue failed: ${(e as Error).message}`);
      this.releaseIfIdle(peerId, playerId);
      this.deps.send(peerId, { op: 'error', message: 'Ratings are unavailable right now' });
    }
  }

  private releaseIfIdle(peerId: string, playerId: string): void {
    if (this.active.get(playerId) === peerId && !this.mm.has(peerId) && !this.inMatch.has(peerId)) this.active.delete(playerId);
  }

  unqueue(peerId: string, reason = 'Search cancelled'): void {
    // Find the player id before the entry disappears.
    for (const [playerId, p] of this.active) if (p === peerId && !this.inMatch.has(peerId)) this.active.delete(playerId);
    if (this.mm.remove(peerId)) this.deps.send(peerId, { op: 'unqueued', reason });
  }

  /** Form every match the queue allows right now. */
  matchmake(): void {
    const now = this.now();
    for (const { mode, players } of this.mm.tick(now)) this.startMatch(mode, players);
    if (now - this.statusAt >= 3000) {
      this.statusAt = now;
      for (const mode of ['1v1', '2v2', '3v3'] as const) this.broadcastQueue(mode);
    }
  }

  private broadcastQueue(mode: RankedMode): void {
    const waiting = this.mm.size(mode);
    if (!waiting) return;
    for (const id of this.queuedPeers(mode)) this.deps.send(id, { op: 'queue-status', mode, waiting });
  }

  private queuedPeers(mode: RankedMode): string[] {
    // Peers are keyed by id in the matchmaker; `active` tells us which are searching.
    const out: string[] = [];
    for (const peerId of this.active.values()) if (this.mm.has(peerId) && this.modeOf.get(peerId) === mode) out.push(peerId);
    return out;
  }

  private readonly modeOf = new Map<string, RankedMode>();

  private startMatch(mode: RankedMode, entries: QueueEntry<Waiting>[]): void {
    for (const e of entries) this.modeOf.delete(e.id);
    const requeue = (list: QueueEntry<Waiting>[]) => {
      for (const e of list) {
        this.mm.add(mode, e);
        this.modeOf.set(e.id, mode);
      }
    };
    const open = entries.filter((e) => this.deps.isOpen(e.id));
    if (open.length !== entries.length) {
      // Someone vanished between the scan and now: the rest go back in the queue, keeping their wait time.
      requeue(open);
      return;
    }
    const players = entries.map((e) => ({ rating: e.rating, ...e.data }));
    const [a, b] = balanceTeams(players);
    // Random colours, and the stronger driver on each side takes station 1.
    const flip = Math.random() < 0.5;
    const red = (flip ? b : a).slice().sort((x, y) => y.rating - x.rating);
    const blue = (flip ? a : b).slice().sort((x, y) => y.rating - x.rating);
    const hostId = players[Math.floor(Math.random() * players.length)].peerId;
    const seated = this.deps.seat(hostId, players.map((p) => p.peerId));
    if (!seated) {
      requeue(entries);
      return;
    }
    const members = new Map<string, Member>();
    const roster: RankedRosterEntry[] = [];
    for (const [team, list] of [['red', red], ['blue', blue]] as const)
      for (const p of list) {
        members.set(p.peerId, { playerId: p.playerId, name: p.name, team, rating: p.rating, games: p.games });
        roster.push({ peerId: p.peerId, name: p.name, team, rating: p.rating, games: p.games });
        this.inMatch.set(p.peerId, seated.code);
      }
    const match: ActiveMatch = { code: seated.code, mode, hostId, members, reports: new Map(), abandoned: new Set(), finalized: false, reportTimer: null, ageTimer: null };
    match.ageTimer = setTimeout(() => void this.finalize(match, null, 'void', 'The match never reported a result'), this.deps.maxMatchMs ?? 45 * 60_000);
    match.ageTimer.unref?.();
    this.matches.set(seated.code, match);
    for (const p of players) {
      this.deps.send(p.peerId, { op: 'matched', room: seated.code, peerId: p.peerId, hostId, token: seated.tokens.get(p.peerId) ?? '', mode, team: members.get(p.peerId)!.team, roster });
    }
    this.log(`${mode} match ${seated.code}: ${roster.map((r) => `${r.name}(${r.rating},${r.team})`).join(' ')}`);
  }

  // ───────────────────────────── results ─────────────────────────────

  /** A member reports the result they saw. */
  result(peerId: string, report: { winner: unknown; red: unknown; blue: unknown }): void {
    const code = this.inMatch.get(peerId);
    const m = code && this.matches.get(code);
    if (!m || m.finalized || m.reports.has(peerId)) return;
    const winner = report.winner;
    if (winner !== 'red' && winner !== 'blue' && winner !== 'tie') return;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(99999, Math.round(v))) : 0);
    m.reports.set(peerId, { winner, red: num(report.red), blue: num(report.blue) });
    if (!m.reportTimer) {
      m.reportTimer = setTimeout(() => this.evaluate(m, true), this.deps.reportWindowMs ?? 60_000);
      m.reportTimer.unref?.();
    }
    this.evaluate(m, false);
  }

  /**
   * Decide from the reports so far. The host and ≥ half of the other drivers must agree. Once agreement is
   * impossible, or time has run out, the match is voided.
   */
  private evaluate(m: ActiveMatch, timedOut: boolean): void {
    if (m.finalized) return;
    const host = m.reports.get(m.hostId);
    const others = [...m.members.keys()].filter((id) => id !== m.hostId);
    const need = Math.ceil(others.length / 2);
    if (host) {
      const agree = others.filter((id) => m.reports.get(id)?.winner === host.winner).length;
      if (agree >= need) return void this.finalize(m, host, 'final');
      const disagree = others.filter((id) => m.reports.has(id) && m.reports.get(id)!.winner !== host.winner).length;
      if (others.length - disagree < need) return void this.finalize(m, null, 'void', 'The players did not agree on the result');
    }
    if (timedOut) void this.finalize(m, null, 'void', 'The result could not be verified');
  }

  /** A peer left its room for good. */
  peerLeft(peerId: string): void {
    const code = this.inMatch.get(peerId);
    const m = code && this.matches.get(code);
    if (m && !m.finalized) {
      // Once any result is in, leaving is just walking away from the results screen.
      if (m.reports.size === 0 && !m.reports.has(peerId)) {
        m.abandoned.add(peerId);
        const teams = new Set([...m.abandoned].map((id) => m.members.get(id)!.team));
        if (teams.size > 1) void this.finalize(m, null, 'void', 'Both teams left');
        else void this.finalize(m, { winner: [...teams][0] === 'red' ? 'blue' : 'red', red: 0, blue: 0 }, 'abandoned');
      } else this.evaluate(m, false);
    }
    this.inMatch.delete(peerId);
    this.peerGone(peerId);
  }

  /** The peer's socket is gone: drop it from the queue. */
  peerGone(peerId: string): void {
    this.modeOf.delete(peerId);
    this.mm.remove(peerId);
    if (!this.inMatch.has(peerId)) for (const [playerId, p] of this.active) if (p === peerId) this.active.delete(playerId);
  }

  roomClosed(code: string): void {
    const m = this.matches.get(code);
    if (!m) return;
    if (!m.finalized) void this.finalize(m, null, 'void', 'The room closed');
    for (const id of m.members.keys()) if (this.inMatch.get(id) === code) this.inMatch.delete(id);
    this.matches.delete(code);
  }

  private async finalize(m: ActiveMatch, report: Report | null, status: 'final' | 'abandoned' | 'void', reason?: string): Promise<void> {
    if (m.finalized) return;
    m.finalized = true;
    if (m.reportTimer) clearTimeout(m.reportTimer);
    if (m.ageTimer) clearTimeout(m.ageTimer);
    const participants: RankedParticipant[] = [...m.members.values()].map((p) => ({ playerId: p.playerId, team: p.team, rating: p.rating, games: p.games }));
    const ids = [...m.members.keys()];
    const byPlayer = new Map(ids.map((id) => [m.members.get(id)!.playerId, id]));
    const changes = status === 'void' ? participants.map((p) => ({ playerId: p.playerId, before: p.rating, after: p.rating, delta: 0, result: 'none' as const })) : rateMatch(participants, report!.winner, new Set([...m.abandoned].map((id) => m.members.get(id)!.playerId)));
    const record: MatchRecord = {
      mode: m.mode,
      season: RANKED_SEASON_ID,
      outcome: report?.winner ?? 'tie',
      redScore: report?.red ?? 0,
      blueScore: report?.blue ?? 0,
      status,
      players: changes.map((c) => {
        const mem = m.members.get(byPlayer.get(c.playerId)!)!;
        return { playerId: c.playerId, name: mem.name, team: mem.team, before: c.before, after: c.after, result: c.result };
      }),
    };
    try {
      await this.deps.store.saveMatch(record, changes);
    } catch (e) {
      this.log(`saving match ${m.code} failed: ${(e as Error).message}`);
    }
    for (const c of changes) {
      const peerId = byPlayer.get(c.playerId)!;
      this.deps.send(peerId, { op: 'rating', mode: m.mode, status, before: c.before, after: c.after, delta: c.delta, result: c.result, ...(reason ? { reason } : {}) });
      // Free the device for its next search.
      if (this.active.get(c.playerId) === peerId) this.active.delete(c.playerId);
    }
    for (const id of ids) if (this.inMatch.get(id) === m.code) this.inMatch.delete(id);
    this.log(`match ${m.code} ${status}${report ? ` winner=${report.winner}` : ''}${reason ? ` (${reason})` : ''}`);
  }
}

export { MODE_SIZE };
