import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUPS, PhysicsWorld } from '../src/engine/physics/world';
import { FieldFrame } from '../src/engine/coords';
import { FieldBuilder } from '../src/engine/field/builder';
import { buildHubFunnelAndNet } from '../src/seasons/2026-rebuilt/hubStructure';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });
it('both hubs have an open funnel and three valid net collision surfaces', () => {
  for (const alliance of ['blue', 'red'] as const) {
    const physics = new PhysicsWorld(RAPIER);
    const b = new FieldBuilder(physics, new THREE.Scene(), new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH));
    buildHubFunnelAndNet(b, alliance, C.HUB_CENTER);
    expect(physics.world.colliders.len()).toBe(9);
    const panels = b.root.children.filter(o => o.name.includes('funnel-panel'));
    expect(panels).toHaveLength(6);
    const bounds = new THREE.Box3();
    for (const p of panels) bounds.union(new THREE.Box3().setFromObject(p));
    expect(bounds.max.y).toBeCloseTo(C.HUB_RIM_HEIGHT, 5);
    expect(bounds.min.y).toBeCloseTo(C.HUB_CUP_FLOOR + 0.0508, 5);
    expect(b.root.getObjectByName(`hub-${alliance}-net-mesh`)).toBeInstanceOf(THREE.LineSegments);
    physics.world.free();
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
