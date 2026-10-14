import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CAD_2025_MODEL_IDS, decodeCadModel } from '../src/engine/robot/cadModels';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';

beforeAll(async () => {
  await RAPIER.init();
  for (const id of CAD_2025_MODEL_IDS) {
    const b = readFileSync(`public/models/robots/2025/${id}.glb`);
    await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
});

it('the 2025 CAD roster parks above the carpet and Citrus folds its climber inward', () => {
  for (const id of CAD_2025_MODEL_IDS) {
    const team = season.teamRobots!.find(t => t.id === id)!;
    const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(team.config), alliance: 'blue', pose: { x: 0, y: 0, yaw: 0 } });
    try {
      const r = sim.robot;
      for (let i = 0; i < 180; i++) r.syncVisual(1 / 60);
      r.visual.updateMatrixWorld(true);
      const root = r.visual.getObjectByName(`cad-${id}`)!;
      const inv = r.visual.matrixWorld.clone().invert();
      for (const part of root.children) {
        const box = new THREE.Box3();
        part.traverse(o => {
          if (!(o instanceof THREE.Mesh)) return;
          const pos = o.geometry.getAttribute('position');
          const matrix = inv.clone().multiply(o.matrixWorld), vertex = new THREE.Vector3();
          for (let j = 0; j < pos.count; j++) box.expandByPoint(vertex.fromBufferAttribute(pos, j).applyMatrix4(matrix));
        });
        expect(box.min.y, `${id} ${part.name} floor clearance`).toBeGreaterThan(-.01);
        if (id === 'sublime-1678' && part.name === 'cad-climber-pivot') {
          // The bad outward fold reached -0.604 m and left the gearbox below the side bumper.
          expect(box.min.z).toBeGreaterThan(-.50);
          expect(box.min.y).toBeGreaterThan(0);
        }
      }
    } finally { sim.dispose(); }
  }
});
