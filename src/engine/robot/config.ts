import { inch, lb } from '../units';

export type AimAssist = 'full' | 'speed' | 'off';

/** Everything that defines a simulated robot. All values SI. */
export interface RobotConfig {
  teamNumber: number;
  /** Frame (ROBOT PERIMETER) length along robot forward axis. */
  frameLength: number;
  frameWidth: number;
  bumperThickness: number;
  /** Bumper bottom/top heights above floor. */
  bumperBottom: number;
  bumperTop: number;
  /** Overall robot height (must respect the season's height limit). */
  height: number;
  mass: number;
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  drive: 'swerve' | 'tank';

  intake: {
    enabled: boolean;
    /** Optional primary/secondary piece pickup capabilities for mixed-piece seasons. */
    primary?: boolean;
    secondary?: boolean;
    /** Width of the intake mouth. */
    width: number;
    /** How far past the front bumper pieces are grabbed. */
    reach: number;
    /** Max piece center height that can be grabbed. */
    maxHeight: number;
  };
  hopperCapacity: number;
  preload: number;

  launcher: {
    enabled: boolean;
    /** Pieces per second. */
    rate: number;
    /** Launch elevation used when aim assist is off. */
    angle: number;
    /** Adjustable hood range used by aim assist (set min = max for a fixed hood). */
    minAngle: number;
    maxAngle: number;
    minSpeed: number;
    maxSpeed: number;
    /** Exit height above floor. */
    height: number;
    /** True = turret can yaw independently of the drivetrain. */
    turret: boolean;
    /** 1-sigma random error (radians) applied to yaw & pitch. */
    spread: number;
    /** 1-sigma random speed error (fraction). */
    speedError: number;
    /** Manual speed when aim assist is off. */
    manualSpeed: number;
  };
  aimAssist: AimAssist;

  /** Optional elevator/placement mechanism; level heights are defined by the season. */
  placement?: {
    enabled: boolean;
    maxLevel: number;
    liftSpeed: number;
    /** Mechanism reach beyond the frame perimeter, in meters. */
    reach: number;
    cycleSeconds: number;
    harvestSeconds: number;
  };
  /** Processor feeding can be available independently of a projectile launcher. */
  processor?: { enabled: boolean };

  climber: {
    /** Highest level this robot can reach (0 = no climber). */
    maxLevel: number;
    /** Seconds to rise one level. */
    secondsPerLevel: number;
    /** Optional total rise time for cage games, independent of the cage's point value. */
    secondsToClimb?: number;
  };
}

/** Generic defaults; seasons override via their own robotDefaults. */
export const DEFAULT_ROBOT: RobotConfig = {
  teamNumber: 9999,
  frameLength: inch(27),
  frameWidth: inch(27),
  bumperThickness: inch(3.5),
  bumperBottom: inch(1.5),
  bumperTop: inch(6.5),
  height: inch(20),
  mass: lb(125),
  maxSpeed: 4.5,
  maxAccel: 9,
  maxOmega: 2.2 * Math.PI,
  drive: 'swerve',
  intake: { enabled: true, width: inch(24), reach: inch(6), maxHeight: inch(8) },
  hopperCapacity: 40,
  preload: 8,
  launcher: {
    enabled: true,
    rate: 8,
    angle: (62 * Math.PI) / 180,
    minAngle: (45 * Math.PI) / 180,
    maxAngle: (82 * Math.PI) / 180,
    minSpeed: 4,
    maxSpeed: 14,
    height: inch(20),
    turret: true,
    spread: 0.012,
    speedError: 0.015,
    manualSpeed: 8.5,
  },
  aimAssist: 'full',
  climber: { maxLevel: 3, secondsPerLevel: 1.8 },
};

export function cloneConfig(c: RobotConfig): RobotConfig {
  return JSON.parse(JSON.stringify(c)) as RobotConfig;
}

/** Outer footprint (with bumpers). */
export function footprint(c: RobotConfig): { length: number; width: number } {
  return { length: c.frameLength + 2 * c.bumperThickness, width: c.frameWidth + 2 * c.bumperThickness };
}

/** Clamp a user-edited config to sane/legal values given a season height limit. */
export function sanitizeConfig(c: RobotConfig, maxHeight: number, maxPerimeter?: number): RobotConfig {
  const out = cloneConfig(c);
  out.height = Math.min(Math.max(out.height, out.bumperTop + 0.05), maxHeight);
  out.frameLength = Math.min(Math.max(out.frameLength, inch(18)), inch(40));
  out.frameWidth = Math.min(Math.max(out.frameWidth, inch(18)), inch(40));
  if (maxPerimeter) {
    const per = 2 * (out.frameLength + out.frameWidth);
    if (per > maxPerimeter) {
      const k = maxPerimeter / per;
      out.frameLength *= k;
      out.frameWidth *= k;
    }
  }
  out.hopperCapacity = Math.max(0, Math.round(out.hopperCapacity));
  out.preload = Math.min(Math.max(0, Math.round(out.preload)), out.hopperCapacity);
  out.launcher.height = Math.min(out.launcher.height, out.height);
  return out;
}
