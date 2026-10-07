/**
 * Ranked play: modes, Elo, tiers, team balancing and the ban/pick draft. Pure (no I/O) so the relay, the
 * lobby and the tests all share one implementation. See docs/RANKED.md.
 */

import type { SlotId } from './protocol';

export type RankedMode = '1v1' | '2v2' | '3v3';
export const RANKED_MODES: readonly RankedMode[] = ['1v1', '2v2', '3v3'];
/** Drivers per alliance. */
export const MODE_SIZE: Record<RankedMode, number> = { '1v1': 1, '2v2': 2, '3v3': 3 };
export const MODE_LABEL: Record<RankedMode, string> = { '1v1': '1 v 1', '2v2': '2 v 2', '3v3': '3 v 3' };
/** Ranked is played on one game at a time (the season the community is currently competing in). */
export const RANKED_SEASON_ID = '2026-rebuilt';

export const isRankedMode = (m: unknown): m is RankedMode => typeof m === 'string' && (RANKED_MODES as readonly string[]).includes(m);

export type Team = 'red' | 'blue';
export type Outcome = Team | 'tie';

// ───────────────────────────── Elo ─────────────────────────────

export const START_RATING = 1000;
export const PLACEMENT_GAMES = 5;
export const MIN_RATING = 100;
/** Games before a player appears on the leaderboard (tiers still wait for PLACEMENT_GAMES). */
export const LEADERBOARD_MIN_GAMES = 1;
export const LEADERBOARD_SIZE = 25;

/** Probability that a side rated `a` beats a side rated `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** New players move fast so they find their level quickly; veterans settle. */
export function kFactor(games: number): number {
  if (games < PLACEMENT_GAMES * 2) return 40;
  if (games < 30) return 28;
  return 20;
}

export const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : START_RATING);

// ───────────────────────────── rank ladder ─────────────────────────────

export type TierId = 'bolt' | 'gear' | 'piston' | 'champion' | 'apex';

export interface Tier {
  id: TierId;
  name: string;
  /** Lowest rating in the tier (Bolt also holds everything below it). */
  min: number;
  color: string;
  /** Three divisions (I–III) of DIVISION_POINTS each; Apex is open-ended. */
  divisions: boolean;
}

/** Ladder from the bottom up. A new player (1000) starts at Gear III. */
export const TIERS: readonly Tier[] = [
  { id: 'bolt', name: 'Bolt', min: 750, color: '#d9894b', divisions: true },
  { id: 'gear', name: 'Gear', min: 900, color: '#c7d0dd', divisions: true },
  { id: 'piston', name: 'Piston', min: 1050, color: '#f4c542', divisions: true },
  { id: 'champion', name: 'Champion', min: 1200, color: '#c26bff', divisions: true },
  { id: 'apex', name: 'Apex', min: 1350, color: '#ff5d73', divisions: false },
];
export const DIVISION_POINTS = 50;
const ROMAN = ['', 'I', 'II', 'III'];

export interface RankInfo {
  tier: Tier;
  tierIndex: number;
  /** 1–3, or 0 for Apex. */
  division: 0 | 1 | 2 | 3;
  /** "Gear III", "Apex". */
  label: string;
  /** Rating points into the current division (Apex: points above the Apex line). */
  points: number;
  /** 0–1 progress toward the next division/tier (1 for Apex). */
  progress: number;
  /** Name of the next rank, or null at the top. */
  next: string | null;
  /** Position on the whole ladder (0 = Bolt I … 12 = Apex), for comparing ranks. */
  ordinal: number;
}

/** Where a rating sits on the ladder. Anything below Bolt's line is Bolt I. */
export function rankFor(rating: number): RankInfo {
  let tierIndex = 0;
  TIERS.forEach((t, i) => {
    if (rating >= t.min) tierIndex = i;
  });
  const tier = TIERS[tierIndex];
  if (!tier.divisions) {
    return { tier, tierIndex, division: 0, label: tier.name, points: rating - tier.min, progress: 1, next: null, ordinal: tierIndex * 3 };
  }
  const into = Math.max(0, rating - tier.min);
  const division = (Math.min(2, Math.floor(into / DIVISION_POINTS)) + 1) as 1 | 2 | 3;
  const points = Math.min(into - (division - 1) * DIVISION_POINTS, DIVISION_POINTS);
  const nextTier = TIERS[tierIndex + 1];
  return {
    tier,
    tierIndex,
    division,
    label: `${tier.name} ${ROMAN[division]}`,
    points,
    progress: points / DIVISION_POINTS,
    next: division < 3 ? `${tier.name} ${ROMAN[division + 1]}` : nextTier.divisions ? `${nextTier.name} I` : nextTier.name,
    ordinal: tierIndex * 3 + (division - 1),
  };
}

