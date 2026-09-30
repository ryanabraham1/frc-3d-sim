import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Alliance, FieldFrame, FieldPoint, FieldPose, yawFromQuat } from '../coords';
import { collisionGroups, Group, GROUPS, PhysicsWorld } from '../physics/world';
import { clamp, lerp, smoothstep, wrapAngle } from '../units';
import { Rng } from '../random';
import { RobotConfig, footprint } from './config';
import { makeTextTexture } from '../render/text';
import { CLIMB_PHASES, type RobotNetState } from '../net/protocol';

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

export type ClimbPhase = 'none' | 'align' | 'rise' | 'hanging' | 'lower';

export const ALLIANCE_COLORS: Record<Alliance, number> = { red: 0xd32f2f, blue: 0x1e62d0 };

const G = 9.81;

export class Robot {
  readonly body: RAPIER.RigidBody;
  readonly visual = new THREE.Group();
  /** Indices into the game piece pool. */
  readonly held: number[] = [];
  enabled = false;
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
  private hopperFill!: THREE.Mesh;
  private turret!: THREE.Group;
  private climberArm!: THREE.Mesh;
  private statusLight!: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();

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
        .enabledRotations(false, true, false)
        .setLinearDamping(0.2)
        .setAngularDamping(1.0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.turretYaw = start.yaw;
    this.buildColliders();
    this.buildVisual(scene);
    this.syncVisual();
  }

