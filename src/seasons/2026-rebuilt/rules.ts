import { captureFields, restoreFields } from '@engine/net/recovery';
import { fuelCrossedHubFunnel } from './hubStructure';
import { HUB_CAD } from './hubCad';
import * as THREE from 'three';
import { Alliance, ALLIANCES, opponent } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import { PIN_SEPARATION, PinTracker, reportPins } from '@engine/match/pinning';
import { Referee } from '@engine/match/referee';
import type { AimTarget, Robot } from '@engine/robot/robot';
import * as C from './constants';
import { dir, RebuiltFieldRefs, side, towerSlots } from './field';
import {
  decideFirstInactive,
  HubGrace,
  hubActive,
  hubLight,
  HubLight,
  isAutoScoringPeriod,
  secondsActiveRemaining,
  secondsUntilActive,
} from './hubLogic';
import { autoTowerPoints, POINTS, rankingPoints, teleopTowerPoints } from './scoring';
import { stageFuel } from './staging';
import { feedTarget, rowClearances } from './passing';
import { hubShotAngle } from './config';

const CHUTE_TAG = (a: Alliance) => `chute-${a}`;
/** FUEL that left the FIELD is put back on the carpet this far inside the edge it crossed (m, [EST]). */
const OUT_OF_BOUNDS_INSET = 0.35;
const HP_RELEASE_INTERVAL = 0.14;
/**
 * FUEL is foam: a ball that ends up under a robot's belly pan is crushed nearly flat by ~60 kg of robot and squeezed out
 * past the bumpers, instead of holding the robot up like a rigid 6 in stilt (which beached robots on every pile, at the
 * DEPOT, at the TOWER and wedged them under a TRENCH). [EST: squashed to 30% of its radius, squirts out at 1.6 m/s]
 */
const UNDER_ROBOT_SQUASH = 0.3;
const UNDER_ROBOT_SQUIRT = 1.6;

/** What multiplayer clients need from the rules (score/clock are synced by the engine). */
export interface RebuiltNetState {
  fi: Alliance | null;
  /** HubGrace.lastActive (null = never). */
  la: [number | null, number | null];
  co: [boolean, boolean];
  /** Hub net bulges (NetSheet.netState) — red's nets then blue's; absent while every net hangs flat. */
  nt?: (number[] | null)[];
}

/** Shots aim at a point inside the funnel, above its base (the accuracy table and shot map are calibrated to it) [EST]. */
const HUB_AIM_Z = 1.524;

/** A scored ball rolling through its HUB's ramps (counted once, at the sensor). */
interface InHub {
  alliance: Alliance;
  /** Seconds it has barely moved (a jam is nudged toward the exits). */
  still: number;
  /** Compressed by the counter wheels (its collider is shrunk until it leaves). */
  squeezed?: boolean;
}

/**
 * Runtime rules for REBUILT: hub sensors / processing / exits, hub status & lights, fuel scoring
 * with grace windows, TOWER climbing + assessment, human player CHUTE/CORRAL, fouls G403 & G407.
 */
export class RebuiltRules implements SeasonRules {
  recoveryState() {
    return { visible: this.netState(), fields: captureFields(this, 'releaseTimer lastHpOpen inHub launches g407Cooldown g403Called climbHintAt towerAuto towerTeleop g420Live g420Award g403Contacts hubDrops catches strategicCatches passingAt underRobot'.split(' ')),
      ref: this.ref.recoveryState(), pins: this.pins.recoveryState() };
  }
  restoreRecovery(state: unknown): void {
    const s = state as ReturnType<RebuiltRules['recoveryState']>;
    this.applyNetState(s.visible);
    restoreFields(this, 'releaseTimer lastHpOpen inHub launches g407Cooldown g403Called climbHintAt towerAuto towerTeleop g420Live g420Award g403Contacts hubDrops catches strategicCatches passingAt underRobot'.split(' '), s.fields);
    this.ref.restoreRecovery(s.ref);
    this.pins.restoreRecovery(s.pins);
  }

  firstInactive: Alliance | null = null;
  readonly grace = new HubGrace();
  readonly chuteOpen: Record<Alliance, boolean> = { red: false, blue: false };
  private releaseTimer: Record<Alliance, number> = { red: 0, blue: 0 };
  private lastHpOpen: Record<Alliance, number> = { red: -99, blue: -99 };
  /** Scored FUEL inside a HUB, by pool index, until it rolls out of an exit. */
  private inHub = new Map<number, InHub>();
  /** Each FUEL's height (field z) last step, for the funnel crossing test. */
  private lastZ = new Float32Array(0);
  /** Recently launched FUEL → who launched it, whether from outside their ALLIANCE ZONE and whether it was a FEED pass (for G407). */
  private launches = new Map<number, { robotId: number; alliance: Alliance; outside: boolean; pass?: boolean; t: number; team: number }>();
  private g407Cooldown = new Map<number, number>();
  private g403Called = new Set<number>();
  /** FUEL squashed under a robot's chassis (pool index → robot id), restored once it is out from under. */
  private underRobot = new Map<number, number>();
  /** Last time each robot was commanded to FEED (pass). */
  private passingAt = new Map<number, number>();
  /**
   * G418: 3-count on PINS, enforced strictly: inside its own ALLIANCE ZONE a robot an opponent is touching that can't
   * move is pinned (no need to be boxed in), and a count only clears once the robots are 6 ft apart.
   */
  private readonly pins = new PinTracker({ rule: 'G418', countSeconds: 3, separation: PIN_SEPARATION, strictZones: true });
  private climbHintAt = -99;
  private towerAuto: Record<Alliance, number> = { red: 0, blue: 0 };
  private towerTeleop: Record<Alliance, number> = { red: 0, blue: 0 };
  /** The head referee: contact, tipping, collusion and FUEL calls shared by every season. */
  readonly ref: Referee;
  /** G420 contact episodes already called (`attackerId:victimId`), and robots awarded LEVEL 3 for one. */
  private g420Live = new Set<string>();
  private readonly g420Award = new Set<number>();
  /** G403: opponent contacts already called after a robot crossed the CENTER LINE in AUTO. */
  private g403Contacts = new Set<string>();
  /** G408: FUEL the HUB just released that nothing has touched yet, and whether it was last seen dropping into a hopper. */
  private hubDrops = new Map<number, { t: number; grounded: boolean; into?: number }>();
  /** G408: pool indices of FUEL the HUB released moments ago that has not yet touched the carpet (bots keep clear of it). */
  freshHubFuel(): number[] {
    const out: number[] = [];
    for (const [idx, d] of this.hubDrops) if (!d.grounded) out.push(idx);
    return out;
  }
  /** G408: a robot's current run of catches, and how many strategic instances it has been called for. */
  private catches = new Map<number, { count: number; last: number; called: boolean }>();
  private strategicCatches = new Map<number, number>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(
    private readonly ctx: SeasonContext,
    readonly refs: RebuiltFieldRefs,
  ) {
    this.ref = new Referee(ctx, { tip: 'G417', collusion: 'G419' } /* G404, G405 and G416 are too hard to judge: not called */);
  }

