import type { SeasonDefinition } from '@engine/core/season';
import type { RobotConfig } from '@engine/robot/config';
import { applyDriveSpec, applyTypicalDrive, ratioForTopSpeed, SDS_RATIOS, type DriveSpec } from '@engine/robot/drivetrainSpec';

/** Slowest empty-robot top speed any stock robot drives (user decision 2026-10-11: 15.4 ft/s). */
export const MIN_TOP_SPEED = 15.4 * 0.3048;

/**
 * Published drivetrains of real team robots (motor, reduction or quoted free speed). Every other robot keeps its
 * estimated top speed on the usual Kraken swerve, with acceleration derived from that gearing (drivetrainSpec.ts).
 */
const PUBLISHED: Record<string, Record<number, DriveSpec>> = {
  '2026-rebuilt': {
    // REBUILT's BUMPs and defense pushed top teams to their slowest MK5n ratio.
    971: { motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R1, source: 'MK5n R1 (7.03:1), Kraken X60 [team posts, via TylerHandel/rebuilt-sim-2026 #19]' },
    1678: { motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R1, source: 'MK5n R1 (7.03:1), Kraken X60 [team posts, via TylerHandel/rebuilt-sim-2026 #19]' },
    2910: { motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R1, source: 'MK5n R1 (7.03:1), Kraken X60: 14.4 ft/s free [team posts, via TylerHandel/rebuilt-sim-2026 #19]' },
    4414: { motor: 'krakenX60FOC', ratio: 7.67, source: '7.67:1 for low current draw [4414 2026 Technical Binder]; Kraken X60 [EST]' },
  },
  '2024-crescendo': {
    // Read as free speed, the way 1690 quotes its 2025 drive. [EST]
    1690: { motor: 'krakenX60FOC', freeSpeed: 5.6, source: '"5.6 m/s swerve" [Chief Delphi "Orbit 1690 Presents: 2024 robot reveal - Doppler"]' },
  },
  '2025-reefscape': {
    1690: { motor: 'krakenX60FOC', freeSpeed: 4.2, source: 'Custom swerve "geared for 4.2 m/s free speed", 4 Kraken X60 [1690orbit.com/robots]' },
  },
  'wcp-hero-heist': {
    1923: { motor: 'krakenX60FOC', freeSpeed: 19.2 * 0.3048, source: 'MK5n, 19.2 ft/s free [1923 binder, docs/HERO-HEIST-SENTINEL.md]; Kraken X60 [EST]' },
    6995: { motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R3, source: 'MK5n L3 [docs/HERO-HEIST-NOMAD.md]; Kraken X60 [EST]' },
  },
};

/**
 * Turn every stock robot's hand-picked speed and acceleration into real drivetrain numbers. Presets keep their
 * archetype trade-off (a heavier build's lower `maxAccel`) as a scale on the physics.
 */
export function applyRealDrivetrains(season: SeasonDefinition): void {
  const presets = season.robotPresets ?? [];
  const baseAccel = Math.max(season.robotDefaults.maxAccel, ...presets.map((p) => p.config.maxAccel));
  const preset = (c: RobotConfig) => applyTypicalDrive(c, c.maxAccel / baseAccel);
  preset(season.robotDefaults);
  for (const p of presets) preset(p.config);
  for (const t of season.teamRobots ?? []) {
    const spec = PUBLISHED[season.id]?.[t.team];
    if (spec) applyDriveSpec(t.config, spec);
    else applyTypicalDrive(t.config);
  }
  for (const c of [season.robotDefaults, ...presets.map((p) => p.config), ...(season.teamRobots ?? []).map((t) => t.config)]) floorSpeed(c);
  const bot = season.botRobotConfig;
  if (bot) {
    season.botRobotConfig = function (...args) {
      const c = bot.apply(this, args);
      if (c.drivetrain) return c;
      const out = structuredClone(c);
      preset(out);
      floorSpeed(out);
      return out;
    };
  }
}

/** Regear a robot slower than MIN_TOP_SPEED (same motor and wheel) to reach it; acceleration follows the new gearing. */
function floorSpeed(c: RobotConfig): void {
  const s = c.drivetrain;
  if (!s || c.maxSpeed >= MIN_TOP_SPEED) return;
  const scale = c.maxAccel / applyDriveSpecProbe(s, c);
  const { freeSpeed: _free, ...rest } = s;
  applyDriveSpec(c, { ...rest, ratio: ratioForTopSpeed(rest, MIN_TOP_SPEED), source: `${s.source}; regeared to the ${(MIN_TOP_SPEED / 0.3048).toFixed(1)} ft/s floor` }, scale);
}

/** Acceleration a spec gives this robot with no preset scale. */
function applyDriveSpecProbe(s: DriveSpec, c: RobotConfig): number {
  const probe = structuredClone(c);
  applyDriveSpec(probe, s);
  return probe.maxAccel;
}
