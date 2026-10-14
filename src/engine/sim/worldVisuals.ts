import type { MatchWorld } from '../core/matchWorld';

/** Pose mechanisms and season-owned pieces before capturing a worker frame. */
export function syncWorldVisuals(world: MatchWorld, dt: number, time: number, climbReady: boolean): void {
  for (const robot of world.robots) {
    robot.climbReady = climbReady;
    robot.syncVisual(dt);
  }
  // Held pieces must use the current gripper pose, and visibility must reflect possession.
  world.rules.updateVisuals(dt, time);
}
