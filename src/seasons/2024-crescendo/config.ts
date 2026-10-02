import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import type { RobotOption } from '@engine/core/season';
import { cloneConfig, DEFAULT_ROBOT, sanitizeConfig, type RobotConfig } from '@engine/robot/config';
import { deg, inch } from '@engine/units';
import * as C from './constants';

/**
 * MATCH timeline [M 6.4, 6.5]: 15 s AUTO, a 3 s scoring delay, 2:15 TELEOP (the final 20 s split out as
 * END GAME for G422/G424/G430), then 5 s until STAGE assessment (SPEAKER notes count for the first 3 s).
 */
export const TIMELINE: MatchPeriod[] = [
  { id: 'auto', label: 'AUTO', duration: C.AUTO_SECONDS, mode: 'auto', displayGroup: 'auto' },
  { id: 'auto-pause', label: 'AUTO SCORING', duration: 3, mode: 'disabled' },
  { id: 'teleop', label: 'TELEOP', duration: C.TELEOP_SECONDS - C.ENDGAME_SECONDS, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'endgame', label: 'END GAME', duration: C.ENDGAME_SECONDS, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'post', label: 'STAGE ASSESSMENT', duration: C.STAGE_ASSESS_DELAY, mode: 'disabled' },
];

/** Climber levels for the menu: 1 = chain only, 2 = chain + TRAP scorer. */
export const CLIMBER_LABELS = ['None', 'Chain', 'Chain + TRAP'];

export function crescendoRobotDefaults(): RobotConfig {
  const c = cloneConfig(DEFAULT_ROBOT);
  // Short enough to pass under the STAGE core (27⅞ in) — a simulator design choice, not a rule.
  c.height = inch(24);
  c.frameLength = c.frameWidth = inch(26);
  // Low BUMPERS (R402 zone is 0–7½ in) so a flat 2 in NOTE is pushed, never climbed.
  c.bumperBottom = inch(0.75);
  c.bumperTop = inch(5.75);
  c.hopperCapacity = 1; // G409: one NOTE at a time
  c.preload = 1; // [M 6.3.4 D] one preload per ROBOT
  // Under-the-bumper ground intake plus SOURCE intake (catching NOTES out of the CHUTE) on the BACK, opposite the
  // shooter (the same intake mouth does both on real robots).
  c.intake = { enabled: true, width: inch(20), reach: inch(4), maxHeight: inch(5), ground: true, groundSide: 'back', station: true, stationSide: 'back' };
  c.maxSpeed = 4.6;
  c.maxAccel = 9;
  c.launcher = {
    ...c.launcher,
    rate: 6, // feeder recovery: with one NOTE at a time this only matters right after an intake
    angle: deg(38),
    minAngle: deg(8),
    maxAngle: deg(62),
    minSpeed: 3,
    maxSpeed: 20,
    height: inch(22),
    turret: false, // most 2024 shooters were fixed to the chassis and aimed by rotating the robot
    spread: 0.0035,
    speedError: 0.006,
    manualSpeed: 13,
  };
  c.climber = { maxLevel: 1, secondsPerLevel: 2.2 };
  c.autoAlign = true;
  c.aimAssist = 'full';
  c.options = { amp: true, shooter: 'pivot' };
  return c;
}

/** Enforce R104 (4 ft, 120 in perimeter) and G409 (one NOTE). */
export function normalizeCrescendoConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, C.MAX_ROBOT_HEIGHT, C.MAX_PERIMETER);
  c.hopperCapacity = 1;
  c.preload = Math.min(1, Math.max(0, c.preload));
  c.climber.maxLevel = Math.round(Math.min(2, Math.max(0, c.climber.maxLevel)));
  c.intake.maxHeight = Math.max(c.intake.maxHeight, inch(3));
  c.intake.ground ??= true;
  c.intake.station ??= true;
  c.intake.groundSide ??= 'back';
  c.intake.stationSide ??= 'back';
  c.intake.enabled = c.intake.ground || c.intake.station;
  c.options = { amp: true, shooter: c.launcher.enabled ? 'pivot' : 'none', ...c.options };
  if (!c.launcher.enabled) c.options.shooter = 'none';
  else if (c.options.shooter === 'none') c.options.shooter = 'pivot';
  if (c.options.shooter === 'fixed') {
    // Fixed hood, limited flywheel speed: only reliable from against the SUBWOOFER (the 2024 KitBot shot).
    c.launcher.minAngle = c.launcher.maxAngle = c.launcher.angle = FIXED_ANGLE;
    c.launcher.maxSpeed = Math.min(c.launcher.maxSpeed, FIXED_MAX_SPEED);
    c.launcher.turret = false;
  }
  c.autoAlign ??= !c.launcher.turret;
  return c;
}

