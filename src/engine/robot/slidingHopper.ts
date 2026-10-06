import * as THREE from 'three';
import { fillBlock, hopperWalls, mat, type ModelKit } from './models';

/**
 * Sliding hopper extension (2026 REBUILT): most real robots had a hopper section that slides out over the deployed
 * intake and is pulled back by surgical tubing when the intake stows. It is part of the hopper, so it holds FUEL too:
 * a small loaded pile rides in it while it is out and the robot is carrying FUEL. Its pile counts toward the robot's real capacity (see Robot.fitCapacityToHopper). Call `set(deploy, fill)` (deploy 0 = stowed, 1 = intake down; fill 0-1) from the model's update.
 */
export function slidingHopper(k: ModelKit, o: { wall?: THREE.Material; frame?: THREE.Material; length?: number } = {}): { set(deploy: number, fill?: number): void } {
  const c = k.config, side = k.groundSide;
  const len = o.length ?? 0.24;
  const h = (c.height - c.bumperTop - 0.04) * 0.82;
  const x = side * (c.frameLength / 2 - len / 2 - 0.01);
  const g = new THREE.Group();
  g.name = 'sliding-hopper';
  k.visual.add(g);
  hopperWalls(g, { x, y0: c.bumperTop + 0.02, length: len, width: c.frameWidth * 0.9, height: h, m: o.wall ?? mat(0xdde5f0, { opacity: 0.22, rough: 0.2 }), frame: o.frame ?? k.mats.dark });
  const pile = fillBlock(g, { x, y0: c.bumperTop + 0.03, length: len * 0.96, width: c.frameWidth * 0.86, height: h * 0.95, color: 0xf2c200, capacity: 8 });
  return {
    set(d, fill = 0) {
      g.position.x = side * d * 0.2;
      // FUEL rides in the extension once it is out; it drains back into the main hopper as it retracts.
      pile.set(d > 0.35 ? Math.min(1, fill) : 0);
    },
  };
}
