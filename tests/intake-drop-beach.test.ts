import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { getSeason } from '../src/seasons';
import { defaultSettings } from '../src/app/menu';
import { localSetup } from '../src/engine/core/game';
import { MatchWorld } from '../src/engine/core/matchWorld';
import { MatchSim, botSettings } from '../src/engine/core/matchSim';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { loadCad2026 } from './helpers/cad2026';

beforeAll(() => RAPIER.init());

// 2910's intake folds in while it shoots: FUEL the rollers were still pulling in used to be let go as field balls inside
// the chassis, where the collider pushed the robot up onto them (beached). They now drop into the hopper.
it('FUEL let go by a folding intake never lands under the robot', async () => {
  await loadCad2026();
  const season = getSeason('2026-rebuilt');
  for (const id of ['reblitz-2910', 'limestone-1678']) {
    const settings = { ...defaultSettings(season), seed: 4 };
    settings.robot = cloneConfig(season.teamRobots!.find(t => t.config.model === id)!.config);
    const setup = localSetup(settings, season);
    setup.robots = setup.robots.slice(0, 1);
    const w = new MatchWorld(RAPIER, season, setup, { scene: new THREE.Scene(), playerId: setup.robots[0].id, realHopper: () => true, hopperMode: 'stowbay', pieceFlow: true, optimize: false, aiSettings: botSettings(setup, settings) }, { toast() {}, cue() {}, humanPlayerIsAuto: () => true });
    try {
      const sim = new MatchSim(w, season, settings, { periodChange() {}, results() {} });
      const r = w.player!, pool = w.pool;
      r.shootWhileTracking = true;
      sim.state = 'running';
      w.rules.onPeriodChange(w.clock.start());
      const free = pool.indices('reserve'), p0 = r.pose;
      let n = 0;
      for (let a = 0; a < 8; a++) for (let b = 0; b < 6; b++) pool.placeField(free[n++], p0.x - 0.8 - a * 0.17, p0.y - 0.45 + b * 0.18);
      const released: THREE.Vector3[] = [];
      const release = pool.releaseToField.bind(pool);
      pool.releaseToField = (k: number) => {
        const p = pool.position(k), t = r.body.translation(), q = r.body.rotation();
        released.push(new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert()));
        release(k);
      };
      let maxY = 0;
      for (let i = 0; i < 10 / sim.dt; i++) {
        const t = i * sim.dt;
        sim.step(sim.dt, { command: () => ({ ...IDLE_COMMAND, shoot: t > 3.5 && t < 7 || t > 9, vx: t < 3.5 ? -1.2 : t < 7 ? 0 : -0.8, intake: t < 9 }), humanPlayer: [] });
        if (i % 2 === 0) r.syncVisual(2 * sim.dt);
        maxY = Math.max(maxY, r.body.translation().y);
      }
      const fp = r.footprint;
      for (const p of released) expect(Math.abs(p.x) < fp.length / 2 && Math.abs(p.z) < fp.width / 2, `${id} released at ${p.toArray()}`).toBe(false);
      expect(maxY, id).toBeLessThan(0.04);
    } finally { w.free(); }
  }
}, 60000);
