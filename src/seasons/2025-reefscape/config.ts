import type { Alliance } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import { cloneConfig, DEFAULT_ROBOT, sanitizeConfig, type RobotConfig } from '@engine/robot/config';
import { inch } from '@engine/units';
import * as C from './constants';

export const TIMELINE: MatchPeriod[] = [
  { id: 'auto', label: 'AUTO', duration: 15, mode: 'auto', displayGroup: 'auto' },
  { id: 'auto-pause', label: 'AUTO SCORING', duration: 3, mode: 'disabled' },
  { id: 'teleop', label: 'TELEOP', duration: 115, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'endgame', label: 'END GAME', duration: 20, mode: 'teleop', displayGroup: 'teleop' },
  { id: 'post', label: 'FINAL SCORING', duration: 3, mode: 'disabled' },
];

export function reefscapeRobotDefaults() {
  const c = cloneConfig(DEFAULT_ROBOT);
  c.height = inch(36);
  // A compact frame fits reef approaches and cage lanes; this is a simulator design choice.
  c.frameLength = c.frameWidth = inch(27);
  c.hopperCapacity = 2;
  c.preload = 1;
  c.intake.maxHeight = C.ALGAE_RADIUS * 2 + 0.1;
  c.intake.reach = 0.35;
  c.intake.primary = c.intake.secondary = true;
  c.placement = { enabled: true, maxLevel: 4, liftSpeed: 1.3, reach: inch(18), cycleSeconds: 0.6, harvestSeconds: 0.45 };
  c.processor = { enabled: true };
  c.launcher.height = inch(38);
  c.launcher.minAngle = Math.PI / 6;
  c.launcher.maxAngle = Math.PI * 0.46;
  c.launcher.maxSpeed = 16;
  c.launcher.rate = 2;
  c.climber.maxLevel = 2;
  c.climber.secondsToClimb = 3.6;
  return c;
}

/** Rule limits come from R104/R105/G409; timing ranges are simulator tuning bounds. */
export function normalizeReefscapeConfig(config: RobotConfig): RobotConfig {
  const c = sanitizeConfig(config, inch(42), inch(120)), d = reefscapeRobotDefaults();
  const bounded = (v: number | undefined, fallback: number, lo: number, hi: number) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v!)) : fallback;
  c.intake.primary ??= true; c.intake.secondary ??= true;
  c.placement = { ...d.placement!, ...c.placement };
  const p = c.placement;
  p.maxLevel = Math.round(bounded(p.maxLevel, 4, 1, 4));
  p.reach = bounded(p.reach, inch(18), 0, inch(18));
  p.liftSpeed = bounded(p.liftSpeed, 1.3, 0.25, 2.5);
  p.cycleSeconds = bounded(p.cycleSeconds, 0.6, 0.2, 3);
  p.harvestSeconds = bounded(p.harvestSeconds, 0.45, 0.2, 3);
  c.processor = { ...d.processor!, ...c.processor };
  c.hopperCapacity = Number(c.intake.primary) + Number(c.intake.secondary);
  c.preload = c.intake.primary ? Math.min(1, c.preload) : 0;
  c.intake.enabled = c.hopperCapacity > 0;
  c.intake.reach = Math.min(d.intake.reach, Math.max(0, p.reach - c.bumperThickness));
  c.climber.maxLevel = Math.round(bounded(c.climber.maxLevel, 2, 0, 2));
  c.climber.secondsToClimb = bounded(c.climber.secondsToClimb, 3.6, 0.5, 12);
  c.launcher.rate = bounded(c.launcher.rate, 2, 0.25, 4);
  c.launcher.height = bounded(c.launcher.height, Math.min(inch(38), c.height), inch(8), c.height);
  return c;
}

export function reefscapeRobotPresets() {
  const all = reefscapeRobotDefaults(), coral = cloneConfig(all), algae = cloneConfig(all);
  coral.intake.secondary = false; coral.launcher.enabled = false; coral.processor!.enabled = false;
  algae.intake.primary = false; algae.preload = 0; algae.placement!.enabled = false;
  return [
    { id: 'all-rounder', label: 'All-rounder', description: 'L1–L4 CORAL, reef/ground ALGAE, PROCESSOR, NET and a deep CAGE climber.', config: all },
    { id: 'coral', label: 'CORAL + cage', description: 'L1–L4 CORAL and a deep CAGE climber; ALGAE mechanisms disabled.', config: coral },
    { id: 'algae', label: 'ALGAE + cage', description: 'Reef/ground ALGAE, PROCESSOR, NET and a deep CAGE climber; no CORAL preload or scoring.', config: algae },
  ].map((p) => ({ ...p, config: normalizeReefscapeConfig(p.config) }));
}

export function reefscapeRobotSummary(config: RobotConfig): string {
  const c = normalizeReefscapeConfig(config);
  const coral = c.placement!.enabled && c.intake.primary ? `CORAL L1–L${c.placement!.maxLevel}` : 'CORAL off';
  const algae = c.intake.secondary ? [c.processor!.enabled ? 'PROCESSOR' : '', c.launcher.enabled ? 'NET' : ''].filter(Boolean).join(' + ') || 'ALGAE pickup only' : 'ALGAE off';
  return `${coral} · ${algae} · ${['park only', 'shallow cage', 'deep cage'][c.climber.maxLevel]}`;
}

export function startPose(a: Alliance, station: number) {
  const p = C.side(a, C.START_LINE, [C.REEF_Y + 2.2, C.REEF_Y, C.REEF_Y - 2.2][station - 1]);
  return { ...p, yaw: C.sideYaw(a, Math.PI) };
}

export function driverEye(a: Alliance, station: number) {
  const p = C.side(a, -1.4, [C.REEF_Y + 2.2, C.REEF_Y, C.REEF_Y - 2.2][station - 1]);
  return { ...p, z: 1.95, yaw: C.sideYaw(a, 0) };
}
