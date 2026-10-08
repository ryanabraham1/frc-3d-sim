import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { normalizeHeroConfig, storage } from '../src/seasons/wcp-hero-heist/config';
import { pieceIdentity, TOWER_HEIGHT_LIMIT } from '../src/seasons/wcp-hero-heist/constants';
import { DISTRICTS, PAD_Y, trussX } from '../src/seasons/wcp-hero-heist/geometry';
import type { HeroHeistRules } from '../src/seasons/wcp-hero-heist/rules';
import { poofs254Robot } from '../src/seasons/wcp-hero-heist/team254';

const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const sims: HeadlessSim[] = [];
afterEach(() => { while (sims.length) sims.pop()!.dispose(); });
beforeAll(async () => {
  await RAPIER.init();
  const b = readFileSync('public/models/robots/wcp-hero-heist/hero-poofs-254.glb');
  await decodeCadModel('hero-poofs-254', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const material = () => new THREE.MeshStandardMaterial();
function build(alliance: 'blue' | 'red' = 'blue') {
  const c = poofs254Robot().config, visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const model = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance, fp: { length: .88, width: .81 }, groundSide: -1, stationSide: -1, mats: { dark: material(), alu: material(), bumper: material() } });
  return { c, visual, turret, model };
}
const settle = (m: ReturnType<typeof build>['model'], s: Partial<RobotAnimState>) => { for (let i = 0; i < 60; i++) m.update({ ...idle, dt: 1 / 30, ...s }); };
const at = (visual: THREE.Object3D, o: THREE.Object3D) => { visual.updateMatrixWorld(true); return o.getWorldPosition(new THREE.Vector3()); };

describe('254 Cheesy Poofs (WCP CADathon Gadgeteer)', () => {
  it('is a legal Gadgeteer: 3 bubbles + 1 panel, back intake, turret, High climb', () => {
    const c = normalizeHeroConfig(poofs254Robot().config);
    expect(c.model).toBe('hero-poofs-254');
    expect(storage(c)).toEqual({ panels: 1, bubbles: 3 });
    expect(c.intake.groundSide).toBe('back');
    expect(c.launcher.turret).toBe(true);
    expect(c.climber.maxLevel).toBe(3);
    expect(c.placement?.enabled).toBe(true);
    expect(c.launcher.mounts).toEqual([{ forward: -.0365, side: 0 }]);
  });

  it('the CAD keeps the frame fixed while the turret, hood, three-stage elevator, claw and pad move', () => {
    const { visual, turret, model } = build();
    model.update(idle); visual.updateMatrixWorld(true);
    const frame = visual.getObjectByName('frame')!, fixed = frame.matrixWorld.clone();
    const y = (n: string) => visual.getObjectByName(n)!.position.y;
    const stowed = { s2: y('stage2'), s3: y('stage3'), pad: y('pad') };
    settle(model, { enabled: true, climb: 1 });
    expect(y('stage3') - stowed.s3).toBeGreaterThan(.8);          // stage 3 rises ~0.85 m for the pad
    expect(y('stage2') - stowed.s2).toBeGreaterThan(.4);          // stage 2 half as far
    expect(y('pad') - stowed.pad).toBeGreaterThan(.8);
    const pad = new THREE.Box3().setFromObject(visual.getObjectByName('pad')!);
    expect(pad.max.y).toBeGreaterThan(1.66); expect(pad.max.y).toBeLessThan(1.76); // reaches the 66 in truss underside from the floor
    for (let i = 0; i < 90; i++) {
      turret.rotation.y = (i / 89 - .5) * Math.PI * 2;
      model.update({ ...idle, dt: 1 / 60, enabled: true, aiming: true, hood: .26 + i / 89 * .96 });
      visual.updateMatrixWorld(true);
      visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrixWorld.equals(fixed)).toBe(true);
    }
    // The CAD shooter exits along source +X; the +90° offset makes the shot leave forward at turret yaw 0.
    turret.rotation.y = 0; settle(model, { enabled: true });
    const hood = new THREE.Box3().setFromObject(visual.getObjectByName('hood')!).getCenter(new THREE.Vector3());
    expect(hood.x).toBeLessThan(0.1);
    const wheel = visual.getObjectByName('cad-flywheel-pivot')!.rotation.x;
    settle(model, { enabled: true, aiming: true }); expect(visual.getObjectByName('cad-flywheel-pivot')!.rotation.x).not.toBeCloseTo(wheel);
  });

  it('the claw swings over to present the STORY PANEL at each mailbox family\'s reach and height', () => {
    const { visual, model } = build();
    // (forward reach, panel-centre height) the rules ask for: DOWNTOWN slits, UPTOWN diagonal slits, low FOOTHILL baskets.
    for (const [forward, height] of [[.38, .65], [.41, 1.09], [.54, 1.08]] as const) {
      settle(model, { enabled: true, place: { height, forward, level: 2 } });
      const p = at(visual, model.heldAnchor!);
      expect(Math.hypot(p.x - forward, p.y - height), `${forward}/${height}`).toBeLessThan(.16);
    }
    settle(model, { enabled: true, place: { height: .45, forward: .2, level: 0 } }); // idle: claw rests over the back, panel above the intake
    const idleAnchor = at(visual, model.heldAnchor!);
    expect(idleAnchor.y).toBeGreaterThan(.8); expect(idleAnchor.x).toBeLessThan(0);
  });

  it('draws held bubbles and marks the intake mouth', () => {
    for (const alliance of ['blue', 'red'] as const) {
      const { visual, model } = build(alliance);
      const spheres = () => { let n = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.visible) n++; }); return n; };
      model.update({ ...idle, fill: 0 }); expect(spheres()).toBe(0);
      model.update({ ...idle, fill: 1 / 3 }); expect(spheres()).toBe(1);
      model.update({ ...idle, fill: 1 }); expect(spheres()).toBe(3);
      const markers: THREE.Mesh[] = []; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry) markers.push(o); });
      expect(markers).toHaveLength(1);
      settle(model, { enabled: true });
      expect(at(visual, markers[0]).x).toBeLessThan(-.5); expect(at(visual, markers[0]).y).toBeLessThan(.3);   // deployed at the back, near the floor
      expect(at(visual, model.intakeAnchor!).x).toBeLessThan(-.5);
    }
  });
});

