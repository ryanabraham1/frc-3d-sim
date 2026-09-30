import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
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
  c.intake = { enabled: true, width: inch(20), reach: inch(4), maxHeight: inch(5) };
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
    turret: true,
    spread: 0.0035,
    speedError: 0.006,
    manualSpeed: 13,
  };
  c.climber = { maxLevel: 2, secondsPerLevel: 2.2 };
  return c;
}

/** Enforce R104 (4 ft, 120 in perimeter) and G409 (one NOTE). */
export function normalizeCrescendoConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, C.MAX_ROBOT_HEIGHT, C.MAX_PERIMETER);
  c.hopperCapacity = 1;
  c.preload = Math.min(1, Math.max(0, c.preload));
  c.climber.maxLevel = Math.round(Math.min(2, Math.max(0, c.climber.maxLevel)));
  c.intake.maxHeight = Math.max(c.intake.maxHeight, inch(3));
  return c;
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
