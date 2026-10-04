import { aroundCircles, clusterCounts, CycleBot } from '@engine/ai/cycleBot';
import { dist, routeThroughBands } from '@engine/ai/steering';
import { TeamBrain } from '@engine/ai/team';
import type { FieldPoint } from '@engine/coords';
import type { AiChoice, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { clamp } from '@engine/units';
import { BANDS } from './autopilot';
import * as C from './constants';
import { side, towerSlots } from './field';
import type { RebuiltRules } from './rules';

export const REBUILT_AI_STRATEGIES: AiChoice[] = [
  { id: 'auto', label: 'Adaptive', description: 'Reads the match every few seconds and switches between the plans below: shift control by default, pressing the opponents when that pays (see docs/AI-STRATEGY.md for the benchmarks behind each switch).' },
  { id: 'shift', label: 'Shift control', description: 'Everyone scores: fill hoppers while your HUB is inactive, stage at the zone line, dump the moment it lights up, then climb as high as possible.' },
  { id: 'press', label: 'Press', description: 'Shift control, but a robot that is already full while your HUB is inactive goes and contests the opponents’ best shooter until it is time to come back.' },
  { id: 'stockpile', label: 'Stockpile', description: 'A dedicated feeder stays in the NEUTRAL ZONE lobbing FUEL into your zone all match; scorers shoot from the pile.' },
  { id: 'defense', label: 'Lockdown', description: 'A dedicated defender contests the opponents’ best shooter whenever their HUB is active.' },
];

export const REBUILT_AI_ROLES: AiChoice[] = [
  { id: 'scorer', label: 'Scorer', description: 'Collects to a full hopper, stages at the zone line and scores during active shifts.' },
  { id: 'feeder', label: 'Feeder', description: 'Works the NEUTRAL ZONE, intaking and lobbing FUEL into your ALLIANCE ZONE for the scorers.' },
  { id: 'defender', label: 'Defender', description: 'Scores during your active shifts and contests opponent shooters during theirs.' },
];

/** Robots fit for the scoring role first: biggest hopper × fire rate. */
const scoringPower = (r: Robot) => r.config.hopperCapacity * r.config.launcher.rate * (r.config.launcher.enabled ? 1 : 0);

function planRoles(team: TeamBrain): Map<number, string> {
  const roles = new Map<number, string>();
  const robots = team.members;
  const free: Robot[] = [];
  for (const r of robots) {
    const ordered = team.orderedRole(r);
    if (ordered !== 'auto') roles.set(r.id, ordered);
    else if (r === team.ctx.playerRobot) roles.set(r.id, 'scorer');
    else free.push(r);
  }
  free.sort((a, b) => scoringPower(a) - scoringPower(b));
  const taken = (role: string) => [...roles.values()].includes(role);
  for (const r of free) roles.set(r.id, 'scorer');
  const weakest = free[0];
  if (weakest && robots.length >= 3) {
    if (team.strategy === 'stockpile' && !taken('feeder')) roles.set(weakest.id, 'feeder');
    if (team.strategy === 'defense' && !taken('defender')) roles.set(weakest.id, 'defender');
  }
  return roles;
}

/**
 * Adaptive plan for 'auto'. Benchmarks (docs/AI-STRATEGY.md): Press beats Shift control by ~200 points a match and
 * every other plan, whoever the opponents are; it already aims its pressure at whoever is hurting us most (the
 * opponents' top scorer — usually the human driver). Late in the match Press switches itself off (robots stay home
 * to dump and climb), so the adapter only has to pick the alliance's posture.
 */
function adaptRebuilt(team: TeamBrain): { id: string; reason: string } | null {
  const top = team.scout.topScorer();
  const target = top ? team.label(top).replace('You', 'the driver') : 'their best shooter';
  return { id: 'press', reason: `full robots hound ${target} while our HUB is off` };
}

interface RebuiltPlan {
  /** Last hub state announced on the radio. */
  announced: string;
}

export function createRebuiltBot(ctx: SeasonContext, rules: RebuiltRules, r: Robot): CycleBot {
  const team = TeamBrain.for(ctx, r.alliance);
  team.usePlanner(planRoles);
  team.useAdapter('shift', adaptRebuilt, REBUILT_AI_STRATEGIES);
  const plan = team.memo<RebuiltPlan>('rebuilt', () => ({ announced: '' }));
  const enemy = r.alliance === 'blue' ? 'red' : 'blue';
  const fromWall = (x: number) => (r.alliance === 'blue' ? x : C.FIELD_LENGTH - x);
  const half = Math.max(r.footprint.width, r.footprint.length) / 2;
  const speed = () => r.config.maxSpeed * bot.pace * 0.8;
  const laneY = (k: number) => [1.35, C.FIELD_WIDTH - 1.35, C.FIELD_WIDTH / 2 + 1.75][k % 3];
  const myLane = () => laneY(r.station - 1);
  // Shooting spot inside the ALLIANCE ZONE, ~2-3 m from the HUB (best accuracy), on our own lane when far away.
  const shootSpot = (): FieldPoint => {
    if (chassisAim) return stanceSpot();
    const p = r.pose;
    const y = clamp(fromWall(p.x) < C.ALLIANCE_ZONE_DEPTH + 1.5 ? p.y : myLane(), 1.0, C.FIELD_WIDTH - 1.0);
    return { x: side(r.alliance, 2.7, 0).x, y };
  };
  const towerCenter = side(r.alliance, C.TOWER_DEPTH / 2, C.TOWER_CENTER_Y);
  const tower = { ...towerCenter, r: Math.hypot(C.TOWER_DEPTH, C.TOWER_WIDTH) / 2 + half * 0.7 };
  // Crossing a hub row costs time; a robot too tall for the TRENCH has to go over a BUMP, which costs more.
  const rowCost = () => r.clearanceHeight > C.TRENCH_CLEARANCE ? 2.5 : 1.2;
  const travelTime = (goal: FieldPoint) => dist(r.pose, goal) / Math.max(1, speed()) + (routeThroughBands(r.pose, goal, BANDS, half, r.clearanceHeight) !== goal ? rowCost() : 0.3);
  /** Our TOWER climb spot: each teammate claims a different one so nobody races a teammate for it. */
  const mySlot = (): { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null => {
    const claims = team.memo('towerClaims', () => new Map<number, number>());
    const slots = towerSlots(r.alliance, r.footprint.length, r.footprint.width);
    const takenByOther = (i: number) => team.members.some((o) => o !== r && (o.climbSlot === i || claims.get(o.id) === i));
    let idx = claims.get(r.id);
    if (idx === undefined || takenByOther(idx)) {
      const free = slots.map((p, i) => ({ i, d: dist(r.pose, p) })).filter(({ i }) => !takenByOther(i)).sort((a, b) => a.d - b.d);
      if (!free.length) return null;
      idx = free[0].i;
    }
    return { idx, pose: slots[idx], dist: dist(r.pose, slots[idx]) };
  };
  const claimSlot = (idx: number) => team.memo('towerClaims', () => new Map<number, number>()).set(r.id, idx);
  const inZone = () => rules.inAllianceZone(r);
  const insideZone = () => fromWall(r.pose.x) < C.ALLIANCE_ZONE_DEPTH - half - 0.05;

  // Fuel on the carpet, scanned once per tick for the whole alliance.
  const fuel = () => team.memo('fuelScan', () => ({ t: -1, pts: [] as { i: number; p: FieldPoint }[] }));
  const scanFuel = () => {
    const s = fuel();
    if (s.t === ctx.clock.elapsed) return s.pts;
    s.t = ctx.clock.elapsed;
    s.pts = [];
    for (let i = 0; i < ctx.pool.count; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (p.z > 0.25 || p.x < 0.5 || p.x > C.FIELD_LENGTH - 0.5 || p.y < 0.5 || p.y > C.FIELD_WIDTH - 0.5) continue;
      s.pts.push({ i, p });
    }
    return s.pts;
  };
  // TRENCH lanes (both hub rows): FUEL that collects under them packs a robot in, so a lane with a pile in it is
  // treated as closed and robots go over a BUMP instead.
  const trenchLanes = BANDS.flatMap((band) => band.gaps.filter((g) => g.maxRobotHeight !== undefined).map((gap) => ({ band, gap })));
  const inTrench = (p: FieldPoint) => trenchLanes.some(({ band, gap }) => inLane(p, band, gap));
  const inLane = (p: FieldPoint, band: (typeof BANDS)[number], gap: (typeof BANDS)[number]['gaps'][number]) =>
    p.x > band.xMin - 0.2 && p.x < band.xMax + 0.2 && p.y > gap.yMin && p.y < gap.yMax;
  const openBands = () => {
    const m = team.memo('bands', () => ({ t: -1, bands: BANDS }));
    if (m.t === ctx.clock.elapsed) return m.bands;
    m.t = ctx.clock.elapsed;
    const fuelNow = scanFuel();
    m.bands = BANDS.map((band) => ({ ...band, gaps: band.gaps.filter((gap) => gap.maxRobotHeight === undefined || fuelNow.filter(({ p }) => inLane(p, band, gap)).length < 8) }));
    return m.bands;
  };
  // FUEL tucked against either TOWER can't be reached by an intake.
  const nearTower = (p: FieldPoint) => (['blue', 'red'] as const).some((a) => {
    const t = side(a, C.TOWER_DEPTH / 2, C.TOWER_CENTER_Y);
    return Math.abs(p.x - t.x) < C.TOWER_DEPTH / 2 + 0.35 && Math.abs(p.y - t.y) < C.TOWER_WIDTH / 2 + 0.35;
  });
  // FUEL we chased without getting closer (wedged against a wall, under a robot) is skipped for a while.
  const blocked: { p: FieldPoint; until: number }[] = [];
  let chase: { p: FieldPoint; best: number; since: number } | null = null;
  const isBlocked = (p: FieldPoint) => blocked.some((b) => b.until > ctx.clock.elapsed && dist(b.p, p) < 0.6);
  /** Nearest worthwhile FUEL under `filter`, spreading teammates over different patches. */
  const canRaid = (p:FieldPoint) => !rules.hubActive(r.alliance) && rules.secondsUntilActive(r.alliance) > (dist(r.pose,p)+dist(p,shootSpot()))/Math.max(1,r.config.maxSpeed*.65)+8;
  const nearestFuel = (filter: (p: FieldPoint) => boolean, maxCost = Infinity): FieldPoint | null => {
    const mates = team.members.filter((o) => o !== r && o.capacityLeft > 0 && !o.isClimbing);
    let best: FieldPoint | null = null, cost = maxCost;
    const candidates=scanFuel().filter(({p})=>filter(p) && (fromWall(p.x)<=C.FIELD_LENGTH-C.ALLIANCE_ZONE_DEPTH-.3 || canRaid(p)) && !isBlocked(p) && !nearTower(p));
    const density=clusterCounts(candidates.map(({p})=>p),1.2);
    for (const [idx,{p}] of candidates.entries()) {
      // Stay off the HUB/BUMP/TRENCH row: fuel there is slow to reach.
      const inRow = Math.abs(fromWall(p.x) - C.HUB_CENTER.x) < C.HUB_SIZE / 2 + 0.3;
      if (inTrench(p)) continue; // FUEL under a TRENCH jams robots that go in after it
      let c = dist(r.pose, p) + (inRow ? 1.5 : 0) - .4*Math.min(density[idx]-1,r.capacityLeft-1,12);
      for (const m of mates) if (dist(m.pose, p) + 0.4 < dist(r.pose, p)) c += 2.5;
      if (c < cost) { cost = c; best = p; }
    }
    return best;
  };
  const trackChase = (p: FieldPoint) => {
    const d = dist(r.pose, p), t = ctx.clock.elapsed;
    if (!chase || dist(chase.p, p) > 0.5 || d < chase.best - 0.25) chase = { p, best: d, since: t };
    else if (t - chase.since > 1.8) { blocked.push({ p, until: t + 6 }); chase = null; }
    if (blocked.length > 40) blocked.splice(0, blocked.length - 40);
  };
  const collect = (p: FieldPoint, extra?: Partial<RobotCommand>): RobotCommand => {
    trackChase(p);
    const yaw = dist(r.pose, p) < 3 ? Math.atan2(p.y - r.pose.y, p.x - r.pose.x) + r.intakeYawOffset : undefined;
    return { ...bot.driveTo(p, yaw,undefined,.3), intake: r.capacityLeft > 0, ...extra };
  };

  // Chassis-aimed robots (dumpers, fixed shooters) score like real drivers play them: drive to a stance ~1.8 m from the
  // HUB facing it, stop, square up and unload. Measured standing still: 97-100% from 1.6-2 m, vs ~40% firing while
  // chasing FUEL around the zone. Turrets keep shooting on the move.
  const chassisAim = !r.config.launcher.turret;
  const hubP = side(r.alliance, C.HUB_CENTER.x, C.HUB_CENTER.y);
  const towardWall = r.alliance === 'blue' ? Math.PI : 0;
  const stanceSpot = (): FieldPoint => {
    // Angle around the HUB on the wall side, from where the robot is; teammates already there push it round.
    const off = (a: number) => wrap(a - towardWall);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let a = towardWall + clamp(off(Math.atan2(r.pose.y - hubP.y, r.pose.x - hubP.x)), -0.8, 0.8);
    const spotAt = (ang: number) => {
      // Far enough that the whole bumper stays inside the ALLIANCE ZONE (the HUB straddles the zone line).
      const minD = (C.ALLIANCE_ZONE_DEPTH - C.HUB_CENTER.x) * -1 + half + 0.12;
      const d = Math.max(1.8, minD / Math.max(0.35, Math.abs(Math.cos(ang - towardWall))));
      return { x: hubP.x + Math.cos(ang) * d, y: clamp(hubP.y + Math.sin(ang) * d, half + 0.3, C.FIELD_WIDTH - half - 0.3) };
    };
    for (let k = 0; k < 3; k++) {
      const p = spotAt(a);
      const taken = team.members.some((o) => o !== r && dist(o.pose, p) < Math.max(o.footprint.length, o.footprint.width) + 0.15);
      if (!taken) return p;
      a = towardWall + clamp(off(a) + (off(a) >= 0 ? -0.55 : 0.55) * (k + 1) * (k % 2 ? -1 : 1), -0.8, 0.8);
    }
    return spotAt(a);
  };
  const stanceCommand = (live: boolean): RobotCommand => {
    const spot = stanceSpot();
    const face = Math.atan2(hubP.y - spot.y, hubP.x - spot.x);
    const there = dist(r.pose, spot) < 0.3;
    const cmd = there ? { ...IDLE_COMMAND, omega: 0 } : bot.driveTo(spot, face, undefined, 0.5);
    cmd.intake = r.capacityLeft > 0;
    // Fire once planted (auto-align squares the chassis and holds the first shot until aligned). Once a burst is going
    // the robot keeps firing wherever it points, so a driver lets off the trigger while the robot is being shoved or
    // swung around (it would only spray FUEL) and fires again when it settles.
    const settled = r.speed < 0.4 && Math.abs(r.body.angvel().y) < 1.2 && !(r.inBurst && Math.abs(Math.atan2(Math.sin(face - r.pose.yaw), Math.cos(face - r.pose.yaw))) > 0.1);
    cmd.shoot = inZone() && live && r.held.length > 0 && settled && (there || insideZone());
    return cmd;
  };

  const shootingCommand = (active: boolean): RobotCommand => {
    if (chassisAim && r.held.length > 0) return stanceCommand(active);
    // In the zone with FUEL: shoot, and keep scooping up FUEL lying in the zone (fed stockpile, misses).
    const zoneFuel = r.capacityLeft > 0 ? nearestFuel((p) => fromWall(p.x) < C.ALLIANCE_ZONE_DEPTH - 0.45 && fromWall(p.x) > 0.7, 4) : null;
    const cmd = zoneFuel && inZone() ? collect(zoneFuel) : bot.driveTo(insideZone() && inZone() ? r.pose : shootSpot());
    if (!zoneFuel && insideZone()) { cmd.vx *= 0.5; cmd.vy *= 0.5; }
    cmd.intake = r.capacityLeft > 0;
    cmd.shoot = inZone() && active && r.held.length > 0;
    return cmd;
  };

  /** Neutral-zone conveyor: intake while lobbing FUEL into our ALLIANCE ZONE for the scorers. */
  const feedCommand = (keep: number): RobotCommand => {
    const p = nearestFuel((q) => fromWall(q.x) > C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE + 0.3);
    const lane = side(r.alliance, C.CENTER_X - 1.6, 0).x;
    const cmd = p ? collect(p) : bot.driveTo({ x: lane, y: myLane() });
    cmd.intake = r.capacityLeft > 0;
    cmd.pass = !inZone() && r.held.length > keep && fromWall(r.pose.x) > C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE / 2 + 0.8 && Math.abs(r.pose.y - C.HUB_CENTER.y) > 0.9;
    return cmd;
  };

  let defending = 0, retreatUntil = 0;
  const defendCommand = (dt: number, prefer?: Robot | null): RobotCommand | null => {
    const targets = ctx.robots.filter((o) => o.alliance === enemy && !o.isClimbing && !o.tippedOver && o.held.length > 0);
    targets.sort((a, b) => Number(b === prefer) - Number(a === prefer) || Number(b.lastCommand.shoot) - Number(a.lastCommand.shoot) || b.held.length * b.config.launcher.rate - a.held.length * a.config.launcher.rate || dist(r.pose, a.pose) - dist(r.pose, b.pose));
    const target = targets[0];
    if (!target) return null;
    team.say(r, `Defending ${team.label(target).replace('You', 'the driver')}`, `defend:${r.id}:${target.id}`, 15);
    const p = target.pose, v = target.fieldVelocity;
    if (dist(r.pose, p) < 1.25) defending += dt; else defending = Math.max(0, defending - dt);
    // Break contact before a 5-count pin (G418) and come back.
    if (defending > 1.8) { retreatUntil = ctx.clock.elapsed + 1.6; defending = 0; }
    if (ctx.clock.elapsed < retreatUntil) {
      const away = Math.atan2(r.pose.y - p.y, r.pose.x - p.x);
      return bot.driveTo({ x: r.pose.x + Math.cos(away) * 1.5, y: clamp(r.pose.y + Math.sin(away) * 1.5, 0.8, C.FIELD_WIDTH - 0.8) });
    }
    team.pushing(r);
    // Get between the shooter and its HUB, then lean on it.
    const hub = rules.hubCenter(enemy);
    const k = dist(r.pose, p) > 2 ? 0.35 : 0;
    const goal = { x: p.x + (hub.x - p.x) * k + v.vx * 0.3, y: p.y + (hub.y - p.y) * k + v.vy * 0.3 };
    return bot.driveTo(goal, Math.atan2(p.y - r.pose.y, p.x - r.pose.x), target);
  };

  const climbTime = () => {
    const slot = mySlot();
    return slot ? travelTime(slot.pose) + r.config.climber.secondsPerLevel * r.config.climber.maxLevel + 1.5 : Infinity;
  };

  const announce = () => {
    const key = `${rules.hubActive(r.alliance)}:${ctx.clock.current.id}`;
    if (plan.announced === key) return;
    plan.announced = key;
    if (ctx.clock.current.id === 'endgame') team.say(null, 'END GAME — dump everything, then climb', 'phase', 5);
    else if (rules.hubActive(r.alliance)) team.say(null, 'HUB ACTIVE — dump it all!', 'phase', 5);
    else team.say(null, `HUB inactive for ${Math.round(rules.secondsUntilActive(r.alliance))} s — fill up and stage at the line`, 'phase', 5);
  };

  let raidReturning=false;
  const think = (dt: number): RobotCommand => {
    if (r.isClimbing) return { ...IDLE_COMMAND };
    if (bot.smart) announce();
    const role = bot.role;
    const active = rules.hubActive(r.alliance);
    const untilActive = rules.secondsUntilActive(r.alliance);
    const activeLeft = active ? rules.secondsActiveRemaining(r.alliance) + 2 : 0;
    const spot = shootSpot();
    const toSpot = travelTime(spot);
    const remaining = ctx.clock.driveRemaining;

    // END GAME climb: empty the hopper on the way, start early enough to reach the top rung.
    // Leave time to empty the hopper on the way (shots fired from the zone still count in END GAME), plus a 6 s cushion:
    // 150 lb robots get up to speed slower than the straight-line travel estimate assumes.
    if (r.config.climber.maxLevel > 0 && remaining < climbTime() + 6 + r.held.length / r.config.launcher.rate) {
      const slot = mySlot();
      if (slot) {
        claimSlot(slot.idx);
        team.say(r, `Climbing to LEVEL ${r.config.climber.maxLevel}`, `climb:${r.id}`, 30);
        // Line up in front of the slot first so the approach doesn't wedge against the TOWER's side.
        const pre = { x: slot.pose.x - Math.cos(slot.pose.yaw) * 0.8, y: slot.pose.y - Math.sin(slot.pose.yaw) * 0.8 };
        const lined = dist(r.pose, pre) < 0.35 || slot.dist < 0.75;
        const cmd = bot.driveTo(lined ? slot.pose : pre, slot.pose.yaw);
        cmd.shoot = inZone() && r.held.length > 0 && slot.dist > 0.5;
        if (slot.dist < 0.75 && (r.held.length === 0 || remaining < r.config.climber.secondsPerLevel * r.config.climber.maxLevel + 1.5)) cmd.climb = r.config.climber.maxLevel;
        return cmd;
      }
    }

    // Einstein: while our HUB is off, the robot nearest the human driver hounds them whenever they're loaded and
    // their HUB is (about to be) live; it breaks off in time to be back for our own shift.
    if (bot.hunter && !active && untilActive > toSpot + 2 && remaining > 25) {
      const human = ctx.robots.find((o) => o.alliance === enemy && (o.controller === 'player' || o.id === 0));
      if (human && human.held.length > 0 && !human.isClimbing && (rules.hubActive(enemy) || rules.secondsUntilActive(enemy) < 4)) {
        const hunter = team.members.filter((m) => !m.isClimbing && !m.tippedOver).sort((a, b) => dist(a.pose, human.pose) - dist(b.pose, human.pose))[0];
        if (hunter === r) {
          team.say(r, `Hunting ${team.label(human).replace('You', 'the driver')}`, `hunt:${r.id}`, 20);
          const d = defendCommand(dt, human);
          if (d) { d.intake = r.capacityLeft > 0; return d; }
        }
      }
    }

    if(bot.hard && !active && role !== 'defender' && untilActive > toSpot+3 && remaining>30) {
      if(r.held.length>=12 && fromWall(r.pose.x)>C.FIELD_LENGTH-C.ALLIANCE_ZONE_DEPTH) raidReturning=true;
      if(!r.held.length) raidReturning=false;
      if(raidReturning) {
        const goal=side(r.alliance,C.ALLIANCE_ZONE_DEPTH+C.HUB_SIZE/2+1.3,myLane());
        const cmd=bot.driveTo(goal); cmd.intake=r.capacityLeft>0;
        cmd.pass=!inZone() && dist(r.pose,goal)<.9; return cmd;
      }
      const raid=r.capacityLeft>0 ? nearestFuel(p=>fromWall(p.x)>C.FIELD_LENGTH-C.ALLIANCE_ZONE_DEPTH && canRaid(p),3) : null;
      if(raid) return collect(raid);
    }

    // A feeder keeps the zone stocked until END GAME, then scores like everyone else.
    if (role === 'feeder' && ctx.clock.current.id !== 'endgame') return feedCommand(active ? 0 : 6);

    if (role === 'defender' && !active && rules.hubActive(enemy) && bot.smart && team.members.length > 1 && remaining > 30) {
      const d = defendCommand(dt);
      if (d) { d.intake = r.capacityLeft > 0; return d; }
    }

    if (active || untilActive < toSpot + 0.4) {
      const live = active || untilActive < 0.6; // shots land after activation
      if (r.held.length > 0 && (inZone() || r.capacityLeft === 0 || r.held.length >= Math.min(r.config.hopperCapacity, 48) || activeLeft < toSpot + r.held.length / r.config.launcher.rate + 1 || !active)) {
        return shootingCommand(live);
      }
      // Empty (or nearly): refill nearby; head back before the shift runs out.
      const near = nearestFuel((p) => travelTime(p) + travelTime(spot) < Math.max(4, activeLeft - 1));
      if (near) return collect(near, { shoot: inZone() && live && r.held.length > 0 });
      return shootingCommand(live);
    }

    // Our HUB is inactive: fill the hopper, keep the zone stocked, and be at the line when it lights up.
    if (r.capacityLeft > 0) {
      const p = nearestFuel((q) => travelTime(q) + travelTime(spot) < untilActive + 0.5);
      if (p) return collect(p);
    }
    // Full with time to spare and their HUB live: on 'press', go make their shift harder, back in time for ours.
    if (r.capacityLeft === 0 && team.strategy === 'press' && bot.smart && rules.hubActive(enemy) && untilActive > toSpot + 4 && remaining > 30) {
      const d = defendCommand(dt, team.scout.topScorer());
      if (d) return d;
    }
    // Otherwise wait at the line, ready (benchmarks: conveyor-feeding while full scores less than being ready).
    if (r.capacityLeft === 0) team.say(r, `Full (${r.held.length}) — staged at the line`, `full:${r.id}`, 25);
    const cmd = bot.driveTo(spot);
    cmd.intake = r.capacityLeft > 0;
    return cmd;
  };

  const bot: CycleBot = new CycleBot(ctx, r, {
    batch: Infinity,
    // Every decision is made by `think`; the generic collector is only the fallback.
    tactics: (dt) => think(dt),
    accepts: (_i, p) => fromWall(p.x) < C.CENTER_X,
    supply: () => ({ ...side(r.alliance, 1.1, C.OUTPOST_AREA_WIDTH / 2), yaw: r.alliance === 'blue' ? 0 : Math.PI }),
    onStuck: () => { if (chase) blocked.push({ p: chase.p, until: ctx.clock.elapsed + 8 }); chase = null; },
    release: () => r.climbPhase === 'hanging' && ctx.clock.driveRemaining > 40,
    route: (goal) => {
      const via = routeThroughBands(r.pose, goal, openBands(), half, r.clearanceHeight, bot.hard);
      return via === goal ? aroundCircles(r.pose, goal, [tower]) : via;
    },
    score: () => shootingCommand(rules.hubActive(r.alliance)),
  });
  return bot;
}
