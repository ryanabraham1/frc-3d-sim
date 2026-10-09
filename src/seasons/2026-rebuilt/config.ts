import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import type { RobotOption } from '@engine/core/season';
import { DEFAULT_ROBOT, RobotConfig, cloneConfig, footprint, sanitizeConfig } from '@engine/robot/config';
import { inch, lb } from '@engine/units';
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

/**
 * SHOT ACCURACY. The menu's "Accuracy %" is the share of shots that go IN from a typical scoring range
 * (REBUILT_ACCURACY_RANGE), measured through the real Rapier loop (HeadlessSim, 3 m, 6 bearings x 100 shots,
 * default turret) -- not an abstract spread number. Each FUEL leaves with its own random yaw/pitch error (sigma = the
 * table's angle, in radians) plus a speed error of 1.25x that; the spread of the stream then makes some shots clip
 * the rim or land beside the opening, and it grows with distance (closer shots hit more often, farther ones less).
 * tests/rebuilt-accuracy.test.ts re-measures this, so retuning the physics fails it until the table is recalibrated.
 */
export const REBUILT_ACCURACY_RANGE = 3.0; // m from the HUB center [EST: mid-ALLIANCE ZONE]
export const REBUILT_DEFAULT_ACCURACY = 83;
const SPEED_ERROR_RATIO = 1.25;
/** [accuracy %, 1-sigma launch angle (rad)], measured at REBUILT_ACCURACY_RANGE; ordered by falling accuracy. */
const ACCURACY_TABLE: [number, number][] = [
  [100, 0.002], [99, 0.006], [95, 0.01], [91, 0.016], [89, 0.02], [82, 0.025], [80, 0.03],
  [71, 0.04], [65, 0.05], [60, 0.06], [54, 0.07], [45, 0.085], [34, 0.1], [24, 0.13],
  [19, 0.17], [11, 0.22], [4, 0.3], [0, 0.5],
];

/** Launch-angle sigma (rad) that makes `acc`% of shots go in at REBUILT_ACCURACY_RANGE. */
export function rebuiltSpreadForAccuracy(acc: number): number {
  const a = Math.min(100, Math.max(0, acc));
  for (let i = 1; i < ACCURACY_TABLE.length; i++) {
    const [a0, s0] = ACCURACY_TABLE[i - 1];
    const [a1, s1] = ACCURACY_TABLE[i];
    if (a >= a1) return s0 + ((s1 - s0) * (a0 - a)) / (a0 - a1);
  }
  return ACCURACY_TABLE[ACCURACY_TABLE.length - 1][1];
}

/** Inverse of `rebuiltSpreadForAccuracy`: expected % of shots in at REBUILT_ACCURACY_RANGE for a launch-angle sigma. */
export function rebuiltAccuracyForSpread(spread: number): number {
  const t = ACCURACY_TABLE;
  if (spread <= t[0][1]) return 100;
  for (let i = 1; i < t.length; i++) {
    if (spread <= t[i][1]) {
      const [a0, s0] = t[i - 1];
      const [a1, s1] = t[i];
      return a0 + ((a1 - a0) * (spread - s0)) / (s1 - s0);
    }
  }
  return 0;
}

export function setRebuiltAccuracy(c: RobotConfig, acc: number): void {
  c.launcher.spread = rebuiltSpreadForAccuracy(acc);
  c.launcher.speedError = c.launcher.spread * SPEED_ERROR_RATIO;
}

export const rebuiltShotAccuracy = {
  get: (c: RobotConfig) => Math.round(rebuiltAccuracyForSpread(c.launcher.spread)),
  set: setRebuiltAccuracy,
};

/** Match weight of every stock 2026 robot (presets and real team robots), with bumpers and battery (user decision 2026-10-03). */
export const REBUILT_ROBOT_MASS = lb(150);

/** FUEL/s a stock robot's floor intake can swallow [EST]; real teams override it (INTAKE_RATE in teamRobots.ts). */
export const DEFAULT_INTAKE_RATE = 20;

/** Boost applied to every real team robot's INTAKE_RATE (user decision 2026-10-05: intakes felt too weak). */
export const INTAKE_RATE_BOOST = 1.7;

