import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage, preloads } from '../src/seasons/wcp-hero-heist/config';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
import { shootingSpot } from '../src/seasons/wcp-hero-heist/bots';
import { DISTRICTS } from '../src/seasons/wcp-hero-heist/geometry';
import type { HeroHeistRules } from '../src/seasons/wcp-hero-heist/rules';

const ID = 'hero-sentinel-1923';
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const config = () => cloneConfig(heroTeamRobots().find(t => t.id === ID)!.config);
beforeAll(async () => {
  await RAPIER.init();
  const b = readFileSync(`public/models/robots/wcp-hero-heist/${ID}.glb`);
  await decodeCadModel(ID, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
function build(alliance: 'blue' | 'red' = 'blue') {
  const c = config(), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const mat = () => new THREE.MeshStandardMaterial();
  const m = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance, fp: { length: .92, width: .92 }, groundSide: -1, stationSide: -1, mats: { dark: mat(), alu: mat(), bumper: mat() } });
  return { m, visual };
}
const worldPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('1923 Sentinel', () => {
  it('is a legal Gadgeteer: 3 bubbles + 1 panel, back intake, forward shooter, park only', () => {
    const c = normalizeHeroConfig(config());
    expect(c.model).toBe(ID);
    expect(storage(c)).toEqual({ panels: 1, bubbles: 3 });
    expect(preloads(c)).toEqual({ panels: 1, bubbles: 3 });
    expect(c.launcher.turret).toBe(false);
    expect(c.intake.groundSide).toBe('back');
    expect(c.intake.station).toBe(false);
    expect(c.climber.maxLevel).toBe(0);
    expect(c.placement).toMatchObject({ enabled: true, maxLevel: 1 });
    expect(c.frameLength).toBeCloseTo(.7366);
  });

  it('actual CAD: frame stays put, slapdown intake deploys behind it, panel arm swings over the top, flywheel spins', () => {
    const { m, visual } = build();
    m.update(idle); visual.updateMatrixWorld(true);
    const frame = visual.getObjectByName('frame')!, fixed = frame.matrixWorld.clone();
    const tip = m.intakeAnchor!, claw = m.heldAnchor!;
    m.update({ ...idle, dt: 1 }); visual.updateMatrixWorld(true);
    const stowedTip = worldPos(tip), stowedClaw = worldPos(claw);
    expect(stowedTip.y).toBeGreaterThan(.45); // upright when stowed
    expect(stowedClaw.x).toBeLessThan(-.2); // claw rests beside the intake at the back
    for (let i = 0; i < 60; i++) { m.update({ ...idle, dt: 1 / 60, enabled: true, intaking: true, aiming: true, place: { height: .9, forward: .55, level: 1 } }); visual.updateMatrixWorld(true); visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true)); expect(frame.matrixWorld.equals(fixed)).toBe(true); }
    m.update({ ...idle, dt: 1, enabled: true, intaking: true, place: { height: .9, forward: .55, level: 1 } }); visual.updateMatrixWorld(true);
    const deployedTip = worldPos(tip), reachedClaw = worldPos(claw);
    expect(deployedTip.y).toBeLessThan(.2); expect(deployedTip.x).toBeLessThan(-.55); // roller on the carpet, outside the frame
    expect(reachedClaw.x).toBeGreaterThan(.3); expect(reachedClaw.y).toBeGreaterThan(.6); // claw lifted to the front mailbox
    expect(visual.getObjectByName('cad-flywheel-pivot')!.rotation.z).not.toBe(0);
    m.update({ ...idle, dt: 1, enabled: true, aiming: true, hood: 1.2 });
    expect(visual.getObjectByName('cad-hood-pivot')!.rotation.z).toBeGreaterThan(.2);
    const b = new THREE.Box3().setFromObject(visual); expect(b.max.y).toBeLessThan(1.5); expect(b.min.y).toBeGreaterThan(-.1);
  });

  it('draws held bubbles inside the tunnel and tints the intake rollers orange', () => {
    const { m, visual } = build();
    const spheres = () => { let n = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.visible) n++; }); return n; };
    m.update({ ...idle, fill: 0 }); expect(spheres()).toBe(0);
    m.update({ ...idle, fill: 1 / 3 }); expect(spheres()).toBe(1);
    m.update({ ...idle, fill: 1 }); expect(spheres()).toBe(3);
    const box = new THREE.Box3().setFromObject(visual.getObjectByName('frame')!);
    visual.traverse(o => { if (o.name === 'sentinel-held-bubble') expect(box.containsPoint(worldPos(o))).toBe(true); });
    let orange = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && !Array.isArray(o.material) && (o.material as THREE.MeshStandardMaterial).name === 'intake-orange') orange++; });
    expect(orange).toBeGreaterThan(0);
  });
});

