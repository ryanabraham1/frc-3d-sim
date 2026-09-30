import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import type { RobotOption } from '@engine/core/season';
import { DEFAULT_ROBOT, RobotConfig, cloneConfig, footprint, sanitizeConfig } from '@engine/robot/config';
import { inch } from '@engine/units';
import * as C from './constants';
import { side, sideYaw } from './field';

/** Match timeline [M 6.4, Table 6-2] plus the 3 s scoring-assessment windows [M 6.5]. */
export const TIMELINE: MatchPeriod[] = [
  { id: 'auto', label: 'AUTO', duration: 20, mode: 'auto', displayGroup: 'auto' },
  { id: 'auto-pause', label: 'AUTO SCORING', duration: 3, mode: 'disabled' },
  { id: 'transition', label: 'TRANSITION', duration: 10, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'shift1', label: 'SHIFT 1', duration: 25, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'shift2', label: 'SHIFT 2', duration: 25, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'shift3', label: 'SHIFT 3', duration: 25, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'shift4', label: 'SHIFT 4', duration: 25, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'endgame', label: 'END GAME', duration: 30, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'post', label: 'FINAL SCORING', duration: 3, mode: 'disabled' },
];

/** Default REBUILT robot: fits under the TRENCH (22.25in), turret shooter, 40-FUEL hopper. */
export function rebuiltRobotDefaults(): RobotConfig {
  const c = cloneConfig(DEFAULT_ROBOT);
  c.height = inch(21);
  c.launcher.height = inch(19);
  c.hopperCapacity = 40;
  c.preload = C.FUEL_MAX_PRELOAD;
  c.climber.maxLevel = 3;
  // Full-width ground intake plus a hopper opening that catches FUEL from the OUTPOST CHUTE.
  c.intake = { ...c.intake, ground: true, station: true, stationSide: 'front' };
  c.autoAlign = true; // used only when the shooter has no turret
  return c;
}

/** R104/R107 size limits plus defaults for mechanism options added after configs were first saved. */
export function normalizeRebuiltConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, C.MAX_ROBOT_HEIGHT, C.MAX_ROBOT_PERIMETER);
  c.intake.ground ??= true;
  c.intake.station ??= true;
  c.intake.stationSide ??= 'front';
  c.intake.enabled = c.intake.ground || c.intake.station;
  c.autoAlign ??= !c.launcher.turret;
  c.preload = Math.min(c.preload, C.FUEL_MAX_PRELOAD, c.hopperCapacity);
  return c;
}

type Build = { intake: 'both' | 'ground' | 'outpost'; aim: 'turret' | 'align' | 'driver'; hopper: number; tall: boolean; rate: number; climb: 0 | 1 | 2 | 3 };
function build(b: Build): RobotConfig {
  const c = rebuiltRobotDefaults();
  c.intake.ground = b.intake !== 'outpost';
  c.intake.station = b.intake !== 'ground';
  c.launcher.turret = b.aim === 'turret';
  c.autoAlign = b.aim === 'align';
  c.hopperCapacity = b.hopper;
  c.height = b.tall ? inch(30) : inch(21);
  c.launcher.height = b.tall ? inch(26) : inch(19);
  c.launcher.rate = b.rate;
  c.climber.maxLevel = b.climb;
  return normalizeRebuiltConfig(c);
}

/** Archetypes seen across 2026 events (docs/ROBOT-ARCHETYPES.md). */
export function rebuiltRobotPresets() {
  return [
    { id: 'turret', label: 'Turret trench bot', description: 'Under 22¼ in so it drives through the TRENCH; full-width ground intake, turret shooter that scores on the move, 40-FUEL hopper, climbs to LEVEL 3.', config: build({ intake: 'both', aim: 'turret', hopper: 40, tall: false, rate: 8, climb: 3 }) },
    { id: 'fixed', label: 'Fixed shooter + auto-align', description: 'Trench-height robot with a double-wide fixed shooter aimed by rotating the chassis (auto-align), 50-FUEL hopper, LEVEL 1 climb. The most common competitive design.', config: build({ intake: 'both', aim: 'align', hopper: 50, tall: false, rate: 12, climb: 1 }) },
    { id: 'big-hopper', label: 'Big-hopper BUMP bot', description: 'Tall (30 in) with an 80-FUEL hopper and a fast multi-wheel shooter: too tall for the TRENCH, so it crosses the BUMPs. Auto-align, LEVEL 2 climb.', config: build({ intake: 'both', aim: 'align', hopper: 80, tall: true, rate: 16, climb: 2 }) },
    { id: 'outpost', label: 'OUTPOST-fed shooter', description: 'No ground intake: loads FUEL from its OUTPOST CHUTE, relying on the human player; auto-align shooter, 30-FUEL hopper, LEVEL 1 climb.', config: build({ intake: 'outpost', aim: 'align', hopper: 30, tall: false, rate: 8, climb: 1 }) },
  ];
}