/** Default REBUILT robot: fits under the TRENCH (22.25in), turret shooter, 40-FUEL hopper, 150 lb. */
export function rebuiltRobotDefaults(): RobotConfig {
  const c = cloneConfig(DEFAULT_ROBOT);
  c.mass = REBUILT_ROBOT_MASS;
  c.height = inch(21);
  c.launcher.height = inch(19);
  c.hopperCapacity = 40;
  c.preload = C.FUEL_MAX_PRELOAD;
  c.climber.maxLevel = 0;
  // Full-width ground intake plus a hopper opening that catches FUEL from the OUTPOST CHUTE, both on the back
  // (the shooter faces front).
  c.intake = { ...c.intake, ground: true, groundSide: 'back', station: true, stationSide: 'back', rate: DEFAULT_INTAKE_RATE };
  c.autoAlign = true; // used only when the shooter has no turret
  setRebuiltAccuracy(c, REBUILT_DEFAULT_ACCURACY);
  return c;
}

/** 6329 Roman II CAD dimensions (Drivetrain tubes: 30 in wide x 24 in long; CAD top 0.548 m) and its fixed drum [EST 70 deg]. */
export const ROMAN_CAPACITY = 40;
export function romanII(c: RobotConfig): void {
  c.frameLength = inch(24); c.frameWidth = inch(30); c.height = .55;
  c.launcher.height = .56; c.launcher.exitSpan = .75;
  c.launcher.angle = c.launcher.minAngle = c.launcher.maxAngle = 70 * Math.PI / 180;
  c.intake.reach = .2; c.intake.width = .62;
  c.maxSpeed = 4.6; setRebuiltAccuracy(c, 86);
}

/**
 * A net roof over the hopper that stretches: the rigid box holds the current capacity (trench-safe), and `extra` more
 * FUEL fit as the net bulges above trench height up to 27 in [EST: extra layers measured from the hopper footprint].
 */
export function stretchNet(c: RobotConfig, extra: number): void {
  c.hopperCovered = true;
  c.hopperExpansion = { startCount: c.hopperCapacity, fullHeight: inch(27) };
  c.hopperCapacity += extra;
}

/** 7769 CHUNK CAD dimensions (chassis 25 in long x 29 in wide; CAD top 0.557 m, collision box at trench height). */
export function chunkCad(c: RobotConfig): void {
  c.frameLength = inch(25); c.frameWidth = inch(29); c.height = .55;
  c.launcher.height = .52; c.intake.reach = .2; c.intake.width = .62;
}

