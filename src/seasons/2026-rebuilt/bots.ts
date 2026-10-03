import { CycleBot } from '@engine/ai/cycleBot';
import { dist, routeThroughBands } from '@engine/ai/steering';
import type { SeasonContext } from '@engine/core/season';
import { type Robot, type RobotCommand } from '@engine/robot/robot';
import { BANDS } from './autopilot';
import * as C from './constants';
import { side } from './field';
import type { RebuiltRules } from './rules';

export function createRebuiltBot(ctx: SeasonContext, rules: RebuiltRules, r: Robot): CycleBot {
  const spot = side(r.alliance, 2.6, C.HUB_CENTER.y + (r.station - 2) * 1.35);
  const supply = { ...side(r.alliance, 1.1, C.OUTPOST_AREA_WIDTH / 2), yaw: r.alliance === 'blue' ? 0 : Math.PI };
  let defending = 0;
  let retreatUntil = 0;
  let feeding = false;
  const fromWall = (x: number) => r.alliance === 'blue' ? x : C.FIELD_LENGTH - x;
  const nearestHomeFuel = () => {
    let best: { x: number; y: number } | null = null, cost = Infinity;
    for (let i = 0; i < ctx.pool.count; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (p.z > 0.25 || fromWall(p.x) > C.ALLIANCE_ZONE_DEPTH - 0.35 || fromWall(p.x) < 0.65 || p.y < 0.55 || p.y > C.FIELD_WIDTH - 0.55) continue;
      const d = dist(r.pose, p);
      if (ctx.robots.some((o) => o !== r && o.alliance === r.alliance && o.capacityLeft > 0 && dist(o.pose, p) < d + 0.5)) continue;
      if (d < cost) { best = p; cost = d; }
    }
    return best;
  };
  const scoreOnMove = (): RobotCommand => {
    const piece = r.capacityLeft > 0 ? nearestHomeFuel() : null;
    const goal = rules.inAllianceZone(r) && piece ? piece : spot;
    const yaw = piece ? Math.atan2(piece.y - r.pose.y, piece.x - r.pose.x) + r.intakeYawOffset : undefined;
    const cmd = bot.driveTo(goal, yaw);
    cmd.intake = r.capacityLeft > 0;
    cmd.shoot = rules.inAllianceZone(r) && rules.hubActive(r.alliance);
    return cmd;
  };
  const hardTactics = (dt: number): RobotCommand | null => {
    const active = rules.hubActive(r.alliance), untilActive = rules.secondsUntilActive(r.alliance);
    const travelHome = dist(r.pose, spot) / (r.config.maxSpeed * 0.65) + 2;
    const enemyAlliance = r.alliance === 'blue' ? 'red' : 'blue';
    const enemyActive = rules.hubActive(enemyAlliance);
    const shooter = ctx.robots.find((o) => o.alliance === enemyAlliance && o.lastCommand.shoot && o.held.length > 0);
    const ownScoringRate = r.held.length >= 8 ? r.config.launcher.rate : nearestHomeFuel() ? r.config.launcher.rate * 0.5 : 0;
    const denyRate = shooter?.config.launcher.rate ?? 0;
    const defendWorthwhile = enemyActive && (!active || r.held.length < 8 && denyRate > ownScoringRate * 1.3);
    // Defend during the enemy's active shift; when both hubs are active, compare the potential
    // points denied with this robot's scoring opportunity instead of always sacrificing a scorer.
    // Release contact early and separate fully rather than holding a pin against a wall.
    if (r.station === 3 && defendWorthwhile && ctx.robots.some((o) => o !== r && o.alliance === r.alliance) && ctx.clock.matchRemaining > 30) {
      const enemies = ctx.robots.filter((o) => o.alliance !== r.alliance && !o.isClimbing && !o.tippedOver);
      enemies.sort((a, b) => Number(b.lastCommand.shoot) - Number(a.lastCommand.shoot) || Number(b === ctx.playerRobot) - Number(a === ctx.playerRobot) || b.held.length - a.held.length || dist(r.pose, a.pose) - dist(r.pose, b.pose));
      const enemy = enemies[0];
      if (enemy) {
        const p = enemy.pose, v = enemy.fieldVelocity;
        if (dist(r.pose, p) < 1.25) defending += dt; else defending = Math.max(0, defending - dt);
        if (defending > 1.6) { retreatUntil = ctx.clock.elapsed + 3.3; defending = 0; }
        if (ctx.clock.elapsed < retreatUntil) {
          return bot.driveTo({ x: C.CENTER_X + (r.alliance === 'blue' ? -0.7 : 0.7), y: Math.max(0.8, Math.min(C.FIELD_WIDTH - 0.8, r.pose.y)) });
        }
        // Cut across the opponent's route, with a brief physical challenge when close.
        return bot.driveTo({ x: p.x + v.vx * 0.3, y: p.y + v.vy * 0.3 }, Math.atan2(p.y - r.pose.y, p.x - r.pose.x), enemy);
      }
    }
    if (active || untilActive < travelHome + 2) {
      feeding = false;
      defending = 0;
      if (r.held.length && (rules.inAllianceZone(r) || r.held.length >= 8 || r.capacityLeft === 0 || rules.secondsActiveRemaining(r.alliance) < travelHome + 3)) return scoreOnMove();
      return null;
    }
    if (!ctx.robots.some((o) => o !== r && o.alliance === r.alliance)) {
      if (r.held.length >= 24) { const cmd = bot.driveTo(spot); cmd.intake = r.capacityLeft > 0; return cmd; }
      return null;
    }
    // Keep recycling neutral-zone fuel home instead of parking with a full hopper.
    // Stations use separate feeding lanes; launch through the normal ballistic pass solver.
    if (!r.held.length) feeding = false;
    if (r.held.length >= (r.station === 2 ? 12 : 28) || r.capacityLeft === 0) feeding = true;
    if (feeding) {
      const laneY = 1.1 + (r.station - 1) * 2.4;
      const goal = side(r.alliance, C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE / 2 + 1.3, laneY);
      const cmd = bot.driveTo(goal);
      cmd.intake = r.capacityLeft > 0;
      cmd.pass = !rules.inAllianceZone(r) && dist(r.pose, goal) < 0.9;
      return cmd;
    }
    return null;
  };
  const bot: CycleBot = new CycleBot(ctx, r, {
    batch: 12,
    tactics: (dt) => bot.hard ? hardTactics(dt) : null,
    wantsScore: () => bot.hard ? false : rules.secondsUntilActive(r.alliance) > 2 && r.capacityLeft > 0 ? false : undefined,
    endgame: () => {
      if (ctx.clock.matchRemaining > 20 || !r.config.climber.maxLevel) return null;
      const slot = rules.freeSlot(r);
      if (!slot) return null;
      const cmd = bot.driveTo(slot.pose, slot.pose.yaw);
      if (slot.dist < 0.75) cmd.climb = r.config.climber.maxLevel;
      return cmd;
    },
    accepts: (_i, p) => bot.hard ? fromWall(p.x) < C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH - 0.5 : fromWall(p.x) < C.CENTER_X + 0.3,
    supply: () => supply,
    route: (goal) => routeThroughBands(r.pose, goal, BANDS, Math.max(r.footprint.width, r.footprint.length) / 2, r.config.height, bot.hard),
    score: () => {
      const waiting = rules.secondsUntilActive(r.alliance) > 3;
      const patrol = side(r.alliance, C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE / 2 + 1.1, 1.2 + (r.station - 1) * 2.4);
      const cmd = bot.driveTo(waiting ? patrol : spot);
      cmd.intake = r.capacityLeft > 0;
      // A teammate or parked driver may occupy the preferred spot; the whole alliance zone allows shots.
      cmd.shoot = rules.inAllianceZone(r) && rules.hubActive(r.alliance);
      return cmd;
    },
  });
  return bot;
}
