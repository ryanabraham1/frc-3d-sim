import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUPS, PhysicsWorld } from '../src/engine/physics/world';
import { FieldFrame } from '../src/engine/coords';
import { FieldBuilder } from '../src/engine/field/builder';
import { buildHubFunnelAndNet } from '../src/seasons/2026-rebuilt/hubStructure';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });
it('both hubs have an open funnel and three flexible nets', () => {
  for (const alliance of ['blue', 'red'] as const) {
    const physics = new PhysicsWorld(RAPIER);
    const b = new FieldBuilder(physics, new THREE.Scene(), new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH));
    const nets = buildHubFunnelAndNet(b, alliance, C.HUB_CENTER);
    // The six funnel panels collide; the nets are NetSheets (they catch pieces themselves), not rigid colliders.
    expect(physics.world.colliders.len()).toBe(6);
    expect(nets).toHaveLength(3);
    const panels = b.root.children.filter(o => o.name.includes('funnel-panel'));
    expect(panels).toHaveLength(6);
    const bounds = new THREE.Box3();
    for (const p of panels) bounds.union(new THREE.Box3().setFromObject(p));
    expect(bounds.max.y).toBeCloseTo(C.HUB_RIM_HEIGHT, 5);
    expect(bounds.min.y).toBeCloseTo(C.HUB_CUP_FLOOR + 0.0508, 5);
    for (const name of ['rear', 'wing--1', 'wing-1']) expect(b.root.getObjectByName(`hub-${alliance}-net-${name}`)).toBeInstanceOf(THREE.LineSegments);
    physics.world.free();
  }
});

it('leaves the lower side frames open while retaining the upper rear nets on both alliances', () => {
  for (const alliance of ['blue', 'red'] as const) {
    const physics = new PhysicsWorld(RAPIER);
    const frame = new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH);
    const b = new FieldBuilder(physics, new THREE.Scene(), frame);
    buildHubFunnelAndNet(b, alliance, C.HUB_CENTER);
    physics.step(); // Update the query pipeline after creating the colliders.
    const forward = alliance === 'blue' ? 1 : -1;
    const half = C.HUB_SIZE / 2 + 3 * 0.0254;
    const rearX = C.HUB_CENTER.x + forward * (C.HUB_SIZE / 2 + 0.0254 - 0.1);
    for (const side of [-1, 1]) {
      const pole = b.root.getObjectByName(`hub-${alliance}-net-inclined-pole-${side}`) as THREE.Mesh<THREE.CylinderGeometry>;
      pole.updateWorldMatrix(true, false);
      const foot = frame.toField(pole.localToWorld(new THREE.Vector3(0, -pole.geometry.parameters.height / 2, 0)));
      // A front-corner attachment incorrectly stretches the frame over the
      // entire hub. Both alliances must leave the front quarter exposed.
      expect((foot.x - C.HUB_CENTER.x) * forward).toBeCloseTo(-C.HUB_SIZE / 4, 5);
      // Nothing solid across the lower side frame; the side net starts at the rim and covers the upper rear corner.
      const origin = frame.toWorld(rearX, C.HUB_CENTER.y + side * (half + 0.2), C.HUB_RIM_HEIGHT - 0.1);
      expect(physics.world.castRay(new RAPIER.Ray(origin, frame.velToWorld(0, -side, 0)), 0.3, true, undefined, GROUPS.piece)).toBeNull();
      const wing = new THREE.Box3().setFromObject(b.root.getObjectByName(`hub-${alliance}-net-wing-${side}`)!).expandByScalar(0.01); // flat: give it thickness
      expect(wing.min.y).toBeCloseTo(C.HUB_RIM_HEIGHT - 0.01, 5);
      expect(wing.max.y).toBeGreaterThan(C.HUB_RIM_HEIGHT + C.HUB_NET_HEIGHT - 0.15); // the triangle narrows to the rear post
      expect(wing.containsPoint(frame.toWorld(rearX, C.HUB_CENTER.y + side * half, C.HUB_RIM_HEIGHT + 0.3))).toBe(true);
    }
    const net = b.root.getObjectByName(`hub-${alliance}-net-rear`) as THREE.LineSegments;
    expect(new THREE.Box3().setFromObject(net).min.y).toBeCloseTo(C.HUB_RIM_HEIGHT, 5);
    physics.free();
  }
});

