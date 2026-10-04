import * as THREE from 'three';
import { hopperWalls, mat, type ModelKit } from './models';

/**
 * Sliding hopper extension (2026 REBUILT): most real robots had a hopper section that slides out over the deployed
 * intake and is pulled back by surgical tubing when the intake stows. Visual only; capacity still comes from the
 * config. Call `set(deploy)` (0 = stowed, 1 = intake down) from the model's update.
 */
export function slidingHopper(k: ModelKit, o: { wall?: THREE.Material; frame?: THREE.Material; length?: number } = {}): { set(deploy: number): void } {
  const c = k.config, side = k.groundSide;
  const len = o.length ?? 0.24;
  const h = (c.height - c.bumperTop - 0.04) * 0.82;
  const g = new THREE.Group();
  g.name = 'sliding-hopper';
  k.visual.add(g);
  hopperWalls(g, { x: side * (c.frameLength / 2 - len / 2 - 0.01), y0: c.bumperTop + 0.02, length: len, width: c.frameWidth * 0.9, height: h, m: o.wall ?? mat(0xdde5f0, { opacity: 0.22, rough: 0.2 }), frame: o.frame ?? k.mats.dark });
  return { set: (d) => { g.position.x = side * d * 0.2; } };
}