  // ─────────────────────────── helpers used by AI / HUD ───────────────────────────

  get now(): number {
    return this.ctx.clock.elapsed;
  }

  get periodId(): string | null {
    const c = this.ctx.clock;
    if (!c.started) return null;
    return c.finished ? 'done' : c.current.id;
  }

  hubActive(a: Alliance): boolean {
    const p = this.periodId;
    return p !== null && hubActive(p, a, this.firstInactive);
  }

  /** Would fuel entering `a`'s hub right now count? */
  hubCounts(a: Alliance): boolean {
    const p = this.periodId;
    if (p === null) return false;
    return this.grace.counts(a, this.now, p, this.firstInactive);
  }

  secondsUntilActive(a: Alliance): number {
    const c = this.ctx.clock;
    if (!c.started) return c.timeUntil('auto');
    if (c.finished) return Infinity;
    // Before SHIFT order is known, treat shifts as active for planning.
    return secondsUntilActive(c.periods, c.index, c.periodRemaining, a, this.firstInactive);
  }

  secondsActiveRemaining(a: Alliance): number {
    const c = this.ctx.clock;
    if (!c.started || c.finished) return 0;
    return secondsActiveRemaining(c.periods, c.index, c.periodRemaining, a, this.firstInactive);
  }

  light(a: Alliance): HubLight {
    const c = this.ctx.clock;
    if (!c.started) return 'off';
    if (c.finished) return 'off';
    return hubLight(c.current.id, c.periodRemaining, a, this.firstInactive, c.next()?.id ?? null);
  }

  fuelActive(a: Alliance): number {
    return this.ctx.score.counter(a, 'fuelActive');
  }

  towerPoints(a: Alliance): number {
    return this.ctx.score.category(a, 'towerAuto') + this.ctx.score.category(a, 'towerTeleop');
  }

  /**
   * [M 5.6] A robot over a TRENCH arm (either hub row, both guardrails) has only TRENCH_CLEARANCE above it. The
   * margin starts the limit before the robot gets there (the intake mouth reaches past the bumper and the robot
   * keeps rolling), so a FUEL taken on the way in can't swell the hopper into the arm. For a shot blocker it only
   * reports the arm actually overhead (the blocker can't be raised into it; a raised one hits the arm physically).
   */
  overheadClearance(robot: Robot): number {
    const blocker = robot.config.shotBlocker;
    // An open shooter hood sticks up above the frame, so it needs the arm known too (the hood is held down under it).
    if (!robot.config.hopperExpansion && !blocker && !robot.hasHood) return Infinity;
    // Self-expanding net hoppers stop growing ~1.2 m before the arm (they can't shrink back in time once a FUEL is
    // taken). A shot blocker that is up or being raised turns the intake off, and a driver-raised telescoping hopper
    // (1678) only grows on command, so for those only the arm actually overhead counts.
    const blocking = !!blocker && (robot.blockerDeploy > 0 || !!robot.lastCommand.block);
    const margin = robot.config.hopperExpansion && !robot.manualHopper && !blocking ? 0.6 + (C.TRENCH_DEPTH - C.TRENCH_ARM_DEPTH) / 2 : 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of robot.corners()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // Only the arm is overhead (the pedestal beside the opening is not driven under); see buildBumpsAndTrenches.
    const reach = Math.min(C.TRENCH_WIDTH, C.HUB_CENTER.y - C.HUB_SIZE / 2 - C.BUMP_WIDTH);
    for (const hubX of [C.HUB_CENTER.x, C.FIELD_LENGTH - C.HUB_CENTER.x]) {
      if (maxX < hubX - C.TRENCH_ARM_DEPTH / 2 - margin || minX > hubX + C.TRENCH_ARM_DEPTH / 2 + margin) continue;
      if (minY < reach + margin || maxY > C.FIELD_WIDTH - reach - margin) return C.TRENCH_SAFE_HEIGHT;
    }
    return Infinity;
  }

  /** Is the robot within `margin` m (plan view) of a TRENCH arm it could roll under? Bots stow a raised hood before this. */
  nearTrenchArm(robot: Robot, margin: number): boolean {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of robot.corners()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const reach = Math.min(C.TRENCH_WIDTH, C.HUB_CENTER.y - C.HUB_SIZE / 2 - C.BUMP_WIDTH);
    for (const hubX of [C.HUB_CENTER.x, C.FIELD_LENGTH - C.HUB_CENTER.x]) {
      if (maxX < hubX - C.TRENCH_ARM_DEPTH / 2 - margin || minX > hubX + C.TRENCH_ARM_DEPTH / 2 + margin) continue;
      if (minY < reach + margin || maxY > C.FIELD_WIDTH - reach - margin) return true;
    }
    return false;
  }