  private buildColliders(): void {
    const R = this.physics.R;
    const c = this.config;
    const m = c.mass;
    const rw = 0.045;
    // Caster "wheels": frictionless spheres so the chassis rides over low obstacles (bumps, depot rails).
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const d = R.ColliderDesc.ball(rw)
          .setTranslation(sx * (c.frameLength / 2 - rw - 0.02), rw, sz * (c.frameWidth / 2 - rw - 0.02))
          .setFriction(0)
          .setFrictionCombineRule(R.CoefficientCombineRule.Min)
          .setRestitution(0)
          .setMass(m * 0.05)
          .setCollisionGroups(GROUPS.robot);
        this.physics.world.createCollider(d, this.body);
      }
    }
    const r = 0.015;
    const bh = (c.bumperTop - c.bumperBottom) / 2;
    const bumper = R.ColliderDesc.roundCuboid(this.fp.length / 2 - r, bh - r, this.fp.width / 2 - r, r)
      .setTranslation(0, (c.bumperTop + c.bumperBottom) / 2, 0)
      .setFriction(0.25)
      .setRestitution(0.05)
      .setMass(m * 0.55)
      .setCollisionGroups(GROUPS.robot);
    this.physics.world.createCollider(bumper, this.body);
    const upper = Math.max(0.02, (c.height - c.bumperTop) / 2);
    const frameCol = R.ColliderDesc.cuboid(c.frameLength / 2 - 0.01, upper, c.frameWidth / 2 - 0.01)
      .setTranslation(0, c.bumperTop + upper, 0)
      .setFriction(0.3)
      .setMass(m * 0.25)
      .setCollisionGroups(GROUPS.robot);
    this.physics.world.createCollider(frameCol, this.body);
  }

  private buildVisual(scene: THREE.Scene): void {
    const c = this.config;
    const color = ALLIANCE_COLORS[this.alliance];
    const bumperMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.5 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xa8adb5, metalness: 0.7, roughness: 0.35 });
    const bt = c.bumperThickness;
    const bh = c.bumperTop - c.bumperBottom;
    const by = (c.bumperTop + c.bumperBottom) / 2;
    const L = this.fp.length;
    const W = this.fp.width;

    // Bumpers (local +x = robot forward, local -z = robot left).
    const mk = (sx: number, sz: number, px: number, pz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, bh, sz), bumperMat);
      m.position.set(px, by, pz);
      m.castShadow = true;
      this.visual.add(m);
    };
    mk(bt, W, L / 2 - bt / 2, 0);
    mk(bt, W, -L / 2 + bt / 2, 0);
    mk(L - 2 * bt, bt, 0, W / 2 - bt / 2);
    mk(L - 2 * bt, bt, 0, -W / 2 + bt / 2);

    // Team numbers on both sides + back.
    const numTex = makeTextTexture(String(c.teamNumber), { color: '#ffffff', width: 256, height: 96 });
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
    const numW = Math.min(L * 0.8, 0.5);
    for (const side of [1, -1]) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(numW, bh * 0.9), numMat);
      n.position.set(0, by, side * (W / 2 + 0.002));
      n.rotation.y = side > 0 ? 0 : Math.PI;
      this.visual.add(n);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.8, 0.5), bh * 0.9), numMat);
    back.position.set(-L / 2 - 0.002, by, 0);
    back.rotation.y = -Math.PI / 2;
    this.visual.add(back);

    // Belly pan + frame rails.
    const pan = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength, 0.02, c.frameWidth), dark);
    pan.position.y = c.bumperBottom + 0.01;
    this.visual.add(pan);
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength, 0.05, 0.025), alu);
      rail.position.set(0, c.bumperTop - 0.02, sz * (c.frameWidth / 2 - 0.02));
      this.visual.add(rail);
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
      }
    }

    // Hopper (translucent) with a fill indicator.
    const hopperH = Math.max(0.08, c.height - c.bumperTop - 0.08);
    const hopperMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, transparent: true, opacity: 0.18, depthWrite: false });
    const hopper = new THREE.Mesh(new THREE.BoxGeometry(c.frameLength * 0.7, hopperH, c.frameWidth * 0.85), hopperMat);
    hopper.position.set(-c.frameLength * 0.1, c.bumperTop + hopperH / 2, 0);
    this.visual.add(hopper);
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
      }
    }

    // Intake roller at the front.
    if (c.intake.enabled) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, c.intake.width, 12),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }),
      );
      roller.rotation.x = Math.PI / 2;
      roller.position.set(L / 2 + 0.03, 0.09, 0);
      this.visual.add(roller);
    }

    // Turret + barrel.
    this.turret = new THREE.Group();
    // Launcher sits on top of the robot (see launcherExit()).
    this.turret.position.set(c.frameLength * 0.18, Math.max(c.launcher.height, c.height) - 0.02, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.06, 20), dark);
    this.turret.add(base);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.14), alu);
    barrel.position.set(0.06, 0.07, 0);
    barrel.rotation.z = c.launcher.angle * 0.6;
    this.turret.add(barrel);
    if (c.launcher.enabled) this.visual.add(this.turret);

    // Climber arm (extends while climbing).
    this.climberArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), alu);
    this.climberArm.position.set(-c.frameLength * 0.3, c.bumperTop, 0);
    this.climberArm.scale.y = Math.max(0.05, c.height - c.bumperTop);
    this.climberArm.visible = c.climber.maxLevel > 0;
    this.visual.add(this.climberArm);

    // Status light (on = enabled)
    this.statusLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.03, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff8800, emissiveIntensity: 1 }),
    );
    this.statusLight.position.set(-L / 2 + 0.1, c.height + 0.02, 0);
    this.visual.add(this.statusLight);

    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    scene.add(this.visual);
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

  /** True while the chassis rests on the field (set every drive() call). */
  grounded = true;
  /** Fraction of full drive traction available this step (1 = on the carpet, 0 = airborne). */
  traction = 1;
  /** Seconds the chassis has been off the field while not moving vertically (resting on game pieces). */
  private beachedTime = 0;
  private static readonly GROUND_QUERY = collisionGroups(Group.ROBOT, Group.FIELD);
  /**
   * Share of the robot carried by its wheels while high-centered on game pieces. The chassis collider can't
   * tilt (rotations are locked for stability), so a robot lifted level onto a ball would otherwise rest its
   * whole weight on the pieces with every wheel in the air and no traction — stranded for good. A real robot
   * tips off the piece until some wheels touch the carpet again: those wheels carry part of the weight
   * (less friction on the pieces) and give part of the drive grip, so it can rock and drive itself off. [EST]
   */
  static readonly BEACHED_TRACTION = 0.5;
  /** How long the chassis must sit still (vertically) off the field before it counts as beached, not airborne. */
  private static readonly BEACHED_DELAY = 0.15;

  /**
   * Is the chassis resting on FIELD surfaces (carpet, bumps, tower base, rails…)? Rays go down from the
   * center and the four wheel positions. Game pieces and other robots don't count: a robot beached on a
   * FUEL ball or in the air has no wheels on the field (see `traction` for how much grip it still has).
   */
  private checkGrounded(): boolean {
    const R = this.physics.R;
    const t = this.body.translation();
    const yaw = yawFromQuat(this.body.rotation());
    const c = this.config;
    const up = 0.15;
    const reach = up + 0.03; // surface within 3cm below the wheel plane (or above it: high-centered)
    const hx = c.frameLength / 2 - 0.06;
    const hz = c.frameWidth / 2 - 0.06;
    const pts: [number, number][] = [[0, 0], [hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const [a, b] of pts) {
      const ray = new R.Ray({ x: t.x + a * cos + b * sin, y: t.y + up, z: t.z - a * sin + b * cos }, { x: 0, y: -1, z: 0 });
      const hit = this.physics.world.castRay(ray, reach, true, undefined, Robot.GROUND_QUERY, undefined, this.body);
      if (hit) return true;
    }
    return false;
  }

  /**
   * Update `grounded` and `traction`: full grip on the field; none while airborne (off a bump, falling);
   * partial grip once the chassis has come to rest off the field, i.e. high-centered on game pieces.
   */
  private updateTraction(dt: number): void {
    this.grounded = this.checkGrounded();
    if (this.grounded) {
      this.beachedTime = 0;
      this.traction = 1;
      return;
    }
    this.beachedTime = Math.abs(this.body.linvel().y) < 0.08 ? this.beachedTime + dt : 0;
    this.traction = this.beachedTime >= Robot.BEACHED_DELAY ? Robot.BEACHED_TRACTION : 0;
  }

  drive(cmd: RobotCommand, dt: number): void {
    if (this.climbPhase !== 'none') return;
    // No traction in the air; reduced traction when beached on game pieces.
    this.updateTraction(dt);
    if (this.traction <= 0) return;
    const m = this.body.mass();
    if (this.traction < 1) this.body.applyImpulse({ x: 0, y: this.traction * m * G * dt, z: 0 }, true); // wheels on the carpet
    const c = this.config;
    let tvx = cmd.vx;
    let tvy = cmd.vy;
    const sp = Math.hypot(tvx, tvy);
    if (sp > c.maxSpeed) {
      tvx *= c.maxSpeed / sp;
      tvy *= c.maxSpeed / sp;
    }
    const yaw = this.pose.yaw;
    if (c.drive === 'tank') {
      const along = tvx * Math.cos(yaw) + tvy * Math.sin(yaw);
      tvx = along * Math.cos(yaw);
      tvy = along * Math.sin(yaw);
    }
    const v = this.body.linvel();
    // world: x = field vx, z = -field vy
    let dvx = tvx - v.x;
    let dvz = -tvy - v.z;
    const mag = Math.hypot(dvx, dvz);
    const maxDv = c.maxAccel * this.traction * dt;
    if (mag > maxDv) {
      dvx *= maxDv / mag;
      dvz *= maxDv / mag;
    }
    this.body.applyImpulse({ x: dvx * m, y: 0, z: dvz * m }, true);

    const w = this.body.angvel();
    const targetW = clamp(cmd.omega, -c.maxOmega, c.maxOmega);
    const maxDw = c.maxOmega * 8 * this.traction * dt;
    const nw = w.y + clamp(targetW - w.y, -maxDw, maxDw);
    this.body.setAngvel({ x: 0, y: nw, z: 0 }, true);
  }

  /** Is a world-space point inside this robot's intake capture zone? */
  intakeContains(p: { x: number; y: number; z: number }, pieceRadius: number): boolean {
    const c = this.config;
    if (!c.intake.enabled || this.climbPhase !== 'none') return false;
    const t = this.body.translation();
    const yaw = yawFromQuat(this.body.rotation());
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const f = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const l = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const front = this.fp.length / 2;
    return f > front - 0.06 && f < front + c.intake.reach + pieceRadius && Math.abs(l) < c.intake.width / 2 && p.y - t.y < c.intake.maxHeight;
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
  }

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
  launcherExit(): { forward: number; up: number } {
    const c = this.config;
    // Flat pieces (rings) only need their half-thickness of vertical clearance.
    return { forward: c.frameLength * 0.18, up: Math.max(c.launcher.height, c.height) + (this._projectile.halfHeight ?? this._projectile.radius) + 0.03 };
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
    const c = this.config.launcher;
    if (!c.enabled || this.held.length === 0 || this.fireCooldown > 0 || this.climbPhase !== 'none') return null;
    if (!this.projectileSet && !Robot.warnedProjectile && typeof console !== 'undefined') {
      Robot.warnedProjectile = true;
      console.warn('[robot] robot.projectile was never set from the season game piece — shot solver is using defaults.');
    }
    this.fireCooldown = 1 / c.rate;
    const t = this.body.translation();
    const rv = this.body.linvel();
    const heading = this.pose.yaw;
    const ex = this.launcherExit();
    const pos = new THREE.Vector3(t.x + Math.cos(heading) * ex.forward, t.y + ex.up, t.z - Math.sin(heading) * ex.forward);

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
    const yawN = aimYaw + rng.gauss(0, c.spread);
    const pitchN = theta + rng.gauss(0, c.spread);
    const sN = speed * (1 + rng.gauss(0, c.speedError));
    const horiz = sN * Math.cos(pitchN);
    const vel = new THREE.Vector3(horiz * Math.cos(yawN) + rv.x, sN * Math.sin(pitchN), -horiz * Math.sin(yawN) + rv.z);
    return { pos, vel };
  }

  /** Hood angle of the most recent shot (for visuals/HUD). */
  lastShotAngle = 0;
  /** False when the last aimed shot had no trajectory that clears the goal rim (too close/far) — for HUD hints. */
  lastShotClear = true;

  tick(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.updateClimb(dt);
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
    return {
      id: this.id,
      x: t.x,
      y: t.y,
      z: t.z,
      yaw: yawFromQuat(this.body.rotation()),
      turretYaw: this.turretYaw,
      held: this.held.length,
      enabled: this.enabled,
      climbPhase: Math.max(0, CLIMB_PHASES.indexOf(this.climbPhase)),
      climbLevel: this.climbLevel,
      climbSlot: this.climbSlot,
      climbProgress: this.climbProgress,
      cmdSeq,
    };
  }

  /** Replica update from a (possibly interpolated) snapshot. The body is only posed, never simulated. */
  applyNet(s: RobotNetState): void {
    this.body.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
    this.body.setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) }, false);
    this.applyNetDiscrete(s);
  }

  /** Everything but the chassis pose (used when the pose comes from client-side prediction). */
  applyNetDiscrete(s: RobotNetState): void {
    this.turretYaw = s.turretYaw;
    if (this.held.length !== s.held) {
      this.held.length = 0;
      for (let i = 0; i < s.held; i++) this.held.push(-1);
    }
    this.enabled = s.enabled;
    this.climbPhase = CLIMB_PHASES[s.climbPhase] ?? 'none';
    this.climbLevel = s.climbLevel;
    this.climbSlot = s.climbSlot;
    this.replicaClimbProgress = s.climbProgress;
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
    this.climbPhase = 'none';
    this.climbLevel = 0;
    this.climbSlot = null;
    this.turretYaw = pose.yaw;
    this.fireCooldown = 0;
    this.held.length = 0;
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

  syncVisual(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.visual.position.set(t.x, t.y, t.z);
    this.visual.quaternion.set(r.x, r.y, r.z, r.w);
    const cap = Math.max(1, this.config.hopperCapacity);
    const frac = clamp(this.held.length / cap, 0, 1);
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
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.visual);
    this.physics.world.removeRigidBody(this.body);
  }
}
