import type { FieldPoint } from '@engine/coords';
import { aiOrders } from '@engine/ai/team';
import type { AutoPilot, SeasonContext } from '@engine/core/season';
import { arrive, avoid, BarrierBand, dist, routeThroughBands, turnToward } from '@engine/ai/steering';
import { clusterCounts } from '@engine/ai/cycleBot';
import { IDLE_COMMAND, Robot, RobotCommand } from '@engine/robot/robot';
import * as C from './constants';
import { dir, side } from './field';
import type { RebuiltRules } from './rules';
import { routeRebuiltTraffic } from './traffic';

export const AUTO_ROUTINES = [
  { id: 'shoot-collect', label: 'Rush neutral + score', description: 'Beeline for the NEUTRAL ZONE before the opponents clear it, gather FUEL on our side, then return and score it with the preload (a turret fires the preload on the way out).' },
  { id: 'shoot-depot', label: 'Shoot preload + depot', description: 'Score the preload, collect from our DEPOT, score again.' },
  { id: 'depot-climb', label: 'Preload + depot + climb L1', description: 'Score the preload, collect and score the DEPOT, then climb the TOWER to LEVEL 1 (15 pts).' },
  { id: 'shoot-climb', label: 'Shoot preload + climb L1', description: 'Score the preload then climb the TOWER to LEVEL 1 (15 pts).' },
  { id: 'shoot-only', label: 'Shoot preload only', description: 'Score the preload and stay put.' },
  { id: 'none', label: 'Do nothing', description: 'Sit still for AUTO.' },
];

/** Robots cross each hub row only over the BUMPs or under the TRENCHes. */
/** Route cost (m) of a BUMP crossing over a TRENCH one; robots too tall for the TRENCH only have the BUMPs. */
const BUMP_PENALTY = 2.5;
export const BANDS: BarrierBand[] = (() => {
  const hs = C.HUB_SIZE / 2;
  const gaps = [
    { yMin: 0, yMax: C.TRENCH_OPENING_CENTER_Y * 2, maxRobotHeight: C.TRENCH_CLEARANCE },
    // Climbing a BUMP costs speed and risks a tip: drivers whose robot fits under the TRENCH take it unless the BUMP
    // saves well over this much driving.
    { yMin: C.HUB_CENTER.y - hs - C.BUMP_WIDTH, yMax: C.HUB_CENTER.y - hs, penalty: BUMP_PENALTY },
    { yMin: C.HUB_CENTER.y + hs, yMax: C.HUB_CENTER.y + hs + C.BUMP_WIDTH, penalty: BUMP_PENALTY },
    { yMin: C.FIELD_WIDTH - C.TRENCH_OPENING_CENTER_Y * 2, yMax: C.FIELD_WIDTH, maxRobotHeight: C.TRENCH_CLEARANCE },
  ];
  const half = hs + 0.05;
  return [
    { xMin: C.HUB_CENTER.x - half, xMax: C.HUB_CENTER.x + half, gaps },
    { xMin: C.FIELD_LENGTH - C.HUB_CENTER.x - half, xMax: C.FIELD_LENGTH - C.HUB_CENTER.x + half, gaps },
  ];
})();

type Phase = 'shoot-preload' | 'collect' | 'return' | 'climb' | 'idle';

/** Scripted AUTO routines for the player's robot (drivers can't control robots in AUTO [M 6.4]). */
export class RebuiltAutoPilot implements AutoPilot {
  private phase: Phase = 'shoot-preload';
  private targetPiece = -1;
  private retarget = 0;
  private readonly shootSpot: FieldPoint;
  private readonly routine: string;
  private previous: FieldPoint;
  private stalled = 0;
  private progressGoal: FieldPoint | null = null;
  private bestDistance = Infinity;
  private progressAt = 0;
  private escapes = 0;
  private escapeUntil = 0;
  private escape = { vx: 0, vy: 0 };
  private readonly blocked = new Map<number, number>();

