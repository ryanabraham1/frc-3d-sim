import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { cadRobotModelBuilder, decodeCadModel, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';
import { inch } from '../src/engine/units';
import { fourBar } from '../src/engine/robot/rebuiltCadKit';

/** Second 2026 CAD batch (6329, 1706, 7769, 1987, 9496): imported public CAD with measured joints. */
const season = SEASONS.find(s => s.year === 2026)!;
const IDS = ['roman-6329', 'mirage-1706', 'chunk-7769', 'cyclone-1987', 'matterhorn-9496'] as const;
const GROUPS: Record<typeof IDS[number], string[]> = {
  'roman-6329': ['frame', 'flywheel', 'intake', 'intake-drive-arm', 'intake-driven-arm', 'intake-dropdown', 'intake-roller-0', 'shooter-roller-0', 'floor-roller-0'],
  'mirage-1706': ['frame', 'intake', 'intake-roller-0', 'turret-left', 'turret-right', 'wheels-left', 'flywheel-right', 'rotor-left', 'rotor-right'],
  'chunk-7769': ['frame', 'intake', 'intake-roller', 'kick-bar', 'flywheel', 'hood', 'feeder', 'climber'],
  'cyclone-1987': ['frame', 'intake', 'rotor', 'turret', 'hood', 'flywheel'],
  'matterhorn-9496': ['frame', 'intake', 'intake-roller-0', 'hopper-ext', 'flywheel', 'feeder-roller-0'],
};
const config = (id: string) => cloneConfig(season.teamRobots!.find(r => r.id === id)!.config);
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .9, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const build = (id: string) => {
  const c = config(id), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = cadRobotModelBuilder(c.model)!({ config: c, visual, turret, alliance: 'blue', fp: { length: c.frameLength, width: c.frameWidth }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { c, visual, turret, m, root: visual.getObjectByName(`cad-${id}`)! };
};
const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true);

beforeAll(async () => {
  await RAPIER.init();
  for (const id of IDS) { const b = readFileSync(`public/models/robots/2026/${id}.glb`); await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
});

describe.each(IDS)('%s', id => {
  it('decodes a bounded asset with every articulated group and a hopper that holds its capacity', () => {
    const report = JSON.parse(readFileSync(`public/models/robots/2026/${id}.report.json`, 'utf8'));
    expect(report.outputBytes).toBeLessThan(10_000_000);
    expect(report.outputTriangles).toBeLessThan(1_000_000);
    expect(report.outputTriangles / report.inputTriangles).toBeLessThan(.2);
    const { c, visual, root } = build(id);
    for (const g of GROUPS[id]) expect(root.getObjectByName(g), g).toBeDefined();
    expect(visual.getObjectByName('hopper-fuel-pile')!.userData.fuelSlots).toBe(c.hopperCapacity);
    // Trench robot: the CAD and the collision box stay under the 22.25 in TRENCH.
    expect(bounds(root).max.y).toBeLessThan(.565);
    expect(c.height).toBeLessThan(.565);
    expect(2 * (c.frameLength + c.frameWidth)).toBeLessThanOrEqual(inch(110) + 1e-9);
  });

  it('sweeps every mechanism with finite poses, a fixed frame and intake above the carpet', () => {
    const { visual, turret, m, root } = build(id);
    const frame = root.getObjectByName('frame')!; visual.updateMatrixWorld(true); const bind = frame.matrixWorld.clone();
    for (let i = 0; i < 121; i++) {
      const t = i / 120;
      turret.rotation.y = Math.sin(t * 7) * 1.2;
      m.update({ ...idle, dt: .025, time: t * 3, enabled: i < 60, aiming: i % 30 < 20, intaking: i % 20 < 10, firing: i > 30 && i < 50 ? 1 : 0, hood: .5 + t * .8, fill: t, climb: i > 90 ? 1 : 0 });
      visual.updateMatrixWorld(true);
      root.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrixWorld.equals(bind)).toBe(true);
      expect(bounds(root.getObjectByName('cad-intake-pivot')!).min.y).toBeGreaterThan(.015);
      expect(m.flow!.feed!(i).every(p => p.toArray().every(Number.isFinite))).toBe(true);
      expect(m.flow!.intake!().every(p => p.toArray().every(Number.isFinite))).toBe(true);
    }
  });

  it('stows inside the bumpers, deploys out the back, and keeps the export pose with animation off', () => {
    const { c, visual, m, root } = build(id);
    const deployed = () => { visual.updateMatrixWorld(true); return m.intakeAnchor!.getWorldPosition(new THREE.Vector3()); };
    const exportTip = deployed();
    expect(exportTip.x).toBeLessThan(-c.frameLength / 2 - c.bumperThickness);
    expect(exportTip.y).toBeGreaterThan(.03); expect(exportTip.y).toBeLessThan(.15);
    for (let i = 0; i < 80; i++) m.update({ ...idle, dt: .05 });
    visual.updateMatrixWorld(true);
    expect(bounds(root.getObjectByName('cad-intake-pivot')!).min.x).toBeGreaterThan(-c.frameLength / 2 - c.bumperThickness - .005);
    for (let i = 0; i < 80; i++) m.update({ ...idle, dt: .05, enabled: true });
    expect(deployed().distanceTo(exportTip)).toBeLessThan(.01);
    setCadAnimationEnabled(false);
    try {
      const pivot = root.getObjectByName('cad-intake-pivot')!, before = pivot.position.clone(), rot = pivot.rotation.z;
      for (let i = 0; i < 40; i++) m.update({ ...idle, dt: .05 });
      expect(pivot.position.equals(before)).toBe(true); expect(pivot.rotation.z).toBe(rot);
    } finally { setCadAnimationEnabled(true); }
  });

  it('collects through its rear CAD mouth and rejects FUEL at the shooter end in gameplay', () => {
    for (const side of [-1, 1]) {
      const c = config(id), sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 3, y: 2, yaw: 0 } });
      try {
        for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
        sim.pool.placeField(0, 3 + side * (c.frameLength / 2 + c.bumperThickness + .1), 2);
        sim.run(.8, { ...IDLE_COMMAND, intake: true });
        expect(sim.robot.held.length, `side ${side}`).toBe(side === -1 ? 1 : 0);
      } finally { sim.dispose(); }
    }
  });
});

