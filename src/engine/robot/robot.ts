import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Alliance, FieldFrame, FieldPoint, FieldPose, yawFromQuat } from '../coords';
import { collisionGroups, Group, GROUPS, PhysicsWorld } from '../physics/world';
import { clamp, lerp, smoothstep, wrapAngle } from '../units';
import { Rng } from '../random';
import { DEFAULT_WHEEL_COF, RobotConfig, footprint, groundSideSign, stationSideSign } from './config';
import { FREE_SPEED_RATIO, limitWheelForce, ROLLING_RESISTANCE, STALL_RATIO, type WheelModel } from './drivetrain';
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
        .setLinearDamping(0.2)
        .setAngularDamping(1.0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.turretYaw = start.yaw;
    this.wheelShape = new R.Ball(Robot.WHEEL_RADIUS);
    this.buildColliders();
    this.buildVisual(scene);
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

    // Floor intake (orange) on the face opposite the scoring mechanism, funnel (station intake) on its own face.
    const groundVisible = c.intake.enabled && (c.intake.ground !== false || !!c.options?.algaeGround);
    if (groundVisible) this.buildGroundIntake(groundSideSign(c), dark);
    if (c.intake.enabled && c.intake.station) this.buildFunnel(stationSideSign(c), alu);
    this.buildScoringFace(dark);

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
    }
    // Arms from the roller ends back to the frame.
    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(bt + 0.05, 0.035, 0.03), dark);
      arm.position.set(side * (edge - bt / 2 + 0.015), 0.115, sz * (w / 2 - 0.015));
      g.add(arm);
    }
    // Stripe along the whole bumper face on this side.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, this.fp.width * 0.98), orange);
    stripe.position.set(side * (edge + 0.002), c.bumperTop + 0.002, 0);
    g.add(stripe);
    // INTAKE label on the bumper face.
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(this.fp.width * 0.8, 0.5), (c.bumperTop - c.bumperBottom) * 0.8),
      new THREE.MeshBasicMaterial({ map: makeTextTexture('INTAKE', { color: '#ff9a3c', width: 256, height: 96 }), transparent: true }),
    );
    label.position.set(side * (edge + 0.004), (c.bumperTop + c.bumperBottom) / 2, 0);
    label.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(label);
    // Capture zone on the carpet (the same strip `groundMouthContains` tests).
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(c.intake.reach, c.intake.width),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(side * (edge + c.intake.reach / 2), 0.006, 0);
    zone.userData.noShadow = true;
    g.add(zone);
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
      g.add(chev);
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
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, mouth + 0.06), alu);
    lip.position.set(side * (this.fp.length / 2 + 0.01), y - 0.09, 0);
    this.visual.add(lip);
  }

  /** Dark shooter / scoring port plate on the front bumper, so front (score) vs. intake face is obvious. */
  private buildScoringFace(dark: THREE.Material): void {
    const c = this.config;
    if (!c.launcher.enabled && !c.placement?.enabled) return;
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, Math.min(this.fp.width * 0.45, 0.3)), dark);
    port.position.set(this.fp.length / 2 + 0.003, c.bumperTop + 0.045, 0);
    this.visual.add(port);
    // Forward arrow on the roof.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 3), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }));
    arrow.rotation.set(0, 0, -Math.PI / 2);
    arrow.scale.set(1, 1, 0.25);
    arrow.position.set(c.frameLength * 0.38, c.height + 0.005, 0);
    this.visual.add(arrow);
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

  /** Put the robot back on its wheels at its current spot and heading, on top of whatever field surface is there. */
  setUpright(): void {
    const R = this.physics.R;
    const t = this.body.translation();
    const yaw = this.pose.yaw;
    const top = 3;
    const hit = this.physics.world.castRay(new R.Ray({ x: t.x, y: top, z: t.z }, { x: 0, y: -1, z: 0 }), top + 1, true, undefined, Robot.GROUND_QUERY, undefined, this.body);
    const floor = hit ? top - hit.timeOfImpact : 0;
    this.clearPiecesUnder(t.x, floor, t.z, yaw);
    this.body.setTranslation({ x: t.x, y: floor + 0.01, z: t.z }, true);
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
    const omega = clamp(e * 7 + (Math.abs(e) > 0.01 ? Math.sign(e) * 0.8 : 0), -c.maxOmega, c.maxOmega);
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
    if (!c.enabled || this.held.length === 0 || this.fireCooldown > 0 || this.climbPhase !== 'none' || this.tippedOver) return null;
    // Auto-align robots hold fire until the chassis points at the target (~3°).
    if (target && !c.turret && this.config.autoAlign && Math.abs(this.alignError) > 0.05) return null;
    if (!this.projectileSet && !Robot.warnedProjectile && typeof console !== 'undefined') {
      Robot.warnedProjectile = true;
      console.warn('[robot] robot.projectile was never set from the season game piece — shot solver is using defaults.');
    }
    this.fireCooldown = 1 / c.rate;
    const rv = this.body.linvel();
    const heading = this.pose.yaw;
    const ex = this.launcherExit();
    // The launcher is bolted to the chassis: a tilted robot launches from a tilted spot, in a tilted direction
    // (the aim below assumes a level robot, so a rocking or tipping robot misses — as it would for real).
    const pos = this.localToWorld(ex.forward, ex.up, 0, new THREE.Vector3());

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
    const vel = new THREE.Vector3(horiz * Math.cos(yawN), sN * Math.sin(pitchN), -horiz * Math.sin(yawN));
    const r = this.body.rotation();
    const tilt = this.q.set(r.x, r.y, r.z, r.w).multiply(new THREE.Quaternion(0, -Math.sin(heading / 2), 0, Math.cos(heading / 2)));
    vel.applyQuaternion(tilt);
    vel.x += rv.x;
    vel.z += rv.z;
    return { pos, vel };
  }

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
    };
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
