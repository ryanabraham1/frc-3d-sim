import { arrive, turnToward } from '@engine/ai/steering';
import type { AutoPilot, AutoRoutine } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import * as C from './constants';
import type { ReefscapeRules } from './rules';

export const AUTO_ROUTINES: AutoRoutine[] = [
  { id: 'reef-l4', label: 'Leave + L4 coral', description: 'Leave the starting line, approach the nearest reef face and place the preload on L4.' },
  { id: 'reef-l1', label: 'Leave + L1 coral', description: 'Leave the starting line and place the preload into the reef trough.' },
  { id: 'leave', label: 'Leave only', description: 'Move clear of the starting line for 3 points.' },
  { id: 'none', label: 'Do nothing', description: 'Remain on the starting line during AUTO.' },
];

export class ReefscapeAutoPilot implements AutoPilot {
  private done = false;
  constructor(private readonly rules: ReefscapeRules, private readonly robot: Robot, private readonly routine: string) {}
  update(_dt: number): RobotCommand {
    const cmd: RobotCommand = { ...IDLE_COMMAND, scoringLevel: Math.min(this.routine === 'reef-l1' ? 1 : 4, this.robot.config.placement!.maxLevel) };
    if (this.done || this.routine === 'none') return cmd;
    const r = this.robot;
    const face = C.nearestFace(r.alliance, r.pose);
    const angle = C.sideYaw(r.alliance, face * Math.PI / 3);
    const center = C.reefCenter(r.alliance);
    const radial = C.REEF_APOTHEM + r.footprint.length / 2 + 0.17;
    const target = this.routine === 'leave' ? C.side(r.alliance, C.START_LINE - 1.25, r.alliance === 'blue' ? r.pose.y : C.FIELD_WIDTH - r.pose.y)
      : { x: center.x + Math.cos(angle) * radial, y: center.y + Math.sin(angle) * radial };
    const drive = arrive(r.pose, target, Math.min(2.2, r.config.maxSpeed), 0.8);
    cmd.vx = drive.vx; cmd.vy = drive.vy;
    cmd.omega = turnToward(r.pose.yaw, angle + Math.PI, r.config.maxOmega);
    if (drive.dist < 0.06) {
      cmd.vx = cmd.vy = 0;
      if (this.routine === 'leave') this.done = true;
      else { cmd.shoot = !!this.rules.placementTarget(r, cmd.scoringLevel!); if (!r.held.some((i) => i < C.CORAL_COUNT)) this.done = true; }
    }
    return cmd;
  }
}
