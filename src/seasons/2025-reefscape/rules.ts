import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ALLIANCES, opponent, type Alliance } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import { PIN_SEPARATION, PinTracker, reportPins } from '@engine/match/pinning';
import { Referee } from '@engine/match/referee';
import { groundSideSign, stationSideSign } from '@engine/robot/config';
import type { AimTarget, Robot, RobotCommand } from '@engine/robot/robot';
import { clamp, inch, wrapAngle } from '@engine/units';
import * as C from './constants';
import type { HangingNetState } from '@engine/field/hanging';
import { coralGeometry, type ReefscapeFieldRefs } from './field';
import { coralPoints, reefscapeResults } from './scoring';

export interface CoralPlacement { i: number; alliance: Alliance; level: number; face: number; branch: number; auto: boolean }
/**
 * Elevator/end effector: `height` = held piece center height, `forward` = piece center out from the robot center along
 * the scoring direction, `side` quarter turns from the front: 0 = front or stowed, +1 / -1 = left / right (side scorers),
 * 2 = back (end scorers that flip the arm over the top).
 * `handoff` runs 0→1 while a floor-intaken CORAL travels from the ground intake into the end effector (0 = none).
 */
interface MechanismState { height: number; level: number; harvest: number; forward: number; aligned: boolean; side: number; handoff: number }

/** Held CORAL center height where the end effector meets the stowed ground intake. [EST] */
const HANDOFF_HEIGHT = 0.42;
/**
 * ALGAE NET outtake (2025 robots raised the elevator at the BARGE and spat the ALGAE up and over the NET lip rather
 * than shooting it): held ALGAE center at full elevator height and the rollers' fixed outtake velocity. [EST]
 */
const NET_RELEASE_HEIGHT = inch(80);
const NET_OUTTAKE = { up: 3.7, out: 1.5 };
export interface ReefscapeNetState {
  placements: CoralPlacement[];
  mechanisms: [number, MechanismState][];
  forcedBarge: Record<Alliance, boolean>;
  /** Swinging cage poses in ALLIANCES order, by station. */
  cages: HangingNetState[];
}

/** A climbing robot carries its cage from wherever it swung to its hanging pose over the align phase. */
interface CageGrip { robot: Robot; alliance: Alliance; slot: number; from: { x: number; y: number; z: number }; t: number }

export class ReefscapeRules implements SeasonRules {
  readonly handlesIntake = true;
  readonly placements: CoralPlacement[] = [];
  readonly mechanisms = new Map<number, MechanismState>();
  private readonly carriages = new Map<number, THREE.Group>();
  private readonly masts = new Map<number, THREE.Mesh[]>();
  private readonly elevatorColliders = new Map<number, RAPIER.Collider>();
  private readonly heldVisuals = new Map<number, { coral: THREE.Mesh; algae: THREE.Mesh }>();
  private readonly scoredVisuals = new Map<number, THREE.Mesh>();
  private hpTimer: Record<Alliance, number> = { blue: 0, red: 0 };
  /** Manual (H) drops waiting for the CHUTE to clear, by station index; a second CORAL dropped on top of one still in the CHUTE would wedge both. */
  private chuteQueue: Record<Alliance, number[]> = { blue: [], red: [] };
  /** CORAL candidates on a BRANCH / in a trough and how long they've stayed there (s). */
  private readonly candidates = new Map<number, { key: string; t: number }>();
  /** BRANCH keys holding CORAL at the end of AUTO, and L1 counts then (§6.5.1 AUTO credit rules). */
  private readonly autoKeys = new Set<string>();
  private autoTrough: Record<Alliance, number> = { blue: 0, red: 0 };
  /** Pieces released from a mechanism pass through robots briefly: index → match time to restore collisions. */
  private readonly passThrough = new Map<number, number>();
  /** Per-robot vision/alignment error for the current auto-align attempt (m, lateral). */
  private readonly alignNoise = new Map<number, number>();
  private simTime = 0;
  private defenderTime: Record<Alliance, number> = { blue: 0, red: 0 };
  private forcedBarge: Record<Alliance, boolean> = { blue: false, red: false };
  private readonly cageContacts = new Set<string>();
  private readonly protectedContacts = new Set<string>();
  /** G425: 3-count on PINS. */
  private readonly pins = new PinTracker({ rule: 'G425', countSeconds: 3, separation: PIN_SEPARATION });
  private readonly notices = new Map<number, number>();
  private readonly grips: CageGrip[] = [];
  private readonly launchedBy = new Map<number, { robotId: number; at: number }>();
  private autoAssessed = false;
  private bargeAssessed = false;
  private readonly coralGeo = coralGeometry();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly algaeGeo = new THREE.SphereGeometry(C.ALGAE_RADIUS, 18, 12);
  private readonly coralMat = new THREE.MeshStandardMaterial({ color: C.COLORS.coral, roughness: 0.65, side: THREE.DoubleSide });
  private readonly algaeMat = new THREE.MeshStandardMaterial({ color: C.COLORS.algae, roughness: 0.7 });

