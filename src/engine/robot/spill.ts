import type { GamePiecePool } from '../gamepiece/pool';
import type { Robot } from './robot';

/**
 * FUEL that went over an uncovered hopper's rim (decided by the hopper's own gravity/inertia solver, see
 * `FuelPile` and `Robot.fuelEscaped`) becomes a real field piece again, at the exact spot and with the exact velocity it
 * had. Call once per physics tick next to the robot's own launches (host only).
 */
export function drainSpilled(robot: Robot, pool: GamePiecePool): void {
  while (robot.spilled.length) {
    const { idx, pos, vel } = robot.spilled.shift()!;
    pool.placeWorld(idx, pos, vel);
    robot.noteLaunch(idx); // not straight back into the intake
  }
}
