/**
 * DRIVETRAIN FORCE MODEL — what one drive wheel can push with, so robot-on-robot contact (defense, pushing
 * matches, pins, spins) comes out of real limits instead of a velocity controller with infinite force:
 *
 * - Traction: a wheel pushes with at most μ·N (tread friction × the weight on that wheel). Past that it breaks
 *   loose and slides at the lower kinetic friction, so a robot shoved off its spot resists less than one holding.
 * - Motor: the drive motor's force is capped by its current limit and falls off with wheel speed (back-EMF), so a
 *   robot already at full speed has little left to push with. Braking/being back-driven gets the full limit.
 * - Friction circle: translation and rotation share each wheel's grip, so a robot pushing flat-out can be spun by
 *   a hit off its center, and a spinning robot pushes less hard.
 * - Tank drives only drive along their heading; sideways they slide against tread friction (hard to T-bone).
 * - A disabled robot's motors sit in brake mode: resistance grows with how fast it is pushed, so it can be shoved.
 *
 * Pure functions, unit-tested; `Robot.drive` applies the result at each wheel's contact point.
 */

import { DEFAULT_WHEEL_COF, type RobotConfig } from './config';
import { lb } from '../units';

/** Kinetic / static tread friction on carpet once a wheel is sliding. [EST: rubber/nitrile on carpet ≈ 0.75–0.85] */
export const KINETIC_RATIO = 0.8;
/**
 * Motor stall force without the current limit, as a multiple of the current-limited force. [EST: a Kraken/Falcon
 * L2 swerve module stalls at ≈ 940 N at the tread; typical 60–80 A stator limits give ≈ 150–210 N] — the
 * speed-torque curve only bites near top speed.
 */
export const STALL_RATIO = 7;
/**
 * Rolling resistance of a drive wheel on carpet (gearbox, bearings, tread on carpet pile) as a fraction of its
 * load. [EST: ≈ 0.02–0.04] It is what stops two evenly matched robots that are shoving each other.
 */
export const ROLLING_RESISTANCE = 0.03;
/** Motor free speed at the tread / the robot's top speed. [EST: robots reach ≈ 85–90 % of free speed] */
export const FREE_SPEED_RATIO = 1.12;

/** A robot battery and its leads, excluded from the manual's weight limits. [EST: FRC 12 V 18 Ah SLA ≈ 13 lb] */
export const BATTERY_MASS = lb(13);

/**
 * Hardest the robot can push (or resist a push) on flat carpet, N: the lesser of its drive motors' current-limited
 * force (m · maxAccel) and its tread grip (μ · m · g).
 */
export function pushingForce(c: RobotConfig): number {
  return c.mass * Math.min(c.maxAccel, (c.wheelCOF ?? DEFAULT_WHEEL_COF) * 9.81);
}

export interface WheelModel {
  /** Current-limited motor force (N). */
  motorLimit: number;
  /** Motor stall force without the limit (N) — sets the speed-torque curve. */
  stall: number;
  /** Ground speed at which the motor makes no force (m/s). */
  freeSpeed: number;
  /** Static traction μ·N of this wheel (N). */
  traction: number;
  /** Tank drive: unit drive axis (world x/z); the wheel can't drive sideways. Omit for swerve. */
  axis?: { x: number; z: number };
  /** Robot disabled: no drive command, motors in brake mode. */
  disabled?: boolean;
}

/**
 * Force the motor can make pushing along a direction in which the wheel's ground speed is `v` (m/s; positive =
 * already moving that way). Driving with the motion follows the speed-torque curve; braking or being back-driven
 * gets the full current limit.
 */
export function motorForce(w: WheelModel, v: number): number {
  if (w.disabled) return Math.min(w.motorLimit, (w.stall * Math.max(0, -v)) / w.freeSpeed);
  if (v <= 0) return w.motorLimit;
  return Math.max(0, Math.min(w.motorLimit, w.stall * (1 - v / w.freeSpeed)));
}

/**
 * Clamp a wheel's requested force (fx, fz) to what the wheel can do, given its ground velocity (vx, vz). Writes
 * the result into `out` and returns true when the wheel is sliding on the carpet (kinetic friction).
 */
export function limitWheelForce(w: WheelModel, fx: number, fz: number, vx: number, vz: number, out: { x: number; z: number }): boolean {
  let slip = false;
  if (w.axis) {
    // Tank: the motor drives along the axis only; sideways is plain tread friction.
    const ax = w.axis.x;
    const az = w.axis.z;
    let along = fx * ax + fz * az;
    const lat = -fx * az + fz * ax;
    const vAlong = (vx * ax + vz * az) * Math.sign(along);
    along = Math.sign(along) * Math.min(Math.abs(along), motorForce(w, vAlong));
    let k = 1;
    const total = Math.hypot(along, lat);
    if (total > w.traction) {
      slip = true;
      k = (w.traction * KINETIC_RATIO) / total;
    }
    out.x = (along * ax - lat * az) * k;
    out.z = (along * az + lat * ax) * k;
    return slip;
  }
  const mag = Math.hypot(fx, fz);
  if (mag < 1e-9) {
    out.x = 0;
    out.z = 0;
    return false;
  }
  const motor = motorForce(w, (vx * fx + vz * fz) / mag);
  let cap = Math.min(motor, w.traction);
  // Asking for more than the tread holds with a motor strong enough to deliver it = the wheel breaks loose.
  if (mag > w.traction && motor > w.traction) {
    slip = true;
    cap = w.traction * KINETIC_RATIO;
  }
  const k = Math.min(1, cap / mag);
  out.x = fx * k;
  out.z = fz * k;
  return slip;
}
