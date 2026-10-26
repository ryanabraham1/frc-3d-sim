import { aroundCircles, clusterCounts, CycleBot } from '@engine/ai/cycleBot';
import { dist, routeThroughBands, turnToward } from '@engine/ai/steering';
import { TeamBrain } from '@engine/ai/team';
import type { FieldPoint, FieldPose } from '@engine/coords';
import type { AiChoice, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { clamp } from '@engine/units';
import { BANDS } from './autopilot';
import * as C from './constants';
import { side, towerSlots } from './field';
import type { RebuiltRules } from './rules';
import { routeRebuiltTraffic } from './traffic';

export const REBUILT_AI_STRATEGIES: AiChoice[] = [
  { id: 'auto', label: 'Adaptive', description: 'Einstein prioritizes collection and active scoring windows. Normal and Hard use Press: full robots contest opponents between their own shifts.' },
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

/** Einstein prioritizes scoring cycles; Normal/Hard retain Press and explicit strategy orders remain available. */
function adaptRebuilt(team: TeamBrain): { id: string; reason: string } | null {
  if (team.skill === 'einstein') return { id: 'shift', reason: 'fill up and stage for our scoring window before committing to defense' };
  const top = team.scout.topScorer();
  const target = top ? team.label(top).replace('You', 'the driver') : 'their best shooter';
  return { id: 'press', reason: `full robots hound ${target} while our HUB is off` };
}

/** Fresh HUB FUEL closer than this (m) turns a Hard bot's intake off (G408). 2.6 m (the stance check) cost ~65 FUEL a match. */
const CATCH_RADIUS = 1.2;

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
  // Reading a pose goes through WASM; a bot's own pose can't change while it thinks, so read it once per think().
  let poseCache: FieldPose | null = null;
  const myPose = (): FieldPose => (poseCache ??= r.pose);
  const half = Math.max(r.footprint.width, r.footprint.length) / 2;
  const speed = () => r.config.maxSpeed * bot.pace * 0.8;
  const laneY = (k: number) => [1.35, C.FIELD_WIDTH - 1.35, C.FIELD_WIDTH / 2 + 1.75][k % 3];
  const myLane = () => laneY(r.station - 1);
  // Shooting spot inside the ALLIANCE ZONE, ~2-3 m from the HUB (best accuracy), on our own lane when far away.
  const shootSpot = (): FieldPoint => {
    if (chassisAim) return stanceSpot();
    const p = myPose();
    const y = bot.hunter ? side(r.alliance, 0, C.HUB_CENTER.y + (r.station - 2) * 1.1).y : clamp(fromWall(p.x) < C.ALLIANCE_ZONE_DEPTH + 1.5 ? p.y : myLane(), 1.0, C.FIELD_WIDTH - 1.0);
    return { x: side(r.alliance, bot.hard ? 2.4 : 2.7, 0).x, y };
  };
  const towerCenter = side(r.alliance, C.TOWER_DEPTH / 2, C.TOWER_CENTER_Y);
  const tower = { ...towerCenter, r: Math.hypot(C.TOWER_DEPTH, C.TOWER_WIDTH) / 2 + half * 0.7 };
  // Crossing a hub row costs time; a robot too tall for the TRENCH has to go over a BUMP, which costs more.
  const rowCost = () => r.clearanceHeight > C.TRENCH_CLEARANCE ? 2.5 : 1.2;
  const travelTime = (goal: FieldPoint) => dist(myPose(), goal) / Math.max(1, speed()) + (routeThroughBands(myPose(), goal, BANDS, half, r.clearanceHeight) !== goal ? rowCost() : 0.3);
  /** Our TOWER climb spot: each teammate claims a different one so nobody races a teammate for it. */
  const mySlot = (): { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null => {
    const claims = team.memo('towerClaims', () => new Map<number, number>());
    const slots = towerSlots(r.alliance, r.footprint.length, r.footprint.width);
    const takenByOther = (i: number) => team.members.some((o) => o !== r && (o.climbSlot === i || claims.get(o.id) === i));
    let idx = claims.get(r.id);
    if (idx === undefined || takenByOther(idx)) {
      const free = slots.map((p, i) => ({ i, d: dist(myPose(), p) })).filter(({ i }) => !takenByOther(i)).sort((a, b) => a.d - b.d);
      if (!free.length) return null;
      idx = free[0].i;
    }
    return { idx, pose: slots[idx], dist: dist(myPose(), slots[idx]) };
  };
  const claimSlot = (idx: number) => team.memo('towerClaims', () => new Map<number, number>()).set(r.id, idx);
  const inZone = () => rules.inAllianceZone(r);
  const insideZone = () => fromWall(myPose().x) < C.ALLIANCE_ZONE_DEPTH - half - 0.05;

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
      const wm = bot.hard ? 0.12 : 0.5; // Hard and up also work the FUEL packed along the walls, where most of it ends up
      if (p.z > 0.25 || p.x < wm || p.x > C.FIELD_LENGTH - wm || p.y < wm || p.y > C.FIELD_WIDTH - wm) continue;
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
    m.bands = BANDS.map((band) => ({ ...band, gaps: band.gaps.filter((gap) => gap.maxRobotHeight === undefined || bot.hard || fuelNow.filter(({ p }) => inLane(p, band, gap)).length < 8) }));
    return m.bands;
  };
  // FUEL tucked against either TOWER can't be reached by an intake.
  const nearTower = (p: FieldPoint) => (['blue', 'red'] as const).some((a) => {
    const t = side(a, C.TOWER_DEPTH / 2, C.TOWER_CENTER_Y);
    return Math.abs(p.x - t.x) < C.TOWER_DEPTH / 2 + 0.35 && Math.abs(p.y - t.y) < C.TOWER_WIDTH / 2 + 0.35;
  });
  // The human driver on our alliance: FUEL around them and ahead of them is theirs, and a teammate that goes after it
  // ends up bumper to bumper with them.
  const driver = () => team.members.find((o) => o !== r && o.controller === 'player' && !o.isClimbing);
  const driversFuel = (p: FieldPoint): boolean => {
    const d = driver();
    if (!d) return false;
    const q = d.pose, v = d.fieldVelocity, reach = Math.hypot(d.footprint.length, d.footprint.width) / 2 + 0.8;
    return dist(q, p) < reach || dist({ x: q.x + v.vx * 0.8, y: q.y + v.vy * 0.8 }, p) < reach;
  };
  // FUEL we chased without getting closer (wedged against a wall, under a robot) is skipped for a while.
  const blocked: { p: FieldPoint; until: number }[] = [];
  let chase: { p: FieldPoint; best: number; since: number } | null = null;
  const isBlocked = (p: FieldPoint) => blocked.some((b) => b.until > ctx.clock.elapsed && dist(b.p, p) < 0.6);
  /** Nearest worthwhile FUEL under `filter`, spreading teammates over different patches. */
  const canRaid = (p:FieldPoint) => !rules.hubActive(r.alliance) && rules.secondsUntilActive(r.alliance) > (dist(myPose(),p)+dist(p,shootSpot()))/Math.max(1,r.config.maxSpeed*.65)+8;
  const nearestFuel = (filter: (p: FieldPoint) => boolean, maxCost = Infinity): FieldPoint | null => {
    const mates = team.members.filter((o) => o !== r && o.capacityLeft > 0 && !o.isClimbing);
    // Poses are read through WASM: take each once instead of once per FUEL.
    const me = myPose();
    const matePoses = mates.map((m) => m.pose);
    const raidWindow = rules.hubActive(r.alliance) ? -Infinity : rules.secondsUntilActive(r.alliance);
    const spot = raidWindow > 8 ? shootSpot() : me;
    const raidSpeed = Math.max(1, r.config.maxSpeed * 0.65);
    const raidable = (p: FieldPoint) => !bot.hunter && raidWindow > (dist(me, p) + dist(p, spot)) / raidSpeed + 8;
    let best: FieldPoint | null = null, cost = maxCost;
    const teammates = team.members.filter(mate => mate !== r).map(mate => ({
      pose: mate.pose, radius: Math.hypot(mate.footprint.length, mate.footprint.width) / 2 + 0.1,
    }));
    const candidates = scanFuel().filter(({ p }) => filter(p) &&
      (fromWall(p.x) <= C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH - 0.3 || raidable(p)) && !isBlocked(p) && !nearTower(p) &&
      !teammates.some(mate => dist(mate.pose, p) < mate.radius) && !driversFuel(p));
    const density=clusterCounts(candidates.map(({p})=>p),1.2);
    for (const [idx,{p}] of candidates.entries()) {
      // Stay off the HUB/BUMP/TRENCH row: fuel there is slow to reach.
      const inRow = Math.abs(fromWall(p.x) - C.HUB_CENTER.x) < C.HUB_SIZE / 2 + 0.3;
      if (!bot.hard && inTrench(p)) continue; // FUEL under a TRENCH jams robots that go in after it
      const mine = dist(me, p);
      // Hard and up (benchmarked, docs/AI-STRATEGY.md): chase the densest pile, don't shun the HUB row, and keep teammates on separate patches.
      let c = mine + (inRow && !bot.hard ? 1.5 : 0) - (bot.hard ? .8 : .4)*Math.min(density[idx]-1,r.capacityLeft-1,bot.hard ? 20 : 12);
      // Keep sweeping a patch intake-first instead of turning around for every ball behind us.
      if (bot.hunter && r.speed > 0.5 && mine < 3) {
        const heading = myPose().yaw - r.intakeYawOffset;
        const forward = (p.x - me.x) * Math.cos(heading) + (p.y - me.y) * Math.sin(heading);
        if (forward < 0) c += Math.min(2, -forward * 2);
      }
      for (const mp of matePoses) if (dist(mp, p) + 0.4 < mine) c += bot.hard ? 6 : 2.5;
      if (c < cost) { cost = c; best = p; }
    }
    return best;
  };
  const trackChase = (p: FieldPoint) => {
    const d = dist(myPose(), p), t = ctx.clock.elapsed;
    if (!chase || dist(chase.p, p) > 0.5 || d < chase.best - 0.25) chase = { p, best: d, since: t };
    else if (t - chase.since > 1.8) { blocked.push({ p, until: t + 6 }); chase = null; }
    if (blocked.length > 40) blocked.splice(0, blocked.length - 40);
  };
  const collect = (p: FieldPoint, extra?: Partial<RobotCommand>): RobotCommand => {
    trackChase(p);
    const yaw = dist(myPose(), p) < 3 ? Math.atan2(p.y - myPose().y, p.x - myPose().x) + r.intakeYawOffset : undefined;
    return { ...bot.driveTo(p, yaw,undefined,.3), intake: r.capacityLeft > 0, ...extra };
  };

  // ── Sweep planner (Einstein): drivers don't chase FUEL one ball at a time. They pick a line through the densest strip
  // (a wall lane, the back wall, a packed pile), run it at speed with the intake leading, and replan only when it is spent.
  interface Sweep { a: FieldPoint; b: FieldPoint; dir: FieldPoint; len: number; since: number; started: boolean }
  let sweepPlan: Sweep | null = null;
  const sweepClaims = team.memo('sweepClaims', () => new Map<number, Sweep>());
  const SWEEP_WIDTH = 0.5, SWEEP_MAX = 7, SWEEP_SPEED = 3.4;
  const alongCorridor = (pts: FieldPoint[], a: FieldPoint, dir: FieldPoint, len: number) => {
    let n = 0, far = 0;
    for (const q of pts) {
      const dx = q.x - a.x, dy = q.y - a.y, along = dx * dir.x + dy * dir.y;
      if (along < -0.3 || along > len || Math.abs(-dx * dir.y + dy * dir.x) > SWEEP_WIDTH) continue;
      n++; if (along > far) far = along;
    }
    return { n, far };
  };
  const planSweep = (allowed: (q: FieldPoint) => boolean): Sweep | null => {
    const room = Math.max(1, r.capacityLeft);
    const pts = scanFuel().map(({ p }) => p).filter((q) => allowed(q) && !isBlocked(q) && !nearTower(q) && !driversFuel(q));
    if (pts.length < 4) return null;
    const mates = [...sweepClaims.entries()].filter(([id, sw]) => id !== r.id && ctx.clock.elapsed - sw.since < 8).map(([, sw]) => sw);
    const stride = Math.max(1, Math.floor(pts.length / 110));
    let best: Sweep | null = null, bestScore = 0;
    for (let i = 0; i < pts.length; i += stride) {
      const a = pts[i];
      const tTo = travelTime(a);
      for (let k = 0; k < 8; k++) {
        const ang = k * Math.PI / 4, dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const { n, far } = alongCorridor(pts, a, dir, SWEEP_MAX);
        if (n < 3) continue;
        const value = Math.min(n, room);
        let score = value / (tTo + far / SWEEP_SPEED + 0.4);
        for (const m of mates) if (Math.min(dist(a, m.a), dist(a, m.b)) < 1.6) score *= 0.35;
        if (score > bestScore) { bestScore = score; best = { a, b: { x: a.x + dir.x * far, y: a.y + dir.y * far }, dir, len: far, since: ctx.clock.elapsed, started: false }; }
      }
    }
    return best;
  };
  const sweepCommand = (allowed: (q: FieldPoint) => boolean, extra?: Partial<RobotCommand>): RobotCommand | null => {
    const now = ctx.clock.elapsed, me = myPose();
    if (sweepPlan) {
      const left = alongCorridor(scanFuel().map(({ p }) => p).filter(allowed), sweepPlan.a, sweepPlan.dir, sweepPlan.len + 0.3).n;
      if (r.capacityLeft === 0 || now - sweepPlan.since > 7 || left < 2 || (sweepPlan.started && dist(me, sweepPlan.b) < 0.7)) sweepPlan = null;
    }
    if (!sweepPlan) {
      sweepPlan = planSweep(allowed);
      if (sweepPlan) sweepClaims.set(r.id, sweepPlan); else sweepClaims.delete(r.id);
    }
    if (!sweepPlan) return null;
    if (!sweepPlan.started && dist(me, sweepPlan.a) < 0.6) sweepPlan.started = true;
    const goal = sweepPlan.started ? sweepPlan.b : sweepPlan.a;
    const heading = Math.atan2(goal.y - me.y, goal.x - me.x);
    const wallClamp = (q: FieldPoint) => ({ x: clamp(q.x, half + 0.04, C.FIELD_LENGTH - half - 0.04), y: clamp(q.y, half + 0.04, C.FIELD_WIDTH - half - 0.04) });
    trackChase(goal);
    return { ...bot.driveTo(wallClamp(goal), heading + r.intakeYawOffset, undefined, sweepPlan.started ? 0.05 : 0.3), intake: r.capacityLeft > 0, ...extra };
  };

  // Chassis-aimed robots (dumpers, fixed shooters) score like real drivers play them: drive to a stance ~1.8 m from the
  // HUB facing it, stop, square up and unload. Measured standing still: 97-100% from 1.6-2 m, vs ~40% firing while
  // chasing FUEL around the zone. Turrets keep shooting on the move.
  const chassisAim = !r.config.launcher.turret;
  const hubP = side(r.alliance, C.HUB_CENTER.x, C.HUB_CENTER.y);
  const towardWall = r.alliance === 'blue' ? Math.PI : 0;
  let levelStance: FieldPoint | null = null;
  const stanceSpot = (): FieldPoint => {
    if (levelStance) {
      const taken = team.members.some((o) => o !== r && dist(o.pose, levelStance!) < Math.max(o.footprint.length, o.footprint.width) + (o.controller === 'player' ? 1.2 : 0.15));
      if (!taken) return levelStance;
      levelStance = null;
    }
    // Angle around the HUB on the wall side, from where the robot is; teammates already there push it round.
    const off = (a: number) => wrap(a - towardWall);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let a = towardWall + clamp(off(Math.atan2(myPose().y - hubP.y, myPose().x - hubP.x)), -0.8, 0.8);
    const spotAt = (ang: number) => {
      // Far enough that the whole bumper stays inside the ALLIANCE ZONE (the HUB straddles the zone line).
      const minD = (C.ALLIANCE_ZONE_DEPTH - C.HUB_CENTER.x) * -1 + half + 0.12;
      const d = Math.max(bot.hard ? 2.9 : 1.8, minD / Math.max(0.35, Math.abs(Math.cos(ang - towardWall))));
      return { x: hubP.x + Math.cos(ang) * d, y: clamp(hubP.y + Math.sin(ang) * d, half + 0.3, C.FIELD_WIDTH - half - 0.3) };
    };
    for (let k = 0; k < 3; k++) {
      const p = spotAt(a);
      const taken = team.members.some((o) => o !== r && dist(o.pose, p) < Math.max(o.footprint.length, o.footprint.width) + (o.controller === 'player' ? 1.2 : 0.15));
      if (!taken) return levelStance = p;
      a = towardWall + clamp(off(a) + (off(a) >= 0 ? -0.55 : 0.55) * (k + 1) * (k % 2 ? -1 : 1), -0.8, 0.8);
    }
    return levelStance = spotAt(a);
  };
  // G408: don't run the intake while FUEL the HUB just released is rolling at us (a catch is a foul).
  const hubFuelNear = (radius = bot.hunter ? CATCH_RADIUS : 2.6): boolean => rules.freshHubFuel().some((i) => dist(myPose(), ctx.frame.toField(ctx.pool.position(i))) < radius);
  const stanceCommand = (live: boolean): RobotCommand => {
    let spot = stanceSpot();
    // A stopped robot can still be perched on FUEL. Its launcher tilts with the chassis, so a level-field shot
    // solution misses until all four wheels reach the carpet. Move around the HUB instead of dumping from that perch.
    if (dist(myPose(), spot) < 0.3 && r.speed < 0.4 && r.uprightness < 0.995) {
      const a = Math.atan2(spot.y - hubP.y, spot.x - hubP.x);
      const off = Math.atan2(Math.sin(a - towardWall), Math.cos(a - towardWall));
      const next = towardWall + (Math.abs(off) > 0.3 ? off - Math.sign(off) * 0.45 : (off >= 0 ? -0.55 : 0.55));
      const d = Math.hypot(spot.x - hubP.x, spot.y - hubP.y);
      levelStance = spot = { x: hubP.x + Math.cos(next) * d, y: hubP.y + Math.sin(next) * d };
    }
    const face = Math.atan2(hubP.y - myPose().y, hubP.x - myPose().x) + r.shotYawOffset;
    const there = dist(myPose(), spot) < 0.3;
    const cmd = there ? { ...IDLE_COMMAND, omega: turnToward(myPose().yaw, face, r.config.maxOmega * 0.8) } : bot.driveTo(spot, face, undefined, 0.5);
    cmd.intake = r.capacityLeft > 0 && !hubFuelNear();
    // Fire once planted (auto-align squares the chassis and holds the first shot until aligned). Once a burst is going
    // the robot keeps firing wherever it points, so a driver lets off the trigger while the robot is being shoved or
    // swung around (it would only spray FUEL) and fires again when it settles.
    const settled = r.speed < 0.4 && r.uprightness >= 0.995 && Math.abs(r.body.angvel().y) < 1.2 && !(r.inBurst && Math.abs(Math.atan2(Math.sin(face - myPose().yaw), Math.cos(face - myPose().yaw))) > 0.1);
    cmd.shoot = inZone() && live && r.held.length > 0 && settled && (there || insideZone());
    return cmd;
  };

  const shootingCommand = (active: boolean): RobotCommand => {
    if (chassisAim && r.held.length > 0) {
      return stanceCommand(active);
    }
    // Hard and up: FUEL is the scarce resource, not fire time (a robot shoots ~15% of an active shift), so every ball is worth
    // its best shot. A turret firing on the move hit ~55%; planted and level it hits far more (docs/AI-STRATEGY.md).
    if (bot.hard && r.held.length > 0) {
      const planted = bot.driveTo(!bot.hunter && insideZone() && inZone() ? myPose() : shootSpot());
      if (insideZone()) { planted.vx *= 0.3; planted.vy *= 0.3; }
      planted.intake = r.capacityLeft > 0 && !hubFuelNear();
      planted.shoot = inZone() && active && r.speed < 0.6 && r.uprightness >= 0.995;
      return planted;
    }
    // In the zone with FUEL: shoot, and keep scooping up FUEL lying in the zone (fed stockpile, misses).
    const zoneFuel = r.capacityLeft > 0 ? nearestFuel((p) => fromWall(p.x) < C.ALLIANCE_ZONE_DEPTH - 0.45 && fromWall(p.x) > 0.7, 4) : null;
    const cmd = zoneFuel && inZone() ? collect(zoneFuel) : bot.driveTo(!bot.hunter && insideZone() && inZone() ? myPose() : shootSpot());
    if (!zoneFuel && insideZone()) { cmd.vx *= 0.5; cmd.vy *= 0.5; }
    cmd.intake = r.capacityLeft > 0 && !hubFuelNear();
    cmd.shoot = inZone() && active && r.held.length > 0;
    return cmd;
  };

  /** Neutral-zone conveyor: intake while lobbing FUEL into our ALLIANCE ZONE for the scorers. */
  const feedCommand = (keep: number): RobotCommand => {
    const p = nearestFuel((q) => fromWall(q.x) > C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE + 0.3);
    const lane = side(r.alliance, C.CENTER_X - 1.6, 0).x;
    const cmd = p ? collect(p) : bot.driveTo({ x: lane, y: myLane() });
    cmd.intake = r.capacityLeft > 0;
    cmd.pass = !inZone() && r.held.length > keep && fromWall(myPose().x) > C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE / 2 + 0.8 && Math.abs(myPose().y - C.HUB_CENTER.y) > 0.9;
    return cmd;
  };

  let defending = 0, retreatUntil = 0;
  const defendCommand = (dt: number, prefer?: Robot | null): RobotCommand | null => {
    const targets = ctx.robots.filter((o) => o.alliance === enemy && !o.isClimbing && !o.tippedOver && o.held.length > 0);
    targets.sort((a, b) => Number(b === prefer) - Number(a === prefer) || Number(b.lastCommand.shoot) - Number(a.lastCommand.shoot) || b.held.length * b.config.launcher.rate - a.held.length * a.config.launcher.rate || dist(myPose(), a.pose) - dist(myPose(), b.pose));
    const target = targets[0];
    if (!target) return null;
    team.say(r, `Defending ${team.label(target).replace('You', 'the driver')}`, `defend:${r.id}:${target.id}`, 15);
    const p = target.pose, v = target.fieldVelocity;
    // A shot blocker stands off instead of pushing, so it never builds toward a pin count.
    if (dist(myPose(), p) < 1.25 && !r.config.shotBlocker) defending += dt; else defending = Math.max(0, defending - dt);
    // Break contact before a 5-count pin (G418) and come back.
    if (defending > 1.8) { retreatUntil = ctx.clock.elapsed + 1.6; defending = 0; }
    if (ctx.clock.elapsed < retreatUntil) {
      const away = Math.atan2(myPose().y - p.y, myPose().x - p.x);
      return bot.driveTo({ x: myPose().x + Math.cos(away) * 1.5, y: clamp(myPose().y + Math.sin(away) * 1.5, 0.8, C.FIELD_WIDTH - 0.8) });
    }
    const hub = rules.hubCenter(enemy);
    // A shot blocker (1323) doesn't need to shove: park it between the shooter and its HUB, panel raised and facing the
    // shooter, and move with it. FUEL fired into the panel drops short. The panel is on the intake side.
    if (r.config.shotBlocker) {
      const toHub = Math.atan2(hub.y - p.y, hub.x - p.x);
      // Right against its bumper: shots climb fast, so the panel only catches them close to the launcher.
      const gap = (Math.max(target.footprint.length, target.footprint.width) + Math.max(r.footprint.length, r.footprint.width)) / 2 + 0.06;
      const spot = { x: p.x + Math.cos(toHub) * gap + v.vx * 0.3, y: clamp(p.y + Math.sin(toHub) * gap + v.vy * 0.3, half + 0.1, C.FIELD_WIDTH - half - 0.1) };
      const cmd = bot.driveTo(spot, Math.atan2(p.y - myPose().y, p.x - myPose().x) + r.intakeYawOffset, target, 0.4);
      cmd.block = dist(myPose(), spot) < 1.6 && !rules.nearTrenchArm(r, 0.6);
      cmd.intake = false;
      return cmd;
    }
    team.pushing(r);
    // Get between the shooter and its HUB, then lean on it.
    const k = dist(myPose(), p) > 2 ? 0.35 : 0;
    const goal = { x: p.x + (hub.x - p.x) * k + v.vx * 0.3, y: p.y + (hub.y - p.y) * k + v.vy * 0.3 };
    return bot.driveTo(goal, Math.atan2(p.y - myPose().y, p.x - myPose().x), target);
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

  let raidReturning = false;
  const think = (dt: number): RobotCommand => {
    const cmd = decide(dt);
    // Hard and up, G408: no intake while FUEL the HUB just released is falling within reach. Normal bots still catch it
    // and give the foul away; benchmarked, Hard bots gave up ~9 fouls a match to it (docs/AI-STRATEGY.md).
    if (bot.hard && cmd.intake && hubFuelNear(CATCH_RADIUS)) cmd.intake = false;
    // Telescoping hopper (1678): stay trench-height while the small load has room, extend it to keep collecting (the
    // robot then routes over a BUMP), and let it drop again once the load fits below the rim.
    if (r.manualHopper) cmd.block = r.held.length >= r.config.hopperExpansion!.startCount - 1;
    return cmd;
  };
  const decide = (dt: number): RobotCommand => {
    poseCache = null;
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
    // Leave time to empty the hopper on the way (shots fired from the zone still count in END GAME), plus a 10 s cushion to square up inside the climb grab tolerance:
    // 150 lb robots get up to speed slower than the straight-line travel estimate assumes.
    if (r.config.climber.maxLevel > 0 && remaining < climbTime() + 10 + r.held.length / r.config.launcher.rate) {
      const slot = mySlot();
      if (slot) {
        claimSlot(slot.idx);
        team.say(r, `Climbing to LEVEL ${r.config.climber.maxLevel}`, `climb:${r.id}`, 30);
        // Line up in front of the slot first so the approach doesn't wedge against the TOWER's side.
        const pre = { x: slot.pose.x - Math.cos(slot.pose.yaw) * 0.8, y: slot.pose.y - Math.sin(slot.pose.yaw) * 0.8 };
        const lined = dist(myPose(), pre) < 0.35 || slot.dist < 0.75;
        const cmd = bot.driveTo(lined ? slot.pose : pre, slot.pose.yaw);
        cmd.shoot = inZone() && r.held.length > 0 && slot.dist > 0.5;
        if (slot.dist < 0.75 && (r.held.length === 0 || remaining < r.config.climber.secondsPerLevel * r.config.climber.maxLevel + 1.5)) cmd.climb = r.config.climber.maxLevel;
        return cmd;
      }
    }

    const human = bot.hunter ? ctx.robots.find((o) => o.alliance === enemy && o.controller === 'player') : undefined;
    // Einstein: while our HUB is off, the best-placed loaded robot hounds the human driver
    // whenever their HUB is (about to be) live; it breaks off in time to be back for our own shift. A robot with a shot
    // blocker (1323) gets the job first: it raises the panel in the driver's face instead of shoving (defendCommand).
    if (human && r.held.length >= r.config.hopperCapacity * 0.6 && !active && untilActive > toSpot + 2 && remaining > 25) {
      if (human && !human.isClimbing && (rules.hubActive(enemy) || rules.secondsUntilActive(enemy) < 4)) {
        // Only robots that have finished their refill compete for the job; an empty nearby teammate must not
        // win the assignment and then decline to hunt. Two loaded robots can pressure a large human load.
        const free = team.members.filter((m) => !m.isClimbing && !m.tippedOver && m.held.length >= m.config.hopperCapacity * 0.6);
        const cost = (m: Robot) => dist(m.pose, human.pose) - (m.capacityLeft === 0 ? 3 : 0) - (m.config.shotBlocker ? 3 : 0);
        const hunters = free.sort((a, b) => cost(a) - cost(b)).slice(0, human.held.length > 20 && free.filter((m) => m.capacityLeft === 0).length >= 2 ? 2 : 1);
        if (hunters.includes(r)) {
          team.say(r, `Hunting ${team.label(human).replace('You', 'the driver')}`, `hunt:${r.id}`, 20);
          const d = human.held.length === 0 ? bot.defend(human, rules.hubCenter(enemy)) : defendCommand(dt, human);
          if (d) { d.intake = r.capacityLeft > 0; return d; }
        }
      }
    }

    if(bot.hard && !bot.hunter && !active && role !== 'defender' && untilActive > toSpot+3 && remaining>30) {
      if(r.held.length>=12 && fromWall(myPose().x)>C.FIELD_LENGTH-C.ALLIANCE_ZONE_DEPTH) raidReturning=true;
      if(!r.held.length) raidReturning=false;
      if(raidReturning) {
        const goal=side(r.alliance,C.ALLIANCE_ZONE_DEPTH+C.HUB_SIZE/2+1.3,myLane());
        const cmd=bot.driveTo(goal); cmd.intake=r.capacityLeft>0;
        cmd.pass=!inZone() && dist(myPose(),goal)<.9; return cmd;
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
      // Einstein amortizes barrier crossings over larger loads; both competitive skills leave slack so the
      // hopper is empty before the shift ends instead of carrying FUEL through 25 s of an inactive HUB.
      const enough = bot.hard ? Math.min(r.config.hopperCapacity * (bot.hunter ? 0.8 : 0.5), bot.hunter ? 64 : 24) : Math.min(r.config.hopperCapacity, 48);
      const margin = bot.hard ? 3.5 : 1;
      if (r.held.length > 0 && (inZone() || r.capacityLeft === 0 || r.held.length >= enough || activeLeft < toSpot + r.held.length / r.config.launcher.rate + margin || !active)) {
        return shootingCommand(live);
      }
      // Empty (or nearly): refill nearby; head back before the shift runs out.
      if (bot.hunter) {
        const sw = sweepCommand((p) => fromWall(p.x) <= C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH - 0.3 && travelTime(p) + travelTime(spot) < Math.max(4, activeLeft - 1), { shoot: inZone() && live && r.held.length > 0 });
        if (sw) return sw;
      }
      const near = nearestFuel((p) => travelTime(p) + travelTime(spot) < Math.max(4, activeLeft - 1));
      if (near) return collect(near, { shoot: inZone() && live && r.held.length > 0 });
      return shootingCommand(live);
    }

    // Our HUB is inactive: fill the hopper, keep the zone stocked, and be at the line when it lights up.
    if (r.capacityLeft > 0) {
      if (bot.hunter) {
        const sw = sweepCommand((q) => fromWall(q.x) <= C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH - 0.3 && travelTime(q) + travelTime(spot) < untilActive + 0.5);
        if (sw) return sw;
      }
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

  // A raised shooter hood blocks the robot at a TRENCH arm: drivers stow it (stop shooting) before rolling through.
  const stowNearTrench = (cmd: RobotCommand): RobotCommand => {
    // Only while rolling: a robot planted at a stance beside an arm keeps shooting.
    if (!r.hasHood || r.speed < 0.8 || !rules.nearTrenchArm(r, 1.2)) return cmd;
    return { ...cmd, shoot: false, pass: false, aim: false };
  };
  const bot: CycleBot = new CycleBot(ctx, r, {
    batch: Infinity,
    yieldToDriver: true,
    // Every decision is made by `think`; the generic collector is only the fallback.
    tactics: (dt) => stowNearTrench(think(dt)),
    accepts: (_i, p) => fromWall(p.x) < C.CENTER_X,
    supply: () => ({ ...side(r.alliance, 1.1, C.OUTPOST_AREA_WIDTH / 2), yaw: r.alliance === 'blue' ? 0 : Math.PI }),
    onStuck: () => { if (chase) blocked.push({ p: chase.p, until: ctx.clock.elapsed + 8 }); chase = null; },
    release: () => r.climbPhase === 'hanging' && ctx.clock.driveRemaining > 40,
    route: (goal) => {
      const via = routeRebuiltTraffic(myPose(), goal, openBands(), half, r.clearanceHeight,
        ctx.robots.filter(other => other !== r).map(other => ({ ...other.pose,
          halfWidth: Math.max(other.footprint.length, other.footprint.width) / 2, speed: other.speed })), bot.hard);
      return via === goal ? aroundCircles(myPose(), goal, [tower]) : via;
    },
    score: () => stowNearTrench(shootingCommand(rules.hubActive(r.alliance))),
  });
  return bot;
}
