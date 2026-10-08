import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { solveFourBar } from '../src/engine/robot/hero5800Model';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, preloads, storage } from '../src/seasons/wcp-hero-heist/config';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
import { DISTRICTS } from '../src/seasons/wcp-hero-heist/geometry';
import { shootingSpot } from '../src/seasons/wcp-hero-heist/bots';
import type { HeroHeistRules } from '../src/seasons/wcp-hero-heist/rules';

const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const robots = () => heroTeamRobots().filter(t => t.team === 5800);
const mystic = () => robots().find(t => t.id === 'hero-multiclass-5800')!.config;
const gadgeteer = () => robots().find(t => t.id === 'hero-multiclass-5800-gadgeteer')!.config;
const sims: HeadlessSim[] = [];
afterEach(() => { while (sims.length) sims.pop()!.dispose(); });
beforeAll(async () => {
  const b = readFileSync('public/models/robots/wcp-hero-heist/hero-multiclass-5800.glb');
  await decodeCadModel('hero-multiclass-5800', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); // also serves the -gadgeteer alias
  await RAPIER.init();
});
const build = (c = mystic()) => {
  const visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance: 'blue', fp: { length: .85, width: .79 }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { m, visual, turret };
};

describe('5800 Multiclass', () => {
  it('is listed twice (Mystic and Gadgeteer declarations) on the same CAD file, Park only', () => {
    expect(robots().map(t => t.name)).toEqual(['Multiclass · Mystic', 'Multiclass · Gadgeteer']);
    for (const t of robots()) {
      const c = normalizeHeroConfig(t.config);
      expect(c.model).toBe(t.id);
      expect(c.climber.maxLevel).toBe(0);
      expect(c.options?.dualSideIntake).toBeFalsy();
      expect(c.launcher.turret).toBe(true);
      expect(c.launcher.maxAngle).toBeGreaterThan(c.launcher.minAngle); // binder: variable-angle hood
    }
    expect(storage(mystic())).toEqual({ panels: 0, bubbles: 6 });
    expect(storage(gadgeteer())).toEqual({ panels: 1, bubbles: 4 });
    expect(preloads(gadgeteer())).toEqual({ panels: 1, bubbles: 3 });
    expect(gadgeteer().placement?.enabled).toBe(true);
  });

  it('solves the 4-bar as a rigid mechanism: link lengths hold through the whole 0.797 rad travel', () => {
    const at = (t: number) => solveFourBar(t);
    const rest = at(0);
    expect(rest.middle).toBeCloseTo(0, 5); expect(rest.outer).toBeCloseTo(0, 5);
    const B = new THREE.Vector2(-0.2413, 0.1715);
    for (let i = 1; i <= 20; i++) {
      const f = at(i / 20 * 0.797);
      expect(f.Q.distanceTo(B)).toBeCloseTo(rest.Q.distanceTo(B), 5);
      expect(f.Q.distanceTo(f.P)).toBeCloseTo(rest.Q.distanceTo(rest.P), 5);
    }
    // The roller link swings out the back and down.
    expect(at(0.797).P.x).toBeLessThan(rest.P.x); expect(at(0.797).P.y).toBeLessThan(rest.P.y);
  });

  it('animates the actual CAD: turret, 4-bar deploy, 2-stage elevator + wrist; frame stays fixed', () => {
    const { m, visual, turret } = build(gadgeteer());
    m.update(idle); const frame = visual.getObjectByName('frame')!; visual.updateMatrixWorld(true); const fixed = frame.matrixWorld.clone();
    const rear = new THREE.Box3(), at = () => { rear.setFromObject(visual.getObjectByName('cad-intake-outer-pivot')!); return rear.min.y; };
    const stowedY = at(), tipStowed = m.intakeAnchor!.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 120; i++) {
      turret.rotation.y = (i / 119 - .5) * Math.PI * 2;
      m.update({ ...idle, dt: 1 / 60, enabled: true, intaking: true, aiming: true, place: { height: 1.6, forward: .7, level: 2 } });
      visual.updateMatrixWorld(true);
      visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrixWorld.equals(fixed)).toBe(true);
    }
    const tip = m.intakeAnchor!.getWorldPosition(new THREE.Vector3());
    expect(tip.x).toBeLessThan(tipStowed.x - .2); expect(tip.y).toBeLessThan(tipStowed.y - .04); // roller swings out the back and down
    expect(at()).toBeLessThan(stowedY - .03);
    expect(visual.getObjectByName('cad-carriage-lift-pivot')!.position.y).toBeGreaterThan(.5); // carriage rose (21.875 in stroke)
    expect(visual.getObjectByName('cad-spindexer-star-pivot')!.rotation.y).toBeGreaterThan(1); // 5-star spindexer turned
    expect(visual.getObjectByName('cad-elevator-stage-pivot')!.position.y).toBeGreaterThan(.2); // first stage rose
    expect(Math.abs(visual.getObjectByName('cad-wrist-pivot')!.rotation.z)).toBeGreaterThan(.3);
    expect(visual.getObjectByName('cad-turret-pivot')!.rotation.y).toBeCloseTo(turret.rotation.y - 1.0212);
    const b = new THREE.Box3().setFromObject(visual, true); expect(b.min.y).toBeGreaterThan(-.15); expect(b.max.y).toBeLessThan(2.3);
  });

  it('draws the bubbles it holds and marks the rear intake', () => {
    const { m, visual } = build();
    const spheres = () => { let n = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.visible) n++; }); return n; };
    m.update({ ...idle, fill: 0 }); expect(spheres()).toBe(0);
    m.update({ ...idle, fill: .5 }); expect(spheres()).toBe(3);
    m.update({ ...idle, fill: 1 }); expect(spheres()).toBe(6);
    const g = build(gadgeteer()); g.m.update({ ...idle, fill: 1 });
    let n = 0; g.visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.visible) n++; }); expect(n).toBe(4);
    let orange = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).color?.getHex?.() === 0xff7a1a) orange++; });
    expect(orange).toBeGreaterThanOrEqual(1); // rear roller bar
  });
});

