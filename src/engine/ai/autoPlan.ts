import { stageObstacles } from '../../seasons/2024-crescendo/obstacles';
import type { Alliance } from '../coords';
import type { AutoPilot, SeasonContext, SeasonDefinition, SeasonRules } from '../core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '../robot/robot';
import { mirrorPose } from '../startPose';
import { arrive, routeThroughBands, turnToward } from './steering';
import { aroundCircles } from './cycleBot';
import * as Reef from '../../seasons/2025-reefscape/constants';
import { BANDS } from '../../seasons/2026-rebuilt/autopilot';
import type { ReefscapeRules } from '../../seasons/2025-reefscape/rules';

/** All waypoints are stored in the blue alliance frame, so saved plans work on either alliance. */
export interface AutoStep {
  action: 'drive' | 'intake' | 'shoot' | 'reef' | 'station' | 'note' | 'wait';
  x: number;
  y: number;
  duration: number;
  target?: number;
  level?: number;
  /** Hidden route geometry; one drawn path is one action. */
  path?: { x: number; y: number }[];
  /** Blue-frame robot heading; absent means face the intake along travel / face the goal. */
  yaw?: number;
  /** Drive paths only: shoot on the move (a miss is the planner's responsibility). */
  fire?: boolean;
}
export interface AutoPlan { seasonId: string; steps: AutoStep[] }

export function cleanAutoPlan(value: unknown, season: Pick<SeasonDefinition, 'id' | 'year' | 'fieldLength' | 'fieldWidth'>): AutoPlan | undefined {
  const p = value as AutoPlan | null;
  if (!p || p.seasonId !== season.id || !Array.isArray(p.steps) || p.steps.length > 80) return undefined;
  const allowed = ['drive', 'intake', 'shoot', 'wait', ...(season.year === 2025 ? ['reef', 'station'] : season.year === 2024 ? ['note'] : [])];
  const steps: AutoStep[] = [];
  for (const s of p.steps) {
    if (!s || !allowed.includes(s.action) || ![s.x, s.y, s.duration].every(Number.isFinite) || s.x < 0 || s.x > season.fieldLength || s.y < 0 || s.y > season.fieldWidth || s.duration < 0 || s.duration > 10) return undefined;
    if (s.action === 'reef' && (!Number.isInteger(s.target) || s.target! < 0 || s.target! > 11 || !Number.isInteger(s.level) || s.level! < 1 || s.level! > 4)) return undefined;
    if (s.action === 'station' && ![0, 1].includes(s.target!)) return undefined;
    if (s.action === 'note' && (!Number.isInteger(s.target) || s.target! < 0 || s.target! > 7)) return undefined;
    if (s.yaw !== undefined && !Number.isFinite(s.yaw)) return undefined;
    if (s.path !== undefined && (s.action !== 'drive' || !Array.isArray(s.path) || s.path.length > 80 || s.path.some(q => !q || ![q.x, q.y].every(Number.isFinite) || q.x < 0 || q.x > season.fieldLength || q.y < 0 || q.y > season.fieldWidth))) return undefined;
    steps.push({ ...(s.fire && s.action === 'drive' ? { fire: true } : {}), ...(s.path !== undefined ? { path: s.path.map(q => ({ x: q.x, y: q.y })) } : {}), ...(s.yaw !== undefined ? { yaw: Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)) } : {}), action: s.action, x: s.x, y: s.y, duration: s.duration, ...(s.target !== undefined ? { target: s.target } : {}), ...(s.level !== undefined ? { level: s.level } : {}) });
  }
  // Older drawings stored every sample as an action. Keep their geometry but show one path.
  const compact: AutoStep[] = [];
  for (let i = 0; i < steps.length;) {
    let end = i;
    while (end < steps.length && steps[end].action === 'drive' && steps[end].path === undefined && steps[end].yaw === undefined && !steps[end].fire) end++;
    if (end - i >= 3) { const last = steps[end - 1]; compact.push({ ...last, path: simplifyPath(steps.slice(i, end)).slice(0, -1) }); i = end; }
    else { compact.push(steps[i]); i++; }
  }
  return { seasonId: season.id, steps: compact };
}

