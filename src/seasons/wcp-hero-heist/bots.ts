import { CycleBot } from '@engine/ai/cycleBot';
import { TeamBrain } from '@engine/ai/team';
import { dist, turnToward } from '@engine/ai/steering';
import { convexOverlap, pointInPolygon } from '@engine/zones';
import type { FieldPoint, FieldPose } from '@engine/coords';
import type { AiChoice, AutoRoutine, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { clamp, wrapAngle } from '@engine/units';
import { FIELD_LENGTH, FIELD_WIDTH, pieceIdentity } from './constants';
import { heroClass, storage } from './config';
import { CHUTE, CX, DISTRICTS, LAUNCH_ZONES, PAD_Y, collectorZone, homeZone, mirrorX, panelSlotX, towerZone, trussX, type District } from './geometry';
import { levelOf } from './ownership';
import { mailboxTier, type HeroHeistRules } from './rules';

export const HERO_AI_STRATEGIES: AiChoice[] = [
  { id: 'auto', label: 'Adaptive', description: 'Claims and farms; when behind late it switches to stripping the opponent\'s districts.' },
  { id: 'claim', label: 'Claim and farm', description: 'Panel robots claim neutral districts and strip opponent ones; shooters farm districts the squad owns for 3 points a bubble; everyone climbs in the last 20 s.' },
  { id: 'strip', label: 'Strip', description: 'Everything goes at the opponent\'s owned districts: panels take 4 OWNERSHIP away, bubbles 1 each. Costs our own FAME but erases their ownership points.' },
  { id: 'press', label: 'Press', description: 'Claim and farm, plus one robot defends the opponents\' best scorer whenever it is outside its protected zones.' },
];
export const HERO_AI_ROLES: AiChoice[] = [
  { id: 'claimer', label: 'Claimer', description: 'Delivers STORY PANELS: +2 OWNERSHIP in neutral or own districts, -4 in opponent districts.' },
  { id: 'farmer', label: 'Farmer', description: 'Shoots SPEECH BUBBLES into districts its squad owns (3 FAME each) or nudges neutral ones toward ownership.' },
  { id: 'defender', label: 'Defender', description: 'Contests the opponents\' best scorer outside their COLLECTOR, HOME and (late) TOWER ZONES, then climbs.' },
];

/** Panel robots claim, shooters farm; on Press the weakest shooter defends. The player's orders win. */
function planRoles(team: TeamBrain): Map<number, string> {
  const roles = new Map<number, string>();
  const free: Robot[] = [];
  for (const r of team.members) {
    const ordered = team.orderedRole(r);
    if (ordered !== 'auto') roles.set(r.id, ordered);
    else if (r === team.ctx.playerRobot) roles.set(r.id, r.config.placement?.enabled ? 'claimer' : 'farmer');
    else free.push(r);
  }
  for (const r of free) roles.set(r.id, r.config.placement?.enabled && storage(r.config).panels >= storage(r.config).bubbles / 2 ? 'claimer' : 'farmer');
  if (team.strategy === 'press' && team.members.length >= 3 && ![...roles.values()].includes('defender')) {
    const shooter = free.filter(r => roles.get(r.id) === 'farmer').sort((a, b) => storage(a.config).bubbles * a.config.launcher.rate - storage(b.config).bubbles * b.config.launcher.rate)[0];
    if (shooter) roles.set(shooter.id, 'defender');
  }
  return roles;
}

/** Adaptive: claim and farm, but strip the opponent's districts when trailing in the second half. */
function adaptHero(team: TeamBrain): { id: string; reason: string } | null {
  const c = team.ctx.clock;
  if (c.mode === 'teleop' && c.driveRemaining < 60 && team.scout.margin() < -40) return { id: 'strip', reason: 'behind late: take their districts away' };
  return { id: 'claim', reason: 'claim districts with panels, farm them with bubbles' };
}

export const AUTO_ROUTINES: AutoRoutine[] = [
  { id: 'score', label: 'Leave + score preloads', description: 'Leave the TOWER ZONE (AUTO RP), deliver the preloaded panel and/or shoot preloaded bubbles, then keep cycling on your side of the CENTER LINE.' },
  { id: 'leave', label: 'Leave only', description: 'Drive fully out of the TOWER ZONE toward the center and stop (counts toward the AUTO RP).' },
  { id: 'none', label: 'Do nothing', description: 'Stay in the TOWER ZONE (the squad loses the AUTO exit RP).' },
];

/** Where a bubble robot stands to shoot at a CITY BLOCK: straight out from the window, inside the LAUNCH ZONE. */
export function shootingSpot(d: District, standoff = 2.6): FieldPoint {
  const c = d.cityBlock.center, n = d.cityBlock.normal;
  const h = Math.hypot(n.x, n.y);
  const dir = h > 0.1 ? { x: n.x / h, y: n.y / h } : { x: 0, y: 1 };
  const spot = { x: c.x + dir.x * standoff, y: c.y + dir.y * standoff };
  return { x: clamp(spot.x, 1.2, FIELD_LENGTH - 1.2), y: clamp(spot.y, 1.0, FIELD_WIDTH - 0.8) };
}
const inLaunch = (p: FieldPoint) => LAUNCH_ZONES.some(z => pointInPolygon(p, z));

/** Teleop and AUTO brain: real intakes, the real launcher and the real placement mechanism (rules.ts). */
export function createHeroBot(ctx: SeasonContext, rules: HeroHeistRules, r: Robot, auto = false): CycleBot {
  const a = r.alliance;
  const team = TeamBrain.for(ctx, a);
  team.usePlanner(planRoles);
  team.useAdapter('claim', adaptHero, HERO_AI_STRATEGIES);
  const stripping = () => team.strategy === 'strip';
  const cap = storage(r.config);
  const panels = () => rules.panelCount(r);
  const half = r.footprint.length / 2;
  const ownSide = (x: number) => (a === 'blue' ? Math.min(x, CX - half - 0.15) : Math.max(x, CX + half + 0.15));
  let climbPad: number | null = null;
  let shootAt: District | null = null;
  let mailbox: District | null = null;

  /** Panel value: strip opponent ownership first, then neutral districts, then finish our own partial ones. */
  const pickMailbox = (): District | null => {
    let best: District | null = null, bestCost = Infinity;
    for (const d of DISTRICTS) {
      if (mailboxTier(d.mailbox) > (r.config.placement?.maxLevel ?? 0)) continue;
      const s = rules.ownership.districts[d.id], lvl = levelOf(s);
      if (s.support === a && lvl === 'full') continue;
      const opp = s.support && s.support !== a && lvl !== 'neutral';
      const gain = opp ? (lvl === 'full' ? 3.2 : 2.4) * (stripping() ? 2 : 1) : s.support === a ? 2.2 : 2;
      if (auto && (a === 'blue' ? d.mailbox.entry.x > CX - 0.6 : d.mailbox.entry.x < CX + 0.6)) continue;
      const taken = ctx.robots.some(o => o !== r && o.alliance === a && rules.plannedMailbox.get(o.id) === d.id);
      const cost = dist(r.pose, d.mailbox.entry) / 2 - gain + (taken ? 4 : 0);
      if (cost < bestCost) { bestCost = cost; best = d; }
    }
    return best;
  };
  const pickBlock = (): District | null => {
    let best: District | null = null, bestCost = Infinity;
    for (const d of DISTRICTS) {
      const s = rules.ownership.districts[d.id], lvl = levelOf(s);
      const value = lvl !== 'neutral' ? (s.support === a ? (stripping() ? 1.5 : 3) : stripping() ? 2.5 : 0.4) : s.support === a ? 1.8 : 1;
      const spot = shootingSpot(d);
      if (!inLaunch(spot) || (auto && (a === 'blue' ? spot.x > CX - half - 0.2 : spot.x < CX + half + 0.2))) continue;
      const cost = dist(r.pose, spot) / 2.5 - value * 1.5;
      if (cost < bestCost) { bestCost = cost; best = d; }
    }
    return best;
  };

  const placeCommand = (): RobotCommand => {
    if (!mailbox || mailboxTier(mailbox.mailbox) > (r.config.placement?.maxLevel ?? 0)) mailbox = pickMailbox();
    if (!mailbox) return { ...IDLE_COMMAND };
    rules.plannedMailbox.set(r.id, mailbox.id);
    const m = mailbox.mailbox;
    const fx = Math.cos(m.yaw), fy = Math.sin(m.yaw);
    const pose = rules.alignPose(r, mailbox);
    const staging = { x: pose.x - fx * 0.7, y: pose.y - fy * 0.7 };
    const d = dist(r.pose, pose), yawErr = Math.abs(wrapAngle(m.yaw - r.pose.yaw));
    // Approach square to the wall from 0.7 m out, then creep in and let the placement assist finish.
    if (d > 0.25 && (dist(r.pose, staging) > 0.15 || yawErr > 0.3) && d > dist(staging, pose) - 0.05) return bot.driveTo(staging, m.yaw, undefined, 0.5);
    const cmd = bot.driveTo(pose, m.yaw, undefined, 0.35);
    cmd.vx *= 0.6; cmd.vy *= 0.6;
    cmd.omega = turnToward(r.pose.yaw, m.yaw, r.config.maxOmega, 6);
    if (d < 0.12) cmd.pass = true;
    return cmd;
  };

  const shootCommand = (): RobotCommand => {
    if (!shootAt || ctx.clock.elapsed % 4 < 0.02) shootAt = pickBlock();
    if (!shootAt) return { ...IDLE_COMMAND };
    rules.preferredBlock.set(r.id, shootAt.id);
    const spot = shootingSpot(shootAt);
    if (auto) spot.x = ownSide(spot.x);
    const c = shootAt.cityBlock.center;
    const face = Math.atan2(c.y - r.pose.y, c.x - r.pose.x);
    const there = dist(r.pose, spot) < 0.45;
    const cmd = bot.driveTo(spot, r.config.launcher.turret ? r.pose.yaw : face, undefined, 0.6);
    if (!there || !rules.fullyInLaunchZone(r)) return cmd;
    // Settle before firing: a turret may creep, a chassis shooter stops and squares up on the window.
    const creep = r.config.launcher.turret ? 0.35 : 0;
    const v = Math.hypot(cmd.vx, cmd.vy);
    if (v > creep) { cmd.vx *= creep / v; cmd.vy *= creep / v; }
    if (!r.config.launcher.turret) cmd.omega = turnToward(r.pose.yaw, face, r.config.maxOmega, 6);
    const aligned = r.config.launcher.turret || r.config.autoAlign || Math.abs(wrapAngle(face - r.pose.yaw)) < 0.05;
    cmd.shoot = aligned && r.speed < 0.5;
    return cmd;
  };

  const strategy = {
    batch: Math.max(1, cap.bubbles),
    wantsScore: () => {
      if (panels() > 0 && (panels() >= cap.panels || !nearbyOwn('panel', 3))) return true;
      if (r.held.length > 0 && (r.held.length >= cap.bubbles || !rules.canTake(r, 'bubble') || !nearbyOwn('bubble', 2.5))) return true;
      return panels() > 0 || r.held.length > 0 ? undefined : false;
    },
    score: (): RobotCommand => (panels() > 0 && (r.config.placement?.enabled ?? false) ? placeCommand() : r.held.length > 0 ? shootCommand() : { ...IDLE_COMMAND }),
    accepts: (i: number, p: FieldPoint) => {
      const id = pieceIdentity(i);
      if (id.color !== a || !rules.canTake(r, id.kind)) return false;
      if (auto && (a === 'blue' ? p.x > CX - half - 0.2 : p.x < CX + half + 0.2)) return false;
      return !convexOverlap([p, { x: p.x + 0.01, y: p.y }, { x: p.x, y: p.y + 0.01 }], homeZone(a === 'blue' ? 'red' : 'blue'));
    },
    supply: (): FieldPose => {
      // Wait where the human player can feed: the bubble chute or the panel slide, intake side toward the wall.
      const wantPanel = rules.canTake(r, 'panel') && (cap.bubbles === 0 || panels() > 0 || heroClass(r.config) === 'commander');
      const yaw = (a === 'blue' ? Math.PI : 0) + r.intakeYawOffset;
      if (wantPanel) return { x: panelSlotX(a, 1), y: half + 0.45, yaw: -Math.PI / 2 + r.intakeYawOffset };
      return { x: mirrorX(a, half + 0.3), y: clamp((CHUTE.y0 + CHUTE.y1) / 2, half + 0.1, 2), yaw };
    },
    endgame: (): RobotCommand | null => {
      if (auto || r.config.climber.maxLevel === 0 || ctx.clock.mode !== 'teleop' || ctx.clock.driveRemaining > 15) return null;
      if (climbPad === null || ctx.robots.some(o => o !== r && o.alliance === a && o.climbSlot === climbPad)) {
        const free = PAD_Y.map((_, k) => k).filter(k => !ctx.robots.some(o => o !== r && o.alliance === a && (o.climbSlot === k || (o.climbPhase === 'none' && Math.abs(o.pose.x - trussX(a)) < 0.3 && Math.abs(o.pose.y - PAD_Y[k]) < 0.4))));
        climbPad = free.sort((p, q) => Math.abs(PAD_Y[p] - r.pose.y) - Math.abs(PAD_Y[q] - r.pose.y))[0] ?? null;
      }
      if (climbPad === null) return null;
      const pad = { x: trussX(a), y: PAD_Y[climbPad] };
      const cmd = bot.driveTo(pad, a === 'blue' ? 0 : Math.PI, undefined, 0.4);
      if (dist(r.pose, pad) < 0.2) { cmd.vx = cmd.vy = 0; cmd.climb = r.config.climber.maxLevel; }
      return cmd;
    },
    tactics: (): RobotCommand | null => {
      // Defender: shadow the opponents' best scorer, but never touch it inside its protected zones (G14).
      if (auto || team.role(r) !== 'defender' || ctx.clock.mode !== 'teleop' || ctx.clock.driveRemaining < 22) return null;
      const target = team.scout.topScorer() ?? team.opponents[0];
      if (!target) return null;
      const safe = !strategy.cautious(target);
      const goal = { x: CX, y: target.pose.y };
      if (!safe) return bot.driveTo({ x: (target.pose.x + CX) / 2, y: clamp(target.pose.y, 1.5, FIELD_WIDTH - 1.5) }, Math.atan2(target.pose.y - r.pose.y, target.pose.x - r.pose.x));
      return bot.defend(target, goal);
    },
    cautious: (o: Robot) => ['collector', 'home'].some(z => convexOverlap(o.corners(), z === 'collector' ? collectorZone(o.alliance) : homeZone(o.alliance)))
      || (ctx.clock.current.id === 'endgame' && convexOverlap(o.corners(), towerZone(o.alliance))),
    route: (goal: FieldPoint): FieldPoint => {
      // AUTO: stay on our side of the CENTER LINE (G04). Detour around the DOWNTOWN / UPTOWN ends rather than into them.
      const g = auto ? { x: ownSide(goal.x), y: goal.y } : goal;
      return g;
    },
    onStuck: () => { mailbox = null; shootAt = null; },
  };
  const nearbyOwn = (kind: 'bubble' | 'panel', radius: number) => {
    const { pool, frame } = ctx;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const id = pieceIdentity(i);
      if (id.kind !== kind || id.color !== a) continue;
      const p = frame.toField(pool.position(i));
      if (p.z < 0.3 && Math.hypot(p.x - r.pose.x, p.y - r.pose.y) < radius) return true;
    }
    return false;
  };
  const bot = new CycleBot(ctx, r, strategy);
  return bot;
}

