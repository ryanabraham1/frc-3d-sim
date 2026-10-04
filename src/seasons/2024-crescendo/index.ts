import { createCrescendoBot, CRESCENDO_AI_ROLES, CRESCENDO_AI_STRATEGIES } from './bots';
import type { SeasonContext, SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import type { StartArea } from '@engine/startPose';
import { BATTERY_MASS } from '@engine/robot/drivetrain';
import { lb } from '@engine/units';
import * as C from './constants';
import { AUTO_ROUTINES, CrescendoAutoPilot } from './autopilot';
import { CLIMBER_LABELS, crescendoRobotDefaults, crescendoRobotOptions, crescendoRobotPresets, crescendoSpecBars, driverEye, normalizeCrescendoConfig, startPose, TIMELINE } from './config';
import { crescendoTeamRobots } from './teamRobots';
import { buildCrescendoField, type CrescendoFieldRefs } from './field';
import { CrescendoHud } from './hud';
import { CrescendoRules } from './rules';

const fields = new WeakMap<SeasonContext, CrescendoFieldRefs>();
const pts = (p: { x: number; y: number }[]): [number, number][] => p.map((q) => [q.x, q.y]);

/** ROBOT STARTING ZONE [M 5.2, G303]; the SUBWOOFER is the only field element inside it. */
function crescendoStartArea(): StartArea {
  const z = C.startZone('blue');
  const xs = z.map((p) => p.x), ys = z.map((p) => p.y);
  const sub: [number, number][] = [[0, C.SPEAKER_Y - C.SUBWOOFER_BACK_HALF_WIDTH], [C.SUBWOOFER_DEPTH, C.SPEAKER_Y - C.SUBWOOFER_FRONT_HALF_WIDTH], [C.SUBWOOFER_DEPTH, C.SPEAKER_Y + C.SUBWOOFER_FRONT_HALF_WIDTH], [0, C.SPEAKER_Y + C.SUBWOOFER_BACK_HALF_WIDTH]];
  return { rect: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, keepOut: [sub] };
}

export const crescendo2024: SeasonDefinition = {
  id: '2024-crescendo',
  year: 2024,
  name: 'CRESCENDO',
  subtitle: 'presented by Haas',
  manualVersion: '2024 Game Manual (kickoff release V0)',
  summary:
    'Score NOTES in your SPEAKER and AMP. Two AMP NOTES let your human player AMPLIFY the SPEAKER for 10 s; one can instead go to Coopertition. End onstage on a STAGE chain — harmonize, SPOTLIGHT with HIGH NOTES and fill the TRAPS.',
  fieldLength: C.FIELD_LENGTH,
  fieldWidth: C.FIELD_WIDTH,
  carpetColor: C.COLORS.carpet,
  maxRobotHeight: C.MAX_ROBOT_HEIGHT,
  maxRobotPerimeter: C.MAX_PERIMETER,
  maxRobotWeight: lb(125 + 15) + BATTERY_MASS, // R103 robot + R407 bumpers, plus the battery
  foulValues: { ...C.FOULS },
  timeline: TIMELINE,
  gamePiece: {
    name: 'NOTE',
    shape: 'ring',
    radius: C.NOTE_OUTER_RADIUS,
    innerRadius: C.NOTE_INNER_RADIUS,
    length: C.NOTE_THICKNESS,
    mass: C.NOTE_MASS,
    restitution: 0.25,
    friction: 0.75,
    airDamping: 0.03,
    groundDamping: 2.2,
    angularDamping: 2.5,
    color: C.COLORS.note,
    count: C.PIECE_COUNT,
    variants: [{ start: C.HIGH_NOTE_START, spec: { name: 'HIGH NOTE', shape: 'ring', radius: C.NOTE_OUTER_RADIUS, innerRadius: C.NOTE_INNER_RADIUS, length: C.NOTE_THICKNESS, stripes: 3, mass: C.NOTE_MASS, restitution: 0.25, friction: 0.75, airDamping: 0.03, groundDamping: 2.2, angularDamping: 2.5, color: C.COLORS.note, count: 2 * C.HIGH_NOTES_PER_ALLIANCE } }],
  },
  robotDefaults: crescendoRobotDefaults(),
  maxClimbLevel: 2,
  climberLabels: CLIMBER_LABELS,
  robotLimits: { capacity: 1, preload: 1 },
  robotHint: 'R104: 4 ft starting height / 120 in perimeter · under 27⅞ in drives beneath the STAGE · G409: 1 NOTE',
  normalizeRobotConfig: normalizeCrescendoConfig,
  robotPresets: crescendoRobotPresets(),
  robotOptions: crescendoRobotOptions,
  teamRobots: crescendoTeamRobots(),
  robotSpecBars: crescendoSpecBars,
  robotFields: ['team', 'height', 'len', 'wid', 'speed', 'accel', 'weight', 'tread', 'rate', 'acc', 'cspd'],
  configureRobot(robot) {
    robot.projectile = { radius: C.NOTE_OUTER_RADIUS, airDamping: 0.03, halfHeight: C.NOTE_THICKNESS / 2 };
  },
  autoRoutines: AUTO_ROUTINES,
  mapSymmetry: 'mirror',
  mapShapes: [
    { kind: 'zone', points: pts(C.startZone('blue')) },
    { kind: 'hub', points: [[0, C.SPEAKER_Y - C.SUBWOOFER_BACK_HALF_WIDTH], [C.SUBWOOFER_DEPTH, C.SPEAKER_Y - C.SUBWOOFER_FRONT_HALF_WIDTH], [C.SUBWOOFER_DEPTH, C.SPEAKER_Y + C.SUBWOOFER_FRONT_HALF_WIDTH], [0, C.SPEAKER_Y + C.SUBWOOFER_BACK_HALF_WIDTH]] },
    { kind: 'bump', points: pts(C.stageZone('blue')) },
    { kind: 'depot', points: pts(C.ampZone('blue')) },
    { kind: 'outpost', points: pts(C.sourceZone('red')) },
  ],
  humanPlayerButtons: 4,
  humanPlayerHint: {
    auto: 'Your SOURCE human player drops a NOTE down the CHUTE whenever you wait at the SOURCE; your AMP human player uses Coopertition and throws HIGH NOTES in the last 20 s. AMPLIFY is always manual: press B (LB) with 2 AMP NOTES banked.',
    manual: 'You are the human players: H = drop a NOTE down the SOURCE CHUTE toward your robot, B = AMPLIFY, N = Coopertition, M = throw a HIGH NOTE (last 20 s).',
  },
  startPose,
  startArea: crescendoStartArea(),
  driverEye,
  buildField(ctx) {
    fields.set(ctx, buildCrescendoField(ctx));
  },
  createRules(ctx) {
    const refs = fields.get(ctx);
    if (!refs) throw new Error('Build the CRESCENDO field first');
    return new CrescendoRules(ctx, refs);
  },
  createAutoPilot(ctx, rules, robot, routine) {
    return new CrescendoAutoPilot(ctx, rules as CrescendoRules, robot, routine);
  },
  botAutoRoutine(station, config) {
    if (config?.intake.ground === false) return config.launcher.enabled ? 'shoot-leave' : 'leave';
    if (config && !config.launcher.enabled) return 'amp-2';
    return station === 2 ? 'wing-4' : 'center-2';
  },
  botArchetype(difficulty, station, role) {
    const byRole: Record<string, string> = { amp: 'amp-trap', feeder: 'source-pivot', shooter: 'turret', defender: 'pivot' };
    if (role && byRole[role]) return byRole[role];
    const lineups: Record<string, string[]> = { easy: ['kitbot', 'source-pivot', 'pivot'], normal: ['pivot', 'pivot', 'turret'], hard: ['pivot', 'turret', 'turret'], elite: ['turret', 'turret', 'turret'] };
    return lineups[difficulty][(station - 1) % 3];
  },
  aiStrategies: CRESCENDO_AI_STRATEGIES,
  aiRoles: CRESCENDO_AI_ROLES,
  botRobotConfig(difficulty) { return difficulty === 'hard' || difficulty === 'elite' ? crescendoRobotPresets().find((p) => p.id === 'turret')!.config : this.robotDefaults; },
  createBotPilot(ctx, rules, robot) { return createCrescendoBot(ctx, rules as CrescendoRules, robot); },
  createHud(ctx, rules, slots) {
    return new CrescendoHud(ctx, rules as CrescendoRules, slots);
  },
  controlsHelp: [
    ...DEFAULT_CONTROLS_HELP.filter(([key]) => !['Space', 'G', 'C / X', '1 2 3  or  [ ]', 'H', 'Gamepad'].includes(key)),
    ['Space / RT', 'Shoot the held NOTE into your SPEAKER (hold; chassis auto-align turns the robot onto the SPEAKER first) · while ONSTAGE: place it in the TRAP'],
    ['G / RB', 'At your AMP: score the NOTE in the AMP · elsewhere: pass toward your WING'],
    ['C / A · X / B', 'Climb the STAGE chain you are under (TELEOP) · descend'],
    ['H / gamepad X', 'SOURCE human player: drop a NOTE down the CHUTE toward your robot (TELEOP)'],
    ['B / gamepad LB', 'AMP human player: AMPLIFY (needs 2 banked AMP NOTES)'],
    ['N', 'AMP human player: Coopertition (first 45 s of TELEOP, 1 banked NOTE)'],
    ['M', 'AMP human player: throw a HIGH NOTE at a MICROPHONE (last 20 s)'],
    ['Gamepad', 'LS drive · RS rotate · RT shoot (auto-aligns without a turret) · RB amp/pass · LT intake · A climb · B descend · X SOURCE drop · LB amplify · Y camera'],
  ],
  rulesSummary: [
    { title: 'AUTO / TELEOP', detail: '15 s AUTO (robots on their own), 3 s scoring pause, 2:15 TELEOP. SPEAKER NOTES still count for 3 s after each 0:00; the STAGE is assessed 5 s after the end.', value: '2:30', tag: 'TIME' },
    { title: 'LEAVE', detail: 'BUMPERS completely clear of the ROBOT STARTING ZONE at any point during AUTO.', value: '2', tag: 'AUTO' },
    { title: 'AMP NOTE', detail: 'AUTO 2 / TELEOP 1. Two AMP NOTES let the human player AMPLIFY the SPEAKER for 10 s (+3 s processing). NOTES scored while AMPLIFIED do not bank.', value: '2 / 1', tag: 'AMP' },
    { title: 'SPEAKER NOTE', detail: 'AUTO 5 · TELEOP 2 · TELEOP AMPLIFIED 5. The opening sits under a hood 6 ft 6 in – 6 ft 10⅞ in up: shoot flat or rising, not a high lob.', value: '5 / 2 / 5', tag: 'SPEAKER' },
    { title: 'STAGE', detail: 'PARK 1 · ONSTAGE 3 (SPOTLIT 4) · HARMONY +2 per extra robot on a chain · NOTE in TRAP 5 (one per TRAP).', value: '1–5', tag: 'STAGE' },
    { title: 'MELODY / ENSEMBLE RP', detail: 'MELODY: 18 AMP + SPEAKER NOTES (15 with the Coopertition Bonus). ENSEMBLE: 10 STAGE points and 2 ONSTAGE robots. Win 2 RP, tie 1 RP.', value: '1 each', tag: 'RP' },
    { title: 'Coopertition', detail: 'Both alliances press Coopertition with a banked AMP NOTE in the first 45 s of TELEOP: 1 Coopertition point each and MELODY drops to 15.', tag: 'COOP' },
    { title: 'Fouls enforced', detail: 'FOUL 2 / TECH FOUL 5. G404 AUTO shots from outside the WING · G405 AUTO contact past the CENTER LINE · G414 full-court shots · G422 PODIUM · G423 SOURCE/AMP ZONE · G424 STAGE protection (2 TECH FOULS + opponent ENSEMBLE).', tag: 'FOUL' },
    { title: 'Simulation model', detail: 'SPEAKER shots, passes, SOURCE CHUTE drops and HIGH NOTE throws are physical; intakes, shooter type and aiming (turret / chassis auto-align / driver) are robot options. AMP deposits, chain climbs and TRAP placement are assisted. Positions not dimensioned in the manual were measured from its figures (see docs/CRESCENDO.md).', tag: 'SIM' },
  ],
  testing: {
    scatterCount: 5, // a CENTER LINE's worth of loose NOTES
    scoringSpots(a) {
      const out = [];
      for (const d of [1.45, 2.1, 2.8, 3.5]) {
        for (const ang of [-40, -15, 10, 35]) {
          const t = (ang * Math.PI) / 180;
          const s = C.speakerCenter(a);
          const x = C.side(a, d * Math.cos(t), 0).x;
          const y = s.y + d * Math.sin(t);
          out.push({ x, y, yaw: C.sideYaw(a, 0) });
        }
      }
      return out;
    },
    goalCount: (ctx, a) => ctx.pool.countIn('reserve', `speaker:${a}`),
    goalCenter: (a) => C.speakerAim(a),
    // The opening is 41⅜ in wide but 18 in deep (hood cheeks): beyond ~50° off its axis a NOTE can't get in.
    canScoreFrom(a, x, y) {
      const perp = C.fromWall(a, x) - C.SPEAKER_OPENING_DEPTH / 2;
      return perp > 0 && Math.abs(Math.atan2(y - C.SPEAKER_Y, perp)) < (50 * Math.PI) / 180 && Math.hypot(perp, y - C.SPEAKER_Y) < 6;
    },
    traversals() {
      const lanes = [];
      for (const a of ['blue', 'red'] as const) {
        const c = C.stageCenter(a);
        // Straight under the core: in through the CENTER STAGE gap, out through a side gap (30° off the axis).
        const t = C.sideYaw(a, Math.PI / 6);
        const r = 1.9;
        lanes.push({ label: `${a} under STAGE`, from: { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r }, to: { x: c.x - Math.cos(t) * r, y: c.y - Math.sin(t) * r }, maxRobotHeight: C.STAGE_CLEARANCE });
      }
      lanes.push({ label: 'CENTER LINE lane', from: { x: C.L / 2 - 2.5, y: C.W / 2 - 0.84 }, to: { x: C.L / 2 + 2.5, y: C.W / 2 - 0.84 } });
      lanes.push({ label: 'AMP-side wall lane', from: { x: 3.2, y: C.W - 0.7 }, to: { x: C.L - 3.2, y: C.W - 0.7 } });
      return lanes;
    },
  },
};
