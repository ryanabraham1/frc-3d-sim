import type { FieldPoint, FieldPose } from '../coords';
import type { AutoPilot, SeasonContext } from '../core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '../robot/robot';
import { clamp, wrapAngle } from '../units';
import { arrive, avoid, dist, turnToward, type Circle } from './steering';

export interface BotStrategy {
  score(): RobotCommand;
  supply(): FieldPose;
  accepts(index: number, point: FieldPoint): boolean;
  /** Adjust travel cost to favor useful resources over merely nearby pieces. */
  pieceCost?(point: FieldPoint): number;
  /** Pose to collect a piece from when a straight approach can't reach it (e.g. against a wall). */
  collectPose?(point: FieldPoint): FieldPose | null;
  route?(goal: FieldPoint): FieldPoint;
  batch?: number;
  wantsScore?(): boolean | undefined;
  endgame?(): RobotCommand | null;
  tactics?(dt: number): RobotCommand | null;
}

/** Repeated physical collect/score cycles. No pieces or points are created by the AI. */
export class CycleBot implements AutoPilot {
  private static readonly claims = new WeakMap<SeasonContext, Map<number, { robot: number; until: number }>>();
  private readonly blockedTargets = new Map<number, number>();
  private scoring: boolean;
  private target = -1;
  private retarget = 0;
  /** Seconds spent right next to the current target piece without collecting it. */
  private lingering = 0;
  private stalled = 0;
  private distanceToGoal = 0;
  private previous: FieldPoint;
  private readonly pace: number;
  readonly hard: boolean;

  constructor(readonly ctx: SeasonContext, readonly robot: Robot, private readonly strategy: BotStrategy) {
    this.scoring = robot.held.length > 0;
    if (!CycleBot.claims.has(ctx)) CycleBot.claims.set(ctx, new Map());
    this.previous = robot.pose;
    const difficulty = robot.alliance === ctx.settings.alliance ? 'normal' : ctx.settings.aiDifficulty ?? 'normal';
    this.hard = difficulty === 'hard';
    this.pace = difficulty === 'easy' ? 0.55 : difficulty === 'hard' ? 0.95 : 0.75;
  }

  update(dt: number): RobotCommand {
    const r = this.robot;
    if (r.isClimbing || r.tippedOver) return { ...IDLE_COMMAND };
    const endgame = this.hard ? this.strategy.endgame?.() : null;
    if (endgame) return this.recover(endgame, dt);
    const tactic = this.strategy.tactics?.(dt);
    if (tactic) return this.recover(tactic, dt);
    this.retarget -= dt;
    if (!r.held.length) this.scoring = false;
    if (r.held.length >= Math.min(this.strategy.batch ?? 1, r.config.hopperCapacity)) this.scoring = true;
    const wantsScore = this.strategy.wantsScore?.();
    if (wantsScore !== undefined) this.scoring = wantsScore;
    if (this.scoring) { this.releaseTarget(); return this.recover(this.strategy.score(), dt); }
    const piece = this.pickPiece();
    if (!piece && r.held.length && wantsScore !== false) { this.scoring = true; this.releaseTarget(); return this.recover(this.strategy.score(), dt); }
    // A piece wedged against a wall or resting on a bumper can sit just outside the intake: give up on it
    // rather than parking beside it for the rest of the match.
    if (piece && dist(r.pose, piece) < Math.hypot(r.footprint.length, r.footprint.width) / 2 + 0.3) this.lingering += dt;
    else this.lingering = 0;
    if (piece && this.lingering > 2.5) {
      this.blockedTargets.set(this.target, this.ctx.clock.elapsed + 8);
      this.releaseTarget();
      this.lingering = 0;
      this.retarget = 0;
    }
    let cmd: RobotCommand;
    const approach = piece && this.strategy.collectPose?.(piece);
    if (approach) cmd = this.driveTo(approach, approach.yaw);
    else if (piece) {
      // Drive through the piece at speed instead of braking on top of each one: the intake reaches past the bumper.
      const travel = dist(r.pose, piece);
      const yaw = travel > 0.4 ? Math.atan2(piece.y - r.pose.y, piece.x - r.pose.x) + r.intakeYawOffset : r.pose.yaw;
      cmd = this.driveTo(piece, yaw, undefined, 0.3);
    } else {
      const supply = this.strategy.supply();
      cmd = this.driveTo(supply, supply.yaw);
    }
    cmd.intake = true;
    return this.recover(cmd, dt);
  }

