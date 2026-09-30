import { Alliance, opponent } from '../coords';

export type FoulKind = 'minor' | 'major';

export interface FoulRecord {
  t: number;
  alliance: Alliance;
  kind: FoulKind;
  rule: string;
  robotId: number;
  note?: string;
}

export interface ScoreEvent {
  t: number;
  alliance: Alliance;
  category: string;
  points: number;
}

/** Serializable scoreboard state (multiplayer snapshots). Score events are host-only. */
export interface ScoreState {
  points: Record<Alliance, Record<string, number>>;
  counters: Record<Alliance, Record<string, number>>;
  fouls: FoulRecord[];
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

  constructor(readonly foulValues: Record<FoulKind, number> = { minor: 5, major: 15 }) {}

  add(alliance: Alliance, category: string, pts: number, t = 0): void {
    this.points[alliance][category] = (this.points[alliance][category] ?? 0) + pts;
    this.events.push({ t, alliance, category, points: pts });
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
    };
  }

  restore(s: ScoreState): void {
    for (const a of ['red', 'blue'] as Alliance[]) {
      this.points[a] = { ...s.points[a] };
      this.counters[a] = { ...s.counters[a] };
    }
    this.fouls.length = 0;
    this.fouls.push(...s.fouls);
  }

  reset(): void {
    for (const a of ['red', 'blue'] as Alliance[]) {
      this.points[a] = {};
      this.counters[a] = {};
    }
    this.fouls.length = 0;
    this.events.length = 0;
  }
}
