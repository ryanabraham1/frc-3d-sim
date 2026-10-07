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

/**
 * These tests guard mechanics (spawn, aim solver, rim clearance), so they fire an ideal shooter: realistic launch
 * spread would hide those bugs behind ordinary misses. Spread vs hit rate is covered by tests/rebuilt-accuracy.test.ts.
 */
function idealShooter(cfg: RobotConfig, season: SeasonDefinition): RobotConfig {
  season.shotAccuracy?.set(cfg, 100);
  return cfg;
}

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
      if (T.mechanism === 'placement') continue; // REEFSCAPE placements are covered by reefscape.test.ts.
      it(`shoots reliably from every scoring spot: ${v.name}`, () => {
        let fired = 0;
        let entered = 0;
        const worst: string[] = [];
        for (const alliance of ['blue', 'red'] as const) {
          for (const spot of T.scoringSpots(alliance)) {
            const cfg = idealShooter(cloneConfig(season.robotDefaults), season);
            v.mod(cfg, season);
            const g = T.goalCenter(alliance);
            // A turretless robot is driven up facing the goal (chassis auto-align finishes the aim).
            const pose = v.faceGoal || !cfg.launcher.turret ? { ...spot, yaw: Math.atan2(g.y - spot.y, g.x - spot.x) } : spot;
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
      if (T.mechanism === 'placement') return;
      let fired = 0;
      let entered = 0;
      for (const tall of [false, true]) {
        const spots = T.scoringSpots('blue');
        for (const [k, drive] of [
          { vx: 0, vy: 1.4, omega: 2 },
          { vx: -1.0, vy: -1.2, omega: -2.5 },
          { vx: 1.1, vy: 0, omega: 3 },
        ].entries()) {
          const cfg = idealShooter(cloneConfig(season.robotDefaults), season);
          if (tall) cfg.height = season.maxRobotHeight;
          const spot = spots[(k * 5 + 3) % spots.length];
          const r = runShotTrial(season, RAPIER, { label: 'moving', robot: cfg, alliance: 'blue', pose: spot, shots: 8, drive });
          expect(r.spawnGap).toBeGreaterThanOrEqual(0);
          fired += r.fired;
          entered += r.entered;
        }
      }
      // A chassis-aimed shooter keeps firing while its heading lags a hard sprint/spin (see Robot.launch), so some
      // balls miss; most still land because the servo leads the target.
      expect(entered / fired).toBeGreaterThanOrEqual(0.6);
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
              sim.scatter(Array.from({ length: T.scatterCount ?? 30 }, () => ({ x: mid.x + rng.range(-0.8, 0.8), y: mid.y + rng.range(-0.5, 0.5) })));
            }
            sim.run(0.4);
            const speed = cfg.maxSpeed;
            let tipped = false;
            sim.run(
              (len / speed) * 3 + 2,
              { ...IDLE_COMMAND, vx: (dx / len) * speed, vy: (dy / len) * speed, ...(T.mechanism === 'placement' ? { scoringLevel: 1 } : {}) },
              () => {
                tipped ||= sim.robot.tippedOver;
                const p = sim.robot.pose;
                return (p.x - lane.to.x) * dx + (p.y - lane.to.y) * dy > 0; // passed the end
              },
            );
            // Robots tilt now: a normal lane at normal speed must not tip anyone over.
            if (tipped) stuck.push(`${lane.label} h=${(h / 0.0254).toFixed(1)}in pieces=${pieces} TIPPED OVER`);
            const p = sim.robot.pose;
            const progress = ((p.x - lane.from.x) * dx + (p.y - lane.from.y) * dy) / (len * len);
            if (progress < 0.95) stuck.push(`${lane.label} h=${(h / 0.0254).toFixed(1)}in pieces=${pieces} progress=${(progress * 100).toFixed(0)}%`);
            sim.dispose();
          }
        }
      }
      expect(stuck).toEqual([]);
    });

    it('a robot beached on game pieces can drive itself off (never stranded with zero traction)', () => {
      // Regression: a robot tossed onto loose pieces (e.g. landing off a BUMP onto FUEL) once rested level on
      // them with every wheel in the air and no traction forever. Now it rocks onto some wheels and drives off.
      const lane = T.traversals()[0];
      const cfg = cloneConfig(season.robotDefaults);
      // Drive back from the lane start, away from the lane's structure (the robot rides high while beached).
      const heading = Math.atan2(lane.from.y - lane.to.y, lane.from.x - lane.to.x);
      const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { ...lane.from, yaw: heading } });
      const { length, width } = sim.robot.footprint;
      const d = Math.max(season.gamePiece.radius * 2, season.gamePiece.length ?? 0) * 1.1;
      const bed: { x: number; y: number }[] = [];
      for (let a = -length / 2 + d / 2; a < length / 2 - d / 4; a += d) {
        for (let b = -width / 2 + d / 2; b < width / 2 - d / 4; b += d) {
          bed.push({ x: lane.from.x + a * Math.cos(heading) - b * Math.sin(heading), y: lane.from.y + a * Math.sin(heading) + b * Math.cos(heading) });
        }
      }
      sim.scatter(bed);
      sim.run(0.3); // let the pieces settle, then drop the robot on top of them
      const t = sim.robot.body.translation();
      sim.robot.body.setTranslation({ x: t.x, y: season.gamePiece.radius * 2 + 0.05, z: t.z }, true);
      sim.run(0.6);
      expect(sim.robot.wheelsDown, 'setup: the robot should start up on the pieces').toBeLessThan(4);
      const speed = cfg.maxSpeed * 0.6;
      const off = () => sim.robot.wheelsDown === 4 && sim.robot.elevation < 0.01;
      sim.run(6, { ...IDLE_COMMAND, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed }, off);
      expect(off(), `still beached (elevation ${sim.robot.elevation.toFixed(3)} m, ${sim.robot.wheelsDown} wheels down)`).toBe(true);
      sim.dispose();
    });

    it('a tipped-over robot is set back on its wheels after 5 s (and is helpless until then)', () => {
      const lane = T.traversals()[0];
      const cfg = cloneConfig(season.robotDefaults);
      const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { ...lane.from, yaw: 0 } });
      sim.load(1);
      // Lay it on its side (rolled 90° about its forward axis), resting on the carpet.
      const t = sim.robot.body.translation();
      sim.robot.body.setTranslation({ x: t.x, y: sim.robot.footprint.width / 2 + 0.02, z: t.z }, true);
      sim.robot.body.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, true);
      sim.run(1);
      expect(sim.robot.tippedOver).toBe(true);
      const before = sim.robot.pose;
      sim.run(2, { ...IDLE_COMMAND, vx: 2, shoot: true, pass: false });
      expect(Math.hypot(sim.robot.pose.x - before.x, sim.robot.pose.y - before.y), 'a tipped robot drove').toBeLessThan(0.3);
      expect(sim.fired, 'a tipped robot fired').toBe(0);
      expect(sim.robot.tippedOver, 'righted too early').toBe(true);
      expect(sim.robot.rightingIn).toBeGreaterThan(1);
      sim.run(2.5);
      expect(sim.robot.tippedOver).toBe(false);
      sim.run(0.5);
      expect(sim.robot.uprightness).toBeGreaterThan(0.99);
      expect(sim.robot.wheelsDown).toBe(4);
      expect(sim.robot.tippedTime).toBe(0);
      sim.run(1, { ...IDLE_COMMAND, vx: 1.5 });
      expect(sim.robot.speed, 'drives again once righted').toBeGreaterThan(1);
      sim.dispose();
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
