import * as THREE from 'three';
import type { FuelContacts } from './fuelContacts';

/**
 * Visual-only game-piece flow through a robot. Scoring and physics are unchanged: a piece counts as held the moment
 * it is captured, and launches spawn at the launcher exit as before. This draws what happens in between.
 *
 * - Intake: a copy of the captured piece starts exactly where the physical piece was taken (`noteCapture`) and rides
 *   along the model's intake path (rollers → indexer → stow) into the robot.
 * - Feed (indexer): while a multi-piece robot is spun up to shoot, its indexer pulls pieces out of the stow and lines
 *   them up nose to tail along each feed lane (one lane per shooter exit), as real hopper floors, spindexers and feed
 *   columns stage FUEL against the flywheel. Every shot takes the lead piece of its lane into the shooter and the rest
 *   of the lane steps forward one piece, so the stream visibly runs storage -> indexer -> shooter in time with the
 *   launches. Staged pieces are still held (they count toward `staged`, not the hopper visual).
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
  /** Stow → shooter path of feed lane `lane` (multi-piece robots). Omit for no feed animation. */
  feed?(lane: number): THREE.Vector3[];
  /** Feed lanes side by side (one per shooter exit / turret). Default 1. */
  lanes?: number;
  /** Lane the most recent shot left from, when the robot knows it (host); replicas round-robin. */
  shotLane?(): number | null;
}

/** A piece staged in an indexer lane. `s` = arc length from the stow end; `slot` 0 = against the shooter. */
interface Staged {
  obj: THREE.Object3D;
  s: number;
  slot: number;
}

interface Token {
  velocity: THREE.Vector3;
  obj: THREE.Object3D;
  pts: THREE.Vector3[];
  /** Cumulative segment lengths. */
  cum: number[];
  t: number;
  dur: number;
  kind: 'intake';
}

