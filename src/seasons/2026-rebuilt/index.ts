import type { SeasonDefinition } from '@engine/core/season';
import { DEFAULT_CONTROLS_HELP } from '@engine/input/input';
import * as C from './constants';
import { AUTO_ROUTINES, RebuiltAutoPilot } from './autopilot';
import { driverEye, rebuiltRobotDefaults, startPose, TIMELINE } from './config';
import { buildRebuiltField, RebuiltFieldRefs } from './field';
import { RebuiltHud } from './hud';
import { RebuiltRules } from './rules';

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
  maxClimbLevel: 3,
  autoRoutines: AUTO_ROUTINES,

  startPose: (a, s) => startPose(a, s),
  driverEye,

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
    { title: 'Robot limits', detail: 'R104/R107: 30 in tall max, 110 in frame perimeter. TRENCH clearance is 22.25 in.', value: '30 in', tag: 'R1' },
  ],
  controlsHelp: [...DEFAULT_CONTROLS_HELP, ['REBUILT tips', 'Score (Space) only while YOUR hub is lit and your bumpers are in your ALLIANCE ZONE; from the neutral zone, feed (G) FUEL home']],
};