/** Ramer–Douglas–Peucker: preserve corners without exposing pointer samples as steps. */
export function simplifyPath(points: { x: number; y: number }[], tolerance = .12): { x: number; y: number }[] {
  if (points.length < 3) return points.map(p => ({ x: p.x, y: p.y }));
  const a = points[0], b = points[points.length - 1], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  let max = tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d > max) { max = d; split = i; }
  }
  return split < 0 ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [...simplifyPath(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyPath(points.slice(split), tolerance)];
}

export function planPoint(season: SeasonDefinition, alliance: Alliance, p: { x: number; y: number; yaw?: number }) {
  return mirrorPose({ length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry }, alliance, { ...p, yaw: p.yaw ?? 0 });
}

/** Runs real drive/intake/mechanism commands; scoring remains entirely in the season physics. */
export class PlannedAutoPilot implements AutoPilot {
  private index = 0;
  private pathIndex = 0;
  private atTarget = 0;
  private elapsed = 0;
  private travelBudget = 0;
  constructor(private ctx: SeasonContext, private rules: SeasonRules, private robot: Robot, private season: SeasonDefinition, private plan: AutoPlan) {}
  update(dt: number): RobotCommand {
    const r = this.robot, s = this.plan.steps[this.index];
    const cmd: RobotCommand = { ...IDLE_COMMAND, intake: !r.isClimbing && r.capacityLeft > 0 };
    if (!s || r.isClimbing) return cmd;
    this.elapsed += dt;
    const intermediate = s.path?.[this.pathIndex];
    let goal = planPoint(this.season, r.alliance, intermediate ?? s);
    let yaw = r.pose.yaw;
    let tolerance = 0.14;
    if (s.action === 'reef') {
      const rules = this.rules as ReefscapeRules;
      const face = Math.floor(s.target! / 2), branch = s.target! % 2;
      const level = s.level!;
      rules.plannedTargets.set(r.id, { face, branch });
      if (level > (r.config.placement?.maxLevel ?? 0) || rules.occupied(r.alliance, level, face, branch) || rules.blocked(r.alliance, level, face)) return this.advance();
      const pose = rules.alignPose(r, level, { face, branch });
      if (!pose?.reachable) return this.advance();
      goal = pose; yaw = pose.yaw; tolerance = 0.025;
      cmd.scoringLevel = level;
    } else if (s.action === 'station') {
      const st = Reef.stations(r.alliance)[s.target!];
      const dock = r.footprint.length / 2 + 0.02;
      goal = { x: st.x + Math.cos(st.yaw) * dock, y: st.y + Math.sin(st.yaw) * dock, yaw: st.yaw };
      yaw = st.yaw + (r.config.intake.stationSide !== 'back' ? Math.PI : 0);
      cmd.intake = true;
    } else if (s.action === 'note') {
      const i = s.target! < 3 ? s.target! + (r.alliance === 'red' ? 3 : 0) : s.target! + 3;
      if (r.held.length || this.ctx.pool.state[i] !== 'field') return this.advance();
      const p = this.ctx.frame.toField(this.ctx.pool.position(i));
      const angle = Math.atan2(p.y - r.pose.y, p.x - r.pose.x);
      yaw = angle + r.intakeYawOffset;
      goal = { x: p.x - Math.cos(angle) * (r.footprint.length / 2 - 0.05), y: p.y - Math.sin(angle) * (r.footprint.length / 2 - 0.05), yaw };
      cmd.intake = true;
    }
    if (s.action === 'shoot') {
      const target = this.rules.aimTarget(r);
      if (target) { const p = this.ctx.frame.toField(target.point); yaw = Math.atan2(p.y - r.pose.y, p.x - r.pose.x); }
    } else if (s.action === 'intake') {
      cmd.intake = true;
      yaw = Math.atan2(goal.y - r.pose.y, goal.x - r.pose.x) + r.intakeYawOffset;
    }
    if (!this.travelBudget) this.travelBudget = Math.hypot(goal.x - r.pose.x, goal.y - r.pose.y) / Math.max(0.5, r.config.maxSpeed * 0.3) + s.duration + 5;
    let waypoint: { x: number; y: number } = goal;
    if (this.season.year === 2024) waypoint = aroundCircles(r.pose, goal, stageObstacles(r).map(o => ({ ...o, r: Math.min(o.r, Math.hypot(goal.x - o.x, goal.y - o.y) - .03) })));
    if (this.season.year === 2026) waypoint = routeThroughBands(r.pose, goal, BANDS, r.footprint.width / 2, r.config.height);
    if (this.season.year === 2025) waypoint = aroundCircles(r.pose, goal, (['blue', 'red'] as const).map(a => ({ ...Reef.reefCenter(a), r: Math.min(Reef.REEF_APOTHEM / Math.cos(Math.PI / 6) + Math.max(r.footprint.length, r.footprint.width) / 2 + 0.08, Math.hypot(goal.x - Reef.reefCenter(a).x, goal.y - Reef.reefCenter(a).y) - 0.03) })));
    const drive = arrive(r.pose, waypoint, Math.min(3.2, r.config.maxSpeed * 0.8), intermediate ? .3 : .65);
    cmd.vx = drive.vx; cmd.vy = drive.vy;
    if (s.action === 'drive' && drive.dist > 0.2) yaw = Math.atan2(drive.vy, drive.vx) + r.intakeYawOffset;
    if (s.yaw !== undefined && !['reef', 'station', 'note'].includes(s.action)) yaw = planPoint(this.season, r.alliance, { ...s, yaw: s.yaw }).yaw;
    if (s.fire && s.action === 'drive') {
      const target = this.rules.aimTarget(r);
      if (target) {
        const p = this.ctx.frame.toField(target.point), face = Math.atan2(p.y - r.pose.y, p.x - r.pose.x);
        if (s.yaw === undefined) yaw = face;
        cmd.shoot = r.config.launcher.turret || Math.abs(Math.atan2(Math.sin(face - r.pose.yaw), Math.cos(face - r.pose.yaw))) < .15;
      }
    }
    cmd.omega = turnToward(r.pose.yaw, yaw, r.config.maxOmega, 6);
    const reached = Math.hypot(goal.x - r.pose.x, goal.y - r.pose.y) < tolerance;
    if (intermediate && Math.hypot(goal.x - r.pose.x, goal.y - r.pose.y) < .28) { this.pathIndex++; this.travelBudget = this.elapsed = 0; return this.update(0); }
    const next = this.plan.steps[this.index + 1];
    const moving = s.yaw === undefined && (s.action === 'drive' || (s.action === 'intake' && s.duration === 0));
    if (moving && next && Math.hypot(goal.x - r.pose.x, goal.y - r.pose.y) < .22) { this.advance(); return this.update(0); }
    if (reached) {
      cmd.vx = cmd.vy = 0;
      this.atTarget += dt;
      const aligned = Math.abs(Math.atan2(Math.sin(yaw - r.pose.yaw), Math.cos(yaw - r.pose.yaw))) < 0.04;
      if (s.action === 'shoot' || s.action === 'reef') cmd.shoot = aligned;
      if (((s.action === 'drive' || (s.action === 'intake' && s.duration === 0)) && (s.yaw === undefined || aligned)) || ((s.action === 'shoot' || s.action === 'reef') && r.held.length === 0) || (s.action === 'station' && r.held.length > 0) || this.atTarget >= s.duration) this.advance();
    }
    // A missing piece or blocked route must not hang every remaining action.
    if (this.elapsed > this.travelBudget) this.advance();
    return cmd;
  }
  private advance(): RobotCommand { if (this.season.year === 2025) (this.rules as ReefscapeRules).plannedTargets.delete(this.robot.id); this.index++; this.pathIndex = 0; this.atTarget = this.elapsed = this.travelBudget = 0; return { ...IDLE_COMMAND, intake: !this.robot.isClimbing && this.robot.capacityLeft > 0 }; }
}
