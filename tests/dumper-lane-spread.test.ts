import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { SEASONS } from '../src/seasons';
import { launcherExitOffsets } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
// 2910's wide drum used to launch each ball from wherever it lay across the rollers, so a load slumped against one wall
// streamed out of that edge of the drum, where it missed. Shots now leave from randomly chosen lanes.
it('a dumper with its load slumped against one wall still fires across all of its lanes', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const config = season.teamRobots!.find(r => r.config.model === 'reblitz-2910')!.config;
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', pose: { x: 3, y: 4, yaw: 0 } });
  try {
    sim.rules.stage();
    sim.load(32);
    const robot = sim.robot;
    for (let i = 0; i < 60; i++) sim.step();
    robot.shootWhileTracking = true;
    const sides: number[] = [], launch = robot.launch.bind(robot), wall = config.frameWidth * 0.32;
    robot.launch = (_target, rng) => {
      // Every held ball against the same side wall of the hopper (heading 0: robot left is world -z).
      const t = robot.body.translation();
      for (const i of robot.held) {
        const b = sim.pool.bodies[i], p = b.translation();
        b.setTranslation({ x: p.x, y: p.y, z: t.z + wall }, true);
      }
      const shot = launch(null, rng);
      if (shot) sides.push(shot.pos.z - robot.body.translation().z);
      return shot;
    };
    for (let frame = 0; frame < 600 && sides.length < 30; frame++) sim.step({ ...IDLE_COMMAND, shoot: true });
    expect(sides.length).toBeGreaterThanOrEqual(24);
    const lanes = launcherExitOffsets(robot.config), halfLane = Math.abs(lanes[1] - lanes[0]) / 2;
    expect(sides.filter(z => z > halfLane).length).toBeGreaterThan(4);
    expect(sides.filter(z => z < -halfLane).length).toBeGreaterThan(4);
    // Nothing leaves past the outer lanes, out of the edge of the drum.
    expect(Math.max(...sides.map(Math.abs))).toBeLessThanOrEqual(Math.max(...lanes.map(Math.abs)) + halfLane / 2 + 1e-6);
  } finally { sim.dispose(); }
});