  chuteCount(a: Alliance): number {
    return this.ctx.pool.countIn('reserve', CHUTE_TAG(a));
  }

  /** G418 seconds currently counted against this robot for pinning (0 when it isn't pinning anyone). */
  pinCount(robotId: number): number {
    return this.pins.countFor(robotId);
  }

  /** Opponents this robot has an open G418 count against: it has to get 6 ft away from each to clear it. */
  pinnedBy(robotId: number): number[] {
    return this.pins.pinnedBy(robotId);
  }

  hubCenter(a: Alliance): { x: number; y: number } {
    return this.refs.hubs[a].center;
  }

  /** G407: bumpers partially or fully within own ALLIANCE ZONE. */
  inAllianceZone(r: Robot, a: Alliance = r.alliance): boolean {
    const cs = r.corners();
    return a === 'blue' ? cs.some((p) => p.x <= C.ALLIANCE_ZONE_DEPTH) : cs.some((p) => p.x >= C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH);
  }

  /** G403: bumpers completely across the CENTER LINE (toward the opponent). */
  acrossCenter(r: Robot): boolean {
    const cs = r.corners();
    return r.alliance === 'blue' ? cs.every((p) => p.x > C.CENTER_X) : cs.every((p) => p.x < C.CENTER_X);
  }

