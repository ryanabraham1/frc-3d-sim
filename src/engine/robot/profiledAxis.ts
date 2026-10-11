/**
 * One motor-driven axis (a hood, a turret) moving under a trapezoidal profile, the way a real mechanism under a motion
 * controller does: it accelerates toward the goal at a limited rate, cruises at its top speed, and starts slowing early
 * enough to stop on the goal instead of snapping to it or arriving at full speed.
 */
export class ProfiledAxis {
  vel = 0;

  constructor(public pos: number, readonly maxVel: number, readonly maxAcc: number, private readonly wrap = false) {}

  /** Advance toward `goal` by `dt` seconds. Returns the new position. */
  step(goal: number, dt: number): number {
    if (dt <= 0) return this.pos;
    let err = goal - this.pos;
    if (this.wrap) err = Math.atan2(Math.sin(err), Math.cos(err));
    // Fastest speed from which the axis can still stop on the goal.
    const stop = Math.sqrt(2 * this.maxAcc * Math.abs(err));
    const want = Math.sign(err) * Math.min(this.maxVel, stop);
    const dv = this.maxAcc * dt;
    this.vel += Math.max(-dv, Math.min(dv, want - this.vel));
    const move = this.vel * dt;
    // Settled: within a hair of the goal and slow, or this step would cross it.
    if ((Math.abs(err) < 1e-4 && Math.abs(this.vel) < dv) || (move !== 0 && Math.sign(move) === Math.sign(err) && Math.abs(move) >= Math.abs(err))) {
      this.pos += err;
      this.vel = 0;
    } else this.pos += move;
    if (this.wrap) this.pos = Math.atan2(Math.sin(this.pos), Math.cos(this.pos));
    return this.pos;
  }

  /** Jump straight to a position at rest (resets, replicas). */
  set(pos: number): void {
    this.pos = pos;
    this.vel = 0;
  }
}
