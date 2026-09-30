/**
 * PHYSICS REGRESSION SUITE — runs for EVERY registered season (src/seasons/index.ts), in real Rapier
 * physics on the real field (HeadlessSim, no browser). A new season is checked automatically as soon as
 * it is registered with a `testing` hook. Guards against the class of bugs found in 2026:
 *   - launched pieces spawning inside the robot that fired them (tall robots missed the HUB)
 *   - aim solver ignoring the physical goal rim / air damping (point-blank and long shots missed)
 *   - robots wedging under low structures (drive kept pushing with no wheel contact)
 * Mid-air piece-on-piece collisions are REAL physics and intentionally kept, so hit-rate thresholds
 * allow a small miss rate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons/index';
import type { SeasonDefinition } from '../src/engine/core/season';
import { runShotTrial } from '../src/engine/testing/shotHarness';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig, RobotConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { Rng } from '../src/engine/random';
import { inch } from '../src/engine/units';

beforeAll(async () => {
  await RAPIER.init();
});

type Variant = { name: string; mod: (c: RobotConfig, s: SeasonDefinition) => void; faceGoal?: boolean; minRate: number };

/** Robot designs a user can build from the menu — including the extremes. */
const VARIANTS: Variant[] = [
  { name: 'season default', mod: () => {}, minRate: 0.95 },
  { name: 'tallest legal + 80 capacity', mod: (c, s) => ((c.height = s.maxRobotHeight), (c.hopperCapacity = 80)), minRate: 0.95 },
  { name: 'short (12in)', mod: (c) => (c.height = inch(12)), minRate: 0.93 },
  { name: 'tiny (18x18, 10in)', mod: (c) => ((c.frameLength = inch(18)), (c.frameWidth = inch(18)), (c.height = inch(10))), minRate: 0.93 },
  { name: 'max frame (36x36)', mod: (c) => ((c.frameLength = inch(36)), (c.frameWidth = inch(36))), minRate: 0.95 },
  { name: 'no turret, chassis-aimed', mod: (c) => ((c.launcher.turret = false), (c.aimAssist = 'speed')), faceGoal: true, minRate: 0.95 },
  { name: '20 shots/s', mod: (c) => (c.launcher.rate = 20), minRate: 0.9 },
];