it('Roman II four-bar is a pure function of the drive angle and returns to the export pose', () => {
  const linkage = fourBar([-.267, .2095], [-.165, .254], [-.567, .444], [-.461, .514]);
  const far = linkage.solve(-1);
  const zero = linkage.solve(0);
  expect(zero.c.x).toBeCloseTo(-.567, 6); expect(zero.d.x).toBeCloseTo(-.461, 6); expect(zero.coupler).toBeCloseTo(0, 6);
  expect(linkage.solve(-1).d.distanceTo(far.d)).toBeLessThan(1e-9);
  // Rigid links: coupler and driven-arm lengths stay constant through the stow.
  for (let t = -1; t <= 0; t += .1) {
    const s = linkage.solve(t);
    expect(s.c.distanceTo(s.d)).toBeCloseTo(Math.hypot(.106, .07), 6);
    expect(s.d.distanceTo(new THREE.Vector2(-.165, .254))).toBeCloseTo(Math.hypot(.296, .26), 6);
  }
});

it('saved Roman I turret picks become the imported Roman II drum robot; custom Roman configs are kept', () => {
  const old = config('roman-6329');
  old.launcher.turret = true; old.launcher.exits = 1; old.hopperCapacity = 47; old.launcher.rate = 14; old.frameLength = inch(27); old.frameWidth = inch(27);
  const c = season.normalizeRobotConfig!(old);
  expect(c.launcher.turret).toBe(false); expect(c.hopperCapacity).toBe(config('roman-6329').hopperCapacity);
  expect(c.frameLength).toBeCloseTo(inch(24), 9); expect(c.frameWidth).toBeCloseTo(inch(30), 9);
  const custom = config('roman-6329'); custom.hopperCapacity = 33; custom.frameLength = .6;
  const kept = season.normalizeRobotConfig!(custom);
  expect(kept.hopperCapacity).toBe(33); expect(kept.frameLength).toBe(.6);
});

it('saved CHUNK picks adopt the CAD frame without touching capacity, rate or custom sizes', () => {
  const old = config('chunk-7769'); old.frameLength = inch(27); old.frameWidth = inch(27); old.height = inch(21);
  const c = season.normalizeRobotConfig!(old);
  expect(c.frameLength).toBeCloseTo(inch(25), 9); expect(c.frameWidth).toBeCloseTo(inch(29), 9); expect(c.height).toBe(.55);
  expect(c.hopperCapacity).toBe(37); expect(c.launcher.rate).toBe(config('chunk-7769').launcher.rate);
  const custom = config('chunk-7769'); custom.frameLength = .6;
  expect(season.normalizeRobotConfig!(custom).frameLength).toBe(.6);
});

it('CHUNK raises its L1 climb arm for a climb and its hood for a shot', () => {
  const { visual, m, root } = build('chunk-7769');
  const arm = root.getObjectByName('cad-climber-pivot')!, hood = root.getObjectByName('cad-hood-pivot')!;
  for (let i = 0; i < 60; i++) m.update({ ...idle, dt: .05, enabled: true, climb: 1 });
  visual.updateMatrixWorld(true);
  expect(arm.position.y).toBeGreaterThan(.15);
  expect(m.climbAnchor!.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(.7);
  for (let i = 0; i < 60; i++) m.update({ ...idle, dt: .05, enabled: true, aiming: true });
  expect(hood.rotation.z).toBeLessThan(-.25);
  for (let i = 0; i < 60; i++) m.update({ ...idle, dt: .05, enabled: true });
  expect(Math.abs(hood.rotation.z)).toBeLessThan(.02);
  expect(arm.position.y).toBeLessThan(.02);
});

it('the twin Mirage turrets and the Cyclone turret follow the simulated aim from their export headings', () => {
  for (const [id, names] of [['mirage-1706', ['cad-turret-left-pivot', 'cad-turret-right-pivot']], ['cyclone-1987', ['cad-turret-pivot']]] as const) {
    const { turret, m, root } = build(id);
    const pivots = names.map(n => root.getObjectByName(n)!);
    turret.rotation.y = 0; m.update({ ...idle, dt: .05, enabled: true, aiming: true });
    const base = pivots.map(p => p.rotation.y);
    turret.rotation.y = .6; m.update({ ...idle, dt: .05, enabled: true, aiming: true });
    pivots.forEach((p, i) => expect(p.rotation.y - base[i]).toBeCloseTo(.6, 6));
  }
});
