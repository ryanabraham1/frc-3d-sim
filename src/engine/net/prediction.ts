import { yawFromQuat } from '../coords';
import type { Robot } from '../robot/robot';
import { wrapAngle } from '../units';
import type { RobotNetState } from './protocol';

interface PoseSample {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

/** Corrections larger than this snap instead of blending (m / rad). */
const SNAP_DIST = 1.0;
const SNAP_YAW = 1.0;
/** Longest round trip a single ack may report (s); anything slower is a stall, not the link. */
const MAX_RTT_SAMPLE = 1.0;
/** Fraction of the measured error removed per snapshot (~30 Hz). */
const BLEND = 0.3;

/**
 * Client-side prediction for the driver's own robot. The client drives its robot immediately with local
 * physics (field colliders only — game pieces aren't simulated on clients) and keeps a pose history.
 * Each snapshot shows where the host had the robot after receiving inputs sent ~1 RTT ago, so it is
 * compared with our predicted pose from 1 RTT ago; a fraction of that error is removed from the current
 * pose (and the whole history, so it isn't counted twice). No input replay needed.
 */
export class Predictor {
  /** Toggle for debugging (`game.predictor.enabled = false`). */
  enabled = true;
  /** Currently predicting (robot enabled, not climbing). */
  active = false;
  /** Smoothed round-trip time (s). */
  rtt = 0;
  corrections = 0;
  snaps = 0;
  private readonly hist: PoseSample[] = [];
  private readonly sendTimes = new Map<number, number>();
  private lastAck = 0;

  constructor(private readonly robot: Robot) {}

  onSent(seq: number, localMs: number): void {
    this.sendTimes.set(seq, localMs);
  }

  /** Record the predicted pose after a local physics step. */
  record(localMs: number): void {
    const t = this.robot.body.translation();
    const r = this.robot.body.rotation();
    this.hist.push({ t: localMs / 1000, x: t.x, z: t.z, yaw: yawFromQuat(r) });
    const cutoff = localMs / 1000 - 3;
    while (this.hist.length && this.hist[0].t < cutoff) this.hist.shift();
  }

  /** A snapshot arrived with the host's view of our robot. */
  onSnapshot(ss: RobotNetState, localMs: number, running: boolean): void {
    if (ss.cmdSeq > this.lastAck) {
      const sent = this.sendTimes.get(ss.cmdSeq);
      if (sent !== undefined) {
        // One stall (e.g. the host still loading the match when our first commands arrive) must not
        // poison the estimate: samples are capped, and the estimate falls fast but rises slowly. A
        // multi-second RTT would compare the host's pose with where we were seconds ago and drag the
        // robot backwards — drivers saw that as "can't move".
        const sample = Math.min(MAX_RTT_SAMPLE, (localMs - sent) / 1000);
        if (this.rtt === 0) this.rtt = sample;
        else this.rtt += (sample - this.rtt) * (sample < this.rtt ? 0.5 : 0.1);
      }
      this.lastAck = ss.cmdSeq;
      for (const k of this.sendTimes.keys()) if (k <= ss.cmdSeq) this.sendTimes.delete(k);
    }

    const can = this.enabled && running && ss.enabled && ss.climbPhase === 0;
    if (!can) {
      this.active = false;
      return;
    }
    if (!this.active) {
      this.active = true;
      this.snap(ss);
      return;
    }
    const h = this.sampleAt(localMs / 1000 - this.rtt);
    if (!h) return;
    const ex = ss.x - h.x;
    const ez = ss.z - h.z;
    const ey = wrapAngle(ss.yaw - h.yaw);
    if (Math.hypot(ex, ez) > SNAP_DIST || Math.abs(ey) > SNAP_YAW) {
      this.snap(ss);
      return;
    }
    const dx = ex * BLEND;
    const dz = ez * BLEND;
    const dy = ey * BLEND;
    const b = this.robot.body;
    const t = b.translation();
    const yaw = yawFromQuat(b.rotation()) + dy;
    b.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    for (const p of this.hist) {
      p.x += dx;
      p.z += dz;
      p.yaw += dy;
    }
    this.corrections++;
  }

  private snap(ss: RobotNetState): void {
    const b = this.robot.body;
    b.setTranslation({ x: ss.x, y: ss.y, z: ss.z }, true);
    b.setRotation({ x: 0, y: Math.sin(ss.yaw / 2), z: 0, w: Math.cos(ss.yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.hist.length = 0;
    this.snaps++;
  }

  private sampleAt(t: number): PoseSample | null {
    const h = this.hist;
    if (!h.length) return null;
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= t) {
        const a = h[i];
        const b = h[i + 1];
        if (!b || b.t === a.t) return a;
        const k = (t - a.t) / (b.t - a.t);
        return { t, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * k };
      }
    }
    return h[h.length - 1];
  }
}
