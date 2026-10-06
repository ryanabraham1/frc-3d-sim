import { aroundCircles, CycleBot } from '@engine/ai/cycleBot';
import { dist } from '@engine/ai/steering';
import { TeamBrain } from '@engine/ai/team';
import type { FieldPoint } from '@engine/coords';
import type { AiChoice, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { wrapAngle } from '@engine/units';
import * as C from './constants';
import type { ReefscapeRules } from './rules';

export const REEFSCAPE_AI_STRATEGIES: AiChoice[] = [
  { id: 'auto', label: 'Adaptive', description: 'Reads the match every few seconds and switches between the plans below (see docs/AI-STRATEGY.md for the benchmarks behind each switch).' },
  { id: 'reef', label: 'Reef race', description: 'CORAL cyclers split the two CORAL STATIONS and claim different REEF faces, filling L4 first, then L3/L2 (clearing blocking ALGAE) and finally the L1 trough; an ALGAE robot clears your REEF and shoots the NET when one is available. Everyone deep-climbs.' },
  { id: 'coral', label: 'All coral', description: 'Every robot cycles CORAL; ALGAE is only knocked off when it blocks an open level.' },
  { id: 'algae', label: 'Coral + algae', description: 'One robot works ALGAE full time — clearing your REEF, collecting floor ALGAE and scoring the NET (or the PROCESSOR) — while the others cycle CORAL.' },
  { id: 'press', label: 'Reef race + press', description: 'Reef race until your L2–L4 BRANCHES are full; then one robot defends the opponents’ best CORAL cycler between their STATION and REEF (outside their protected REEF ZONE) instead of filling the 2-point trough.' },
];

export const REEFSCAPE_AI_ROLES: AiChoice[] = [
  { id: 'coral', label: 'Coral cycler', description: 'CORAL STATION → highest open BRANCH on an unclaimed REEF face.' },
  { id: 'algae', label: 'Algae', description: 'Clears ALGAE off your REEF (opening L2/L3) and scores it in the NET or PROCESSOR.' },
  { id: 'defender', label: 'Defender', description: 'Slows the opponents’ CORAL cyclers between their STATION and REEF, outside their REEF ZONE (one defender at a time, G421).' },
];

const coralCapable = (r: Robot) => !!r.config.placement?.enabled && r.config.intake.primary !== false && r.config.intake.enabled;
const algaeCapable = (r: Robot) => !!r.config.intake.secondary && (r.config.options?.net || !!r.config.processor?.enabled);

function planRoles(team: TeamBrain): Map<number, string> {
  const roles = new Map<number, string>();
  const free: Robot[] = [];
  for (const r of team.members) {
    const ordered = team.orderedRole(r);
    if (ordered !== 'auto') roles.set(r.id, ordered);
    else if (r === team.ctx.playerRobot) roles.set(r.id, coralCapable(r) ? 'coral' : 'algae');
    else free.push(r);
  }
  for (const r of free) roles.set(r.id, coralCapable(r) ? 'coral' : 'algae');
  const taken = [...roles.values()].includes('algae');
  if (!taken && team.strategy !== 'coral') {
    // The algae robot: the one that can score ALGAE, ideally one that is weakest at CORAL.
    const candidates = free.filter(algaeCapable).sort((a, b) => (a.config.placement?.maxLevel ?? 0) - (b.config.placement?.maxLevel ?? 0) || b.station - a.station);
    const dedicated = team.strategy === 'algae' || candidates.some((r) => !coralCapable(r));
    if (candidates[0] && (dedicated || free.length >= 3)) roles.set(candidates[0].id, 'algae');
  }
  return roles;
}

/** Our L2-L4 BRANCHES are all taken: only the 2-point trough is left for CORAL. */
export function reefSaturated(rules: ReefscapeRules, a: 'blue' | 'red'): boolean {
  return [2, 3, 4].every((level) => [0, 1, 2, 3, 4, 5].every((f) => [0, 1].every((b) => rules.occupied(a, level, f, b))));
}

/**
 * Adaptive plan for 'auto' (docs/AI-STRATEGY.md): Reef race. Pressing the opponents once our high BRANCHES are full
 * benchmarked worse (−25 a match), and the coral-only / dedicated-ALGAE variants were within noise; Reef race already
 * brings an ALGAE robot in when the alliance has three bots. The radio still calls out each level filling up.
 */
function adaptReefscape(_team: TeamBrain, _rules: ReefscapeRules): { id: string; reason: string } | null {
  return { id: 'reef', reason: 'filling the high BRANCHES first' };
}

interface ReefPlan {
  faces: Map<number, { face: number; until: number }>;
  stations: Map<number, number>;
  cages: Map<number, number>;
}

export function createReefscapeBot(ctx: SeasonContext, rules: ReefscapeRules, r: Robot): CycleBot {
  const team = TeamBrain.for(ctx, r.alliance);
  team.usePlanner(planRoles);
  team.useAdapter('reef', (t) => adaptReefscape(t, rules), REEFSCAPE_AI_STRATEGIES);
  const plan = team.memo<ReefPlan>('reef', () => ({ faces: new Map(), stations: new Map(), cages: new Map() }));
  const now = () => ctx.clock.elapsed;
  const center = C.reefCenter(r.alliance);
  const half = Math.max(r.footprint.length, r.footprint.width) / 2;
  const reef = { ...center, r: C.REEF_APOTHEM / Math.cos(Math.PI / 6) + half + 0.1 };
  const oppReef = { ...C.reefCenter(r.alliance === 'blue' ? 'red' : 'blue'), r: reef.r };
  const dockDistance = r.footprint.length / 2 + 0.02;
  const coralHeld = () => r.held.some((i) => i < C.CORAL_COUNT);
  const algaeHeld = () => r.held.some((i) => i >= C.CORAL_COUNT);
  const maxLevel = r.config.placement?.maxLevel ?? 0;
  const opp = r.alliance === 'blue' ? 'red' : 'blue';
  const fromWall = (x: number) => (r.alliance === 'blue' ? x : C.FIELD_LENGTH - x);
  const oppCages = [1, 2, 3].map((s) => ({ ...C.cage(opp, s), r: 0.35 + half }));
  const speed = () => Math.max(1, r.config.maxSpeed * bot.pace * 0.7);

  /** CORAL STATION: split the two between teammates (closest free one), dock squarely at its mouth. */
  const supplyPose = () => {
    const sts = C.stations(r.alliance);
    let k = plan.stations.get(r.id);
    const others = new Set([...plan.stations].filter(([id]) => id !== r.id && team.members.some((o) => o.id === id && coralCapable(o) && !o.isClimbing)).map(([, s]) => s));
    if (k === undefined || (others.has(k) && others.size < 2)) {
      const order = [0, 1].sort((a, b) => dist(r.pose, sts[a]) - dist(r.pose, sts[b]));
      k = order.find((s) => !others.has(s)) ?? order[0];
      plan.stations.set(r.id, k);
    }
    const st = sts[k];
    return { x: st.x + Math.cos(st.yaw) * dockDistance, y: st.y + Math.sin(st.yaw) * dockDistance, yaw: st.yaw };
  };

  const approach = (f: number, extra = 0.25): FieldPoint => {
    const yaw = C.sideYaw(r.alliance, f * Math.PI / 3);
    return { x: center.x + Math.cos(yaw) * (reef.r + extra), y: center.y + Math.sin(yaw) * (reef.r + extra) };
  };
  const faceFree = (f: number) => ![...plan.faces].some(([id, c]) => id !== r.id && c.face === f && c.until > now() && team.members.some((o) => o.id === id));
  const openAt = (level: number, f: number) => level === 1 || (!rules.blocked(r.alliance, level, f) && [0, 1].some((b) => !rules.occupied(r.alliance, level, f, b)));
  const pts = (level: number) => C.CORAL_TELEOP[level];

  /** Best (face, level): points earned minus the time to get there, on a face no teammate has claimed. */
  const chooseTarget = (): { face: number; level: number; clear: boolean } | null => {
    let best: { face: number; level: number; clear: boolean; value: number } | null = null;
    for (let f = 0; f < 6; f++) {
      const travel = dist(r.pose, approach(f)) / speed();
      const claimPenalty = faceFree(f) ? 0 : 3;
      for (let level = maxLevel; level >= 1; level--) {
        if ((badSpot.get(`${f}:${level}`) ?? 0) > now()) continue;
        let value: number, clear = false;
        if (openAt(level, f)) value = pts(level);
        else if (level > 1 && rules.blocked(r.alliance, level, f) && [0, 1].some((b) => !rules.occupied(r.alliance, level, f, b)) && bot.smart) {
          // Knock the ALGAE off first (a couple of seconds) to open two BRANCHES at this level.
          value = pts(level) - 1.2; clear = true;
        } else continue;
        value -= travel * 0.45 + claimPenalty;
        if (!best || value > best.value) best = { face: f, level, clear, value };
        break; // the highest open level on this face is the one worth comparing
      }
    }
    return best;
  };

  let target: { face: number; level: number; clear: boolean } | null = null;
  // A spot we couldn't line up on (CORAL on the carpet against the REEF, traffic) is avoided for a while.
  const badSpot = new Map<string, number>();
  let trying: { key: string; since: number } | null = null;
  const giveUp = (key: string) => {
    if (!trying || trying.key !== key) { trying = { key, since: now() }; return false; }
    if (now() - trying.since < 3) return false;
    trying = null;
    target = null;
    return true;
  };
  let retargetAt = 0;
  const placeCoral = (): RobotCommand => {
    if (!target || now() >= retargetAt || !openAt(target.level, target.face) && !target.clear) {
      target = chooseTarget();
      retargetAt = now() + (bot.hard ? 0.4 : 0.8);
    }
    if (!target) return bot.driveTo(supplyPose());
    plan.faces.set(r.id, { face: target.face, until: now() + 1.5 });
    if (C.nearestFace(r.alliance, r.pose) !== target.face || dist(r.pose, center) > reef.r + 0.8) return bot.driveTo(approach(target.face), C.sideYaw(r.alliance, target.face * Math.PI / 3) + Math.PI);
    if (target.clear && rules.blocked(r.alliance, target.level, target.face)) {
      // Raise the elevator into the ALGAE until it falls (or is taken, with an ALGAE intake).
      const pose = rules.alignPose(r, target.level === 3 ? 4 : Math.min(maxLevel, 3)) ?? { ...approach(target.face, 0), yaw: C.sideYaw(r.alliance, target.face * Math.PI / 3) + Math.PI };
      const cmd = bot.driveTo(pose, pose.yaw);
      cmd.intake = true;
      team.say(r, 'Clearing ALGAE off the REEF', `clear:${r.id}`, 20);
      return cmd;
    }
    let level = target.level;
    while (level > 1 && !openAt(level, target.face)) level--;
    const pose = rules.alignPose(r, level);
    if (!pose) return bot.driveTo(supplyPose());
    const face = target.face;
    // Same CORAL, same spot, still not placed after 3 s near it: try somewhere else.
    if (dist(r.pose, pose) < 0.5 && giveUp(`${face}:${level}:${r.held.find((i) => i < C.CORAL_COUNT)}`)) {
      badSpot.set(`${face}:${level}`, now() + 8);
      return bot.driveTo(approach(face, 0.6));
    }
    const cmd = bot.driveTo(pose, pose.yaw);
    cmd.scoringLevel = level;
    cmd.shoot = dist(r.pose, pose) < 0.25 && (r.config.autoAlign || (dist(r.pose, pose) < 0.04 && Math.abs(wrapAngle(pose.yaw - r.pose.yaw)) < 0.03));
    return cmd;
  };

  // ALGAE robot: clear our REEF (never the opponent's — that would open their levels), take floor ALGAE, score it.
  const netSpot = () => {
    const pose = rules.netPose(r);
    const net = C.netCenter(r.alliance);
    return pose ? { ...pose, y: net.y + (r.station - 2) * 1.1 } : { x: net.x + (r.alliance === 'blue' ? -1.9 : 1.9), y: net.y, yaw: r.alliance === 'blue' ? 0 : Math.PI };
  };
  const scoreAlgae = (): RobotCommand => {
    if (r.config.options?.net) {
      const spot = netSpot();
      const cmd = bot.driveTo(spot, spot.yaw);
      cmd.shoot = dist(r.pose, spot) < (r.config.autoAlign ? 1.2 : .04) && Math.abs(wrapAngle(spot.yaw-r.pose.yaw)) < (r.config.autoAlign ? .6 : .03);
      if(coralHeld()){cmd.pass=cmd.shoot;cmd.shoot=false;}
      return cmd;
    }
    const proc = C.processor(r.alliance);
    const goal = { x: proc.x, y: proc.y + (proc.y < 1 ? dockDistance + 0.05 : -dockDistance - 0.05) };
    const cmd = bot.driveTo(goal, Math.atan2(proc.y - goal.y, 0));
    cmd.pass = dist(r.pose, goal) < 0.3;
    return cmd;
  };
  const floorAlgae = (): FieldPoint | null => {
    let best: FieldPoint | null = null, cost = Infinity;
    for (let i = C.CORAL_COUNT; i < C.CORAL_COUNT + C.ALGAE_COUNT; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (p.z > 0.5 || p.x < 0.4 || p.x > C.FIELD_LENGTH - 0.4 || p.y < 0.4 || p.y > C.FIELD_WIDTH - 0.4) continue;
      // Our side of the BARGE only: past it are the opponent's CAGES (G418) and REEF ZONE (G427).
      if (fromWall(p.x) > C.FIELD_LENGTH / 2 - C.BARGE_ZONE_DEPTH / 2 - half - 0.2) continue;
      const d = dist(r.pose, p);
      if (d < cost) { cost = d; best = p; }
    }
    return best;
  };
  const algaeWork = (): RobotCommand | null => {
    if (algaeHeld()) return scoreAlgae();
    if (!r.config.intake.secondary) return null;
    // Our REEF ALGAE first: it also opens L2/L3 for the CORAL cyclers.
    const faces = [0, 1, 2, 3, 4, 5].filter((f) => rules.reefAlgae(r.alliance, f) && (f % 2 === 0 ? 3 : 2) <= Math.max(3, maxLevel) && faceFree(f));
    faces.sort((a, b) => dist(r.pose, approach(a)) - dist(r.pose, approach(b)));
    const f = faces[0];
    if (f !== undefined) {
      plan.faces.set(r.id, { face: f, until: now() + 1.5 });
      const yaw = C.sideYaw(r.alliance, f * Math.PI / 3);
      if (C.nearestFace(r.alliance, r.pose) !== f || dist(r.pose, center) > reef.r + 0.8) return bot.driveTo(approach(f), yaw + Math.PI);
      const goal = { x: center.x + Math.cos(yaw) * (C.REEF_APOTHEM + r.footprint.length / 2 + 0.05), y: center.y + Math.sin(yaw) * (C.REEF_APOTHEM + r.footprint.length / 2 + 0.05) };
      const cmd = bot.driveTo(goal, yaw + Math.PI);
      cmd.intake = true;
      team.say(r, 'Pulling ALGAE off our REEF', `algae:${r.id}`, 25);
      return cmd;
    }
    const p = floorAlgae();
    if (p) {
      const cmd = bot.driveTo(p, Math.atan2(p.y - r.pose.y, p.x - r.pose.x));
      cmd.intake = true;
      return cmd;
    }
    return null;
  };

  const stationIntake = r.config.intake.station !== false;
  /** A CORAL lying (or hung up in the CHUTE) right at our bumper without being taken: the dock needs a nudge. */
  const pieceStuckNear = (): boolean => {
    for (let i = 0; i < C.CORAL_COUNT; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (Math.hypot(p.x - r.pose.x, p.y - r.pose.y) < half + 0.6 && ctx.pool.velocity(i).y ** 2 + ctx.pool.velocity(i).x ** 2 < 0.05) return true;
    }
    return false;
  };
  /** Nearest CORAL lying on the carpet on our side that a ground intake can reach (none without one). */
  const groundCoral = (): FieldPoint | null => {
    // Robots with a station intake are faster taking CORAL from the human player (benchmarks: chasing loose CORAL
    // halved their AUTO); floor-pickup robots live off the carpet.
    if (r.config.intake.ground === false || coralHeld() || stationIntake) return null;
    let best: FieldPoint | null = null, cost = Infinity;
    for (let i = 0; i < C.CORAL_COUNT; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (p.z > 0.3 || p.x < 0.35 || p.x > C.FIELD_LENGTH - 0.35 || p.y < 0.35 || p.y > C.FIELD_WIDTH - 0.35) continue;
      if (fromWall(p.x) > C.FIELD_LENGTH / 2 - C.BARGE_ZONE_DEPTH / 2 - half - 0.2) continue;
      // CORAL tight against our REEF base can't be reached by a floor intake.
      if (dist(p, center) < C.REEF_APOTHEM + 0.25) continue;
      const d = dist(r.pose, p);
      if (d < cost) { cost = d; best = p; }
    }
    return best;
  };

  const announce = () => {
    for (const level of [4, 3, 2]) {
      const full = [0, 1, 2, 3, 4, 5].every((f) => [0, 1].every((b) => rules.occupied(r.alliance, level, f, b)));
      if (full) { team.say(null, `L${level} is full${level > 2 ? ` — L${level - 1} next` : ' — trough and ALGAE now'}`, `full${level}`, 9999); }
    }
  };

  const oppReefZone = (o: Robot) => C.inReefZone(o.alliance, o.pose, o.footprint.length, o.footprint.width) || rules.inBargeZone(o);
  /** Slow their best CORAL cycler between its STATION and REEF; hang back while it is inside its protected zones. */
  const defend = (): RobotCommand | null => {
    const top = team.scout.topScorer();
    const targets = team.opponents.filter((o) => !o.isClimbing && !o.tippedOver && o.config.placement?.enabled);
    targets.sort((a, b) => Number(b.held.some((i) => i < C.CORAL_COUNT)) - Number(a.held.some((i) => i < C.CORAL_COUNT)) || Number(b === top) - Number(a === top) || dist(r.pose, a.pose) - dist(r.pose, b.pose));
    const t = targets[0];
    if (!t) return null;
    team.say(r, `Defending ${team.label(t).replace('You', 'the driver')}`, `def:${r.id}:${t.id}`, 15);
    const goal = C.reefCenter(opp);
    if (oppReefZone(t)) {
      const d = dist(t.pose, goal) || 1, stand = C.REEF_ZONE_APOTHEM + half + 0.6;
      return bot.driveTo({ x: goal.x + (t.pose.x - goal.x) / d * stand, y: goal.y + (t.pose.y - goal.y) / d * stand });
    }
    return bot.defend(t, goal);
  };
  /** On 'press' one robot (never more: G421) turns defender once only the trough is left. */
  const presser = () => team.members.filter((o) => o.controller === 'bot' && !o.isClimbing && team.role(o) !== 'algae').sort((a, b) => b.station - a.station)[0];

  const think = (): RobotCommand => {
    if (r.isClimbing) return { ...IDLE_COMMAND };
    if (bot.smart) announce();
    const role = bot.role;
    if (bot.smart && ctx.clock.mode === 'teleop' && (role === 'defender' || (team.strategy === 'press' && reefSaturated(rules, r.alliance) && presser() === r))) {
      const d = defend();
      if (d) { if (!coralHeld()) d.intake = false; return d; }
    }
    // A buffered CORAL cannot enter a shared tool until ALGAE leaves it.
    if (coralHeld() && algaeHeld() && r.config.options?.coralBuffer && (r.config.options?.net || r.config.processor?.enabled)) return scoreAlgae();
    if (coralHeld() && maxLevel > 0) return placeCoral();
    if (role === 'algae' || !coralCapable(r)) {
      const w = algaeWork();
      if (w) return w;
    }
    // Holding ALGAE we can score: do it on the way (it can't be dropped for free).
    if (algaeHeld() && (r.config.options?.net || r.config.processor?.enabled)) return scoreAlgae();
    if (!coralCapable(r)) return bot.driveTo(netSpot());
    // Collect CORAL. A ground intake grabs any loose CORAL on our side first (dropped, missed, knocked off).
    const loose = groundCoral();
    if (loose) {
      const yaw = Math.atan2(loose.y - r.pose.y, loose.x - r.pose.x) + r.intakeYawOffset;
      const cmd = bot.driveTo(loose, dist(r.pose, loose) < 2.5 ? yaw : undefined, undefined, 0.3);
      cmd.intake = true;
      return cmd;
    }
    const pose = supplyPose();
    if (stationIntake) {
      // Docked and nothing coming (CORAL hung up in the CHUTE against our bumper): back off and re-dock.
      const st = C.stations(r.alliance)[plan.stations.get(r.id) ?? 0];
      const away = { x: pose.x + Math.cos(st.yaw) * 0.6, y: pose.y + Math.sin(st.yaw) * 0.6 };
      const nudge = bot.redock(dist(r.pose, pose) < 0.25 && pieceStuckNear(), away, pose.yaw);
      if (nudge) { nudge.intake = true; return nudge; }
    }
    if (!stationIntake) {
      // No station intake (floor-pickup robots like 1690 WHISPER): hold a little off the CORAL STATION, intake
      // toward it, so the human player's CORAL drops onto the carpet in front of us; then drive over it.
      const st = C.stations(r.alliance)[plan.stations.get(r.id) ?? 0];
      const back = 0.55 + half;
      const wait = { x: st.x + Math.cos(st.yaw) * back, y: st.y + Math.sin(st.yaw) * back };
      const cmd = bot.driveTo(wait, st.yaw + Math.PI + r.intakeYawOffset);
      cmd.intake = true;
      return cmd;
    }
    const cmd = bot.driveTo(pose, pose.yaw);
    cmd.intake = true;
    return cmd;
  };

  const bot: CycleBot = new CycleBot(ctx, r, {
    accepts: (i, p) => i < C.CORAL_COUNT && r.config.intake.ground !== false && dist(p, r.pose) < 2.5 && !coralHeld(),
    supply: () => supplyPose(),
    route: (goal) => aroundCircles(r.pose, goal, dist(goal, reef) < reef.r + 0.4 ? [oppReef, ...oppCages] : [reef, oppReef, ...oppCages]),
    // G427: an opponent in its own BARGE ZONE or REEF ZONE is protected; G428: so is a climbing one.
    cautious: (o) => rules.inBargeZone(o) || C.inReefZone(o.alliance, o.pose, o.footprint.length, o.footprint.width) || o.isClimbing,
    endgame: () => {
      if (!r.config.climber.maxLevel) return null;
      // Each climber takes its own CAGE (assigned once, nearest first) so nobody queues behind a teammate.
      const options = rules.cageApproaches(r);
      if (!options.length) return null;
      let slot = plan.cages.get(r.id);
      const takenBy = (s: number) => [...plan.cages].some(([id, c]) => id !== r.id && c === s);
      if (slot === undefined || options.find((o) => o.slot === slot)?.occupied) {
        const free = options.filter((o) => !o.occupied && !takenBy(o.slot)).sort((a, b) => dist(r.pose, a) - dist(r.pose, b));
        slot = (free[0] ?? options.filter((o) => !o.occupied)[0])?.slot;
        if (slot === undefined) return null;
        plan.cages.set(r.id, slot);
      }
      const goal = options.find((o) => o.slot === slot)!;
      const climb = r.config.climber.secondsToClimb ?? r.config.climber.secondsPerLevel * 2;
      const travel = dist(r.pose, goal) / speed() + climb + 5;
      if (ctx.clock.driveRemaining > Math.max(travel, 12)) return null;
      team.say(r, `Taking CAGE ${slot + 1}`, `cage:${r.id}`, 30);
      // Come in square from our side of the BARGE so the cage swings into the climber, not the bumper corner.
      const pre = { x: goal.x - Math.cos(goal.yaw) * 0.7, y: goal.y };
      const cmd = bot.driveTo(dist(r.pose, goal) < 0.8 || Math.abs(r.pose.y - goal.y) < 0.15 ? goal : pre, goal.yaw);
      if (dist(r.pose, goal) < 0.2) cmd.climb = r.config.climber.maxLevel;
      return cmd;
    },
    tactics: () => think(),
    score: () => placeCoral(),
  });
  return bot;
}
