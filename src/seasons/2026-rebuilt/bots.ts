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
  let defenseTarget = -1;
  let retreatUntil = 0;
  let feeding = false;
  const fromWall = (x: number) => r.alliance === 'blue' ? x : C.FIELD_LENGTH - x;
  const canRaid = (p: { x: number; y: number }) => {
    // Only cross into the opposing zone when there is time to collect and bring the load home.
    const trip = (dist(r.pose, p) + dist(p, spot)) / (r.config.maxSpeed * 0.65) + 8;
    return !rules.hubActive(r.alliance) && rules.secondsUntilActive(r.alliance) > trip;
  };
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
  /** How much an opponent threatens to score right now: FUEL on board, more when shooting or near its zone. */
  const threat = (o: Robot) => {
    const homeDist = Math.abs(o.pose.x - side(o.alliance, C.ALLIANCE_ZONE_DEPTH, 0).x);
    return o.held.length * (o.lastCommand.shoot ? 2 : rules.inAllianceZone(o) ? 1.5 : 1) / (1 + homeDist / 4)
      + (o.lastCommand.shoot ? 10 : 0) + (o === ctx.playerRobot ? 4 : 0) - dist(r.pose, o.pose) * 0.6;
  };
  const defend = (enemyAlliance: 'blue' | 'red'): RobotCommand | null => {
    const enemies = ctx.robots.filter((o) => o.alliance === enemyAlliance && !o.isClimbing && !o.tippedOver);
    if (!enemies.length) return null;
    // Stay on one mark unless another opponent becomes clearly more dangerous; switching constantly
    // let scorers slip away while the defender turned around.
    let enemy = enemies.find((o) => o.id === defenseTarget);
    const best = enemies.reduce((a, b) => threat(b) > threat(a) ? b : a);
    if (!enemy || threat(best) > threat(enemy) + 6) enemy = best;
    defenseTarget = enemy.id;
    const p = enemy.pose, v = enemy.fieldVelocity;
    const away = Math.atan2(r.pose.y - p.y, r.pose.x - p.x);
    // G418: back off before the 3-count runs out, and stay 6 ft clear until it resets.
    if (rules.pinCount(r.id) > 1.2) retreatUntil = ctx.clock.elapsed + 3.2;
    if (ctx.clock.elapsed < retreatUntil) {
      if (rules.pinCount(r.id) === 0 && dist(r.pose, p) > 2.4) retreatUntil = 0;
      const out = { x: p.x + Math.cos(away) * 2.6, y: p.y + Math.sin(away) * 2.6 };
      return bot.driveTo({ x: Math.max(0.8, Math.min(C.FIELD_LENGTH - 0.8, out.x)), y: Math.max(0.8, Math.min(C.FIELD_WIDTH - 0.8, out.y)) });
    }
    // Get goal-side: between the opponent and its HUB, leading its motion by our time to get there.
    const hub = rules.hubCenter(enemyAlliance);
    const lead = Math.min(1, dist(r.pose, p) / (r.config.maxSpeed * 0.9));
    const q = { x: p.x + v.vx * lead, y: p.y + v.vy * lead };
    const toHub = Math.atan2(hub.y - q.y, hub.x - q.x);
    const reach = (Math.hypot(r.footprint.width, r.footprint.length) + Math.hypot(enemy.footprint.width, enemy.footprint.length)) / 2;
    const goalSide = { x: q.x + Math.cos(toHub) * reach * 0.8, y: q.y + Math.sin(toHub) * reach * 0.8 };
    const between = Math.cos(Math.atan2(r.pose.y - p.y, r.pose.x - p.x) - toHub) > 0.3;
    if (!between && dist(r.pose, p) > reach + 0.4) return bot.driveTo(goalSide, toHub + Math.PI, undefined, 0.2);
    // In front of it: drive through it, shoving it off its line (and out of its ALLIANCE ZONE) at full power.
    const shove = { x: p.x - Math.cos(toHub) * 0.8, y: p.y - Math.sin(toHub) * 0.8 };
    const cmd = bot.driveTo(shove, toHub + Math.PI, enemy, 0.05);
    return cmd;
  };
  const hardTactics = (_dt: number): RobotCommand | null => {
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
    if (r.station === 3 && defendWorthwhile && ctx.robots.some((o) => o !== r && o.alliance === r.alliance) && ctx.clock.matchRemaining > 30) {
      const cmd = defend(enemyAlliance);
      if (cmd) return cmd;
    } else defenseTarget = -1;
    if (active || untilActive < travelHome + 2) {
      feeding = false;
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
      // Feed along the outer lanes rather than over the hub cup, where a rebound can
      // accidentally turn a legal pass into an outside-zone scoring foul.
      const laneY = r.station === 2 ? C.FIELD_WIDTH - 1.1 : r.station === 1 ? 1.1 : 2.4;
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
    accepts: (_i, p) => bot.hard ? fromWall(p.x) < C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH - 0.5 || canRaid(p) : fromWall(p.x) < C.CENTER_X + 0.3,
    pieceCost: (p) => {
      if (!bot.hard || rules.hubActive(r.alliance)) return 0;
      const x = fromWall(p.x);
      // Leave fed fuel for home scorers; station 1 raids accessible opposing stock, while
      // station 2 keeps the shorter neutral-to-home feeding cycle running.
      if (x < C.ALLIANCE_ZONE_DEPTH) return 4;
      if (x > C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH) return r.station === 1 && canRaid(p) ? -4 : 2;
      return -1;
    },
    supply: () => supply,
    route: (goal) => routeThroughBands(r.pose, goal, BANDS, Math.max(r.footprint.width, r.footprint.length) / 2, r.clearanceHeight, bot.hard),
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