  private recover(cmd: RobotCommand, dt: number): RobotCommand {
    const r = this.robot;
    // Recover from pushing a wall or another robot, during scoring as well as collection.
    if (dist(r.pose, this.previous) < 0.003 && this.distanceToGoal > 0.1) this.stalled += dt;
    else this.stalled = Math.max(0, this.stalled - dt * 2);
    this.previous = r.pose;
    if (this.stalled > 1.5) {
      const yaw = r.pose.yaw + (r.id % 2 ? 1 : -1) * Math.PI / 2;
      cmd.vx = Math.cos(yaw) * this.pace;
      cmd.vy = Math.sin(yaw) * this.pace;
      if (this.stalled > 2.3) {
        if (this.target >= 0) this.blockedTargets.set(this.target, this.ctx.clock.elapsed + 8);
        this.releaseTarget();
        this.stalled = 0;
        this.retarget = 0;
      }
    }
    return cmd;
  }

  /** `slowRadius` is where the robot starts braking for the goal (smaller = arrives faster, e.g. to ram or collect). */
  driveTo(goal: FieldPoint, yaw?: number, engage?: Robot, slowRadius = 0.85): RobotCommand {
    const r = this.robot, p = r.pose;
    const waypoint = this.strategy.route?.(goal) ?? goal;
    this.distanceToGoal = dist(p, goal);
    const v = arrive(p, waypoint, r.config.maxSpeed * this.pace, waypoint === goal ? slowRadius : 0.85);
    const near = dist(p, goal) < 0.35 && waypoint === goal;
    const obstacles = this.ctx.robots.filter((o) => o !== r && o !== engage).map((o) => ({ ...o.pose, r: (Math.hypot(o.footprint.width, o.footprint.length) + Math.hypot(r.footprint.width, r.footprint.length)) / 2 + 0.08 }));
    const repulsion = avoid(p, obstacles, 0.45, r.config.maxSpeed * 0.55);
    let vx = v.vx + repulsion.vx, vy = v.vy + repulsion.vy;
    // Circulate clockwise around an approaching teammate. Radial repulsion alone leaves two robots
    // nose-to-nose with cancelling commands; the shared passing convention gives both a way out.
    for (const other of this.ctx.robots) {
      if (other === r || other === engage || other.alliance !== r.alliance || other.isClimbing) continue;
      const q = other.pose, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      const clearance = (Math.hypot(other.footprint.width, other.footprint.length) + Math.hypot(r.footprint.width, r.footprint.length)) / 2;
      if (d < 0.01 || d > clearance + 0.65 || v.vx * dx + v.vy * dy <= 0) continue;
      const yieldSpeed = r.config.maxSpeed * this.pace * (r.id > other.id ? 0.85 : 0.4);
      const urgency = clamp((clearance + 0.65 - d) / 0.65, 0, 1);
      vx -= dy / d * yieldSpeed * urgency;
      vy += dx / d * yieldSpeed * urgency;
    }
    const speed = Math.hypot(vx, vy), limit = r.config.maxSpeed * this.pace;
    if (speed > limit) { vx *= limit / speed; vy *= limit / speed; }
    const half = Math.max(r.footprint.width, r.footprint.length) / 2 + 0.04;
    if (p.x < half && vx < 0 || p.x > this.ctx.frame.length - half && vx > 0) vx = 0;
    if (p.y < half && vy < 0 || p.y > this.ctx.frame.width - half && vy > 0) vy = 0;
    return { ...IDLE_COMMAND, vx: near && v.dist < 0.035 ? 0 : vx, vy: near && v.dist < 0.035 ? 0 : vy,
      omega: turnToward(p.yaw, yaw ?? Math.atan2(v.vy, v.vx), r.config.maxOmega * this.pace) };
  }

  private releaseTarget(): void {
    if (this.target >= 0 && CycleBot.claims.get(this.ctx)?.get(this.target)?.robot === this.robot.id) CycleBot.claims.get(this.ctx)!.delete(this.target);
    this.target = -1;
  }