/** R104/R107 size limits plus defaults for mechanism options added after configs were first saved. */
export function normalizeRebuiltConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, C.MAX_ROBOT_HEIGHT, C.MAX_ROBOT_PERIMETER);
  c.launcher.exitInside = true; // FUEL leaves from the real shooter height, not from above the hopper roof
  // These former defaults measured the raised CAD hood, rather than the compact travel pose.
  if ((c.model === 'mixtape-971' && Math.abs(c.height - 0.638352) < 1e-6)
    || (c.model === 'downpour-6800' && Math.abs(c.height - 0.63) < 1e-6)) c.height = 0.55;
  c.intake.ground ??= true;
  // Saved picks of the former turret ROMAN I preset (47 FUEL, 14/s, turret) become the imported Roman II drum robot.
  if (c.model === 'roman-6329' && c.launcher.turret && c.hopperCapacity === 47 && c.launcher.rate === 14) {
    c.launcher.turret = false; c.launcher.exits = 4; c.autoAlign = true; c.hopperCapacity = ROMAN_CAPACITY; c.launcher.rate = 16;
    romanII(c); stretchNet(c, 22); // same net roof as the Roman II preset (40 rigid + 22 stretch)
  }
  // Saved CHUNK picks from before the CAD import carry the generic 27 x 27 x 21 in box: adopt the measured CAD size.
  if (c.model === 'chunk-7769' && Math.abs(c.frameLength - inch(27)) < 1e-6 && Math.abs(c.frameWidth - inch(27)) < 1e-6 && Math.abs(c.height - inch(21)) < 1e-6) chunkCad(c);
  // Migrate only former 2910 size defaults; preserve custom dimensions and tuning.
  if (c.model === 'reblitz-2910') {
    if (Math.abs(c.frameLength-inch(27))<1e-6) c.frameLength=.6985;
    if (Math.abs(c.height-inch(21))<1e-6) c.height=.55;
  }
  c.intake.station ??= true;
  c.intake.groundSide ??= 'back';
  c.intake.stationSide ??= 'back';
  c.intake.enabled = c.intake.ground || c.intake.station;
  // Saved configs from before accuracy meant hit rate carry the old near-perfect default spread: re-aim them.
  if (c.launcher.spread === 0.012 && c.launcher.speedError === 0.015) setRebuiltAccuracy(c, REBUILT_DEFAULT_ACCURACY);
  if ((c.launcher.exits ?? 1) > 1) c.launcher.turret = false; // a robot-wide dumper can't sit on a turret
  c.autoAlign ??= !c.launcher.turret;
  // Chassis-aimed shooters fire within ~9° of the HUB so a shove costs accuracy instead of stopping the stream
  // (user decision 2026-10-03); the FUEL still leaves along the chassis heading.
  if (!c.launcher.turret) c.launcher.alignTolerance = 0.15;
  else delete c.launcher.alignTolerance;
  c.preload = Math.min(c.preload, C.FUEL_MAX_PRELOAD, c.hopperCapacity);
  // 1323's 2026 robot briefly shared the 2025 model id; saved picks would otherwise draw the REEFSCAPE elevator.
  if (c.model === 'madtown-1323') c.model = 'madtown-2026-1323';
  if (c.model === 'madtown-2026-1323' && c.shotBlocker) c.shotBlocker.mechanism = 'lift';
  if (c.model === 'madtown-2026-1323' && !c.launcher.mounts?.length) c.launcher.mounts = [{forward:0,side:0}];
  // Kepler's bearing sits at the right corner opposite its back intake (TBA 2026 photos).
  // Side is positive left in the launch configuration, opposite the model's +Z axis.
  if (c.model === 'kepler-1690' && !c.launcher.mounts?.length) {
    c.launcher.mounts = [{ forward: c.frameLength * .27, side: -c.frameWidth * .27 }];
  }
  return c;
}

/** Streams on a wide dumper: Team 9072's "Sandstorm" had a "4 ball wide shooter" (docs/ROBOT-ARCHETYPES.md). */
const DUMPER_EXITS = 4;

type Build = { intake: 'both' | 'ground' | 'outpost'; aim: 'turret' | 'align' | 'driver'; dumper?: boolean; hopper: number; tall: boolean; rate: number; climb: 0 | 1 | 2 | 3;
  /**
   * Trade-offs that keep the archetypes balanced (benchmarked in docs/AI-STRATEGY.md): drive speed (m/s), shot accuracy (%)
   * and `weight`, the nominal mechanism weight (lb) that only scales acceleration: every stock robot weighs REBUILT_ROBOT_MASS.
   */
  speed?: number; weight?: number; accuracy?: number };
export function build(b: Build): RobotConfig {
  const c = rebuiltRobotDefaults();
  c.intake.ground = b.intake !== 'outpost';
  c.intake.station = b.intake !== 'ground';
  c.launcher.turret = b.aim === 'turret';
  c.autoAlign = b.aim === 'align';
  c.hopperCapacity = b.hopper;
  c.height = b.tall ? inch(30) : inch(21);
  c.launcher.height = b.tall ? inch(26) : inch(19);
  c.launcher.rate = b.rate;
  c.launcher.exits = b.dumper ? DUMPER_EXITS : 1;
  c.climber.maxLevel = b.climb;
  if (b.speed) c.maxSpeed = b.speed;
  if (b.weight) c.maxAccel *= Math.min(1, 125 / b.weight);
  if (b.accuracy) setRebuiltAccuracy(c, b.accuracy);
  return normalizeRebuiltConfig(c);
}

