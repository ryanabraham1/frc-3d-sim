import type { FieldPoint, FieldPose } from '../coords';
import type { AutoPilot, SeasonContext } from '../core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '../robot/robot';
import { clamp, wrapAngle } from '../units';
import { arrive, avoid, dist, turnToward, type Circle } from './steering';
import { SKILL, TeamBrain } from './team';
import type { AiSkill } from '../core/season';

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
  /** Touching this opponent now would draw a foul (it or we are in a protected zone): keep well clear. */
  cautious?(opponent: Robot): boolean;
  /** The bot keeps getting stuck where it is going: forget the current goal. */
  onStuck?(): void;
  /** True = let go of a climb made earlier (an AUTO climb) and get back to work. */
  release?(): boolean;
  /** Extra command fields while hanging / climbing (e.g. 2024: place the held NOTE in the TRAP). */
  climbing?(): Partial<RobotCommand> | null;
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
  pace: number;
  /** Shared alliance brain: roles, plan blackboard, rescues and radio. */
  readonly team: TeamBrain;
  readonly skill: AiSkill;
  /** Hard or Einstein: competitive builds and the most aggressive plan. */
  readonly hard: boolean;
  /** Normal and above: runs the alliance plan (Easy just cycles). */
  readonly smart: boolean;
  /** Einstein: defends the human driver when they're about to score (see the season bots). */
  readonly hunter: boolean;

  constructor(readonly ctx: SeasonContext, readonly robot: Robot, private readonly strategy: BotStrategy) {
    this.scoring = robot.held.length > 0;
    if (!CycleBot.claims.has(ctx)) CycleBot.claims.set(ctx, new Map());
    this.previous = robot.pose;
    this.team = TeamBrain.for(ctx, robot.alliance);
    this.skill = this.team.skill;
    this.hard = this.skill !== 'normal';
    this.hunter = !!SKILL[this.skill].hunter;
    this.smart = SKILL[this.skill].smart;
    this.pace = SKILL[this.skill].pace;
  }

  /** This robot's current alliance role (season role id). */
  get role(): string {
    return this.team.role(this.robot);
  }

  update(dt: number): RobotCommand {
    const r = this.robot;
    this.team.tick();
    if (r.isClimbing) return { ...IDLE_COMMAND, descend: !!this.strategy.release?.(), ...(this.strategy.climbing?.() ?? {}) };
    if (r.tippedOver) return { ...IDLE_COMMAND };
    const rescue = this.rescue();
    if (rescue) return this.antiPin(rescue, dt);
    const endgame = this.smart ? this.strategy.endgame?.() : null;
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

  /** Push a stuck teammate free (or shove the robot pinning it) when the alliance brain sends this robot. */
  private rescue(): RobotCommand | null {
    const job = this.team.rescueFor(this.robot);
    if (!job) return null;
    const r = this.robot, p = r.pose, t = job.push.pose;
    const size = (o: Robot) => Math.max(o.footprint.length, o.footprint.width) / 2;
    const reach = size(r) + size(job.push);
    const behind = { x: t.x - job.dir.x * (reach + 0.3), y: t.y - job.dir.y * (reach + 0.3) };
    const along = (p.x - t.x) * job.dir.x + (p.y - t.y) * job.dir.y;
    const lateral = Math.abs(-(p.x - t.x) * job.dir.y + (p.y - t.y) * job.dir.x);
    const yaw = Math.atan2(job.dir.y, job.dir.x);
    if (along > -reach + 0.1 || lateral > 0.35) {
      const cmd = this.driveTo(behind, yaw);
      this.distanceToGoal = 0; // routing around robots near the target isn't a stall
      return cmd;
    }
    this.team.pushing(r);
    const speed = Math.min(2, r.config.maxSpeed * 0.5);
    return { ...IDLE_COMMAND, vx: job.dir.x * speed, vy: job.dir.y * speed,
      omega: turnToward(p.yaw, yaw, r.config.maxOmega * this.pace) };
  }

  private oppContact = 0;
  private backoff: { until: number; x: number; y: number } | null = null;

  /**
   * Pin avoidance: an opponent held against something for a 5-count is a foul in every season. A bot that has been
   * pressed against an opponent without moving for 1.5 s backs straight off for a moment, then re-plans.
   */
  private antiPin(cmd: RobotCommand, dt: number): RobotCommand {
    const r = this.robot, now = this.ctx.clock.elapsed;
    if (this.backoff && now < this.backoff.until) {
      return { ...cmd, vx: this.backoff.x * r.config.maxSpeed * 0.5, vy: this.backoff.y * r.config.maxSpeed * 0.5, shoot: cmd.shoot, intake: cmd.intake, climb: null };
    }
    const size = (o: Robot) => Math.hypot(o.footprint.length, o.footprint.width) / 2;
    const opp = this.ctx.robots.find((o) => o.alliance !== r.alliance && dist(o.pose, r.pose) < size(o) + size(r) - 0.05);
    if (opp && r.speed < 0.35 && opp.speed < 0.35 && Math.hypot(cmd.vx, cmd.vy) > 0.3) this.oppContact += dt;
    else this.oppContact = Math.max(0, this.oppContact - dt * 2);
    if (opp && this.oppContact > 1.5) {
      const dx = r.pose.x - opp.pose.x, dy = r.pose.y - opp.pose.y, d = Math.hypot(dx, dy) || 1;
      this.backoff = { until: now + 1.2, x: dx / d, y: dy / d };
      this.oppContact = 0;
      if (this.target >= 0) this.blockedTargets.set(this.target, now + 8);
      this.releaseTarget();
      this.retarget = 0;
    }
    return cmd;
  }

  private escape: { until: number; x: number; y: number; spin: number } | null = null;
  /** Speed the last driveTo wanted toward its waypoint before avoidance (0 when not driving to anything). */
  private intent = 0;
  private escapes = 0;

  private recover(cmd: RobotCommand, dt: number): RobotCommand {
    cmd = this.antiPin(cmd, dt);
    const r = this.robot, now = this.ctx.clock.elapsed;
    if (this.escape && now < this.escape.until) {
      this.previous = r.pose;
      return { ...cmd, vx: this.escape.x, vy: this.escape.y, omega: this.escape.spin };
    }
    // Stalled against a wall, a robot, a pile of pieces or beached on a field edge: try a different way out each time
    // (back off, either side, diagonally) with a twist of the chassis, which un-beaches a robot hung up on an edge.
    const moving = dist(r.pose, this.previous) > 0.003;
    // Count what the bot WANTS to do, not only what it commands: forces that cancel out are a stall too.
    if (!moving && this.distanceToGoal > 0.1 && Math.max(Math.hypot(cmd.vx, cmd.vy), this.intent) > 0.2) this.stalled += dt;
    else this.stalled = Math.max(0, this.stalled - dt * 2);
    if (moving && dist(r.pose, this.previous) > 0.01) this.escapes = Math.max(0, this.escapes - dt * 0.2);
    this.previous = r.pose;
    if (this.stalled > 1.1) {
      const want = Math.hypot(cmd.vx, cmd.vy) > 0.1 ? Math.atan2(cmd.vy, cmd.vx) : r.pose.yaw;
      const turn = [Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75][Math.floor(this.escapes) % 5];
      const speed = r.config.maxSpeed * 0.7;
      this.escape = { until: now + 0.8, x: Math.cos(want + turn) * speed, y: Math.sin(want + turn) * speed, spin: (this.escapes % 2 ? 1 : -1) * r.config.maxOmega * 0.4 };
      this.escapes++;
      this.stalled = 0;
      if (this.escapes >= 2) {
        if (this.target >= 0) this.blockedTargets.set(this.target, now + 8);
        this.releaseTarget();
        this.retarget = 0;
        this.strategy.onStuck?.();
      }
      return { ...cmd, vx: this.escape.x, vy: this.escape.y, omega: this.escape.spin };
    }
    return cmd;
  }

  /**
   * Defense: get between `target` and where it scores (`goal`), then lean on it. Pin avoidance (antiPin) breaks contact
   * before any 5-count, so the bot repeatedly re-engages instead of holding a robot still.
   */
  defend(target: Robot, goal: FieldPoint): RobotCommand {
    const r = this.robot, p = target.pose, v = target.fieldVelocity;
    const far = dist(r.pose, p) > 2;
    const k = far ? 0.35 : 0;
    const aim = { x: p.x + (goal.x - p.x) * k + v.vx * 0.3, y: p.y + (goal.y - p.y) * k + v.vy * 0.3 };
    if (!far) this.team.pushing(r);
    return this.driveTo(aim, Math.atan2(p.y - r.pose.y, p.x - r.pose.x), target);
  }

  driveTo(goal: FieldPoint, yaw?: number, engage?: Robot, slowRadius = 0.85): RobotCommand {
    const r = this.robot, p = r.pose;
    const waypoint = this.strategy.route?.(goal) ?? goal;
    this.distanceToGoal = dist(p, goal);
    const v = arrive(p, waypoint, r.config.maxSpeed * this.pace, waypoint === goal ? slowRadius : 0.85);
    const near = dist(p, goal) < 0.35 && waypoint === goal;
    // Opponents it would be a foul to touch right now (protected zones) get a much wider berth.
    const obstacles = this.ctx.robots.filter((o) => o !== r && o !== engage).map((o) => ({ ...o.pose,
      r: (Math.hypot(o.footprint.width, o.footprint.length) + Math.hypot(r.footprint.width, r.footprint.length)) / 2 + (o.alliance !== r.alliance && this.strategy.cautious?.(o) ? 0.75 : 0.08) }));
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
    // Local minimum: the pull toward the waypoint and the push away from a robot in the way cancel out, and the bot
    // would sit still forever. Slide around the obstacle instead (the side nearer the goal).
    const want = Math.hypot(v.vx, v.vy);
    this.intent = want;
    if (want > 0.5 && Math.hypot(vx, vy) < want * 0.3 && Math.hypot(repulsion.vx, repulsion.vy) > 0.2) {
      const rn = Math.hypot(repulsion.vx, repulsion.vy);
      let tx = -repulsion.vy / rn, ty = repulsion.vx / rn;
      if (tx * (goal.x - p.x) + ty * (goal.y - p.y) < 0) { tx = -tx; ty = -ty; }
      vx += tx * want * 0.8;
      vy += ty * want * 0.8;
    }
    const speed = Math.hypot(vx, vy), limit = r.config.maxSpeed * this.pace;
    if (speed > limit) { vx *= limit / speed; vy *= limit / speed; }
    const half = Math.max(r.footprint.width, r.footprint.length) / 2 + 0.04;
    if (p.x < half && vx < 0 || p.x > this.ctx.frame.length - half && vx > 0) vx = 0;
    if (p.y < half && vy < 0 || p.y > this.ctx.frame.width - half && vy > 0) vy = 0;
    return { ...IDLE_COMMAND, vx: near && v.dist < 0.035 ? 0 : vx, vy: near && v.dist < 0.035 ? 0 : vy,
      omega: turnToward(p.yaw, yaw ?? Math.atan2(v.vy, v.vx), r.config.maxOmega * this.pace) };
  }

  private dockedSince = -1;
  private redockUntil = -1;
  private redockTo: FieldPoint | null = null;
  /**
   * Station watchdog: docked at a supply point (`docked`) without getting a piece for `patience` s, back off to
   * `away` for a moment and come back in, which is what a driver does when a piece hangs up in the chute against
   * the bumper. Returns the back-off command while backing off, else null. Call every tick while waiting to dock.
   */
  redock(docked: boolean, away: FieldPoint, yaw: number, patience = 2.5): RobotCommand | null {
    const now = this.ctx.clock.elapsed;
    if (now < this.redockUntil && this.redockTo) {
      this.dockedSince = -1;
      return this.driveTo(this.redockTo, yaw, undefined, 0.2);
    }
    if (!docked) { this.dockedSince = -1; return null; }
    if (this.dockedSince < 0) this.dockedSince = now;
    if (now - this.dockedSince > patience) {
      this.redockUntil = now + 0.7;
      this.redockTo = away;
      this.dockedSince = -1;
      return this.driveTo(away, yaw, undefined, 0.2);
    }
    return null;
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
    this.retarget = SKILL[this.skill].retarget;
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
