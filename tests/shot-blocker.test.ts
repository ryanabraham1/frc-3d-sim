import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig, footprint } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { packCommand, unpackCommand } from '../src/engine/net/protocol';
import { inch, lb } from '../src/engine/units';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.year === 2026)!;
const team = (n: number) => cloneConfig(season.teamRobots!.find(t => t.team === n)!.config);
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

it('1323 is a 4414-style turret robot with a smaller hopper, lower fire rate and a legal shot blocker', () => {
  const m = season.normalizeRobotConfig!(team(1323)), h = team(4414);
  expect(m.launcher.turret).toBe(true);
  expect(m.height).toBeLessThan(C.TRENCH_CLEARANCE);
  expect(m.hopperCapacity).toBeLessThan(h.hopperCapacity);
  expect(m.launcher.rate).toBeLessThan(h.launcher.rate);
  const b = m.shotBlocker!;
  expect(b.reach).toBeLessThanOrEqual(inch(12) + 1e-9); // 12 in past the FRAME PERIMETER
  expect(m.height + b.rise).toBeLessThanOrEqual(C.MAX_ROBOT_HEIGHT + 1e-9);
});

/**
 * 254's front-edge dumper fires at its HUB with 1323 parked bumper to bumper in front of it, blocker side facing 254.
 * Returns how many shots got higher than 1323's raised blocker could ever reach (i.e. flew on toward the HUB).
 */
function shotsPast(deployed: boolean): { fired: number; past: number; deploy: number } {
  const shooter = team(254), blocker = team(1323);
  const y = C.HUB_CENTER.y, x0 = 2.4;
  const bx = x0 + footprint(shooter).length / 2 + footprint(blocker).length / 2 + 0.005;
  const sim = new HeadlessSim(season, RAPIER, {
    robot: shooter, alliance: 'blue', pose: { x: x0, y, yaw: 0 },
    extraRobots: [{ config: blocker, alliance: 'red', station: 1, id: 1, pose: { x: bx, y, yaw: 0 } }],
  }); sims.push(sim);
  const b = sim.ctx.robots[1];
  sim.load(20);
  const launched = new Set<number>(), past = new Set<number>();
  const held = () => new Set(sim.robot.held);
  sim.run(1, IDLE_COMMAND, () => { b.enabled = true; b.drive({ ...IDLE_COMMAND, block: deployed }, sim.physics.dt); return false; });
  let before = held();
  sim.run(3, { ...IDLE_COMMAND, shoot: true }, () => {
    b.enabled = true; b.drive({ ...IDLE_COMMAND, block: deployed }, sim.physics.dt);
    for (const i of before) if (!sim.robot.held.includes(i)) launched.add(i);
    before = held();
    for (const i of launched) if (sim.pool.position(i).y > C.MAX_ROBOT_HEIGHT + 0.25) past.add(i);
    return false;
  });
  return { fired: launched.size, past: past.size, deploy: b.blockerDeploy };
}

it('stowed, 254 shoots over 1323; with the shot blocker up, its shots hit the panel instead', () => {
  const open = shotsPast(false), blocked = shotsPast(true);
  expect(open.deploy).toBe(0);
  expect(blocked.deploy).toBe(1);
  expect(open.fired).toBeGreaterThanOrEqual(10);
  expect(blocked.fired).toBeGreaterThanOrEqual(10);
  expect(open.past).toBeGreaterThanOrEqual(open.fired * 0.8);
  expect(blocked.past).toBeLessThanOrEqual(blocked.fired * 0.2);
});

it('a raised shot blocker hits the TRENCH arm and stops the robot; lowered, the robot drives through', () => {
  const hubX = C.HUB_CENTER.x, y = C.TRENCH_OPENING_CENTER_Y;
  const drive = (block: boolean) => {
    const c = team(1323);
    const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: hubX - 2.5, y, yaw: 0 } }); sims.push(sim);
    sim.run(0.6, { ...IDLE_COMMAND, block });
    // Front first: the blocker trails over the intake side and catches the arm's near face.
    sim.run(4, { ...IDLE_COMMAND, block, vx: c.maxSpeed });
    return sim.robot;
  };
  const up = drive(true);
  expect(up.blockerDeploy).toBe(1);
  expect(up.tippedOver).toBe(false);
  // Stuck partway in, the panel against the arm's near face; it never gets through.
  expect(up.pose.x).toBeLessThan(hubX);
  const down = drive(false);
  expect(down.pose.x).toBeGreaterThan(hubX + C.TRENCH_DEPTH / 2 + 0.5);
});

