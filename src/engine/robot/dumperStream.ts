import type { Rng } from '../random';

/**
 * How a wide drum shooter (a "dumper") empties a loose hopper. Read off Team 2910's 2026 test clip, stepped frame by frame
 * (https://www.youtube.com/watch?v=0GGYrCSSMWU; every constant below is [EST] from that clip):
 *  - FUEL leaves as one rope of touching clumps (two or three balls side by side, then a short gap), not as evenly
 *    spaced single balls. The drum takes whatever the rollers push against it at that moment.
 *  - Neighbouring balls fly together: the rope is tight off the robot and only opens into a cloud near the top of the arc,
 *    so most of the aim error is shared by balls leaving at about the same time and drifts slowly along the stream.
 *  - The rope stays dense while the hopper is full, then thins to pairs and singles for the last third of the load, once
 *    the pile no longer presses against the drum: about half the feed rate at the end.
 *
 * Total yaw, pitch and speed error per ball stay at `spread` / `speedError`, and a full hopper still averages `rate`
 * balls/s, so the accuracy settings keep their meaning. Only how the error and timing are grouped changes.
 */

/** Time between the balls of one clump (s): one physics step, so they leave nearly together. */
const CLUMP_GAP = 0.008;
/** Clump sizes, each with its chance (mean about two balls). */
const CLUMP_ODDS: readonly [number, number][] = [[1, 0.25], [2, 0.45], [3, 0.3]];
/** Share of the aim variance the whole rope has in common; the rest is each ball's own. */
const SHARED_VARIANCE = 0.75;
/** How long the rope holds its direction before it has drifted to a new one (s). */
const DRIFT_TIME = 0.25;
/** Chance the next clump comes from anywhere on the drum, instead of beside the last one. */
const LANE_JUMP = 0.35;
/** Hopper fill below which the rope starts to thin. */
const TAIL_FILL = 0.3;
/** Extra feed time on the very last ball (1 = twice the interval). */
const TAIL_SLOWDOWN = 1.2;

export interface DumperBall {
  /** Lane the next ball leaves from. */
  nextLane: number;
  /** Seconds until the next ball. */
  interval: number;
  yawError: number;
  pitchError: number;
  /** Fractional speed error. */
  speedError: number;
}

export class DumperStream {
  private left = 0;
  private lane = 0;
  private step = 1;
  private size = 1;
  private drifting = false;
  private yaw = 0;
  private pitch = 0;
  private speed = 0;

  /** Trigger released: the next burst picks a fresh direction. */
  reset(): void {
    this.left = 0;
    this.drifting = false;
  }

  /** One ball leaves. `fill` is the hopper load before it, as a fraction of capacity. */
  next(rng: Rng, lanes: number, spread: number, speedError: number, rate: number, fill: number): DumperBall {
    const tail = Math.min(1, Math.max(0, fill) / TAIL_FILL);
    if (this.left <= 0) this.startClump(rng, lanes, tail);
    this.left--;
    const interval = this.left > 0 ? CLUMP_GAP
      : Math.max(CLUMP_GAP, this.size / rate * (1 + TAIL_SLOWDOWN * (1 - tail)) * rng.range(0.6, 1.4) - (this.size - 1) * CLUMP_GAP);
    const own = Math.sqrt(1 - SHARED_VARIANCE), shared = Math.sqrt(SHARED_VARIANCE);
    const ball = {
      nextLane: this.lane,
      interval,
      yawError: this.yaw * spread * shared + rng.gauss(0, spread * own),
      pitchError: this.pitch * spread * shared + rng.gauss(0, spread * own),
      speedError: this.speed * speedError * shared + rng.gauss(0, speedError * own),
    };
    this.drift(rng, interval);
    if (this.left > 0) this.advance(lanes);
    else this.pickLane(rng, lanes);
    ball.nextLane = this.lane;
    return ball;
  }

  private startClump(rng: Rng, lanes: number, tail: number): void {
    let roll = rng.next(), size = 1;
    for (const [n, odds] of CLUMP_ODDS) {
      size = n;
      if ((roll -= odds) <= 0) break;
    }
    // A thinning pile feeds singles.
    this.size = this.left = rng.chance(tail) ? Math.min(size, lanes) : 1;
    this.step = rng.chance(0.5) ? 1 : -1;
    if (!this.drifting) {
      this.drifting = true;
      this.yaw = rng.gauss();
      this.pitch = rng.gauss();
      this.speed = rng.gauss();
    }
  }

  /** The next ball of a clump sits beside the last, turning back at the edge of the drum. */
  private advance(lanes: number): void {
    if (this.lane + this.step < 0 || this.lane + this.step >= lanes) this.step = -this.step;
    this.lane += this.step;
  }

  /** The next clump starts beside this one, or sometimes anywhere across the drum. */
  private pickLane(rng: Rng, lanes: number): void {
    if (rng.chance(LANE_JUMP)) this.lane = rng.int(0, lanes - 1);
    else this.lane = Math.min(lanes - 1, Math.max(0, this.lane + rng.int(-1, 1)));
  }

  /** Each shared error relaxes toward a new direction, keeping unit variance. */
  private drift(rng: Rng, dt: number): void {
    const keep = Math.exp(-dt / DRIFT_TIME), fresh = Math.sqrt(1 - keep * keep);
    this.yaw = this.yaw * keep + rng.gauss() * fresh;
    this.pitch = this.pitch * keep + rng.gauss() * fresh;
    this.speed = this.speed * keep + rng.gauss() * fresh;
  }
}
