import { arrive, turnToward } from '@engine/ai/steering';
import type { AutoPilot, AutoRoutine } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import { wrapAngle } from '@engine/units';
import * as C from './constants';
import type { ReefscapeRules } from './rules';

export const AUTO_ROUTINES: AutoRoutine[] = [
  { id: 'reef-l4', label: 'Leave + L4 coral', description: 'Leave the starting line, line up on the nearest BRANCH of the nearest reef face and place the preload on L4.' },
  { id: 'reef-l1', label: 'Leave + L1 coral', description: 'Leave the starting line and place the preload into the reef trough.' },
  { id: 'leave', label: 'Leave only', description: 'Move clear of the starting line for 3 points.' },
  { id: 'none', label: 'Do nothing', description: 'Remain on the starting line during AUTO.' },
];

/**
 * Scripted AUTO: pre-programmed paths follow the robot's pose estimate to the exact scoring pose (as real AUTO
 * routines do), then release the CORAL — whether or not the robot has teleop auto-align.
 */
export class ReefscapeAutoPilot implements AutoPilot {
  private done = false;
  constructor(private readonly rules: ReefscapeRules, private readonly robot: Robot, private readonly routine: string) {}
  update(_dt: number): RobotCommand {
    const r = this.robot;
    const level = Math.min(this.routine === 'reef-l1' ? 1 : 4, r.config.placement!.maxLevel);
    const cmd: RobotCommand = { ...IDLE_COMMAND, scoringLevel: level };
    if (this.done || this.routine === 'none') return cmd;
    if (this.routine === 'leave' || !r.config.placement!.enabled || !r.held.some((i) => i < C.CORAL_COUNT)) {
      const to = C.side(r.alliance, C.START_LINE - 1.25, r.alliance === 'blue' ? r.pose.y : C.FIELD_WIDTH - r.pose.y);
      const d = arrive(r.pose, to, Math.min(2.2, r.config.maxSpeed), 0.8);
      if (d.dist < 0.06) { this.done = true; return cmd; }
      return { ...cmd, vx: d.vx, vy: d.vy };
    }
    const pose = this.rules.alignPose(r, level);
    if (!pose) return cmd;
    const dist = Math.hypot(pose.x - r.pose.x, pose.y - r.pose.y);
    const yawErr = wrapAngle(pose.yaw - r.pose.yaw);
    // Approach from straight out of the face so the bumpers don't clip the REEF corner.
    const out = { x: Math.cos(pose.yaw + Math.PI), y: Math.sin(pose.yaw + Math.PI) };
    const lineUp = dist > 0.5 ? { x: pose.x + out.x * 0.4, y: pose.y + out.y * 0.4 } : pose;
    const drive = arrive(r.pose, lineUp, Math.min(2.2, r.config.maxSpeed), dist > 0.5 ? 0.8 : 0.35);
    cmd.vx = drive.vx;
    cmd.vy = drive.vy;
    cmd.omega = turnToward(r.pose.yaw, pose.yaw, r.config.maxOmega, 6);
    if (dist < 0.012 && Math.abs(yawErr) < 0.015) {
      cmd.vx = cmd.vy = 0;
      cmd.shoot = true;
    } else if (dist < 0.3 && r.config.autoAlign) cmd.shoot = true; // teleop-style auto-align finishes the line-up
    return cmd;
  }
}
