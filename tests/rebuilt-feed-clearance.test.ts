import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { CAD_MODEL_IDS, CAD_DONOR_DEPENDENCIES, decodeCadModel, setCadModelsEnabled } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { cloneConfig, launcherExitOffsets } from '../src/engine/robot/config';
import { FuelContacts } from '../src/engine/robot/fuelContacts';
import { PieceFlow } from '../src/engine/robot/pieceFlow';

const radius = .075;
const make = () => new THREE.Mesh(new THREE.SphereGeometry(radius), new THREE.MeshBasicMaterial());
const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
const pose = (hood: number): RobotAnimState => ({ dt: 0, time: 0, enabled: true, intaking: false, firing: 1, passing: false, aiming: true, hood, fill: .8, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 });
beforeAll(async () => {
  const ids = new Set<string>(CAD_MODEL_IDS);
  for (const dependencies of Object.values(CAD_DONOR_DEPENDENCIES)) for (const id of dependencies) ids.add(id);
  for (const id of ids) {
    const bytes = readFileSync(`public/models/robots/2026/${id}.glb`);
    await decodeCadModel(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
}, 30000);
afterAll(() => setCadModelsEnabled(true));

it('a conveyor cannot tunnel through a wheel or wall when its requested staging point is beyond it', () => {
  for (const geometry of [new THREE.BoxGeometry(.03, 1, 1), new THREE.CylinderGeometry(.15, .15, .8, 32)]) {
    const visual = new THREE.Group();
    const wheel = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    wheel.name = 'powered-flywheel'; wheel.position.y = .5;
    if (geometry.type === 'CylinderGeometry') wheel.rotation.x = Math.PI / 2;
    visual.add(wheel);
    const contacts = new FuelContacts(visual, visual, true);
    const flow = new PieceFlow(visual, make, { intake: () => [], feed: () => [new THREE.Vector3(-.4, .5, 0), new THREE.Vector3(.4, .5, 0)] }, true, radius, contacts);
    for (let i = 0; i < 60; i++) {
      flow.update(1 / 20, 3, .1, false, true);
      const ball = visual.children.find(o => o.userData.flowToken && o.visible)!;
      expect(ball.position.x).toBeLessThan(0);
      expect(contacts.penetration(ball.position, radius)).toBeLessThan(.001);
      const queue = visual.children.filter(o => o.userData.flowToken && o.visible);
      for (let j = 1; j < queue.length; j++) expect(queue[j].position.distanceTo(queue[j - 1].position), 'blocked lanes retain ball spacing').toBeGreaterThan(radius * 1.9);
    }
    flow.dispose();
  }
});

for (const cad of [false, true]) {
  for (const team of season.teamRobots!) {
    it(`${team.id}: ${cad ? 'CAD' : 'procedural'} staging remains clear of real robot surfaces`, () => {
      setCadModelsEnabled(cad);
      const visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
      const config = cloneConfig(team.config);
      const model = robotModelBuilder(config.model)!({ config, visual, turret, alliance: 'blue', fp: { length: config.frameLength + .16, width: config.frameWidth + .16 }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshBasicMaterial(), alu: new THREE.MeshBasicMaterial(), bumper: new THREE.MeshBasicMaterial() } });
      const feed = (lane: number) => {
        const custom = model.flow?.feed?.(lane);
        if (custom) return custom;
        // These two procedural fallback builders rely on Robot's default conveyor.
        const side = launcherExitOffsets(config)[lane];
        const forward = config.frameLength * ((config.launcher.exits ?? 1) > 1 ? .4 : .18);
        const up = (config.launcher.exitInside ? config.launcher.height : Math.max(config.launcher.height, config.height)) + radius + (config.launcher.exitInside ? .01 : .03);
        const top = up - radius - .04;
        return [new THREE.Vector3(-config.frameLength * .05, config.bumperTop + radius + .02, -side), new THREE.Vector3(forward - .1, (config.bumperTop + top) / 2, -side), new THREE.Vector3(forward, top, -side)];
      };
      model.update(pose(1.05));
      if (cad && model.flow?.feed) {
        const before = feed(0).map(p => p.clone());
        const wheels: { object: THREE.Object3D; rotation: THREE.Euler }[] = [];
        visual.traverse(o => {
          if (/^cad-flywheel(?:-.*)?-pivot$/.test(o.name)) { wheels.push({ object: o, rotation: o.rotation.clone() }); o.rotation.x += .37; o.rotation.z += 1.23; }
        });
        if (wheels.length) for (const [i, p] of feed(0).entries()) expect(p.distanceTo(before[i]), `${team.id} feed must ignore wheel spin`).toBeLessThan(1e-6);
        for (const wheel of wheels) wheel.object.rotation.copy(wheel.rotation);
      }
      const contacts = new FuelContacts(visual, visual, true);
      const flow = new PieceFlow(visual, make, { intake: () => [], feed, lanes: launcherExitOffsets(config).length }, true, radius, contacts);
      let worst = 0;
      let drawn = 0;
      for (let i = 0; i < 90; i++) {
        if (i % 30 === 0) { flow.clear(0); model.update(pose([.55, 1.05, 1.3][i / 30])); }
        flow.update(1 / 30, launcherExitOffsets(config).length * 2, .1, false, true);
        drawn += visual.children.filter(o => o.userData.flowToken && o.visible).length;
        for (const ball of visual.children.filter(o => o.userData.flowToken && o.visible)) worst = Math.max(worst, contacts.penetration(ball.position, radius));
      }
      expect(drawn, `${team.id} draws staged fuel`).toBeGreaterThan(0);
      expect(worst, `${team.id} residual overlap`).toBeLessThan(.0015);
      flow.dispose();
      const intakePoints = model.flow?.intake?.() ?? [new THREE.Vector3(-config.frameLength * .5, config.bumperTop + radius, 0), new THREE.Vector3(-config.frameLength * .2, config.bumperTop + radius, 0)];
      const intake = new PieceFlow(visual, make, { intake: () => intakePoints }, true, radius, contacts);
      intake.update(1/60,0,.1);
      const capture = intakePoints[0].clone(); capture.x -= .3; capture.y = radius;
      intake.noteCapture(capture);
      let intakeDrawn = 0, intakeOverlap = 0;
      for (let i=0; i<120; i++) {
        intake.update(1/60,1,.1);
        for (const ball of visual.children.filter(o=>o.userData.flowToken && o.visible)) {
          intakeDrawn++;
          intakeOverlap=Math.max(intakeOverlap,contacts.penetration(ball.position,radius));
        }
      }
      expect(intakeDrawn, `${team.id} draws intake fuel`).toBeGreaterThan(0);
      expect(intakeOverlap, `${team.id} intake surface and roof overlap`).toBeLessThan(.0015);
      intake.dispose();
    }, 30000);
  }
}

it('contacts the actual sloped ceiling height field even when retention fabric is rendered as lines', () => {
  const visual=new THREE.Group(), net=new THREE.Group(); visual.add(net);
  net.userData.fuelBin={x:0,y0:0,length:1,width:1,height:.5};
  net.userData.fuelCeiling=(x:number)=>.5+.3*x;
  const contacts=new FuelContacts(visual,visual,true); contacts.sync();
  const p=new Float32Array([0,.55,0]),v=new Float32Array([0,1,0]);
  contacts.resolve(p,v,0,radius);
  const position=new THREE.Vector3().fromArray(p);
  expect(contacts.penetration(position,radius)).toBeLessThan(.001);
  expect(position.y).toBeLessThan(.5-radius);
  expect(v[1]).toBeLessThan(1);
});
