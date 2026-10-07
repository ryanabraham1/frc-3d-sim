import * as THREE from 'three';
import type { FuelContacts } from './fuelContacts';

/**
 * Visual-only game-piece flow through a robot. Scoring and physics are unchanged: a piece counts as held the moment
 * it is captured, and launches spawn at the launcher exit as before. This draws what happens in between.
 *
 * - Intake: a copy of the captured piece starts exactly where the physical piece was taken (`noteCapture`) and rides
 *   along the model's intake path (rollers → indexer → stow) into the robot.
 * - Feed: while a multi-piece robot fires, the next pieces ride from the stow up to the shooter, one per shot.
 *
 * Paths are polylines in the robot's visual frame (x forward, y up, -z left), re-read from the model at spawn so
 * pivoting intakes and shooters are followed. With CAD FUEL contacts, paths drive roller traction instead of
 * directly placing the ball: velocity, gravity and surface reactions determine its position.
 */
export interface FlowPaths {
  /** Intake path after the capture point, ending at the stow point (where the held piece rests / the hopper). */
  intake(from?: THREE.Vector3 | null): THREE.Vector3[];
  /** Hand a completed intake token to the hopper at this exact robot-frame position. */
  arrive?(position: THREE.Vector3): void;
  /** Stow → shooter path for the feed stream (multi-piece robots). Omit for no feed animation. */
  feed?(): THREE.Vector3[];
}

interface Token {
  velocity: THREE.Vector3;
  obj: THREE.Object3D;
  pts: THREE.Vector3[];
  /** Cumulative segment lengths. */
  cum: number[];
  t: number;
  dur: number;
  kind: 'intake' | 'feed';
}

/** Max animated pieces in flight per robot (a fast FUEL intake swallows ~10 / s). */
const MAX_TOKENS = 14;
/** Travel speed through the robot (m/s) and duration bounds (s). */
const SPEED = 2.4;
const MIN_DUR = 0.22;
const MAX_DUR = 0.65;

export class PieceFlow {
  readonly transportAudit = { arrivals: 0, blocked: 0 };
  private readonly free: THREE.Object3D[] = [];
  private readonly live: Token[] = [];
  private readonly captures: THREE.Vector3[] = [];
  private lastHeld = -1;
  private readonly tmp = new THREE.Vector3();
  private readonly contactPosition = new Float32Array(3);
  private readonly contactVelocity = new Float32Array(3);
  private readonly motorTarget = new THREE.Vector3();

  constructor(
    private readonly visual: THREE.Group,
    private readonly make: () => THREE.Object3D,
    private readonly paths: FlowPaths,
    /** Spin pieces as they roll through (balls); flat pieces (rings) stay level. */
    private readonly roll: boolean,
    private readonly radius = 0.075,
    /** FUEL roller transport: integrate motor pull and gravity, then collide with the robot surfaces. */
    private readonly contacts?: FuelContacts,
  ) {}

  /** A piece was captured at this world position (call when it is pushed onto `robot.held`). */
  noteCapture(world: { x: number; y: number; z: number }): void {
    if (this.captures.length < MAX_TOKENS) this.captures.push(new THREE.Vector3(world.x, world.y, world.z));
  }

  /** Pieces still travelling into the robot (drawn by the flow, not yet by the robot's held / hopper visual). */
  get inTransit(): number {
    let n = 0;
    for (const t of this.live) if (t.kind === 'intake') n++;
    return n;
  }

  /** Drop everything (robot reset, preload). */
  clear(held: number): void {
    for (const t of this.live) this.release(t.obj);
    this.live.length = 0;
    this.captures.length = 0;
    this.lastHeld = held;
  }