  /** Nearest free climb slot on the robot's own tower. */
  freeSlot(r: Robot): { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null {
    const slots = towerSlots(r.alliance, r.footprint.length, r.footprint.width);
    const taken = new Set(this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance && o.climbSlot !== null).map((o) => o.climbSlot));
    const p = r.pose;
    let best: { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null = null;
    slots.forEach((s, idx) => {
      if (taken.has(idx)) return;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (!best || d < best.dist) best = { idx, pose: s, dist: d };
    });
    return best;
  }

  liftHeight(r: Robot, level: number): number {
    const bb = r.config.bumperBottom;
    if (level <= 1) return 0.12;
    const rung = C.RUNG_HEIGHTS[level - 2] + C.RUNG_OD / 2;
    return rung + 0.04 - bb;
  }

  // ─────────────────────────── SeasonRules ───────────────────────────

  stage(): void {
    const { pool, robots, rng } = this.ctx;
    this.pins.reset();
    this.ref.reset();
    this.g420Live.clear(); this.g420Award.clear(); this.g403Contacts.clear();
    this.hubDrops.clear(); this.catches.clear(); this.strategicCatches.clear(); this.inHub.clear(); this.passingAt.clear(); this.underRobot.clear();
    const st = stageFuel(
      robots.map((r) => Math.min(r.config.preload, r.config.hopperCapacity)),
      rng,
    );
    let k = 0;
    for (const p of st.neutral) pool.placeField(k++, p.x, p.y);
    for (const a of ALLIANCES) for (const p of st.depots[a]) pool.placeField(k++, p.x, p.y);
    for (const a of ALLIANCES) for (let i = 0; i < st.chutes[a]; i++) pool.reserve(k++, CHUTE_TAG(a));
    robots.forEach((r, ri) => {
      r.held.length = 0;
      for (let i = 0; i < st.preloads[ri]; i++) {
        pool.hold(k, r.id);
        r.held.push(k++);
      }
    });
    while (k < pool.count) pool.reserve(k++, 'spare');
  }

  onPeriodChange(ch: PeriodChange): void {
    const { score, toast, robots } = this.ctx;
    const from = ch.from?.id;
    const to = ch.to?.id;
    if (to === 'auto') this.grace.reset();

    if (from === 'auto') {
      // AUTO TOWER assessed at 0:00 [M 6.5 C]
      for (const a of ALLIANCES) {
        const levels = robots.filter((r) => r.alliance === a && r.climbPhase === 'hanging').map((r) => Math.min(1, r.climbLevel));
        this.towerAuto[a] = autoTowerPoints(levels);
        score.set(a, 'towerAuto', this.towerAuto[a]);
        // Only the first AUTO_TOWER_MAX_ROBOTS robots at LEVEL 1+ earn points.
        const hanging = robots.filter((r) => r.alliance === a);
        let paid = 0;
        for (const r of hanging) {
          const earns = r.climbPhase === 'hanging' && r.climbLevel >= 1 && paid < POINTS.autoTowerMaxRobots;
          if (earns) paid++;
          score.setCredit(r.id, 'towerAuto', earns ? POINTS.autoTowerL1 : 0);
        }
      }
      this.g403Called.clear();
    }

    if (to === 'transition') {
      const red = score.counter('red', 'autoFuel');
      const blue = score.counter('blue', 'autoFuel');
      this.firstInactive = decideFirstInactive(red, blue, this.ctx.rng.next());
      const tie = red === blue ? ' (tie → FMS random)' : '';
      toast(`AUTO fuel ${red}–${blue}. ${this.firstInactive.toUpperCase()} hub inactive in SHIFT 1${tie}`, 'info');
    }

    if (to && to.startsWith('shift') && this.firstInactive) {
      const active = ALLIANCES.filter((a) => hubActive(to, a, this.firstInactive));
      toast(`${ch.to!.label}: ${active.map((a) => a.toUpperCase()).join(' & ')} HUB ACTIVE`, 'info', active[0]);
    }
    if (to === 'endgame') toast('END GAME — both hubs active. Climb!', 'warn');

    if (to === 'post') {
      // TELEOP TOWER assessed at end of match [M 6.5 D]
      for (const a of ALLIANCES) {
        const lvl = (r: Robot) => (this.g420Award.has(r.id) ? 3 : r.climbLevel);
        const levels = robots.filter((r) => r.alliance === a && (r.climbPhase === 'hanging' || this.g420Award.has(r.id))).map(lvl);
        this.towerTeleop[a] = teleopTowerPoints(levels);
        score.set(a, 'towerTeleop', this.towerTeleop[a]);
        for (const r of robots.filter((x) => x.alliance === a)) {
          score.setCredit(r.id, 'towerTeleop', r.climbPhase === 'hanging' || this.g420Award.has(r.id) ? teleopTowerPoints([lvl(r)]) : 0);
        }
      }
    }
  }

  beforeStep(dt: number): void {
    const { pool, frame, rng, clock } = this.ctx;
    const t = this.now;
    this.squashUnderRobots();
    for (const a of ALLIANCES) for (const net of this.refs.hubs[a].nets) net.step(dt, pool);

    // Human players: automatic ones open the CHUTE when it has stock and their hub is (about to be) active.
    const running = clock.started && !clock.finished;
    for (const a of ALLIANCES) {
      const auto = this.ctx.humanPlayerIsAuto(a);
      const stock = this.chuteCount(a);
      if (auto && running && !this.chuteOpen[a] && stock >= 6 && t - this.lastHpOpen[a] > 5 && clock.mode !== 'disabled') {
        if (this.secondsUntilActive(a) < 4 || clock.mode === 'auto') {
          this.chuteOpen[a] = true;
          this.lastHpOpen[a] = t;
        }
      }
      if (!this.chuteOpen[a]) continue;
      if (stock === 0) {
        this.chuteOpen[a] = false;
        continue;
      }
      this.releaseTimer[a] -= dt;
      if (this.releaseTimer[a] > 0) continue;
      this.releaseTimer[a] = HP_RELEASE_INTERVAL;
      const idx = pool.indices('reserve', CHUTE_TAG(a))[0];
      const oc = side(a, 0, C.OUTPOST_CENTER_Y);
      const x = side(a, pool.radius + 0.03, 0).x;
      frame.toWorld(x, oc.y + rng.range(-0.25, 0.25), C.CHUTE_OPENING_Z + C.CHUTE_OPENING_H / 2, this.tmp);
      frame.velToWorld(dir(a) * rng.range(1.3, 2.3), rng.range(-0.35, 0.35), rng.range(0, 0.6), this.tmp2);
      pool.placeWorld(idx, this.tmp, this.tmp2);
    }
  }

  afterStep(dt: number): void {
    const { pool, frame, score, clock, robots, toast } = this.ctx;
    const t = this.now;
    const pid = this.periodId;
    if (pid && pid !== 'done') this.grace.update(t, pid, this.firstInactive);
    if (this.lastZ.length !== pool.count) this.lastZ = new Float32Array(pool.count).fill(-Infinity);

    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const w = pool.position(i);
      const f = frame.toField(w);
      const prevZ = this.lastZ[i];
      this.lastZ[i] = f.z;
      const inside = this.inHub.get(i);
      if (inside) { this.trackInHub(i, f, inside, dt); continue; }

      // Scored as it drops out of the bottom of the funnel; panel impacts and rebounds stay in the physics.
      if (f.z < C.HUB_RIM_HEIGHT + 0.5 && prevZ > f.z) {
        let scored = false;
        for (const a of ALLIANCES) {
          const hc = this.refs.hubs[a].center;
          if (fuelCrossedHubFunnel(prevZ, f.z, f.x - hc.x, f.y - hc.y, pool.radius)) {
            this.scoreFuel(a, i);
            scored = true;
            break;
          }
        }
        if (scored) continue;
      }

      // [M 5.9.2] CORRAL: FUEL pushed through the floor opening at the base of the OUTPOST lands in the
      // CORRAL behind the wall → its human player can load it into the CHUTE. Only FUEL physically in the
      // CORRAL counts — nothing else ever reaches a CHUTE.
      const behind = f.x < -C.WALL_THICK || f.x > C.FIELD_LENGTH + C.WALL_THICK;
      if (behind) {
        const a: Alliance = f.x < 0 ? 'blue' : 'red';
        if (Math.abs(f.y - side(a, 0, C.OUTPOST_CENTER_Y).y) < C.CORRAL_WIDTH / 2 && f.z < C.CORRAL_WALL_H) {
          pool.reserve(i, CHUTE_TAG(a));
          continue;
        }
      }
      // [M 6.8] FUEL that leaves the FIELD any other way (over a guardrail or the ALLIANCE WALL, or through a
      // gap) is placed back into the FIELD by FIELD STAFF approximately at the point of exit — NOT given to a
      // human player.
      if (behind || f.y < -0.25 || f.y > C.FIELD_WIDTH + 0.25 || f.z < -0.3) {
        const m = OUT_OF_BOUNDS_INSET;
        pool.placeField(i, Math.min(C.FIELD_LENGTH - m, Math.max(m, f.x)), Math.min(C.FIELD_WIDTH - m, Math.max(m, f.y)));
      }
    }

    // G403: completely crossing the CENTER LINE in AUTO.
    if (clock.started && clock.current.id === 'auto') {
      for (const r of robots) {
        if (this.g403Called.has(r.id) || !this.acrossCenter(r)) continue;
        this.g403Called.add(r.id);
        score.foul({ t, alliance: r.alliance, kind: 'major', rule: 'G403', robotId: r.id, note: 'crossed CENTER LINE in AUTO' });
        toast(`MAJOR FOUL G403 — ${r.config.teamNumber} crossed the CENTER LINE in AUTO`, 'foul', r.alliance);
      }
    }
    for (const r of robots) if (r.lastCommand.pass && !r.lastCommand.shoot) this.passingAt.set(r.id, t);
    this.ref.update(dt);
    if (clock.started && clock.mode !== 'disabled') this.callFouls(dt);
    if (clock.started && clock.mode !== 'disabled') reportPins(this.pins.updateRobots(dt, robots, this.ctx.physics, (r) => this.inAllianceZone(r)), this.ctx, t);
    for (const [id, cd] of this.g407Cooldown) this.g407Cooldown.set(id, cd - dt);
    for (const [idx, l] of this.launches) if (pool.state[idx] !== 'field' || t - l.t > 8) this.launches.delete(idx);
  }