it('leaves rim and panel impacts unscored until the entire FUEL clears the throat', async () => {
  const { fuelInsideHubThroat, HUB_THROAT_Z } = await import('../src/seasons/2026-rebuilt/hubStructure');
  const radius = 0.075;
  expect(fuelInsideHubThroat(0, 0, C.HUB_RIM_HEIGHT - 0.02, radius)).toBe(false);
  expect(fuelInsideHubThroat(0.4, 0, HUB_THROAT_Z + radius, radius)).toBe(false);
  expect(fuelInsideHubThroat(0, 0, HUB_THROAT_Z, radius)).toBe(false);
  expect(fuelInsideHubThroat(0, 0, HUB_THROAT_Z - radius + 0.001, radius)).toBe(false);
  expect(fuelInsideHubThroat(0, 0, HUB_THROAT_Z - radius - 0.006, radius)).toBe(true);
});

it('a falling off-center shot rebounds inward from a funnel panel', () => {
  const physics = new PhysicsWorld(RAPIER);
  const frame = new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH);
  const b = new FieldBuilder(physics, new THREE.Scene(), frame);
  buildHubFunnelAndNet(b, 'blue', C.HUB_CENTER);
  const angle = Math.PI / 3;
  const pos = frame.toWorld(C.HUB_CENTER.x + 0.46 * Math.cos(angle), C.HUB_CENTER.y + 0.46 * Math.sin(angle), C.HUB_RIM_HEIGHT + 0.2);
  const ball = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true).setLinvel(0, -3, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.ball(0.075).setCollisionGroups(GROUPS.piece).setRestitution(0.6).setFriction(0.2), ball);
  let inwardBounce = false;
  for (let i = 0; i < 90; i++) {
    physics.step();
    const velocity = ball.linvel();
    const radialVelocity = velocity.x * Math.cos(angle) - velocity.z * Math.sin(angle);
    if (radialVelocity < -0.4 && -0.857 * radialVelocity + 0.515 * velocity.y > 0.1) inwardBounce = true;
  }
  expect(inwardBounce).toBe(true);
  physics.free();
});

it('a complete ball can enter below the throat before contacting the internal floor', async () => {
  const { fuelInsideHubThroat, HUB_SENSOR_FLOOR_Z, HUB_THROAT_Z } = await import('../src/seasons/2026-rebuilt/hubStructure');
  const physics = new PhysicsWorld(RAPIER);
  const frame = new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH);
  const b = new FieldBuilder(physics, new THREE.Scene(), frame);
  buildHubFunnelAndNet(b, 'blue', C.HUB_CENTER);
  b.box([C.HUB_CENTER.x, C.HUB_CENTER.y, HUB_SENSOR_FLOOR_Z / 2], [C.HUB_SIZE, C.HUB_SIZE, HUB_SENSOR_FLOOR_Z]);
  const radius = 0.075;
  const p = frame.toWorld(C.HUB_CENTER.x, C.HUB_CENTER.y, C.HUB_RIM_HEIGHT + 0.2);
  const ball = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true));
  physics.world.createCollider(RAPIER.ColliderDesc.ball(radius).setCollisionGroups(GROUPS.piece), ball);
  let collected = false;
  for (let i = 0; i < 180; i++) {
    physics.step();
    const f = frame.toField(ball.translation());
    const inside = fuelInsideHubThroat(f.x - C.HUB_CENTER.x, f.y - C.HUB_CENTER.y, f.z, radius);
    if (f.z + radius > HUB_THROAT_Z) expect(inside).toBe(false);
    if (inside) {
      expect(f.z + radius).toBeLessThan(HUB_THROAT_Z);
      collected = true;
      break;
    }
  }
  expect(collected).toBe(true);
  physics.free();
});
