import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Alliance, FieldFrame, FieldPoint, FieldPose, yawFromQuat } from '../coords';
import { collisionGroups, Group, GROUPS, PhysicsWorld } from '../physics/world';
import { clamp, lerp, smoothstep, wrapAngle } from '../units';
import { Rng } from '../random';
import { DEFAULT_WHEEL_COF, RobotConfig, loadedRobotHeight, footprint, groundSideSign, launcherExitOffsets, stationSideSign } from './config';
import { FREE_SPEED_RATIO, limitWheelForce, ROLLING_RESISTANCE, STALL_RATIO, type WheelModel } from './drivetrain';
import { makeTextTexture } from '../render/text';
import { CLIMB_PHASES, type RobotNetState } from '../net/protocol';
import { pointIn, robotModelBuilder, seededRandom, type ModelPart, type PlaceAnim, type RobotAnimState, type RobotModel } from './models';
import { PieceFlow } from './pieceFlow';
import { mergeStatic, poseKey, poseSnapshot } from '../render/mergeStatic';

/** Field-frame drive request plus mechanism requests. Produced by input or a bot brain. */
export interface RobotCommand {
  /** Field-frame velocity (m/s) and yaw rate (rad/s). */
  vx: number;
  vy: number;
  omega: number;
  intake: boolean;
  shoot: boolean;
  /** Launch toward the season's feed/pass target instead of the goal. */
  pass: boolean;
  /** Requested climb level, or null. */
  climb: number | null;
  descend: boolean;
  /** Season scoring selection, e.g. REEFSCAPE elevator L1-L4. */
  scoringLevel?: number;
  /** Hold the shot blocker out (robots with config.shotBlocker). */
  block?: boolean;
}

export const IDLE_COMMAND: RobotCommand = { vx: 0, vy: 0, omega: 0, intake: false, shoot: false, pass: false, climb: null, descend: false };

/** Where to aim: a point, plus an optional rim to clear on the way in (e.g. a goal's front edge). */
export interface AimTarget {
  point: THREE.Vector3;
  clearRadius?: number;
  clearHeight?: number;
  /** Extra obstacles to clear: `distance` = horizontal distance back from the target, `height` = world y. */
  clearances?: { distance: number; height: number }[];
  /** Overhangs to pass UNDER: the piece must be at or below `height` (world y) `distance` back from the target. */
  ceilings?: { distance: number; height: number }[];
  /**
   * Accept pieces still rising at the target (a goal entered from below/level, e.g. under a hood). The default
   * requires a descending entry, as for open-top goals.
   */
  allowRising?: boolean;
  /** With allowRising: the lowest acceptable flight-path angle at the target (radians; negative = slightly descending). */
  minEntryAngle?: number;
}

/** A robot's capture zones frozen at one pose (see Robot.intakeZone). */
export interface IntakeZone {
  x: number;
  y: number;
  z: number;
  cos: number;
  sin: number;
  halfLength: number;
  ground: { side: number; reach: number; halfWidth: number; maxHeight: number } | null;
  station: { side: number; halfWidth: number; minHeight: number; maxHeight: number } | null;
}

/**
 * Same test as `Robot.intakeContains(p) && p.y <= groundMaxY` or `Robot.stationContains(p)`, from a frozen zone.
 * `groundMaxY` = world height above which the ground intake ignores a piece.
 */
export function intakeZoneContains(z: IntakeZone, p: { x: number; y: number; z: number }, pieceRadius: number, groundMaxY = Infinity): boolean {
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const f = dx * z.cos - dz * z.sin;
  const l = -dx * z.sin - dz * z.cos;
  const h = p.y - z.y;
  const g = z.ground;
  if (g && p.y <= groundMaxY && Math.abs(l) < g.halfWidth && h < g.maxHeight) {
    const gout = g.side * f - z.halfLength; // + = outside the bumper on the intake face
    if (gout > -0.06 && gout < g.reach + pieceRadius) return true;
  }
  const s = z.station;
  if (!s) return false;
  const out = s.side * f - z.halfLength;
  return out > -0.4 && out < 0.06 + pieceRadius && Math.abs(l) < s.halfWidth && h > s.minHeight && h < s.maxHeight;
}

export type ClimbPhase = 'none' | 'align' | 'rise' | 'hanging' | 'lower';

export const ALLIANCE_COLORS: Record<Alliance, number> = { red: 0xd32f2f, blue: 0x1e62d0 };

const G = 9.81;
/** A firing burst stays "locked on" this long after each shot (longer than the slowest launcher's shot interval). */
const BURST_HOLD_S = 0.6;

export class Robot {
  readonly body: RAPIER.RigidBody;
  readonly visual = new THREE.Group();
  /** Indices into the game piece pool. */
  readonly held: number[] = [];
  enabled = false;
  /** Shown a red card (or disabled by the referee): stays disabled for the rest of the match. */
  sidelined = false;
  /** Field yaw of the turret/launcher. */
  turretYaw = 0;
  fireCooldown = 0;
  /** 'player' robots read input; 'bot' robots are driven by a brain. */
  controller: 'player' | 'bot' = 'bot';
  lastCommand: RobotCommand = { ...IDLE_COMMAND };

  climbPhase: ClimbPhase = 'none';
  /** Level reached (valid while hanging). */
  climbLevel = 0;
  climbTargetLevel = 0;
  climbSlot: number | null = null;
  private climbT = 0;
  private climbDur = 0;
  private climbFrom = { x: 0, y: 0, z: 0, yaw: 0 };
  private climbTo = { x: 0, y: 0, z: 0, yaw: 0 };

  private readonly fp: { length: number; width: number };
  private expansionCollider?: RAPIER.Collider;
  private blockerCollider?: RAPIER.Collider;
  /** Shot blocker deployment: 0 = stowed, 1 = fully out (config.shotBlocker). */
  blockerDeploy = 0;
  private expansionHeight = -1;
  private hopperNet?: THREE.LineSegments;
  private netFuel: THREE.Mesh[] = [];
  /** Net bulge actually drawn (m above `height`) and its rate: a soft spring chasing the load-based envelope. */
  private netShown = 0;
  private netVel = 0;
  private lastSync = -1;
  /** Actual envelope used for obstacle routing and flexible-roof collisions. */
  get clearanceHeight(): number { return loadedRobotHeight(this.config, this.held.length); }
  /** Lowest overhead obstacle above the robot this tick (set by the sim from the season; Infinity = none). */
  overheadLimit = Infinity;
  /**
   * Pieces the intake may still take right now: none while the shot blocker is out, else `capacityLeft`, but never enough to grow an expanding hopper into the
   * obstacle overhead (a net robot under the TRENCH stops intaking at its trench-safe load).
   */
  get intakeRoom(): number {
    // The shot blocker folds over the intake side: the intake can't run while it's up or moving.
    if (this.blockerDeploy > 0) return 0;
    let room = this.capacityLeft;
    if (this.config.hopperExpansion && this.overheadLimit < Infinity) {
      let n = this.held.length;
      while (n < this.config.hopperCapacity && loadedRobotHeight(this.config, n + 1) <= this.overheadLimit) n++;
      room = Math.min(room, n - this.held.length);
    }
    if (this.config.intake.rate) room = Math.min(room, Math.floor(this.intakeBudget));
    return Math.max(0, room);
  }
  /** Pieces the intake can swallow right now at `config.intake.rate`: refills with time, spent as pieces are taken. */
  private intakeBudget = 4;
  private lastHeldCount = 0;
  /** Advance the intake throughput limiter once per physics step, before reading `intakeRoom`. */
  tickIntake(dt: number): void {
    const rate = this.config.intake.rate;
    const gained = this.held.length - this.lastHeldCount;
    this.lastHeldCount = this.held.length;
    if (!rate) return;
    if (gained > 0) this.intakeBudget -= gained;
    this.intakeBudget = Math.min(4, this.intakeBudget + rate * dt);
  }
  private hopperFill!: THREE.Mesh;
  private turret!: THREE.Group;
  private climberArm!: THREE.Mesh;
  private statusLight!: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  /** Generic parts a team model may replace (see models.ts). */
  private readonly parts = new Map<ModelPart, THREE.Object3D[]>();
  /** Real-team visual model (config.model), animated from `anim` every frame. */
  private model: RobotModel | null = null;
  private readonly anim: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: 0, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
  private lastFrame = -1;
  private lastHeld = 0;
  /** Animated game-piece flow through the robot (visual only; see enablePieceFlow). */
  private flow: PieceFlow | null = null;
  /** Carpet capture-zone marker meshes (see showIntakeGuide). */
  private readonly intakeGuide: THREE.Object3D[] = [];
  /** Replicated mechanism bits (1 intake, 2 pass, 4 shot blocker out) on multiplayer clients; null = read lastCommand. */
  private netAct: number | null = null;
  /** Placement-season end effector pose for team models (set by the season each frame). */
  placeAnim: PlaceAnim | null = null;

