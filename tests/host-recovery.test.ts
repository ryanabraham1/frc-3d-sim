import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HeadlessSim } from '../src/engine/testing/headless';
import { getSeason } from '../src/seasons';
import { bodyState, capturePilot, restoreBody, restorePilot, compressCheckpoint, decompressCheckpoint } from '../src/engine/net/recovery';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { MAX_FRAME_BYTES } from '../src/engine/net/relayProtocol';
import { Game } from '../src/engine/core/game';

beforeAll(() => RAPIER.init());

function world(id: string) {
  const season = getSeason(id);
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: season.startPose('blue', 2) });
  sim.rules.stage();
  sim.ctx.clock.start();
  return sim;
}

// Exercise the same checkpoint implementation as Game without requiring a renderer.
function source(sim: HeadlessSim) {
  return { season: sim.season, rules: sim.rules, pool: sim.pool, robots: sim.ctx.robots,
    clock: sim.ctx.clock, score: sim.ctx.score, rng: sim.rng,
    state: 'running', pausedFrom: 'running', countdown: 0, simTime: 2, results: null,
    autoPilots: new Map(), botPilots: new Map() };
}

describe('authority recovery checkpoints', () => {
  for (const id of ['2026-rebuilt', '2025-reefscape', '2024-crescendo', 'wcp-hero-heist']) {
    it(`${id}: preserves inventory, rule queues, velocities, score, clock and random sequence`, async () => {
      const host = world(id);
      const backup = world(id);
      try {
        host.robot.enabled = true;
        host.run(0.25, { ...IDLE_COMMAND, vx: 1 });
        host.rules.humanPlayerAction('blue', 1);
        const piece = host.pool.indices('field')[0];
        host.pool.hold(piece, host.robot.id);
        host.robot.held.push(piece);
        host.robot.fireCooldown = 0.37;
        host.ctx.score.add('blue', 'test', 7);
        host.ctx.clock.advance(2);
        host.rng.next();
        const checkpoint = JSON.parse(JSON.stringify(Game.prototype.recoveryState.call(source(host) as unknown as Game)));
        const compressed = await compressCheckpoint(JSON.stringify(checkpoint));
        expect(await decompressCheckpoint(compressed)).toEqual(checkpoint);
        expect(JSON.stringify(compressed).length).toBeLessThan(JSON.stringify(checkpoint).length / 2);
        expect(Buffer.byteLength(JSON.stringify({ op: 'checkpoint', data: checkpoint }))).toBeLessThan(MAX_FRAME_BYTES - 20000);
        backup.ctx.clock.restore(checkpoint.clock);
        backup.ctx.score.restore(checkpoint.score);
        backup.rng.restore(checkpoint.rng);
        backup.robot.bay?.clear();
        backup.pool.restoreRecovery(checkpoint.pool);
        backup.rules.restoreRecovery!(checkpoint.rules);
        restoreBody(backup.robot.body, checkpoint.robots[0].body);
        backup.robot.restoreRecovery(checkpoint.robots[0].fields);
        expect(backup.robot.held).toEqual(host.robot.held);
        expect(backup.robot.held).not.toContain(-1);
        expect(backup.robot.fireCooldown).toBe(0.37);
        expect(backup.pool.owner).toEqual(host.pool.owner);
        expect(backup.pool.state).toEqual(host.pool.state);
        expect(backup.ctx.clock.snapshot()).toEqual(host.ctx.clock.snapshot());
        expect(backup.ctx.score.snapshot()).toEqual(host.ctx.score.snapshot());
        expect(backup.rules.recoveryState!()).toEqual(host.rules.recoveryState!());
        const { colliders: _hostHopperWalls, ...hostBody } = bodyState(host.robot.body);
        const { colliders: _backupHopperWalls, ...backupBody } = bodyState(backup.robot.body);
        expect(backupBody).toEqual(hostBody);
        expect(backup.rng.next()).toEqual(host.rng.next());
        const before = backup.robot.body.translation().x;
        backup.step({ ...IDLE_COMMAND, vx: 1 });
        expect(backup.robot.body.translation().x).not.toBe(before);
        expect(backup.pool.owner[piece]).toBe(backup.robot.id);
      } finally { host.dispose(); backup.dispose(); }
    });
  }

  it('restores AUTO progress without replacing executable strategy or world references', () => {
    const strategy = { score: () => IDLE_COMMAND };
    const original = { phase: 'return', visited: new Set([2, 3]), timer: Infinity, strategy };
    const replica = { phase: 'idle', visited: new Set<number>(), timer: 0, strategy };
    const state = JSON.parse(JSON.stringify(capturePilot(original)));
    expect(state).not.toHaveProperty('strategy');
    restorePilot(replica, state);
    expect(replica.phase).toBe('return');
    expect(replica.visited).toEqual(new Set([2, 3]));
    expect(replica.timer).toBe(Infinity);
    expect(replica.strategy).toBe(strategy);
    expect(replica.strategy.score()).toBe(IDLE_COMMAND);
  });
});
