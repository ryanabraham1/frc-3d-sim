/**
 * Generic FRC match timeline. Pure logic (no rendering/physics) so it is unit-testable and can run
 * on a server later. Seasons supply the list of periods.
 */
export type RobotMode = 'auto' | 'teleop' | 'disabled';

export interface MatchPeriod {
  /** Stable id used by season rules, e.g. 'auto', 'shift1', 'endgame'. */
  id: string;
  label: string;
  duration: number;
  mode: RobotMode;
  /**
   * Periods sharing a displayGroup show one continuous countdown (e.g. TELEOP shows 2:20 → 0:00
   * across TRANSITION/SHIFT/END GAME). Periods without a group show their own remaining time.
   */
  displayGroup?: string;
}

export interface PeriodChange {
  from: MatchPeriod | null;
  to: MatchPeriod | null;
  /** Match time (s since start) at which the change happened. */
  at: number;
}

/** Serializable clock state (multiplayer snapshots). */
export interface ClockState {
  i: number;
  ep: number;
  e: number;
  s: boolean;
  f: boolean;
}

export class MatchClock {
  index = 0;
  elapsedInPeriod = 0;
  elapsed = 0;
  started = false;
  finished = false;

  constructor(readonly periods: MatchPeriod[]) {
    if (periods.length === 0) throw new Error('MatchClock needs at least one period');
  }

  get current(): MatchPeriod {
    return this.periods[Math.min(this.index, this.periods.length - 1)];
  }

  get mode(): RobotMode {
    return this.started && !this.finished ? this.current.mode : 'disabled';
  }

  get periodRemaining(): number {
    return Math.max(0, this.current.duration - this.elapsedInPeriod);
  }

  get totalDuration(): number {
    return this.periods.reduce((s, p) => s + p.duration, 0);
  }

  /** Seconds remaining until the end of the whole timeline. */
  get matchRemaining(): number {
    return Math.max(0, this.totalDuration - this.elapsed);
  }

  /** Countdown shown on the field timer. */
  get displayTime(): number {
    const cur = this.current;
    if (!cur.displayGroup) return this.periodRemaining;
    let t = this.periodRemaining;
    for (let i = this.index + 1; i < this.periods.length; i++) {
      if (this.periods[i].displayGroup !== cur.displayGroup) break;
      t += this.periods[i].duration;
    }
    return t;
  }

  /** Seconds from now until period `id` starts (0 if current, Infinity if already past/unknown). */
  timeUntil(id: string): number {
    if (this.current.id === id) return 0;
    let t = this.periodRemaining;
    for (let i = this.index + 1; i < this.periods.length; i++) {
      if (this.periods[i].id === id) return t;
      t += this.periods[i].duration;
    }
    return Infinity;
  }

  /** Seconds remaining in all periods of a given mode after now (e.g. teleop time left). */
  remainingInMode(mode: RobotMode): number {
    let t = this.current.mode === mode ? this.periodRemaining : 0;
    for (let i = this.index + 1; i < this.periods.length; i++) if (this.periods[i].mode === mode) t += this.periods[i].duration;
    return t;
  }

  next(): MatchPeriod | null {
    return this.periods[this.index + 1] ?? null;
  }

  start(): PeriodChange {
    this.started = true;
    this.finished = false;
    this.index = 0;
    this.elapsed = 0;
    this.elapsedInPeriod = 0;
    return { from: null, to: this.current, at: 0 };
  }

  snapshot(): ClockState {
    return { i: this.index, ep: this.elapsedInPeriod, e: this.elapsed, s: this.started, f: this.finished };
  }

  restore(s: ClockState): void {
    this.index = Math.max(0, Math.min(this.periods.length - 1, s.i));
    this.elapsedInPeriod = s.ep;
    this.elapsed = s.e;
    this.started = s.s;
    this.finished = s.f;
  }

  /** Advance time; returns every period transition that occurred (in order). */
  advance(dt: number): PeriodChange[] {
    const changes: PeriodChange[] = [];
    if (!this.started || this.finished) return changes;
    let remaining = dt;
    while (remaining > 0 && !this.finished) {
      const left = this.current.duration - this.elapsedInPeriod;
      if (remaining < left) {
        this.elapsedInPeriod += remaining;
        this.elapsed += remaining;
        remaining = 0;
      } else {
        this.elapsed += left;
        remaining -= left;
        const from = this.current;
        if (this.index + 1 >= this.periods.length) {
          this.elapsedInPeriod = from.duration;
          this.finished = true;
          changes.push({ from, to: null, at: this.elapsed });
        } else {
          this.index++;
          this.elapsedInPeriod = 0;
          changes.push({ from, to: this.current, at: this.elapsed });
        }
      }
    }
    return changes;
  }
}