/** Archetypes seen across 2026 events (docs/ROBOT-ARCHETYPES.md). */
export function rebuiltRobotPresets() {
  return [
    { id: 'turret', label: 'Turret trench bot', description: 'Under 22¼ in so it drives through the TRENCH; full-width ground intake, turret shooter that scores on the move, 35-FUEL hopper. The turret makes it slower and its single stream fires 8/s, less accurately on the move.', config: build({ intake: 'both', aim: 'turret', hopper: 35, tall: false, rate: 8, climb: 0, speed: 4.2, weight: 132, accuracy: 72 }) },
    { id: 'fixed', label: 'Dumper + auto-align', description: 'Trench-height robot whose shooter spans the whole front of the robot (a "dumper"): FUEL leaves in four parallel streams (12/s). Aimed by rotating the chassis, 60-FUEL hopper. Quick. The most common competitive design.', config: build({ intake: 'both', aim: 'align', dumper: true, hopper: 60, tall: false, rate: 12, climb: 0, speed: 4.8, weight: 116, accuracy: 82 }) },
    { id: 'big-hopper', label: 'Big-hopper BUMP bot', description: 'Tall (30 in) with a 70-FUEL hopper and a fast multi-wheel shooter (14/s): too tall for the TRENCH, so it crosses the BUMPs. Slower to drive and less accurate on the move; auto-align.', config: build({ intake: 'both', aim: 'align', hopper: 70, tall: true, rate: 14, climb: 0, speed: 4.0, weight: 135, accuracy: 70 }) },
    { id: 'outpost', label: 'OUTPOST-fed shooter', description: 'No ground intake: loads FUEL from its OUTPOST CHUTE, relying on the human player. Simple and accurate; auto-align, 40-FUEL hopper.', config: build({ intake: 'outpost', aim: 'align', hopper: 40, tall: false, rate: 10, climb: 0, speed: 4.8, weight: 112, accuracy: 90 }) },
  ];
}

const opt = (id: string, label: string, choices: [string, string, string?][], get: (c: RobotConfig) => string, set: (c: RobotConfig, v: string) => void, hint?: string): RobotOption =>
  ({ id, label, hint, choices: choices.map(([cid, l, title]) => ({ id: cid, label: l, title })), get, set: (c, v) => { set(c, v); Object.assign(c, normalizeRebuiltConfig(c)); } });

export const rebuiltRobotOptions: RobotOption[] = [
  opt('intake', 'FUEL intake', [['both', 'Ground + OUTPOST'], ['ground', 'Ground only'], ['outpost', 'OUTPOST only', 'Only FUEL released from your OUTPOST CHUTE into the hopper']],
    (c) => (c.intake.ground && c.intake.station ? 'both' : c.intake.ground ? 'ground' : 'outpost'),
    (c, v) => { c.intake.ground = v !== 'outpost'; c.intake.station = v !== 'ground'; },
    'Without a ground intake you can only reload at your OUTPOST (the human player opens the CHUTE with H).'),
  opt('aim', 'Shooter aiming', [['turret', 'Turret'], ['align', 'Chassis auto-align', 'Holding Space rotates the robot onto the HUB, then fires'], ['driver', 'Driver aims']],
    (c) => (c.launcher.turret ? 'turret' : c.autoAlign ? 'align' : 'driver'),
    (c, v) => { c.launcher.turret = v === 'turret'; c.autoAlign = v === 'align'; if (v === 'turret') c.launcher.exits = 1; }),
  opt('exits', 'Shooter exit', [['single', 'Single stream', 'All FUEL leaves from one point on the robot'], ['dumper', `Dumper (${DUMPER_EXITS} streams)`, 'A shooter as wide as the robot: FUEL leaves in parallel streams at the same balls-per-second. No turret.']],
    (c) => ((c.launcher.exits ?? 1) > 1 ? 'dumper' : 'single'),
    (c, v) => {
      c.launcher.exits = v === 'dumper' ? DUMPER_EXITS : 1;
      if (v === 'dumper' && c.launcher.turret) { c.launcher.turret = false; c.autoAlign = true; }
    }),
  opt('hopper', 'Hopper', [['15', '15'], ['30', '30'], ['50', '50'], ['80', '80']],
    (c) => String([15, 30, 50, 80].reduce((b, x) => (Math.abs(x - c.hopperCapacity) < Math.abs(b - c.hopperCapacity) ? x : b), 30)),
    (c, v) => { c.hopperCapacity = Number(v); c.preload = Math.min(C.FUEL_MAX_PRELOAD, c.hopperCapacity); },
    'FUEL held at once; fewer trips to reload.'),
  opt('height', 'Height', [['trench', 'Under TRENCH (21 in)', 'Fits under the 22¼ in TRENCH'], ['tall', 'Tall (30 in)', 'Must cross the BUMPs']],
    (c) => (c.height <= C.TRENCH_CLEARANCE ? 'trench' : 'tall'),
    (c, v) => { c.height = v === 'tall' ? inch(30) : inch(21); c.launcher.height = Math.min(c.launcher.height, c.height - inch(2)); }),
  opt('rate', 'Shooter', [['8', '8/s'], ['12', '12/s'], ['16', '16/s'], ['20', '20/s'], ['25', '25/s'], ['30', '30/s'], ['33', '33/s'], ['35', '35/s']],
    (c) => String([8, 12, 16, 20, 25, 30, 33, 35].reduce((b, x) => (Math.abs(x - c.launcher.rate) < Math.abs(b - c.launcher.rate) ? x : b), 8)),
    (c, v) => { c.launcher.rate = Number(v); }),
  opt('intakeRate', 'Intake speed', [['10', '10/s'], ['14', '14/s'], ['20', '20/s'], ['25', '25/s'], ['30', '30/s'], ['40', '40/s']],
    (c) => String([10, 14, 20, 25, 30, 40].reduce((b, x) => (Math.abs(x - (c.intake.rate ?? 20)) < Math.abs(b - (c.intake.rate ?? 20)) ? x : b), 20)),
    (c, v) => { c.intake.rate = Number(v); },
    'FUEL the floor intake can swallow per second; faster refills mean less time stopped.'),
  opt('climb', 'TOWER climb', [['0', 'None'], ['1', 'LEVEL 1'], ['2', 'LEVEL 2'], ['3', 'LEVEL 3']],
    (c) => String(c.climber.maxLevel), (c, v) => { c.climber.maxLevel = Number(v); }, 'TELEOP 10 / 20 / 30 · AUTO LEVEL 1 15.'),
];

