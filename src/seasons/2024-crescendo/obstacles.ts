import type { Alliance } from '@engine/coords';
import type { Circle } from '@engine/ai/steering';
import type { Robot } from '@engine/robot/robot';
import { PREDICTION_DISTANCE } from '@engine/physics/world';
import * as C from './constants';

/** Drive around the legs; only a chassis too tall for the core must avoid the entire stage. */
export function stageObstacles(robot: Robot, alliances: readonly Alliance[] = ['blue', 'red']): Circle[] {
  const half = Math.max(robot.footprint.length, robot.footprint.width) / 2;
  const clears = robot.clearanceHeight + PREDICTION_DISTANCE < C.STAGE_CLEARANCE;
  return alliances.flatMap(a => clears
    ? C.LEG_LOCAL.map(([x, y]) => ({ ...C.stagePoint(a, x, y), r: C.STAGE_LEG_SIZE / Math.SQRT2 + half + 0.04 }))
    : [{ ...C.stageCenter(a), r: 1.7 + half }]);
}
