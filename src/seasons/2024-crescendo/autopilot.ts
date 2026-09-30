import { arrive, turnToward } from '@engine/ai/steering';
import type { AutoPilot, AutoRoutine, SeasonContext } from '@engine/core/season';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '@engine/robot/robot';
import * as C from './constants';
import type { CrescendoRules } from './rules';

export const AUTO_ROUTINES: AutoRoutine[] = [
  { id: 'wing-4', label: 'Speaker + 3 wing notes', description: 'Shoot the preload into the SPEAKER, then collect and shoot each NOTE on your WING SPIKE MARKS.' },
  { id: 'amp-2', label: 'Amp + wing note', description: 'Score the preload in the AMP, then collect the AMP-side WING NOTE and shoot it.' },
  { id: 'shoot-leave', label: 'Shoot + leave', description: 'Shoot the preload and drive out of the ROBOT STARTING ZONE for LEAVE.' },
  { id: 'leave', label: 'Leave only', description: 'Drive out of the ROBOT STARTING ZONE (2 pts).' },
  { id: 'none', label: 'Do nothing', description: 'Stay still during AUTO.' },
];

type Phase = 'shoot' | 'amp' | 'collect' | 'leave' | 'idle';

/** Scripted AUTO for a player's robot (drivers may not control robots in AUTO [M 6.4]). */
export class CrescendoAutoPilot implements AutoPilot {
  private phase: Phase;
  private shootTime = 0;
  private readonly visited = new Set<number>();
  private shots = 0;

  constructor(private readonly ctx: SeasonContext, private readonly rules: CrescendoRules, private readonly robot: Robot, private readonly routine: string) {
    this.phase = routine === 'none' ? 'idle' : routine === 'leave' ? 'leave' : routine === 'amp-2' ? 'amp' : 'shoot';
  }

  private faceSpeaker(): number {
    const r = this.robot;
    const s = C.speakerAim(r.alliance);
    return Math.atan2(s.y - r.pose.y, s.x - r.pose.x);
  }

  private steer(cmd: RobotCommand, to: { x: number; y: number }, yaw: number, speed = 3.2): number {
    const r = this.robot;
    const d = arrive(r.pose, to, Math.min(speed, r.config.maxSpeed), 0.9);
    cmd.vx = d.vx;
    cmd.vy = d.vy;
    cmd.omega = turnToward(r.pose.yaw, yaw, r.config.maxOmega);
    return d.dist;
  }

  private nextNote(): number | null {
    const { pool, frame } = this.ctx;
    const r = this.robot;
    const wing = r.alliance === 'blue' ? [0, 1, 2] : [3, 4, 5];
    const options = wing.filter((i) => pool.state[i] === 'field' && !this.visited.has(i));
    if (this.routine === 'amp-2') options.sort((x, y) => y - x); // AMP-side note first
    else options.sort((x, y) => {
      const px = frame.toField(pool.position(x)), py = frame.toField(pool.position(y));
      return Math.hypot(px.x - r.pose.x, px.y - r.pose.y) - Math.hypot(py.x - r.pose.x, py.y - r.pose.y);
    });
    return options[0] ?? null;
  }

  update(dt: number): RobotCommand {
    const r = this.robot;
    const cmd: RobotCommand = { ...IDLE_COMMAND };
    if (this.phase === 'idle' || r.isClimbing) return cmd;
    const a = r.alliance;

    if (this.phase === 'shoot') {
      this.shootTime += dt;
      const turret = r.config.launcher.turret && r.config.aimAssist === 'full';
      if (!turret) cmd.omega = turnToward(r.pose.yaw, this.faceSpeaker(), r.config.maxOmega);
      cmd.shoot = turret || Math.abs(Math.atan2(Math.sin(this.faceSpeaker() - r.pose.yaw), Math.cos(this.faceSpeaker() - r.pose.yaw))) < 0.06;
      if (this.rules.heldNote(r) === undefined || this.shootTime > 2.5) {
        this.shootTime = 0;
        this.shots++;
        this.phase = this.routine === 'shoot-leave' ? 'leave' : this.routine === 'wing-4' || this.routine === 'amp-2' ? 'collect' : 'idle';
        if (this.routine === 'amp-2') this.phase = 'idle';
      }
      return cmd;
    }

    if (this.phase === 'amp') {
      const amp = C.ampCenter(a);
      const half = Math.max(r.footprint.length, r.footprint.width) / 2;
      const d = this.steer(cmd, { x: amp.x, y: C.W - half - 0.06 }, Math.PI / 2, 2.4);
      if (d < 0.12 && this.rules.nearAmp(r)) cmd.pass = true;
      if (this.rules.heldNote(r) === undefined) this.phase = 'collect';
      return cmd;
    }

    if (this.phase === 'collect') {
      if (this.rules.heldNote(r) !== undefined) {
        this.phase = 'shoot';
        return cmd;
      }
      const i = this.nextNote();
      if (i === null) {
        this.phase = 'leave';
        return cmd;
      }
      const p = this.ctx.frame.toField(this.ctx.pool.position(i));
      // Approach from the ALLIANCE WALL side, intake first (the STAGE is behind the lowest NOTE).
      const u = C.sideYaw(a, 0);
      const back = r.footprint.length / 2 + 0.02;
      const to = { x: p.x - Math.cos(u) * back, y: p.y - Math.sin(u) * back };
      const d = Math.hypot(to.x - r.pose.x, to.y - r.pose.y);
      if (d > 0.9) {
        // Line up behind the NOTE first.
        this.steer(cmd, { x: to.x - Math.cos(u) * 0.35, y: to.y - Math.sin(u) * 0.35 }, u);
      } else this.steer(cmd, to, u, 1.8);
      cmd.intake = true;
      if (this.ctx.clock.periodRemaining < 0.5) this.visited.add(i);
      return cmd;
    }

    if (this.phase === 'leave') {
      const x = C.START_ZONE_DEPTH + Math.max(r.footprint.length, r.footprint.width) / 2 + 0.35;
      const to = C.side(a, x, r.pose.y);
      if (this.steer(cmd, to, r.pose.yaw, 2.2) < 0.05) this.phase = 'idle';
      return cmd;
    }
    return cmd;
  }
}
