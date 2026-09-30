import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import { DEFAULT_ROBOT, RobotConfig, cloneConfig, footprint } from '@engine/robot/config';
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
  return c;
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
