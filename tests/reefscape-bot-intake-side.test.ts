import { beforeAll, expect, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import { runMatch } from '../src/engine/testing/match';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { SEASONS } from '../src/seasons';
import * as C from '../src/seasons/2025-reefscape/constants';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
const season = SEASONS.find((s) => s.id === '2025-reefscape')!;

// 2910 collects at its FRONT (claw); the bot used to dock back-first at the CORAL STATION and, once the human player ran
// out of CORAL, parked there instead of picking the loose CORAL off the carpet.
it('front-intake 2910 docks facing the station and keeps working after the station runs dry', () => {
  const model = 'spectre-2910', archetypes = { 1: model, 2: model, 3: model };
  const settings = { ...defaultSettings(season), seed: 2, aiDifficulty: 'normal' as const, aiAlly: { skill: 'normal' as const, archetypes }, aiOpponent: { archetypes } };
  const idle = new Map<number, number>();
  let facing = 0, docked = 0;
  const res = runMatch(season, R, settings, { playerBot: true, onStep: (sim) => {
    if (sim.ctx.clock.mode !== 'teleop') return;
    for (const r of sim.ctx.robots) {
      const st = C.stations(r.alliance).find((p) => Math.hypot(p.x - r.pose.x, p.y - r.pose.y) < 1.0);
      if (st && r.speed < 0.08) { docked++; if (Math.cos(r.pose.yaw - st.yaw) < -0.7) facing++; }
      const near = C.stations(r.alliance).some((p) => Math.hypot(p.x - r.pose.x, p.y - r.pose.y) < 1.3);
      idle.set(r.id, near && r.held.length === 0 && r.speed < 0.08 ? (idle.get(r.id) ?? 0) + sim.physics.dt : 0);
    }
  } });
  expect(docked).toBeGreaterThan(0);
  expect(facing / docked).toBeGreaterThan(0.4);
  for (const pts of res.robotPoints) expect(pts).toBeGreaterThan(40);
  expect(Math.max(...idle.values())).toBeLessThan(30);
}, 300_000);
