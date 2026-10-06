import { inch, lb } from '../units';

export type IntakeSide = 'front' | 'back';

/** +1 = chassis front, -1 = back, for the floor intake (default back, opposite the scoring mechanism). */
export function groundSideSign(c: RobotConfig): 1 | -1 {
  return c.intake.groundSide === 'front' ? 1 : -1;
}

/** +1 = chassis front, -1 = back, for the human-player station intake (funnel / hopper mouth). */
export function stationSideSign(c: RobotConfig): 1 | -1 {
  return c.intake.stationSide === 'back' ? -1 : 1;
}

/** Loaded envelope; fixed mechanism/launcher height remains unchanged. */
export function loadedRobotHeight(c: RobotConfig, count: number): number {
  const e = c.hopperExpansion;
  if (!e) return c.height;
  const fill = Math.min(1, Math.max(0, (count - e.startCount) / Math.max(1, c.hopperCapacity - e.startCount)));
  return c.height + (e.fullHeight - c.height) * fill;
}

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
  /**
   * Static friction coefficient of the drive tread on carpet — with `mass` it caps how hard the robot can push or
   * resist a push (μ·m·g). Default DEFAULT_WHEEL_COF. [EST: blue nitrile ≈ 1.1–1.2, Colson ≈ 1.0, worn ≈ 0.9]
   */
  wheelCOF?: number;

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
    /**
     * Intake throughput in pieces per second (a real robot's roller/conveyor can only swallow so fast). Unset = no
     * limit, which is how the generic presets behave.
     */
    rate?: number;
    /**
     * Floor pickup (e.g. an under-bumper roller). Default true. False = the robot can only take pieces a human
     * player feeds it (see `station`) — one of the main archetype trade-offs every season.
     */
    ground?: boolean;
    /** Floor mouth yaw in robot coordinates; supports side-mounted CAD intakes. */
    groundYaw?: number;
    /**
     * Which face of the chassis the floor intake is on. Default 'back': the scoring mechanism (launcher, elevator,
     * arm) faces front, and real robots put the intake on the opposite face so they can collect with their back to
     * the goal and turn to score.
     */
    groundSide?: 'front' | 'back';
    /**
     * Takes pieces straight from a human-player station while they fall/roll out of it: a funnel, hopper mouth
     * or shooter intake at the top of the robot. Captures airborne pieces entering the zone at `stationSide`.
     */
    station?: boolean;
    stationSide?: 'front' | 'back';
  };
  /** Optional flexible hopper roof: starts bulging above this load, reaches fullHeight at capacity. */
  hopperExpansion?: { startCount: number; fullHeight: number; mechanism?: 'telescoping' };
  /**
   * Optional defensive SHOT BLOCKER: a panel hinged on the top edge of the intake side (so it extends over the same
   * side as the intake) that swings out and up over an adjacent robot's shooter. `reach` = horizontal extension past
   * the frame perimeter, `rise` = how far its outer edge ends above `height`, `seconds` = deploy/stow time.
   * `lift` keeps the shield horizontal on upright supports with a solid vertical blocking wall.
   */
  shotBlocker?: { reach: number; rise: number; width: number; seconds: number; mechanism?: 'lift' };
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
    /**
     * Number of side-by-side exits across the front of the robot (default 1). A "dumper" has a shooter as wide as the
     * robot with several exits (e.g. 4): shots cycle through them, so FUEL leaves in parallel streams. `rate` is the
     * total shots/s across all exits, so throughput is unchanged. Incompatible with a turret.
     */
    exits?: number;
    /** Separate turret centers (meters, chassis frame; side positive left). Share aim, alternate shots. */
    mounts?: { forward: number; side: number }[];
    /** Throat offset ahead of each turret center; rotates with turret yaw. */
    muzzleForward?: number;
    /** Chassis-aimed (auto-align) robots hold fire until pointed within this many radians of the target (default 0.05 ≈ 3°). */
    alignTolerance?: number;
    /** Distance between the outermost exits as a fraction of the frame width (default 0.8). */
    exitSpan?: number;
    /** 1-sigma random error (radians) applied to yaw & pitch. */
    spread: number;
    /** 1-sigma random speed error (fraction). */
    speedError: number;
    /** Manual speed when aim assist is off. */
    manualSpeed: number;
  };
  aimAssist: AimAssist;
  /**
   * Chassis auto-align for robots without a turret: while shooting/passing, the drive heading is servoed onto the
   * target (the driver keeps translation) and the robot fires only once aligned — the swerve "aim at speaker" /
   * "heading lock" feature most non-turret shooters had.
   */
  autoAlign?: boolean;
  /** Season-specific archetype options (keys defined by the season module). */
  options?: Record<string, string | number | boolean>;
  /**
   * Visual model of a real team's robot (`registerRobotModel` id, see src/engine/robot/models.ts). Purely visual:
   * everything the robot can do still comes from the rest of this config. Unset = the generic robot.
   */
  model?: string;

  /** Optional elevator/placement mechanism; level heights are defined by the season. */
  placement?: {
    enabled: boolean;
    maxLevel: number;
    liftSpeed: number;
    /** Mechanism reach beyond the frame perimeter, in meters. */
    reach: number;
    cycleSeconds: number;
    harvestSeconds: number;
    /**
     * Which chassis faces the scorer places on: 'front' (+x, the usual elevator end effector) or 'sides' (an arm that
     * swings out to either side, e.g. 2025 1778 SubZero, so the robot lines up side-on) or 'ends' (an arm that
     * flips over the top to score off the front or the back, e.g. 2025 1690 WHISPER). Default 'front'.
     */
    scoreSide?: 'front' | 'sides' | 'ends';
    /** Seconds to hand a floor-intaken piece from the ground intake to the end effector (0 = it intakes directly). */
    handoffSeconds?: number;
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
    /** Deployed cage contact in robot-local visual X/Z meters; omitted uses the generic front climber. */
    gripOffset?: [number,number];
  };
}