  constructor(
    private readonly ctx: SeasonContext,
    private readonly rules: RebuiltRules,
    private readonly robot: Robot,
    routine: string,
  ) {
    // Einstein scorers take the large neutral supply rather than spending AUTO parked at a depleted depot.
    // The player's explicitly selected routine remains unchanged.
    this.routine = routine === 'shoot-depot' && robot.controller === 'bot' && aiOrders(ctx.settings, robot.alliance).skill === 'einstein'
      ? 'shoot-collect' : routine;
    const p = robot.pose;
    this.previous = { x: p.x, y: p.y };
    // Starting stations at the sidelines are poor shooting stances and can sit beside a trench arm.
    this.shootSpot = routine === 'shoot-only' || routine === 'none'
      ? { x: p.x, y: p.y } : side(robot.alliance, 2.7, C.HUB_CENTER.y + (robot.station - 2) * 1.1);
    if (routine === 'none') this.phase = 'idle';
    // The NEUTRAL ZONE supply goes to whoever gets there first: run the first cycle straight away, preload aboard.
    if (this.routine === 'shoot-collect' && robot.config.intake.ground !== false) this.phase = 'collect';
  }

  /** Where each robot's AUTO is collecting, so partners split the NEUTRAL ZONE instead of chasing the same pile. */
  private static readonly claims = new WeakMap<SeasonContext, Map<number, FieldPoint>>();

  update(dt: number): RobotCommand {
    const r = this.robot;
    const cmd: RobotCommand = { ...IDLE_COMMAND, intake: r.capacityLeft > 0 };
    if (r.isClimbing || this.phase === 'idle') return { ...IDLE_COMMAND };
    const tLeft = this.ctx.clock.current.id === 'auto' ? this.ctx.clock.periodRemaining : 0;
    this.retarget -= dt;

    if (this.phase === 'shoot-preload') {
      this.shoot(cmd);
      if (r.held.length === 0) {
        this.phase =
          this.routine === 'shoot-collect' || this.routine === 'shoot-depot' || this.routine === 'depot-climb' ? 'collect' : this.routine === 'shoot-climb' ? 'climb' : 'idle';
      }
      return cmd;
    }

    if (this.routine === 'depot-climb' && this.phase !== 'climb' && tLeft < 7) this.phase = 'climb';
    if (this.phase === 'collect') {
      const back = this.returnTime();
      const unload = r.held.length / Math.max(1, r.config.launcher.rate);
      if (r.held.length >= Math.min(64, r.config.hopperCapacity * 0.8) || tLeft < back + unload + 1.5) {
        this.phase = 'return';
        return this.update(0);
      }
      const p = this.pickPiece();
      if (!p && r.held.length > 0) { this.phase = 'return'; return this.update(0); }
      if (p) {
        const face = dist(r.pose, p) < 2.5 ? Math.atan2(p.y - r.pose.y, p.x - r.pose.x) + r.intakeYawOffset : null; // intake face leads
        this.steer(cmd, p, face);
      }
      // A turret empties the preload into the HUB while it drives out, without slowing down.
      if (r.config.launcher.turret && this.rules.inAllianceZone(r) && r.held.length > 0) cmd.shoot = true;
      return cmd;
    }

    if (this.phase === 'return') {
      this.shoot(cmd);
      // Finish unloading before setting off; a second trip must also fit the return and alignment.
      if (r.held.length === 0 && this.routine === 'depot-climb') this.phase = 'climb';
      else if (r.held.length === 0 && tLeft > this.returnTime() + 7) this.phase = 'collect';
      return cmd;
    }

    if (this.phase === 'climb') {
      const slot = this.rules.freeSlot(r);
      if (!slot) return cmd;
      this.steer(cmd, slot.pose, slot.pose.yaw);
      cmd.shoot = this.rules.inAllianceZone(r) && r.held.length > 0;
      if (slot.dist < 1.0 && (r.held.length === 0 || tLeft < 3.5)) cmd.climb = 1;
    }
    return cmd;
  }

