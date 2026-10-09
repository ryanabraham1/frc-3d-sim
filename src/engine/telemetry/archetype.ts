import type { SeasonDefinition } from '../core/season';
import type { RobotConfig } from '../robot/config';

/**
 * What kind of robot a driver is playing, for the match log: a `label` (the season's preset / real-team robot id it
 * matches, else 'custom') and mechanism `features` derived from the config itself. The features are the ground truth
 * (the menu lets players tweak a preset); the label groups matches by archetype for training and evaluation.
 */
export interface RobotArchetype {
  /** Preset or team-robot id when the config matches one exactly, 'model:<id>' when only the visual model matches. */
  label: string;
  features: {
    shooter: 'none' | 'fixed' | 'pivot' | 'turret';
    autoAlign: boolean;
    exits: number;
    shotsPerSecond: number;
    groundIntake: boolean;
    stationIntake: boolean;
    intakeSide: 'front' | 'back';
    intakeRate: number;
    capacity: number;
    placementMaxLevel: number;
    placementSide: string;
    climbMaxLevel: number;
    shotBlocker: boolean;
    drive: string;
    maxSpeed: number;
    mass: number;
    team: number;
    model: string;
    options: Record<string, string | number | boolean>;
  };
}

const sameConfig = (a: RobotConfig, b: RobotConfig) => JSON.stringify(a) === JSON.stringify(b);

export function describeArchetype(season: SeasonDefinition, c: RobotConfig): RobotArchetype {
  const known = [...(season.teamRobots ?? []), ...(season.robotPresets ?? [])];
  const exact = known.find((k) => sameConfig(k.config, c));
  const sameModel = c.model ? (season.teamRobots ?? []).find((t) => t.config.model === c.model) : undefined;
  const l = c.launcher;
  return {
    label: exact?.id ?? (sameModel ? `model:${sameModel.id}` : 'custom'),
    features: {
      shooter: !l.enabled ? 'none' : l.turret ? 'turret' : l.minAngle < l.maxAngle ? 'pivot' : 'fixed',
      autoAlign: !!c.autoAlign,
      exits: l.exits ?? 1,
      shotsPerSecond: l.enabled ? l.rate : 0,
      groundIntake: c.intake.enabled && c.intake.ground !== false,
      stationIntake: c.intake.enabled && !!c.intake.station,
      intakeSide: c.intake.groundSide ?? 'back',
      intakeRate: c.intake.rate ?? 0,
      capacity: c.hopperCapacity,
      placementMaxLevel: c.placement?.enabled ? c.placement.maxLevel : 0,
      placementSide: c.placement?.enabled ? c.placement.scoreSide ?? 'front' : 'none',
      climbMaxLevel: c.climber.maxLevel,
      shotBlocker: !!c.shotBlocker,
      drive: c.drive,
      maxSpeed: c.maxSpeed,
      mass: c.mass,
      team: c.teamNumber,
      model: c.model ?? '',
      options: c.options ?? {},
    },
  };
}