export function rebuiltSpecBars(config: RobotConfig) {
  const c = normalizeRebuiltConfig(config);
  const intake = c.intake.ground && c.intake.station ? 'ground + OUTPOST' : c.intake.ground ? 'ground' : 'OUTPOST only';
  return [
    ...(c.hopperExpansion ? [{ label: 'Trench-safe load', value: c.hopperExpansion.mechanism === 'telescoping' ? `F toggles ${c.hopperExpansion.startCount}/${c.hopperCapacity} FUEL` : `≤${c.hopperExpansion.startCount} FUEL · net expands when fuller`, frac: c.hopperExpansion.startCount / c.hopperCapacity }] : []),
    { label: 'FUEL hopper', value: `${c.hopperCapacity}`, frac: c.hopperCapacity / 80 },
    { label: 'Fire rate', value: `${c.launcher.rate} /s`, frac: c.launcher.rate / 35 },
    { label: 'Intake rate', value: c.intake.ground ? `${c.intake.rate ?? 'unlimited'} /s` : 'OUTPOST only', frac: c.intake.ground ? (c.intake.rate ?? 30) / 30 : 0.1 },
    { label: 'Shooter', value: (c.launcher.exits ?? 1) > 1 ? `Dumper ×${c.launcher.exits}` : 'Single stream', frac: (c.launcher.exits ?? 1) > 1 ? 1 : 0.4 },
    { label: 'Aiming', value: c.launcher.turret ? 'Turret' : c.autoAlign ? 'Auto-align' : 'Driver', frac: c.launcher.turret ? 1 : c.autoAlign ? 0.7 : 0.3 },
    { label: 'Intake', value: intake, frac: (Number(c.intake.ground) * 2 + Number(c.intake.station)) / 3 },
  ];
}

/** Headline stats on a robot's picker card: how much it holds, how fast it shoots and how fast it loads. */
export function rebuiltCardBars(config: RobotConfig) {
  const c = normalizeRebuiltConfig(config);
  return [
    { label: 'Hopper', value: `${c.hopperCapacity}`, frac: c.hopperCapacity / 90 },
    { label: 'Shoot', value: `${c.launcher.rate}/s`, frac: c.launcher.rate / 35 },
    { label: 'Intake', value: c.intake.ground ? `${c.intake.rate ?? '∞'}/s` : 'OUTPOST', frac: c.intake.ground ? (c.intake.rate ?? 30) / 20 : 0.1 },
  ];
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
