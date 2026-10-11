import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/world';
import { clamp, smoothstep, wrapAngle } from '../units';
import type { HangingElement } from './hanging';

/**
 * How a climber holds a hanging element:
 * - `rollers`: powered wheels pull ONE vertical pipe into a latch (254's roller claw, 2910's cage intake). The robot
 *   can twist about that pipe against the wheels' grip, so a hit spins it around the pipe before it springs back.
 * - `hooks`: hooks or a cross-bar catch the bar between TWO pipes (fly-swatters, U frames, grappling hooks). Yaw is
 *   locked to the cage, the robot only rocks a little about the bar, so robot and cage swing as one body.
 */
export type GripStyle = 'rollers' | 'hooks';

/** Vectors are body-local in Rapier's world axes (x, y up, z); robot local x is its front. */
export interface ClimbGripSpec {
  style: GripStyle;
  /** Where the gripped pipe/bar sits in the robot once latched. */
  seat: THREE.Vector3;
  /** Candidate grab points on the element (pipe axes or bar centers) and the axis of each pipe/bar. */
  targets: { point: THREE.Vector3; axis: THREE.Vector3 }[];
  /** Field yaw the chassis squares up to while it drives the gripper onto the element. */
  yaw: number;
  /** Horizontal distance (m) from seat to grab point at which the gripper catches. */
  captureRadius: number;
  yawTolerance: number;
  /** Maximum vertical miss (m) the grabber can catch without reaching a different part of the pipe. */
  captureHeight: number;
  /** Seconds the rollers/hooks take to draw the pipe from where it was caught into the seat. */
  latchSeconds: number;
  /** Winch time to lift the robot. */
  liftSeconds: number;
  /** Height the robot rises (m) and how far the grip draws toward the robot's center while it does (m). */
  lift: number;
  pullIn: number;
  /** How far (rad) the climber rotates the cage over the chassis while lifting, so the chain ends up over the CG. */
  tilt: number;
  /** Freedom about the gripped pipe/bar: hinge limit (rad) and the joint motor that holds it centered. */
  compliance: { limit: number; stiffness: number; damping: number };
  /** Give up (missed the cage) if nothing was caught in this many seconds, or once it swings farther away than this (m). */
  approachSeconds: number;
  reach: number;
}

export type GripPhase = 'approach' | 'latch' | 'lift' | 'hang' | 'lower' | 'done' | 'missed';

export interface GripRecovery {
  phase: GripPhase; t: number; spec: SerializedSpec;
  joint: { a1: number[]; a2: number[]; f1: number[]; f2: number[]; from: number[] } | null;
  anchor: number[]; tilt: number; tiltFrom: number;
}
type SerializedSpec = Omit<ClimbGripSpec, 'seat' | 'targets'> & { seat: number[]; targets: { point: number[]; axis: number[] }[] };

const X = new THREE.Vector3(1, 0, 0);
/** Robot linear / angular damping while it is gripping [EST]. */
const HANG_DAMPING: [number, number] = [0.8, 3];
const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
const q4 = (a: number[]) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const qarr = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w];

/**
 * A robot's climber gripping a {@link HangingElement} physically: no teleport, no kinematic carry.
 *
 * 1. approach: the climb assist drives the chassis (through its real wheels) until the gripper reaches a pipe.
 * 2. latch: a revolute joint is made where the gripper caught the pipe; the rollers then reel the pipe into the seat.
 * 3. lift: the winch moves the robot-side joint anchor down and in, so the robot pulls itself up off the carpet.
 * 4. hang: robot + cage are one pendulum on the chain. A hit swings them both (and twists a roller grip).
 * 5. lower: the winch pays out; once the robot is back on its wheels the joint is removed.
 *
 * Host only: multiplayer clients see the replicated robot and cage poses.
 */
export class ClimbGrip {
  phase: GripPhase = 'approach';
  private t = 0;
  private joint: RAPIER.ImpulseJoint | null = null;
  private frames: { a2: THREE.Vector3; f1: THREE.Quaternion; f2: THREE.Quaternion } | null = null;
  /** Robot-side anchor now, and where the current winch move started. */
  private anchor = new THREE.Vector3();
  private from = new THREE.Vector3();
  /** Cage rotation over the chassis now (rad), and where the current winch move started. */
  private tiltNow = 0;
  private tiltFrom = 0;
  private readonly tmpQ = new THREE.Quaternion();
  private damping: [number, number] | null = null;

  constructor(private readonly physics: PhysicsWorld, readonly robot: RAPIER.RigidBody,
    readonly element: HangingElement, readonly spec: ClimbGripSpec) {}

