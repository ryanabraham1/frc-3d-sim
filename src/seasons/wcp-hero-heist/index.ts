import type { MapShape, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import type { RobotConfig } from '@engine/robot/config';
import { inch } from '@engine/units';
import * as C from './constants';
import { HERO_AI_ROLES, HERO_AI_STRATEGIES, AUTO_ROUTINES, HeroAutoPilot, createHeroBot } from './bots';
import { driverEye, heroClass, heroRobotDefaults, heroRobotOptions, heroRobotPresets, normalizeHeroConfig, PLAYING_MASS_ALLOWANCE, preloads, startPose, storage, TIMELINE } from './config';
import { buildHeroField, type HeroFieldRefs } from './field';
import { CX, DISTRICTS, DOWNTOWN, TOWER_ZONE_X, TRUSS_X, TRUSS_HALF_DEPTH, UPTOWN, collectorZone } from './geometry';
import { HeroHud } from './hud';
import { HERO_PIECES } from './pieces';
import { HeroHeistRules } from './rules';
import './robotModels';
import { heroTeamRobots } from './teamRobots';

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const mapShapes = (): MapShape[] => [
  { kind: 'zone', points: rect(TOWER_ZONE_X[0], 1.321, TOWER_ZONE_X[1], C.FIELD_WIDTH) },
  { kind: 'outpost', points: collectorZone('blue').map(p => [p.x, p.y] as [number, number]) },
  { kind: 'tower', points: rect(TRUSS_X - TRUSS_HALF_DEPTH, 0, TRUSS_X + TRUSS_HALF_DEPTH, C.FIELD_WIDTH) },
  { kind: 'depot', points: rect(CX - UPTOWN.halfLength, UPTOWN.face, CX, C.FIELD_WIDTH) },
  { kind: 'depot', points: rect(CX - DOWNTOWN.halfLength, 0, CX, DOWNTOWN.face) },
  { kind: 'hub', points: [[0, 6.909], [1.574, C.FIELD_WIDTH], [0, C.FIELD_WIDTH]] },
];

let fieldRefs: HeroFieldRefs | null = null;
const CLASS_NAME = { commander: 'Commander', mystic: 'Mystic', gadgeteer: 'Gadgeteer' } as const;

/** Standalone WCP CADathon game (not an FRC season): its 2025 manual date is source provenance only. */
export const heroHeist: SeasonDefinition = {
  id: C.GAME_ID,
  year: 2025,
  name: 'HERO HEIST',
  label: C.GAME_LABEL,
  subtitle: 'WCP CADathon',
  manualVersion: 'WCP Hero Heist 2025 Game Manual (23 pp., no revision id)',
  summary:
    'Two SUPERHERO SQUADS of three deliver STORY PANELS to MAILBOXES and launch SPEECH BUBBLES through CITY BLOCKS to take OWNERSHIP of 20 DISTRICTS, then climb their TOWER. Robots declare a hero class: COMMANDER, MYSTIC or GADGETEER.',

  fieldLength: C.FIELD_LENGTH,
  fieldWidth: C.FIELD_WIDTH,
  carpetColor: C.COLORS.carpet,
  maxRobotHeight: C.CLASS_LIMITS.commander.startHeight,
  maxRobotPerimeter: C.CLASS_LIMITS.commander.perimeter,
  maxRobotWeight: C.CLASS_LIMITS.commander.mass + PLAYING_MASS_ALLOWANCE,
  foulValues: C.FOUL_VALUES,
  timeline: TIMELINE,
  endgameSeconds: C.ENDGAME_SECONDS,
  gamePiece: HERO_PIECES,
  pieceFlow: false,
  robotDefaults: heroRobotDefaults(),
  normalizeRobotConfig: normalizeHeroConfig,
  robotPresets: heroRobotPresets(),
  teamRobots: heroTeamRobots(),
  robotOptions: heroRobotOptions,
  robotFields: ['team', 'height', 'len', 'wid', 'speed', 'accel', 'weight', 'pre', 'rate', 'acc'],
  robotHint: 'Pick a hero class first: it sets the frame, height and how many STORY PANELS / SPEECH BUBBLES the robot may hold.',
  robotSummary(c: RobotConfig) {
    const s = storage(c), p = preloads(c);
    return `${CLASS_NAME[heroClass(c)]} · ${s.panels} panel${s.panels === 1 ? '' : 's'} · ${s.bubbles} bubbles · preload ${p.panels}P ${p.bubbles}B`;
  },
  robotSpecBars(c: RobotConfig) {
    const s = storage(c);
    return [
      { label: 'Panels', value: String(s.panels), frac: s.panels / 3 },
      { label: 'Bubbles', value: String(s.bubbles), frac: s.bubbles / 6 },
      { label: 'Mailbox reach', value: ['—', 'Slits', 'Low baskets', 'All'][c.placement?.enabled ? c.placement.maxLevel : 0], frac: (c.placement?.enabled ? c.placement.maxLevel : 0) / 3 },
      { label: 'Climb', value: ['None', 'Low', 'Medium', 'High'][c.climber.maxLevel], frac: c.climber.maxLevel / 3 },
    ];
  },
  maxClimbLevel: 3,
  climberLabels: ['LOW', 'MEDIUM', 'HIGH'],
  autoRoutines: AUTO_ROUTINES,
  mapShapes: mapShapes(),
  mapSymmetry: 'mirror',
  /** G01: fully inside your TOWER ZONE. */
  startArea: { rect: { x0: TOWER_ZONE_X[0], x1: TOWER_ZONE_X[1], y0: 1.321, y1: C.FIELD_WIDTH } },
  humanPlayerButtons: 2,
  humanPlayerHint: { auto: 'Human players feed bubbles down the chute and panels out of the slide to robots waiting with their intake on.', manual: 'H opens / closes the bubble chute (bubbles keep rolling out until you close it); B slides a STORY PANEL out of the slot nearest your robot.' },
  touchLabels: { pass: 'PANEL' },
  aimTargets: DISTRICTS.map(d => ({ id: d.id, label: d.label, point: d.cityBlock.center })),
  startPose,
  driverEye,

  buildField(ctx) { fieldRefs = buildHeroField(ctx.builder); },
  createRules(ctx) {
    if (!fieldRefs) throw new Error('buildField must run before createRules');
    return new HeroHeistRules(ctx, fieldRefs);
  },
  createAutoPilot(ctx, rules, robot, routine) { return new HeroAutoPilot(ctx, rules as HeroHeistRules, robot, routine); },
  botAutoRoutine() { return 'score'; },
  botArchetype(_difficulty, station, role) {
    if (role === 'claimer') return 'commander-roller';
    if (role === 'farmer') return 'mystic-turret';
    return ['gadgeteer-hybrid', 'commander-roller', 'mystic-turret'][(station - 1) % 3];
  },
  botRobotConfig() { return heroRobotPresets()[0].config; },
  createBotPilot(ctx, rules, robot) { return createHeroBot(ctx, rules as HeroHeistRules, robot); },
  aiStrategies: HERO_AI_STRATEGIES,
  aiRoles: HERO_AI_ROLES,
  createHud(ctx, rules, slots) { return new HeroHud(ctx, rules as HeroHeistRules, slots); },
  controlsHelp: [
    ...DEFAULT_CONTROLS_HELP,
    ['Space', 'Launch a SPEECH BUBBLE at the targeted CITY BLOCK (automatic: the best one in range, or the one you point at)'],
    [', / .', 'Pick the CITY BLOCK yourself (UPTOWN 1-6, DOWNTOWN 1-6, FOOTHILLS); Z = back to automatic · gamepad R3 = next'],
    ['G (hold)', 'Deliver a STORY PANEL into the MAILBOX in front of you (with the vision assist the robot squares up itself)'],
    ['H / B', 'Human player: open / close the bubble chute (a steady stream) / slide one panel out'],
    ['C / X', 'Climb under a CLIMB PAD (TELEOP) / descend'],
  ],
  rulesSummary: [
    { title: 'Bubble into your partially/fully owned district', detail: 'SQUAD-colored SPEECH BUBBLE through a CITY BLOCK. No OWNERSHIP change.', value: '6 / 3', tag: 'SB' },
    { title: 'Bubble into a neutral district', detail: '+1 OWNERSHIP toward you, or -1 from the opponent\'s +1.', value: '2 / 1', tag: 'SB' },
    { title: 'Bubble into an opponent-owned district', detail: 'No FAME; -1 opponent OWNERSHIP.', value: '0', tag: 'SB' },
    { title: 'STORY PANEL into a MAILBOX', detail: '+2 OWNERSHIP in neutral/own districts, -4 opponent OWNERSHIP (no overflow). Points come from the ownership it changes. Slits need the panel square within about an inch; FOOTHILL baskets are top-fed.', tag: 'SP' },
    { title: 'PARTIAL / FULL OWNERSHIP', detail: 'Live: lost if the district changes hands. FULL replaces PARTIAL.', value: '10 / 25', tag: 'OW' },
    { title: 'FULL OWNERSHIP in AUTO', detail: 'Once per district per squad.', value: '+10', tag: 'AU' },
    { title: 'PARK / LOW / MEDIUM / HIGH climb', detail: 'Only touching a CLIMB PAD; MEDIUM 35 in and HIGH 45 in off the floor, with no part above 78 in (G18).', value: '5/20/35/50', tag: 'TW' },
    { title: 'Ranking points', detail: 'Win 3 · tie 1 · all robots leave the TOWER ZONE in AUTO · 8 partial or 5 full districts ever · 60 TOWER points.', value: '+1 each', tag: 'RP' },
    { title: 'G14 protected zones', detail: 'No contact with an opponent partly in its COLLECTOR or HOME ZONE, or its TOWER ZONE in the last 20 s (that awards it a HIGH CLIMB).', value: 'FOUL 25', tag: 'G1' },
    { title: 'G21 launch zone', detail: 'Bubbles only from fully inside the LAUNCH ZONE. Panels may never be launched.', value: 'FOUL 25', tag: 'G2' },
    { title: 'G04 / G11 / G18', detail: 'AUTO contact across the CENTER LINE, pins over 3 s, anything above 78 in in a TOWER ZONE.', value: 'TECH 50', tag: 'G0' },
    { title: 'Hero classes', detail: 'COMMANDER 3 panels, 60 in start; MYSTIC 6 bubbles, 42 in; GADGETEER 1 panel + 3 bubbles (2 / 4 of one type), 30 in start.', tag: 'CL' },
  ],
  testing: {
    mechanism: 'projectile',
    scatterCount: 24,
    // Grid in the LAUNCH ZONE in front of UPTOWN 2 (blue) / UPTOWN 5 (red), aimed through the real 45° window.
    scoringSpots(alliance) {
      const d = DISTRICTS[alliance === 'blue' ? 1 : 4];
      const x0 = d.cityBlock.center.x;
      return [[-1.0, 5.2], [0, 5.2], [1.0, 5.2], [-0.8, 6.0], [0, 6.0], [0.8, 6.0], [-0.5, 6.7], [0, 6.7], [0.5, 6.7], [0, 4.4]]
        .map(([dx, y]) => ({ x: x0 + dx, y, yaw: Math.PI / 2 }));
    },
    // A driver shoots at the 45° UPTOWN window from 1.4-5.5 m out, not from against the wall underneath it.
    canScoreFrom(alliance, x, y) {
      const c = DISTRICTS[alliance === 'blue' ? 1 : 4].cityBlock.center;
      return c.y - y >= 1.4 && Math.hypot(c.x - x, c.y - y) <= 5.5;
    },
    goalCount: (ctx) => (['red', 'blue'] as const).reduce((s, a) => s + ctx.score.counter(a, 'bubbleSensed') + ctx.score.counter(a, 'bubbles'), 0),
    goalCenter(alliance) { const c = DISTRICTS[alliance === 'blue' ? 1 : 4].cityBlock.center; return { x: c.x, y: c.y }; },
    traversals() {
      const lanes = [
        { label: 'under the truss (between pads)', y: 6.9, maxRobotHeight: C.TRUSS_CLEARANCE - inch(0.5) },
        { label: 'under the truss (DOWNTOWN side)', y: 1.9, maxRobotHeight: C.TRUSS_CLEARANCE - inch(0.5) },
      ];
      return [
        ...(['blue', 'red'] as const).flatMap(a => lanes.map(l => ({ label: `${a} ${l.label}`, from: { x: a === 'blue' ? 2.8 : C.FIELD_LENGTH - 2.8, y: l.y }, to: { x: a === 'blue' ? 5.6 : C.FIELD_LENGTH - 5.6, y: l.y }, maxRobotHeight: l.maxRobotHeight }))),
        { label: 'across the CENTER LINE', from: { x: CX - 2, y: 4.1 }, to: { x: CX + 2, y: 4.1 } },
      ];
    },
  },
};

