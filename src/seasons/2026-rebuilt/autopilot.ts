import type { FieldPoint } from '@engine/coords';
import type { AutoPilot, SeasonContext } from '@engine/core/season';
import { arrive, BarrierBand, dist, routeThroughBands, turnToward } from '@engine/ai/steering';
import { IDLE_COMMAND, Robot, RobotCommand } from '@engine/robot/robot';
import * as C from './constants';
import { dir, side } from './field';
import type { RebuiltRules } from './rules';

export const AUTO_ROUTINES = [
  { id: 'shoot-collect', label: 'Shoot preload + collect neutral', description: 'Score the preload, gather FUEL on our side of the NEUTRAL ZONE, return and score.' },
  { id: 'shoot-depot', label: 'Shoot preload + depot', description: 'Score the preload, collect from our DEPOT, score again.' },
  { id: 'depot-climb', label: 'Preload + depot + climb L1', description: 'Score the preload, collect and score the DEPOT, then climb the TOWER to LEVEL 1 (15 pts).' },
  { id: 'shoot-climb', label: 'Shoot preload + climb L1', description: 'Score the preload then climb the TOWER to LEVEL 1 (15 pts).' },
  { id: 'shoot-only', label: 'Shoot preload only', description: 'Score the preload and stay put.' },
  { id: 'none', label: 'Do nothing', description: 'Sit still for AUTO.' },
];

/** Robots cross each hub row only over the BUMPs or under the TRENCHes. */
export const BANDS: BarrierBand[] = (() => {
  const hs = C.HUB_SIZE / 2;
  const gaps = [
    { yMin: 0, yMax: C.TRENCH_OPENING_CENTER_Y * 2, maxRobotHeight: C.TRENCH_CLEARANCE },
    { yMin: C.HUB_CENTER.y - hs - C.BUMP_WIDTH, yMax: C.HUB_CENTER.y - hs },
    { yMin: C.HUB_CENTER.y + hs, yMax: C.HUB_CENTER.y + hs + C.BUMP_WIDTH },
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

  constructor(
    private readonly ctx: SeasonContext,
    private readonly rules: RebuiltRules,
    private readonly robot: Robot,
    private readonly routine: string,
  ) {
    const p = robot.pose;
    this.shootSpot = { x: p.x, y: p.y };
    if (routine === 'none') this.phase = 'idle';
  }

  update(dt: number): RobotCommand {
    const r = this.robot;
    const cmd: RobotCommand = { ...IDLE_COMMAND, intake: r.capacityLeft > 0 };
    if (r.isClimbing || this.phase === 'idle') return cmd;
    const tLeft = this.ctx.clock.current.id === 'auto' ? this.ctx.clock.periodRemaining : 0;
    this.retarget -= dt;

    if (this.phase === 'shoot-preload') {
      cmd.shoot = this.rules.inAllianceZone(r);
      if (r.held.length === 0) {
        this.phase =
          this.routine === 'shoot-collect' || this.routine === 'shoot-depot' || this.routine === 'depot-climb' ? 'collect' : this.routine === 'shoot-climb' ? 'climb' : 'idle';
      }
      return cmd;
    }

    if (this.routine === 'depot-climb' && this.phase !== 'climb' && tLeft < 7) this.phase = 'climb';
    if (this.phase === 'collect') {
      const back = dist(r.pose, this.shootSpot) / (r.config.maxSpeed * 0.6) + 1.2;
      if (r.held.length >= Math.min(20, r.config.hopperCapacity) || (tLeft < back + 1.5 && r.held.length > 0)) this.phase = 'return';
      const p = this.pickPiece();
      if (p) {
        const face = dist(r.pose, p) < 2.5 ? Math.atan2(p.y - r.pose.y, p.x - r.pose.x) + r.intakeYawOffset : null; // intake face leads
        this.steer(cmd, p, face);
      }
      return cmd;
    }

    if (this.phase === 'return') {
      if (this.rules.inAllianceZone(r)) cmd.shoot = true;
      if (!(this.rules.inAllianceZone(r) && dist(r.pose, this.shootSpot) < 1.2)) this.steer(cmd, this.shootSpot, null);
      // Emptied with time to spare → go get more (or climb).
      if (r.held.length === 0 && this.routine === 'depot-climb') this.phase = 'climb';
      else if (r.held.length === 0 && tLeft > 6) this.phase = 'collect';
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
      if (f.z < 0.3) return f;
    }
    this.retarget = 0.6;
    const me = this.robot.pose;
    let best: FieldPoint | null = null;
    let bestCost = Infinity;
    this.targetPiece = -1;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const f = frame.toField(pool.position(i));
      if (f.z > 0.25 || f.x < 0.2 || f.x > C.FIELD_LENGTH - 0.2 || !this.allowed(f)) continue;
      let cost = Math.hypot(f.x - me.x, f.y - me.y);
      if (routeThroughBands(me, f, BANDS, this.robot.footprint.width / 2, this.robot.config.height) !== f) cost += 1.2;
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
        this.targetPiece = i;
      }
    }
    return best;
  }

  private steer(cmd: RobotCommand, goal: FieldPoint, face: number | null): void {
    const r = this.robot;
    const me = r.pose;
    const wp = routeThroughBands(me, goal, BANDS, r.footprint.width / 2, r.config.height);
    const v = arrive(me, wp, r.config.maxSpeed * 0.85, wp === goal ? 0.8 : 0.3);
    cmd.vx = v.vx;
    cmd.vy = v.vy;
    // G403: brake so the robot can always stop with its bumpers short of the CENTER LINE.
    const room = dir(r.alliance) * (C.CENTER_X - me.x) - Math.max(r.footprint.length, r.footprint.width) / 2 - 0.1;
    const vIn = dir(r.alliance) * cmd.vx, vMax = Math.sqrt(2 * r.config.maxAccel * 0.35 * Math.max(0, room));
    if (vIn > vMax) cmd.vx = dir(r.alliance) * vMax;
    const heading = face ?? (v.dist > 0.3 ? Math.atan2(v.vy, v.vx) : me.yaw);
    cmd.omega = turnToward(me.yaw, heading, r.config.maxOmega * 0.8);
  }
}