  get latched(): boolean { return this.joint !== null; }
  /** Winch progress 0..1 (HUD). */
  get progress(): number { return this.phase === 'hang' ? 1 : this.phase === 'lift' ? clamp(this.t / this.spec.liftSeconds, 0, 1) : 0; }

  private seatWorld(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.spec.seat).applyQuaternion(rot(this.robot, this.tmpQ)).add(this.robot.translation() as THREE.Vector3); }
  private targetWorld(i: number, out: THREE.Vector3): THREE.Vector3 { return out.copy(this.spec.targets[i].point).applyQuaternion(rot(this.element.body, this.tmpQ)).add(this.element.body.translation() as THREE.Vector3); }

  /** The grab point nearest the gripper seat and its horizontal miss distance. */
  nearest(): { i: number; miss: THREE.Vector3; dist: number } {
    const seat = this.seatWorld(new THREE.Vector3()), p = new THREE.Vector3();
    let best = { i: 0, miss: new THREE.Vector3(), dist: Infinity };
    for (let i = 0; i < this.spec.targets.length; i++) {
      this.targetWorld(i, p).sub(seat);
      const dist = Math.hypot(p.x, p.z);
      if (dist < best.dist) best = { i, miss: p.clone(), dist };
    }
    return best;
  }

  private yawError(): number { return wrapAngle(this.spec.yaw - yawOf(this.robot)); }

  /** Field-frame drive command for the chassis: the climb assist while approaching, otherwise hold still. */
  driveCommand(): { vx: number; vy: number; omega: number } {
    if (this.phase !== 'approach') return { vx: 0, vy: 0, omega: 0 };
    const { miss } = this.nearest(), k = 3.5, vmax = 1.2;
    let vx = miss.x * k, vy = -miss.z * k; // world (x, -z) = field (x, y)
    const s = Math.hypot(vx, vy); if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
    return { vx, vy, omega: clamp(this.yawError() * 4, -3, 3) };
  }

  update(dt: number, enabled: boolean): GripPhase {
    if (!enabled || this.phase === 'done' || this.phase === 'missed') return this.phase; // a disabled winch holds (ratchet)
    this.t += dt;
    const s = this.spec;
    if (this.phase === 'approach') {
      const n = this.nearest();
      if (n.dist <= s.captureRadius && Math.abs(n.miss.y) <= s.captureHeight && Math.abs(this.yawError()) <= s.yawTolerance) this.capture(n.i);
      else if (this.t > s.approachSeconds || n.miss.length() > s.reach) this.phase = 'missed';
      return this.phase;
    }
    if (this.phase === 'hang') return this.phase;
    const goal = this.phase === 'lift' ? this.liftedAnchor() : s.seat;
    const dur = this.phase === 'latch' ? s.latchSeconds : this.phase === 'lift' ? s.liftSeconds : Math.max(0.5, s.liftSeconds * 0.8);
    const k = smoothstep(clamp(this.t / dur, 0, 1));
    this.anchor.lerpVectors(this.from, goal, k);
    this.tiltNow = this.tiltFrom + ((this.phase === 'lift' ? s.tilt : this.phase === 'lower' ? 0 : this.tiltFrom) - this.tiltFrom) * k;
    this.setAnchor();
    if (this.t < dur) return this.phase;
    this.t = 0; this.from.copy(this.anchor); this.tiltFrom = this.tiltNow;
    if (this.phase === 'latch') this.phase = 'lift';
    else if (this.phase === 'lift') this.phase = 'hang';
    else if (this.phase === 'lower') { this.destroy(); this.phase = 'done'; }
    return this.phase;
  }

  /** Pay the winch out and set the robot back down. */
  lower(): void {
    if (this.phase === 'done' || this.phase === 'missed' || this.phase === 'lower') return;
    if (!this.joint) { this.phase = 'missed'; return; }
    this.phase = 'lower'; this.t = 0; this.from.copy(this.anchor); this.tiltFrom = this.tiltNow;
  }

  private liftedAnchor(): THREE.Vector3 {
    const s = this.spec, inward = new THREE.Vector3(-s.seat.x, 0, -s.seat.z);
    if (inward.lengthSq() > 1e-9) inward.normalize().multiplyScalar(Math.min(s.pullIn, Math.hypot(s.seat.x, s.seat.z)));
    return s.seat.clone().add(inward).add(new THREE.Vector3(0, -s.lift, 0));
  }

  /** Make the joint exactly where the gripper caught the pipe (no snap), free only about the pipe/bar axis. */
  private capture(i: number): void {
    const target = this.spec.targets[i];
    const cageQ = rot(this.element.body, new THREE.Quaternion()), robotQ = rot(this.robot, new THREE.Quaternion());
    const world = this.targetWorld(i, new THREE.Vector3());
    const a1 = world.clone().sub(this.robot.translation() as THREE.Vector3).applyQuaternion(robotQ.clone().invert());
    const axisWorld = target.axis.clone().applyQuaternion(cageQ).normalize();
    const basis = new THREE.Quaternion().setFromUnitVectors(X, axisWorld);
    this.frames = { a2: target.point.clone(), f1: robotQ.clone().invert().multiply(basis), f2: cageQ.clone().invert().multiply(basis) };
    this.anchor.copy(a1); this.from.copy(a1);
    this.makeJoint();
    this.phase = 'latch'; this.t = 0;
  }

  private makeJoint(): void {
    const R = this.physics.R, f = this.frames!, c = this.spec.compliance;
    const data = R.JointData.revolute(this.anchor, f.a2, X);
    const j = this.physics.world.createImpulseJoint(data, this.robot, this.element.body, true) as RAPIER.RevoluteImpulseJoint;
    j.setLocalFrame1(this.anchor, f.f1);
    j.setLocalFrame2(f.a2, f.f2);
    j.setContactsEnabled(false); // the pipe sits inside the gripper
    j.setLimits(-c.limit, c.limit);
    j.configureMotorPosition(0, c.stiffness, c.damping);
    this.joint = j;
    // Chain links, eyebolts and the gripper scrub energy: a hanging robot settles in a few swings, not dozens.
    if (!this.damping) this.damping = [this.robot.linearDamping(), this.robot.angularDamping()];
    this.robot.setLinearDamping(HANG_DAMPING[0]); this.robot.setAngularDamping(HANG_DAMPING[1]);
  }

  /** Robot-side joint frame: the winch's anchor, turned by the climber's current tilt of the cage over the chassis. */
  private setAnchor(): void {
    if (!this.joint || !this.frames) return;
    const s = this.spec, inward = new THREE.Vector3(-s.seat.x, 0, -s.seat.z);
    const axis = new THREE.Vector3(0, 1, 0).cross(inward);
    const q = axis.lengthSq() > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(axis.normalize(), this.tiltNow) : new THREE.Quaternion();
    this.joint.setLocalFrame1(this.anchor, q.multiply(this.frames.f1));
  }

  destroy(): void {
    if (this.joint) { this.physics.world.removeImpulseJoint(this.joint, true); this.joint = null; }
    if (this.damping) { this.robot.setLinearDamping(this.damping[0]); this.robot.setAngularDamping(this.damping[1]); this.damping = null; }
  }

  recoveryState(): GripRecovery {
    const s = this.spec;
    return { phase: this.phase, t: this.t, anchor: arr(this.anchor), tilt: this.tiltNow, tiltFrom: this.tiltFrom,
      spec: { ...s, seat: arr(s.seat), targets: s.targets.map((t) => ({ point: arr(t.point), axis: arr(t.axis) })), compliance: { ...s.compliance } },
      joint: this.frames ? { a1: arr(this.anchor), a2: arr(this.frames.a2), f1: qarr(this.frames.f1), f2: qarr(this.frames.f2), from: arr(this.from) } : null };
  }

  static restore(physics: PhysicsWorld, robot: RAPIER.RigidBody, element: HangingElement, r: GripRecovery): ClimbGrip {
    const spec: ClimbGripSpec = { ...r.spec, seat: v3(r.spec.seat), targets: r.spec.targets.map((t) => ({ point: v3(t.point), axis: v3(t.axis) })) };
    const g = new ClimbGrip(physics, robot, element, spec);
    g.phase = r.phase; g.t = r.t; g.anchor.copy(v3(r.anchor)); g.tiltNow = r.tilt; g.tiltFrom = r.tiltFrom;
    if (r.joint && !['done', 'missed'].includes(r.phase)) {
      g.frames = { a2: v3(r.joint.a2), f1: q4(r.joint.f1), f2: q4(r.joint.f2) };
      g.from.copy(v3(r.joint.from));
      g.makeJoint(); g.setAnchor();
    }
    return g;
  }
}

function rot(b: RAPIER.RigidBody, out: THREE.Quaternion): THREE.Quaternion { const r = b.rotation(); return out.set(r.x, r.y, r.z, r.w); }
/** Field yaw of a body (rotation about world +Y). */
function yawOf(b: RAPIER.RigidBody): number {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(rot(b, new THREE.Quaternion()));
  return Math.atan2(-f.z, f.x);
}