/** Scripted AUTO: leave the TOWER ZONE, then run the same brain restricted to our side of the CENTER LINE. */
export class HeroAutoPilot {
  private readonly bot: CycleBot | null;
  private left = false;
  constructor(ctx: SeasonContext, rules: HeroHeistRules, private readonly robot: Robot, private readonly routine: string) {
    this.bot = routine === 'score' ? createHeroBot(ctx, rules, robot, true) : null;
  }
  update(dt: number): RobotCommand {
    const r = this.robot;
    if (this.routine === 'none') return { ...IDLE_COMMAND };
    if (!this.left) {
      if (!convexOverlap(r.corners(), towerZone(r.alliance))) this.left = true;
      else {
        const to = { x: mirrorX(r.alliance, 5.6), y: clamp(r.pose.y, 1.8, FIELD_WIDTH - 1.2) };
        const d = Math.hypot(to.x - r.pose.x, to.y - r.pose.y) || 1;
        const v = Math.min(2.2, r.config.maxSpeed);
        return { ...IDLE_COMMAND, vx: ((to.x - r.pose.x) / d) * v, vy: ((to.y - r.pose.y) / d) * v };
      }
    }
    if (!this.bot) return { ...IDLE_COMMAND };
    return this.bot.update(dt);
  }
}