  // ─────────────────────────── referee calls ───────────────────────────

  /** Bumpers touching (or climbing on) the robot's own TOWER, or within a hand's width of it. */
  touchingOwnTower(r: Robot): boolean {
    if (r.isClimbing) return true;
    const ty = C.TOWER_CENTER_Y;
    return r.corners().some((p) => {
      const lx = r.alliance === 'blue' ? p.x : C.FIELD_LENGTH - p.x;
      return lx <= C.TOWER_DEPTH + 0.06 && Math.abs(p.y - ty) <= C.TOWER_WIDTH / 2 + 0.06;
    });
  }

  private callFouls(dt: number): void {
    const { robots, clock, pool } = this.ctx;
    const t = this.now;
    const id = clock.current.id;

    // G403 (second half): an additional MAJOR FOUL per contact with an opponent while across the CENTER LINE.
    if (id === 'auto') {
      for (const r of robots) {
        if (!this.g403Called.has(r.id)) continue;
        for (const o of robots) {
          if (o.alliance === r.alliance) continue;
          const k = `${r.id}:${o.id}`;
          if (this.ref.touching(r, o)) {
            if (!this.g403Contacts.has(k)) {
              this.g403Contacts.add(k);
              this.ref.call({ rule: 'G403', kind: 'major', robot: r, note: `contacted ${o.config.teamNumber} across the CENTER LINE in AUTO` });
            }
          } else this.g403Contacts.delete(k);
        }
      }
    }

    // G420: TOWER protection, last 30 s. No contact (direct, or through a FUEL both are touching) with an opponent
    // in contact with its TOWER, whoever starts it. If that opponent is off the ground it is awarded LEVEL 3.
    if (id === 'endgame') {
      const live = new Set<string>();
      for (const v of robots) {
        if (!this.touchingOwnTower(v)) continue;
        for (const a of robots) {
          if (a.alliance === v.alliance || !this.ref.touching(a, v)) continue;
          const k = `${a.id}:${v.id}`;
          live.add(k);
          if (this.g420Live.has(k)) continue;
          const lifted = v.climbPhase === 'rise' || v.climbPhase === 'hanging' || v.elevation > 0.03;
          if (lifted) this.g420Award.add(v.id);
          this.ref.call({ rule: 'G420', kind: 'major', robot: a, note: `contacted ${v.config.teamNumber} at its TOWER${lifted ? ` · ${v.config.teamNumber} awarded LEVEL 3` : ''}` });
        }
      }
      this.g420Live = live;
    }

    // G419: two or more partners walling off the opponent's TOWER from a robot that is trying to get to it.
    if (id === 'endgame' || id === 'shift4') {
      for (const a of ALLIANCES) {
        const opp = opponent(a);
        this.ref.blockAccess(dt, `tower:${opp}`, a, side(opp, C.TOWER_DEPTH / 2, C.TOWER_CENTER_Y), `blocked ${opp.toUpperCase()}'s TOWER`);
      }
    }

    // G408: FUEL released by the HUB may not be caught (more than MOMENTARY control) before anything else touches it.
    // Only a ball that falls straight out of the HUB into a robot's open hopper is a catch; one the intake picks up
    // as it rolls out of an exit is not.
    for (const [idx, d] of this.hubDrops) {
      const age = t - d.t;
      if (pool.state[idx] === 'held') {
        this.hubDrops.delete(idx);
        const owner = robots.find((r) => r.id === pool.owner[idx]);
        if (owner && !d.grounded && age < 0.8 && d.into === owner.id) this.catchFuel(owner, t);
        continue;
      }
      if (pool.state[idx] !== 'field' || age > 1.5) { this.hubDrops.delete(idx); continue; }
      const p = pool.position(idx);
      if (p.y < pool.radius * 1.3) d.grounded = true;
      d.into = pool.velocity(idx).y < 0 ? robots.find((r) => this.overHopper(r, p))?.id : undefined;
    }
    for (const [rid, c] of this.catches) {
      if (t - c.last <= 1.2) continue;
      this.catches.delete(rid);
      const r = robots.find((x) => x.id === rid);
      if (r && !c.called) this.ref.call({ rule: 'G408', kind: 'minor', robot: r, note: 'caught FUEL released by the HUB' });
    }
  }

