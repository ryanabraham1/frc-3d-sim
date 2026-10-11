import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GROUPS, PhysicsWorld } from '../src/engine/physics/world';
import { FieldFrame } from '../src/engine/coords';
import { FieldBuilder } from '../src/engine/field/builder';
import { addHubCadColliders, HUB_CAD, hubToField } from '../src/seasons/2026-rebuilt/hubCad';
import { fuelCrossedHubFunnel } from '../src/seasons/2026-rebuilt/hubStructure';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { side } from '../src/seasons/2026-rebuilt/field';

beforeAll(async () => { await RAPIER.init(); });

/** One HUB's CAD collision in an empty world. */
function hubWorld(alliance: 'blue' | 'red') {
  const physics = new PhysicsWorld(RAPIER);
  const frame = new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH);
  const b = new FieldBuilder(physics, new THREE.Scene(), frame);
  const c = side(alliance, C.HUB_CENTER.x, C.HUB_CENTER.y);
  addHubCadColliders(b, alliance, c);
  b.carpet(0x333333);
  physics.step();
  return { physics, frame, c };
}
const ray = (w: ReturnType<typeof hubWorld>, from: [number, number, number], dir: [number, number, number], len: number, groups = GROUPS.piece) =>
  w.physics.world.castRay(new RAPIER.Ray(w.frame.toWorld(...from), w.frame.velToWorld(...dir)), len, true, undefined, groups);

for (const alliance of ['blue', 'red'] as const) {
  it(`${alliance} CAD hub: solid body faces, an exit slot in the NEUTRAL ZONE face, and an open funnel`, () => {
    const w = hubWorld(alliance);
    try {
      const at = (u: number, v: number, z: number) => hubToField(alliance, w.c, u, v, z);
      const toward = (u: number, v: number): [number, number, number] => { const p = at(u, v, 0), o = at(0, 0, 0); return [p[0] - o[0], p[1] - o[1], 0]; };
      // Side and alliance faces are closed at mid height (robots and FUEL hit them).
      expect(ray(w, at(0, 1.0, 0.5), toward(0, -1), 0.6, GROUPS.robot)).not.toBeNull();
      expect(ray(w, at(-1.0, 0, 0.5), toward(1, 0), 0.6, GROUPS.robot)).not.toBeNull();
      // NEUTRAL ZONE face: solid below the slot, open through it.
      expect(ray(w, at(1.0, 0.25, 0.4), toward(-1, 0), 0.5)).not.toBeNull();
      expect(ray(w, at(1.0, 0.25, (HUB_CAD.exitBottom + HUB_CAD.exitTop) / 2), toward(-1, 0), 0.38)).toBeNull();
      // Straight down the middle of the funnel there is nothing until the internal ramp.
      const hit = ray(w, at(0, 0, 2.2), [0, 0, -1], 2.2);
      expect(hit).not.toBeNull();
      expect(2.2 - hit!.timeOfImpact).toBeLessThan(HUB_CAD.funnelBaseZ - 0.1);
    } finally { w.physics.free(); }
  });

  it(`${alliance} CAD hub: a ball dropped into the opening passes the funnel base, one dropped beside it doesn't`, () => {
    const w = hubWorld(alliance);
    try {
      const drop = (u: number, v: number) => {
        const p = w.frame.toWorld(...hubToField(alliance, w.c, u, v, C.HUB_RIM_HEIGHT + 0.2));
        const ball = w.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true));
        w.physics.world.createCollider(RAPIER.ColliderDesc.ball(C.FUEL_DIAMETER / 2).setCollisionGroups(GROUPS.piece).setRestitution(0.4), ball);
        let crossed = false, last = Infinity;
        for (let i = 0; i < 180; i++) {
          w.physics.step();
          const f = w.frame.toField(ball.translation());
          const local = alliance === 'blue' ? [f.x - w.c.x, f.y - w.c.y] : [w.c.x - f.x, w.c.y - f.y];
          if (fuelCrossedHubFunnel(last, f.z, local[0], local[1], C.FUEL_DIAMETER / 2)) crossed = true;
          last = f.z;
        }
        return crossed;
      };
      expect(drop(0, 0)).toBe(true);
      expect(drop(0.15, -0.1)).toBe(true); // off centre: rolls down a funnel side into the opening
      expect(drop(0.0, 0.58)).toBe(false); // on the body's top edge, outside the opening
    } finally { w.physics.free(); }
  });
}

it('the crossing test needs a downward pass through the opening', () => {
  const r = 0.075, z0 = HUB_CAD.funnelBaseZ - r;
  expect(fuelCrossedHubFunnel(z0 + 0.05, z0 - 0.01, 0, 0, r)).toBe(true);
  expect(fuelCrossedHubFunnel(z0 - 0.01, z0 + 0.05, 0, 0, r)).toBe(false); // going up
  expect(fuelCrossedHubFunnel(z0 + 0.05, z0 - 0.01, HUB_CAD.funnelHalfX + 0.01, 0, r)).toBe(false); // outside
  expect(fuelCrossedHubFunnel(-Infinity, z0 - 0.01, 0, 0, r)).toBe(false); // no history yet
});
