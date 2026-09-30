import type { Alliance, FieldPose } from '../coords';
import type { SeasonDefinition } from '../core/season';
import type { RapierModule } from '../physics/world';
import type { RobotConfig } from '../robot/config';
import { IDLE_COMMAND } from '../robot/robot';
import { HeadlessSim } from './headless';

/**
 * SHOT HARNESS — one robot at a pose fires real game pieces through the real field/physics
 * (HeadlessSim) and we count how many enter the goal. Used by tests/shooting.test.ts for EVERY
 * registered season, so "shots that should go in don't" bugs are caught automatically.
 */
export interface ShotTrial {
  label: string;
  robot: RobotConfig;
  alliance: Alliance;
  pose: FieldPose;
  shots: number;
  /** 'shoot' at the goal (default) or 'pass' toward the season's feed target. */
  mode?: 'shoot' | 'pass';
  /** Optional field-frame drive velocity + yaw rate while shooting (shoot-on-the-move). */
  drive?: { vx: number; vy: number; omega?: number };
  /** Settle time after the last shot so pieces can land in / pass the goal sensor. */
  settle?: number;
  seed?: number;
}

export interface ShotResult {
  label: string;
  fired: number;
  entered: number;
  /** Every shot had a trajectory that clears the goal geometry (solver said so). */
  allClear: boolean;
  /** Minimum clearance between each launched piece and the firing robot's collider at spawn (m). */
  spawnGap: number;
  /** Final field positions of pieces that did not enter the goal (for debugging). */
  misses: { x: number; y: number; z: number }[];
}

export function runShotTrial(season: SeasonDefinition, R: RapierModule, trial: ShotTrial): ShotResult {
  const sim = new HeadlessSim(season, R, { robot: trial.robot, alliance: trial.alliance, pose: trial.pose, seed: trial.seed });
  const testing = season.testing!;
  sim.load(trial.shots);
  sim.run(0.4); // settle onto the carpet
  const before = testing.goalCount(sim.ctx, trial.alliance);
  const d = trial.drive ?? { vx: 0, vy: 0 };
  const cmd = { ...IDLE_COMMAND, vx: d.vx, vy: d.vy, omega: d.omega ?? 0, shoot: trial.mode !== 'pass', pass: trial.mode === 'pass' };
  // Fire only where the season says a goal is physically possible (a driver doesn't shoot from impossible spots).
  const can = testing.canScoreFrom;
  for (let k = 0; k < Math.round(15 / sim.physics.dt) && sim.robot.held.length > 0; k++) {
    const p = sim.robot.pose;
    const ok = trial.mode === 'pass' || !can || can(trial.alliance, p.x, p.y);
    sim.step(ok ? cmd : { ...cmd, shoot: false });
  }
  sim.run(trial.settle ?? 3);
  const entered = testing.goalCount(sim.ctx, trial.alliance) - before;
  const misses = sim.pool.indices('field').map((i) => sim.frame.toField(sim.pool.position(i)));
  const out = { label: trial.label, fired: sim.fired, entered, allClear: sim.allClear, spawnGap: sim.spawnGap, misses };
  sim.dispose();
  return out;
}