describe('5800 Multiclass in the real sim', () => {
  const make = (c = mystic(), alliance: 'blue' | 'red' = 'blue') => {
    const cfg = cloneConfig(c); cfg.preload = 0;
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: cfg, alliance, pose: { x: 4, y: 4, yaw: alliance === 'blue' ? 0 : Math.PI } }); sims.push(sim);
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    return sim;
  };
  for (const alliance of ['blue', 'red'] as const) it(`collects bubbles only through the rear 4-bar intake (${alliance})`, () => {
    const sim = make(mystic(), alliance);
    const q = sim.robot.body.rotation(), center = sim.robot.body.translation();
    for (const side of [-1, 1]) {
      const i = sim.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === alliance)!;
      const p = new THREE.Vector3(side * (sim.robot.footprint.length / 2 + .10), .09, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(center.x, center.y, center.z));
      sim.pool.placeWorld(i, p); sim.step({ ...IDLE_COMMAND, intake: true });
      // groundSide is the robot's back (-1 local x): only that side takes the bubble.
      expect(sim.pool.owner[i] === sim.robot.id, `side ${side}`).toBe(side === -1);
    }
  });

  it('shoots with the turret from a legal LAUNCH ZONE spot and the bubbles reach the CITY BLOCK', () => {
    const d = DISTRICTS[8], spot = shootingSpot(d), c = d.cityBlock.center;
    const cfg = cloneConfig(mystic()); cfg.preload = 0; cfg.launcher.spread = 0; cfg.launcher.speedError = 0;
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: cfg, alliance: 'blue', pose: { ...spot, yaw: Math.atan2(c.y - spot.y, c.x - spot.x) } }); sims.push(sim);
    sim.run(0.4);
    (sim.rules as HeroHeistRules).preferredBlock.set(sim.robot.id, 8);
    sim.load(6);
    expect(sim.robot.held.length).toBe(6);
    sim.run(5, { ...IDLE_COMMAND, shoot: true }); sim.run(2);
    expect(sim.ctx.score.counter('red', 'bubbleSensed') + sim.ctx.score.counter('blue', 'bubbleSensed')).toBeGreaterThanOrEqual(3);
  });

  it('declared as a Gadgeteer it places its panel into a DOWNTOWN slit through the real placement loop', () => {
    const cfg = cloneConfig(gadgeteer()); cfg.preload = 0;
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: cfg, alliance: 'blue', pose: heroHeist.startPose('blue', 2) }); sims.push(sim);
    const rules = sim.rules as HeroHeistRules, d = DISTRICTS[8];
    sim.rules.stage();
    sim.robot.resetTo(rules.alignPose(sim.robot, d)); sim.run(0.3);
    const panel = sim.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'panel' && pieceIdentity(i).color === 'blue')!;
    sim.pool.hold(panel, sim.robot.id); rules.panels.set(sim.robot.id, [panel]);
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const ch of sim.ctx.clock.advance(20 - sim.ctx.clock.elapsed)) sim.rules.onPeriodChange(ch); // TELEOP
    for (let n = 0; n < Math.round(2.5 / sim.physics.dt); n++) { for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch); sim.step({ ...IDLE_COMMAND, pass: true }); }
    expect(rules.panelCount(sim.robot)).toBe(0);
    expect(rules.ownership.districts[8]).toEqual({ support: 'blue', strength: 2 });
  });
});
