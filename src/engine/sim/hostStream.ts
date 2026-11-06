import { COMMAND_TIMEOUT_MS } from '../net/hostSync';
import { SnapshotEncoder, type SnapshotSource } from '../net/snapshotEncoder';
import type { RobotCommand } from '../robot/robot';

/** Host streams a snapshot every N physics steps (90 Hz / 3 = 30 Hz). */
export const SNAPSHOT_EVERY_STEPS = 3;
/** While nothing is stepping (waiting, paused, results), keep clients in sync at this interval (ms). */
export const IDLE_SNAPSHOT_MS = 200;
/** Snapshots the page hasn't sent yet. A busy page must not collect stale ones: skips keep their deltas for the next. */
export const MAX_SNAPSHOTS_IN_FLIGHT = 2;

/**
 * The host half of the simulation worker: holds remote drivers' latest commands and decides when to encode a snapshot.
 * The socket stays on the page (WebRTC isn't available in workers), so each snapshot leaves here as an ArrayBuffer for
 * the page to send. Everything it knows about the link comes from the page.
 */
export class HostStream {
  private readonly cmds = new Map<number, { cmd: RobotCommand; seq: number; at: number }>();
  private readonly encoder: SnapshotEncoder;
  /** The pool's change list has one reader; frames and snapshots each need all of it, at their own pace. */
  private readonly forFrame = new Set<number>();
  private readonly forSnapshot = new Set<number>();
  private stepsSinceSnap = 0;
  private lastIdle = -Infinity;
  private inFlight = 0;
  private connected = true;
  private clear = true;

  constructor(private readonly src: SnapshotSource, private readonly post: (buf: ArrayBuffer) => void) {
    this.encoder = new SnapshotEncoder(src, () => this.take(this.forSnapshot));
  }

  private take(set: Set<number>): number[] {
    for (const i of this.src.pool.takeChanges()) {
      this.forFrame.add(i);
      this.forSnapshot.add(i);
    }
    const out = [...set];
    set.clear();
    return out;
  }

  /** Piece state changes for the page's own view. */
  takeFrameChanges(): number[] {
    return this.take(this.forFrame);
  }

  setCommand(robotId: number, cmd: RobotCommand, seq: number, now = performance.now()): void {
    this.cmds.set(robotId, { cmd, seq, at: now });
  }

  dropCommands(robotId?: number): void {
    if (robotId === undefined) this.cmds.clear();
    else this.cmds.delete(robotId);
  }

  /** Latest command from a remote robot's driver (null if none / disconnected). */
  command(robotId: number, now = performance.now()): RobotCommand | null {
    const latest = this.cmds.get(robotId);
    if (!latest || !this.connected || now - latest.at > COMMAND_TIMEOUT_MS) return null;
    return latest.cmd;
  }

  /** `connected`: in the room. `clear`: the socket isn't backed up, so it can take a snapshot. */
  setLink(connected: boolean, clear: boolean): void {
    this.connected = connected;
    this.clear = clear;
  }

  /** The page has sent a snapshot. */
  ack(): void {
    if (this.inFlight > 0) this.inFlight--;
  }

  requestKeyframe(): void {
    this.encoder.requestKeyframe();
  }

  /** After each batch of physics steps (or none): send a snapshot if one is due. Catch-up steps share one fresh snapshot. */
  update(steps: number, stepping: boolean, time: number, now: number): void {
    if (stepping || steps > 0) {
      this.stepsSinceSnap += steps;
      if (this.stepsSinceSnap < SNAPSHOT_EVERY_STEPS) return;
      this.stepsSinceSnap %= SNAPSHOT_EVERY_STEPS;
    } else {
      if (now - this.lastIdle <= IDLE_SNAPSHOT_MS) return;
      this.lastIdle = now;
    }
    if (!this.connected || !this.clear || this.inFlight >= MAX_SNAPSHOTS_IN_FLIGHT) return;
    this.inFlight++;
    this.post(this.encoder.encode(time, (id) => this.cmds.get(id)?.seq ?? 0));
  }
}