  /** FUEL under a chassis is crushed flat and squeezed out to the nearest side; it pops back to full size once clear. */
  private squashUnderRobots(): void {
    const { pool, robots } = this.ctx;
    const r0 = pool.radius;
    for (const [i, rid] of this.underRobot) {
      const r = robots.find((x) => x.id === rid);
      if (pool.state[i] === 'field' && r && this.underChassis(r, pool.position(i), r0)) continue;
      if (pool.state[i] === 'field' && !this.inHub.has(i)) pool.squeeze(i, 1);
      this.underRobot.delete(i);
    }
    for (const r of robots) {
      if (r.isClimbing || r.tippedOver) continue;
      const t = r.body.translation(), reach = Math.hypot(r.footprint.length, r.footprint.width) / 2 + 0.3;
      for (let i = 0; i < pool.count; i++) {
        if (pool.state[i] !== 'field' || this.inHub.has(i) || !pool.specAt(i).crushedUnderRobots) continue;
        const p = pool.position(i);
        if (Math.abs(p.x - t.x) > reach || Math.abs(p.z - t.z) > reach) continue;
        const local = this.underChassis(r, p, r0);
        if (!local) continue;
        if (!this.underRobot.has(i)) { pool.squeeze(i, UNDER_ROBOT_SQUASH); this.underRobot.set(i, r.id); }
        // Out the nearer side (robot frame), riding along with the chassis.
        const q = r.body.rotation();
        const sideX = r.footprint.length / 2 - Math.abs(local.x), sideZ = r.footprint.width / 2 - Math.abs(local.z);
        this.tmp2.set(sideX < sideZ ? Math.sign(local.x) || 1 : 0, 0, sideX < sideZ ? 0 : Math.sign(local.z) || 1)
          .applyQuaternion(this.tmpQ.set(q.x, q.y, q.z, q.w));
        const v = r.body.linvel(), b = pool.bodies[i];
        b.setLinvel({ x: v.x + this.tmp2.x * UNDER_ROBOT_SQUIRT, y: Math.min(0, b.linvel().y), z: v.z + this.tmp2.z * UNDER_ROBOT_SQUIRT }, true);
      }
    }
  }

  /** Robot-frame position of a ball (world) that is under this robot's chassis, below its bumpers; null otherwise. */
  private underChassis(r: Robot, p: { x: number; y: number; z: number }, radius: number): THREE.Vector3 | null {
    const t = r.body.translation(), q = r.body.rotation(), c = r.config, fp = r.footprint;
    const local = this.tmp.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(this.tmpQ.set(-q.x, -q.y, -q.z, q.w));
    // Under the bumpers too, until it is far enough out to re-inflate beside them without lifting the robot.
    if (local.y > c.bumperBottom + radius || Math.abs(local.x) > fp.length / 2 + radius * 0.5 || Math.abs(local.z) > fp.width / 2 + radius * 0.5) return null;
    return local;
  }

  /** A ball (world position) above the robot's bumpers and inside its frame perimeter: dropping into its hopper. */
  private overHopper(r: Robot, p: { x: number; y: number; z: number }): boolean {
    const t = r.body.translation(), q = r.body.rotation();
    const local = this.tmp.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(this.tmpQ.set(-q.x, -q.y, -q.z, q.w));
    const c = r.config;
    return local.y > c.bumperTop && Math.abs(local.x) < c.frameLength / 2 && Math.abs(local.z) < c.frameWidth / 2;
  }

  /** One FUEL from the HUB went straight into a robot. A run of 3+ is strategic (sitting under the HUB). */
  private catchFuel(r: Robot, t: number): void {
    const c = this.catches.get(r.id) ?? { count: 0, last: t, called: false };
    c.count++;
    c.last = t;
    this.catches.set(r.id, c);
    if (c.count < 3 || c.called) return;
    c.called = true;
    const n = (this.strategicCatches.get(r.id) ?? 0) + 1;
    this.strategicCatches.set(r.id, n);
    // First strategic catch: MAJOR FOUL and VERBAL WARNING; any after that: MAJOR FOUL and YELLOW CARD.
    this.ref.call({ rule: 'G408', kind: 'major', robot: r, ...(n > 1 ? { card: 'yellow' as const } : {}), note: `sat under the HUB catching FUEL${n === 1 ? ' · verbal warning' : ''}` });
  }

  private scoreFuel(a: Alliance, idx: number): void {
    const { score } = this.ctx;
    // G407: FUEL launched into your own HUB while your bumpers were outside your ALLIANCE ZONE. A FEED pass lobbed
    // toward the ALLIANCE ZONE that happens to drop in wasn't launched into the HUB: not called.
    const l = this.launches.get(idx);
    this.launches.delete(idx);
    if (l && l.outside && !l.pass && l.alliance === a && (this.g407Cooldown.get(l.robotId) ?? 0) <= 0) {
      this.g407Cooldown.set(l.robotId, 2.5);
      score.foul({ t: this.now, alliance: a, kind: 'major', rule: 'G407', robotId: l.robotId, note: 'launched into HUB from outside ALLIANCE ZONE' });
      this.ctx.toast(`MAJOR FOUL G407 — ${l.team} launched into its HUB from outside its ALLIANCE ZONE`, 'foul', a);
    }
    const pid = this.periodId ?? 'pre';
    const counts = this.hubCounts(a);
    if (counts) {
      const auto = isAutoScoringPeriod(pid);
      const by = l?.alliance === a ? l.robotId : undefined;
      score.add(a, auto ? 'fuelAuto' : 'fuelTeleop', 1, this.now, by);
      if (by !== undefined) score.tally(by, 'scored');
      score.inc(a, 'fuelActive');
      if (auto) score.inc(a, 'autoFuel');
    } else {
      score.inc(a, 'fuelInactive');
    }
    // The ball keeps falling through the HUB onto its ramps and rolls out of its exit slot by itself (hubCad.ts).
    this.inHub.set(idx, { alliance: a, still: 0 });
  }

