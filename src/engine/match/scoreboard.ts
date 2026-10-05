import { Alliance, opponent } from '../coords';

export type FoulKind = 'minor' | 'major';
/** A card shown with a foul. Cards are recorded without disabling robots. */
export type CardKind = 'yellow' | 'red';

export interface FoulRecord {
  t: number;
  alliance: Alliance;
  kind: FoulKind;
  rule: string;
  robotId: number;
  note?: string;
  /** Card issued with this foul (the manual's "MAJOR FOUL and YELLOW CARD"). */
  card?: CardKind;
}

export interface ScoreEvent {
  t: number;
  alliance: Alliance;
  category: string;
  points: number;
}

/** What one robot (player) earned: points by the same categories as the alliance, plus per-robot counters. */
export interface RobotScore {
  points: Record<string, number>;
  counters: Record<string, number>;
}

/** Serializable scoreboard state (multiplayer snapshots). Score events are host-only. */
export interface ScoreState {
  points: Record<Alliance, Record<string, number>>;
  counters: Record<Alliance, Record<string, number>>;
  fouls: FoulRecord[];
  robots: Record<number, RobotScore>;
}

/**
 * Per-alliance points by category + counters + fouls. Pure logic.
 * Foul points are credited to the OPPONENT (FRC convention).
 */
export class Scoreboard {
  readonly points: Record<Alliance, Record<string, number>> = { red: {}, blue: {} };
  readonly counters: Record<Alliance, Record<string, number>> = { red: {}, blue: {} };
  readonly fouls: FoulRecord[] = [];
  readonly events: ScoreEvent[] = [];
  /**
   * Per-robot credit (keyed by Robot id) for the post-match player breakdown. These mirror the alliance
   * categories but only hold what a robot can be credited with; the alliance numbers stay the source of truth.
   */
  robots: Record<number, RobotScore> = {};

  constructor(readonly foulValues: Record<FoulKind, number> = { minor: 5, major: 15 }) {}

  /** Add points to an alliance category; with `robotId` the robot is credited too. */
  add(alliance: Alliance, category: string, pts: number, t = 0, robotId?: number): void {
    this.points[alliance][category] = (this.points[alliance][category] ?? 0) + pts;
    this.events.push({ t, alliance, category, points: pts });
    if (robotId !== undefined) this.credit(robotId, category, pts);
  }

  private robot(id: number): RobotScore {
    return (this.robots[id] ??= { points: {}, counters: {} });
  }

  /** Credit a robot with category points (alliance totals are untouched: use `add` for new points). */
  credit(robotId: number, category: string, pts: number): void {
    const r = this.robot(robotId);
    r.points[category] = (r.points[category] ?? 0) + pts;
  }

  /** Overwrite a robot's category credit (for assessed-at-end values, mirroring `set`). */
  setCredit(robotId: number, category: string, pts: number): void {
    this.robot(robotId).points[category] = pts;
  }

  tally(robotId: number, counter: string, n = 1): void {
    const r = this.robot(robotId);
    r.counters[counter] = (r.counters[counter] ?? 0) + n;
  }

  setTally(robotId: number, counter: string, n: number): void {
    this.robot(robotId).counters[counter] = n;
  }

  robotCategory(robotId: number, category: string): number {
    return this.robots[robotId]?.points[category] ?? 0;
  }

  robotCounter(robotId: number, counter: string): number {
    return this.robots[robotId]?.counters[counter] ?? 0;
  }

  /** Fouls committed by one robot (they cost its alliance, see `foulPointsFor`). */
  foulsBy(robotId: number, kind: FoulKind): number {
    return this.fouls.filter((f) => f.robotId === robotId && f.kind === kind).length;
  }

  /** Overwrite a category (for assessed-at-end values like tower points). */
  set(alliance: Alliance, category: string, pts: number): void {
    this.points[alliance][category] = pts;
  }

  inc(alliance: Alliance, counter: string, n = 1): number {
    const v = (this.counters[alliance][counter] ?? 0) + n;
    this.counters[alliance][counter] = v;
    return v;
  }

  counter(alliance: Alliance, counter: string): number {
    return this.counters[alliance][counter] ?? 0;
  }

  category(alliance: Alliance, category: string): number {
    return this.points[alliance][category] ?? 0;
  }

  foul(f: FoulRecord): void {
    this.fouls.push(f);
  }

  /** Cards shown to an alliance's robots. */
  cardCount(alliance: Alliance, card: CardKind): number {
    return this.fouls.filter((f) => f.alliance === alliance && f.card === card).length;
  }

  /** Cards shown to one robot. */
  cardsFor(robotId: number, card: CardKind): number {
    return this.fouls.filter((f) => f.robotId === robotId && f.card === card).length;
  }

  foulCount(alliance: Alliance, kind: FoulKind): number {
    return this.fouls.filter((f) => f.alliance === alliance && f.kind === kind).length;
  }

  /** Points an alliance receives from its opponent's fouls. */
  foulPointsFor(alliance: Alliance): number {
    const opp = opponent(alliance);
    return this.foulCount(opp, 'minor') * this.foulValues.minor + this.foulCount(opp, 'major') * this.foulValues.major;
  }

  /** Points earned without foul credit. */
  earned(alliance: Alliance): number {
    return Object.values(this.points[alliance]).reduce((s, v) => s + v, 0);
  }

  total(alliance: Alliance): number {
    return this.earned(alliance) + this.foulPointsFor(alliance);
  }

  winner(): Alliance | 'tie' {
    const r = this.total('red');
    const b = this.total('blue');
    return r === b ? 'tie' : r > b ? 'red' : 'blue';
  }

  snapshot(): ScoreState {
    return {
      points: { red: { ...this.points.red }, blue: { ...this.points.blue } },
      counters: { red: { ...this.counters.red }, blue: { ...this.counters.blue } },
      fouls: this.fouls.map((f) => ({ ...f })),
      robots: Object.fromEntries(Object.entries(this.robots).map(([id, r]) => [id, { points: { ...r.points }, counters: { ...r.counters } }])),
    };
  }

  restore(s: ScoreState): void {
    for (const a of ['red', 'blue'] as Alliance[]) {
      this.points[a] = { ...s.points[a] };
      this.counters[a] = { ...s.counters[a] };
    }
    this.fouls.length = 0;
    this.fouls.push(...s.fouls);
    this.robots = Object.fromEntries(Object.entries(s.robots ?? {}).map(([id, r]) => [id, { points: { ...r.points }, counters: { ...r.counters } }]));
  }

  reset(): void {
    for (const a of ['red', 'blue'] as Alliance[]) {
      this.points[a] = {};
      this.counters[a] = {};
    }
    this.fouls.length = 0;
    this.events.length = 0;
    this.robots = {};
  }
}