/** Max animated pieces in flight per robot (a fast FUEL intake swallows ~10 / s). */
const MAX_TOKENS = 14;
/** Travel speed through the robot (m/s) and duration bounds (s). */
const SPEED = 2.4;
const MIN_DUR = 0.22;
const MAX_DUR = 0.65;
/** Most pieces one indexer lane holds nose to tail, and how long the shooter idles before staged pieces back down. */
const MAX_SLOTS = 8;
const DRAIN_AFTER = 1.2;
const SHOT_KEEPS_FEEDING = 0.5;

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
  private readonly lanes: Staged[][] = [];
  private laneRound = 0;
  private idleFor = 0;
  private sinceShot = Infinity;

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

  /** Held pieces lined up in the indexer lanes (drawn by the flow, not by the hopper visual). */
  get staged(): number {
    let n = 0;
    for (const lane of this.lanes) n += lane.length;
    return n;
  }

  /** Drop everything (robot reset, preload). */
  clear(held: number): void {
    for (const t of this.live) this.release(t.obj);
    this.live.length = 0;
    for (const lane of this.lanes) for (const b of lane) this.release(b.obj);
    this.lanes.length = 0;
    this.idleFor = 0;
    this.sinceShot = Infinity;
    this.captures.length = 0;
    this.lastHeld = held;
  }

  /**
   * Advance one rendered frame. `held` is the robot's current piece count; `fireInterval` the launcher's seconds per
   * shot (sets the indexer's conveyor speed so each lane restages between its shots). `replica` (multiplayer client): captures
   * aren't reported, so new pieces start at the intake mouth; otherwise pieces with no capture point (preloads,
   * scripted loads) appear in place. `feeding`: the shooter is spun up (shoot / pass held), so the indexer stages
   * pieces against it; once released for a moment, staged pieces back down into the stow.
   */
  update(dt: number, held: number, fireInterval: number, replica = false, feeding = false): void {
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
    } else if (delta < 0) {
      for (let k = 0; k < -delta; k++) this.shoot(-delta - 1 - k);
      this.sinceShot = 0;
    }
    // A robot that is firing is feeding, even if no shoot command reached this client.
    this.sinceShot += dt;
    feeding ||= this.sinceShot < SHOT_KEEPS_FEEDING;
    if (delta <= 0) this.captures.length = 0;
    this.index(dt, held, fireInterval, feeding);
    if (this.live.length && this.contacts) this.contacts.sync();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const tok = this.live[i];
      tok.t += dt;
      const u = Math.min(1, tok.t / tok.dur);
      const end = tok.pts[tok.pts.length - 1];
      const delivered = !this.contacts || tok.obj.position.distanceTo(end) < this.radius * 1.25;
      if (u >= 1 && (delivered || tok.t >= tok.dur + .8)) {
        this.arrive(tok);
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
          this.motorTarget.sub(tok.obj.position).multiplyScalar(1 / .025).clampLength(0,6);
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

  /** Lane of a piece that just left: `back` = how many later shots in this same frame came after it. */
  private shotLane(back: number): number {
    const n = this.laneCount;
    const known = this.paths.shotLane?.();
    const lane = known !== null && known !== undefined ? known - back : this.laneRound++;
    return ((lane % n) + n) % n;
  }

  private get laneCount(): number {
    return Math.max(1, Math.round(this.paths.lanes ?? 1));
  }

  /** A piece left the robot: the lead piece of its lane goes into the shooter, the rest step up one slot. */
  private shoot(back: number): void {
    if (!this.paths.feed || !this.lanes.length) return;
    let lane = this.lanes[this.shotLane(back)];
    if (!lane?.length) {
      // That lane was still loading: the piece came from whichever lane had one closest to the shooter.
      lane = this.lanes.reduce<Staged[] | undefined>((best, l) => l.length && (!best || l[0].s > best[0].s) ? l : best, undefined) ?? [];
    }
    const lead = lane.shift();
    if (!lead) return;
    this.release(lead.obj);
    for (const b of lane) b.slot--;
  }

  /**
   * Indexer: load lanes from the stow while feeding (each new piece enters once the one ahead has cleared the entry),
   * move every staged piece along its lane toward its slot at conveyor speed, and back them down into the stow when the
   * shooter has been idle a moment. Staged pieces never outnumber the held pieces that are not still being intaken.
   */
  private index(dt: number, held: number, fireInterval: number, feeding: boolean): void {
    if (!this.paths.feed) return;
    const n = this.laneCount;
    while (this.lanes.length < n) this.lanes.push([]);
    this.idleFor = feeding ? 0 : this.idleFor + dt;
    const draining = this.idleFor > DRAIN_AFTER;
    // Never draw more staged pieces than the robot holds (spills, outtakes, a reset count).
    let excess = this.staged - Math.max(0, held - this.inTransit);
    while (excess > 0) {
      const lane = this.lanes.reduce((a, b) => (b.length > a.length ? b : a));
      const last = lane.pop();
      if (!last) break;
      this.release(last.obj);
      excess--;
    }
    const pitch = this.radius * 2 * 1.06;
    // Conveyor surface speed: fast enough to restage a lane between its shots (every lane fires every n-th shot).
    const speed = Math.min(6, Math.max(1.2, (pitch / Math.max(0.02, fireInterval * n)) * 1.6));
    for (let li = 0; li < n; li++) {
      const lane = this.lanes[li];
      let pts: THREE.Vector3[] | null = null, cum: number[] | null = null;
      const path = () => {
        if (!pts) {
          pts = this.paths.feed!(li);
          cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
        }
        return { pts, cum: cum! };
      };
      if (feeding && !draining && this.staged < Math.max(0, held - this.inTransit)) {
        const { pts: p, cum: c } = path();
        const len = c[c.length - 1];
        const slots = Math.max(1, Math.min(MAX_SLOTS, Math.floor(len / pitch) + 1));
        const tail = lane[lane.length - 1];
        if (p.length >= 2 && lane.length < slots && (!tail || tail.s >= pitch)) {
          const obj = this.free.pop() ?? this.make();
          obj.userData.flowToken = true;
          if (!obj.parent) this.visual.add(obj);
          obj.visible = true;
          obj.rotation.set(0, 0, 0);
          lane.push({ obj, s: 0, slot: lane.length });
        }
      }
      if (!lane.length) continue;
      const { pts: p, cum: c } = path();
      if (p.length < 2) continue;
      const len = c[c.length - 1];
      const step = speed * dt;
      const order = draining ? lane.map((_, i) => lane.length - 1 - i) : lane.map((_, i) => i);
      for (const i of order) {
        const b = lane[i];
        // Slot 0 sits against the shooter wheels at the end of the path; each slot behind it is one piece back. Pieces
        // queue nose to tail: none passes the one ahead (loading) or the one behind it (backing down).
        const goal = draining ? -pitch : Math.max(0, len - b.slot * pitch);
        let next = b.s + Math.max(-step, Math.min(step, goal - b.s));
        if (!draining && i > 0) next = Math.min(next, lane[i - 1].s - pitch);
        if (draining && i < lane.length - 1) next = Math.max(next, lane[i + 1].s + pitch);
        b.s = draining ? next : Math.max(0, next);
        this.tmp.copy(b.obj.position);
        this.sample(p, c, Math.max(0, b.s), b.obj.position);
        if (this.roll) {
          // Roll in the actual travel direction rather than spin in place.
          b.obj.rotation.x += (b.obj.position.z - this.tmp.z) / this.radius;
          b.obj.rotation.z -= (b.obj.position.x - this.tmp.x) / this.radius;
        }
      }
      // Backed all the way into the stow: the piece is part of the hopper load again, rejoining the pile where the lane
      // starts rather than at some packed slot.
      while (draining && lane.length && lane[lane.length - 1].s <= 0) {
        const b = lane.pop()!;
        this.paths.arrive?.(b.obj.position);
        this.release(b.obj);
      }
    }
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
    return this.sample(tok.pts, tok.cum, s, out);
  }

  private sample(pts: THREE.Vector3[], cum: number[], s: number, out: THREE.Vector3): THREE.Vector3 {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    return out.lerpVectors(pts[i - 1], pts[i], Math.min(1, Math.max(0, (s - cum[i - 1]) / seg)));
  }
}