  /** A scored ball inside its HUB: out of an exit → released (G408 watch); stalled → nudged toward the exits. */
  private trackInHub(i: number, f: { x: number; y: number; z: number }, h: InHub, dt: number): void {
    const { pool } = this.ctx;
    const hc = this.refs.hubs[h.alliance].center, d = dir(h.alliance);
    const u = (f.x - hc.x) * d, v = f.y - hc.y, half = C.HUB_SIZE / 2;
    if (u > half + pool.radius * 0.5) {
      if (h.squeezed) pool.squeeze(i, 1);
      this.inHub.delete(i);
      this.hubDrops.set(i, { t: this.now, grounded: false });
      return;
    }
    // Anywhere else outside the body (bounced back out of the funnel): an ordinary ball again.
    if (u < -half - pool.radius || Math.abs(v) > half + pool.radius || f.z > C.HUB_RIM_HEIGHT + 0.3) {
      if (h.squeezed) pool.squeeze(i, 1);
      this.inHub.delete(i);
      return;
    }
    // Stalled? (measured before the counter's push below adds to it this step)
    const vel = pool.velocity(i);
    h.still = Math.hypot(vel.x, vel.y, vel.z) < 0.05 ? h.still + dt : 0;
    // [CAD GE-264xx] The FUEL counter's driven treaded wheels carry a ball through toward the exit slot.
    if (u > HUB_CAD.counterFromX && u < half && f.z > HUB_CAD.exitBottom - 0.02 && f.z < HUB_CAD.counterTopZ) {
      const b = pool.bodies[i], m = b.mass(), lv = b.linvel();
      this.ctx.frame.velToWorld(d * HUB_CAD.counterSpeed, 0, 0, this.tmp2);
      // Only along the push direction, and only up to the wheel speed (friction-limited drive).
      const along = (lv.x * this.tmp2.x + lv.z * this.tmp2.z) / HUB_CAD.counterSpeed;
      const add = Math.max(0, Math.min(HUB_CAD.counterSpeed - along, 18 * dt));
      b.applyImpulse({ x: m * add * this.tmp2.x / HUB_CAD.counterSpeed, y: 0, z: m * add * this.tmp2.z / HUB_CAD.counterSpeed }, true);
      // The wheels squeeze the foam ball through a gap narrower than it (top plate to bottom plate ~0.11 m).
      if (!h.squeezed) { pool.squeeze(i, HUB_CAD.counterSqueeze); h.squeezed = true; }
    }
    // Riding into the nose of a lane divider (pairs on the centre line and at ±0.27 m): the wheels roll it off into the
    // lane on whichever side it leans (dead centre: by ball, so the streams split).
    if (Math.abs(u - HUB_CAD.laneFromX) < 0.07) {
      for (const dv of HUB_CAD.dividerCenters) {
        if (Math.abs(v - dv) > 0.045) continue;
        const away = Math.abs(v - dv) > 0.004 ? Math.sign(v - dv) : (i % 2 ? 1 : -1);
        this.ctx.frame.velToWorld(0, away * 0.8, 0, this.tmp2);
        const b = pool.bodies[i], m = b.mass(), lv = b.linvel();
        const now = (lv.x * this.tmp2.x + lv.z * this.tmp2.z) / 0.8;
        if (now < 0.8) b.applyImpulse({ x: m * (0.8 - now) * this.tmp2.x / 0.8, y: 0, z: m * (0.8 - now) * this.tmp2.z / 0.8 }, true);
        break;
      }
    }
    if (h.still > 2.5) {
      h.still = 0;
      this.ctx.frame.velToWorld(d * 0.8, this.ctx.rng.range(-0.3, 0.3), 0.6, this.tmp2);
      const b = pool.bodies[i], m = b.mass(), lv = b.linvel();
      b.applyImpulse({ x: m * (this.tmp2.x - lv.x), y: m * (this.tmp2.y - lv.y), z: m * (this.tmp2.z - lv.z) }, true);
    }
  }

  onLaunch(robot: Robot, pieceIndex: number): void {
    // Launching anywhere is legal; G407 is assessed if this FUEL ends up in our HUB (see scoreFuel).
    this.ctx.score.tally(robot.id, 'shots');
    // A ball still on its way to the flywheel when the driver lets go of FEED is part of the same pass.
    const pass = !robot.lastCommand.shoot && (robot.lastCommand.pass || this.now - (this.passingAt.get(robot.id) ?? -99) < 0.5);
    const target = pass ? this.passTarget(robot) : this.aimTarget(robot);
    this.ref.launched(robot, pieceIndex, target?.point ?? null);
    this.launches.set(pieceIndex, {
      robotId: robot.id,
      alliance: robot.alliance,
      outside: !this.inAllianceZone(robot),
      pass,
      t: this.now,
      team: robot.config.teamNumber,
    });
  }

  /** FEED: lob FUEL back into our ALLIANCE ZONE, clearing any hub rows (hub + net, trench) on the way. */
  passTarget(robot: Robot): AimTarget {
    const p = robot.pose;
    const from = { x: p.x, y: p.y };
    const t = feedTarget(robot.alliance, from);
    return { point: this.ctx.frame.toWorld(t.x, t.y, 0.2), clearances: rowClearances(from, t) };
  }

