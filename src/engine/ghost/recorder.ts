import { GHOST_HZ, GHOST_VERSION, type GhostRun } from './format';

interface V3 { x: number; y: number; z: number }
interface Q4 extends V3 { w: number }

/** Records the driver's robot for a ghost run; MatchSim feeds it from the fixed step, so it works on a page or in a worker. */
export class GhostRecorder {
  private readonly poses: number[] = [];
  private readonly shots: number[] = [];
  private readonly scores: number[] = [];
  private count = 0;
  private lastScore = 0;

  constructor(private readonly alliance: 'red' | 'blue') {}

  /** Is a pose sample due at match time `t`? */
  due(t: number): boolean {
    return this.count / GHOST_HZ <= t;
  }

  sample(p: V3, q: Q4, score: number, t: number): void {
    this.poses.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    this.count++;
    this.noteScore(t, score);
  }

  shot(t: number, p: V3, v: V3): void {
    this.shots.push(t, p.x, p.y, p.z, v.x, v.y, v.z);
  }

  private noteScore(t: number, score: number): void {
    if (score === this.lastScore) return;
    this.lastScore = score;
    this.scores.push(t, score);
  }

  /** `score` is the final leaderboard score, which can include points assessed at the buzzer. */
  finish(t: number, score: number): GhostRun {
    this.noteScore(t, score);
    return { v: GHOST_VERSION, hz: GHOST_HZ, alliance: this.alliance, score, poses: this.poses, shots: this.shots, scores: this.scores };
  }
}