/** Fixed-shooter hood angle and flywheel speed cap [EST — tuned so shots only go in from near the SUBWOOFER]. */
export const FIXED_ANGLE = deg(60);
export const FIXED_MAX_SPEED = 8.5;

type Build = {
  ground: boolean; source: boolean; shooter: 'none' | 'fixed' | 'pivot'; aim: 'turret' | 'align' | 'driver'; amp: boolean; climb: 0 | 1 | 2;
};
function build(b: Build): RobotConfig {
  const c = crescendoRobotDefaults();
  c.intake.ground = b.ground;
  c.intake.station = b.source;
  c.launcher.enabled = b.shooter !== 'none';
  c.options = { ...c.options, shooter: b.shooter, amp: b.amp };
  c.launcher.turret = b.aim === 'turret';
  c.autoAlign = b.aim === 'align';
  c.climber.maxLevel = b.climb;
  return normalizeCrescendoConfig(c);
}

/** Archetypes seen across 2024 events (docs/ROBOT-ARCHETYPES.md). */
export function crescendoRobotPresets() {
  return [
    { id: 'pivot', label: 'Under-bumper pivot shooter', description: 'Full-width ground intake, pivoting shooter that scores from anywhere in the WING, AMPs with the shooter, chassis auto-aim, chain climb. The dominant 2024 design.', config: build({ ground: true, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: 1 }) },
    { id: 'turret', label: 'Turret shooter', description: 'Ground intake + turreted pivot shooter: shoots while driving in any direction. Rare (heavy and complex) but strong.', config: build({ ground: true, source: true, shooter: 'pivot', aim: 'turret', amp: true, climb: 1 }) },
    { id: 'source-pivot', label: 'SOURCE-fed shooter', description: 'Pivot shooter that only takes NOTES from the SOURCE CHUTE (no ground intake): relies on SOURCE human players.', config: build({ ground: false, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: 1 }) },
    { id: 'kitbot', label: 'KitBot (SUBWOOFER shooter)', description: 'Fixed-angle shooter fed at the SOURCE: scores from against the SUBWOOFER and in the AMP, no ground intake, no climber, driver-aimed.', config: build({ ground: false, source: true, shooter: 'fixed', aim: 'driver', amp: true, climb: 0 }) },
    { id: 'amp-trap', label: 'AMP + TRAP specialist', description: 'Ground intake and an AMP/TRAP arm, no SPEAKER shooter: feeds AMPLIFICATION and scores the TRAP from the chain.', config: build({ ground: true, source: true, shooter: 'none', aim: 'driver', amp: true, climb: 2 }) },
  ];
}

const opt = (id: string, label: string, choices: [string, string, string?][], get: (c: RobotConfig) => string, set: (c: RobotConfig, v: string) => void, hint?: string): RobotOption =>
  ({ id, label, hint, choices: choices.map(([cid, l, title]) => ({ id: cid, label: l, title })), get, set: (c, v) => { set(c, v); Object.assign(c, normalizeCrescendoConfig(c)); } });