  aimTarget(robot: Robot): AimTarget | null {
    const hc = this.refs.hubs[robot.alliance].center;
    const point = this.ctx.frame.toWorld(hc.x, hc.y, HUB_AIM_Z);
    // Aim through the narrower throat, not just the rim plane: a shot centered at
    // the rim keeps moving sideways as it descends and can rebound off a funnel panel.
    // The clearance checks still keep the incoming ball above the mouth.
    const p = robot.pose;
    const ang = Math.atan2(p.y - hc.y, p.x - hc.x);
    const k = 1 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)), 1e-6);
    const r = this.ctx.pool.radius;
    const top = C.HUB_RIM_HEIGHT + r + 0.02;
    return {
      point,
      preferredAngle: hubShotAngle(Math.hypot(p.x - hc.x, p.y - hc.y)),
      clearances: [
        { distance: (C.HUB_SIZE / 2) * k + r, height: top },
        { distance: (C.HUB_SIZE / 2 - C.HUB_WALL) * k, height: top },
      ],
    };
  }

  requestClimb(robot: Robot, level: number): void {
    if (robot.config.climber.maxLevel === 0) return;
    const auto = this.ctx.clock.mode === 'auto';
    const lvl = Math.max(1, Math.min(auto ? 1 : 3, level, robot.config.climber.maxLevel));
    const slot = this.freeSlot(robot);
    if (!slot || slot.dist > 1.6) {
      if (robot.controller === 'player' && this.now - this.climbHintAt > 2) {
        this.climbHintAt = this.now;
        this.ctx.toast(slot ? 'Drive closer to your TOWER to climb' : 'No free climb position on your TOWER', 'warn', undefined, robot);
      }
      return;
    }
    if (slot.dist > .4 || Math.abs(Math.atan2(Math.sin(robot.pose.yaw-slot.pose.yaw),Math.cos(robot.pose.yaw-slot.pose.yaw))) > Math.PI/6) {
      if (robot.controller === 'player') this.ctx.toast('Line up square with the TOWER rung · move closer and face it','warn',undefined,robot);
      return;
    }
    robot.startClimb(slot.pose, this.liftHeight(robot, lvl), lvl, slot.idx);
  }

  requestDescend(robot: Robot): void {
    robot.startDescend();
  }

  humanPlayerAction(alliance: Alliance): void {
    if (this.chuteCount(alliance) === 0 && !this.chuteOpen[alliance]) {
      this.ctx.toast('CHUTE is empty — push FUEL into the CORRAL to refill it', 'warn');
      return;
    }
    this.chuteOpen[alliance] = !this.chuteOpen[alliance];
    this.lastHpOpen[alliance] = this.now;
    this.ctx.toast(`Human player: CHUTE door ${this.chuteOpen[alliance] ? 'OPEN' : 'closed'}`, 'info', alliance);
  }

  updateVisuals(_dt: number, time: number): void {
    for (const a of ALLIANCES) {
      const mat = this.refs.hubs[a].lights;
      const base = new THREE.Color(C.COLORS[a]);
      const st = this.light(a);
      switch (st) {
        case 'active':
          mat.emissive.copy(base);
          mat.emissiveIntensity = 2.4;
          break;
        case 'warning':
          mat.emissive.copy(base);
          mat.emissiveIntensity = 0.2 + 2.4 * (0.5 + 0.5 * Math.sin(time * 14));
          break;
        case 'chase':
          mat.emissive.copy(base).lerp(new THREE.Color(0xffffff), 0.5 + 0.5 * Math.sin(time * 9));
          mat.emissiveIntensity = 2.2;
          break;
        case 'post':
          mat.emissive.set(0xffffff);
          mat.emissiveIntensity = 1.6;
          break;
        default:
          mat.emissive.copy(base);
          mat.emissiveIntensity = 0.04;
      }
      const door = this.refs.chuteDoors[a];
      door.visible = !this.chuteOpen[a];
      for (const net of this.refs.hubs[a].nets) net.syncVisual();
    }
  }

  netState(): RebuiltNetState {
    const la = (a: Alliance) => (Number.isFinite(this.grace.lastActive[a]) ? this.grace.lastActive[a] : null);
    const nets = ALLIANCES.flatMap((a) => this.refs.hubs[a].nets.map((n) => n.netState()));
    return { fi: this.firstInactive, la: [la('red'), la('blue')], co: [this.chuteOpen.red, this.chuteOpen.blue], ...(nets.some((n) => n) ? { nt: nets } : {}) };
  }

  applyNetState(state: unknown): void {
    const s = state as RebuiltNetState;
    this.firstInactive = s.fi;
    this.grace.lastActive = { red: s.la[0] ?? -Infinity, blue: s.la[1] ?? -Infinity };
    this.chuteOpen.red = s.co[0];
    this.chuteOpen.blue = s.co[1];
    let k = 0;
    for (const a of ALLIANCES) for (const net of this.refs.hubs[a].nets) net.applyNetState(s.nt?.[k++]);
  }

  results(): MatchResults {
    const s = this.ctx.score;
    const rp = {} as Record<Alliance, ReturnType<typeof rankingPoints>>;
    for (const a of ALLIANCES) {
      rp[a] = rankingPoints({ fuelActive: this.fuelActive(a), towerPoints: this.towerPoints(a), ownScore: s.total(a), oppScore: s.total(opponent(a)) });
    }
    const row = (label: string, f: (a: Alliance) => string | number, emphasis = false, cats?: string[]) => ({ label, red: f('red'), blue: f('blue'), emphasis, cats });
    return {
      winner: s.winner(),
      rows: [
        row('AUTO FUEL', (a) => s.category(a, 'fuelAuto'), false, ['fuelAuto']),
        row('AUTO TOWER', (a) => s.category(a, 'towerAuto'), false, ['towerAuto']),
        row('TELEOP FUEL', (a) => s.category(a, 'fuelTeleop'), false, ['fuelTeleop']),
        row('TELEOP TOWER', (a) => s.category(a, 'towerTeleop'), false, ['towerTeleop']),
        row('Foul points received', (a) => s.foulPointsFor(a)),
        row('Fouls committed (minor / major)', (a) => `${s.foulCount(a, 'minor')} / ${s.foulCount(a, 'major')}`),
        row('Cards (yellow / red)', (a) => `${s.cardCount(a, 'yellow')} / ${s.cardCount(a, 'red')}`),
        row('FUEL into inactive hub (0 pts)', (a) => s.counter(a, 'fuelInactive')),
        row('TOTAL', (a) => s.total(a), true),
      ],
      rp: { red: rp.red.total, blue: rp.blue.total },
      rpDetail: { red: rp.red.detail, blue: rp.blue.detail },
    };
  }
}
