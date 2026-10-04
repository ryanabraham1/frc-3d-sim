import { aroundCircles, CycleBot } from '@engine/ai/cycleBot';
import { dist } from '@engine/ai/steering';
import { TeamBrain } from '@engine/ai/team';
import { opponent, type FieldPoint } from '@engine/coords';
import type { AiChoice, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { clamp } from '@engine/units';
import { convexOverlap, pointInPolygon } from '@engine/zones';
import type { CrescendoRules } from './rules';
import * as C from './constants';

export const CRESCENDO_AI_STRATEGIES: AiChoice[] = [
  { id: 'auto', label: 'Adaptive', description: 'Reads the match every few seconds and switches between the plans below (see docs/AI-STRATEGY.md for the benchmarks behind each switch).' },
  { id: 'amplify', label: 'Amplify cycles', description: 'The AMP robot banks 2 NOTES while the shooters load up and hold; on the call the human player AMPLIFIES and everyone fires into the SPEAKER for 5 points a NOTE. A feeder at the SOURCE keeps NOTES flowing downfield.' },
  { id: 'feed', label: 'Feed & shoot', description: 'One robot camps the SOURCE and lobs every NOTE downfield; everyone else shoots the SPEAKER. No AMP cycles.' },
  { id: 'speaker', label: 'Speaker cycles', description: 'Everyone cycles SOURCE → SPEAKER; the AMP is only used when a robot is already next to it.' },
  { id: 'defend', label: 'Amplify + defense', description: 'Amplify cycles with one robot shadowing the opponents’ best shooter in the NEUTRAL ZONE instead of shooting (clear of their protected zones).' },
];

export const CRESCENDO_AI_ROLES: AiChoice[] = [
  { id: 'shooter', label: 'Shooter', description: 'Takes the closest NOTE and shoots the SPEAKER; holds fire for AMPLIFICATION when called.' },
  { id: 'amp', label: 'Amp', description: 'Banks 2 NOTES in the AMP, calls AMPLIFY, then shoots during the window.' },
  { id: 'feeder', label: 'Feeder', description: 'Waits at the SOURCE and passes each NOTE downfield to the shooters.' },
  { id: 'defender', label: 'Defender', description: 'Shadows the opponents’ best shooter between their SOURCE and SPEAKER, staying out of their protected zones.' },
];

const canShoot = (r: Robot) => r.config.launcher.enabled && r.config.options?.shooter !== 'none';
const canAmp = (r: Robot) => r.config.options?.amp !== false;

function planRoles(team: TeamBrain): Map<number, string> {
  const roles = new Map<number, string>();
  const free: Robot[] = [];
  for (const r of team.members) {
    const ordered = team.orderedRole(r);
    if (ordered !== 'auto') roles.set(r.id, ordered);
    else if (r === team.ctx.playerRobot) roles.set(r.id, 'shooter');
    else free.push(r);
  }
  const taken = (role: string) => [...roles.values()].includes(role);
  const pick = (role: string, ok: (r: Robot) => boolean, prefer: (a: Robot, b: Robot) => number) => {
    const c = free.filter(ok).sort(prefer)[0];
    if (!c) return;
    roles.set(c.id, role);
    free.splice(free.indexOf(c), 1);
  };
  const strategy = team.strategy;
  // A robot without a shooter can only AMP (or feed by pushing NOTES, which the bots don't do).
  for (const r of [...free]) if (!canShoot(r)) { roles.set(r.id, canAmp(r) ? 'amp' : 'feeder'); free.splice(free.indexOf(r), 1); }
  const sourceOnly = (r: Robot) => r.config.intake.ground === false;
  const amping = strategy === 'amplify' || strategy === 'defend';
  if (strategy === 'defend' && !taken('defender') && free.length >= 3) pick('defender', () => true, (a, b) => a.config.launcher.rate - b.config.launcher.rate || b.station - a.station);
  if (amping && !taken('amp') && free.length >= 2) pick('amp', canAmp, (a, b) => b.station - a.station);
  // Feeding needs a robot that catches from the SOURCE; a source-only robot is the natural feeder. Benchmarks: one
  // feeder beats three robots queueing at the SOURCE (and crossing the field through traffic) every cycle.
  if (strategy !== 'speaker' && strategy !== 'defend' && !taken('feeder') && free.length >= 1 && team.members.length >= 2) pick('feeder', (r) => r.config.intake.station !== false, (a, b) => Number(sourceOnly(b)) - Number(sourceOnly(a)) || a.station - b.station);
  if (amping && !taken('amp') && free.length >= 2) pick('amp', canAmp, (a, b) => b.station - a.station);
  for (const r of free) roles.set(r.id, 'shooter');
  return roles;
}

/**
 * Adaptive plan for 'auto'. Benchmarks (docs/AI-STRATEGY.md): Amplify cycles beat Feed & shoot, Speaker cycles and
 * Amplify + defense — also when the opponents defend us — so it is the plan whenever there's time to bank 2 AMP
 * NOTES and fire the window. Too late for that (or nothing banked with under ~28 s to go) every robot just shoots.
 */
function adaptCrescendo(team: TeamBrain, rules: CrescendoRules): { id: string; reason: string } | null {
  const left = team.ctx.clock.driveRemaining;
  if (team.ctx.clock.mode === 'teleop' && left < 28 && rules.bank[team.alliance] === 0 && !rules.amplified(team.alliance)) return { id: 'feed', reason: 'no time to AMPLIFY again — everyone on the SPEAKER' };
  return { id: 'amplify', reason: 'bank 2, AMPLIFY, volley' };
}

interface CrescendoPlan {
  readySince: number;
  announcedAmp: number;
  /** Chain assignments for END GAME, robot id → chain + side. */
  chains: Map<number, { chain: number; along: number }>;
  claims: Map<number, { robot: number; until: number }>;
}

export function createCrescendoBot(ctx: SeasonContext, rules: CrescendoRules, r: Robot): CycleBot {
  const team = TeamBrain.for(ctx, r.alliance);
  team.usePlanner(planRoles);
  team.useAdapter('amplify', (t) => adaptCrescendo(t, rules), CRESCENDO_AI_STRATEGIES);
  const plan = team.memo<CrescendoPlan>('crescendo', () => ({ readySince: -1, announcedAmp: -1, chains: new Map(), claims: new Map() }));
  const opp = opponent(r.alliance);
  const half = Math.max(r.footprint.length, r.footprint.width) / 2;
  const stages = (['blue', 'red'] as const).map((a) => ({ ...C.stageCenter(a), r: 1.7 + r.footprint.width / 2 }));
  const supply = { ...C.sourcePoint(r.alliance, 0.5, r.footprint.length / 2 + 0.02), yaw: C.sideYaw(C.sourceEnd(r.alliance), Math.atan2(C.SOURCE_NORMAL.y, C.SOURCE_NORMAL.x)) };
  const protectedZones = [C.sourceZone(opp), C.ampZone(opp)];
  const fixedShooter = r.config.options?.shooter === 'fixed';
  // Shooting range: a fixed hood scores from against the SUBWOOFER only.
  // SPEAKER range (m from the opening): on-axis shots go in to ~5.8 m; keep a margin for traffic and spread.
  const range = fixedShooter ? 1.45 : 5.0;
  const now = () => ctx.clock.elapsed;
  const held = () => rules.heldNote(r) !== undefined;
  const amplified = () => rules.amplified(r.alliance);

  // Measured in the headless sim: on-axis shots go in out to ~5.8 m; the STAGE truss and legs block lines that cross it.
  const stage = C.stageCenter(r.alliance);
  const aimPt = C.speakerAim(r.alliance);
  const clearOfStage = (p: FieldPoint) => {
    const dx = aimPt.x - p.x, dy = aimPt.y - p.y, len2 = dx * dx + dy * dy;
    const t = clamp(((stage.x - p.x) * dx + (stage.y - p.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x + t * dx - stage.x, p.y + t * dy - stage.y) > C.STAGE_LEG_RADIUS + 0.45;
  };
  const inRange = (p: FieldPoint) => {
    const d = C.fromWall(r.alliance, p.x), dy = Math.abs(p.y - C.SPEAKER_Y);
    return d > 0.95 && Math.hypot(d, dy) < range && Math.atan2(dy, d) < (fixedShooter ? 0.35 : 0.75) && clearOfStage(p);
  };
  /** Where to shoot from: the nearest clear spot on an arc in front of the SPEAKER (the AMP side is open). */
  const shootSpot = (): FieldPoint => {
    if (fixedShooter) return C.side(r.alliance, C.SUBWOOFER_DEPTH + half + 0.05, C.SPEAKER_Y);
    let best: FieldPoint = C.side(r.alliance, 2.2, C.SPEAKER_Y), cost = Infinity;
    for (const d of [range - 1.4, range - 0.7]) for (let a = -0.6; a <= 0.61; a += 0.15) {
      const p = C.side(r.alliance, 0.3 + d * Math.cos(a), C.SPEAKER_Y + d * Math.sin(a));
      if (p.y > C.W - half - 0.2 || !inRange(p)) continue;
      const c = dist(r.pose, p) + team.members.filter((o) => o !== r && dist(o.pose, p) < 1.2).length * 3;
      if (c < cost) { cost = c; best = p; }
    }
    return best;
  };
  const ampPose = () => ({ x: C.ampCenter(r.alliance).x, y: C.W - half - 0.06 });

  // NOTES on the carpet we may take: not in the opponent's protected zones, not under a STAGE, on our side or passed.
  const noteOk = (i: number, p: FieldPoint & { z: number }) => {
    if (C.isHighNote(i) || p.z > 0.3 || r.justLaunched(i)) return false;
    if (protectedZones.some((z) => pointInPolygon(p, z)) || dist(p, C.sourcePoint(opp, 0.5, 0)) < 1.8) return false;
    if (stages.some((s) => dist(s, p) < 1.35)) return false;
    if (p.x < 0.15 || p.x > C.L - 0.15 || p.y < 0.15 || p.y > C.W - 0.15) return false;
    return true;
  };
  const nearestNote = (maxD = Infinity): { i: number; p: FieldPoint } | null => {
    if (r.config.intake.ground === false) return null;
    let best: { i: number; p: FieldPoint } | null = null, cost = maxD;
    for (let i = 0; i < C.NOTE_COUNT; i++) {
      if (ctx.pool.state[i] !== 'field') continue;
      if ((skip.get(i) ?? 0) > now()) continue;
      const claim = plan.claims.get(i);
      if (claim && claim.robot !== r.id && claim.until > now()) continue;
      const p = ctx.frame.toField(ctx.pool.position(i));
      if (!noteOk(i, p)) continue;
      let c = dist(r.pose, p);
      // Leave a NOTE to a much closer empty-handed teammate (claims keep two robots off the same NOTE).
      if (team.members.some((o) => o !== r && o.controller === 'bot' && rules.heldNote(o) === undefined && !o.isClimbing && team.role(o) !== 'feeder' && dist(o.pose, p) + 1.5 < c)) c += 2;
      // NOTES hugging a wall take a careful approach.
      if (Math.min(p.y, C.W - p.y, p.x, C.L - p.x) < 0.35) c += 2;
      // Prefer NOTES toward our SPEAKER.
      c += C.fromWall(r.alliance, p.x) * 0.15;
      if (c < cost) { cost = c; best = { i, p }; }
    }
    if (best) plan.claims.set(best.i, { robot: r.id, until: now() + 0.6 });
    return best;
  };
  // NOTES we chased without getting them (wedged on a wall, sliding away, under a robot) are skipped for a while.
  const skip = new Map<number, number>();
  let chase: { i: number; since: number; best: number } | null = null;
  const collect = (n: { i: number; p: FieldPoint }): RobotCommand => {
    const p = n.p, d = dist(r.pose, p) || 1, t = now();
    if (!chase || chase.i !== n.i || d < chase.best - 0.3) chase = { i: n.i, since: t, best: Math.min(d, chase?.i === n.i ? chase.best : d) };
    else if (t - chase.since > 3) { skip.set(n.i, t + 6); chase = null; }
    // Line the intake mouth up with the NOTE (14 in across): the robot center belongs a bumper-length behind it, on
    // the far side from the intake; then push through it.
    const back = r.footprint.length / 2 + 0.1;
    const intakeDir = r.pose.yaw - r.intakeYawOffset;
    if (d < back + 0.25) {
      const goal = { x: p.x - Math.cos(intakeDir) * (back - 0.25), y: p.y - Math.sin(intakeDir) * (back - 0.25) };
      const cmd = bot.driveTo(goal, r.pose.yaw);
      cmd.intake = true;
      return cmd;
    }
    const goal = { x: p.x + (r.pose.x - p.x) / d * back, y: p.y + (r.pose.y - p.y) / d * back };
    const cmd = bot.driveTo(goal, d < 3 ? Math.atan2(p.y - r.pose.y, p.x - r.pose.x) + r.intakeYawOffset : undefined);
    cmd.intake = true;
    return cmd;
  };
  const normal = Math.atan2(Math.sin(supply.yaw), Math.cos(supply.yaw));
  const queueSpot = { x: supply.x + Math.cos(normal) * 2.6, y: supply.y + Math.sin(normal) * 2.6 };
  /** The teammate feeding from the SOURCE, if one is working it right now. */
  const activeFeeder = () => team.members.find((o) => o !== r && team.role(o) === 'feeder' && !o.isClimbing && !o.tippedOver && o.controller === 'bot');
  // Where the feeder's lobs land (just outside our WING, on the SOURCE side): wait there for the next one.
  const landing = C.side(r.alliance, C.WING_DEPTH + 0.9, 1.9);
  const goToSource = (): RobotCommand => {
    // One robot docks at the SOURCE at a time (a crowd knocks NOTES out of the CHUTE); the rest queue clear of it.
    const docked = team.members.find((o) => o !== r && !o.isClimbing && dist(o.pose, supply) < 1.6 && rules.heldNote(o) === undefined);
    const wait = docked && (team.role(docked) === 'feeder' || dist(docked.pose, supply) < dist(r.pose, supply));
    const cmd = wait ? bot.driveTo(queueSpot, supply.yaw) : bot.driveTo(supply, supply.yaw);
    cmd.intake = true;
    return cmd;
  };
  const getNote = (maxD?: number): RobotCommand => {
    const feeder = role() !== 'feeder' && r.config.intake.ground !== false ? activeFeeder() : undefined;
    const n = nearestNote(feeder ? Infinity : maxD ?? (r.config.intake.station === false ? Infinity : dist(r.pose, supply) + 1));
    if (n) return collect(n);
    if (feeder) {
      team.say(r, `Ready for a feed, ${team.label(feeder)}`, `ready:${r.id}`, 30);
      const cmd = bot.driveTo(landing);
      cmd.intake = true;
      return cmd;
    }
    return goToSource();
  };
  const role = () => bot.role;

  const shooting = (hold: boolean): RobotCommand => {
    const spot = shootSpot();
    const aim = C.speakerAim(r.alliance);
    const yaw = Math.atan2(aim.y - r.pose.y, aim.x - r.pose.x);
    const there = inRange(r.pose);
    const cmd = bot.driveTo(there && !fixedShooter && hold ? r.pose : spot, yaw);
    // Turret robots shoot on the move; everyone fires as soon as they're in range (traffic may block the spot).
    cmd.shoot = there && !hold && !rules.inWing(r, opp);
    return cmd;
  };

  /** The alliance plan for the AMP: who's carrying, when to hold, when to AMPLIFY. */
  const ampPlan = () => {
    const a = r.alliance;
    const bank = rules.bank[a];
    const amp = team.members.find((o) => team.role(o) === 'amp' && !o.isClimbing);
    const ampLoaded = !!amp && rules.heldNote(amp) !== undefined && dist(amp.pose, C.ampCenter(a)) < 5;
    const teleop = ctx.clock.mode === 'teleop';
    // Our side may press the button itself unless the player drives the human players.
    const mayPress = r.alliance !== ctx.settings.alliance || ctx.humanPlayerIsAuto(a);
    const loaded = team.members.filter((o) => canShoot(o) && rules.heldNote(o) !== undefined && !o.isClimbing && C.fromWall(a, o.pose.x) < 7);
    if (teleop && bank >= 2 && !amplified()) {
      if (plan.readySince < 0) { plan.readySince = now(); team.say(amp ?? null, 'AMP 2/2 — load up, AMPLIFY on my call', 'amp-ready', 8); }
      const shooters = team.members.filter((o) => canShoot(o) && !o.isClimbing).length;
      const go = loaded.filter((o) => C.fromWall(a, o.pose.x) < 4.5).length >= Math.min(2, shooters) || now() - plan.readySince > 3.5 || ctx.clock.driveRemaining < 14;
      if (go && mayPress && rules.pressAmplify(a)) { plan.readySince = -1; team.say(null, 'AMPLIFY! 10 seconds — everything in the SPEAKER', 'amplify', 5); }
    } else plan.readySince = -1;
    if (bank !== plan.announcedAmp && teleop) {
      plan.announcedAmp = bank;
      if (bank === 1) team.say(amp ?? null, 'AMP 1/2', 'amp1', 4);
    }
    // Shooters hold while the second AMP NOTE is on its way or the button is about to be pressed (briefly).
    const soon = !amplified() && teleop && mayPress && (bank >= 2 || (bank === 1 && ampLoaded));
    return { bank, soon };
  };

  /** END GAME: pair robots on chains (HARMONY) and climb with time to spare. */
  const endgame = (): RobotCommand | null => {
    const remaining = ctx.clock.driveRemaining;
    if (ctx.clock.mode !== 'teleop' || remaining > 24) return null;
    if (!r.config.climber.maxLevel) {
      if (remaining > 5) return null;
      // PARK: bumpers in our STAGE ZONE.
      const c = C.stageCenter(r.alliance);
      return bot.driveTo({ x: c.x - (r.alliance === 'blue' ? 1.1 : -1.1), y: c.y });
    }
    let slot = plan.chains.get(r.id);
    if (!slot) {
      const climbers = team.members.filter((o) => o.config.climber.maxLevel > 0).sort((a, b) => a.id - b.id);
      const k = climbers.indexOf(r);
      slot = [{ chain: 0, along: -0.5 }, { chain: 0, along: 0.5 }, { chain: r.alliance === 'blue' ? 1 : 2, along: 0 }][Math.max(0, k) % 3];
      plan.chains.set(r.id, slot);
    }
    const g = C.chainGeometry(r.alliance, slot.chain);
    const goal = { x: g.mid.x + Math.cos(g.dir) * slot.along + Math.cos(g.normal) * 0.2, y: g.mid.y + Math.sin(g.dir) * slot.along + Math.sin(g.normal) * 0.2 };
    const travel = dist(r.pose, goal) / Math.max(1, r.config.maxSpeed * bot.pace * 0.45) + r.config.climber.secondsPerLevel + 4;
    if (remaining > travel + 1) return null;
    team.say(r, `Climbing ${C.chainLabel(r.alliance, slot.chain)}`, `climb:${r.id}`, 30);
    // Approach from the chain's outward side, clear of the core and the legs.
    const outer = { x: goal.x + Math.cos(g.normal) * 1, y: goal.y + Math.sin(g.normal) * 1 };
    const cmd = bot.driveTo(dist(r.pose, goal) < 1.1 ? goal : outer, g.normal + Math.PI);
    cmd.shoot = held() && inRange(r.pose) && !rules.inWing(r, opp) && dist(r.pose, goal) > 1.2;
    if (rules.chainFor(r)?.chain === slot.chain) cmd.climb = 1;
    return cmd;
  };

  /** Contact here would be a foul: the opponent (or we) in its protected zones, at its PODIUM, or END GAME STAGE. */
  const protectedOpp = (o: Robot) => protectedZones.some((z) => convexOverlap(o.corners(), z) || convexOverlap(r.corners(), z)) ||
    dist(o.pose, C.podium(opp)) < 1.3 || (ctx.clock.driveRemaining < 22 && rules.inStageZone(o, opp));
  /** Shadow the opponents' most dangerous shooter on its way to its SPEAKER. */
  const defend = (): RobotCommand | null => {
    const top = team.scout.topScorer();
    const targets = team.opponents.filter((o) => canShoot(o) && !o.isClimbing && !o.tippedOver);
    targets.sort((a, b) => Number(rules.heldNote(b) !== undefined) - Number(rules.heldNote(a) !== undefined) || Number(b === top) - Number(a === top) || dist(r.pose, a.pose) - dist(r.pose, b.pose));
    const t = targets[0];
    if (!t) return null;
    team.say(r, `Defending ${team.label(t).replace('You', 'the driver')}`, `def:${r.id}:${t.id}`, 15);
    const goal = C.speakerAim(opp);
    if (protectedOpp(t)) {
      const d = dist(t.pose, goal) || 1;
      return bot.driveTo({ x: t.pose.x + (goal.x - t.pose.x) / d * 1.8, y: t.pose.y + (goal.y - t.pose.y) / d * 1.8 });
    }
    return bot.defend(t, goal);
  };

  const think = (): RobotCommand => {
    if (r.isClimbing) return { ...IDLE_COMMAND, shoot: held() && r.config.climber.maxLevel >= 2 };
    const { bank, soon } = bot.smart ? ampPlan() : { bank: rules.bank[r.alliance], soon: false };
    const role = bot.role;
    const amped = amplified();

    if (role === 'defender' && ctx.clock.mode === 'teleop' && bot.smart) {
      const d = defend();
      if (d) return d;
    }

    if (role === 'feeder' && ctx.clock.mode === 'teleop') {
      if (!held()) return goToSource();
      // Lob it downfield (into our WING, or short of it from the opponent's WING [G414]).
      const cmd = bot.driveTo(supply, supply.yaw);
      cmd.pass = true;
      cmd.intake = true;
      team.say(r, 'Feeding from the SOURCE', `feed:${r.id}`, 40);
      return cmd;
    }

    if (role === 'amp' && canAmp(r) && !amped && bank < 2 && ctx.clock.mode === 'teleop') {
      if (!held()) return getNote();
      const goal = ampPose();
      const cmd = bot.driveTo(goal, Math.PI / 2);
      cmd.pass = dist(r.pose, goal) < 0.25 && rules.nearAmp(r);
      return cmd;
    }
    if (!canShoot(r)) {
      // AMP-only robot during AMPLIFICATION: collect the next NOTE and wait by the AMP (AMPLIFIED NOTES don't bank).
      if (!held()) return getNote();
      return bot.driveTo({ ...ampPose(), y: ampPose().y - 0.8 }, Math.PI / 2);
    }

    if (!held()) return getNote();
    // Hold fire briefly while the alliance sets up AMPLIFICATION (never hold in the last seconds).
    const hold = bot.smart && soon && ctx.clock.driveRemaining > 8;
    return shooting(hold);
  };

  const bot: CycleBot = new CycleBot(ctx, r, {
    accepts: (i, p) => noteOk(i, { ...p, z: 0 }),
    supply: () => supply,
    endgame,
    tactics: () => think(),
    cautious: (o) => convexOverlap(o.corners(), protectedZones[0]) || convexOverlap(o.corners(), protectedZones[1]) ||
      protectedZones.some((z) => convexOverlap(r.corners(), z)) ||
      (ctx.clock.driveRemaining < 22 && (rules.inStageZone(o, opp) || rules.inStageZone(r, opp))) || (o.isClimbing && o.elevation > 0.02) ||
      (ctx.clock.driveRemaining > 20 && dist(o.pose, C.podium(opp)) < 1.3), // G422
    // In END GAME the opponent's whole STAGE ZONE is off limits for contact (G424): give it a wide berth.
    route: (goal) => {
      const late = ctx.clock.driveRemaining < 24;
      if (late && dist(goal, C.stageCenter(r.alliance)) < 2) return goal;
      return aroundCircles(r.pose, goal, late ? [stages.find((s) => dist(s, C.stageCenter(opp)) < 0.1)!, ...stages].map((s, k) => (k === 0 ? { ...s, r: 2.4 + half } : s)) : stages);
    },
    score: () => shooting(false),
  });
  return bot;
}
