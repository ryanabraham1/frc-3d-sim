import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ALLIANCES, opponent, type Alliance } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import type { AimTarget, Robot, RobotCommand } from '@engine/robot/robot';
import { clamp, inch, wrapAngle } from '@engine/units';
import * as C from './constants';
import { coralGeometry, type ReefscapeFieldRefs } from './field';
import { coralPoints, reefscapeResults } from './scoring';

export interface CoralPlacement { i: number; alliance: Alliance; level: number; face: number; branch: number; auto: boolean }
interface MechanismState { height: number; level: number; harvest: number }
export interface ReefscapeNetState {
  placements: CoralPlacement[];
  mechanisms: [number, MechanismState][];
  hp: Record<Alliance, boolean>;
  forcedBarge: Record<Alliance, boolean>;
}

export class ReefscapeRules implements SeasonRules {
  readonly handlesIntake = true;
  readonly placements: CoralPlacement[] = [];
  readonly mechanisms = new Map<number, MechanismState>();
  private readonly carriages = new Map<number, THREE.Group>();
  private readonly masts = new Map<number, THREE.Mesh[]>();
  private readonly elevatorColliders = new Map<number, RAPIER.Collider>();
  private readonly heldVisuals = new Map<number, { coral: THREE.Mesh; algae: THREE.Mesh }>();
  private readonly scoredVisuals = new Map<number, THREE.Mesh>();
  private hp: Record<Alliance, boolean> = { blue: true, red: true };
  private hpTimer: Record<Alliance, number> = { blue: 0, red: 0 };
  private defenderTime: Record<Alliance, number> = { blue: 0, red: 0 };
  private forcedBarge: Record<Alliance, boolean> = { blue: false, red: false };
  private readonly cageContacts = new Set<string>();
  private readonly protectedContacts = new Set<string>();
  private readonly notices = new Map<number, number>();
  private readonly launchedBy = new Map<number, { robotId: number; at: number }>();
  private autoAssessed = false;
  private bargeAssessed = false;
  private readonly autoBranches = new Set<string>();
  private readonly removedAutoTrough: Record<Alliance, number> = { blue: 0, red: 0 };
  private readonly coralGeo = coralGeometry();
  private readonly algaeGeo = new THREE.SphereGeometry(C.ALGAE_RADIUS, 18, 12);
  private readonly coralMat = new THREE.MeshStandardMaterial({ color: C.COLORS.coral, roughness: 0.65, side: THREE.DoubleSide });
  private readonly algaeMat = new THREE.MeshStandardMaterial({ color: C.COLORS.algae, roughness: 0.7 });