  /**
   * Allowed AUTO region: our side of the CENTER LINE (G403). "collect" routines target the NEUTRAL ZONE,
   * the depot routine stays near our alliance wall.
   */
  private allowed(p: FieldPoint): boolean {
    const a = this.robot.alliance;
    const fromWall = Math.abs(p.x - side(a, 0, 0).x);
    if (this.routine === 'shoot-depot' || this.routine === 'depot-climb') return fromWall < 1.4 && Math.abs(p.y - side(a, 0, C.DEPOT_CENTER_Y).y) < 1.2;
    // G403: the bumpers must never be completely across the CENTER LINE, even overshooting at speed.
    const margin = 0.25;
    const ownHalf = dir(a) > 0 ? p.x < C.CENTER_X - margin : p.x > C.CENTER_X + margin;
    return ownHalf && fromWall > C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE / 2;
  }

  private pickPiece(): FieldPoint | null {
    const { pool, frame } = this.ctx;
    if (this.targetPiece >= 0 && pool.state[this.targetPiece] === 'field' && this.retarget > 0) {
      const f = frame.toField(pool.position(this.targetPiece));
      if (f.z < 0.25 && this.allowed(f) && (this.blocked.get(this.targetPiece) ?? 0) <= this.ctx.clock.elapsed) return f;
    }
    this.retarget = 0.6;
    const r = this.robot, me = r.pose;
    let best: FieldPoint | null = null;
    let bestCost = Infinity;
    this.targetPiece = -1;
    const cand: { i: number; f: FieldPoint }[] = [];
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field' || (this.blocked.get(i) ?? 0) > this.ctx.clock.elapsed) continue;
      const f = frame.toField(pool.position(i));
      if (f.z > 0.25 || f.x < 0.2 || f.x > C.FIELD_LENGTH - 0.2 || f.y < 0.5 || f.y > C.FIELD_WIDTH - 0.5 || !this.allowed(f)) continue;
      cand.push({ i, f });
    }
    // Go for big piles (FUEL per second of driving), not the nearest ball; skip FUEL an opponent will reach first,
    // and leave piles a partner already claimed.
    const density = clusterCounts(cand.map((c) => c.f), 1.0);
    let claims = RebuiltAutoPilot.claims.get(this.ctx);
    if (!claims) RebuiltAutoPilot.claims.set(this.ctx, claims = new Map());
    const mates = [...claims].filter(([id]) => id !== r.id && this.ctx.robots.some((o) => o.id === id && o.alliance === r.alliance)).map(([, q]) => q);
    const opps = this.ctx.robots.filter((o) => o.alliance !== r.alliance).map((o) => o.pose);
    const room = Math.max(1, r.capacityLeft);
    cand.forEach(({ i, f }, k) => {
      const d = Math.hypot(f.x - me.x, f.y - me.y);
      let time = d / Math.max(1, r.config.maxSpeed * 0.8) + 0.4;
      if (routeThroughBands(me, f, BANDS, r.footprint.width / 2, r.clearanceHeight) !== f) time += 0.8;
      if (opps.some((o) => dist(o, f) < d * 0.6 && dist(o, f) < 2.5)) time += 3;
      if (mates.some((q) => dist(q, f) < 1.8)) time += 2.5;
      const cost = time / Math.min(density[k], room, 20) ** 0.8;
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
        this.targetPiece = i;
      }
    });
    if (best) claims.set(r.id, best); else claims.delete(r.id);
    return best;
  }

  private returnTime(): number {
    const r = this.robot;
    const crosses = routeThroughBands(r.pose, this.shootSpot, BANDS, Math.max(r.footprint.length, r.footprint.width) / 2, r.clearanceHeight) !== this.shootSpot;
    return dist(r.pose, this.shootSpot) / Math.max(1, r.config.maxSpeed * 0.6) + (crosses ? 3 : 1);
  }

  private shoot(cmd: RobotCommand): void {
    const r = this.robot, p = r.pose, hub = side(r.alliance, C.HUB_CENTER.x, C.HUB_CENTER.y);
    const face = Math.atan2(hub.y - p.y, hub.x - p.x) + r.shotYawOffset;
    if (dist(p, this.shootSpot) > 0.3) this.steer(cmd, this.shootSpot, face);
    else cmd.omega = turnToward(p.yaw, face, r.config.maxOmega * 0.8);
    cmd.intake = false; // Don't prolong preload/return forever by collecting the HUB's discharge.
    cmd.shoot = this.rules.inAllianceZone(r) && r.held.length > 0 &&
      (r.config.launcher.turret || r.speed < 0.5 && r.uprightness >= 0.995);
    if (r.hasHood && r.speed > 0.5 && this.rules.nearTrenchArm(r, 1.2)) cmd.shoot = false;
  }

  private steer(cmd: RobotCommand, goal: FieldPoint, face: number | null): void {
    const r = this.robot;
    const me = r.pose;
    const wp = routeRebuiltTraffic(me, goal, BANDS, Math.max(r.footprint.width, r.footprint.length) / 2, r.clearanceHeight,
      this.ctx.robots.filter(other => other !== r).map(other => ({ ...other.pose,
        halfWidth: Math.max(other.footprint.length, other.footprint.width) / 2, speed: other.speed })));
    const v = arrive(me, wp, r.config.maxSpeed * 0.85, wp === goal ? 0.8 : 0.3);
    cmd.vx = v.vx;
    cmd.vy = v.vy;
    const obstacles = this.ctx.robots.filter((o) => o !== r).map((o) => ({ ...o.pose,
      r: (Math.hypot(o.footprint.length, o.footprint.width) + Math.hypot(r.footprint.length, r.footprint.width)) / 2 + 0.08 }));
    const repulsion = avoid(me, obstacles, 0.4, r.config.maxSpeed * 0.5);
    cmd.vx += repulsion.vx;
    cmd.vy += repulsion.vy;
    const now = this.ctx.clock.elapsed;
    if (dist(me, this.previous) < 0.003 && v.dist > 0.3) this.stalled += this.ctx.physics.dt;
    else this.stalled = Math.max(0, this.stalled - this.ctx.physics.dt * 2);
    this.previous = { x: me.x, y: me.y };
    const distance = dist(me, goal);
    if (!this.progressGoal || dist(goal, this.progressGoal) > 0.6 || distance < this.bestDistance - 0.2) {
      this.progressGoal = { x: goal.x, y: goal.y };
      this.bestDistance = distance;
      this.progressAt = now;
    }
    const noProgress = distance > 0.5 && now - this.progressAt > 1.4;
    if (this.stalled > 0.9 || noProgress && now >= this.escapeUntil) {
      const turn = [Math.PI, Math.PI / 2, -Math.PI / 2][this.escapes++ % 3];
      const heading = Math.atan2(v.vy, v.vx) + turn;
      this.escape = { vx: Math.cos(heading) * r.config.maxSpeed * 0.6, vy: Math.sin(heading) * r.config.maxSpeed * 0.6 };
      this.escapeUntil = now + 0.8;
      this.progressAt = now + 0.8;
      this.bestDistance = distance;
      this.stalled = 0;
      if (this.targetPiece >= 0) this.blocked.set(this.targetPiece, now + 5);
      this.targetPiece = -1;
    }
    if (now < this.escapeUntil) { cmd.vx = this.escape.vx; cmd.vy = this.escape.vy; }
    const half = Math.max(r.footprint.length, r.footprint.width) / 2 + 0.05;
    if (me.x < half && cmd.vx < 0 || me.x > C.FIELD_LENGTH - half && cmd.vx > 0) cmd.vx = 0;
    if (me.y < half && cmd.vy < 0 || me.y > C.FIELD_WIDTH - half && cmd.vy > 0) cmd.vy = 0;
    if (r.hasHood && this.rules.nearTrenchArm(r, 1.2)) { cmd.shoot = false; cmd.pass = false; cmd.aim = false; }
    // G403: brake so the robot can always stop with its bumpers short of the CENTER LINE.
    const room = dir(r.alliance) * (C.CENTER_X - me.x) - Math.max(r.footprint.length, r.footprint.width) / 2 - 0.1;
    const vIn = dir(r.alliance) * cmd.vx, vMax = Math.sqrt(2 * r.config.maxAccel * 0.35 * Math.max(0, room));
    if (vIn > vMax) cmd.vx = dir(r.alliance) * vMax;
    const heading = face ?? (v.dist > 0.3 ? Math.atan2(v.vy, v.vx) : me.yaw);
    cmd.omega = turnToward(me.yaw, heading, r.config.maxOmega * 0.8);
  }
}