const opt = (id: string, label: string, choices: [string, string, string?][], get: (c: RobotConfig) => string, set: (c: RobotConfig, v: string) => void, hint?: string): RobotOption =>
  ({ id, label, hint, choices: choices.map(([cid, l, title]) => ({ id: cid, label: l, title })), get, set: (c, v) => { set(c, v); Object.assign(c, normalizeRebuiltConfig(c)); } });

export const rebuiltRobotOptions: RobotOption[] = [
  opt('intake', 'FUEL intake', [['both', 'Ground + OUTPOST'], ['ground', 'Ground only'], ['outpost', 'OUTPOST only', 'Only FUEL released from your OUTPOST CHUTE into the hopper']],
    (c) => (c.intake.ground && c.intake.station ? 'both' : c.intake.ground ? 'ground' : 'outpost'),
    (c, v) => { c.intake.ground = v !== 'outpost'; c.intake.station = v !== 'ground'; },
    'Without a ground intake you can only reload at your OUTPOST (the human player opens the CHUTE with H).'),
  opt('aim', 'Shooter aiming', [['turret', 'Turret'], ['align', 'Chassis auto-align', 'Holding Space rotates the robot onto the HUB, then fires'], ['driver', 'Driver aims']],
    (c) => (c.launcher.turret ? 'turret' : c.autoAlign ? 'align' : 'driver'),
    (c, v) => { c.launcher.turret = v === 'turret'; c.autoAlign = v === 'align'; }),
  opt('hopper', 'Hopper', [['15', '15'], ['30', '30'], ['50', '50'], ['80', '80']],
    (c) => String([15, 30, 50, 80].reduce((b, x) => (Math.abs(x - c.hopperCapacity) < Math.abs(b - c.hopperCapacity) ? x : b), 30)),
    (c, v) => { c.hopperCapacity = Number(v); c.preload = Math.min(C.FUEL_MAX_PRELOAD, c.hopperCapacity); },
    'FUEL held at once; fewer trips to reload.'),
  opt('height', 'Height', [['trench', 'Under TRENCH (21 in)', 'Fits under the 22¼ in TRENCH'], ['tall', 'Tall (30 in)', 'Must cross the BUMPs']],
    (c) => (c.height <= C.TRENCH_CLEARANCE ? 'trench' : 'tall'),
    (c, v) => { c.height = v === 'tall' ? inch(30) : inch(21); c.launcher.height = Math.min(c.launcher.height, c.height - inch(2)); }),
  opt('rate', 'Shooter', [['8', 'Single (8/s)'], ['12', 'Double (12/s)'], ['16', 'Quad (16/s)']],
    (c) => String([8, 12, 16].reduce((b, x) => (Math.abs(x - c.launcher.rate) < Math.abs(b - c.launcher.rate) ? x : b), 8)),
    (c, v) => { c.launcher.rate = Number(v); }),
  opt('climb', 'TOWER climb', [['0', 'None'], ['1', 'LEVEL 1'], ['2', 'LEVEL 2'], ['3', 'LEVEL 3']],
    (c) => String(c.climber.maxLevel), (c, v) => { c.climber.maxLevel = Number(v); }, 'TELEOP 10 / 20 / 30 · AUTO LEVEL 1 15.'),
];

export function rebuiltSpecBars(config: RobotConfig) {
  const c = normalizeRebuiltConfig(config);
  const intake = c.intake.ground && c.intake.station ? 'ground + OUTPOST' : c.intake.ground ? 'ground' : 'OUTPOST only';
  return [
    { label: 'FUEL hopper', value: `${c.hopperCapacity}`, frac: c.hopperCapacity / 80 },
    { label: 'Fire rate', value: `${c.launcher.rate} /s`, frac: c.launcher.rate / 16 },
    { label: 'Aiming', value: c.launcher.turret ? 'Turret' : c.autoAlign ? 'Auto-align' : 'Driver', frac: c.launcher.turret ? 1 : c.autoAlign ? 0.7 : 0.3 },
    { label: 'Intake', value: intake, frac: (Number(c.intake.ground) * 2 + Number(c.intake.station)) / 3 },
  ];
}

/** Robots start in their ALLIANCE ZONE with bumpers behind the ROBOT STARTING LINE, facing the field. */
export function startPose(alliance: Alliance, station: number, robot = rebuiltRobotDefaults()): FieldPose {
  const fp = footprint(robot);
  const x = C.ALLIANCE_ZONE_DEPTH - C.TAPE_WIDTH - fp.length / 2 - 0.03;
  const p = side(alliance, x, C.DS_Y_BLUE[station - 1]);
  return { x: p.x, y: p.y, yaw: sideYaw(alliance, 0) };
}

export function driverEye(alliance: Alliance, station: number): { x: number; y: number; z: number; yaw: number } {
  const p = side(alliance, -1.6, C.DS_Y_BLUE[station - 1]);
  return { x: p.x, y: p.y, z: 1.95, yaw: sideYaw(alliance, 0) };
}
