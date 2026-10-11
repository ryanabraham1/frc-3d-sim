import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { netPair, drive } from './helpers/netPair';

beforeAll(async () => { await RAPIER.init(); });

it.each([0, 120, 300, 600])('keeps a moving guest smooth through a %i ms snapshot stall and recovery burst', (stall) => {
  const p = netPair({
    seasonId: '2025-reefscape', latencyMs: 40, local: true, pose: { x: 2, y: 1, yaw: 0 },
    snapshotDelayMs: (now) => now >= 2000 && now < 2400 ? stall : 0,
  });
  try {
    p.run(1);
    const snaps = p.predictor.snaps;
    let previous = p.clientSim.robot.body.translation().x;
    let smallestStep = 0, largestStep = 0, largestOffset = 0;
    for (let k = 0; k < 280; k++) {
      p.step(drive(1.5));
      p.predictor.decayOffset(1 / 90);
      const r = p.clientSim.robot;
      r.syncVisual(1 / 90, 1);
      r.visual.position.x += p.predictor.offX;
      const x = r.visual.position.x;
      smallestStep = Math.min(smallestStep, x - previous);
      largestStep = Math.max(largestStep, x - previous);
      largestOffset = Math.max(largestOffset, Math.abs(p.predictor.offX));
      previous = x;
    }
    expect(p.predictor.snaps).toBe(snaps);
    expect(smallestStep).toBeGreaterThan(-0.0001);
    expect(largestStep).toBeLessThan(0.025);
    expect(largestOffset).toBeLessThan(0.02);
    p.run(2);
    const c = p.clientSim.robot.body.translation(), h = p.hostSim.robot.body.translation();
    expect(Math.hypot(c.x - h.x, c.z - h.z)).toBeLessThan(0.03);
  } finally { p.dispose(); }
});