  /** The head referee (shared calls: combat, tipping, collusion, launching at robots, ejecting pieces). */
  readonly ref: Referee;
  constructor(readonly ctx: SeasonContext, readonly refs: ReefscapeFieldRefs) {
    this.ref = new Referee(ctx, { combat: 'G423', tip: 'G424', collusion: 'G426', launchAtRobot: 'G406', eject: 'G407' });
    for (const robot of ctx.robots) {
      this.mechanisms.set(robot.id, { height: 0.45, level: robot.config.placement!.maxLevel, harvest: 0, forward: robot.footprint.length / 2 - 0.05, aligned: false, side: 0, handoff: 0 });
      const mast = new THREE.Group(); mast.name = 'reefscape-elevator';
      const rails: THREE.Mesh[] = [];
      const alu = new THREE.MeshStandardMaterial({ color: 0xbdc6d0, metalness: 0.7, roughness: 0.4 });
      for (const z of [-0.13, 0.13]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, robot.config.height - 0.2, 0.035), alu);
        rail.position.set(0.15, robot.config.height / 2 + 0.1, z); mast.add(rail); rails.push(rail);
      }
      const carriage = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.2), alu);
      beam.name = 'end-effector-arm'; carriage.add(beam);
      const coral = new THREE.Mesh(this.coralGeo, this.coralMat);
      const algae = new THREE.Mesh(this.algaeGeo, this.algaeMat); algae.position.set(0.36, -0.24, 0);
      carriage.add(coral, algae); mast.add(carriage); robot.visual.add(mast);
      this.carriages.set(robot.id, carriage); this.heldVisuals.set(robot.id, { coral, algae });
      this.masts.set(robot.id, rails);
      const collider = ctx.physics.world.createCollider(ctx.physics.R.ColliderDesc.cuboid(0.025, (robot.config.height - 0.2) / 2, 0.17)
        .setTranslation(0.15, robot.config.height / 2 + 0.1, 0).setMass(0.1).setCollisionGroups(robot.body.collider(0).collisionGroups()), robot.body);
      this.elevatorColliders.set(robot.id, collider);
    }
  }

  stage(): void {
    const { pool, robots } = this.ctx;
    this.placements.length = 0; this.autoKeys.clear(); this.candidates.clear(); this.passThrough.clear(); this.launchedBy.clear(); this.cageContacts.clear(); this.protectedContacts.clear(); this.pins.reset(); this.ref.reset();
    this.autoTrough = { blue: 0, red: 0 };
    this.autoAssessed = this.bargeAssessed = false;
    this.grips.length = 0;
    for (const a of ALLIANCES) for (const cage of this.refs.cages[a]) cage.reset();
    this.hpTimer = { blue: 0, red: 0 };
    this.chuteQueue = { blue: [], red: [] };
    this.defenderTime = { blue: 0, red: 0 }; this.forcedBarge = { blue: false, red: false };
    for (let i = 0; i < pool.count; i++) pool.reserve(i);
    for (const r of robots) r.held.length = 0;
    // 63 CORAL per alliance: 3 marks, up to 3 preloads, all remaining in its stations.
    for (const [ai, a] of ALLIANCES.entries()) {
      const base = ai * 63;
      for (const [k, p] of C.coralMarks(a).entries()) {
        pool.placeField(base + k, p.x, p.y, C.CORAL_LENGTH / 2);
        pool.bodies[base + k].setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
        // Six starting ALGAE sit atop vertical CORAL as in Figure 6-2.
        pool.placeField(C.CORAL_COUNT + 12 + ai * 3 + k, p.x, p.y, C.CORAL_LENGTH + C.ALGAE_RADIUS);
      }
      let i = base + 3;
      for (const robot of robots.filter((r) => r.alliance === a)) {
        if (robot.config.preload > 0 && robot.config.hopperCapacity > 0) { pool.hold(i, robot.id); robot.held.push(i++); }
      }
      for (; i < base + 63; i++) pool.reserve(i, `station:${a}`);
      for (let f = 0; f < 6; f++) pool.reserve(C.CORAL_COUNT + ai * 6 + f, `reef:${a}:${f}`);
    }
  }

  private isAuto(): boolean { return ['auto', 'auto-pause'].includes(this.ctx.clock.current.id); }
  private activeScoring(): boolean { return this.ctx.clock.started && !this.ctx.clock.finished; }
  private held(robot: Robot, algae: boolean): number | undefined { return robot.held.find((i) => (i >= C.CORAL_COUNT) === algae); }
  private algaeIndex(a: Alliance, f: number): number { return C.CORAL_COUNT + (a === 'red' ? 0 : 6) + f; }
  reefAlgae(a: Alliance, f: number): boolean { return this.ctx.pool.tag[this.algaeIndex(a, f)] === `reef:${a}:${f}` && this.ctx.pool.state[this.algaeIndex(a, f)] === 'reserve'; }
  private tell(robot: Robot, message: string): void {
    const now = this.ctx.clock.elapsed;
    if (now < (this.notices.get(robot.id) ?? -1)) return;
    this.notices.set(robot.id, now + 2);
    this.ctx.toast(message, 'info', robot.alliance, robot);
  }

  /** BRANCH key used for occupancy and AUTO credit. L1 uses the face's two trough halves. */
  static key(a: Alliance, level: number, face: number, branch: number): string {
    return `${a}:${level}:${face}:${branch}`;
  }
  occupied(a: Alliance, level: number, face: number, branch: number): boolean {
    return level > 1 && this.placements.some((p) => p.alliance === a && p.level === level && p.face === face && p.branch === branch);
  }
  private troughCount(a: Alliance, face: number, half: number): number {
    return this.placements.filter((p) => p.alliance === a && p.level === 1 && p.face === face && p.branch === half).length;
  }
  /** Staged ALGAE on this face blocks L3 (even faces) or L2 (odd faces) until removed. */
  blocked(a: Alliance, level: number, face: number): boolean {
    return level > 1 && level === (face % 2 === 0 ? 3 : 2) && this.reefAlgae(a, face);
  }

  /**
   * The BRANCH the end effector is heading for: the approached face of our REEF, and of its two BRANCHES the one
   * nearest the end effector (preferring open, unblocked ones).
   */
  placementTarget(robot: Robot, level: number): { face: number; branch: number; side: number; approach: ReturnType<typeof C.coralApproach> } | null {
    if (!robot.config.placement!.enabled || level > robot.config.placement!.maxLevel) return null;
    const a = robot.alliance;
    const face = C.nearestFace(a, robot.pose);
    const m = this.mechanisms.get(robot.id);
    // A side scorer reaches out of whichever side faces the REEF face.
    const side = this.sideToward(robot, C.coralApproach(a, face, 0, level).faceYaw + Math.PI);
    const p = robot.pose, f = m?.forward ?? this.halfDepth(robot), dir = p.yaw + side * Math.PI / 2;
    const ee = { x: p.x + Math.cos(dir) * f, y: p.y + Math.sin(dir) * f };
    const options = [0, 1].map((branch) => ({ branch, approach: C.coralApproach(a, face, branch, level) }))
      // L1: the less-filled half of the trough; BRANCHES: an open, unblocked one.
      .map((o) => ({ ...o, d: Math.hypot(o.approach.pos.x - ee.x, o.approach.pos.y - ee.y), bad: level === 1 ? this.troughCount(a, face, o.branch) : Number(this.occupied(a, level, face, o.branch) || this.blocked(a, level, face)) }))
      .sort((x, y) => x.bad - y.bad || (Math.abs(x.d - y.d) < 0.01 ? 0 : x.d - y.d)); // centered: stable pick, not chassis jitter
    return { face, branch: options[0].branch, side, approach: options[0].approach };
  }

  /**
   * Scoring side for a robot facing field yaw `toward`, in quarter turns from the front: 0 for front scorers, +1 (left)
   * / -1 (right) for side scorers, 0 (front) / 2 (back) for end scorers.
   */
  private sideToward(robot: Robot, toward: number): number {
    const mode = robot.config.placement!.scoreSide;
    if (mode === 'ends') return Math.cos(toward - robot.pose.yaw) >= 0 ? 0 : 2;
    if (mode !== 'sides') return 0;
    return Math.sin(toward - robot.pose.yaw) >= 0 ? 1 : -1;
  }

  /** Half the bumper-to-bumper depth along the scoring direction. */
  private halfDepth(robot: Robot): number {
    return robot.config.placement!.scoreSide === 'sides' ? robot.footprint.width / 2 : robot.footprint.length / 2;
  }

  /** How far out from its center (along the scoring direction) this robot's end effector can hold CORAL. */
  private forwardRange(robot: Robot): [number, number] {
    return [this.halfDepth(robot) - 0.15, this.halfDepth(robot) + robot.config.placement!.reach];
  }

  /**
   * Where to stand to outtake ALGAE into our NET from a raised elevator: facing the BARGE (side-on for side scorers),
   * at the distance the fixed outtake arc needs to drop the ALGAE in the middle of the NET. Null without NET scoring.
   */
  netPose(robot: Robot): { x: number; y: number; yaw: number; reachable: boolean; side: number } | null {
    if (!robot.config.options?.net || !robot.config.intake.secondary) return null;
    const a = robot.alliance, n = C.netCenter(robot.alliance), toward = C.sideYaw(a, 0);
    const side = this.sideToward(robot, toward);
    const land = C.NET_HEIGHT + C.ALGAE_RADIUS + 0.02, g = 9.81, up = NET_OUTTAKE.up;
    const flight = (up + Math.sqrt(up * up + 2 * g * (NET_RELEASE_HEIGHT - land))) / g;
    const out = NET_OUTTAKE.out * flight + this.netForward(robot);
    const y = clamp(robot.pose.y, n.y - C.NET_LENGTH / 2 + 0.45, n.y + C.NET_LENGTH / 2 - 0.45);
    return { x: n.x - Math.cos(toward) * out, y, yaw: toward - side * Math.PI / 2, reachable: true, side };
  }

  /** End effector reach (from the robot center) while outtaking ALGAE: just past the bumper. */
  private netForward(robot: Robot): number {
    const [fMin, fMax] = this.forwardRange(robot);
    return clamp(this.halfDepth(robot) + 0.05, fMin, fMax);
  }

  private nearProcessor(robot: Robot): boolean {
    const p = C.processor(robot.alliance);
    return Math.hypot(p.x - robot.pose.x, p.y - robot.pose.y) <= 1.45;
  }

  /**
   * The driver is asking for a NET outtake. ALGAE has its own button (G, away from the PROCESSOR) so it scores while
   * CORAL is also held; Space still shoots the NET when the robot holds only ALGAE.
   */
  private wantsNet(robot: Robot, cmd: RobotCommand): boolean {
    if (this.held(robot, true) === undefined || !robot.config.options?.net) return false;
    if (cmd.shoot) return this.held(robot, false) === undefined;
    return cmd.pass && !(robot.config.processor!.enabled && this.nearProcessor(robot));
  }

  /** Holding ALGAE close enough to the BARGE to raise the elevator for the NET. */
  private atNet(robot: Robot): ReturnType<ReefscapeRules['netPose']> {
    if (this.held(robot, true) === undefined) return null;
    const pose = this.netPose(robot);
    return pose && Math.hypot(pose.x - robot.pose.x, pose.y - robot.pose.y) < 1.6 ? pose : null;
  }

  /**
   * Reef auto-align (driver holds Space with CORAL near the REEF): drive to the pose that puts the end effector on
   * the target BRANCH — bumpers ~3 cm off the REEF base, facing it — like the vision/pose alignment most 2025
   * robots used. A small per-attempt lateral error models vision noise.
   */
  alignPose(robot: Robot, level: number): { x: number; y: number; yaw: number; reachable: boolean } | null {
    const t = this.placementTarget(robot, level);
    if (!t) return null;
    const a = robot.alliance, c = C.reefCenter(a), yawOut = t.approach.faceYaw;
    const n = { x: Math.cos(yawOut), y: Math.sin(yawOut) }, tan = { x: -n.y, y: n.x };
    const rel = { x: t.approach.pos.x - c.x, y: t.approach.pos.y - c.y };
    const radial = rel.x * n.x + rel.y * n.y, lateral = rel.x * tan.x + rel.y * tan.y + (this.alignNoise.get(robot.id) ?? 0);
    const [fMin, fMax] = this.forwardRange(robot);
    const bumper = C.REEF_APOTHEM + this.halfDepth(robot) + 0.03;
    // Robot center distance from the REEF center: as close as the bumpers allow, while the end effector reaches.
    const centerR = Math.max(bumper, radial + fMin);
    const reachable = centerR - radial <= fMax + 1e-6;
    // Face the REEF with the scoring side: nose-in, or side-on for side scorers.
    return { x: c.x + n.x * centerR + tan.x * lateral, y: c.y + n.y * centerR + tan.y * lateral, yaw: yawOut + Math.PI - t.side * Math.PI / 2, reachable };
  }

  adjustCommand(robot: Robot, cmd: RobotCommand, _dt: number): RobotCommand {
    const m = this.mechanisms.get(robot.id);
    if (!m) return cmd;
    m.aligned = false;
    const coral = this.held(robot, false);
    const reef = C.reefCenter(robot.alliance);
    const near = Math.hypot(robot.pose.x - reef.x, robot.pose.y - reef.y) < C.REEF_APOTHEM + 2.2;
    // Near the BARGE, the same assist lines up the NET outtake (ALGAE button, or Space holding only ALGAE).
    const algaeNet = this.wantsNet(robot, cmd);
    const coralPlace = cmd.shoot && coral !== undefined;
    const net = algaeNet ? this.netPose(robot) : null;
    const nearNet = !!net && Math.hypot(net.x - robot.pose.x, net.y - robot.pose.y) < 2.5;
    if (!robot.config.autoAlign || !(coralPlace || algaeNet) || robot.isClimbing || !(coralPlace ? near : nearNet)) {
      if (!cmd.shoot && !algaeNet) this.alignNoise.delete(robot.id);
      return cmd;
    }
    if (!this.alignNoise.has(robot.id)) this.alignNoise.set(robot.id, this.ctx.rng.gauss(0, 0.006));
    const level = Math.round(clamp(cmd.scoringLevel ?? m.level, 1, robot.config.placement!.maxLevel));
    const pose = coralPlace ? this.alignPose(robot, level) : net;
    if (!pose) return cmd;
    const p = robot.pose;
    const dx = pose.x - p.x, dy = pose.y - p.y, d = Math.hypot(dx, dy);
    const yawErr = wrapAngle(pose.yaw - p.yaw);
    const speed = Math.min(1.8, robot.config.maxSpeed, d * 4 + 0.05);
    m.aligned = d < 0.012 && Math.abs(yawErr) < 0.02 && pose.reachable;
    return { ...cmd, vx: d > 0.004 ? (dx / d) * speed : 0, vy: d > 0.004 ? (dy / d) * speed : 0, omega: clamp(yawErr * 6, -robot.config.maxOmega, robot.config.maxOmega) };
  }

  handleMechanisms(robot: Robot, cmd: RobotCommand, dt: number): boolean {
    const m = this.mechanisms.get(robot.id)!;
    const mechanism = robot.config.placement!;
    m.level = Math.round(clamp(cmd.scoringLevel ?? m.level, 1, mechanism.maxLevel));
    const coral = this.held(robot, false), algae = this.held(robot, true);
    // A floor-intaken CORAL is still on its way from the ground intake into the end effector.
    if (m.handoff > 0) {
      m.handoff += dt / Math.max(0.05, mechanism.handoffSeconds ?? 0.5);
      if (m.handoff >= 1 || coral === undefined) m.handoff = 0;
    }
    const handingOff = m.handoff > 0;
    const target = coral !== undefined && !handingOff ? this.placementTarget(robot, m.level) : null;
    const algaeNet = this.wantsNet(robot, cmd);
    const net = algaeNet ? this.atNet(robot) : null;
    // The elevator / arm only move into scoring position while the driver holds Space (CORAL) or G (ALGAE, the same
    // buttons that start auto-align); otherwise they stay stowed low for driving. A tipped-over robot is helpless.
    const placing = cmd.shoot && coral !== undefined;
    const netDeploy = !!net && !placing;
    const deploy = (cmd.shoot || netDeploy) && !robot.tippedOver;
    // Holding CORAL: the elevator rides at the selected level and the end effector reaches toward the BRANCH.
    let desiredHeight = target && deploy && placing ? target.approach.pos.z : handingOff ? HANDOFF_HEIGHT : 0.45;
    const [fMin, fMax] = this.forwardRange(robot);
    let desiredForward = handingOff ? fMin : this.halfDepth(robot) - 0.05;
    let need = desiredForward;
    // Side scorers swing out toward the REEF only when there (stowed while driving around).
    const home = C.reefCenter(robot.alliance);
    const atReef = Math.hypot(robot.pose.x - home.x, robot.pose.y - home.y) < C.REEF_APOTHEM + 1.6;
    m.side = deploy ? (placing && atReef ? target?.side : undefined) ?? (netDeploy ? net?.side : undefined) ?? 0 : 0;
    if (target && deploy && placing) {
      const p = robot.pose, dir = p.yaw + m.side * Math.PI / 2;
      need = (target.approach.pos.x - p.x) * Math.cos(dir) + (target.approach.pos.y - p.y) * Math.sin(dir);
      desiredForward = clamp(need, fMin, fMax);
    } else if (net && netDeploy && deploy) {
      // ALGAE at the BARGE: the elevator goes to full height to outtake over the NET.
      desiredHeight = NET_RELEASE_HEIGHT;
      desiredForward = this.netForward(robot);
    }
    // ALGAE is neutral: it can be collected from either reef (G410 protects only opponent CORAL).
    const harvestAlliance = ALLIANCES.reduce((nearest, a) => {
      const p = C.reefCenter(a), q = C.reefCenter(nearest);
      return Math.hypot(p.x - robot.pose.x, p.y - robot.pose.y) < Math.hypot(q.x - robot.pose.x, q.y - robot.pose.y) ? a : nearest;
    }, robot.alliance);
    const face = C.nearestFace(harvestAlliance, robot.pose);
    const reef = C.reefCenter(harvestAlliance);
    const nearReef = Math.hypot(robot.pose.x - reef.x, robot.pose.y - reef.y) < C.REEF_APOTHEM - 0.07 + robot.config.frameLength / 2 + mechanism.reach + C.ALGAE_RADIUS;
    // A robot that can't store ALGAE (no ALGAE intake, or one already held) can still use its
    // elevator/intake to dislodge it onto the carpet, as CORAL-only robots did to open L2/L3.
    const canHold = robot.config.intake.secondary && robot.config.intake.enabled && algae === undefined && robot.capacityLeft > 0;
    const hasTool = robot.config.intake.secondary || mechanism.enabled;
    const harvest = cmd.intake && !cmd.shoot && hasTool && (face % 2 === 0 ? 3 : 2) <= mechanism.maxLevel && nearReef && this.reefAlgae(harvestAlliance, face);
    if (harvest) desiredHeight = C.LEVEL_HEIGHTS[face % 2 === 0 ? 3 : 2] + 0.08;
    m.height += clamp(desiredHeight - m.height, -mechanism.liftSpeed * dt, mechanism.liftSpeed * dt);
    m.forward += clamp(desiredForward - m.forward, -1.2 * dt, 1.2 * dt);
    this.updateElevatorCollider(robot, m.height);
    if (robot.isClimbing) return true;
    if (harvest && Math.abs(m.height - desiredHeight) < 0.06) {
      m.harvest += dt;
      if (m.harvest >= mechanism.harvestSeconds) {
        const i = this.algaeIndex(harvestAlliance, face);
        this.ctx.pool.tag[i] = null; m.harvest = 0;
        if (canHold) {
          this.ctx.pool.hold(i, robot.id); robot.held.push(i);
          this.ctx.toast('ALGAE removed · branch level cleared', 'good', robot.alliance, robot);
        } else {
          this.dislodgeAlgae(robot, i, harvestAlliance, face);
          this.ctx.toast('ALGAE knocked off the REEF · branch level cleared', 'good', robot.alliance, robot);
        }
      }
    } else m.harvest = 0;
    if (cmd.intake && robot.config.intake.enabled) this.intake(robot);
    if (cmd.shoot && coral !== undefined && robot.fireCooldown <= 0) {
      if (!mechanism.enabled) { this.tell(robot, 'No CORAL scorer on this robot · G ejects held CORAL'); return true; }
      if (handingOff || !target) return true;
      if (need > fMax + 0.03) { this.tell(robot, robot.config.autoAlign ? 'Too far from the REEF · hold Space closer to auto-align' : 'Out of reach · drive closer to the REEF'); return true; }
      if (need < fMin - 0.03) { this.tell(robot, 'Too close for the end effector · back off the REEF'); return true; }
      // Auto-align robots wait until lined up; manual robots release wherever the driver put them.
      if (robot.config.autoAlign && !m.aligned) return true;
      if (Math.abs(m.height - desiredHeight) > 0.02 || Math.abs(m.forward - desiredForward) > 0.02) return true;
      this.ejectCoral(robot, coral, m.level);
    } else if (algae !== undefined && robot.fireCooldown <= 0 && (cmd.pass || cmd.shoot)) {
      if (cmd.pass && robot.config.processor!.enabled && (this.nearProcessor(robot) || !robot.config.options?.net)) this.feedProcessor(robot, algae);
      else if (algaeNet) {
        if (!net) this.tell(robot, 'Drive up to the BARGE facing your NET · the elevator rises and outtakes the ALGAE');
        else if ((!robot.config.autoAlign || m.aligned) && Math.abs(m.height - desiredHeight) < 0.03 && Math.abs(m.forward - desiredForward) < 0.03) this.outtakeNet(robot, algae);
      } else this.tell(robot, cmd.pass ? 'No ALGAE scoring mechanism on this robot' : 'No ALGAE NET mechanism on this robot');
    } else if (cmd.pass && coral !== undefined && robot.fireCooldown <= 0) {
      // Short reverse-intake ejection is the explicit G412 exception (about 3 ft).
      const p = robot.pose;
      this.release(robot, coral);
      this.ctx.pool.placeWorld(coral, this.ctx.frame.toWorld(p.x + Math.cos(p.yaw) * (robot.footprint.length / 2 + 0.18), p.y + Math.sin(p.yaw) * (robot.footprint.length / 2 + 0.18), 0.18), this.ctx.frame.velToWorld(Math.cos(p.yaw) * 0.7, Math.sin(p.yaw) * 0.7, 0));
      this.launchedBy.set(coral, { robotId: robot.id, at: this.ctx.clock.elapsed });
      robot.fireCooldown = 0.6;
    }
    return true;
  }

  /**
   * Release CORAL from the end effector: it leaves nose-first along the robot's heading (pitched 35° down for
   * L2/L3, straight down for L4, lying sideways for the L1 trough). Physics decides whether a BRANCH ends up inside
   * it — misalignment of more than about an inch, or a crooked heading, and it falls off.
   */
  ejectCoral(robot: Robot, i: number, level: number): void {
    const m = this.mechanisms.get(robot.id)!;
    const p = robot.pose, v = robot.fieldVelocity, dir = p.yaw + m.side * Math.PI / 2;
    const pos = { x: p.x + Math.cos(dir) * m.forward, y: p.y + Math.sin(dir) * m.forward, z: m.height };
    const travel = level === 4 ? { x: 0, y: 0, z: -1 } : level === 1 ? C.dir3(dir, 0) : C.dir3(dir, -C.BRANCH_ANGLE);
    const axis = level === 1 ? C.dir3(dir + Math.PI / 2, 0) : travel;
    // Rollers spit CORAL out fast enough that it barely drops before the BRANCH tip is inside it.
    const speed = level === 1 ? 0.6 : level === 4 ? 0.9 : 2.2;
    this.release(robot, i);
    this.ctx.pool.placeWorld(i, this.ctx.frame.toWorld(pos.x, pos.y, pos.z), this.ctx.frame.velToWorld(v.vx + travel.x * speed, v.vy + travel.y * speed, travel.z * speed));
    // Body +X is the tube axis.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), this.ctx.frame.velToWorld(axis.x, axis.y, axis.z).normalize());
    this.ctx.pool.bodies[i].setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.ctx.pool.setIgnoreRobots(i, true);
    this.passThrough.set(i, this.simTime + 0.5);
    this.launchedBy.set(i, { robotId: robot.id, at: this.ctx.clock.elapsed });
    this.ctx.score.tally(robot.id, 'shots');
    robot.fireCooldown = robot.config.placement!.cycleSeconds;
    this.alignNoise.delete(robot.id);
  }

  /** Drop staged reef ALGAE past the side of the face's pipe pair, away from the robot, so it falls to the carpet. */
  private dislodgeAlgae(robot: Robot, i: number, a: Alliance, face: number): void {
    const c = C.reefCenter(a), angle = C.sideYaw(a, face * Math.PI / 3);
    const n = { x: Math.cos(angle), y: Math.sin(angle) }, t = { x: -n.y, y: n.x };
    const lateral = (robot.pose.x - c.x) * t.x + (robot.pose.y - c.y) * t.y;
    const sign = lateral > 0 ? -1 : 1;
    const r = C.REEF_APOTHEM - 0.07, off = sign * 0.41;
    const z = C.LEVEL_HEIGHTS[face % 2 === 0 ? 3 : 2] + 0.08;
    this.ctx.pool.placeWorld(i, this.ctx.frame.toWorld(c.x + n.x * r + t.x * off, c.y + n.y * r + t.y * off, z),
      this.ctx.frame.velToWorld(n.x * 1.1 + t.x * sign * 0.7, n.y * 1.1 + t.y * sign * 0.7, 0.4));
    this.launchedBy.set(i, { robotId: robot.id, at: this.ctx.clock.elapsed });
  }

  private updateElevatorCollider(robot: Robot, height: number): void {
    const mastHeight = Math.max(robot.config.height, height + 0.15);
    const collider = this.elevatorColliders.get(robot.id)!;
    collider.setHalfExtents({ x: 0.025, y: (mastHeight - 0.2) / 2, z: 0.17 });
    collider.setTranslationWrtParent({ x: 0.15, y: mastHeight / 2 + 0.1, z: 0 });
    collider.setEnabled(!robot.isClimbing);
  }

  private release(robot: Robot, i: number): void { robot.held.splice(robot.held.indexOf(i), 1); }


  private intake(robot: Robot): void {
    const { pool } = this.ctx;
    const placed = new Set(this.placements.map((p) => p.i));
    for (let i = 0; i < pool.count; i++) {
      const isAlgae = i >= C.CORAL_COUNT;
      if (pool.state[i] !== 'field' || robot.capacityLeft <= 0 || this.held(robot, isAlgae) !== undefined || placed.has(i)) continue;
      const launched = this.launchedBy.get(i);
      if (launched?.robotId === robot.id && this.ctx.clock.elapsed - launched.at < 0.65) continue;
      const p = pool.position(i);
      let take = false, ground = false;
      if (!isAlgae && robot.config.intake.primary) {
        ground = p.y <= 0.35 && robot.config.intake.ground !== false && robot.groundMouthContains(p, C.CORAL_RADIUS);
        take = ground || robot.stationContains(p, C.CORAL_RADIUS);
      } else if (isAlgae && robot.config.intake.secondary && robot.config.options?.algaeGround) {
        take = p.y <= 0.65 && robot.groundMouthContains(p, C.ALGAE_RADIUS);
      }
      if (!take) continue;
      pool.hold(i, robot.id); robot.held.push(i);
      // Floor CORAL is handed from the ground intake to the end effector before it can be scored.
      const m = this.mechanisms.get(robot.id);
      if (ground && m && robot.config.placement!.enabled && (robot.config.placement!.handoffSeconds ?? 0) > 0) m.handoff = 1e-6;
    }
  }

  // ─────────────────────────── CORAL scoring by physics (§6.5.1) ───────────────────────────

  /** Where a free CORAL sits: on a BRANCH (the BRANCH inside its volume) or in a trough, else null. */
  private coralSpot(i: number): { alliance: Alliance; level: number; face: number; branch: number } | null {
    const { pool, frame } = this.ctx;
    const c = frame.toField(pool.position(i));
    const q = pool.bodies[i].rotation();
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const axis = { x: ax.x, y: -ax.z, z: ax.y };
    for (const a of ALLIANCES) {
      const rc = C.reefCenter(a);
      const dr = Math.hypot(c.x - rc.x, c.y - rc.y);
      if (dr > C.REEF_APOTHEM + 0.3) continue;
      const face = C.nearestFace(a, c);
      for (let level = 2; level <= 4; level++) for (let branch = 0; branch < 2; branch++) {
        const seg = C.branchSegment(a, face, branch, level);
        const sd = { x: seg.tip.x - seg.base.x, y: seg.tip.y - seg.base.y, z: seg.tip.z - seg.base.z };
        const sl = Math.hypot(sd.x, sd.y, sd.z);
        if (Math.abs(axis.x * sd.x + axis.y * sd.y + axis.z * sd.z) / sl < Math.cos((25 * Math.PI) / 180)) continue;
        if (segmentDistance(c, axis, C.CORAL_LENGTH / 2, seg.base, sd) < C.CORAL_INNER_RADIUS - C.BRANCH_RADIUS * 0.3) return { alliance: a, level, face, branch };
      }
      // L1: resting in (or stacked on CORAL in) the trough along this face.
      const yaw = C.sideYaw(a, face * Math.PI / 3);
      const n = { x: Math.cos(yaw), y: Math.sin(yaw) };
      const radial = (c.x - rc.x) * n.x + (c.y - rc.y) * n.y;
      if (radial > C.REEF_APOTHEM - 0.3 && radial < C.REEF_APOTHEM + 0.03 && c.z > 0.25 && c.z < C.LEVEL_HEIGHTS[1] + 0.2 && Math.hypot(pool.velocity(i).x, pool.velocity(i).y, pool.velocity(i).z) < 0.15) {
        const lateral = -(c.x - rc.x) * n.y + (c.y - rc.y) * n.x;
        return { alliance: a, level: 1, face, branch: lateral < 0 ? 0 : 1 };
      }
    }
    return null;
  }

  /** CORAL touching a robot of the scoring alliance does not count (§6.5.1). */
  private touchingAllianceRobot(i: number, a: Alliance): boolean {
    const body = this.ctx.pool.bodies[i];
    for (const r of this.ctx.robots) {
      if (r.alliance !== a) continue;
      for (let k = 0; k < body.numColliders(); k++) for (let j = 0; j < r.body.numColliders(); j++) {
        let hit = false;
        this.ctx.physics.world.contactPair(body.collider(k), r.body.collider(j), (mf) => { if (mf.numContacts() > 0) hit = true; });
        if (hit) return true;
      }
    }
    return false;
  }

  /** Re-derive scored CORAL from where the pieces physically are; a spot must hold for 0.3 s. */
  private detectCoral(dt: number): void {
    const { pool } = this.ctx;
    const seen = new Set<number>();
    for (let i = 0; i < C.CORAL_COUNT; i++) {
      if (pool.state[i] !== 'field') continue;
      const spot = this.coralSpot(i);
      if (!spot || this.touchingAllianceRobot(i, spot.alliance)) continue;
      const key = ReefscapeRules.key(spot.alliance, spot.level, spot.face, spot.branch);
      const prev = this.candidates.get(i);
      this.candidates.set(i, { key, t: prev && prev.key === key ? prev.t + dt : 0 });
      seen.add(i);
    }
    for (const i of [...this.candidates.keys()]) if (!seen.has(i)) this.candidates.delete(i);
    const next: CoralPlacement[] = [];
    const taken = new Set<string>();
    // Keep existing placements first so a second CORAL can't take over an occupied BRANCH.
    const order = [...this.candidates.entries()].sort(([x], [y]) => Number(!this.placements.some((p) => p.i === x)) - Number(!this.placements.some((p) => p.i === y)));
    for (const [i, cand] of order) {
      if (cand.t < 0.3) continue;
      const [a, level, face, branch] = cand.key.split(':');
      const lvl = Number(level);
      if (lvl > 1 && taken.has(cand.key)) continue;
      taken.add(cand.key);
      next.push({ i, alliance: a as Alliance, level: lvl, face: Number(face), branch: Number(branch), auto: false });
    }
    const before = new Set(this.placements.map((p) => `${p.i}@${ReefscapeRules.key(p.alliance, p.level, p.face, p.branch)}`));
    for (const p of next) if (!before.has(`${p.i}@${ReefscapeRules.key(p.alliance, p.level, p.face, p.branch)}`) && this.activeScoring()) {
      this.ctx.toast(`${p.alliance.toUpperCase()} CORAL L${p.level} · scored`, 'good', p.alliance);
    }
    this.placements.splice(0, this.placements.length, ...next);
    this.scoreCoral();
  }

  /** CORAL points from the current placements with AUTO credit per §6.5.1. */
  private scoreCoral(): void {
    const auto = this.isAuto();
    for (const a of ALLIANCES) {
      let autoPts = 0, telePts = 0;
      const counts = [0, 0, 0, 0, 0];
      const trough = this.placements.filter((p) => p.alliance === a && p.level === 1).length;
      const troughAuto = auto ? trough : Math.min(trough, this.autoTrough[a]);
      for (const p of this.placements) {
        if (p.alliance !== a) continue;
        counts[p.level]++;
        if (p.level === 1) continue;
        p.auto = auto || this.autoKeys.has(ReefscapeRules.key(a, p.level, p.face, p.branch));
        if (p.auto) autoPts += coralPoints(p.level, true); else telePts += coralPoints(p.level, false);
      }
      autoPts += troughAuto * coralPoints(1, true);
      telePts += (trough - troughAuto) * coralPoints(1, false);
      let k = 0;
      for (const p of this.placements) if (p.alliance === a && p.level === 1) p.auto = k++ < troughAuto;
      this.ctx.score.set(a, 'autoCoral', autoPts);
      this.ctx.score.set(a, 'teleopCoral', telePts);
      for (let l = 1; l <= 4; l++) this.ctx.score.counters[a][`coralL${l}`] = counts[l];
      this.creditCoral(a);
    }
  }

  /** Attribute this alliance's placements to the robot that last released each CORAL. */
  private creditCoral(a: Alliance): void {
    const { score, robots } = this.ctx;
    const mine = robots.filter((r) => r.alliance === a);
    const got = new Map<number, { auto: number; tele: number; n: number }>(mine.map((r) => [r.id, { auto: 0, tele: 0, n: 0 }]));
    for (const p of this.placements) {
      if (p.alliance !== a) continue;
      const g = got.get(this.launchedBy.get(p.i)?.robotId ?? -1);
      if (!g) continue;
      g.n++;
      if (p.auto) g.auto += coralPoints(p.level, true); else g.tele += coralPoints(p.level, false);
    }
    for (const [id, g] of got) {
      score.setCredit(id, 'autoCoral', g.auto);
      score.setCredit(id, 'teleopCoral', g.tele);
      score.setTally(id, 'scored', g.n + score.robotCounter(id, 'algaeScored'));
    }
  }

  /** End of AUTO scoring (§6.5 A): remember which locations earned AUTO credit. */
  private snapshotAuto(): void {
    this.autoKeys.clear();
    for (const a of ALLIANCES) {
      const mine = this.placements.filter((p) => p.alliance === a);
      for (const p of mine) if (p.level > 1) this.autoKeys.add(ReefscapeRules.key(a, p.level, p.face, p.branch));
      this.autoTrough[a] = mine.filter((p) => p.level === 1).length;
      this.ctx.score.counters[a].autoCoral = mine.length;
    }
  }

  private feedProcessor(robot: Robot, i: number): void {
    const p = C.processor(robot.alliance);
    const dist = Math.hypot(p.x - robot.pose.x, p.y - robot.pose.y);
    if (dist > 1.45) { this.tell(robot, 'Drive to your PROCESSOR · G feeds ALGAE into its opening'); return; }
    const dx = p.x - robot.pose.x, dy = p.y - robot.pose.y;
    const d = Math.max(0.01, dist);
    const pos = this.ctx.frame.toWorld(robot.pose.x + dx / d * (robot.footprint.length / 2 + C.ALGAE_RADIUS + 0.04), robot.pose.y + dy / d * (robot.footprint.length / 2 + C.ALGAE_RADIUS + 0.04), inch(7) + C.ALGAE_RADIUS + 0.015);
    const flight = Math.max(0.06, (dist - robot.footprint.length / 2 - C.ALGAE_RADIUS - 0.04) / 2.3);
    this.release(robot, i); this.ctx.pool.placeWorld(i, pos, this.ctx.frame.velToWorld(dx / d * 2.3, dy / d * 2.3, 4.905 * flight + 0.03));
    this.onLaunch(robot, i); robot.fireCooldown = 0.65;
  }

  /**
   * NET outtake from the raised elevator: the rollers spit the ALGAE up and out of the end effector at a fixed speed
   * along the scoring direction. Physics decides whether it clears the NET lip and drops in — stand too close or too
   * far (or crooked) and it bounces off the rim or falls short.
   */
  private outtakeNet(robot: Robot, i: number): void {
    const m = this.mechanisms.get(robot.id)!;
    const p = robot.pose, v = robot.fieldVelocity, dir = p.yaw + m.side * Math.PI / 2;
    const out = { x: Math.cos(dir), y: Math.sin(dir) };
    this.release(robot, i);
    this.ctx.pool.placeWorld(i, this.ctx.frame.toWorld(p.x + out.x * m.forward, p.y + out.y * m.forward, m.height),
      this.ctx.frame.velToWorld(v.vx + out.x * NET_OUTTAKE.out, v.vy + out.y * NET_OUTTAKE.out, NET_OUTTAKE.up));
    this.ctx.pool.setIgnoreRobots(i, true);
    this.passThrough.set(i, this.simTime + 0.5);
    this.onLaunch(robot, i); robot.fireCooldown = 0.65;
  }

  /** No REEFSCAPE mechanism is a projectile shooter (the NET is an elevator outtake), so there is no aim target. */
  aimTarget(_robot: Robot): AimTarget | null {
    return null;
  }
  onLaunch(robot: Robot, i: number): void {
    this.launchedBy.set(i, { robotId: robot.id, at: this.ctx.clock.elapsed });
    this.ctx.score.tally(robot.id, 'shots');
    // CORAL has no goal to throw at, ALGAE is thrown at the NET: a piece that hits an opponent was launched at it (G406).
    const n = C.netCenter(robot.alliance);
    this.ref.launched(robot, i, i < C.CORAL_COUNT ? null : this.ctx.frame.toWorld(n.x, n.y, C.NET_HEIGHT), i < C.CORAL_COUNT);
    if (i < C.CORAL_COUNT && !C.inReefZone(robot.alliance, robot.pose, robot.footprint.length, robot.footprint.width) && this.ctx.clock.mode !== 'disabled') {
      this.ref.call({ rule: 'G412', kind: 'major', robot, note: 'launched CORAL from outside the REEF ZONE' });
    }
  }

  onPeriodChange(change: PeriodChange): void {
    if (change.from?.id === 'auto') this.assessLeave();
    if (change.from?.id === 'auto-pause') this.snapshotAuto();
    if (!change.to) this.assessBarge();
  }
  private assessLeave(): void {
    if (this.autoAssessed) return;
    this.autoAssessed = true;
    for (const r of this.ctx.robots) {
      const line = r.alliance === 'blue' ? C.START_LINE : C.FIELD_LENGTH - C.START_LINE;
      const xs = r.corners().map((p) => p.x);
      if (Math.max(...xs) < line || Math.min(...xs) > line) { this.ctx.score.inc(r.alliance, 'leave'); this.ctx.score.add(r.alliance, 'leave', 3, 0, r.id); }
    }
  }
  private assessBarge(): void {
    if (this.bargeAssessed) return;
    this.bargeAssessed = true;
    for (const a of ALLIANCES) {
      let points = 0;
      for (const r of this.ctx.robots.filter((r) => r.alliance === a)) {
        let mine = 0;
        if (r.climbPhase === 'hanging' && r.elevation > 0.03 && r.climbSlot !== null) mine = C.CAGE_POINTS[this.refs.cageDepth[a][r.climbSlot]];
        else if (this.inBargeZone(r)) mine = 2;
        points += mine;
        this.ctx.score.setCredit(r.id, 'barge', mine);
      }
      this.ctx.score.set(a, 'barge', points);
    }
  }
  /** The robot that last released piece `i`, if it is on alliance `a`. */
  private scorer(i: number, a: Alliance): number | undefined {
    const id = this.launchedBy.get(i)?.robotId;
    return id !== undefined && this.ctx.robots.find((r) => r.id === id)?.alliance === a ? id : undefined;
  }
  inBargeZone(robot: Robot): boolean {
    const corners = robot.corners();
    const ys = corners.map((p) => p.y), xs = corners.map((p) => p.x);
    const [y0, y1] = C.bargeZoneY(robot.alliance);
    return Math.min(...xs) <= C.FIELD_LENGTH / 2 + C.BARGE_ZONE_DEPTH / 2 && Math.max(...xs) >= C.FIELD_LENGTH / 2 - C.BARGE_ZONE_DEPTH / 2 && Math.max(...ys) >= y0 && Math.min(...ys) <= y1;
  }

  beforeStep(dt: number): void {
    this.simTime += dt;
    for (const [i, until] of this.passThrough) if (this.simTime >= until) { this.ctx.pool.setIgnoreRobots(i, false); this.passThrough.delete(i); }
    this.updateGrips(dt);
    if (!this.activeScoring()) return;
    for (const a of ALLIANCES) {
      this.hpTimer[a] -= dt;
      this.feedQueuedDrops(a);
      if (this.ctx.clock.mode === 'disabled' || !this.ctx.humanPlayerIsAuto(a) || this.hpTimer[a] > 0) continue;
      if (!this.isAuto() && this.ctx.pool.countIn('reserve', `hp:${a}`) > 0) { this.throwAlgae(a); this.hpTimer[a] = 1.7; continue; }
      // The automatic HUMAN PLAYER drops CORAL down the CHUTE for a robot waiting at a station.
      for (const [k, st] of C.stations(a).entries()) {
        const r = this.ctx.robots.find((x) => x.alliance === a && this.wantsCoral(x) && Math.hypot(x.pose.x - st.x, x.pose.y - st.y) < 1.7);
        if (r && !this.coralInChute(st)) { this.dropCoral(a, k, r); this.hpTimer[a] = 1.1; break; }
      }
    }
    this.enforceDefenders(dt);
    this.enforceCageContact();
  }

  afterStep(dt: number): void {
    // Sensors run even outside a match (tests, pre-match); fouls and toasts only in a match.
    this.detectCoral(dt);
    for (const a of ALLIANCES) this.refs.algaeColliders[a].forEach((c, f) => c.setEnabled(this.reefAlgae(a, f)));
    if (!this.activeScoring()) return;
    this.ref.update(dt);
    this.enforceProtectedContact();
    this.enforceBlockade(dt);
    if (this.ctx.clock.mode !== 'disabled') reportPins(this.pins.updateRobots(dt, this.ctx.robots, this.ctx.physics), this.ctx, this.ctx.clock.elapsed);
    const { pool, frame, score } = this.ctx;
    for (let i = C.CORAL_COUNT; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      for (const a of ALLIANCES) {
        const pr = C.processor(a);
        const pastWall = a === 'blue' ? p.y < 0.05 : p.y > C.FIELD_WIDTH - 0.05;
        if (pastWall && Math.abs(p.x - pr.x) < inch(14) - C.ALGAE_RADIUS * 0.5 && p.z > inch(7) + C.ALGAE_RADIUS * 0.75 && p.z < inch(27) - C.ALGAE_RADIUS * 0.5) {
          const by = this.scorer(i, a);
          score.add(a, 'processor', 6, this.ctx.clock.elapsed, by); score.inc(a, 'processor');
          if (by !== undefined) score.tally(by, 'algaeScored');
          pool.reserve(i, `hp:${opponent(a)}`);
          this.ctx.toast(`${a.toUpperCase()} PROCESSOR · +6 · ALGAE delivered to ${opponent(a).toUpperCase()} human player`, 'good', a);
          break;
        }
        const n = C.netCenter(a);
        if (Math.abs(p.x - n.x) <= C.NET_WIDTH / 2 - C.ALGAE_RADIUS * 0.7 && Math.abs(p.y - n.y) <= C.NET_LENGTH / 2 - C.ALGAE_RADIUS * 0.7 && p.z >= C.NET_HEIGHT && p.z <= C.NET_HEIGHT + C.ALGAE_RADIUS + 0.08 && pool.velocity(i).y <= 0.3) {
          const by = this.scorer(i, a);
          score.add(a, 'net', 4, this.ctx.clock.elapsed, by); const count = score.inc(a, 'net');
          if (by !== undefined) score.tally(by, 'algaeScored');
          pool.reserve(i, `net:${a}:${count}`); this.ctx.toast(`${a.toUpperCase()} NET · +4`, 'good', a); break;
        }
      }
    }
    // Accidental out-of-field pieces are safely returned (§6.9); preserve total supply.
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      if (p.x < -0.7 || p.x > C.FIELD_LENGTH + 0.7 || p.y < -0.7 || p.y > C.FIELD_WIDTH + 0.7 || p.z < -0.3) {
        this.ref.ejected(i); // G407
        pool.placeField(i, clamp(p.x, 0.7, C.FIELD_LENGTH - 0.7), clamp(p.y, 0.7, C.FIELD_WIDTH - 0.7));
      }
    }
  }

  /**
   * HUMAN PLAYER buttons: 1 (H) drops a CORAL down the CHUTE of the station nearest your robot, aimed at it;
   * 2 (B) throws an ALGAE received from the PROCESSOR at your NET (TELEOP only).
   */
  humanPlayerAction(a: Alliance, button = 1): void {
    if (this.ctx.clock.mode === 'disabled' || !this.activeScoring()) return;
    if (button === 2) { this.throwAlgae(a, true); return; }
    const robot = this.ctx.playerRobot?.alliance === a ? this.ctx.playerRobot : this.ctx.robots.find((r) => r.alliance === a);
    const stations = C.stations(a);
    const k = robot ? (Math.hypot(robot.pose.x - stations[0].x, robot.pose.y - stations[0].y) <= Math.hypot(robot.pose.x - stations[1].x, robot.pose.y - stations[1].y) ? 0 : 1) : 0;
    if (this.ctx.pool.indices('reserve', `station:${a}`).length <= this.chuteQueue[a].length) { this.ctx.toast('No CORAL left at the CORAL STATION', 'warn', a); return; }
    // Fast presses queue up and are fed one at a time, like a human player waiting for the CHUTE to clear.
    if (this.chuteQueue[a].length > 0 || this.chuteOccupied(stations[k])) { this.chuteQueue[a].push(k); return; }
    this.dropCoral(a, k, robot ?? null);
  }

  private feedQueuedDrops(a: Alliance): void {
    const queue = this.chuteQueue[a];
    if (queue.length === 0) return;
    if (this.ctx.clock.mode === 'disabled') { queue.length = 0; return; }
    const robot = this.ctx.playerRobot?.alliance === a ? this.ctx.playerRobot : this.ctx.robots.find((r) => r.alliance === a) ?? null;
    if (this.chuteOccupied(C.stations(a)[queue[0]])) return;
    if (!this.dropCoral(a, queue[0], robot)) queue.length = 0;
    else queue.shift();
  }

  /** Wait for the whole CHUTE and lip to clear, including either edge of its wide opening. */
  private chuteOccupied(st: { x: number; y: number; yaw: number }): boolean {
    const { pool, frame } = this.ctx;
    const nx = Math.cos(st.yaw), ny = Math.sin(st.yaw);
    const back = C.CHUTE_LIP * Math.cos(C.CHUTE_LIP_ANGLE) + C.CHUTE_LENGTH * Math.cos(C.CHUTE_ANGLE);
    return pool.indices('field').some((i) => {
      if (i >= C.CORAL_COUNT) return false;
      const q = frame.toField(pool.position(i));
      const dx = q.x - st.x, dy = q.y - st.y;
      const out = dx * nx + dy * ny, along = -dx * ny + dy * nx;
      // Include the pipe's extent so a rotating piece must fully exit before another follows.
      const margin = C.CORAL_LENGTH / 2 + 0.03;
      return out >= -back - margin && out <= margin && Math.abs(along) <= C.STATION_MOUTH_WIDTH / 2 + margin && q.z > C.STATION_MOUTH_HEIGHT - C.CORAL_RADIUS;
    });
  }

  /** Automatic feeding also waits for CORAL around the robot below the opening. */
  private coralInChute(st: { x: number; y: number; yaw: number }): boolean {
    const { pool, frame } = this.ctx;
    return pool.indices('field').some((i) => {
      if (i >= C.CORAL_COUNT) return false;
      const q = frame.toField(pool.position(i));
      return Math.hypot(q.x - st.x, q.y - st.y) < 0.9 && q.z > 0.3;
    });
  }

  /**
   * Physically feed a CORAL: placed lying across the top of the 55° CHUTE, it rolls down, out of the opening and
   * either into a robot's funnel or onto the carpet. Aimed along the opening at `robot`'s intake when given.
   */
  dropCoral(a: Alliance, k: number, robot: Robot | null): boolean {
    const { pool, frame } = this.ctx;
    const i = pool.indices('reserve', `station:${a}`)[0];
    if (i === undefined) return false;
    const st = C.stations(a)[k];
    const t = { x: -Math.sin(st.yaw), y: Math.cos(st.yaw) };
    const p = this.chuteSpawn(a, k, robot);
    pool.placeWorld(i, frame.toWorld(p.x, p.y, p.z));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), frame.velToWorld(t.x, t.y, 0).normalize());
    pool.bodies[i].setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    return true;
  }

  /** Field-frame centre of a CORAL freshly placed at the top of station `k`'s CHUTE, aimed along the opening at `robot`'s intake. */
  private chuteSpawn(a: Alliance, k: number, robot: Robot | null) {
    const st = C.stations(a)[k];
    const t = { x: -Math.sin(st.yaw), y: Math.cos(st.yaw) };
    let along = 0;
    if (robot) {
      // Aim at the robot's funnel side (or its ground-intake face).
      const side = robot.config.intake.station ? stationSideSign(robot.config) : groundSideSign(robot.config);
      const d = robot.footprint.length / 2 * side;
      const fx = robot.pose.x + Math.cos(robot.pose.yaw) * d, fy = robot.pose.y + Math.sin(robot.pose.yaw) * d;
      along = clamp((fx - st.x) * t.x + (fy - st.y) * t.y, -C.STATION_MOUTH_WIDTH / 2 + C.CORAL_LENGTH / 2 + 0.03, C.STATION_MOUTH_WIDTH / 2 - C.CORAL_LENGTH / 2 - 0.03);
    }
    const top = C.chutePoint(st, along, C.CHUTE_LIP + C.CHUTE_LENGTH - 0.12);
    const n = { x: Math.cos(st.yaw) * Math.sin(C.CHUTE_ANGLE), y: Math.sin(st.yaw) * Math.sin(C.CHUTE_ANGLE), z: Math.cos(C.CHUTE_ANGLE) };
    const r = C.CORAL_RADIUS + 0.004;
    return { x: top.x + n.x * r, y: top.y + n.y * r, z: top.z + n.z * r };
  }

  private throwAlgae(a: Alliance, verbose = false): void {
    const { pool, frame } = this.ctx;
    if (this.isAuto()) { if (verbose) this.ctx.toast('Human players throw ALGAE only in TELEOP', 'info', a); return; }
    const i = pool.indices('reserve', `hp:${a}`)[0];
    if (i === undefined) { if (verbose) this.ctx.toast('No PROCESSOR ALGAE to throw yet', 'info', a); return; }
    const source = C.processor(opponent(a)), n = C.netCenter(a);
    const from = frame.toWorld(source.x, source.y + (source.y === 0 ? 0.08 : -0.08), 1.6);
    const to = frame.toWorld(n.x, n.y, C.NET_HEIGHT + C.ALGAE_RADIUS + 0.02);
    const flight = 1.35;
    pool.placeWorld(i, from, new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y + 4.905 * flight * flight) / flight, (to.z - from.z) / flight));
  }

  private wantsCoral(r: Robot): boolean {
    return r.lastCommand.intake && !!r.config.intake.primary && r.config.intake.enabled && this.held(r, false) === undefined && r.capacityLeft > 0 && !r.isClimbing;
  }

  /** The robot's climber hangs from cages of its own type; the preselected depth comes from its menu choice. */
  climberDepth(robot: Robot): C.CageDepth | null {
    return robot.config.climber.maxLevel === 1 ? 'shallow' : robot.config.climber.maxLevel >= 2 ? 'deep' : null;
  }

  /** Approach poses for every alliance cage matching this climber (slot = cage index), free or not. */
  cageApproaches(robot: Robot): { slot: number; x: number; y: number; yaw: number; occupied: boolean }[] {
    const depth = this.climberDepth(robot), yaw = C.sideYaw(robot.alliance, 0);
    return this.refs.cages[robot.alliance].flatMap((cage, slot) => {
      if (this.refs.cageDepth[robot.alliance][slot] !== depth) return [];
      const p = cage.fieldPosition(), reach = this.gripReach(robot);
      const occupied = this.ctx.robots.some((r) => r !== robot && r.alliance === robot.alliance && r.isClimbing && r.climbSlot === slot);
      return [{ slot, x: p.x - Math.cos(yaw) * reach, y: p.y - Math.sin(yaw) * reach, yaw, occupied }];
    });
  }

  /** Plan a physical approach to the closest unoccupied cage matching this climber. */
  climbApproach(robot: Robot): { x: number; y: number; yaw: number } | null {
    const depth = this.climberDepth(robot), yaw = C.sideYaw(robot.alliance, 0);
    const options = this.refs.cages[robot.alliance].flatMap((cage, slot) => {
      if (this.refs.cageDepth[robot.alliance][slot] !== depth || this.ctx.robots.some((r) => r !== robot && r.alliance === robot.alliance && r.isClimbing && r.climbSlot === slot)) return [];
      const p = cage.fieldPosition(), reach = this.gripReach(robot);
      return [{ x: p.x - Math.cos(yaw) * reach, y: p.y - Math.sin(yaw) * reach, yaw }];
    });
    options.sort((a, b) => Math.hypot(a.x - robot.pose.x, a.y - robot.pose.y) - Math.hypot(b.x - robot.pose.x, b.y - robot.pose.y));
    return options[0] ?? null;
  }

  /** §6.5.2: CAGE points come from any one of the alliance's three cages, not only the driver station's. */
  climbableCage(robot: Robot): { slot: number; depth: C.CageDepth; occupied: boolean } | null {
    const want = this.climberDepth(robot);
    if (!want) return null;
    let best: { slot: number; depth: C.CageDepth; occupied: boolean; d: number } | null = null;
    for (let slot = 0; slot < 3; slot++) {
      const depth = this.refs.cageDepth[robot.alliance][slot];
      const p = this.refs.cages[robot.alliance][slot].fieldPosition(); // wherever it has swung to
      const d = Math.hypot(robot.pose.x - p.x, robot.pose.y - p.y);
      if (depth !== want || d > 1.25 || (best && best.d <= d)) continue;
      const occupied = this.ctx.robots.some((r) => r !== robot && r.alliance === robot.alliance && r.climbSlot === slot && r.isClimbing);
      best = { slot, depth, occupied, d };
    }
    return best;
  }

  requestClimb(robot: Robot, _level: number): void {
    if (this.ctx.clock.mode !== 'teleop') { this.tell(robot, 'CAGE climbing is available during TELEOP'); return; }
    const want = this.climberDepth(robot);
    if (!want) return;
    const cage = this.climbableCage(robot);
    if (!cage) { this.tell(robot, `Drive to one of your alliance's ${want.toUpperCase()} cages in your BARGE ZONE`); return; }
    if (cage.occupied) { this.tell(robot, 'CAGE already occupied · try another of your cages'); return; }
    const p = C.cage(robot.alliance, cage.slot + 1);
    const yaw = C.sideYaw(robot.alliance, 0);
    // Chassis height when hanging: a shallow climb only needs to clear the carpet; a deep climb pulls higher.
    const lift = cage.depth === 'shallow' ? 0.15 : 0.28;
    // The climber grabs the cage where it hangs (swung or not), then robot and cage settle plumb under
    // the pivot with the cage just ahead of the front bumper.
    const reach = this.gripReach(robot);
    robot.startClimb({ x: p.x - Math.cos(yaw) * reach, y: p.y, yaw }, lift, cage.depth === 'shallow' ? 1 : 2, cage.slot);
    this.grips.push({ robot, alliance: robot.alliance, slot: cage.slot, from: this.refs.cages[robot.alliance][cage.slot].fieldPosition(), t: 0 });
  }
  private gripReach(robot: Robot): number { return robot.footprint.length / 2 + C.CAGE_SIZE / 2 + 0.02; }

  /** Held cages follow their climbing robot; a cage is released to swing once its robot is back down. */
  private updateGrips(dt: number): void {
    for (let k = this.grips.length - 1; k >= 0; k--) {
      const g = this.grips[k], cage = this.refs.cages[g.alliance][g.slot];
      if (!g.robot.isClimbing || g.robot.climbSlot !== g.slot) { cage.release(); this.grips.splice(k, 1); continue; }
      g.t += dt;
      const blend = clamp(g.t / 0.6, 0, 1), reach = this.gripReach(g.robot), p = g.robot.pose;
      const rest = C.CAGE_BOTTOM[this.refs.cageDepth[g.alliance][g.slot]];
      const tx = p.x + Math.cos(p.yaw) * reach, ty = p.y + Math.sin(p.yaw) * reach;
      cage.hold(g.from.x + (tx - g.from.x) * blend, g.from.y + (ty - g.from.y) * blend, g.from.z + (rest - g.from.z) * blend);
    }
  }
  requestDescend(robot: Robot): void { robot.startDescend(); }

  private enforceDefenders(dt: number): void {
    // G421 is a ROBOT rule for the whole MATCH, not only TELEOP.
    if (this.ctx.clock.mode === 'disabled') return;
    for (const a of ALLIANCES) {
      const defenders = this.ctx.robots.filter((r) => r.alliance === a && this.beyondBarge(r));
      if (defenders.length < 2) { this.defenderTime[a] = 0; continue; }
      const old = this.defenderTime[a]; this.defenderTime[a] += dt;
      if (old === 0 || Math.floor(old / 3) < Math.floor(this.defenderTime[a] / 3)) {
        this.ref.call({ rule: 'G421', kind: old === 0 ? 'minor' : 'major', robot: defenders[1], note: 'was a second defender beyond the BARGE ZONES' });
      }
    }
  }
  /** G426: two or more partners walling off the opponent's CAGES from a climber that is trying to get to them. */
  private enforceBlockade(dt: number): void {
    if (this.ctx.clock.current.id !== 'endgame') return;
    for (const a of ALLIANCES) {
      const opp = opponent(a), c = C.cage(opp, 2);
      this.ref.blockAccess(dt, `cage:${opp}`, a, c, `blocked ${opp.toUpperCase()}'s CAGES`, { wall: 3.2, want: 4.5, min: 1.2 });
    }
  }

  /** Bumpers completely on the opponent's side of both BARGE ZONES (G403/G421). */
  private beyondBarge(r: Robot): boolean {
    return r.corners().every((p) => r.alliance === 'blue' ? p.x > C.FIELD_LENGTH / 2 + C.BARGE_ZONE_DEPTH / 2 : p.x < C.FIELD_LENGTH / 2 - C.BARGE_ZONE_DEPTH / 2);
  }

  /** Real collider contact between a robot (including its raised elevator) and a swinging cage. */
  private touchesCage(r: Robot, a: Alliance, slot: number): boolean {
    let contact = false;
    for (const cageCollider of this.refs.cages[a][slot].colliders) for (let i = 0; i < r.body.numColliders() && !contact; i++) {
      this.ctx.physics.world.contactPair(r.body.collider(i), cageCollider, (manifold) => { if (manifold.numContacts() > 0) contact = true; });
    }
    return contact;
  }

  private enforceCageContact(): void {
    for (const r of this.ctx.robots) for (let s = 1; s <= 3; s++) {
      const contact = this.touchesCage(r, opponent(r.alliance), s - 1);
      const key = `${r.id}:${s}`;
      if (contact && !this.cageContacts.has(key) && this.ctx.clock.mode !== 'disabled') {
        const auto = this.ctx.clock.mode === 'auto';
        this.ref.call({ rule: auto ? 'G405' : 'G418', kind: 'major', robot: r, note: `contacted ${opponent(r.alliance).toUpperCase()}'s CAGE` });
        if (!auto) this.forcedBarge[opponent(r.alliance)] = true;
      }
      if (contact) this.cageContacts.add(key); else this.cageContacts.delete(key);
    }
  }

  private enforceProtectedContact(): void {
    if (this.ctx.clock.mode === 'disabled') return;
    const live = new Set<string>();
    for (const r of this.ctx.robots) for (const other of this.ctx.robots) {
      if (r.alliance === other.alliance) continue;
      const contact = this.ref.touching(r, other); // direct, or through a game piece both are touching
      if (!contact) continue;
      let rule: string | null = null;
      if (this.ctx.clock.mode === 'auto' && this.beyondBarge(r)) rule = 'G403';
      else if (this.ctx.clock.current.id === 'endgame' && ['rise', 'hanging'].includes(other.climbPhase)) { rule = 'G428'; this.forcedBarge[other.alliance] = true; }
      else if (this.inBargeZone(other) || C.inReefZone(other.alliance, other.pose, other.footprint.length, other.footprint.width)) rule = 'G427';
      if (!rule) continue;
      const key = `${r.id}:${other.id}:${rule}`; live.add(key);
      if (!this.protectedContacts.has(key)) {
        // G403: MAJOR FOUL and VERBAL WARNING, YELLOW CARD for any subsequent violation during the event.
        const again = rule === 'G403' && this.ctx.score.fouls.some((f) => f.robotId === r.id && f.rule === 'G403');
        this.ref.call({ rule, kind: 'major', robot: r, ...(again ? { card: 'yellow' as const } : {}), note: `contacted ${other.config.teamNumber}${rule === 'G403' ? ' across the BARGE ZONE in AUTO' : rule === 'G428' ? ' at its CAGE' : ' in its protected ZONE'}` });
      }
    }
    this.protectedContacts.clear(); for (const key of live) this.protectedContacts.add(key);
  }

  updateVisuals(dt: number, time: number): void {
    const { pool, frame, score } = this.ctx;
    for (const a of ALLIANCES) {
      for (let f = 0; f < 6; f++) this.refs.algae[a][f].visible = this.reefAlgae(a, f);
      this.refs.algaeColliders[a].forEach((c, f) => c.setEnabled(this.reefAlgae(a, f)));
      for (const [i, light] of this.refs.lights[a].entries()) {
        const coop = score.counter('blue', 'processor') >= 2 && score.counter('red', 'processor') >= 2;
        const flash = this.ctx.clock.current.id === 'endgame' && Math.sin(time * 9) > 0;
        (light.material as THREE.MeshStandardMaterial).emissiveIntensity = flash || coop || score.counter(a, 'processor') > i ? 2.5 : 0.15;
      }
    }
    for (const a of ALLIANCES) for (const cage of this.refs.cages[a]) cage.syncVisual(dt);
    const up = new THREE.Vector3(0, 1, 0);
    for (const robot of this.ctx.robots) {
      const m = this.mechanisms.get(robot.id)!;
      // Replica clients also predict driving against the raised elevator and barge.
      this.updateElevatorCollider(robot, m.height);
      const carriage = this.carriages.get(robot.id)!;
      carriage.position.y = m.height;
      // The generic end effector reaches along the scoring direction (yawed out to the side for side scorers).
      carriage.rotation.y = m.side * Math.PI / 2;
      const arm = carriage.getObjectByName('end-effector-arm')!;
      arm.scale.x = Math.max(0.05, m.forward - 0.12);
      arm.position.x = 0.12 + arm.scale.x / 2;
      arm.position.y = 0.09;
      for (const rail of this.masts.get(robot.id)!) {
        const height = Math.max(robot.config.height, m.height + 0.15);
        rail.scale.y = (height - 0.2) / (robot.config.height - 0.2);
        rail.position.y = height / 2 + 0.1;
        rail.visible = !robot.modelReplaces('mast');
      }
      // Team models (254's elevator, 2910's telescoping arm…) draw their own mast and follow the end effector.
      arm.visible = !robot.modelReplaces('mast');
      robot.placeAnim = { height: m.height, forward: m.forward, level: m.level, side: m.side, handoff: m.handoff };
      const held = this.heldVisuals.get(robot.id)!;
      held.coral.visible = pool.owner.some((owner, i) => owner === robot.id && pool.state[i] === 'held' && i < C.CORAL_COUNT);
      held.algae.visible = pool.owner.some((owner, i) => owner === robot.id && pool.state[i] === 'held' && i >= C.CORAL_COUNT);
      // Held CORAL sits in the end effector the way it will leave: nose-down 35° (L2/L3), vertical (L4), sideways (L1),
      // pointing out of the scoring side (carriage frame, which is yawed with the scoring direction).
      held.coral.position.set(m.forward, 0, 0);
      const dir = m.level === 4 ? new THREE.Vector3(0, -1, 0) : m.level === 1 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(Math.cos(C.BRANCH_ANGLE), -Math.sin(C.BRANCH_ANGLE), 0);
      held.coral.quaternion.setFromUnitVectors(up, dir);
      // A team model with its own end effector holds the pieces there (same orientation relative to the robot).
      const anchor = robot.modelHeldAnchor;
      if (anchor) {
        if (held.coral.parent !== anchor) anchor.add(held.coral, held.algae);
        robot.visual.updateMatrixWorld(true);
        const inv = anchor.getWorldQuaternion(this.tmpQ).invert().multiply(robot.visual.quaternion);
        held.coral.position.set(0, 0, 0);
        held.coral.quaternion.premultiply(this.tmpQ2.setFromAxisAngle(up, m.side * Math.PI / 2)).premultiply(inv);
        held.algae.position.set(0.05, -0.14, 0);
      } else if (held.coral.parent !== carriage) carriage.add(held.coral);
      if (m.handoff > 0 && held.coral.visible) this.animateHandoff(robot, held.coral, m.handoff);
    }
    for (const mesh of this.scoredVisuals.values()) mesh.visible = false;
    for (let i = C.CORAL_COUNT; i < pool.count; i++) {
      const tag = pool.tag[i];
      if (pool.state[i] !== 'reserve' || !tag?.startsWith('net:')) continue;
      const [, a, count] = tag.split(':'); const n = C.netCenter(a as Alliance), k = Number(count) - 1;
      const mesh = this.scoredMesh(i, true); mesh.visible = true;
      mesh.position.copy(frame.toWorld(n.x + ((k % 2) - 0.5) * 0.43, n.y - 1.4 + Math.floor(k / 2) * 0.43, C.NET_HEIGHT + C.ALGAE_RADIUS));
    }
  }
  /**
   * Handoff animation: the CORAL rides the ground intake as it folds in (first half), then transfers into the end
   * effector (second half), turning from lying across the intake to the end effector's hold. Drawn in the robot frame
   * from the team model's intake / end effector anchors, or the generic intake rollers and carriage.
   */
  private animateHandoff(robot: Robot, coral: THREE.Mesh, t: number): void {
    const visual = robot.visual;
    visual.updateMatrixWorld(true);
    // Where the end effector will hold it (the pose computed above), in the robot frame.
    const endPos = visual.worldToLocal(coral.getWorldPosition(this.tmpV.set(0, 0, 0))).clone();
    const endQ = visual.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(coral.getWorldQuaternion(new THREE.Quaternion()));
    const side = groundSideSign(robot.config), L = robot.footprint.length;
    const intake = robot.modelIntakeAnchor;
    const mouth = new THREE.Vector3(side * (L / 2 + 0.08), 0.1, 0);
    const stowed = intake ? visual.worldToLocal(intake.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(side * (L / 2 - 0.12), robot.config.bumperTop + 0.12, 0);
    const across = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    const a = clamp(t / 0.5, 0, 1), b = clamp((t - 0.5) / 0.5, 0, 1);
    const ease = (x: number) => x * x * (3 - 2 * x);
    // A model's intake anchor already folds in with the intake; the generic intake is fixed, so slide up it.
    const onIntake = intake ? stowed : mouth.lerp(stowed, ease(a));
    if (coral.parent !== visual) visual.add(coral);
    coral.position.copy(onIntake.lerp(endPos, ease(b)));
    coral.position.y += Math.sin(Math.PI * b) * 0.06; // small lift as it clears the bumper / end effector lip
    coral.quaternion.copy(across).slerp(endQ, ease(b));
  }

  private scoredMesh(i: number, algae: boolean): THREE.Mesh {
    let mesh = this.scoredVisuals.get(i);
    if (!mesh) { mesh = new THREE.Mesh(algae ? this.algaeGeo : this.coralGeo, algae ? this.algaeMat : this.coralMat); mesh.castShadow = true; this.refs.scored.add(mesh); this.scoredVisuals.set(i, mesh); }
    return mesh;
  }
  results(): MatchResults {
    return reefscapeResults(this.ctx.score, { blue: this.ctx.robots.filter((r) => r.alliance === 'blue').length, red: this.ctx.robots.filter((r) => r.alliance === 'red').length }, this.forcedBarge);
  }
  netState(): ReefscapeNetState { return { placements: this.placements.map((p) => ({ ...p })), mechanisms: [...this.mechanisms].map(([id, m]) => [id, { ...m }]), forcedBarge: { ...this.forcedBarge },
    cages: ALLIANCES.flatMap((a) => this.refs.cages[a].map((c) => c.netState())) }; }
  applyNetState(state: unknown): void {
    const s = state as ReefscapeNetState;
    this.placements.splice(0, this.placements.length, ...s.placements);
    for (const [id, m] of s.mechanisms) this.mechanisms.set(id, { ...m });
    this.forcedBarge = { ...s.forcedBarge };
    ALLIANCES.flatMap((a) => this.refs.cages[a]).forEach((c, k) => s.cages?.[k] && c.applyNetState(s.cages[k]));
  }
}

/** Closest distance between a CORAL axis segment (center c, unit axis u, half-length h) and a BRANCH segment p0 + t·d. */
function segmentDistance(c: { x: number; y: number; z: number }, u: { x: number; y: number; z: number }, h: number, p0: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }): number {
  let best = Infinity;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const q = { x: p0.x + d.x * t, y: p0.y + d.y * t, z: p0.z + d.z * t };
    const w = { x: q.x - c.x, y: q.y - c.y, z: q.z - c.z };
    const along = w.x * u.x + w.y * u.y + w.z * u.z;
    if (Math.abs(along) > h) continue; // only the part of the BRANCH within the CORAL's length
    best = Math.min(best, Math.hypot(w.x - u.x * along, w.y - u.y * along, w.z - u.z * along));
  }
  return best;
}