export const crescendoRobotOptions: RobotOption[] = [
  opt('intake', 'NOTE intake', [['both', 'Ground + SOURCE'], ['ground', 'Ground only'], ['source', 'SOURCE only', 'Only catches NOTES sliding out of the SOURCE CHUTE']],
    (c) => (c.intake.ground && c.intake.station ? 'both' : c.intake.ground ? 'ground' : 'source'),
    (c, v) => { c.intake.ground = v !== 'source'; c.intake.station = v !== 'ground'; },
    'Without a ground intake you can only collect at the SOURCE (and not the staged NOTES in AUTO).'),
  opt('shooter', 'SPEAKER shooter', [['pivot', 'Pivot', 'Adjustable angle: scores from most of the WING'], ['fixed', 'Fixed (SUBWOOFER)', 'One angle, limited speed: scores from against the SUBWOOFER'], ['none', 'None']],
    (c) => String(c.options?.shooter ?? 'pivot'),
    (c, v) => {
      c.launcher.enabled = v !== 'none';
      const d = crescendoRobotDefaults().launcher;
      if (v === 'pivot') Object.assign(c.launcher, { angle: d.angle, minAngle: d.minAngle, maxAngle: d.maxAngle, maxSpeed: d.maxSpeed });
      c.options = { ...c.options, shooter: v };
    }),
  opt('aim', 'Aiming', [['align', 'Chassis auto-align', 'Holding Space rotates the robot onto the SPEAKER, then fires'], ['turret', 'Turret'], ['driver', 'Driver aims']],
    (c) => (c.launcher.turret ? 'turret' : c.autoAlign ? 'align' : 'driver'),
    (c, v) => { c.launcher.turret = v === 'turret' && c.options?.shooter !== 'fixed'; c.autoAlign = v === 'align'; }),
  opt('amp', 'AMP scoring', [['yes', 'Yes'], ['no', 'No']], (c) => (c.options?.amp === false ? 'no' : 'yes'), (c, v) => { c.options = { ...c.options, amp: v === 'yes' }; }),
  opt('climb', 'Climber', [['0', 'None'], ['1', 'Chain'], ['2', 'Chain + TRAP']], (c) => String(c.climber.maxLevel), (c, v) => { c.climber.maxLevel = Number(v); },
    'ONSTAGE 3 (SPOTLIT 4) · HARMONY +2 · TRAP 5.'),
];

export function crescendoSpecBars(config: RobotConfig) {
  const c = normalizeCrescendoConfig(config);
  const intake = c.intake.ground && c.intake.station ? 'ground + SOURCE' : c.intake.ground ? 'ground' : 'SOURCE only';
  const shooter = !c.launcher.enabled ? 'None' : `${c.options?.shooter === 'fixed' ? 'Fixed' : 'Pivot'} · ${c.launcher.turret ? 'turret' : c.autoAlign ? 'auto-align' : 'driver aim'}`;
  return [
    { label: 'Intake', value: intake, frac: (Number(c.intake.ground) * 2 + Number(c.intake.station)) / 3 },
    { label: 'SPEAKER', value: shooter, frac: !c.launcher.enabled ? 0 : c.options?.shooter === 'fixed' ? 0.35 : c.launcher.turret ? 1 : 0.8 },
    { label: 'AMP', value: c.options?.amp === false ? 'No' : 'Yes', frac: c.options?.amp === false ? 0 : 1 },
  ];
}

/** DRIVER STATION center (y) for station 1–3 (DS 1 on the AMP side [EST]). */
export function stationY(station: number): number {
  const [y0, y1] = C.DS_SPANS[Math.min(3, Math.max(1, station)) - 1];
  return (y0 + y1) / 2;
}

/** Starting poses inside the ROBOT STARTING ZONE [M 5.2, G303]: DS 2's robot against the SUBWOOFER. */
export function startPose(a: Alliance, station: number): FieldPose {
  const half = inch(26 + 7) / 2;
  const spots = [
    { x: C.START_ZONE_DEPTH - half - inch(3), y: C.SPEAKER_Y + inch(60) },
    { x: C.SUBWOOFER_DEPTH + half + inch(1), y: C.SPEAKER_Y },
    { x: C.START_ZONE_DEPTH - half - inch(3), y: C.SPEAKER_Y - inch(66) },
  ];
  const s = spots[Math.min(3, Math.max(1, station)) - 1];
  return { ...C.side(a, s.x, s.y), yaw: C.sideYaw(a, 0) };
}

export function driverEye(a: Alliance, station: number) {
  const p = C.side(a, -0.9, stationY(station));
  return { ...p, z: 1.75, yaw: C.sideYaw(a, 0) };
}
