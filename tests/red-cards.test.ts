import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance } from '../src/engine/coords';
import { Referee } from '../src/engine/match/referee';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { crescendo2024 } from '../src/seasons/2024-crescendo';
import { reefscape2025 } from '../src/seasons/2025-reefscape';
import { rebuilt2026 } from '../src/seasons/2026-rebuilt';

beforeAll(async () => { await RAPIER.init(); });
const sims: HeadlessSim[] = [];
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

describe.each([crescendo2024, reefscape2025, rebuilt2026])('$id red cards', (season) => {
  it.each([
    ['blue', 'direct'], ['red', 'direct'],
    ['blue', 'second yellow'], ['red', 'second yellow'],
  ] as const)('%s robot keeps driving after a %s card', (alliance: Alliance, reason) => {
    const sim = new HeadlessSim(season, RAPIER, {
      robot: cloneConfig(season.robotDefaults), alliance, pose: { x: 3, y: 2, yaw: 0 },
    });
    sims.push(sim);
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(25)) sim.rules.onPeriodChange(change);
    const ref = (sim.rules as typeof sim.rules & { ref: Referee }).ref;
    const call = { rule: ref.rules.tip, kind: 'major' as const, robot: sim.robot, note: 'test violation' };
    if (reason === 'second yellow') ref.call({ ...call, card: 'yellow' });
    ref.call({ ...call, card: reason === 'direct' ? 'red' : 'yellow' });
    expect(sim.ctx.score.cardsFor(sim.robot.id, 'red')).toBe(1);
    const opponent = alliance === 'blue' ? 'red' : 'blue';
    expect(sim.ctx.score.foulPointsFor(opponent)).toBe(season.foulValues.major * (reason === 'direct' ? 1 : 2));
    const startX = sim.robot.pose.x;
    for (let step = 0; step < 45; step++) sim.step({ ...IDLE_COMMAND, vx: 3 });
    expect(sim.robot.enabled).toBe(true);
    expect(sim.robot.pose.x).toBeGreaterThan(startX + 0.1);
  });
});