/** Lateral offsets (m, robot frame; + = robot left) of the launcher's exits: one at the center, or `exits` spread evenly. */
export function launcherExitOffsets(c: RobotConfig): number[] {
  if (c.launcher.turret && c.launcher.mounts?.length) return c.launcher.mounts.map(m => m.side);
  const n = Math.max(1, Math.round(c.launcher.exits ?? 1));
  if (n === 1) return [0];
  const span = c.frameWidth * (c.launcher.exitSpan ?? 0.8);
  return Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
}

/** Tread friction when a config doesn't set `wheelCOF`. [EST: new blue nitrile on FRC carpet] */
export const DEFAULT_WHEEL_COF = 1.2;

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
  out.mass = Math.min(Math.max(out.mass, lb(50)), lb(160));
  if (out.wheelCOF !== undefined) out.wheelCOF = Math.min(Math.max(out.wheelCOF, 0.5), 1.6);
  out.hopperCapacity = Math.max(0, Math.round(out.hopperCapacity));
  if (out.hopperExpansion) {
    const e = out.hopperExpansion;
    e.startCount = Number.isFinite(e.startCount) ? Math.max(0, Math.min(out.hopperCapacity - 1, e.startCount)) : out.hopperCapacity - 1;
    e.fullHeight = Number.isFinite(e.fullHeight) ? Math.max(out.height, Math.min(maxHeight, e.fullHeight)) : out.height;
  }
  if (out.shotBlocker) {
    const b = out.shotBlocker;
    b.rise = Math.min(Math.max(0, b.rise), maxHeight - out.height);
    b.reach = Math.max(0.05, b.reach);
    b.width = Math.min(Math.max(0.1, b.width), out.frameWidth);
    b.seconds = Math.max(0.05, b.seconds);
  }
  out.preload = Math.min(Math.max(0, Math.round(out.preload)), out.hopperCapacity);
  if (out.launcher.mounts) {
    out.launcher.mounts = out.launcher.mounts.filter(m => Number.isFinite(m.forward) && Number.isFinite(m.side)).slice(0,4)
      .map(m => ({ forward: Math.max(-out.frameLength/2,Math.min(out.frameLength/2,m.forward)), side: Math.max(-out.frameWidth/2,Math.min(out.frameWidth/2,m.side)) }));
    if (!out.launcher.mounts.length) delete out.launcher.mounts;
  }
  if (out.launcher.muzzleForward !== undefined) out.launcher.muzzleForward = Number.isFinite(out.launcher.muzzleForward) ? Math.max(0,Math.min(out.frameLength/2,out.launcher.muzzleForward)) : 0;
  out.launcher.height = Math.min(out.launcher.height, out.height);
  return out;
}
