import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel, CAD_2024_MODEL_IDS, CAD_2025_MODEL_IDS, CAD_MODEL_IDS, HERO_CAD_MODEL_IDS } from '../src/engine/robot/cadModels';
import { SEASONS } from '../src/seasons';
import { Robot } from '../src/engine/robot/robot';
import { PhysicsWorld } from '../src/engine/physics/world';
import { FieldFrame } from '../src/engine/coords';
import { cloneConfig } from '../src/engine/robot/config';
import { RobotMirror } from '../src/engine/sim/robotMirror';

beforeAll(() => RAPIER.init());
it('match CAD preserves 2025 detail and keeps each articulated scene compatible with its original', async () => {
  const report = JSON.parse(readFileSync('public/models/robots/match-cad-report.json', 'utf8')) as { id: string; year: string; before: number; after: number }[];
  for (const year of ['2024', '2025', '2026', 'wcp-hero-heist']) {
    const rows = report.filter(r => r.year === year);
    const before = rows.reduce((n, r) => n + r.before, 0), after = rows.reduce((n, r) => n + r.after, 0);
    if (year === '2025') expect(after).toBe(before);
    else expect(after).toBeLessThan(before * .6);
  }
  for (const id of [...CAD_2024_MODEL_IDS, ...CAD_2025_MODEL_IDS, ...CAD_MODEL_IDS, ...HERO_CAD_MODEL_IDS]) {
    if (id === 'hero-multiclass-5800-gadgeteer') continue;
    const season = SEASONS.find(s => s.teamRobots?.some(t => t.id === id));
    if (!season) continue;
    const cfg = cloneConfig(season.teamRobots!.find(t => t.id === id)!.config);
    const row = report.find(r => r.id === id)!;
    expect(row, id).toBeDefined();
    const fingerprints: string[] = [];
    for (const subdir of ['', 'match/']) {
      const b = readFileSync(`public/models/robots/${row.year}/${subdir}${id}.glb`);
      await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const physics = new PhysicsWorld(RAPIER);
      try {
        const robot = new Robot(physics, new THREE.Scene(), new FieldFrame(0, 0), cloneConfig(cfg), 'blue', 0, 1, { x: 0, y: 0, yaw: 0 });
        season.configureRobot?.(robot);
        robot.optimizeVisual();
        fingerprints.push(new RobotMirror(robot).shape);
      } finally { physics.world.free(); }
    }
    expect(fingerprints[1], id).toBe(fingerprints[0]);
  }
}, 120000);
