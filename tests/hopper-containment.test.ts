import { expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import type { RobotCommand } from '../src/engine/robot/robot';

const season = () => SEASONS.find(s => s.id === '2026-rebuilt')!;
const robots = () => [
  { id: 'default', config: season().robotDefaults },
  ...(season().robotPresets ?? []).map((p: any) => ({ id: `preset-${p.id ?? p.name}`, config: p.config ?? p })),
  ...(season().teamRobots ?? []).map(t => ({ id: `team-${t.team}`, config: t.config })),
];
/** Drive, brake hard, reverse, strafe both ways, spin: the moves that slosh a pile. */
const profile = (f: number): RobotCommand => {
  const ph = Math.floor(f / 30) % 6;
  return { ...IDLE_COMMAND, vx: [1, 0, -1, 0, 0, 0][ph] * 4, vy: [0, 0, 0, 1, -1, 0][ph] * 3, omega: ph === 5 ? 6 : 0 } as RobotCommand;
};

/** A full hopper, parked then thrown around, never has a held ball outside its walls or sunk through its floor. */
it('every FUEL robot keeps its stowed balls inside the hopper while driving', async () => {
  await RAPIER.init();
  const bad: string[] = [], tol = 0.02, p = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const { id, config } of robots()) {
    const cfg = cloneConfig(config);
    if (!(cfg.launcher.enabled && cfg.hopperCapacity > 1)) continue;
    const sim = new HeadlessSim(season(), RAPIER, { robot: cfg, alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
    try {
      const r = sim.robot; r.enabled = true; sim.load(r.config.hopperCapacity);
      let worst = 0, where = '';
      for (let k = 0; k < 210; k++) {
        const c = k < 30 ? IDLE_COMMAND : profile(k - 30);
        sim.step(c); sim.step(c);
        r.syncVisual(1 / 45); // what is drawn is what counts: a one-substep pop that the safety clamp undoes is not seen
        {
          const cav = r.fuelCavity(), t = r.body.translation(), rot = r.body.rotation();
          if (!cav || !r.bay) continue;
          q.set(rot.x, rot.y, rot.z, rot.w).invert();
          for (const i of r.bay.stowed) {
            const b = sim.pool.bodies[i].translation();
            p.set(b.x - t.x, b.y - t.y, b.z - t.z).applyQuaternion(q);
            const rb = sim.pool.colliderRadius * 0.93, e = 0.02; // the whole ball, not just its centre
            const over = { '-x': cav.min.x + rb - e - p.x, '+x': p.x + rb - cav.max.x - e, '-z': cav.min.z + rb - e - p.z, '+z': p.z + rb - cav.max.z - e,
              floor: cav.min.y - tol - p.y, roof: cav.open ? 0 : p.y + rb - cav.max.y - e };
            for (const [side, d] of Object.entries(over)) if (d > worst) { worst = d; where = `${side} @frame ${k} ball ${i} lift ${(r.bay as any).floorLift?.toFixed(2)}`; }
          }
        }
      }
      if (worst > 0) bad.push(`${id}: ${worst.toFixed(3)} m outside ${where}`);
    } finally { sim.dispose(); }
  }
  expect(bad).toEqual([]);
}, 120000);