for (const season of SEASONS) {
  describe(`${season.year} ${season.name} — physics`, () => {
    it('defines a testing hook (required for every season)', () => {
      expect(season.testing).toBeDefined();
      expect(season.testing!.scoringSpots('blue').length).toBeGreaterThan(5);
    });
    if (!season.testing) return;
    const T = season.testing;

    for (const v of VARIANTS) {
      it(`shoots reliably from every scoring spot: ${v.name}`, () => {
        let fired = 0;
        let entered = 0;
        const worst: string[] = [];
        for (const alliance of ['blue', 'red'] as const) {
          for (const spot of T.scoringSpots(alliance)) {
            const cfg = cloneConfig(season.robotDefaults);
            v.mod(cfg, season);
            const g = T.goalCenter(alliance);
            const pose = v.faceGoal ? { ...spot, yaw: Math.atan2(g.y - spot.y, g.x - spot.x) } : spot;
            const r = runShotTrial(season, RAPIER, { label: v.name, robot: cfg, alliance, pose, shots: 8 });
            // A launched piece must never start inside the robot that fired it.
            expect(r.spawnGap, `spawn overlaps robot at ${alliance} (${spot.x.toFixed(2)},${spot.y.toFixed(2)})`).toBeGreaterThanOrEqual(0);
            // Every legal scoring spot must have a trajectory that clears the goal geometry.
            expect(r.allClear, `no clear shot from ${alliance} (${spot.x.toFixed(2)},${spot.y.toFixed(2)})`).toBe(true);
            expect(r.fired).toBe(8);
            fired += r.fired;
            entered += r.entered;
            if (r.entered < r.fired * 0.6) worst.push(`${alliance} (${spot.x.toFixed(2)},${spot.y.toFixed(2)}) ${r.entered}/${r.fired}`);
          }
        }
        expect(worst, 'spots with a poor hit rate').toEqual([]);
        expect(entered / fired).toBeGreaterThanOrEqual(v.minRate);
      });
    }

    it('shoots on the move while turning (default and tallest robots)', () => {
      let fired = 0;
      let entered = 0;
      for (const tall of [false, true]) {
        const spots = T.scoringSpots('blue');
        for (const [k, drive] of [
          { vx: 0, vy: 1.4, omega: 2 },
          { vx: -1.0, vy: -1.2, omega: -2.5 },
          { vx: 1.1, vy: 0, omega: 3 },
        ].entries()) {
          const cfg = cloneConfig(season.robotDefaults);
          if (tall) cfg.height = season.maxRobotHeight;
          const spot = spots[(k * 5 + 3) % spots.length];
          const r = runShotTrial(season, RAPIER, { label: 'moving', robot: cfg, alliance: 'blue', pose: spot, shots: 8, drive });
          expect(r.spawnGap).toBeGreaterThanOrEqual(0);
          fired += r.fired;
          entered += r.entered;
        }
      }
      expect(entered / fired).toBeGreaterThanOrEqual(0.85);
    });

    it('drives every required lane (incl. through scattered game pieces) without getting stuck', () => {
      const stuck: string[] = [];
      for (const lane of T.traversals()) {
        const heights = [season.robotDefaults.height, Math.min(season.maxRobotHeight, (lane.maxRobotHeight ?? Infinity) - inch(0.5))];
        for (const h of heights) {
          for (const pieces of [false, true]) {
            const cfg = cloneConfig(season.robotDefaults);
            cfg.height = h;
            const dx = lane.to.x - lane.from.x;
            const dy = lane.to.y - lane.from.y;
            const len = Math.hypot(dx, dy);
            const heading = Math.atan2(dy, dx);
            const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { ...lane.from, yaw: heading } });
            sim.load(cfg.hopperCapacity); // full hopper → it must push through, not swallow, the pieces
            if (pieces) {
              const rng = new Rng(Math.round(lane.from.y * 1000));
              const mid = { x: (lane.from.x + lane.to.x) / 2, y: (lane.from.y + lane.to.y) / 2 };
              sim.scatter(Array.from({ length: 30 }, () => ({ x: mid.x + rng.range(-0.8, 0.8), y: mid.y + rng.range(-0.5, 0.5) })));
            }
            sim.run(0.4);
            const speed = cfg.maxSpeed;
            sim.run(
              (len / speed) * 3 + 2,
              { ...IDLE_COMMAND, vx: (dx / len) * speed, vy: (dy / len) * speed },
              () => {
                const p = sim.robot.pose;
                return (p.x - lane.to.x) * dx + (p.y - lane.to.y) * dy > 0; // passed the end
              },
            );
            const p = sim.robot.pose;
            const progress = ((p.x - lane.from.x) * dx + (p.y - lane.from.y) * dy) / (len * len);
            if (progress < 0.95) stuck.push(`${lane.label} h=${(h / 0.0254).toFixed(1)}in pieces=${pieces} progress=${(progress * 100).toFixed(0)}%`);
            sim.dispose();
          }
        }
      }
      expect(stuck).toEqual([]);
    });

    it('robots taller than a lane limit are physically blocked (realism check)', () => {
      const limited = T.traversals().filter((l) => l.maxRobotHeight !== undefined && l.maxRobotHeight + inch(2) <= season.maxRobotHeight);
      for (const lane of limited.slice(0, 1)) {
        const cfg = cloneConfig(season.robotDefaults);
        cfg.height = lane.maxRobotHeight! + inch(2);
        const dx = lane.to.x - lane.from.x;
        const dy = lane.to.y - lane.from.y;
        const len = Math.hypot(dx, dy);
        const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { ...lane.from, yaw: Math.atan2(dy, dx) } });
        sim.run(0.3);
        sim.run(3, { ...IDLE_COMMAND, vx: (dx / len) * 3, vy: (dy / len) * 3 });
        const p = sim.robot.pose;
        const progress = ((p.x - lane.from.x) * dx + (p.y - lane.from.y) * dy) / (len * len);
        expect(progress).toBeLessThan(0.6);
        sim.dispose();
      }
    });

    it('feeding never drops pieces into our own goal', () => {
      const probe = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: T.scoringSpots('blue')[0] });
      const hasPass = !!probe.rules.passTarget;
      probe.dispose();
      if (!hasPass) return;
      for (const spot of [
        { x: season.fieldLength * 0.42, y: season.fieldWidth * 0.5 },
        { x: season.fieldLength * 0.45, y: season.fieldWidth * 0.3 },
        { x: season.fieldLength * 0.8, y: season.fieldWidth * 0.7 },
      ]) {
        const r = runShotTrial(season, RAPIER, { label: 'feed', robot: season.robotDefaults, alliance: 'blue', pose: { ...spot, yaw: 0 }, shots: 8, mode: 'pass' });
        expect(r.fired).toBe(8);
        expect(r.entered).toBe(0);
      }
    });
  });
}
