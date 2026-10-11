import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion } from 'three';
import { HeadlessSim } from '../src/engine/testing/headless';
import { Predictor } from '../src/engine/net/prediction';
import { cloneConfig } from '../src/engine/robot/config';
import { getSeason } from '../src/seasons/index';

beforeAll(async () => { await RAPIER.init(); });

it.each([0, 0.2, 0.8, 1])('keeps the drawn robot continuous when reconciliation arrives between physics steps (alpha=%s)', (alpha) => {
  const season = getSeason('2026-rebuilt');
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    const r = sim.robot, p = new Predictor(r);
    r.enabled = true;
    p.onSnapshot(r.netState(0), 0, true);
    r.capturePrevPose();
    const t = r.body.translation();
    r.body.setTranslation({ ...t, x: t.x + 0.03 }, true);
    p.record(1000);
    r.syncVisual(0, alpha);
    const before = r.visual.position.clone();
    const beforeRotation = r.visual.quaternion.clone().normalize();
    const pose = r.netState(0);
    p.onSnapshot({ ...pose, x: pose.x + 0.15, z: pose.z + 0.04, yaw: pose.yaw + 0.06 }, 1000, true);
    expect(p.corrections).toBe(1);
    r.syncVisual(0, alpha);
    r.visual.position.x += p.offX;
    r.visual.position.z += p.offZ;
    r.visual.quaternion.premultiply(new Quaternion(0, Math.sin(p.offYaw / 2), 0, Math.cos(p.offYaw / 2)));
    // Before the easing clock advances, reconciliation must change physics without moving the picture.
    expect(r.visual.position.distanceTo(before)).toBeLessThan(0.00001);
    expect(r.visual.quaternion.clone().normalize().angleTo(beforeRotation)).toBeLessThan(0.0001);
  } finally { sim.dispose(); }
});