describe('1923 Sentinel in the Rapier loop', () => {
  const sims: HeadlessSim[] = [];
  afterEach(() => { while (sims.length) sims.pop()!.dispose(); });
  for (const alliance of ['blue', 'red'] as const) it(`collects bubbles through the back intake and not the front for ${alliance}`, () => {
    const c = config(); c.preload = 0;
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance, pose: { x: 4, y: 4, yaw: alliance === 'blue' ? 0 : Math.PI } });
    sims.push(sim);
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q = sim.robot.body.rotation(), t = sim.robot.body.translation();
    const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const at = (side: number) => new THREE.Vector3(side * (sim.robot.footprint.length / 2 + .10), .09, 0).applyQuaternion(rot).add(new THREE.Vector3(t.x, t.y, t.z));
    const bubble = () => sim.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === alliance)!;
    const front = bubble(); sim.pool.placeWorld(front, at(1)); sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.state[front]).not.toBe('held');
    const back = bubble(); sim.pool.placeWorld(back, at(-1)); sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.owner[back]).toBe(sim.robot.id); expect(sim.pool.state[back]).toBe('held');
  });

  it('places its preloaded panel into a DOWNTOWN slit with the pivoting arm', () => {
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: config(), alliance: 'blue', pose: heroHeist.startPose('blue', 2) });
    sims.push(sim);
    const rules = sim.rules as HeroHeistRules;
    rules.stage();
    sim.robot.resetTo(rules.alignPose(sim.robot, DISTRICTS[8]));
    sim.run(.3);
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const ch of sim.ctx.clock.advance(20)) sim.rules.onPeriodChange(ch);
    expect(rules.panelCount(sim.robot)).toBe(1);
    for (let n = 0; n < Math.round(2.5 / sim.physics.dt); n++) { for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch); sim.step({ ...IDLE_COMMAND, pass: true }); }
    expect(rules.panelCount(sim.robot)).toBe(0);
    expect(rules.ownership.districts[8]).toEqual({ support: 'blue', strength: 2 });
  });

  it.each([8, 19] as const)('the fixed forward shooter, aimed by chassis assist, scores into district %i', id => {
    const d = DISTRICTS[id], spot = shootingSpot(d), c0 = d.cityBlock.center;
    const c = config(); c.launcher.spread = 0; c.launcher.speedError = 0;
    const sim = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance: 'blue', pose: { ...spot, yaw: Math.atan2(c0.y - spot.y, c0.x - spot.x) } });
    sims.push(sim);
    sim.run(.4);
    (sim.rules as HeroHeistRules).preferredBlock.set(sim.robot.id, id);
    sim.load(3);
    sim.run(5, { ...IDLE_COMMAND, shoot: true });
    sim.run(2);
    const sensed = sim.ctx.score.counter('red', 'bubbleSensed') + sim.ctx.score.counter('blue', 'bubbleSensed');
    expect(sensed, d.label).toBeGreaterThanOrEqual(2);
  });
});
