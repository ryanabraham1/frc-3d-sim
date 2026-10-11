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
const DEADZONE = 0.012;
const DEADZONE_YAW = 0.012;
/** Time constant of the drawn correction easing (s). */
const OFFSET_TAU = 0.09;

/**
 * Client-side prediction for the driver's own robot. The client drives its robot immediately with local
 * physics (field colliders and nearby piece collision proxies) and keeps a pose history.
 * Acknowledged inputs anchor host simulation timestamps to local pose history. Packet arrival jitter
 * cannot shift which pose is compared. A fraction of the error is removed from the current pose and
 * the whole history, so it is not counted twice. RTT is a fallback until an input is acknowledged.
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
  /** Visual-only offsets (m / rad): each correction moves the body at once but is drawn eased out, so the
   * robot glides to the host's pose instead of stepping 30 times a second. */
  offX = 0;
  offZ = 0;
  offYaw = 0;
  private readonly hist: PoseSample[] = [];
  private readonly sendTimes = new Map<number, number>();
  private lastAck = 0;
  private pending: { state: RobotNetState; localMs: number; running: boolean; hostTime?: number } | null = null;
  /** Host simulation time mapped to the local prediction timeline using acknowledged inputs. */
  private hostToLocal: number | null = null;

  constructor(private readonly robot: Robot) {}

  /** TCP can deliver many snapshots together after a stall. Reconcile only the newest before driving. */
  queueSnapshot(state: RobotNetState, localMs: number, running: boolean, hostTime?: number): void {
    this.pending = { state, localMs, running, hostTime };
  }

  flush(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) this.onSnapshot(pending.state, pending.localMs, pending.running, pending.hostTime);
  }

  /** Ease the visual correction offsets toward zero (call once per drawn frame). */
  decayOffset(dt: number): void {
    const k = Math.exp(-dt / OFFSET_TAU);
    this.offX *= k;
    this.offZ *= k;
    this.offYaw *= k;
    if (Math.abs(this.offX) + Math.abs(this.offZ) + Math.abs(this.offYaw) < 1e-4) this.offX = this.offZ = this.offYaw = 0;
  }

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
  onSnapshot(ss: RobotNetState, localMs: number, running: boolean, hostTime?: number): void {
    if (ss.cmdSeq > this.lastAck) {
      const sent = this.sendTimes.get(ss.cmdSeq);
      if (sent !== undefined) {
        if (hostTime !== undefined && Number.isFinite(hostTime)) {
          // Arrival time includes network stalls. The snapshot's simulation time does not.
          // An ack anchors the input timeline; ease its small snapshot-phase differences.
          const offset = sent / 1000 - hostTime;
          this.hostToLocal = this.hostToLocal === null ? offset : this.hostToLocal + (offset - this.hostToLocal) * 0.1;
        }
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

    // A tipped-over robot is posed from snapshots until the host sets it back on its wheels.
    const can = this.enabled && running && ss.enabled && ss.climbPhase === 0 && !(ss.tipped ?? 0);
    if (!can) {
      this.active = false;
      this.hostToLocal = null;
      return;
    }
    if (!this.active) {
      this.active = true;
      this.snap(ss);
      return;
    }
    const at = hostTime !== undefined && this.hostToLocal !== null ? hostTime + this.hostToLocal : localMs / 1000 - this.rtt;
    const h = this.sampleAt(at);
    if (!h) return;
    const ex = ss.x - h.x;
    const ez = ss.z - h.z;
    const ey = wrapAngle(ss.yaw - h.yaw);
    // Current local tilt and delayed host tilt differ naturally on bumps and piece piles.
    // Real tipped/climbing/disabled states already stop prediction through `can` above.
    if (Math.hypot(ex, ez) > SNAP_DIST || Math.abs(ey) > SNAP_YAW) {
      this.snap(ss);
      return;
    }
    // Tiny errors are noise (RTT estimate wobble): correcting them every snapshot is visible jitter.
    const dist = Math.hypot(ex, ez);
    if (dist < DEADZONE && Math.abs(ey) < DEADZONE_YAW) return;
    // Small errors are removed gently, large ones faster.
    const blend = Math.min(0.6, BLEND * (0.5 + dist / 0.15));
    const dx = ex * blend;
    const dz = ez * blend;
    const dy = ey * blend;
    const b = this.robot.body;
    const t = b.translation();
    // Turn the chassis by dy about world up, keeping its tilt.
    const r = b.rotation();
    const sy = Math.sin(dy / 2);
    const cy = Math.cos(dy / 2);
    b.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);
    b.setRotation({ x: cy * r.x + sy * r.z, y: cy * r.y + sy * r.w, z: cy * r.z - sy * r.x, w: cy * r.w - sy * r.y }, true);
    // Shift both interpolation endpoints; otherwise the visual offset only cancels a fraction
    // of the correction when a snapshot arrives between physics steps.
    this.robot.shiftPreviousPose(dx, dz, dy);
    for (const p of this.hist) {
      p.x += dx;
      p.z += dz;
      p.yaw += dy;
    }
    this.offX -= dx;
    this.offZ -= dz;
    this.offYaw -= dy;
    this.corrections++;
  }

  private snap(ss: RobotNetState): void {
    const b = this.robot.body;
    b.setTranslation({ x: ss.x, y: ss.y, z: ss.z }, true);
    const q = ss.rot ?? [0, Math.sin(ss.yaw / 2), 0, Math.cos(ss.yaw / 2)];
    b.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.robot.resetDriveState();
    this.hist.length = 0;
    this.offX = this.offZ = this.offYaw = 0;
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