it('the shot blocker cannot be raised under the TRENCH arm', () => {
  const sim = new HeadlessSim(season, RAPIER, { robot: team(1323), alliance: 'blue', pose: { x: C.HUB_CENTER.x, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 } }); sims.push(sim);
  sim.run(1, { ...IDLE_COMMAND, block: true });
  expect(sim.robot.blockerDeploy).toBe(0);
});

it('the intake does not run while the shot blocker is up', () => {
  const r0 = { x: 3, y: 4 };
  const sim = new HeadlessSim(season, RAPIER, { robot: team(1323), alliance: 'blue', pose: { ...r0, yaw: 0 } }); sims.push(sim);
  const r = sim.robot;
  sim.run(0.6, { ...IDLE_COMMAND, block: true });
  // FUEL just outside the back (intake) bumper.
  const behind = r0.x - r.footprint.length / 2 - 0.08;
  sim.scatter([{ x: behind, y: r0.y - 0.15 }, { x: behind, y: r0.y + 0.15 }]);
  sim.run(1, { ...IDLE_COMMAND, block: true, intake: true });
  expect(r.held.length).toBe(0);
  sim.run(1, { ...IDLE_COMMAND, intake: true });
  expect(r.blockerDeploy).toBe(0);
  expect(r.held.length).toBe(2);
});

it('the shot blocker command and state reach multiplayer clients', () => {
  expect(unpackCommand(packCommand({ ...IDLE_COMMAND, block: true }))!.block).toBe(true);
  expect(unpackCommand(packCommand(IDLE_COMMAND))!.block).toBeUndefined();
  const sim = new HeadlessSim(season, RAPIER, { robot: team(1323), alliance: 'blue', pose: { x: 3, y: 4, yaw: 0 } }); sims.push(sim);
  sim.run(0.5, { ...IDLE_COMMAND, block: true });
  expect((sim.robot.netState().act ?? 0) & 4).toBe(4);
});

it('every real team robot, across all seasons, has its own visual model id', () => {
  // Models register globally by id: a reused id (1323 has a 2025 robot too) silently draws the wrong robot.
  const ids = SEASONS.flatMap(s => s.teamRobots ?? []).map(t => t.config.model);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
});

it('every stock 2026 robot (presets and real team robots) weighs 150 lb, and the weight slider can reach it', () => {
  const configs = [...season.robotPresets!.map(p => p.config), ...season.teamRobots!.map(t => t.config), season.robotDefaults];
  for (const c of configs) expect(season.normalizeRobotConfig!(cloneConfig(c)).mass).toBeCloseTo(lb(150), 6);
  expect(season.maxRobotWeight).toBeGreaterThanOrEqual(lb(150));
});

it('a chassis-aimed dumper keeps firing when shoved a few degrees off the HUB, but not when knocked well off', () => {
  const fire = (offset: number) => {
    const pos = { x: 2.4, y: C.HUB_CENTER.y };
    const bearing = Math.atan2(C.HUB_CENTER.y - pos.y, C.HUB_CENTER.x - pos.x);
    const sim = new HeadlessSim(season, RAPIER, { robot: team(254), alliance: 'blue', pose: { ...pos, yaw: bearing + offset } }); sims.push(sim);
    const r = sim.robot;
    sim.load(5);
    const target = sim.rules.aimTarget(r);
    r.autoAlign({ ...IDLE_COMMAND, shoot: true }, target);
    return r.launch(target, sim.rng) !== null;
  };
  expect(fire(0.12)).toBe(true); // ~7° off: used to hold fire until within 3°
  expect(fire(0.3)).toBe(false);
});
