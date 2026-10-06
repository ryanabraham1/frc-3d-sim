import type { RobotConfig } from '@engine/robot/config';
import { createRebuiltBot, REBUILT_AI_ROLES, REBUILT_AI_STRATEGIES } from './bots';
import type { MapShape, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import { lb } from '@engine/units';
import * as C from './constants';
import { AUTO_ROUTINES, RebuiltAutoPilot } from './autopilot';
import { driverEye, normalizeRebuiltConfig, rebuiltRobotDefaults, rebuiltRobotOptions, rebuiltRobotPresets, rebuiltShotAccuracy, rebuiltSpecBars, rebuiltCardBars, startPose, TIMELINE } from './config';
import { rebuiltTeamRobots } from './teamRobots';
import { buildRebuiltField, RebuiltFieldRefs, side, sideYaw } from './field';
import { RebuiltHud } from './hud';
import { RebuiltRules } from './rules';

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function mapShapes(): MapShape[] {
  const { x: hx, y: hy } = C.HUB_CENTER;
  const R = C.HUB_OPENING_HEX / Math.sqrt(3);
  const hex = Array.from({ length: 6 }, (_, k): [number, number] => [hx + R * Math.cos(Math.PI / 2 + (k * Math.PI) / 3), hy + R * Math.sin(Math.PI / 2 + (k * Math.PI) / 3)]);
  const hs = C.HUB_SIZE / 2;
  const bd = C.BUMP_DEPTH / 2;
  const td = C.TRENCH_DEPTH / 2;
  return [
    { kind: 'zone', points: rect(0, 0, C.ALLIANCE_ZONE_DEPTH, C.FIELD_WIDTH) },
    { kind: 'trench', points: rect(hx - td, 0, hx + td, C.TRENCH_WIDTH) },
    { kind: 'trench', points: rect(hx - td, C.FIELD_WIDTH - C.TRENCH_WIDTH, hx + td, C.FIELD_WIDTH) },
    { kind: 'bump', points: rect(hx - bd, hy - hs - C.BUMP_WIDTH, hx + bd, hy - hs) },
    { kind: 'bump', points: rect(hx - bd, hy + hs, hx + bd, hy + hs + C.BUMP_WIDTH) },
    { kind: 'hub', points: hex },
    { kind: 'tower', points: rect(0, C.TOWER_CENTER_Y - C.TOWER_WIDTH / 2, C.TOWER_DEPTH, C.TOWER_CENTER_Y + C.TOWER_WIDTH / 2) },
    { kind: 'depot', points: rect(0, C.DEPOT_CENTER_Y - C.DEPOT_WIDTH / 2, C.DEPOT_DEPTH, C.DEPOT_CENTER_Y + C.DEPOT_WIDTH / 2) },
    { kind: 'outpost', points: rect(0, 0, 0.61, C.OUTPOST_AREA_WIDTH) },
  ];
}

/** Field refs are created in buildField and handed to the rules. One game per page, so module scope is fine. */
let fieldRefs: RebuiltFieldRefs | null = null;

export const rebuilt2026: SeasonDefinition = {
  id: '2026-rebuilt',
  year: 2026,
  name: 'REBUILT',
  subtitle: 'presented by Haas',
  manualVersion: 'Game Manual TU22',
  summary:
    'Score FUEL into your HUB while it is active, cross BUMPs and TRENCHes, and climb the TOWER. Hubs alternate active/inactive each SHIFT based on who scored more FUEL in AUTO.',

  fieldLength: C.FIELD_LENGTH,
  fieldWidth: C.FIELD_WIDTH,
  carpetColor: C.COLORS.carpet,
  maxRobotHeight: C.MAX_ROBOT_HEIGHT,
  maxRobotPerimeter: C.MAX_ROBOT_PERIMETER,
  // R408 allows 135 lb robot + bumpers plus the 13 lb battery (148 lb); stock robots are set to 150 lb (user decision),
  // so the weight slider goes to 150.
  maxRobotWeight: lb(150),
  foulValues: { minor: 5, major: 15 },

  timeline: TIMELINE,
  gamePiece: {
    name: 'FUEL',
    radius: C.FUEL_DIAMETER / 2,
    colliderScale: 0.98,
    mass: C.FUEL_MASS,
    restitution: 0.35,
    friction: 0.7,
    airDamping: 0.03,
    groundDamping: 0.9,
    angularDamping: 1.2,
    color: C.COLORS.fuel,
    count: C.FUEL_TOTAL,
  },
  robotDefaults: rebuiltRobotDefaults(),
  normalizeRobotConfig: normalizeRebuiltConfig,
  robotPresets: rebuiltRobotPresets(),
  robotOptions: rebuiltRobotOptions,
  teamRobots: rebuiltTeamRobots(),
  robotSpecBars: rebuiltSpecBars,
  robotCardBars: rebuiltCardBars,
  shotAccuracy: rebuiltShotAccuracy,
  robotFields: ['team', 'height', 'len', 'wid', 'speed', 'accel', 'weight', 'tread', 'cap', 'pre', 'rate', 'acc', 'cspd'],
  maxClimbLevel: 3,
  autoRoutines: AUTO_ROUTINES,
  mapShapes: mapShapes(),
  /** Anywhere in the ALLIANCE ZONE behind the ROBOT STARTING LINE except the TOWER, DEPOT and OUTPOST. */
  startArea: {
    rect: { x0: 0, x1: C.ALLIANCE_ZONE_DEPTH - C.TAPE_WIDTH, y0: 0, y1: C.FIELD_WIDTH },
    keepOut: mapShapes().filter((m) => m.kind === 'tower' || m.kind === 'depot' || m.kind === 'outpost').map((m) => m.points),
  },

  startPose: (a, s) => startPose(a, s),
  driverEye,

  configureRobot(robot) {
    robot.enableRoundHopper();
  },

  buildField(ctx) {
    fieldRefs = buildRebuiltField(ctx.builder);
  },
  createRules(ctx) {
    if (!fieldRefs) throw new Error('buildField must run before createRules');
    return new RebuiltRules(ctx, fieldRefs);
  },
  createAutoPilot(ctx, rules, robot, routine) {
    return new RebuiltAutoPilot(ctx, rules as RebuiltRules, robot, routine);
  },
  botAutoRoutine(station, config, team) {
    const canClimb = (c?: RobotConfig) => (c?.climber.maxLevel ?? 0) > 0;
    // The AUTO TOWER pays LEVEL 1 for at most two robots [M 6.4]: the first two climbers (by station) take it, and
    // everyone else spends AUTO on FUEL. A robot without a climber never runs a climb routine.
    const climbers = (team ?? [{ station, config: config! }]).filter((m) => canClimb(m.config)).sort((a, b) => a.station - b.station).slice(0, 2).map((m) => m.station);
    if (config?.intake.ground === false) return canClimb(config) && climbers.includes(station) ? 'shoot-climb' : 'shoot-only';
    if (canClimb(config) && climbers.includes(station)) return station === 1 ? 'depot-climb' : 'shoot-climb';
    return station === 1 ? 'shoot-depot' : 'shoot-collect';
  },
  botArchetype(difficulty, station, role) {
    const byRole: Record<string, string> = { scorer: 'ripcurrent-4414', feeder: 'limestone-1678', defender: 'kepler-1690' };
    if (role && byRole[role]) return byRole[role];
    // Real 2026 robots; station 3 (the Hard defender) gets 1690's spiked-tread pusher.
    // Benchmarked (seeds 5-7): Hard averaged 1040 points, Normal 515.
    const lineups: Record<string, string[]> = { easy: ['outpost', 'fixed', 'turret'], normal: ['overload-254', 'limestone-1678', 'sandspit-3476'], hard: ['ripcurrent-4414', 'mixtape-971', 'kepler-1690'], elite: ['ripcurrent-4414', 'mixtape-971', 'kepler-1690'], einstein: ['ripcurrent-4414', 'mixtape-971', 'kepler-1690'] };
    return lineups[difficulty][(station - 1) % 3];
  },
  botRobotConfig(difficulty) {
    return rebuiltRobotPresets().find((p) => p.id === (difficulty === 'easy' ? 'outpost' : difficulty === 'normal' ? 'fixed' : 'turret'))!.config;
  },
  createBotPilot(ctx, rules, robot) { return createRebuiltBot(ctx, rules as RebuiltRules, robot); },
  aiStrategies: REBUILT_AI_STRATEGIES,
  aiRoles: REBUILT_AI_ROLES,
  createHud(ctx, rules, slots) {
    return new RebuiltHud(ctx, rules as RebuiltRules, slots);
  },
  rulesSummary: [
    { title: 'FUEL in an active HUB', detail: 'AUTO and TELEOP. FUEL into an inactive hub scores nothing. Counts for 3 s after a hub deactivates.', value: '1 pt', tag: 'FU' },
    { title: 'HUB shifts', detail: 'Alliance with more AUTO FUEL has its hub OFF in SHIFT 1, then hubs alternate every 25 s. Both on in AUTO, TRANSITION and END GAME.', tag: 'SH' },
    { title: 'TOWER LEVEL 1 (AUTO)', detail: 'Off the carpet and TOWER BASE; max 2 robots per alliance.', value: '15 pts', tag: 'L1' },
    { title: 'TOWER LEVEL 1 / 2 / 3 (TELEOP)', detail: 'L2 = bumpers above LOW RUNG, L3 = above MID RUNG. One level per robot.', value: '10/20/30', tag: 'TW' },
    { title: 'ENERGIZED · SUPERCHARGED RP', detail: 'FUEL scored in an active hub at or above threshold (regional/district).', value: '100 · 360', tag: 'RP' },
    { title: 'TRAVERSAL RP', detail: 'TOWER points at or above threshold.', value: '50', tag: 'RP' },
    { title: 'G407 — score from your zone', detail: 'Launching FUEL into your HUB while bumpers are outside your ALLIANCE ZONE. Feeding FUEL back into your zone from anywhere is legal (G key).', value: 'MAJOR 15', tag: 'G4' },
    { title: 'G403 — AUTO center line', detail: 'Bumpers completely across the CENTER LINE during AUTO.', value: 'MAJOR 15', tag: 'G4' },
    { title: 'G420 — TOWER protection', detail: 'Last 30 s: no contact (even through a FUEL) with an opponent touching its TOWER, whoever starts it. If it is off the ground it is awarded LEVEL 3.', value: 'MAJOR 15', tag: 'G4' },
    { title: 'G417 — no tipping', detail: 'Driving into a robot that is tipping, or tipping it twice (MAJOR + YELLOW); pushing a robot lying on its side (MAJOR + RED). A second yellow is a red card. Cards do not disable robots.', value: 'MAJOR + YELLOW', tag: 'G4' },
    { title: 'G419 — no walling off the TOWER', detail: 'Two or more partners keeping an opponent climber from its TOWER: MAJOR after 3 s, again every 3 s.', value: 'MAJOR 15', tag: 'G4' },
    { title: 'G408 — don’t catch FUEL', detail: 'FUEL released by the HUB may not be caught before it touches anything else. MINOR; sitting under the HUB for 3+ is MAJOR (yellow card if repeated).', value: 'MINOR 5', tag: 'G4' },
    { title: 'Robot limits', detail: 'R104/R107: 30 in tall max, 110 in frame perimeter. TRENCH clearance is 22.25 in.', value: '30 in', tag: 'R1' },
  ],
  testing: {
    // Grid over the ALLIANCE ZONE (G407: only score from here), avoiding the TOWER and DEPOT. Includes
    // point-blank spots against the HUB and the far corners by the wall.
    scoringSpots(alliance) {
      const spots: [number, number][] = [
        [1.0, 1.0], [1.0, 7.0],
        [1.8, 1.0], [1.8, 2.2], [1.8, 5.3], [1.8, 7.0],
        [2.5, 2.2], [2.5, 4.03], [2.5, 5.9],
        [3.3, 0.8], [3.3, 2.5], [3.3, 5.5], [3.3, 7.2],
        [3.5, 4.03],
      ];
      return spots.map(([x, y]) => ({ ...side(alliance, x, y), yaw: sideYaw(alliance, 0) }));
    },
    goalCount: (ctx, alliance) => ctx.score.counter(alliance, 'fuelActive') + ctx.score.counter(alliance, 'fuelInactive'),
    goalCenter: (alliance) => side(alliance, C.HUB_CENTER.x, C.HUB_CENTER.y),
    // Alliance zone → neutral zone through every lane of both hub rows: 2 trenches + 2 bumps per row.
    traversals() {
      const hs = C.HUB_SIZE / 2;
      const lanes = [
        { label: 'trench (rail side)', y: C.TRENCH_OPENING_CENTER_Y, maxRobotHeight: C.TRENCH_CLEARANCE },
        { label: 'bump', y: C.HUB_CENTER.y - hs - C.BUMP_WIDTH / 2 },
        { label: 'bump', y: C.HUB_CENTER.y + hs + C.BUMP_WIDTH / 2 },
        { label: 'trench (far side)', y: C.FIELD_WIDTH - C.TRENCH_OPENING_CENTER_Y, maxRobotHeight: C.TRENCH_CLEARANCE },
      ];
      return (['blue', 'red'] as const).flatMap((a) =>
        lanes.map((l) => ({
          label: `${a} ${l.label} y=${l.y.toFixed(2)}`,
          from: side(a, C.ALLIANCE_ZONE_DEPTH - 1.2, l.y),
          to: side(a, C.ALLIANCE_ZONE_DEPTH + C.HUB_SIZE + 1.4, l.y),
          maxRobotHeight: l.maxRobotHeight,
        })),
      );
    },
  },
  controlsHelp: [...DEFAULT_CONTROLS_HELP, ['F', 'Shot blocker up / down (1323 MadTown): stops the intake, and a raised blocker can\'t fit under the TRENCH'], ['Aiming', 'Turret robots aim themselves; turretless robots with chassis auto-align rotate onto the HUB while you hold Space (you keep driving)'], ['REBUILT tips', 'Score (Space) only while YOUR hub is lit and your bumpers are in your ALLIANCE ZONE; from the neutral zone, feed (G) FUEL home']],
};
