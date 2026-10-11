/**
 * REAL DRIVETRAIN NUMBERS — top speed and acceleration from what a team actually bolts in (drive motor, gear ratio,
 * wheel, current limit) instead of hand-picked m/s and m/s². `drivetrain.ts` then turns `maxSpeed` / `maxAccel` into
 * wheel forces, so a fast-geared robot gets off the line slower and pushes weaker, exactly the kickoff trade-off.
 *
 * - Free speed = motor free speed / ratio × wheel radius. Robots reach about 1 / FREE_SPEED_RATIO of it (≈ 88–90 %)
 *   [Chief Delphi / AdvantageScope logs: top speed ≈ 85–90 % of free speed].
 * - Launch force = motors × kT × stator current limit × ratio × gearbox efficiency / wheel radius; acceleration is that
 *   over the robot's empty playing mass. Game pieces it carries add mass on top (`Robot.payloadMass`), so the same
 *   motor force moves a heavier robot: a full hopper accelerates and brakes noticeably slower.
 */

import type { RobotConfig } from './config';
import { FREE_SPEED_RATIO } from './drivetrain';
import { inch } from '../units';

export interface DriveMotor {
  /** Free speed at 12 V (rpm). */
  freeRpm: number;
  /** Stall torque (N·m) and current (A) at 12 V; kT = torque / current. */
  stallTorque: number;
  stallCurrent: number;
}

/** Manufacturer motor curves at 12 V. [CTRE Kraken X60 (FOC and trapezoidal), REV NEO / NEO Vortex, CTRE Falcon 500 data sheets] */
export const DRIVE_MOTORS = {
  krakenX60FOC: { freeRpm: 5800, stallTorque: 9.37, stallCurrent: 483 },
  krakenX60: { freeRpm: 6000, stallTorque: 7.09, stallCurrent: 366 },
  neoVortex: { freeRpm: 6784, stallTorque: 3.6, stallCurrent: 211 },
  neo: { freeRpm: 5676, stallTorque: 2.6, stallCurrent: 105 },
  falcon500: { freeRpm: 6380, stallTorque: 4.69, stallCurrent: 257 },
} satisfies Record<string, DriveMotor>;
export type DriveMotorId = keyof typeof DRIVE_MOTORS;

/** SDS swerve drive reductions (Kraken X60 FOC free speeds on 4 in wheels in brackets). */
export const SDS_RATIOS = {
  /** MK4i / MK4n L1–L3 [SDS: 8.14, 6.75, 6.12:1] (12.7, 15.0, 16.6 ft/s) */
  mk4L1: 8.14, mk4L2: 6.75, mk4L3: 6.12,
  /**
   * MK5n R1–R3 (14.4, 16.8, 19.2 ft/s). R1 7.03:1 [2910 / 971 / 1678 2026 posts]; R3 5.27:1 matches 1923's binder
   * (19.2 ft/s); R2 [EST 6.03:1].
   */
  mk5R1: 7.03, mk5R2: 6.03, mk5R3: 5.27,
};

export interface DriveSpec {
  motor: DriveMotorId;
  /** Drive reduction (motor turns per wheel turn). Give this or `freeSpeed`. */
  ratio?: number;
  /** Free speed a team quotes (m/s) when it doesn't give the ratio (custom modules). */
  freeSpeed?: number;
  /** Tread diameter (m). Default 4 in. */
  wheelDiameter?: number;
  /** Stator current limit per drive motor (A). Default DEFAULT_STATOR_LIMIT. */
  statorLimit?: number;
  /** Drive motors (one per swerve module). Default 4. */
  motors?: number;
  /** Where the numbers came from; `[EST]` when guessed. */
  source: string;
}

/**
 * Per-motor stator limit when a team doesn't publish theirs. [EST: CTRE's swerve generator suggests 60 A; teams run
 * 40–80 A to stop wheel slip and brownouts]
 */
export const DEFAULT_STATOR_LIMIT = 60;
/** Torque that survives the gearbox, module bevel and tread. [EST: two-stage spur + bevel ≈ 0.9–0.95] */
export const GEARBOX_EFFICIENCY = 0.93;

/** The usual drive when a team's isn't published: four Kraken X60s (FOC) on 4 in SDS wheels. [EST: most common 2024–26] */
export const TYPICAL_DRIVE: Omit<DriveSpec, 'ratio' | 'freeSpeed' | 'source'> = { motor: 'krakenX60FOC', wheelDiameter: inch(4) };

const RPM = (2 * Math.PI) / 60;

function wheelRadius(s: DriveSpec): number {
  return (s.wheelDiameter ?? inch(4)) / 2;
}

/** Reduction of a spec (from `ratio`, or back out of its quoted free speed). */
export function driveRatio(s: DriveSpec): number {
  if (s.ratio) return s.ratio;
  if (!s.freeSpeed) throw new Error('DriveSpec needs ratio or freeSpeed');
  return (DRIVE_MOTORS[s.motor].freeRpm * RPM * wheelRadius(s)) / s.freeSpeed;
}

/** Ground speed at motor free speed (m/s). */
export function driveFreeSpeed(s: DriveSpec): number {
  return (DRIVE_MOTORS[s.motor].freeRpm * RPM * wheelRadius(s)) / driveRatio(s);
}

/** Top speed the robot actually reaches (m/s). */
export function driveTopSpeed(s: DriveSpec): number {
  return driveFreeSpeed(s) / FREE_SPEED_RATIO;
}

/** Total current-limited tread force of all drive motors (N). */
export function driveForce(s: DriveSpec): number {
  const m = DRIVE_MOTORS[s.motor];
  const amps = Math.min(s.statorLimit ?? DEFAULT_STATOR_LIMIT, m.stallCurrent);
  return ((s.motors ?? 4) * (m.stallTorque / m.stallCurrent) * amps * driveRatio(s) * GEARBOX_EFFICIENCY) / wheelRadius(s);
}

/** The ratio that gives `topSpeed` with this motor and wheel (to turn an estimated top speed into gearing). */
export function ratioForTopSpeed(base: Omit<DriveSpec, 'ratio' | 'freeSpeed' | 'source'>, topSpeed: number): number {
  return (DRIVE_MOTORS[base.motor].freeRpm * RPM * ((base.wheelDiameter ?? inch(4)) / 2)) / (topSpeed * FREE_SPEED_RATIO);
}

/**
 * Set `maxSpeed` and `maxAccel` from real drivetrain hardware. `accelScale` keeps a preset's balance trade-off (e.g. a
 * heavier archetype's nominal mechanism weight) on top of the physics.
 */
export function applyDriveSpec(c: RobotConfig, s: DriveSpec, accelScale = 1): void {
  c.drivetrain = s;
  c.maxSpeed = driveTopSpeed(s);
  c.maxAccel = (driveForce(s) / c.mass) * accelScale;
}

/**
 * Real drive numbers for a robot whose gearing isn't published: keep its estimated top speed, gear the usual drive to
 * it and derive acceleration from that gearing and the robot's mass.
 */
export function applyTypicalDrive(c: RobotConfig, accelScale = 1): void {
  applyDriveSpec(c, { ...TYPICAL_DRIVE, ratio: ratioForTopSpeed(TYPICAL_DRIVE, c.maxSpeed), source: '[EST] usual Kraken X60 swerve geared to the estimated top speed' }, accelScale);
}