  /**
   * Advance one rendered frame. `held` is the robot's current piece count; `fireInterval` the launcher's seconds per
   * shot (feed tokens arrive at the shooter in time for the next shot). `replica` (multiplayer client): captures
   * aren't reported, so new pieces start at the intake mouth; otherwise pieces with no capture point (preloads,
   * scripted loads) appear in place.
   */
  update(dt: number, held: number, fireInterval: number, replica = false): void {
    if (this.lastHeld < 0) this.lastHeld = held;
    const delta = held - this.lastHeld;
    this.lastHeld = held;
    if (delta > 0) {
      this.visual.updateMatrixWorld();
      for (let k = 0; k < delta; k++) {
        const from = this.captures.shift();
        if (from) this.spawnIntake(this.visual.worldToLocal(from));
        else if (replica) this.spawnIntake(null);
      }
    } else if (delta < 0 && held > 0 && this.paths.feed) {
      this.spawnFeed(Math.max(0.08, Math.min(0.4, fireInterval * 0.95)));
    }
    if (delta <= 0) this.captures.length = 0;
    if (this.live.length && this.contacts) this.contacts.sync();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const tok = this.live[i];
      tok.t += dt;
      const u = Math.min(1, tok.t / tok.dur);
      const end = tok.pts[tok.pts.length - 1];
      const delivered = !this.contacts || tok.kind === 'feed' || tok.obj.position.distanceTo(end) < this.radius * 1.25;
      if (u >= 1 && (delivered || tok.t >= tok.dur + .8)) {
        if (tok.kind === 'intake') this.arrive(tok);
        this.release(tok.obj);
        this.live.splice(i, 1);
        continue;
      }
      // Ease in-out: pieces are grabbed, accelerate through the rollers, and settle at the end.
      const e = u * u * (3 - 2 * u);
      this.tmp.copy(tok.obj.position);
      if (this.contacts) {
        const time = Math.min(dt, .1), steps = Math.max(1, Math.ceil(time * 120)), h = time / steps;
        for (let sub = 0; sub < steps; sub++) {
          const progress = Math.max(0, u - (steps - sub - 1) * h / tok.dur);
          const eased = progress * progress * (3 - 2 * progress);
          this.at(tok, eased * tok.cum[tok.cum.length - 1], this.motorTarget);
          // Roller/feeder traction pulls toward the transport lane. Surface reaction determines the actual position.
          this.motorTarget.sub(tok.obj.position).multiplyScalar(1 / .025).clampLength(0,tok.kind === 'feed' ? 12 : 6);
          tok.velocity.lerp(this.motorTarget,1-Math.exp(-60*h));
          tok.velocity.y -= 9.81 * h;
          tok.obj.position.addScaledVector(tok.velocity, h);
          tok.obj.position.toArray(this.contactPosition);tok.velocity.toArray(this.contactVelocity);
          this.contacts.resolve(this.contactPosition,this.contactVelocity,0,this.radius * .96);
          tok.obj.position.fromArray(this.contactPosition);tok.velocity.fromArray(this.contactVelocity);
        }
      } else this.at(tok, e * tok.cum[tok.cum.length - 1], tok.obj.position);
      if (this.roll) {
        // Roll in the actual travel direction rather than spin randomly in place.
        tok.obj.rotation.x += (tok.obj.position.z - this.tmp.z) / this.radius;
        tok.obj.rotation.z -= (tok.obj.position.x - this.tmp.x) / this.radius;
      } else {
        // Flat pieces pitch with the path (riding up a ramp) and stay level otherwise.
        const s = Math.min(tok.cum[tok.cum.length - 1], e * tok.cum[tok.cum.length - 1] + 0.02);
        this.at(tok, s, this.tmp).sub(tok.obj.position);
        const pitch = Math.atan2(this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z) || 1e-6);
        tok.obj.rotation.set(0, 0, Math.abs(pitch) > 1e-3 ? Math.sign(this.tmp.x || 1) * pitch : 0);
      }
    }
  }

  dispose(): void {
    this.clear(0);
    for (const o of this.free) o.removeFromParent();
    this.free.length = 0;
  }

  private spawnIntake(from: THREE.Vector3 | null): void {
    const path = this.paths.intake(from);
    if (path.length < 1) return;
    const pts = from ? [from, ...path] : path;
    this.spawn(pts, 'intake');
  }

  private spawnFeed(dur: number): void {
    const path = this.paths.feed?.() ?? [];
    if (path.length < 2) return;
    const tok = this.spawn(path, 'feed');
    if (tok) tok.dur = dur;
  }

  private spawn(pts: THREE.Vector3[], kind: Token['kind']): Token | null {
    if (this.live.length >= MAX_TOKENS) {
      // Oldest token finishes instantly so a fast intake never queues up stale animations.
      const old = this.live.shift()!;
      if (old.kind === 'intake') this.arrive(old);
      this.release(old.obj);
    }
    if (this.roll && kind === 'intake' && pts.length > 2) {
      // Round roller/ramp corners once at spawn; per-frame motion still uses the cheap polyline sampler.
      const rounded = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const corner = pts[i], before = pts[i - 1], after = pts[i + 1];
        const trim = Math.min(0.06, corner.distanceTo(before) * 0.25, corner.distanceTo(after) * 0.25);
        const a = corner.clone().lerp(before, trim / Math.max(1e-6, corner.distanceTo(before)));
        const b = corner.clone().lerp(after, trim / Math.max(1e-6, corner.distanceTo(after)));
        rounded.push(a);
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          rounded.push(a.clone().multiplyScalar((1-t)**2).addScaledVector(corner, 2*t*(1-t)).addScaledVector(b, t*t));
        }
      }
      rounded.push(pts[pts.length - 1]);
      pts = rounded;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const len = cum[cum.length - 1];
    const obj = this.free.pop() ?? this.make();
    obj.userData.flowToken = true;
    if (!obj.parent) this.visual.add(obj);
    obj.visible = true;
    obj.position.copy(pts[0]);
    obj.rotation.set(0, 0, 0);
    const tok: Token = {
      velocity: new THREE.Vector3(),
      obj, pts, cum, t: 0, kind,
      dur: Math.min(MAX_DUR, Math.max(MIN_DUR, len / SPEED)),
    };
    this.live.push(tok);
    return tok;
  }

  private release(o: THREE.Object3D): void {
    o.visible = false;
    this.free.push(o);
  }

  private arrive(tok: Token): void {
    const end = tok.pts[tok.pts.length - 1];
    this.transportAudit.arrivals++;
    if (this.contacts && tok.obj.position.distanceTo(end) > this.radius * 2) this.transportAudit.blocked++;
    this.paths.arrive?.(this.contacts ? tok.obj.position : end);
  }

  /** Point at arc length `s` along the token's path. */
  private at(tok: Token, s: number, out: THREE.Vector3): THREE.Vector3 {
    const { pts, cum } = tok;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    return out.lerpVectors(pts[i - 1], pts[i], Math.min(1, Math.max(0, (s - cum[i - 1]) / seg)));
  }
}
