import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons/index';
import { PhysicsWorld } from '../src/engine/physics/world';
import { FieldFrame } from '../src/engine/coords';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND, Robot } from '../src/engine/robot/robot';

beforeAll(async () => { await RAPIER.init(); });

/**
 * Where every visible triangle is, independent of how meshes are split up: the sums of triangle centroids and of
 * their squares in world space. Merging static parts must not change it in any pose; a moving part that got baked
 * in would stay put and change it as soon as the mechanism moves.
 */
function geometrySignature(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const sum = [0, 0, 0, 0, 0, 0, 0];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
      sum[0] += x; sum[1] += y; sum[2] += z; sum[3] += x * x; sum[4] += y * y; sum[5] += z * z; sum[6]++;
    }
  });
  return sum;
}

function robotPair(season: typeof SEASONS[number], config: ReturnType<typeof cloneConfig>) {
  const make = (optimize: boolean) => {
    const physics = new PhysicsWorld(RAPIER);
    const robot = new Robot(physics, new THREE.Scene(), new FieldFrame(0, 0), cloneConfig(config), 'blue', 0, 1, { x: 0, y: 0, yaw: 0 });
    robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
    season.configureRobot?.(robot);
    const stats = optimize ? robot.optimizeVisual() : null;
    return { robot, physics, stats };
  };
  return [make(false), make(true)] as const;
}

/** The animation states a match goes through (same sequence as the probe, plus driving with pieces). */
function poses(r: Robot, step: number): void {
  const k = step % 9;
  r.enabled = k !== 0;
  r.lastCommand = { ...IDLE_COMMAND, intake: k === 1 || k === 7, shoot: k === 2, pass: k === 3 };
  r.climbPhase = k === 4 ? 'align' : k === 5 ? 'hanging' as typeof r.climbPhase : 'none';
  r.blockerDeploy = k === 6 ? 1 : 0;
  r.placeAnim = k === 3 ? { height: 1.7, forward: 0.6, level: 4, side: 0 } : k === 7 ? { height: 0.45, forward: 0.3, level: 1, handoff: 0.5 } : { height: 0.45, forward: 0.3, level: 1 };
  r.held.length = k >= 7 ? Math.max(0, r.config.hopperCapacity - 1) : 0;
  r.body.setLinvel({ x: k === 8 ? 2 : 0, y: 0, z: k === 8 ? 1 : 0 }, true);
  r.body.setAngvel({ x: 0, y: k === 8 ? 1.5 : 0, z: 0 }, true);
}

it('baking static robot parts keeps every team model looking and moving exactly the same, with far fewer meshes', () => {
  let checked = 0;
  for (const season of SEASONS) {
    for (const t of season.teamRobots ?? []) {
      const [plain, fast] = robotPair(season, t.config);
      const label = `${season.id}/${t.id}`;
      expect(fast.stats!.after, label).toBeLessThan(fast.stats!.before * 0.75);
      for (let step = 0; step < 36; step++) {
        for (const { robot } of [plain, fast]) {
          poses(robot, step);
          robot.syncVisual(0.05);
        }
        const a = geometrySignature(plain.robot.visual), b = geometrySignature(fast.robot.visual);
        expect(b[6], `${label} triangles @${step}`).toBe(a[6]);
        for (let i = 0; i < 6; i++) expect(b[i], `${label} sig[${i}] @${step}`).toBeCloseTo(a[i], 2);
      }
      plain.physics.free();
      fast.physics.free();
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(15);
});