describe('254 in the Hero Heist rules', () => {
  const sim = (pose: { x: number; y: number; yaw: number }) => { const s = new HeadlessSim(heroHeist, RAPIER, { robot: poofs254Robot().config, alliance: 'blue', pose }); sims.push(s); return s; };
  const rules = (s: HeadlessSim) => s.rules as HeroHeistRules;
  it('collects a bubble through its back intake mouth only', () => {
    for (const side of [-1, 1]) {
      const c = poofs254Robot().config; c.preload = 0;
      const s = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } }); sims.push(s);
      s.rules.stage(); s.rules.onPeriodChange(s.ctx.clock.start());
      const i = s.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === 'blue')!;
      const q = s.robot.body.rotation(), t = s.robot.body.translation();
      const local = new THREE.Vector3(side * -(s.robot.footprint.length / 2 + .1), .09, 0);
      s.pool.placeWorld(i, local.applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(t.x, t.y, t.z)));
      s.step({ ...IDLE_COMMAND, intake: true });
      expect(s.pool.owner[i] === s.robot.id, `side ${side}`).toBe(side === 1);
    }
  });
  it('never takes a panel from the floor (binder: no ground panel intake)', () => {
    const s = sim({ x: 4, y: 4, yaw: 0 }); s.rules.stage(); s.rules.onPeriodChange(s.ctx.clock.start());
    const held = rules(s).panelCount(s.robot);
    const i = s.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'panel' && pieceIdentity(i).color === 'blue')!;
    const q = s.robot.body.rotation(), t = s.robot.body.translation();
    s.pool.placeWorld(i, new THREE.Vector3(-(s.robot.footprint.length / 2 + .15), .05, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(t.x, t.y, t.z)));
    s.step({ ...IDLE_COMMAND, intake: true });
    expect(rules(s).panelCount(s.robot)).toBe(held);
  });
  it('climbs to HIGH under the 78 in limit', () => {
    const s = sim({ x: trussX('blue'), y: PAD_Y[1], yaw: 0 }); s.run(.3);
    s.rules.onPeriodChange(s.ctx.clock.start());
    for (const ch of s.ctx.clock.advance(120 - s.ctx.clock.elapsed)) s.rules.onPeriodChange(ch);
    for (let n = 0; n < Math.round(9 / s.physics.dt); n++) { for (const ch of s.ctx.clock.advance(s.physics.dt)) s.rules.onPeriodChange(ch); s.step({ ...IDLE_COMMAND, climb: 3 }); }
    expect(rules(s).towerLevel(s.robot)).toBe(3);
    expect(s.robot.elevation + s.robot.config.height).toBeLessThanOrEqual(TOWER_HEIGHT_LIMIT + 1e-6);
  });
  it('delivers its STORY PANEL into a mailbox', () => {
    const d = DISTRICTS[9];
    const s = sim({ x: 4, y: 4, yaw: 0 });
    s.robot.resetTo(rules(s).alignPose(s.robot, d)); s.run(.3);
    s.rules.stage();
    s.rules.onPeriodChange(s.ctx.clock.start());
    for (const ch of s.ctx.clock.advance(20 - s.ctx.clock.elapsed)) s.rules.onPeriodChange(ch);
    expect(rules(s).panelCount(s.robot)).toBe(1);
    for (let n = 0; n < Math.round(3.5 / s.physics.dt); n++) { for (const ch of s.ctx.clock.advance(s.physics.dt)) s.rules.onPeriodChange(ch); s.step({ ...IDLE_COMMAND, pass: true }); }
    expect(rules(s).panelCount(s.robot)).toBe(0);
    expect(rules(s).ownership.districts[9].strength).toBeGreaterThan(0);
  });
});