/** The rank to show: null while the player is still in placement matches. */
export function visibleRank(rating: number, games: number): RankInfo | null {
  return games < PLACEMENT_GAMES ? null : rankFor(rating);
}

export interface RankedParticipant {
  /** Stable identity (hash of the device secret). */
  playerId: string;
  team: Team;
  rating: number;
  games: number;
}

export interface RatingChange {
  playerId: string;
  before: number;
  after: number;
  delta: number;
  result: 'win' | 'loss' | 'draw' | 'abandon' | 'none';
}

/**
 * Rating changes for a finished match. Team strength is the mean rating of its members. A player who left
 * (`abandoned`) is scored as a loss even if their team was ahead; their teammates who stayed keep their
 * rating (the match is void for them), and the opponents are scored as winners.
 */
export function rateMatch(players: RankedParticipant[], outcome: Outcome, abandoned: ReadonlySet<string> = new Set()): RatingChange[] {
  const team = (t: Team) => players.filter((p) => p.team === t);
  const strength = { red: avg(team('red').map((p) => p.rating)), blue: avg(team('blue').map((p) => p.rating)) };
  // Abandonment decides the outcome: the side that lost a player loses.
  const redLeft = team('red').some((p) => abandoned.has(p.playerId));
  const blueLeft = team('blue').some((p) => abandoned.has(p.playerId));
  const decided: Outcome = redLeft && !blueLeft ? 'blue' : blueLeft && !redLeft ? 'red' : outcome;
  return players.map((p) => {
    const mine = p.team;
    const other: Team = mine === 'red' ? 'blue' : 'red';
    const score = decided === 'tie' ? 0.5 : decided === mine ? 1 : 0;
    const raw = Math.round(kFactor(p.games) * (score - expectedScore(strength[mine], strength[other])));
    const left = abandoned.has(p.playerId);
    const teamLeft = mine === 'red' ? redLeft : blueLeft;
    // Stayers on the abandoning side are not punished for a teammate's exit.
    if (teamLeft && !left && !(redLeft && blueLeft)) return { playerId: p.playerId, before: p.rating, after: p.rating, delta: 0, result: 'none' };
    const delta = left ? Math.min(raw, -Math.round(kFactor(p.games) / 2)) : raw;
    const after = Math.max(MIN_RATING, p.rating + delta);
    return {
      playerId: p.playerId,
      before: p.rating,
      after,
      delta: after - p.rating,
      result: left ? 'abandon' : decided === 'tie' ? 'draw' : decided === mine ? 'win' : 'loss',
    };
  });
}

// ───────────────────────────── matchmaking ─────────────────────────────

/** How far apart (rating) two players may be after waiting `waitedMs`: starts tight, opens up steadily. */
export function matchWindow(waitedMs: number): number {
  return Math.min(1200, 100 + Math.floor(waitedMs / 1000) * 15);
}

/** Split into two teams of equal size with the closest total rating (exhaustive; at most 6 players). */
export function balanceTeams<T extends { rating: number }>(players: T[]): [T[], T[]] {
  const n = players.length;
  const half = n / 2;
  let best: [T[], T[]] = [players.slice(0, half), players.slice(half)];
  let bestGap = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    let bits = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
    if (bits !== half || !(mask & 1)) continue; // fix player 0 on team A to avoid mirrored duplicates
    const a: T[] = [];
    const b: T[] = [];
    players.forEach((p, i) => (mask & (1 << i) ? a : b).push(p));
    const gap = Math.abs(avg(a.map((p) => p.rating)) - avg(b.map((p) => p.rating)));
    if (gap < bestGap - 1e-9) {
      bestGap = gap;
      best = [a, b];
    }
  }
  return best;
}

