import { createReefscapeBot, REEFSCAPE_AI_ROLES, REEFSCAPE_AI_STRATEGIES } from './bots';
import type { SeasonContext, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import { BATTERY_MASS } from '@engine/robot/drivetrain';
import { inch, lb } from '@engine/units';
import * as C from './constants';
import { AUTO_ROUTINES, ReefscapeAutoPilot } from './autopilot';
import { driverEye, normalizeReefscapeConfig, reefscapeRobotDefaults, reefscapeRobotOptions, reefscapeRobotPresets, reefscapeRobotSummary, reefscapeSpecBars, startPose, TIMELINE } from './config';
import { reefscapeTeamRobots } from './teamRobots';
import { buildReefscapeField, type ReefscapeFieldRefs } from './field';
import { ReefscapeHud } from './hud';
import { ReefscapeRules } from './rules';

const fields = new WeakMap<SeasonContext, ReefscapeFieldRefs>();
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const reefR = C.REEF_APOTHEM / Math.cos(Math.PI / 6);

export const reefscape2025: SeasonDefinition = {
  id: '2025-reefscape', year: 2025, name: 'REEFSCAPE', subtitle: 'presented by Haas',
  manualVersion: 'Supplied 2025 manual · ARENA V4 / Game Details V13',
  summary: 'Place CORAL on four reef levels, remove ALGAE and score it in your PROCESSOR or NET, then park or climb a shallow or deep CAGE. Both alliances can earn Coopertition to reduce the CORAL ranking-point threshold.',
  fieldLength: C.FIELD_LENGTH, fieldWidth: C.FIELD_WIDTH, carpetColor: C.COLORS.carpet,
  maxRobotHeight: inch(42), maxRobotPerimeter: inch(120), maxRobotWeight: lb(135) + BATTERY_MASS /* R408: robot + bumpers, plus the battery */, foulValues: { minor: 2, major: 6 },
  timeline: TIMELINE,
  pieceFlow: false,
  gamePiece: { name: 'CORAL + ALGAE', shape: 'tube', hollow: true, colliderInnerRadius: C.CORAL_COLLIDER_INNER, radius: C.CORAL_RADIUS, innerRadius: C.CORAL_INNER_RADIUS, length: C.CORAL_LENGTH,
    mass: 0.65, restitution: 0.15, friction: 0.35, color: C.COLORS.coral, count: C.CORAL_COUNT + C.ALGAE_COUNT,
    groundDamping: 1.3, angularDamping: 1.1, airDamping: 0.02,
    variants: [{ start: C.CORAL_COUNT, spec: { name: 'ALGAE', radius: C.ALGAE_RADIUS, mass: 0.45, restitution: 0.35, friction: 0.7, color: C.COLORS.algae, count: C.ALGAE_COUNT, groundDamping: 0.9, airDamping: 0.02, angularDamping: 1.0 } }],
  },
  robotDefaults: reefscapeRobotDefaults(), maxClimbLevel: 2, maxScoringLevel: 4,
  climberLabels: ['None', 'Shallow cage', 'Deep cage'], robotLimits: { capacity: 2, preload: 1 },
  normalizeRobotConfig: normalizeReefscapeConfig, robotPresets: reefscapeRobotPresets(),
  robotSummary: reefscapeRobotSummary,
  robotOptions: reefscapeRobotOptions,
  teamRobots: reefscapeTeamRobots(),
  robotSpecBars: reefscapeSpecBars,
  robotFields: ['team', 'height', 'len', 'wid', 'speed', 'accel', 'weight', 'tread', 'pre', 'reach', 'lift', 'place', 'harvest', 'release', 'rate', 'acc', 'cspd'],
  humanPlayerButtons: 2,
  humanPlayerHint: {
    auto: 'Your human players drop CORAL down the CHUTE when you wait at a CORAL STATION, and throw PROCESSOR ALGAE into your NET.',
    manual: 'H: drop a CORAL down the nearest CHUTE (aimed at your robot) · B: throw PROCESSOR ALGAE at your NET.',
  },
  robotHint: 'R104: 42 in starting height / 120 in perimeter · R105: 18 in mechanism reach · G409: 1 CORAL + 1 ALGAE',
  autoRoutines: AUTO_ROUTINES, startPose, driverEye,
  /**
   * Bumpers touching the starting line (the preset straddles it, and LEAVE needs the robot clear of it, so a start
   * fully behind the line would score LEAVE for free), anywhere along it except the REEF, the corner CORAL STATIONs
   * and the PROCESSOR [EST footprints].
   */
  startArea: {
    rect: { x0: 0, x1: C.START_LINE + 1.5, y0: 0, y1: C.FIELD_WIDTH },
    line: C.START_LINE,
    keepOut: [
      Array.from({ length: 6 }, (_, f) => [C.REEF_X + reefR * Math.cos(Math.PI / 6 + f * Math.PI / 3), C.REEF_Y + reefR * Math.sin(Math.PI / 6 + f * Math.PI / 3)] as [number, number]),
      [[0, 0], [1.7, 0], [0, 1.25]],
      [[0, C.FIELD_WIDTH], [1.7, C.FIELD_WIDTH], [0, C.FIELD_WIDTH - 1.25]],
      rect(5.45, 0, 1.1, 0.35),
    ],
  },
  configureRobot(robot) {
    robot.usePlacementVisual();
    robot.config.hopperCapacity = Math.min(2, robot.config.hopperCapacity);
    robot.config.preload = Math.min(1, robot.config.preload);
    robot.config.climber.maxLevel = Math.min(2, robot.config.climber.maxLevel);
    robot.projectile = { radius: C.ALGAE_RADIUS, airDamping: 0.02 };
  },
  mapShapes: [
    { kind: 'zone', points: rect(0, 0, C.START_LINE, C.FIELD_WIDTH) },
    { kind: 'hub', points: Array.from({ length: 6 }, (_, f) => [C.REEF_X + reefR * Math.cos(Math.PI / 6 + f * Math.PI / 3), C.REEF_Y + reefR * Math.sin(Math.PI / 6 + f * Math.PI / 3)] as [number, number]) },
    { kind: 'tower', points: rect(C.FIELD_LENGTH / 2 - inch(46) / 2, C.FIELD_WIDTH / 2 + 0.1, inch(46), inch(146.5)) },
    { kind: 'outpost', points: rect(0, 0, 1.7, 1.25) }, { kind: 'outpost', points: rect(0, C.FIELD_WIDTH - 1.25, 1.7, 1.25) },
    { kind: 'depot', points: rect(5.45, 0, 1.1, 0.35) },
  ],
  buildField(ctx) { fields.set(ctx, buildReefscapeField(ctx)); },
  createRules(ctx) { const refs = fields.get(ctx); if (!refs) throw new Error('Build REEFSCAPE field first'); return new ReefscapeRules(ctx, refs); },
  createAutoPilot(ctx, rules, robot, routine) {
    if (routine !== 'reef-cycle') return new ReefscapeAutoPilot(rules as ReefscapeRules, robot, routine);
    // Scripted L4 preload, then the TELEOP brain keeps cycling CORAL for the rest of AUTO.
    const preload = new ReefscapeAutoPilot(rules as ReefscapeRules, robot, 'reef-l4');
    let cycle: ReturnType<typeof createReefscapeBot> | null = null;
    let started = false;
    return {
      update(dt) {
        if (robot.held.some((i) => i < C.CORAL_COUNT) && !started) return preload.update(dt);
        started = true;
        cycle ??= createReefscapeBot(ctx, rules as ReefscapeRules, robot);
        return cycle.update(dt);
      },
    };
  },
  botAutoRoutine(_station, config) { return config && !config.placement?.enabled ? 'leave' : 'reef-cycle'; },
  botArchetype(difficulty, station, role) {
    const byRole: Record<string, string> = { algae: 'firefly-118', coral: 'lightning-2056', defender: 'mid-elevator' };
    if (role && byRole[role]) return byRole[role];
    // Real 2025 robots (generic archetypes on Easy). As full alliances (seeds 5-7, 2026-10-04) the real robots score
    // 256-267 once floor-pickup robots take CORAL off the carpet; 1778 200. Hard's lineup also wins AUTO (56 vs 42-49).
    const lineups: Record<string, string[]> = { easy: ['trough', 'mid-elevator', 'funnel-l4'], normal: ['subzero-1778', 'lightning-2056', 'whisper-1690'], hard: ['spectre-2910', 'undertow-254', 'firefly-118'], elite: ['spectre-2910', 'undertow-254', 'firefly-118'], einstein: ['spectre-2910', 'undertow-254', 'firefly-118'] };
    return lineups[difficulty][(station - 1) % 3];
  },
  aiStrategies: REEFSCAPE_AI_STRATEGIES,
  aiRoles: REEFSCAPE_AI_ROLES,
  botRobotConfig(difficulty) { return difficulty === 'hard' || difficulty === 'elite' || difficulty === 'einstein' ? reefscapeRobotPresets().find((p) => p.id === 'all-rounder')!.config : this.robotDefaults; },
  createBotPilot(ctx, rules, robot) { return createReefscapeBot(ctx, rules as ReefscapeRules, robot); },
  createHud(ctx, rules, slots) { return new ReefscapeHud(ctx, rules as ReefscapeRules, slots); },
  controlsHelp: [
    ...DEFAULT_CONTROLS_HELP.filter(([key]) => !['Space', 'G', 'I', 'C / X', '1 2 3  or  [ ]', 'H', 'Gamepad'].includes(key)),
    ['1 / 2 / 3 / 4 · [ / ]', 'Select reef L1–L4 (gamepad D-pad changes level)'],
    ['Space / RT', 'Release CORAL from the end effector (with reef auto-align: hold to line up on the nearest open BRANCH first); with ALGAE only, shoot your NET'],
    ['G / RB', 'Feed ALGAE into your PROCESSOR nearby; with CORAL only, eject it a short distance'],
    ['J / LT · F', 'Intake (funnel: back up to a CORAL STATION; ground: drive the back intake over CORAL) / remove or knock off reef ALGAE · toggle automatic intake'],
    ['C / A · X / B', 'Climb the nearest of your alliance’s CAGES that matches your climber · descend'],
    ['H / gamepad X', 'HUMAN PLAYER: drop a CORAL down the nearest CORAL STATION CHUTE (aimed at your robot)'],
    ['B / gamepad LB', 'HUMAN PLAYER: throw PROCESSOR ALGAE at your NET (TELEOP)'],
    ['Gamepad', 'LS drive · RS rotate · Y camera · D-pad reef level'],
  ],
  rulesSummary: [
    { title: 'AUTO / TELEOP', detail: '15 s AUTO, 3 s scoring delay, 135 s TELEOP, 3 s final scoring. Manual AUTO is an optional practice control.', value: '2:30', tag: 'TIME' },
    { title: 'CORAL L1 / L2 / L3 / L4', detail: 'AUTO: 3 / 4 / 6 / 7. TELEOP: 2 / 3 / 4 / 5. One CORAL per branch. ALGAE blocks the level it contacts until removed.', value: '3/4/6/7', tag: 'CORAL' },
    { title: 'ALGAE PROCESSOR / NET', detail: 'Processor sends ALGAE to the opponent’s human player, who can throw it into their own net in TELEOP.', value: '6 / 4', tag: 'ALGAE' },
    { title: 'LEAVE / PARK / SHALLOW / DEEP', detail: 'Leave assessed at end of AUTO; bumper overlap with starting line must be cleared. Park/cages assessed after TELEOP. Any of your three CAGES counts; your climber choice sets your station’s cage depth (others stay deep).', value: '3 / 2 / 6 / 12', tag: 'BARGE' },
    { title: 'AUTO / CORAL / BARGE RP', detail: 'All present robots leave + 1 AUTO CORAL; 7 CORAL on each level; 16 BARGE points. Each bonus grants 1 RP. Win 3 RP, tie 1 RP.', value: '1 each', tag: 'RP' },
    { title: 'Coopertition', detail: 'Both alliances score at least 2 ALGAE in their processors: 1 Coopertition point each; CORAL RP needs 7 on any 3 levels.', tag: 'COOP' },
    { title: 'Control limits / launch restriction', detail: 'G409: one of each piece at a time. Elevator placement requires reef reach. G412: CORAL launch only with bumpers partly in your REEF ZONE.', value: '1 + 1', tag: 'G409' },
    { title: 'Defenders / opponent cages', detail: 'G421 (whole match): one defender beyond barge zones; 2-point foul then 6 every 3 s. G405/G418: opponent cage contact is a 6-point foul; TELEOP awards opponent BARGE RP.', tag: 'FOUL' },
    { title: 'Simulation model', detail: 'CORAL placement is physical: the end effector releases a hollow CORAL and it scores only if a BRANCH ends up inside it (miss by ~1 in and it falls). Reef auto-align is a robot option, not free help. CORAL STATION drops roll down the real CHUTE. Cage climbs are assisted animations; undimensioned field details are approximate.', tag: 'SIM' },
  ],
  testing: {
    mechanism: 'placement',
    scatterCount: 6, // The six floor CORAL staged on marks (§6.3.4); ALGAE has separate flight/intake tests.
    scoringSpots(a) { return Array.from({ length: 6 }, (_, f) => {
      const angle = C.sideYaw(a, f * Math.PI / 3), c = C.reefCenter(a);
      return { x: c.x + Math.cos(angle) * 1.48, y: c.y + Math.sin(angle) * 1.48, yaw: angle + Math.PI };
    }); },
    goalCount: (ctx, a) => [1, 2, 3, 4].reduce((sum, l) => sum + ctx.score.counter(a, `coralL${l}`), 0),
    goalCenter: C.reefCenter,
    traversals() { const y = C.FIELD_WIDTH / 2 - (C.CAGE_OFFSETS[0] + C.CAGE_OFFSETS[1]) / 2; return [y, C.FIELD_WIDTH - y].map((y) => ({ label: `under barge y=${y}`, from: { x: 6.9, y }, to: { x: 10.6, y }, maxRobotHeight: inch(60) })); },
  },
};