  private pickPiece(): FieldPoint | null {
    if (this.robot.config.intake.ground === false) return null;
    const { pool, frame } = this.ctx;
    const eligible = (i: number) => {
      if (i < 0 || pool.state[i] !== 'field' || this.robot.justLaunched(i)) return null;
      if ((this.blockedTargets.get(i) ?? 0) > this.ctx.clock.elapsed) return null;
      const claim = CycleBot.claims.get(this.ctx)!.get(i);
      if (claim && claim.robot !== this.robot.id && claim.until > this.ctx.clock.elapsed) return null;
      const p = frame.toField(pool.position(i));
      const margin = Math.min(this.robot.footprint.length, this.robot.footprint.width) / 2 - this.robot.config.intake.reach;
      if (p.x < margin || p.x > frame.length - margin || p.y < margin || p.y > frame.width - margin) return null;
      return p.z < 0.3 && this.strategy.accepts(i, p) ? p : null;
    };
    if (this.retarget > 0) { const p = eligible(this.target); if (p) { CycleBot.claims.get(this.ctx)!.set(this.target, { robot: this.robot.id, until: this.ctx.clock.elapsed + 1 }); return p; } }
    this.retarget = this.hard ? 0.2 : 0.5;
    this.releaseTarget();
    const candidates: { i: number; p: FieldPoint }[] = [];
    for (let i = 0; i < pool.count; i++) {
      const p = eligible(i);
      if (p) candidates.push({ i, p });
    }
    // Robots that hold several pieces head for dense clusters rather than the single nearest straggler:
    // each neighbour within CLUSTER_RADIUS saves a separate trip later.
    const room = this.robot.capacityLeft;
    const density = room > 1 ? clusterCounts(candidates.map((c) => c.p), CLUSTER_RADIUS) : null;
    let best: FieldPoint | null = null, cost = Infinity;
    for (const [k, { i, p }] of candidates.entries()) {
      const travel = dist(this.robot.pose, p);
      let d = travel + (this.strategy.pieceCost?.(p) ?? 0);
      if (density) d -= CLUSTER_BONUS * Math.min(density[k] - 1, room - 1, CLUSTER_CAP);
      // Yield a piece to a closer teammate instead of all chasing the same one.
      if (this.ctx.robots.some((r) => r !== this.robot && r.alliance === this.robot.alliance && r.capacityLeft > 0 && dist(r.pose, p) + 0.3 < travel)) d += 4;
      if (d < cost) { best = p; cost = d; this.target = i; }
    }
    if (this.target >= 0) CycleBot.claims.get(this.ctx)!.set(this.target, { robot: this.robot.id, until: this.ctx.clock.elapsed + 1 });
    return best;
  }
}

const CLUSTER_RADIUS = 1.2;
/** Meters of detour one extra nearby piece is worth, and how many neighbours count. */
const CLUSTER_BONUS = 0.4;
const CLUSTER_CAP = 12;

/** For each point, how many points (itself included) lie within `radius`, using a uniform grid. */
export function clusterCounts(points: FieldPoint[], radius: number): number[] {
  const cells = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  points.forEach((p, k) => {
    const id = key(Math.floor(p.x / radius), Math.floor(p.y / radius));
    let list = cells.get(id);
    if (!list) cells.set(id, (list = []));
    list.push(k);
  });
  const r2 = radius * radius;
  return points.map((p) => {
    const cx = Math.floor(p.x / radius), cy = Math.floor(p.y / radius);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const k of cells.get(key(cx + dx, cy + dy)) ?? []) {
        const q = points[k];
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r2) n++;
      }
    }
    return n;
  });
}

/** Follow an arc around a solid structure when the direct segment intersects it. */
export function aroundCircles(from: FieldPoint, goal: FieldPoint, obstacles: Circle[]): FieldPoint {
  for (const o of obstacles) {
    const dx = goal.x - from.x, dy = goal.y - from.y, len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((o.x - from.x) * dx + (o.y - from.y) * dy) / len2, 0, 1) : 0;
    if (Math.hypot(from.x + t * dx - o.x, from.y + t * dy - o.y) >= o.r) continue;
    const start = Math.atan2(from.y - o.y, from.x - o.x);
    const end = Math.atan2(goal.y - o.y, goal.x - o.x);
    const delta = wrapAngle(end - start);
    const angle = start + clamp(delta, -0.45, 0.45);
    return { x: o.x + Math.cos(angle) * (o.r + 0.15), y: o.y + Math.sin(angle) * (o.r + 0.15) };
  }
  return goal;
}