// ───────────────────────────── ban / pick draft ─────────────────────────────

export type DraftKind = 'ban' | 'pick';
export const BANS_PER_TEAM = 2;
export const BAN_SECONDS = 15;
export const PICK_SECONDS = 20;

export interface DraftStep {
  kind: DraftKind;
  /** The driver station whose turn it is. */
  slot: SlotId;
}

export interface DraftState {
  mode: RankedMode;
  /** Draftable robot ids. */
  pool: string[];
  steps: DraftStep[];
  /** Index of the current step (== steps.length when finished). */
  index: number;
  bans: { slot: SlotId; id: string }[];
  picks: { slot: SlotId; id: string }[];
}

const seat = (team: Team, n: number): SlotId => `${team}${n}` as SlotId;

/**
 * Turn order. Bans alternate red, blue, red, blue… cycling through each side's drivers. Picks snake so the
 * side that picks second in one round picks first in the next (3 v 3: R1 B1 | B2 R2 | R3 B3).
 */
export function draftSteps(mode: RankedMode): DraftStep[] {
  const size = MODE_SIZE[mode];
  const steps: DraftStep[] = [];
  for (let i = 0; i < BANS_PER_TEAM; i++) {
    steps.push({ kind: 'ban', slot: seat('red', (i % size) + 1) });
    steps.push({ kind: 'ban', slot: seat('blue', (i % size) + 1) });
  }
  for (let r = 0; r < size; r++) {
    const order: Team[] = r % 2 === 0 ? ['red', 'blue'] : ['blue', 'red'];
    for (const t of order) steps.push({ kind: 'pick', slot: seat(t, r + 1) });
  }
  return steps;
}

export function createDraft(mode: RankedMode, pool: string[]): DraftState {
  const minPool = BANS_PER_TEAM * 2 + MODE_SIZE[mode];
  if (pool.length < minPool) throw new Error(`Draft needs at least ${minPool} robots (have ${pool.length})`);
  return { mode, pool: [...pool], steps: draftSteps(mode), index: 0, bans: [], picks: [] };
}

export const draftDone = (d: DraftState): boolean => d.index >= d.steps.length;
export const currentStep = (d: DraftState): DraftStep | null => d.steps[d.index] ?? null;
export const teamOf = (slot: SlotId): Team => (slot.startsWith('red') ? 'red' : 'blue');

export function isBanned(d: DraftState, id: string): boolean {
  return d.bans.some((b) => b.id === id);
}

/** Robots the driver in `slot` may still choose for their current step. */
export function draftOptions(d: DraftState, slot: SlotId): string[] {
  const step = currentStep(d);
  if (!step) return [];
  if (step.kind === 'ban') return d.pool.filter((id) => !isBanned(d, id));
  const team = teamOf(slot);
  return d.pool.filter((id) => !isBanned(d, id) && !d.picks.some((p) => teamOf(p.slot) === team && p.id === id));
}

/** Apply a ban or pick. Returns an error string if the action isn't allowed right now. */
export function draftAct(d: DraftState, slot: SlotId, id: string): string | null {
  const step = currentStep(d);
  if (!step) return 'The draft is over';
  if (step.slot !== slot) return 'Not your turn';
  if (!draftOptions(d, slot).includes(id)) return step.kind === 'ban' ? 'That robot cannot be banned' : 'That robot is not available to you';
  (step.kind === 'ban' ? d.bans : d.picks).push({ slot, id });
  d.index++;
  return null;
}

/** Fallback when a turn times out: ban a random option / pick the first available (a shuffled order is passed in). */
export function draftAuto(d: DraftState, rand: () => number = Math.random): void {
  const step = currentStep(d);
  if (!step) return;
  const options = draftOptions(d, step.slot);
  if (!options.length) {
    d.index++;
    return;
  }
  draftAct(d, step.slot, options[Math.floor(rand() * options.length)]);
}

export const turnSeconds = (d: DraftState): number => (currentStep(d)?.kind === 'ban' ? BAN_SECONDS : PICK_SECONDS);

/** The robot each station ended up with. */
export function draftPicks(d: DraftState): Map<SlotId, string> {
  return new Map(d.picks.map((p) => [p.slot, p.id]));
}