  constructor(readonly ctx: SeasonContext, readonly refs: ReefscapeFieldRefs) {
    for (const robot of ctx.robots) {
      this.mechanisms.set(robot.id, { height: 0.45, level: robot.config.placement!.maxLevel, harvest: 0 });
      const mast = new THREE.Group(); mast.name = 'reefscape-elevator';
      const rails: THREE.Mesh[] = [];
      const alu = new THREE.MeshStandardMaterial({ color: 0xbdc6d0, metalness: 0.7, roughness: 0.4 });
      for (const z of [-0.13, 0.13]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, robot.config.height - 0.2, 0.035), alu);
        rail.position.set(0.15, robot.config.height / 2 + 0.1, z); mast.add(rail); rails.push(rail);
      }
      const carriage = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.10, 0.36), alu);
      beam.position.x = 0.24; carriage.add(beam);
      const coral = new THREE.Mesh(this.coralGeo, this.coralMat); coral.rotation.z = Math.PI / 2; coral.position.x = 0.46;
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
    this.placements.length = 0; this.autoBranches.clear(); this.launchedBy.clear(); this.cageContacts.clear(); this.protectedContacts.clear();
    this.autoAssessed = this.bargeAssessed = false;
    this.removedAutoTrough.blue = this.removedAutoTrough.red = 0;
    this.hp = { blue: true, red: true }; this.hpTimer = { blue: 0, red: 0 };
    this.defenderTime = { blue: 0, red: 0 }; this.forcedBarge = { blue: false, red: false };
    for (let i = 0; i < pool.count; i++) pool.reserve(i);
    for (const r of robots) r.held.length = 0;
    // 63 CORAL per alliance: 3 marks, up to 3 preloads, all remaining in its stations.
    for (const [ai, a] of ALLIANCES.entries()) {
      const base = ai * 63;
      for (let k = 0; k < 3; k++) {
        const p = C.side(a, 1.65, C.REEF_Y + (k - 1) * 1.8);
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

  /** Nearest branch on the approached face. Occupied or algae-blocked branches cannot receive CORAL. */
  placementTarget(robot: Robot, level: number): { face: number; branch: number; point: ReturnType<typeof C.branchPoint> } | null {
    if (!robot.config.placement!.enabled || level > robot.config.placement!.maxLevel) return null;
    const face = C.nearestFace(robot.alliance, robot.pose);
    if (level > 1 && level === (face % 2 === 0 ? 3 : 2) && this.reefAlgae(robot.alliance, face)) return null;
    const branches = [0, 1].filter((branch) => level === 1 || !this.placements.some((p) => p.alliance === robot.alliance && p.level === level && p.face === face && p.branch === branch));
    branches.sort((x, y) => {
      const px = C.branchPoint(robot.alliance, face, x, level), py = C.branchPoint(robot.alliance, face, y, level);
      return Math.hypot(px.x - robot.pose.x, px.y - robot.pose.y) - Math.hypot(py.x - robot.pose.x, py.y - robot.pose.y);
    });
    if (!branches.length) return null;
    return { face, branch: branches[0], point: C.branchPoint(robot.alliance, face, branches[0], level) };
  }

  handleMechanisms(robot: Robot, cmd: RobotCommand, dt: number): boolean {
    const m = this.mechanisms.get(robot.id)!;
    const mechanism = robot.config.placement!;
    m.level = Math.round(clamp(cmd.scoringLevel ?? m.level, 1, mechanism.maxLevel));
    const target = this.placementTarget(robot, m.level);
    let desiredHeight = this.held(robot, false) !== undefined || cmd.descend ? C.LEVEL_HEIGHTS[m.level] : 0.45;
    // ALGAE is neutral: it can be collected from either reef (G410 protects only opponent CORAL).
    const harvestAlliance = ALLIANCES.reduce((nearest, a) => {
      const p = C.reefCenter(a), q = C.reefCenter(nearest);
      return Math.hypot(p.x - robot.pose.x, p.y - robot.pose.y) < Math.hypot(q.x - robot.pose.x, q.y - robot.pose.y) ? a : nearest;
    }, robot.alliance);
    const face = C.nearestFace(harvestAlliance, robot.pose);
    const reef = C.reefCenter(harvestAlliance);
    const nearReef = Math.hypot(robot.pose.x - reef.x, robot.pose.y - reef.y) < C.REEF_APOTHEM - 0.07 + robot.config.frameLength / 2 + mechanism.reach + C.ALGAE_RADIUS;
    const harvest = cmd.intake && !cmd.shoot && robot.config.intake.secondary && (face % 2 === 0 ? 3 : 2) <= mechanism.maxLevel && this.held(robot, true) === undefined && nearReef && this.reefAlgae(harvestAlliance, face);
    if (harvest) desiredHeight = C.LEVEL_HEIGHTS[face % 2 === 0 ? 3 : 2] + 0.08;
    m.height += clamp(desiredHeight - m.height, -mechanism.liftSpeed * dt, mechanism.liftSpeed * dt);
    this.updateElevatorCollider(robot, m.height);
    if (robot.isClimbing) return true;
    if (harvest && robot.config.intake.enabled && robot.capacityLeft > 0 && Math.abs(m.height - desiredHeight) < 0.06) {
      m.harvest += dt;
      if (m.harvest >= mechanism.harvestSeconds) {
        const i = this.algaeIndex(harvestAlliance, face);
        this.ctx.pool.hold(i, robot.id); this.ctx.pool.tag[i] = null; robot.held.push(i); m.harvest = 0;
        this.ctx.toast('ALGAE removed · branch level cleared', 'good', robot.alliance, robot);
      }
    } else m.harvest = 0;
    if (cmd.intake && robot.config.intake.enabled) this.intake(robot);
    if (cmd.descend && mechanism.enabled && robot.config.intake.primary && !robot.isClimbing && this.held(robot, false) === undefined && robot.capacityLeft > 0 && Math.abs(m.height - desiredHeight) < 0.06) this.retrieveCoral(robot, m.level);
    const coral = this.held(robot, false), algae = this.held(robot, true);
    if (cmd.shoot && coral !== undefined && robot.fireCooldown <= 0) {
      if (!mechanism.enabled) { this.tell(robot, 'CORAL scorer disabled in robot setup · G ejects held CORAL'); return true; }
      if (!target) { this.tell(robot, 'Branch occupied or blocked by ALGAE · choose another level or face'); return true; }
      const dist = Math.hypot(target.point.x - robot.pose.x, target.point.y - robot.pose.y);
      const reach = this.coralReach(robot);
      const toward = Math.atan2(target.point.y - robot.pose.y, target.point.x - robot.pose.x);
      if (dist > reach || !C.inReefZone(robot.alliance, robot.pose, robot.footprint.length, robot.footprint.width)) { this.tell(robot, 'Drive closer to your REEF · elevator places within reach'); return true; }
      if ((robot.config.aimAssist !== 'full' || !robot.config.launcher.turret) && Math.abs(wrapAngle(robot.pose.yaw - toward)) > 0.40) { this.tell(robot, 'Face the selected branch to place CORAL'); return true; }
      if (Math.abs(m.height - desiredHeight) > 0.06) return true;
      this.placeCoral(robot, coral, m.level, target.face, target.branch);
    } else if (algae !== undefined && robot.fireCooldown <= 0 && (cmd.pass || cmd.shoot)) {
      if (cmd.pass && robot.config.processor!.enabled) this.feedProcessor(robot, algae);
      else if (cmd.shoot && robot.config.launcher.enabled) this.shootAlgae(robot, algae);
      else this.tell(robot, cmd.pass ? 'PROCESSOR feeder disabled in robot setup' : 'ALGAE net shooter disabled in robot setup');
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

  private updateElevatorCollider(robot: Robot, height: number): void {
    const mastHeight = Math.max(robot.config.height, height + 0.15);
    const collider = this.elevatorColliders.get(robot.id)!;
    collider.setHalfExtents({ x: 0.025, y: (mastHeight - 0.2) / 2, z: 0.17 });
    collider.setTranslationWrtParent({ x: 0.15, y: mastHeight / 2 + 0.1, z: 0 });
    collider.setEnabled(!robot.isClimbing);
  }

  private release(robot: Robot, i: number): void { robot.held.splice(robot.held.indexOf(i), 1); }
  coralReach(robot: Robot): number { return robot.config.frameLength / 2 + robot.config.placement!.reach + C.CORAL_LENGTH / 2; }
  private intake(robot: Robot): void {
    const { pool } = this.ctx;
    for (let i = 0; i < pool.count; i++) {
      if (i < C.CORAL_COUNT ? !robot.config.intake.primary : !robot.config.intake.secondary) continue;
      if (pool.state[i] !== 'field' || robot.capacityLeft <= 0 || this.held(robot, i >= C.CORAL_COUNT) !== undefined) continue;
      const launched = this.launchedBy.get(i);
      if (launched?.robotId === robot.id && this.ctx.clock.elapsed - launched.at < 0.65) continue;
      const p = pool.position(i);
      if (p.y > (i >= C.CORAL_COUNT ? 0.65 : 0.42)) continue;
      if (robot.intakeContains(p, pool.radiusAt(i))) { pool.hold(i, robot.id); robot.held.push(i); }
    }
  }

  placeCoral(robot: Robot, i: number, level: number, face: number, branch: number): void {
    if (!robot.config.placement!.enabled || level > robot.config.placement!.maxLevel) return;
    if (this.ctx.pool.state[i] !== 'held' || this.ctx.pool.owner[i] !== robot.id || i >= C.CORAL_COUNT) return;
    if (level > 1 && this.placements.some((p) => p.alliance === robot.alliance && p.level === level && p.face === face && p.branch === branch)) return;
    const key = `${robot.alliance}:${level}:${face}:${branch}`;
    const auto = this.isAuto() || (level > 1 && this.autoBranches.has(key)) || (level === 1 && this.removedAutoTrough[robot.alliance] > 0);
    if (level === 1 && !this.isAuto() && auto) this.removedAutoTrough[robot.alliance]--;
    this.release(robot, i);
    this.ctx.pool.reserve(i, 'scored-coral');
    this.placements.push({ i, alliance: robot.alliance, level, face, branch, auto });
    if (this.isAuto()) { this.ctx.score.inc(robot.alliance, 'autoCoral'); this.autoBranches.add(key); }
    this.ctx.score.inc(robot.alliance, `coralL${level}`);
    this.ctx.score.add(robot.alliance, auto ? 'autoCoral' : 'teleopCoral', coralPoints(level, auto), this.ctx.clock.elapsed);
    robot.fireCooldown = robot.config.placement!.cycleSeconds;
    this.ctx.toast(`CORAL L${level} · +${coralPoints(level, auto)}`, 'good', robot.alliance, robot);
  }

  private retrieveCoral(robot: Robot, level: number): void {
    const face = C.nearestFace(robot.alliance, robot.pose);
    const options = this.placements.filter((p) => p.alliance === robot.alliance && p.face === face && p.level === level);
    // L1 removes lower-valued TELEOP CORAL first, as required by §6.5.1.
    options.sort((x, y) => Number(x.auto) - Number(y.auto));
    const p = options[0];
    if (!p) return;
    const point = C.branchPoint(p.alliance, face, p.branch, level);
    if (Math.hypot(point.x - robot.pose.x, point.y - robot.pose.y) > this.coralReach(robot)) return;
    this.placements.splice(this.placements.indexOf(p), 1);
    this.ctx.score.inc(p.alliance, `coralL${level}`, -1);
    this.ctx.score.add(p.alliance, p.auto ? 'autoCoral' : 'teleopCoral', -coralPoints(level, p.auto));
    if (p.auto && level === 1) this.removedAutoTrough[p.alliance]++;
    this.ctx.pool.hold(p.i, robot.id); this.ctx.pool.tag[p.i] = null; robot.held.push(p.i);
    robot.fireCooldown = robot.config.placement!.cycleSeconds;
    this.ctx.toast(`CORAL retrieved from L${level} · score adjusted`, 'info', robot.alliance, robot);
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

  private shootAlgae(robot: Robot, i: number): void {
    const at = robot.held.indexOf(i); robot.held.splice(at, 1); robot.held.push(i);
    const shot = robot.launch(this.aimTarget(robot), this.ctx.rng);
    if (!shot) return;
    this.release(robot, i); this.ctx.pool.placeWorld(i, shot.pos, shot.vel); this.onLaunch(robot, i);
  }

  aimTarget(robot: Robot): AimTarget | null {
    const n = C.netCenter(robot.alliance);
    return { point: this.ctx.frame.toWorld(n.x, n.y, C.NET_HEIGHT + C.ALGAE_RADIUS + 0.015), clearRadius: C.NET_WIDTH / 2, clearHeight: C.NET_HEIGHT + 0.48 };
  }
  onLaunch(robot: Robot, i: number): void {
    this.launchedBy.set(i, { robotId: robot.id, at: this.ctx.clock.elapsed });
    if (i < C.CORAL_COUNT && !C.inReefZone(robot.alliance, robot.pose, robot.footprint.length, robot.footprint.width)) {
      this.ctx.score.foul({ t: this.ctx.clock.elapsed, alliance: robot.alliance, kind: 'major', rule: 'G412', robotId: robot.id });
    }
  }

  onPeriodChange(change: PeriodChange): void {
    if (change.from?.id === 'auto') this.assessLeave();
    if (!change.to) this.assessBarge();
  }
  private assessLeave(): void {
    if (this.autoAssessed) return;
    this.autoAssessed = true;
    for (const r of this.ctx.robots) {
      const line = r.alliance === 'blue' ? C.START_LINE : C.FIELD_LENGTH - C.START_LINE;
      const xs = r.corners().map((p) => p.x);
      if (Math.max(...xs) < line || Math.min(...xs) > line) { this.ctx.score.inc(r.alliance, 'leave'); this.ctx.score.add(r.alliance, 'leave', 3); }
    }
  }
  private assessBarge(): void {
    if (this.bargeAssessed) return;
    this.bargeAssessed = true;
    for (const a of ALLIANCES) {
      let points = 0;
      for (const r of this.ctx.robots.filter((r) => r.alliance === a)) {
        if (r.climbPhase === 'hanging' && r.elevation > 0.03) points += r.climbLevel === 1 ? 6 : 12;
        else if (this.inBargeZone(r)) points += 2;
      }
      this.ctx.score.set(a, 'barge', points);
    }
  }
  inBargeZone(robot: Robot): boolean {
    const corners = robot.corners();
    const ys = corners.map((p) => robot.alliance === 'blue' ? p.y : C.FIELD_WIDTH - p.y);
    const xs = corners.map((p) => p.x);
    return Math.min(...xs) <= C.FIELD_LENGTH / 2 + inch(46) / 2 && Math.max(...xs) >= C.FIELD_LENGTH / 2 - inch(46) / 2 && Math.max(...ys) >= C.FIELD_WIDTH / 2 + 0.1 && Math.min(...ys) <= C.FIELD_WIDTH / 2 + 0.1 + inch(146.5);
  }

  beforeStep(dt: number): void {
    if (!this.activeScoring()) return;
    for (const a of ALLIANCES) {
      this.hpTimer[a] -= dt;
      if (this.ctx.clock.mode !== 'disabled' && this.ctx.humanPlayerIsAuto(a) && this.hp[a] && this.hpTimer[a] <= 0) { this.supply(a); this.hpTimer[a] = 1.7; }
    }
    this.enforceDefenders(dt);
    this.enforceCageContact();
  }

  afterStep(_dt: number): void {
    if (!this.activeScoring()) return;
    this.enforceProtectedContact();
    const { pool, frame, score } = this.ctx;
    for (let i = C.CORAL_COUNT; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      for (const a of ALLIANCES) {
        const pr = C.processor(a);
        const pastWall = a === 'blue' ? p.y < 0.05 : p.y > C.FIELD_WIDTH - 0.05;
        if (pastWall && Math.abs(p.x - pr.x) < inch(14) - C.ALGAE_RADIUS * 0.5 && p.z > inch(7) + C.ALGAE_RADIUS * 0.75 && p.z < inch(27) - C.ALGAE_RADIUS * 0.5) {
          score.add(a, 'processor', 6, this.ctx.clock.elapsed); score.inc(a, 'processor');
          pool.reserve(i, `hp:${opponent(a)}`);
          this.ctx.toast(`${a.toUpperCase()} PROCESSOR · +6 · ALGAE delivered to ${opponent(a).toUpperCase()} human player`, 'good', a);
          break;
        }
        const n = C.netCenter(a);
        if (Math.abs(p.x - n.x) <= C.NET_WIDTH / 2 - C.ALGAE_RADIUS * 0.7 && Math.abs(p.y - n.y) <= C.NET_LENGTH / 2 - C.ALGAE_RADIUS * 0.7 && p.z >= C.NET_HEIGHT && p.z <= C.NET_HEIGHT + C.ALGAE_RADIUS + 0.08 && pool.velocity(i).y <= 0.3) {
          score.add(a, 'net', 4, this.ctx.clock.elapsed); const count = score.inc(a, 'net');
          pool.reserve(i, `net:${a}:${count}`); this.ctx.toast(`${a.toUpperCase()} NET · +4`, 'good', a); break;
        }
      }
    }
    // Accidental out-of-field pieces are safely returned (§6.9); preserve total supply.
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      if (p.x < -0.7 || p.x > C.FIELD_LENGTH + 0.7 || p.y < -0.7 || p.y > C.FIELD_WIDTH + 0.7 || p.z < -0.3) {
        pool.placeField(i, clamp(p.x, 0.7, C.FIELD_LENGTH - 0.7), clamp(p.y, 0.7, C.FIELD_WIDTH - 0.7));
      }
    }
  }

  humanPlayerAction(a: Alliance): void {
    if (this.ctx.clock.mode === 'disabled' || !this.activeScoring()) return;
    this.hp[a] = !this.hp[a]; this.supply(a); this.hpTimer[a] = 1.7;
    this.ctx.toast(`CORAL stations ${this.hp[a] ? 'OPEN' : 'CLOSED'} · human player acted`, 'info', a);
  }
  private supply(a: Alliance): void {
    const { pool, frame } = this.ctx;
    for (const station of C.stations(a)) {
      const waiting = pool.indices('field').filter((i) => i < C.CORAL_COUNT && Math.hypot(frame.toField(pool.position(i)).x - station.x, frame.toField(pool.position(i)).y - station.y) < 1.0).length;
      const i = pool.indices('reserve', `station:${a}`)[0];
      const nearby = this.ctx.robots.some((r) => r.alliance === a && Math.hypot(r.pose.x - station.x, r.pose.y - station.y) < 2.3);
      if (this.hp[a] && waiting < 2 && nearby && i !== undefined) {
        const toward = C.reefCenter(a), dx = toward.x - station.x, dy = toward.y - station.y, d = Math.hypot(dx, dy);
        pool.placeWorld(i, frame.toWorld(station.x, station.y, inch(37.5)), frame.velToWorld(dx / d * 0.6, dy / d * 0.6, 0));
      }
    }
    if (!this.isAuto()) {
      const i = pool.indices('reserve', `hp:${a}`)[0];
      if (i !== undefined) {
        const source = C.processor(opponent(a)), n = C.netCenter(a);
        const from = frame.toWorld(source.x, source.y + (source.y === 0 ? 0.08 : -0.08), 1.6);
        const to = frame.toWorld(n.x, n.y, C.NET_HEIGHT + C.ALGAE_RADIUS + 0.02);
        const flight = 1.35;
        pool.placeWorld(i, from, new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y + 4.905 * flight * flight) / flight, (to.z - from.z) / flight));
      }
    }
  }

  requestClimb(robot: Robot, _level: number): void {
    if (this.ctx.clock.mode !== 'teleop') { this.tell(robot, 'CAGE climbing is available during TELEOP'); return; }
    const level = Math.min(2, robot.config.climber.maxLevel);
    if (level === 0) return;
    const p = C.cage(robot.alliance, robot.station);
    if (Math.hypot(robot.pose.x - p.x, robot.pose.y - p.y) > 1.25) { this.tell(robot, 'Drive to the cage matching your driver station in your BARGE ZONE'); return; }
    if (this.ctx.robots.some((r) => r !== robot && r.alliance === robot.alliance && r.climbSlot === robot.station - 1 && r.isClimbing)) { this.tell(robot, 'CAGE already occupied'); return; }
    const yaw = C.sideYaw(robot.alliance, 0);
    const lift = level === 1 ? 0.88 : 0.28;
    // Place chassis beside the cage with climber engaging its pipes, below the anchor.
    robot.startClimb({ x: p.x - Math.cos(yaw) * robot.config.frameLength * 0.3, y: p.y, yaw }, lift, level, robot.station - 1);
  }
  requestDescend(robot: Robot): void { robot.startDescend(); }

  private enforceDefenders(dt: number): void {
    if (this.ctx.clock.mode !== 'teleop') return;
    for (const a of ALLIANCES) {
      const defenders = this.ctx.robots.filter((r) => r.alliance === a && r.corners().every((p) => a === 'blue' ? p.x > C.FIELD_LENGTH / 2 + inch(46) / 2 : p.x < C.FIELD_LENGTH / 2 - inch(46) / 2));
      if (defenders.length < 2) { this.defenderTime[a] = 0; continue; }
      const old = this.defenderTime[a]; this.defenderTime[a] += dt;
      if (old === 0 || Math.floor(old / 3) < Math.floor(this.defenderTime[a] / 3)) {
        this.ctx.score.foul({ t: this.ctx.clock.elapsed, alliance: a, kind: old === 0 ? 'minor' : 'major', rule: 'G421', robotId: defenders[1].id });
        this.ctx.toast('G421 · only one defender beyond the BARGE ZONES', 'foul', a);
      }
    }
  }
  private enforceCageContact(): void {
    for (const r of this.ctx.robots) for (let s = 1; s <= 3; s++) {
      const p = C.cage(opponent(r.alliance), s);
      const shallow = this.ctx.robots.find((o) => o.alliance !== r.alliance && o.station === s)?.config.climber.maxLevel === 1;
      if (shallow && r.config.height < C.CAGE_BOTTOM.shallow) continue;
      const dx = p.x - r.pose.x, dy = p.y - r.pose.y, yaw = r.pose.yaw;
      const contact = Math.abs(dx * Math.cos(yaw) + dy * Math.sin(yaw)) < r.footprint.length / 2 + inch(7.375) / 2 && Math.abs(-dx * Math.sin(yaw) + dy * Math.cos(yaw)) < r.footprint.width / 2 + inch(7.375) / 2;
      const key = `${r.id}:${s}`;
      if (contact && !this.cageContacts.has(key) && this.ctx.clock.mode !== 'disabled') {
        const auto = this.ctx.clock.mode === 'auto';
        this.ctx.score.foul({ t: this.ctx.clock.elapsed, alliance: r.alliance, kind: 'major', rule: auto ? 'G405' : 'G418', robotId: r.id });
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
      let contact = false;
      for (let i = 0; i < r.body.numColliders() && !contact; i++) for (let j = 0; j < other.body.numColliders() && !contact; j++) {
        this.ctx.physics.world.contactPair(r.body.collider(i), other.body.collider(j), (manifold) => { if (manifold.numContacts() > 0) contact = true; });
      }
      if (!contact) continue;
      let rule: string | null = null;
      const across = r.corners().every((p) => r.alliance === 'blue' ? p.x > C.FIELD_LENGTH / 2 + inch(46) / 2 : p.x < C.FIELD_LENGTH / 2 - inch(46) / 2);
      if (this.ctx.clock.mode === 'auto' && across) rule = 'G403';
      else if (this.ctx.clock.current.id === 'endgame' && ['rise', 'hanging'].includes(other.climbPhase)) { rule = 'G428'; this.forcedBarge[other.alliance] = true; }
      else if (this.inBargeZone(other) || C.inReefZone(other.alliance, other.pose, other.footprint.length, other.footprint.width)) rule = 'G427';
      if (!rule) continue;
      const key = `${r.id}:${other.id}:${rule}`; live.add(key);
      if (!this.protectedContacts.has(key)) {
        this.ctx.score.foul({ t: this.ctx.clock.elapsed, alliance: r.alliance, kind: 'major', rule, robotId: r.id });
        this.ctx.toast(`${rule} · protected opponent contact · +6 to ${other.alliance.toUpperCase()}`, 'foul', r.alliance);
      }
    }
    this.protectedContacts.clear(); for (const key of live) this.protectedContacts.add(key);
  }

  updateVisuals(_dt: number, time: number): void {
    const { pool, frame, score } = this.ctx;
    for (const a of ALLIANCES) {
      for (let f = 0; f < 6; f++) this.refs.algae[a][f].visible = this.reefAlgae(a, f);
      for (const [i, light] of this.refs.lights[a].entries()) {
        const coop = score.counter('blue', 'processor') >= 2 && score.counter('red', 'processor') >= 2;
        const flash = this.ctx.clock.current.id === 'endgame' && Math.sin(time * 9) > 0;
        (light.material as THREE.MeshStandardMaterial).emissiveIntensity = flash || coop || score.counter(a, 'processor') > i ? 2.5 : 0.15;
      }
    }
    for (const robot of this.ctx.robots) {
      const m = this.mechanisms.get(robot.id)!;
      // Replica clients also predict driving against the raised elevator and barge.
      this.updateElevatorCollider(robot, m.height);
      this.carriages.get(robot.id)!.position.y = m.height;
      if (robot.config.aimAssist === 'full' && robot.config.launcher.turret && pool.owner.some((owner, i) => owner === robot.id && pool.state[i] === 'held' && i < C.CORAL_COUNT)) {
        const center = C.reefCenter(robot.alliance);
        this.carriages.get(robot.id)!.rotation.y = wrapAngle(Math.atan2(center.y - robot.pose.y, center.x - robot.pose.x) - robot.pose.yaw);
      } else this.carriages.get(robot.id)!.rotation.y = 0;
      for (const rail of this.masts.get(robot.id)!) {
        const height = Math.max(robot.config.height, m.height + 0.15);
        rail.scale.y = (height - 0.2) / (robot.config.height - 0.2);
        rail.position.y = height / 2 + 0.1;
      }
      const held = this.heldVisuals.get(robot.id)!;
      held.coral.visible = pool.owner.some((owner, i) => owner === robot.id && pool.state[i] === 'held' && i < C.CORAL_COUNT);
      held.algae.visible = pool.owner.some((owner, i) => owner === robot.id && pool.state[i] === 'held' && i >= C.CORAL_COUNT);
    }
    for (const m of this.scoredVisuals.values()) m.visible = false;
    for (const p of this.placements) {
      const mesh = this.scoredMesh(p.i, false); mesh.visible = true;
      const point = C.branchPoint(p.alliance, p.face, p.branch, p.level);
      if (p.level === 1) {
        const k = this.placements.filter((o) => o.level === 1 && o.alliance === p.alliance && o.face === p.face).indexOf(p);
        const center = C.reefCenter(p.alliance), r = C.REEF_APOTHEM - 0.14;
        const tangent = ((k % 2) - 0.5) * (C.CORAL_LENGTH + 0.02);
        point.x = center.x + Math.cos(point.yaw) * r - Math.sin(point.yaw) * tangent;
        point.y = center.y + Math.sin(point.yaw) * r + Math.cos(point.yaw) * tangent;
        point.z = C.LEVEL_HEIGHTS[1] - 0.14 * (0.14 - 0.02) / (0.25 - 0.02) + C.CORAL_RADIUS + Math.floor(k / 2) * C.CORAL_RADIUS * 2;
        mesh.rotation.set(0, -point.yaw - Math.PI / 2, Math.PI / 2);
      } else {
        const direction = p.level === 4 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(Math.cos(point.yaw) * Math.cos(35 * Math.PI / 180), Math.sin(35 * Math.PI / 180), -Math.sin(point.yaw) * Math.cos(35 * Math.PI / 180));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        point.z -= 0.06;
      }
      mesh.position.copy(frame.toWorld(point.x, point.y, point.z));
    }
    for (let i = C.CORAL_COUNT; i < pool.count; i++) {
      const tag = pool.tag[i];
      if (pool.state[i] !== 'reserve' || !tag?.startsWith('net:')) continue;
      const [, a, count] = tag.split(':'); const n = C.netCenter(a as Alliance), k = Number(count) - 1;
      const mesh = this.scoredMesh(i, true); mesh.visible = true;
      mesh.position.copy(frame.toWorld(n.x + ((k % 2) - 0.5) * 0.43, n.y - 1.4 + Math.floor(k / 2) * 0.43, C.NET_HEIGHT + C.ALGAE_RADIUS));
    }
  }
  private scoredMesh(i: number, algae: boolean): THREE.Mesh {
    let mesh = this.scoredVisuals.get(i);
    if (!mesh) { mesh = new THREE.Mesh(algae ? this.algaeGeo : this.coralGeo, algae ? this.algaeMat : this.coralMat); mesh.castShadow = true; this.refs.scored.add(mesh); this.scoredVisuals.set(i, mesh); }
    return mesh;
  }
  results(): MatchResults {
    return reefscapeResults(this.ctx.score, { blue: this.ctx.robots.filter((r) => r.alliance === 'blue').length, red: this.ctx.robots.filter((r) => r.alliance === 'red').length }, this.forcedBarge);
  }
  netState(): ReefscapeNetState { return { placements: this.placements.map((p) => ({ ...p })), mechanisms: [...this.mechanisms].map(([id, m]) => [id, { ...m }]), hp: { ...this.hp }, forcedBarge: { ...this.forcedBarge } }; }
  applyNetState(state: unknown): void {
    const s = state as ReefscapeNetState;
    this.placements.splice(0, this.placements.length, ...s.placements);
    for (const [id, m] of s.mechanisms) this.mechanisms.set(id, { ...m });
    this.hp = { ...s.hp }; this.forcedBarge = { ...s.forcedBarge };
  }
}