  constructor(
    readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    readonly frame: FieldFrame,
    readonly config: RobotConfig,
    readonly alliance: Alliance,
    readonly id: number,
    readonly station: number,
    start: FieldPose,
  ) {
    const R = physics.R;
    this.fp = footprint(config);
    const p = frame.toWorld(start.x, start.y, 0.002);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: 0, y: Math.sin(start.yaw / 2), z: 0, w: Math.cos(start.yaw / 2) })
        .setLinearDamping(0.2)
        .setAngularDamping(1.0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.turretYaw = start.yaw;
    this.wheelShape = new R.Ball(Robot.WHEEL_RADIUS);
    this.buildColliders();
    this.buildVisual(scene);
    this.buildHopperNet();
    this.syncVisual();
  }

  private buildColliders(): void {
    const R = this.physics.R;
    const c = this.config;
    const m = c.mass;
    const rw = 0.045;
    // Mass split sets the center of mass, which decides how easily the robot tips: about half the weight is
    // drivetrain + battery down at wheel level, ~15% bumpers, the rest spread through the superstructure
    // (CoM ≈ 6 in up on a 20 in robot, ≈ 8 in on a 30 in one). [EST]
    // Caster "wheels": frictionless spheres so the chassis rides over low obstacles (bumps, depot rails).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const d = R.ColliderDesc.ball(rw)
          .setTranslation(sx * (c.frameLength / 2 - rw - 0.02), rw, sz * (c.frameWidth / 2 - rw - 0.02))
          .setFriction(0)
          .setFrictionCombineRule(R.CoefficientCombineRule.Min)
          .setRestitution(0)
          .setMass(m * 0.125)
          .setCollisionGroups(GROUPS.robot);
        this.physics.world.createCollider(d, this.body);
      }
    }
    const r = 0.015;
    const bh = (c.bumperTop - c.bumperBottom) / 2;
    // Bumper fabric (cordura over pool noodles): multiplied, it grips another robot's bumper at ≈ 0.45 — enough to
    // drag or turn a robot you're shoving — while walls, carpet and pieces see about the same friction as before.
    // [EST: nylon cordura on cordura ≈ 0.4–0.5]
    const bumper = R.ColliderDesc.roundCuboid(this.fp.length / 2 - r, bh - r, this.fp.width / 2 - r, r)
      .setTranslation(0, (c.bumperTop + c.bumperBottom) / 2, 0)
      .setFriction(Robot.BUMPER_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
      .setRestitution(0.05)
      .setMass(m * 0.15)
      .setCollisionGroups(GROUPS.robot);
    this.physics.world.createCollider(bumper, this.body);
    const upper = Math.max(0.02, (c.height - c.bumperTop) / 2);
    const frameCol = R.ColliderDesc.cuboid(c.frameLength / 2 - 0.01, upper, c.frameWidth / 2 - 0.01)
      .setTranslation(0, c.bumperTop + upper, 0)
      .setFriction(0.3)
      .setMass(m * 0.35)
      .setCollisionGroups(GROUPS.robot);
    this.physics.world.createCollider(frameCol, this.body);
    if (c.hopperExpansion) {
      this.expansionCollider = this.physics.world.createCollider(R.ColliderDesc.cuboid(c.frameLength * 0.32, 0.001, c.frameWidth * 0.42)
        .setTranslation(-c.frameLength * 0.1, c.height, 0).setMass(0).setFriction(0.2).setCollisionGroups(GROUPS.robot), this.body);
      this.expansionCollider.setEnabled(false);
    }
    if (c.shotBlocker) {
      // A thin panel that stops game pieces and hits field structure (a raised blocker can't pass under the TRENCH
      // arm). Other robots don't touch it: it sits above bumper height, and robots would wedge on a 1 cm plate.
      const b = c.shotBlocker;
      // 4 cm thick so a fast FUEL can't clip through an edge between steps.
      this.blockerCollider = this.physics.world.createCollider(R.ColliderDesc.cuboid(Math.hypot(b.reach, b.rise) / 2, 0.02, b.width / 2)
        .setMass(0).setFriction(0.4).setRestitution(0.25).setCollisionGroups(collisionGroups(Group.ROBOT, Group.PIECE | Group.FIELD)), this.body);
      this.blockerCollider.setEnabled(false);
    }
  }

  /** Panel angle above the outward horizontal: π = folded inward on top, atan2(rise, reach) = fully out. */
  blockerAngle(deploy = this.blockerDeploy): number {
    const b = this.config.shotBlocker;
    if (!b) return Math.PI;
    return Math.PI - deploy * (Math.PI - Math.atan2(b.rise, b.reach));
  }

  /** Hinge of the shot blocker in robot-local coordinates (top edge of the frame on the intake side). */
  blockerHinge(): { x: number; y: number } {
    // At the robot's top, so the out-swung panel clears the 20 in guardrails by ~½ in.
    return { x: groundSideSign(this.config) * this.config.frameLength / 2, y: this.config.height };
  }

  /**
   * Swing the shot blocker toward the commanded state. It stays down while climbing, disabled or tipped. Under an
   * overhead obstacle lower than its raised top (the TRENCH arm) it can't start rising; once up, the panel collider
   * stops the robot at the arm instead.
   */
  private updateBlocker(cmd: RobotCommand, dt: number): void {
    const b = this.config.shotBlocker;
    if (!b) return;
    const roofed = this.overheadLimit < this.config.height + b.rise;
    const want = !!cmd.block && this.enabled && this.climbPhase === 'none' && !this.tippedOver;
    const rate = dt / b.seconds;
    this.blockerDeploy = clamp(want ? (roofed ? this.blockerDeploy : this.blockerDeploy + rate) : this.blockerDeploy - rate, 0, 1);
    this.poseBlocker();
  }

  private poseBlocker(): void {
    const col = this.blockerCollider;
    const b = this.config.shotBlocker;
    if (!col || !b) return;
    col.setEnabled(this.blockerDeploy > 0.02);
    const side = groundSideSign(this.config);
    const phi = this.blockerAngle();
    const half = Math.hypot(b.reach, b.rise) / 2;
    const h = this.blockerHinge();
    col.setTranslationWrtParent({ x: h.x + side * Math.cos(phi) * half, y: h.y + Math.sin(phi) * half, z: 0 });
    const ang = Math.atan2(Math.sin(phi), side * Math.cos(phi));
    col.setRotationWrtParent({ x: 0, y: 0, z: Math.sin(ang / 2), w: Math.cos(ang / 2) });
  }

  private updateHopperEnvelope(): void {
    const collider = this.expansionCollider;
    if (!collider) return;
    const extra = this.clearanceHeight - this.config.height;
    if (Math.abs(extra - this.expansionHeight) < 1e-6) return;
    this.expansionHeight = extra;
    collider.setEnabled(extra > 0.001);
    if (extra <= 0.001) return;
    collider.setShape(new this.physics.R.Cuboid(this.config.frameLength * 0.32, extra / 2, this.config.frameWidth * 0.42));
    collider.setTranslationWrtParent({ x: -this.config.frameLength * 0.1, y: this.config.height + extra / 2, z: 0 });
  }

  private buildHopperNet(): void {
    if (!this.config.hopperExpansion || this.config.hopperExpansion.mechanism === 'telescoping') return;
    // Real crossed strands, anchored at the hopper rim, with a bowed flexible center.
    const segments = 16, positions: number[] = [];
    for (let axis = 0; axis < 2; axis++) for (let line = 0; line <= segments; line++) for (let step = 0; step < segments; step++) {
      for (const endpoint of [step, step + 1]) {
        const a = line / segments * 2 - 1, b = endpoint / segments * 2 - 1;
        positions.push(axis ? b : a, 0, axis ? a : b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.hopperNet = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x25282d }));
    this.hopperNet.name = 'stretching-hopper-net';
    this.hopperNet.userData.grid = positions;
    this.visual.add(this.hopperNet);
    const fuelGeometry = new THREE.SphereGeometry(Robot.NET_FUEL_R, 10, 7);
    const fuelMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.85 });
    // FUEL heaped under the net at loose random spots (seeded by team, so each robot looks the same every match). Each
    // one shows once the net has lifted enough to uncover it, so they appear one by one as the bulge grows.
    const rand = seededRandom(this.config.teamNumber * 7919 + 13);
    const spots: { x: number; z: number }[] = [];
    for (let tries = 0; spots.length < 22 && tries < 600; tries++) {
      const x = (rand() * 2 - 1) * 0.82, z = (rand() * 2 - 1) * 0.85;
      if (spots.every((p) => Math.hypot((p.x - x) * this.config.frameLength * 0.38, (p.z - z) * this.config.frameWidth * 0.46) > Robot.NET_FUEL_R * 1.75)) spots.push({ x, z });
    }
    for (const { x, z } of spots) {
      const ball = new THREE.Mesh(fuelGeometry, fuelMaterial);
      ball.userData.netX = x; ball.userData.netZ = z;
      ball.userData.show = 0.02 + rand() * 0.035;
      const sq = 0.92 + rand() * 0.1;
      ball.scale.set(sq, sq * 0.93, sq);
      this.visual.add(ball); this.netFuel.push(ball);
    }
  }

  private static readonly NET_FUEL_R = 0.07;

  /**
   * Ease the drawn bulge toward the load-based envelope: an under-damped spring (ω ≈ 7 rad/s, ζ ≈ 0.7), so the net
   * creeps up as FUEL comes in, settles with a little give, and sags back as the hopper empties. Visual only:
   * collisions and routing use `clearanceHeight`.
   */
  private stepNetBulge(dt: number): void {
    const target = this.clearanceHeight - this.config.height;
    if (dt <= 0) {
      if (this.lastSync < 0) this.netShown = target;
      return;
    }
    const w = 7, zeta = 0.7;
    for (let left = dt; left > 1e-6; left -= 0.02) {
      const h = Math.min(0.02, left);
      this.netVel += (-(2 * zeta * w) * this.netVel - w * w * (this.netShown - target)) * h;
      this.netShown = Math.max(0, this.netShown + this.netVel * h);
    }
    if (Math.abs(this.netShown - target) < 1e-4 && Math.abs(this.netVel) < 1e-3) { this.netShown = target; this.netVel = 0; }
  }

  private updateHopperNet(dt: number): void {
    const net = this.hopperNet;
    if (!net) return;
    this.stepNetBulge(dt);
    const c = this.config, extra = this.netShown;
    const cx = -c.frameLength * 0.1, sx = c.frameLength * 0.38, sz = c.frameWidth * 0.46;
    // Uncovered FUEL rides up under the net; its tops are where the strands drape.
    const tops: { x: number; z: number; y: number }[] = [];
    for (const ball of this.netFuel) {
      const x = ball.userData.netX as number, z = ball.userData.netZ as number;
      const rise = extra * (1 - x * x) * (1 - z * z);
      ball.visible = rise > (ball.userData.show as number);
      ball.position.set(cx + x * sx, c.height + rise - Robot.NET_FUEL_R * 0.98, z * sz);
      if (ball.visible) tops.push({ x: ball.position.x, z: ball.position.z, y: c.height + rise });
    }
    const grid = net.userData.grid as number[], p = net.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = grid[i * 3], z = grid[i * 3 + 2];
      const bow = Math.max(0, (1 - x * x) * (1 - z * z));
      const px = cx + x * sx, pz = z * sz;
      // A slack net sags between balls and drapes over each one (a little cap of the ball's curve).
      let y = c.height + extra * bow * 0.86 - 0.018 * bow;
      for (const t of tops) {
        const d2 = (px - t.x) ** 2 + (pz - t.z) ** 2;
        if (d2 < 0.02) y = Math.max(y, t.y - d2 * 7);
      }
      p.setXYZ(i, px, y, pz);
    }
    p.needsUpdate = true; net.geometry.computeBoundingSphere();
  }

  private buildVisual(scene: THREE.Scene): void {
    const c = this.config;
    const color = ALLIANCE_COLORS[this.alliance];
    const bumperMat = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.5 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xa8adb5, metalness: 0.7, roughness: 0.35 });
    const bt = c.bumperThickness;
    const bh = c.bumperTop - c.bumperBottom;
    const by = (c.bumperTop + c.bumperBottom) / 2;
    const L = this.fp.length;
    const W = this.fp.width;

    // Bumpers (local +x = robot forward, local -z = robot left).
    // Rounded segments read as fabric-covered pool-noodle bumpers; the sides run the full length so the corners wrap.
    const mk = (sx: number, sz: number, px: number, pz: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(sx, bh, sz, 3, Math.min(bh, bt) * 0.42), bumperMat);
      m.position.set(px, by, pz);
      m.castShadow = true;
      this.visual.add(m);
      this.addPart('bumpers', m);
    };
    mk(bt, W, L / 2 - bt / 2, 0);
    mk(bt, W, -L / 2 + bt / 2, 0);
    mk(L, bt, 0, W / 2 - bt / 2);
    mk(L, bt, 0, -W / 2 + bt / 2);

    // Team numbers on both sides + back.
    const numTex = makeTextTexture(String(c.teamNumber), { color: '#ffffff', width: 256, height: 96 });
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    const numW = Math.min(L * 0.8, 0.5);
    for (const side of [1, -1]) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(numW, bh * 0.9), numMat);
      n.position.set(0, by, side * (W / 2 + 0.002));
      n.rotation.y = side > 0 ? 0 : Math.PI;
      this.visual.add(n);
      this.addPart('bumpers', n);
    }
    // Back number.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.8, 0.5), bh * 0.9), numMat);
    back.position.set(-L / 2 - 0.002, by, 0);
    back.rotation.y = -Math.PI / 2;
    this.visual.add(back);
    this.addPart('bumpers', back);

    // Belly pan + frame rails.
    const pan = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength, 0.02, c.frameWidth), dark);
    pan.position.y = c.bumperBottom + 0.01;
    this.visual.add(pan);
    this.addPart('chassis', pan);
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength, 0.05, 0.025), alu);
      rail.position.set(0, c.bumperTop - 0.02, sz * (c.frameWidth / 2 - 0.02));
      this.visual.add(rail);
      this.addPart('chassis', rail);
    }
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.x = Math.PI / 2;
        w.position.set(sx * (c.frameLength / 2 - 0.08), 0.05, sz * (c.frameWidth / 2 - 0.08));
        this.visual.add(w);
        this.addPart('chassis', w);
      }
    }

    // Hopper (translucent) with a fill indicator.
    const hopperH = Math.max(0.08, c.height - c.bumperTop - 0.08);
    const hopperMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0.18, depthWrite: false });
    const hopper = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength * 0.7, hopperH, c.frameWidth * 0.85), hopperMat);
    hopper.position.set(-c.frameLength * 0.1, c.bumperTop + hopperH / 2, 0);
    this.visual.add(hopper);
    this.addPart('hopper', hopper);
    this.hopperFill = new THREE.Mesh(
      new THREE.BoxGeometry(c.frameLength * 0.68, hopperH, c.frameWidth * 0.83),
      new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.7 }),
    );
    this.hopperFill.position.set(-c.frameLength * 0.1, c.bumperTop, 0);
    this.hopperFill.scale.y = 0.001;
    this.visual.add(this.hopperFill);
    // Hopper frame posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.025, hopperH, 0.025), alu);
        post.position.set(-c.frameLength * 0.1 + sx * c.frameLength * 0.35, c.bumperTop + hopperH / 2, sz * c.frameWidth * 0.425);
        this.visual.add(post);
        this.addPart('hopper', post);
      }
    }

    // Floor intake (orange) on the face opposite the scoring mechanism, funnel (station intake) on its own face.
    const groundVisible = c.intake.enabled && (c.intake.ground !== false || !!c.options?.algaeGround);
    if (groundVisible) this.buildGroundIntake(groundSideSign(c), dark);
    if (c.intake.enabled && c.intake.station) this.buildFunnel(stationSideSign(c), alu);
    this.buildScoringFace(dark);

    // Turret + barrel.
    this.turret = new THREE.Group();
    // Launcher sits on top of the robot (see launcherExit()).
    if ((c.launcher.exits ?? 1) > 1) {
      this.buildDumper(dark, alu);
    } else {
      this.turret.position.set(c.frameLength * 0.18, Math.max(c.launcher.height, c.height) - 0.02, 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.06, 20), dark);
      this.turret.add(base);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.14), alu);
      barrel.position.set(0.06, 0.07, 0);
      barrel.rotation.z = c.launcher.angle * 0.6;
      this.turret.add(barrel);
    }
    this.addPart('launcher', ...this.turret.children);
    if (c.launcher.enabled) this.visual.add(this.turret);

    // Climber arm (extends while climbing).
    this.climberArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), alu);
    this.climberArm.position.set(-c.frameLength * 0.3, c.bumperTop, 0);
    this.climberArm.scale.y = Math.max(0.05, c.height - c.bumperTop);
    this.climberArm.visible = c.climber.maxLevel > 0;
    this.visual.add(this.climberArm);
    this.addPart('climber', this.climberArm);
    this.buildModel({ dark, alu, bumper: bumperMat });

    // Status light (on = enabled)
    this.statusLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.03, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff8800, emissiveIntensity: 1 }),
    );
    this.statusLight.position.set(...(this.model?.lightAt ?? ([-L / 2 + 0.1, c.height + 0.02, 0] as const)));
    this.visual.add(this.statusLight);

    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = !m.userData.noShadow;
        m.receiveShadow = true;
      }
    });
    scene.add(this.visual);
  }

  /**
   * Orange intake assembly on chassis face `side` (+1 front, -1 back): a roller bar just outside the bumper, side
   * arms back to the frame, a stripe along the bumper, an INTAKE label and a glowing patch on the carpet showing
   * exactly where pieces get picked up. Orange is reserved for the intake so it reads at a glance from any camera.
   */
  private buildGroundIntake(side: 1 | -1, dark: THREE.Material): void {
    const c = this.config;
    const L = this.fp.length;
    const bt = c.bumperThickness;
    const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55, emissive: 0xff5a00, emissiveIntensity: 0.25 });
    const w = Math.min(c.intake.width, this.fp.width - 0.04);
    const edge = L / 2;
    const g = new THREE.Group();
    // Roller bar (two stacked drums, like a real under-bumper roller pair).
    for (const [dx, dy] of [[0.035, 0.085], [0.0, 0.14]] as const) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, w, 14), orange);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(side * (edge + dx), dy, 0);
      g.add(roller);
      this.addPart('intakeRollers', roller);
    }
    // Arms from the roller ends back to the frame.
    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(bt + 0.05, 0.035, 0.03), dark);
      arm.position.set(side * (edge - bt / 2 + 0.015), 0.115, sz * (w / 2 - 0.015));
      g.add(arm);
      this.addPart('intakeRollers', arm);
    }
    // Stripe along the whole bumper face on this side.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, this.fp.width * 0.98), orange);
    stripe.position.set(side * (edge + 0.002), c.bumperTop + 0.002, 0);
    g.add(stripe);
    // Capture zone on the carpet (the same strip `groundMouthContains` tests).
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(c.intake.reach, c.intake.width),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(side * (edge + c.intake.reach / 2), 0.006, 0);
    zone.userData.noShadow = true;
    zone.visible = false;
    g.add(zone);
    this.intakeGuide.push(zone);
    // Inward chevrons on the zone: pieces get pulled toward the robot.
    const chevShape = new THREE.Shape();
    chevShape.moveTo(0.06, 0);
    chevShape.lineTo(-0.04, 0.1);
    chevShape.lineTo(-0.04, 0.06);
    chevShape.lineTo(0.02, 0);
    chevShape.lineTo(-0.04, -0.06);
    chevShape.lineTo(-0.04, -0.1);
    const chevGeo = new THREE.ShapeGeometry(chevShape);
    const chevMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, side: THREE.DoubleSide });
    for (let k = 0; k < 2; k++) {
      const chev = new THREE.Mesh(chevGeo, chevMat);
      chev.rotation.set(-Math.PI / 2, 0, side > 0 ? Math.PI : 0); // lies flat, tip toward the robot
      chev.position.set(side * (edge + c.intake.reach * (0.72 - k * 0.38)), 0.012, 0);
      chev.userData.noShadow = true;
      chev.visible = false;
      g.add(chev);
      this.intakeGuide.push(chev);
    }
    this.visual.add(g);
  }

  /** Funnel / hopper mouth for pieces fed from a human-player station: two flared plates above the bumper. */
  private buildFunnel(side: 1 | -1, alu: THREE.Material): void {
    const c = this.config;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.5, transparent: true, opacity: 0.75 });
    const mouth = Math.max(c.intake.width, 0.5);
    const y = Math.max(c.bumperTop + 0.05, c.height * 0.7);
    for (const sz of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.012), mat);
      plate.position.set(side * (this.fp.length / 2 - 0.04), y, sz * (mouth / 2 + 0.02));
      plate.rotation.y = side * sz * 0.35;
      this.visual.add(plate);
      this.addPart('funnel', plate);
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, mouth + 0.06), alu);
    lip.position.set(side * (this.fp.length / 2 + 0.01), y - 0.09, 0);
    this.visual.add(lip);
    this.addPart('funnel', lip);
  }

  private addPart(part: ModelPart, ...objs: THREE.Object3D[]): void {
    const list = this.parts.get(part) ?? [];
    list.push(...objs);
    this.parts.set(part, list);
  }

  /** Where the team model holds a game piece (seasons parent their held-piece mesh here), if it has one. */
  get modelHeldAnchor(): THREE.Object3D | undefined {
    return this.model?.heldAnchor;
  }

  /** Where the team model's ground intake carries a piece (for handoff animations), if it has one. */
  get modelIntakeAnchor(): THREE.Object3D | undefined {
    return this.model?.intakeAnchor;
  }

  /** True when this robot's team model draws `part` itself (seasons hide their own version of it, e.g. the mast). */
  modelReplaces(part: ModelPart): boolean {
    return !!this.model?.replaces.includes(part);
  }

  /** Build the config's team model (if registered) and hide the generic parts it replaces. */
  private buildModel(mats: { dark: THREE.Material; alu: THREE.Material; bumper: THREE.Material }): void {
    const build = robotModelBuilder(this.config.model);
    if (!build) return;
    const c = this.config;
    this.anim.hood = c.launcher.angle;
    this.modelMats = mats;
    this.modelStart = [this.visual.children.length, this.turret.children.length];
    this.model = build({
      config: c, alliance: this.alliance, fp: this.fp, visual: this.visual, turret: this.turret, mats,
      groundSide: groundSideSign(c), stationSide: stationSideSign(c),
    });
    for (const part of this.model.replaces) for (const o of this.parts.get(part) ?? []) o.visible = false;
    if (this.model.replaces.includes('hopper')) this.hopperFill.visible = false;
  }

  /**
   * Render optimization (call once, after the robot is set up for the match): bake every part that never moves
   * into one mesh per material per rigid group, cutting a team model from ~200 draw calls to a few dozen. Which
   * parts move is measured, not guessed: a throwaway copy of the team model is run through every animation state
   * and any node whose transform or visibility changes stays separate. Falls back to merging only the generic
   * parts if the copy's structure doesn't match.
   */
  optimizeVisual(): { before: number; after: number } {
    const dynamic = new Set<THREE.Object3D>([this.turret, this.climberArm, this.hopperFill, this.statusLight, ...this.netFuel]);
    for (const o of this.intakeGuide) o.userData.keep = true;
    if (this.model && !this.probeModelDynamics(dynamic)) {
      // Unknown which model parts move: keep the whole model as it is.
      for (const o of this.visual.children.slice(this.modelStart[0])) dynamic.add(o);
      for (const o of this.turret.children.slice(this.modelStart[1])) dynamic.add(o);
    }
    // Small parts don't need to cast shadows (bolts, wires, decals): the shadow pass is a second draw of everything.
    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const sc = m.getWorldScale(this.flowScale);
      if (m.geometry.boundingSphere!.radius * Math.max(sc.x, sc.y, sc.z) < 0.035) m.castShadow = false;
    });
    return mergeStatic(this.visual, dynamic);
  }
  private modelMats: { dark: THREE.Material; alu: THREE.Material; bumper: THREE.Material } | null = null;
  private modelStart: [number, number] = [0, 0];
  private readonly flowScale = new THREE.Vector3();

  /** Build a second copy of the team model, animate it through every state, and mark the real nodes that move. */
  private probeModelDynamics(dynamic: Set<THREE.Object3D>): boolean {
    const build = robotModelBuilder(this.config.model);
    if (!build || !this.modelMats) return false;
    const c = this.config;
    const visual = new THREE.Group();
    const turret = new THREE.Group();
    let model: RobotModel;
    try {
      model = build({ config: c, alliance: this.alliance, fp: this.fp, visual, turret, mats: this.modelMats, groundSide: groundSideSign(c), stationSide: stationSideSign(c) });
    } catch {
      return false;
    }
    // Pair probe nodes with the real ones (same builder, same structure).
    const pairs = new Map<THREE.Object3D, THREE.Object3D>();
    const pair = (a: THREE.Object3D[], b: THREE.Object3D[]): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i].type !== b[i].type) return false;
        pairs.set(a[i], b[i]);
        if (!pair(a[i].children, b[i].children)) return false;
      }
      return true;
    };
    const realVisual = this.visual.children.slice(this.modelStart[0], this.modelStart[0] + visual.children.length);
    const realTurret = this.turret.children.slice(this.modelStart[1]).filter((o) => !o.userData.flowToken);
    if (!pair(visual.children, realVisual) || !pair(turret.children, realTurret)) return false;
    const base = poseSnapshot(visual);
    for (const [k, v] of poseSnapshot(turret)) base.set(k, v);
    const s: RobotAnimState = { dt: 0.1, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: c.launcher.angle, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
    const probes: Partial<RobotAnimState>[] = [
      { enabled: false }, { enabled: true }, { intaking: true }, { firing: 1, aiming: true, hood: 0.45 }, { aiming: true, hood: 1.35 },
      { passing: true }, { climb: 1 }, { climb: 0.25 }, { blocker: 1 }, { fill: 0.5 }, { fill: 1 },
      { vx: 2, omega: 1.5 }, { vz: 2, omega: -1.5 },
      { place: { height: 1.7, forward: 0.6, level: 4, side: 0 } }, { place: { height: 1.2, forward: 0.5, level: 3, side: 1 } },
      { place: { height: 1.2, forward: 0.5, level: 3, side: -1 } }, { place: { height: 1.0, forward: 0.5, level: 2, side: 2 } },
      { place: { height: 0.45, forward: 0.3, level: 1, handoff: 0.5 } }, { enabled: false },
    ];
    const moved = new Set<THREE.Object3D>();
    for (const p of probes) {
      for (let i = 0; i < 12; i++) {
        Object.assign(s, { enabled: true, intaking: false, firing: 0, passing: false, aiming: false, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0, fill: 0 }, p);
        s.time += s.dt;
        model.update(s);
      }
      for (const [o, key] of base) if (!moved.has(o) && poseKey(o) !== key) moved.add(o);
    }
    for (const o of moved) {
      const real = pairs.get(o);
      if (real) dynamic.add(real);
    }
    return true;
  }

  /** Advance the team model's animation (called from syncVisual, once per rendered frame). */
  private animateModel(frameDt?: number): void {
    const model = this.model;
    if (!model) return;
    const now = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
    const a = this.anim;
    a.dt = frameDt ?? (this.lastFrame < 0 ? 0 : clamp(now - this.lastFrame, 0, 0.1));
    this.lastFrame = now;
    a.time += a.dt;
    a.enabled = this.enabled;
    const act = this.netAct ?? this.actBits();
    a.intaking = (act & 1) !== 0 && this.blockerDeploy === 0;
    a.passing = (act & 2) !== 0;
    a.aiming = (act & 8) !== 0 && this.enabled;
    if (this.netAct !== null && this.config.shotBlocker) {
      // Replicas aren't driven: swing the blocker toward the host's state at the real deploy speed.
      this.blockerDeploy = clamp(this.blockerDeploy + ((act & 4) ? 1 : -1) * a.dt / this.config.shotBlocker.seconds, 0, 1);
      this.poseBlocker();
    }
    a.blocker = this.blockerDeploy;
    // A piece leaving the robot (shot, placed or fed) flashes the shooter / end effector.
    if (this.held.length < this.lastHeld) a.firing = 1;
    this.lastHeld = this.held.length;
    a.firing = Math.max(0, a.firing - a.dt / 0.35);
    a.hood = this.lastShotAngle || this.config.launcher.angle;
    a.fill = clamp((this.held.length - this.piecesInTransit) / Math.max(1, this.config.hopperCapacity), 0, 1);
    const target = this.climbPhase === 'align' ? 1 : this.climbPhase === 'none' ? 0 : 0.25;
    a.climb = a.dt > 0 ? target + (a.climb - target) * Math.exp(-6 * a.dt) : target;
    a.place = this.placeAnim;
    // Chassis-frame velocity for swerve module steering / wheel spin.
    const v = this.body.linvel();
    const r = this.body.rotation();
    this.tmp.set(v.x, 0, v.z).applyQuaternion(this.q.set(r.x, r.y, r.z, r.w).invert());
    a.vx = this.tmp.x;
    a.vz = this.tmp.z;
    a.omega = this.body.angvel().y;
    model.update(a);
  }

  /**
   * Dumper shooter: a flywheel housing as wide as the robot along the front edge, with one open chute per exit (the
   * dark gaps are where each stream of pieces leaves; see `launcherExitOffsets`).
   */
  private buildDumper(dark: THREE.Material, alu: THREE.Material): void {
    const c = this.config;
    const offsets = launcherExitOffsets(c);
    const exitY = Math.max(c.launcher.height, c.height) - 0.02;
    this.turret.position.set(c.frameLength * 0.4, exitY, 0);
    const w = c.frameWidth * 0.98;
    const housing = new THREE.MeshStandardMaterial({ color: 0x8c96a3, roughness: 0.5, transparent: true, opacity: 0.55 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, w), housing);
    body.position.set(-0.05, 0.0, 0);
    this.turret.add(body);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, w), alu);
    lip.position.set(0.06, -0.05, 0);
    this.turret.add(lip);
    // One glowing chute mouth per exit, where its stream of FUEL leaves.
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, emissive: 0xf2c200, emissiveIntensity: 0.45, roughness: 0.6 });
    for (const side of offsets) {
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.13), mouthMat);
      mouth.position.set(0.055, 0.0, -side);
      this.turret.add(mouth);
    }
    // Dividers between chutes.
    for (let i = 0; i < offsets.length - 1; i++) {
      const gap = (offsets[i] + offsets[i + 1]) / 2;
      const div = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.015), dark);
      div.position.set(-0.05, 0.0, -gap);
      this.turret.add(div);
    }
  }

  /** Dark shooter / scoring port plate on the front bumper, so front (score) vs. intake face is obvious. */
  private buildScoringFace(dark: THREE.Material): void {
    const c = this.config;
    if (!c.launcher.enabled && !c.placement?.enabled) return;
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, Math.min(this.fp.width * 0.45, 0.3)), dark);
    port.position.set(this.fp.length / 2 + 0.003, c.bumperTop + 0.045, 0);
    this.visual.add(port);
    this.addPart('chassis', port);
    // Forward arrow on the roof.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 3), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }));
    arrow.rotation.set(0, 0, -Math.PI / 2);
    arrow.scale.set(1, 1, 0.25);
    arrow.position.set(c.frameLength * 0.38, c.height + 0.005, 0);
    this.visual.add(arrow);
    this.addPart('chassis', arrow);
  }

  // ───────────────────────── state accessors ─────────────────────────

  get footprint(): { length: number; width: number } {
    return this.fp;
  }

  get pose(): FieldPose {
    const t = this.body.translation();
    const f = this.frame.toField(t);
    return { x: f.x, y: f.y, yaw: yawFromQuat(this.body.rotation()) };
  }

  /** Height of the robot origin (bottom of wheels) above carpet. */
  get elevation(): number {
    return this.body.translation().y;
  }

  get fieldVelocity(): { vx: number; vy: number } {
    const v = this.body.linvel();
    return { vx: v.x, vy: -v.z };
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  get isClimbing(): boolean {
    return this.climbPhase !== 'none';
  }

  get capacityLeft(): number {
    return this.config.hopperCapacity - this.held.length;
  }

  /** Bumper footprint corners in field frame. */
  corners(): FieldPoint[] {
    const { x, y, yaw } = this.pose;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hl = this.fp.length / 2;
    const hw = this.fp.width / 2;
    return [
      [hl, hw],
      [hl, -hw],
      [-hl, -hw],
      [-hl, hw],
    ].map(([a, b]) => ({ x: x + a * c - b * s, y: y + a * s + b * c }));
  }

  // ───────────────────────── control ─────────────────────────

  /** True while at least one wheel rests on the field (set every drive() call). */
  grounded = true;
  /** Share of full drive grip this step: wheels touching something, weighted by what they touch (0..1). */
  traction = 1;
  /** Wheels resting on the field this step (0-4). */
  wheelsDown = 4;
  /** Seconds the robot has been tipped over, or stuck at rest with no wheel touching anything (0 = fine). */
  tippedTime = 0;
  private static readonly GROUND_QUERY = collisionGroups(Group.ROBOT, Group.FIELD);
  private static readonly WHEEL_QUERY = collisionGroups(Group.ROBOT, Group.FIELD | Group.PIECE);
  /**
   * Grip of a wheel resting on a game piece instead of the field: the piece rolls or squashes under the
   * tread, so a robot high-centered on pieces still inches along and can work itself off. [EST]
   */
  static readonly PIECE_GRIP = 0.35;
  /** Bumper friction coefficient, combined by multiplying (bumper on bumper ≈ 0.45). */
  static readonly BUMPER_FRICTION = 0.67;
  /** Tipped over = chassis up axis more than 60° from vertical. */
  static readonly TIPPED_UP_Y = Math.cos((60 * Math.PI) / 180);
  /** Seconds a tipped-over robot lies there before it is set back on its wheels (sim rule, not the manual). */
  static readonly TIP_RECOVERY_S = 5;
  private static readonly WHEEL_RADIUS = 0.05;
  private readonly wheelShape: RAPIER.Shape;
  private readonly wheelHits: { x: number; y: number; z: number; grip: number }[] = [];
  private readonly q = new THREE.Quaternion();

  /** Vertical component of the chassis up axis: 1 = level, 0 = on its side, < 0 = upside down. */
  get uprightness(): number {
    const r = this.body.rotation();
    return 1 - 2 * (r.x * r.x + r.z * r.z);
  }

  /** Lying on its side or upside down (can't drive, shoot, intake or climb until righted). */
  get tippedOver(): boolean {
    return this.uprightness < Robot.TIPPED_UP_Y;
  }

  /** Seconds until a tipped-over (or wedged) robot is set back on its wheels (0 while fine). */
  get rightingIn(): number {
    return this.tippedTime > 0 ? Math.max(0, Robot.TIP_RECOVERY_S - this.tippedTime) : 0;
  }

  /** World position of a point in the chassis frame (x forward, y up, z = robot right; origin = floor, center). */
  localToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.body.rotation();
    const t = this.body.translation();
    out.set(x, y, z).applyQuaternion(this.q.set(r.x, r.y, r.z, r.w));
    out.x += t.x;
    out.y += t.y;
    out.z += t.z;
    return out;
  }

  /**
   * Which wheels touch something? Each wheel (a 5cm-radius sphere at its corner, following the chassis tilt)
   * is swept 3cm down. A wheel on the field has full grip, one on a game piece `PIECE_GRIP`, one in the air
   * none — so a robot rocked up onto two wheels, beached on FUEL or airborne off a bump has the traction it
   * would really have.
   */
  private updateWheels(): void {
    const c = this.config;
    const hx = c.frameLength / 2 - 0.06;
    const hz = c.frameWidth / 2 - 0.06;
    const rw = Robot.WHEEL_RADIUS;
    const r = this.body.rotation();
    this.wheelHits.length = 0;
    let grip = 0;
    let down = 0;
    for (const [a, b] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]]) {
      const w = this.localToWorld(a, rw, b, this.tmp);
      const hit = this.physics.world.castShape(w, r, { x: 0, y: -1, z: 0 }, this.wheelShape, 0, 0.03, true, undefined, Robot.WHEEL_QUERY, undefined, this.body);
      if (!hit) continue;
      const onField = ((hit.collider.collisionGroups() >>> 16) & Group.PIECE) === 0;
      const g = onField ? 1 : Robot.PIECE_GRIP;
      const p = hit.witness1;
      this.wheelHits.push({ x: p.x, y: p.y, z: p.z, grip: g });
      grip += g;
      if (onField) down++;
    }
    this.wheelsDown = down;
    this.grounded = down > 0;
    this.traction = grip / 4;
  }

  /** Drive wheels sliding on the carpet this step (0-4): pushed past their grip, or spun up harder than it holds. */
  wheelsSlipping = 0;
  private readonly wheel: WheelModel = { motorLimit: 0, stall: 0, freeSpeed: 1, traction: 0 };
  private readonly tankAxis = { x: 1, z: 0 };
  private readonly force = { x: 0, z: 0 };
  private readonly vel = { x: 0, y: 0, z: 0 };
  /** Velocity right after last step's drive impulses (null = not driving): the gap to now is what else pushed us. */
  private driven: { x: number; z: number; w: number } | null = null;

  /** Forget last step's drive (call after teleporting the body or setting its velocity, so it isn't read as a shove). */
  resetDriveState(): void {
    this.driven = null;
  }

  /**
   * Drive toward the commanded field velocity and yaw rate with what the wheels can really push (see
   * drivetrain.ts): each touching wheel asks for its share of the force that would reach the target this step —
   * translation split by grip, rotation as tangential force about the center of mass — and is clamped to its motor
   * curve and tread friction. Another robot leaning on this one is then resisted only that hard, so defense,
   * pushing matches and spins come out of mass, tread grip, motor limits and where the hit lands.
   */
  drive(cmd: RobotCommand, dt: number): void {
    this.updateHopperEnvelope();
    this.updateBlocker(cmd, dt);
    if (this.climbPhase !== 'none') {
      this.driven = null;
      return;
    }
    this.updateWheels();
    this.wheelsSlipping = 0;
    const prev = this.driven;
    this.driven = null;
    if (this.traction <= 0) return;
    const c = this.config;
    let tvx = cmd.vx;
    let tvy = cmd.vy;
    const sp = Math.hypot(tvx, tvy);
    if (sp > c.maxSpeed) {
      tvx *= c.maxSpeed / sp;
      tvy *= c.maxSpeed / sp;
    }
    const yaw = this.pose.yaw;
    const tank = c.drive === 'tank';
    if (tank) {
      const along = tvx * Math.cos(yaw) + tvy * Math.sin(yaw);
      tvx = along * Math.cos(yaw);
      tvy = along * Math.sin(yaw);
    }
    const targetW = this.enabled ? clamp(cmd.omega, -c.maxOmega, c.maxOmega) : 0;
    if (!this.enabled) tvx = tvy = 0;
    const m = this.body.mass();
    const v = this.body.linvel();
    const w = this.body.angvel();
    const com = this.body.worldCom();
    const inertia = this.body.effectiveAngularInertia().m22;
    // Force that would reach the target this step (world: x = field vx, z = -field vy), and the yaw torque. An
    // enabled robot also leans against what pushed it last step (another robot, a wall, a slope) — the integral
    // action of a real drive velocity loop — so it holds its spot whenever its wheels have the force to.
    let fx = (m * (tvx - v.x)) / dt;
    let fz = (m * (-tvy - v.z)) / dt;
    let torque = (inertia * (targetW - w.y)) / dt;
    if (prev && this.enabled) {
      fx -= (m * (v.x - prev.x)) / dt;
      fz -= (m * (v.z - prev.z)) / dt;
      torque -= (inertia * (w.y - prev.w)) / dt;
    }

    let total = 0;
    let lever = 0;
    for (const h of this.wheelHits) {
      total += h.grip;
      lever += h.grip * ((h.x - com.x) ** 2 + (h.z - com.z) ** 2);
    }
    const wm = this.wheel;
    wm.motorLimit = (m * c.maxAccel) / 4;
    wm.stall = wm.motorLimit * STALL_RATIO;
    wm.freeSpeed = c.maxSpeed * FREE_SPEED_RATIO;
    wm.disabled = !this.enabled;
    wm.axis = tank ? this.tankAxis : undefined;
    this.tankAxis.x = Math.cos(yaw);
    this.tankAxis.z = -Math.sin(yaw);
    const mu = c.wheelCOF ?? DEFAULT_WHEEL_COF;
    for (const h of this.wheelHits) {
      // The weight rides on the wheels that touch something (a robot rocked up on two wheels presses them down
      // twice as hard); one resting on a game piece grips less.
      const load = (m * G) / this.wheelHits.length;
      wm.traction = mu * load * h.grip;
      const rx = h.x - com.x;
      const rz = h.z - com.z;
      const kt = lever > 1e-9 ? (torque * h.grip) / lever : 0;
      const p = { x: h.x, y: h.y, z: h.z };
      const pv = this.body.velocityAtPoint(p, this.vel);
      if (limitWheelForce(wm, (fx * h.grip) / total + kt * rz, (fz * h.grip) / total - kt * rx, pv.x, pv.z, this.force)) this.wheelsSlipping++;
      // Rolling resistance drags against the wheel's ground motion (never reversing it).
      const ps = Math.hypot(pv.x, pv.z);
      const roll = ps > 1e-4 && h.grip === 1 ? Math.min(ROLLING_RESISTANCE * load, (m * ps) / (this.wheelHits.length * dt)) / ps : 0;
      // Wheel force acts where the tread meets the ground (below the center of mass): hard acceleration or
      // shoving pitches the chassis, and only wheels that touch something can push.
      this.body.applyImpulseAtPoint({ x: (this.force.x - pv.x * roll) * dt, y: 0, z: (this.force.z - pv.z * roll) * dt }, p, true);
    }
    const nv = this.body.linvel();
    this.driven = { x: nv.x, z: nv.z, w: this.body.angvel().y };
  }

  /**
   * Count time lying tipped over — or wedged at rest with every wheel in the air (a raised elevator caught under a
   * bar, high-centered on game pieces) — and after TIP_RECOVERY_S set the robot back on its wheels where it is. A
   * robot rocking on pieces touches down now and then, which restarts the count.
   */
  private updateTipped(dt: number): void {
    const wedged = this.traction === 0 && this.speed < 0.1;
    if (this.climbPhase !== 'none' || !this.body.isDynamic() || !(this.tippedOver || wedged)) {
      this.tippedTime = 0;
      return;
    }
    this.tippedTime += dt;
    if (this.tippedTime >= Robot.TIP_RECOVERY_S) this.setUpright();
  }

  /**
   * Slide game pieces lying under the footprint out past the nearest bumper, so a robot set down where it was
   * high-centered lands on the carpet instead of back on the same pieces.
   */
  private clearPiecesUnder(x: number, floor: number, z: number, yaw: number): void {
    const R = this.physics.R;
    const hl = this.fp.length / 2;
    const hw = this.fp.width / 2;
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const box = new R.Cuboid(hl, 0.2, hw);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const bodies = new Set<RAPIER.RigidBody>();
    this.physics.world.intersectionsWithShape({ x, y: floor + 0.2, z }, rot, box, (col) => {
      const b = col.parent();
      if (b?.isDynamic()) bodies.add(b);
      return true;
    }, undefined, collisionGroups(Group.ROBOT, Group.PIECE), undefined, this.body);
    const margin = 0.2; // clears the largest pieces (a CORAL lying across) [EST]
    for (const b of bodies) {
      const p = b.translation();
      const dx = p.x - x;
      const dz = p.z - z;
      let f = dx * fx + dz * fz;
      let l = -dx * fz + dz * fx;
      if (hl - Math.abs(f) < hw - Math.abs(l)) f = (Math.sign(f) || 1) * (hl + margin);
      else l = (Math.sign(l) || 1) * (hw + margin);
      b.setTranslation({ x: x + f * fx - l * fz, y: p.y, z: z + f * fz + l * fx }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Field surface height under a world x/z (ray from above, field colliders only). */
  private floorAt(x: number, z: number): number {
    const R = this.physics.R;
    const top = 3;
    const hit = this.physics.world.castRay(new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), top + 1, true, undefined, Robot.GROUND_QUERY, undefined, this.body);
    return hit ? top - hit.timeOfImpact : 0;
  }

  /** Would the upright chassis at this spot overlap a wall, field element or another robot? */
  private uprightBlocked(x: number, floor: number, z: number, yaw: number): boolean {
    const R = this.physics.R;
    const c = this.config;
    const y0 = floor + Math.max(c.bumperBottom, 0.05) + 0.01;
    const hh = Math.max(0.02, (c.height - (y0 - floor)) / 2 - 0.01);
    const box = new R.Cuboid(this.fp.length / 2 - 0.01, hh, this.fp.width / 2 - 0.01);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    let blocked = false;
    this.physics.world.intersectionsWithShape({ x, y: y0 + hh, z }, rot, box, () => {
      blocked = true;
      return false;
    }, undefined, collisionGroups(Group.ROBOT, Group.FIELD | Group.ROBOT), undefined, this.body);
    return blocked;
  }

  /**
   * Where to stand a righted robot: its current spot if the upright chassis fits there, otherwise the nearest spot
   * on a widening grid that is inside the field, on the carpet (not on top of a structure) and clear of walls, field
   * elements and other robots. Without this a robot tipped against a field element is set back inside it and jams.
   */
  private findUprightSpot(x: number, z: number, yaw: number): { x: number; z: number; floor: number } {
    const here = this.floorAt(x, z);
    if (!this.uprightBlocked(x, here, z, yaw)) return { x, z, floor: here };
    const halfL = this.frame.length / 2;
    const halfW = this.frame.width / 2;
    const step = 0.1;
    const rMax = 3;
    for (let r = step; r <= rMax; r += step) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        if (Math.abs(cx) > halfL - 0.3 || Math.abs(cz) > halfW - 0.3) continue;
        const floor = this.floorAt(cx, cz);
        if (floor > 0.3) continue; // that's the top of a structure, not the carpet
        if (!this.uprightBlocked(cx, floor, cz, yaw)) return { x: cx, z: cz, floor };
      }
    }
    return { x, z, floor: here };
  }

  /** Put the robot back on its wheels at its current spot and heading, on top of whatever field surface is there. */
  setUpright(): void {
    const t = this.body.translation();
    const yaw = this.pose.yaw;
    const spot = this.findUprightSpot(t.x, t.z, yaw);
    const floor = spot.floor;
    this.clearPiecesUnder(spot.x, floor, spot.z, yaw);
    this.body.setTranslation({ x: spot.x, y: floor + 0.01, z: spot.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.resetDriveState();
    this.tippedTime = 0;
  }

  /** World point → chassis frame { f: forward, l: left, h: height above the robot origin } (follows tilt). */
  toLocal(p: { x: number; y: number; z: number }): { f: number; l: number; h: number } {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.tmp.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(this.q.set(r.x, r.y, r.z, r.w).invert());
    return { f: v.x, l: -v.z, h: v.y };
  }

  /** Is a world-space point inside this robot's GROUND intake capture zone? (false without a ground intake) */
  intakeContains(p: { x: number; y: number; z: number }, pieceRadius: number): boolean {
    const c = this.config;
    if (!c.intake.enabled || c.intake.ground === false || this.climbPhase !== 'none' || this.tippedOver) return false;
    return this.groundMouthContains(p, pieceRadius) && this.toLocal(p).h < c.intake.maxHeight;
  }

  /**
   * Plan-view test of the floor-intake mouth (the strip just outside the bumper on the intake face), without the
   * height check or the mechanism-enabled checks — for seasons with their own pickup rules.
   */
  groundMouthContains(p: { x: number; y: number; z: number }, pieceRadius: number): boolean {
    const c = this.config;
    const { f, l } = this.toLocal(p);
    const out = groundSideSign(c) * f - this.fp.length / 2;
    return out > -0.06 && out < c.intake.reach + pieceRadius && Math.abs(l) < c.intake.width / 2;
  }

  /**
   * Yaw offset (0 or π) from the direction of travel to the heading that points the floor intake along it: add it to
   * a "drive toward X" heading to arrive intake-first.
   */
  get intakeYawOffset(): number {
    return groundSideSign(this.config) > 0 ? 0 : Math.PI;
  }

  /**
   * Is a world-space point inside the robot's STATION intake (funnel / hopper mouth / shooter intake at the top of
   * the chosen side)? Only pieces in the air (above `minHeight`) are caught — a piece on the carpet needs a ground
   * intake.
   */
  stationContains(p: { x: number; y: number; z: number }, pieceRadius: number, minHeight = 0.25): boolean {
    const c = this.config;
    if (!c.intake.enabled || !c.intake.station || this.climbPhase !== 'none' || this.tippedOver) return false;
    const { f, l, h } = this.toLocal(p);
    const s = stationSideSign(c);
    const out = s * f - this.fp.length / 2; // + = outside the bumper on that side
    const halfW = Math.max(c.intake.width, 0.5) / 2 + 0.04;
    // The mouth is at the bumper face: a piece must come out of the station (not be caught through its wall).
    return out > -0.4 && out < 0.06 + pieceRadius && Math.abs(l) < halfW && h > Math.max(minHeight, c.height * 0.55) && h < c.height + 0.35;
  }

  /**
   * Both capture zones (ground + station) frozen at the robot's current pose (null = can't intake now). Read it
   * once per step and test many pieces with `intakeZoneContains` — no Rapier reads per piece.
   */
  intakeZone(): IntakeZone | null {
    const c = this.config;
    if (!c.intake.enabled || this.climbPhase !== 'none' || this.tippedOver) return null;
    const ground = c.intake.ground !== false;
    if (!ground && !c.intake.station) return null;
    const t = this.body.translation();
    const yaw = yawFromQuat(this.body.rotation());
    return {
      x: t.x, y: t.y, z: t.z, cos: Math.cos(yaw), sin: Math.sin(yaw), halfLength: this.fp.length / 2,
      ground: ground ? { side: groundSideSign(c), reach: c.intake.reach, halfWidth: c.intake.width / 2, maxHeight: c.intake.maxHeight } : null,
      station: c.intake.station
        ? { side: stationSideSign(c), halfWidth: Math.max(c.intake.width, 0.5) / 2 + 0.04, minHeight: Math.max(0.25, c.height * 0.55), maxHeight: c.height + 0.35 }
        : null,
    };
  }

  /** Heading error (rad) to the shot target, updated by `autoAlign()`. */
  alignError = 0;
  /** Seconds left in which a firing burst continues without re-checking alignment (see launch()). */
  private burstTime = 0;

  /**
   * Chassis auto-align: for a robot WITHOUT a turret that has `autoAlign`, while it shoots/passes the heading is
   * servoed onto the target (lead-compensated for its own motion); the driver keeps translation. Returns the
   * command to drive with. Robots with a turret, or without auto-align, are returned unchanged.
   */
  autoAlign(cmd: RobotCommand, target: AimTarget | null): RobotCommand {
    const c = this.config;
    this.alignError = 0;
    if (!target || c.launcher.turret || !c.autoAlign || !c.launcher.enabled || this.held.length === 0) return cmd;
    if (!cmd.shoot && !cmd.pass) return cmd;
    const t = this.body.translation();
    const v = this.body.linvel();
    const dist = Math.hypot(target.point.x - t.x, target.point.z - t.z);
    const tof = dist / Math.max(4, c.launcher.maxSpeed * 0.6);
    const desired = Math.atan2(-(target.point.z - v.z * tof - t.z), target.point.x - v.x * tof - t.x);
    const yaw = this.pose.yaw;
    this.alignError = wrapAngle(desired - yaw);
    // P-control plus a static-friction feedforward (kS), like a real heading controller: without it, small
    // corrections are absorbed by carpet friction and the heading stalls a few degrees off.
    const e = this.alignError;
    // Plus a line-of-sight-rate feedforward (how fast the bearing to the target swings as the robot translates), so
    // steady strafing doesn't leave the heading a few degrees behind.
    const dx = target.point.x - t.x;
    const dy = -(target.point.z - t.z);
    const los = (dx * v.z + dy * v.x) / Math.max(1, dx * dx + dy * dy);
    const omega = clamp(e * 7 + los + (Math.abs(e) > 0.01 ? Math.sign(e) * 0.8 : 0), -c.maxOmega, c.maxOmega);
    return { ...cmd, omega };
  }

  /** Point turret at a world target (visual + used for launches). */
  aimTurretAt(target: AimTarget | null, dt: number): void {
    const yaw = this.pose.yaw;
    let desired = yaw;
    if (target && this.config.launcher.turret && this.config.aimAssist === 'full') {
      const t = this.body.translation();
      desired = Math.atan2(-(target.point.z - t.z), target.point.x - t.x);
    }
    const err = wrapAngle(desired - this.turretYaw);
    const maxStep = 12 * dt;
    this.turretYaw = wrapAngle(this.turretYaw + clamp(err, -maxStep, maxStep));
    // While the driver holds shoot / pass, re-solve the shot from here a few times a second so the hood visibly
    // tracks the range before the piece leaves (the launch itself still solves exactly at release).
    const c = this.config;
    if (target && (this.lastCommand.shoot || this.lastCommand.pass) && c.launcher.enabled && c.aimAssist !== 'off' && this.climbPhase === 'none') {
      this.aimSolveIn -= dt;
      if (this.aimSolveIn <= 0) {
        this.aimSolveIn = 0.15;
        const ex = this.launcherExit(0);
        const sol = this.solveShot(this.localToWorld(ex.forward, ex.up, -ex.side, this.aimTmp), target);
        if (sol) this.lastShotAngle = sol.angle;
      }
    } else this.aimSolveIn = 0;
  }
  private aimSolveIn = 0;
  private readonly aimTmp = new THREE.Vector3();

  /**
   * Game-piece flight model the shot solver mirrors. Set from the season's GamePieceSpec when the robot
   * is created (`robot.projectile = { radius, airDamping }`); defaults are close to a typical ball.
   */
  get projectile(): { radius: number; airDamping: number; halfHeight?: number } {
    return this._projectile;
  }
  set projectile(p: { radius: number; airDamping: number; halfHeight?: number }) {
    this._projectile = p;
    this.projectileSet = true;
  }
  private _projectile: { radius: number; airDamping: number; halfHeight?: number } = { radius: 0.075, airDamping: 0.02 };
  private projectileSet = false;
  private static warnedProjectile = false;

  /**
   * Where pieces leave the launcher, relative to the robot origin (floor, frame center).
   * Always ABOVE the robot's own collision box (config.height) so a launched piece can never spawn
   * inside the robot that fired it. (Bug fixed 2026-09-29: a 30in robot with a 19in launcher spawned
   * every ball inside its own frame collider and physics shoved it out sideways → misses.)
   */
  launcherExit(side = 0): { forward: number; up: number; side: number } {
    const c = this.config;
    // A dumper (several exits) shoots from the front edge of the frame; a single launcher sits near the center.
    // Flat pieces (rings) only need their half-thickness of vertical clearance.
    return { forward: c.frameLength * ((c.launcher.exits ?? 1) > 1 ? 0.4 : 0.18), side, up: Math.max(c.launcher.height, c.height) + (this._projectile.halfHeight ?? this._projectile.radius) + 0.03 };
  }

  /**
   * Height of a projectile after travelling `dists` (ascending, horizontal meters), integrated the same
   * way as the physics step (gravity, Rapier-style linear damping, then position). Also returns the
   * vertical velocity there. null = never got that far (fell below the floor first).
   */
  simulateFlight(fromY: number, angle: number, speed: number, dists: number[]): ({ y: number; vy: number; vx: number } | null)[] {
    const dt = this.physics.dt;
    const k = 1 / (1 + dt * this._projectile.airDamping);
    let x = 0;
    let y = fromY;
    let vx = speed * Math.cos(angle);
    let vy = speed * Math.sin(angle);
    const out: ({ y: number; vy: number; vx: number } | null)[] = dists.map(() => null);
    let j = 0;
    for (let i = 0; i < 3000 && j < dists.length; i++) {
      const px = x;
      const py = y;
      vy -= G * dt;
      vx *= k;
      vy *= k;
      x += vx * dt;
      y += vy * dt;
      while (j < dists.length && x >= dists[j]) {
        const f = (dists[j] - px) / Math.max(1e-9, x - px);
        out[j++] = { y: py + (y - py) * f, vy, vx };
      }
      if (y < -0.5 || vx < 1e-3) break;
    }
    return out;
  }

  /**
   * Solve launch speed + hood angle so the piece passes through target.point, clears every obstacle
   * (`clearHeight` at `clearRadius` before the target, plus `clearances`) and is DESCENDING at the
   * target. Uses the same integration as the physics engine (incl. air damping), refined by a secant
   * search. `clear` is false when nothing clears everything — the result is then a best effort.
   */
  solveShot(from: THREE.Vector3, target: AimTarget): { speed: number; angle: number; clear: boolean } | null {
    const c = this.config.launcher;
    const d = Math.hypot(target.point.x - from.x, target.point.z - from.z);
    const h = target.point.y - from.y;
    const obstacles: { distance: number; height: number; ceiling?: boolean }[] = [...(target.clearances ?? [])];
    if (target.clearHeight !== undefined) obstacles.push({ distance: target.clearRadius ?? 0, height: target.clearHeight });
    for (const q of target.ceilings ?? []) obstacles.push({ ...q, ceiling: true });
    // Obstacles in flight order (farthest from the target first), as distances from the launcher.
    const ordered = obstacles.filter((q) => d - q.distance > 0).sort((a, b) => b.distance - a.distance);
    const dists = [...ordered.map((q) => d - q.distance), d];

    const errAt = (angle: number, v: number) => (this.simulateFlight(from.y, angle, v, [d])[0]?.y ?? -10) - target.point.y;
    /** Speed that puts the piece at the target height at distance d (secant search on the drag model). */
    const speedFor = (angle: number): number | null => {
      const denom = 2 * Math.cos(angle) ** 2 * (d * Math.tan(angle) - h);
      if (denom <= 0) return null;
      let v0 = Math.sqrt((G * d * d) / denom);
      let f0 = errAt(angle, v0);
      let v1 = v0 * 1.04;
      let f1 = errAt(angle, v1);
      for (let i = 0; i < 8 && Math.abs(f1) > 0.004; i++) {
        const slope = (f1 - f0) / (v1 - v0);
        if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) break;
        const v2 = clamp(v1 - f1 / slope, 0.5, c.maxSpeed * 1.5);
        v0 = v1;
        f0 = f1;
        v1 = v2;
        f1 = errAt(angle, v1);
      }
      return Math.abs(f1) < 0.03 ? v1 : null;
    };
    const clears = (angle: number, v: number): boolean => {
      const pts = this.simulateFlight(from.y, angle, v, dists);
      const atTarget = pts[pts.length - 1];
      if (!atTarget || (atTarget.vy > 0 && !target.allowRising)) return false; // must be coming DOWN into an open-top goal
      if (target.minEntryAngle !== undefined && Math.atan2(atTarget.vy, atTarget.vx) < target.minEntryAngle) return false;
      return ordered.every((q, i) => (q.ceiling ? (pts[i]?.y ?? Infinity) <= q.height : (pts[i]?.y ?? -Infinity) >= q.height));
    };

    const step = Math.PI / 180;
    let fallback: { speed: number; angle: number; clear: boolean } | null = null;
    for (let th = c.minAngle; th <= c.maxAngle + 1e-9; th += step) {
      const v = speedFor(th);
      if (v === null || v > c.maxSpeed || v < c.minSpeed * 0.5) continue;
      if (!clears(th, v)) {
        fallback = { speed: clamp(v, c.minSpeed, c.maxSpeed), angle: th, clear: false }; // steepest reachable so far
        continue;
      }
      // Lowest angle that clears, plus a margin for launch noise (if that still clears).
      const withMargin = Math.min(c.maxAngle, th + 4 * step);
      const v2 = speedFor(withMargin);
      if (v2 !== null && v2 <= c.maxSpeed && clears(withMargin, v2)) return { speed: clamp(v2, c.minSpeed, c.maxSpeed), angle: withMargin, clear: true };
      return { speed: clamp(v, c.minSpeed, c.maxSpeed), angle: th, clear: true };
    }
    return fallback;
  }

  /**
   * Compute a launch (world position + velocity) toward `target` or straight ahead.
   * Returns null if the launcher can't fire this tick.
   */
  launch(target: AimTarget | null, rng: Rng): { pos: THREE.Vector3; vel: THREE.Vector3 } | null {
    const c0 = this.config;
    const c = c0.launcher;
    if (!c.enabled || this.held.length === 0 || this.fireCooldown > 0 || this.climbPhase !== 'none' || this.tippedOver) return null;
    // Auto-align robots hold fire until the chassis first points at the target (launcher.alignTolerance, default
    // ~3°). Once a burst is under way they keep firing whatever the heading error: standing still or creeping, the
    // servo keeps every ball on target, but a hard shove or a sudden sprint leaves the chassis behind and the balls
    // fly where the launcher actually points, so they miss.
    if (target && !c.turret && this.config.autoAlign && this.burstTime <= 0 && Math.abs(this.alignError) > (c.alignTolerance ?? 0.05)) return null;
    this.burstTime = BURST_HOLD_S;
    if (!this.projectileSet && !Robot.warnedProjectile && typeof console !== 'undefined') {
      Robot.warnedProjectile = true;
      console.warn('[robot] robot.projectile was never set from the season game piece — shot solver is using defaults.');
    }
    this.fireCooldown = 1 / c.rate;
    const rv = this.body.linvel();
    const heading = this.pose.yaw;
    // A multi-exit dumper alternates between its exits, so shots leave as several parallel streams.
    const offsets = launcherExitOffsets(c0);
    const ex = this.launcherExit(offsets[this.exitIndex++ % offsets.length]);
    // The launcher is bolted to the chassis: a tilted robot launches from a tilted spot, in a tilted direction
    // (the aim below assumes a level robot, so a rocking or tipping robot misses — as it would for real).
    const pos = this.localToWorld(ex.forward, ex.up, -ex.side, new THREE.Vector3());

    let speed = c.manualSpeed;
    let theta = c.angle;
    let aimYaw = c.turret ? this.turretYaw : heading;
    this.lastShotClear = true;
    if (target && this.config.aimAssist !== 'off') {
      // Iterate to lead the target for robot motion (shoot-on-the-move).
      const lead: AimTarget = { ...target, point: target.point.clone() };
      for (let k = 0; k < 3; k++) {
        const sol = this.solveShot(pos, lead);
        if (!sol) {
          this.lastShotClear = false;
          break;
        }
        speed = sol.speed;
        theta = sol.angle;
        this.lastShotClear = sol.clear;
        const d = Math.hypot(lead.point.x - pos.x, lead.point.z - pos.z);
        const tof = d / Math.max(0.1, speed * Math.cos(theta));
        lead.point.set(target.point.x - rv.x * tof, target.point.y, target.point.z - rv.z * tof);
      }
      if (this.config.aimAssist === 'full' && c.turret) {
        aimYaw = Math.atan2(-(lead.point.z - pos.z), lead.point.x - pos.x);
        this.turretYaw = aimYaw;
      }
    }
    this.lastShotAngle = theta;
    this.anim.firing = 1;
    const yawN = aimYaw + rng.gauss(0, c.spread);
    const pitchN = theta + rng.gauss(0, c.spread);
    const sN = speed * (1 + rng.gauss(0, c.speedError));
    const horiz = sN * Math.cos(pitchN);
    const vel = new THREE.Vector3(horiz * Math.cos(yawN), sN * Math.sin(pitchN), -horiz * Math.sin(yawN));
    const r = this.body.rotation();
    const tilt = this.q.set(r.x, r.y, r.z, r.w).multiply(new THREE.Quaternion(0, -Math.sin(heading / 2), 0, Math.cos(heading / 2)));
    vel.applyQuaternion(tilt);
    vel.x += rv.x;
    vel.z += rv.z;
    return { pos, vel };
  }

  /** Next exit a multi-exit dumper fires from. */
  private exitIndex = 0;

  /** Hood angle of the most recent shot (for visuals/HUD). */
  lastShotAngle = 0;
  /** False when the last aimed shot had no trajectory that clears the goal rim (too close/far) — for HUD hints. */
  lastShotClear = true;

  /** Pieces this robot launched in the last ~0.6 s (piece index → seconds left): it can't re-intake its own shot. */
  private readonly launchedRecently = new Map<number, number>();
  noteLaunch(i: number): void {
    this.launchedRecently.set(i, 0.6);
  }
  justLaunched(i: number): boolean {
    return this.launchedRecently.has(i);
  }

  tick(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.burstTime = Math.max(0, this.burstTime - dt);
    for (const [i, t] of this.launchedRecently) {
      if (t <= dt) this.launchedRecently.delete(i);
      else this.launchedRecently.set(i, t - dt);
    }
    this.updateClimb(dt);
    this.updateTipped(dt);
  }

  // ───────────────────────── climbing (simplified, kinematic) ─────────────────────────

  /** Move to `target` pose then rise to `liftZ` (robot origin height) — the season decides targets. */
  startClimb(target: FieldPose, liftZ: number, level: number, slot: number): void {
    if (this.climbPhase !== 'none') return;
    const R = this.physics.R;
    const p = this.pose;
    this.climbFrom = { x: p.x, y: p.y, z: this.elevation, yaw: p.yaw };
    this.climbTo = { x: target.x, y: target.y, z: this.elevation, yaw: target.yaw };
    this.climbTargetLevel = level;
    this.climbSlot = slot;
    this.climbLevel = 0;
    this.climbPhase = 'align';
    this.climbT = 0;
    this.climbDur = 0.6;
    this.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    this.pendingLift = liftZ;
  }

  private pendingLift = 0;

  startDescend(): void {
    if (this.climbPhase === 'none' || this.climbPhase === 'lower') return;
    const p = this.pose;
    this.climbFrom = { x: p.x, y: p.y, z: this.elevation, yaw: p.yaw };
    this.climbTo = { ...this.climbFrom, z: 0.002 };
    this.climbPhase = 'lower';
    this.climbT = 0;
    this.climbDur = Math.max(0.5, this.climbFrom.z * 1.2);
    this.climbLevel = 0;
  }

  private updateClimb(dt: number): void {
    if (this.climbPhase === 'none' || this.climbPhase === 'hanging') return;
    if (!this.enabled) return; // disabled robots freeze in place
    this.climbT += dt;
    const k = smoothstep(this.climbT / this.climbDur);
    const a = this.climbFrom;
    const b = this.climbTo;
    const x = lerp(a.x, b.x, k);
    const y = lerp(a.y, b.y, k);
    const z = lerp(a.z, b.z, k);
    const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
    const w = this.frame.toWorld(x, y, z, this.tmp);
    this.body.setNextKinematicTranslation({ x: w.x, y: w.y, z: w.z });
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    if (this.climbT < this.climbDur) return;
    if (this.climbPhase === 'align') {
      this.climbFrom = { ...b };
      this.climbTo = { ...b, z: this.pendingLift };
      this.climbPhase = 'rise';
      this.climbT = 0;
      this.climbDur = Math.max(0.3, this.config.climber.secondsToClimb ?? this.config.climber.secondsPerLevel * this.climbTargetLevel);
    } else if (this.climbPhase === 'rise') {
      this.climbPhase = 'hanging';
      this.climbLevel = this.climbTargetLevel;
    } else if (this.climbPhase === 'lower') {
      this.climbPhase = 'none';
      this.climbSlot = null;
      this.body.setBodyType(this.physics.R.RigidBodyType.Dynamic, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Progress 0..1 of the current climb (for HUD). */
  get climbProgress(): number {
    if (this.replicaClimbProgress !== null) return this.replicaClimbProgress;
    if (this.climbPhase === 'hanging') return 1;
    if (this.climbPhase === 'rise') return clamp(this.climbT / this.climbDur, 0, 1);
    return 0;
  }

  // ───────────────────────── multiplayer ─────────────────────────

  /** Set on multiplayer clients (replicas), where climb timing isn't simulated. */
  private replicaClimbProgress: number | null = null;

  netState(cmdSeq = 0): RobotNetState {
    const t = this.body.translation();
    const r = this.body.rotation();
    return {
      id: this.id,
      x: t.x,
      y: t.y,
      z: t.z,
      yaw: yawFromQuat(this.body.rotation()),
      rot: [r.x, r.y, r.z, r.w],
      tipped: this.tippedTime,
      turretYaw: this.turretYaw,
      held: this.held.length,
      enabled: this.enabled,
      climbPhase: Math.max(0, CLIMB_PHASES.indexOf(this.climbPhase)),
      climbLevel: this.climbLevel,
      climbSlot: this.climbSlot,
      climbProgress: this.climbProgress,
      cmdSeq,
      act: this.actBits(),
      hood: this.lastShotAngle,
    };
  }

  /** Mechanism bits replicated to clients: 1 intake, 2 pass, 4 shot blocker out, 8 aiming (shoot or pass held). */
  private actBits(): number {
    return (this.lastCommand.intake ? 1 : 0) | (this.lastCommand.pass ? 2 : 0) | (this.lastCommand.block && this.blockerDeploy > 0 ? 4 : 0)
      | (this.lastCommand.shoot || this.lastCommand.pass ? 8 : 0);
  }

  /** Replica update from a (possibly interpolated) snapshot. The body is only posed, never simulated. */
  applyNet(s: RobotNetState): void {
    this.body.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
    const q = s.rot ?? [0, Math.sin(s.yaw / 2), 0, Math.cos(s.yaw / 2)];
    this.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, false);
    this.applyNetDiscrete(s);
  }

  /** Everything but the chassis pose (used when the pose comes from client-side prediction). */
  applyNetDiscrete(s: RobotNetState): void {
    this.turretYaw = s.turretYaw;
    this.tippedTime = s.tipped ?? 0;
    if (this.held.length !== s.held) {
      this.held.length = 0;
      for (let i = 0; i < s.held; i++) this.held.push(-1);
    }
    this.enabled = s.enabled;
    this.climbPhase = CLIMB_PHASES[s.climbPhase] ?? 'none';
    this.climbLevel = s.climbLevel;
    this.climbSlot = s.climbSlot;
    this.replicaClimbProgress = s.climbProgress;
    if (s.act !== undefined) this.netAct = s.act;
    if (s.hood !== undefined) this.lastShotAngle = s.hood;
  }

  // ───────────────────────── misc ─────────────────────────

  resetTo(pose: FieldPose): void {
    const R = this.physics.R;
    this.body.setBodyType(R.RigidBodyType.Dynamic, true);
    const w = this.frame.toWorld(pose.x, pose.y, 0.002);
    this.body.setTranslation({ x: w.x, y: w.y, z: w.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(pose.yaw / 2), z: 0, w: Math.cos(pose.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.resetDriveState();
    this.climbPhase = 'none';
    this.climbLevel = 0;
    this.climbSlot = null;
    this.turretYaw = pose.yaw;
    this.fireCooldown = 0;
    this.held.length = 0;
    this.flow?.clear(0);
    this.blockerDeploy = 0;
    this.poseBlocker();
  }

  /**
   * Draw pieces travelling through the robot: from where each was captured, along the model's intake path into the
   * stow point, and (multi-piece robots) from the stow up into the shooter while firing. Visual only.
   * `make` builds one piece mesh (lying as it rests on the carpet); `roll` spins it (balls).
   */
  enablePieceFlow(make: () => THREE.Object3D, roll: boolean): void {
    this.flow?.dispose();
    const c = this.config;
    const model = this.model;
    const pieceR = this._projectile.halfHeight ?? this._projectile.radius;
    const L = this.fp.length;
    const hopperH = Math.max(0.08, c.height - c.bumperTop - 0.08);
    const hasGround = c.intake.enabled && c.intake.ground !== false;
    const side = hasGround ? groundSideSign(c) : stationSideSign(c);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const stow = (): THREE.Vector3 => {
      const s = model?.flow?.stow?.();
      if (s) return s;
      if (model?.heldAnchor) return pointIn(this.visual, model.heldAnchor, 0, 0, 0);
      // Hopper: pieces land on the pile (its height follows the fill), spread across the bin.
      const fill = clamp(this.held.length / Math.max(1, c.hopperCapacity), 0, 1);
      return v(-c.frameLength * 0.1 + (Math.random() - 0.5) * c.frameLength * 0.4, c.bumperTop + pieceR + hopperH * fill * 0.85,
        (Math.random() - 0.5) * c.frameWidth * 0.5);
    };
    this.flow = new PieceFlow(this.visual, make, {
      intake: () => {
        const end = stow();
        const custom = model?.flow?.intake?.();
        if (custom) return [...custom, end];
        const pts: THREE.Vector3[] = [];
        if (hasGround) {
          // Over (or under) the bumper on the intake rollers, then up into the robot.
          pts.push(model?.intakeAnchor ? pointIn(this.visual, model.intakeAnchor, 0, 0, 0) : v(side * (L / 2 - c.bumperThickness * 0.5), c.bumperTop + pieceR * 0.6, 0));
          pts.push(v(side * L * 0.22, Math.max(end.y, c.bumperTop + pieceR) + pieceR * 1.2, end.z * 0.5));
        } else {
          // Station funnel: drop in over the top.
          pts.push(v(side * (L / 2 - 0.05), Math.max(end.y + 0.1, c.height * 0.85), 0));
        }
        pts.push(end);
        return pts;
      },
      feed: c.launcher.enabled && c.hopperCapacity > 1 ? () => {
        const custom = model?.flow?.feed?.();
        if (custom) return custom;
        const ex = this.launcherExit(0);
        const top = ex.up - pieceR - 0.04;
        return [v(-c.frameLength * 0.05, c.bumperTop + pieceR + 0.02, 0), v(ex.forward - 0.1, (c.bumperTop + top) / 2, 0), v(ex.forward, top, -ex.side)];
      } : undefined,
    }, roll);
  }

  /** Show the intake capture zone on the carpet under this robot (the driver's own robot; off for everyone else). */
  showIntakeGuide(on: boolean): void {
    for (const o of this.intakeGuide) o.visible = on;
  }

  /** A piece was just captured at this world position (animates it into the robot when piece flow is on). */
  noteCapture(world: { x: number; y: number; z: number }): void {
    this.flow?.noteCapture(world);
  }

  /** Held pieces still animating into the robot (not yet drawn in the hopper / held position). */
  get piecesInTransit(): number {
    return this.flow?.inTransit ?? 0;
  }

  /** Hide the generic hopper fill (seasons that draw their own held game piece). */
  hideHopperFill(): void {
    this.hopperFill.visible = false;
  }

  /** Placement seasons draw their own carriage and held pieces. */
  usePlacementVisual(): void {
    this.turret.visible = false;
    this.hopperFill.visible = false;
  }

  /** Pose the visual from the body. `frameDt` overrides the measured frame time for model animation (tests). */
  syncVisual(frameDt?: number): void {
    const now = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
    const dt = frameDt ?? (this.lastSync < 0 ? 0 : clamp(now - this.lastSync, 0, 0.1));
    this.updateHopperEnvelope();
    this.updateHopperNet(dt);
    this.lastSync = now;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.visual.position.set(t.x, t.y, t.z);
    this.visual.quaternion.set(r.x, r.y, r.z, r.w);
    this.flow?.update(dt, this.held.length, 1 / Math.max(0.1, this.config.launcher.rate), this.netAct !== null);
    const cap = Math.max(1, this.config.hopperCapacity);
    const frac = clamp((this.held.length - this.piecesInTransit) / cap, 0, 1);
    const hopperH = Math.max(0.08, this.config.height - this.config.bumperTop - 0.08);
    this.hopperFill.scale.y = Math.max(0.001, frac);
    this.hopperFill.position.y = this.config.bumperTop + (hopperH * frac) / 2;
    this.turret.rotation.y = wrapAngle(this.turretYaw - yawFromQuat(r));
    const armBase = Math.max(0.05, this.config.height - this.config.bumperTop);
    const armLen = this.climbPhase === 'none' ? armBase : armBase + Math.min(1.2, t.y + 0.3);
    this.climberArm.scale.y = armLen;
    this.climberArm.position.y = this.config.bumperTop + armLen / 2;
    const lm = this.statusLight.material as THREE.MeshStandardMaterial;
    lm.emissiveIntensity = this.enabled ? 1.6 : 0.1;
    this.animateModel(frameDt);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.visual);
    this.physics.world.removeRigidBody(this.body);
  }
}
