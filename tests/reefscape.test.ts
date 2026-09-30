import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { ALLIANCES, type Alliance } from '../src/engine/coords';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND, Robot } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { Scoreboard } from '../src/engine/match/scoreboard';
import { packCommand, unpackCommand } from '../src/engine/net/protocol';
import { SEASONS } from '../src/seasons';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import { ReefscapeRules } from '../src/seasons/2025-reefscape/rules';
import { reefscapeResults } from '../src/seasons/2025-reefscape/scoring';
import { normalizeReefscapeConfig, reefscapeRobotPresets } from '../src/seasons/2025-reefscape/config';
import * as C from '../src/seasons/2025-reefscape/constants';

const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });
function make(a: Alliance = 'blue', pose = season.startPose(a, 2), station = 2, robot = cloneConfig(season.robotDefaults)) {
  const sim = new HeadlessSim(season, RAPIER, { robot, alliance: a, pose, station });
  sims.push(sim); return sim;
}
function run(sim: HeadlessSim, seconds: number, command = IDLE_COMMAND) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
    sim.step(command);
  }
}
function teleop(sim: HeadlessSim) { sim.rules.onPeriodChange(sim.ctx.clock.start()); for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c); }
function load(sim: HeadlessSim, i: number) { sim.pool.hold(i, sim.robot.id); sim.robot.held.push(i); }

describe('2025 REEFSCAPE manual implementation', () => {
  it('registers both years and uses the manual match timing and scoring values', () => {
    expect(SEASONS.map((s) => s.year)).toEqual([2026, 2025, 2024]);
    expect(season.timeline.filter((p) => p.mode !== 'disabled').reduce((t, p) => t + p.duration, 0)).toBe(150);
    expect(season.foulValues).toEqual({ minor: 2, major: 6 });
  });
  for (const a of ALLIANCES) {
    it(`stages the complete 126 CORAL / 18 ALGAE supply for ${a}`, () => {
      const sim = make(a); sim.rules.stage();
      expect(sim.pool.count).toBe(144);
      expect(sim.pool.indices('field').filter((i) => i < 126)).toHaveLength(6);
      expect(sim.pool.indices('field').filter((i) => i >= 126)).toHaveLength(6);
      expect(sim.pool.indices('reserve').filter((i) => sim.pool.tag[i]?.startsWith('reef:'))).toHaveLength(12);
      expect(sim.robot.held).toHaveLength(1);
      expect(sim.pool.indices('reserve', `station:${a}`)).toHaveLength(59);
      expect(sim.pool.indices('reserve', `station:${a === 'blue' ? 'red' : 'blue'}`)).toHaveLength(60);
      expect(sim.pool.specAt(0).shape).toBe('tube');
      expect(sim.pool.radiusAt(126)).toBeCloseTo(0.206375);
    });
    it(`places each CORAL level on every ${a} face through the real mechanism loop`, () => {
      for (const [face, spot] of season.testing!.scoringSpots(a).entries()) for (let level = 1; level <= 4; level++) {
        const sim = make(a, spot); sim.rules.onPeriodChange(sim.ctx.clock.start()); load(sim, 0);
        run(sim, 2.4, { ...IDLE_COMMAND, shoot: true, scoringLevel: level });
        expect(sim.ctx.score.counter(a, `coralL${level}`), `face ${face} level ${level}`).toBe(1);
        expect(sim.ctx.score.total(a)).toBe(C.CORAL_AUTO[level]);
        expect((sim.rules as ReefscapeRules).placements[0].face).toBe(face);
      }
    });
    it(`prevents duplicate branches and allows multiple CORAL in ${a} L1`, () => {
      const sim = make(a, season.testing!.scoringSpots(a)[0]); teleop(sim);
      const rules = sim.rules as ReefscapeRules;
      for (let i = 0; i < 3; i++) { load(sim, i); run(sim, 2.0, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 }); }
      expect(sim.ctx.score.counter(a, 'coralL4')).toBe(2);
      expect(sim.robot.held).toHaveLength(1);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 1 });
      load(sim, 3); run(sim, 1, { ...IDLE_COMMAND, shoot: true, scoringLevel: 1 });
      expect(rules.placements).toHaveLength(4);
      expect(sim.ctx.score.category(a, 'teleopCoral')).toBe(14);
    });
    it(`requires reach and removes ${a} staged ALGAE before scoring its blocked branch`, () => {
      const spot = season.testing!.scoringSpots(a)[0]; const sim = make(a, spot);
      sim.rules.stage(); teleop(sim); const rules = sim.rules as ReefscapeRules;
      expect(rules.reefAlgae(a, 0)).toBe(true);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 3 });
      expect(sim.ctx.score.counter(a, 'coralL3')).toBe(0);
      run(sim, 1.5, { ...IDLE_COMMAND, intake: true, scoringLevel: 3 });
      expect(rules.reefAlgae(a, 0)).toBe(false);
      expect(sim.robot.held.filter((i) => i >= 126)).toHaveLength(1);
      run(sim, 1, { ...IDLE_COMMAND, shoot: true, scoringLevel: 3 });
      expect(sim.ctx.score.counter(a, 'coralL3')).toBe(1);
      sim.robot.resetTo(season.startPose(a, 2)); load(sim, 0);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
      expect(sim.ctx.score.counter(a, 'coralL4')).toBe(0);
    });
    it(`feeds ${a} ALGAE through the real processor and transfers it to the opponent`, () => {
      const p = C.processor(a); const sim = make(a, { x: p.x, y: p.y + (a === 'blue' ? 1.05 : -1.05), yaw: a === 'blue' ? -Math.PI / 2 : Math.PI / 2 });
      teleop(sim); load(sim, 126); run(sim, 1.6, { ...IDLE_COMMAND, pass: true, intake: true });
      expect(sim.ctx.score.counter(a, 'processor')).toBe(1);
      expect(sim.ctx.score.category(a, 'processor')).toBe(6);
      expect(sim.pool.tag[126]).toBe(`hp:${a === 'blue' ? 'red' : 'blue'}`);
    });
    it(`scores ${a} ALGAE net shots with real Rapier flight`, () => {
      const n = C.netCenter(a); const sim = make(a, { x: n.x + (a === 'blue' ? -2.1 : 2.1), y: n.y, yaw: a === 'blue' ? 0 : Math.PI });
      teleop(sim); load(sim, 126); run(sim, 3.0, { ...IDLE_COMMAND, shoot: true });
      expect(sim.ctx.score.counter(a, 'net')).toBe(1);
      expect(sim.ctx.score.category(a, 'net')).toBe(4);
      expect(sim.pool.tag[126]).toBe(`net:${a}:1`);
    });
    it(`throws processor ALGAE into ${a} NET only after AUTO`, () => {
      const sim = make(a); sim.rules.onPeriodChange(sim.ctx.clock.start());
      sim.pool.reserve(126, `hp:${a}`); sim.rules.humanPlayerAction(a);
      expect(sim.pool.state[126]).toBe('reserve');
      for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c);
      sim.rules.humanPlayerAction(a); run(sim, 3);
      expect(sim.ctx.score.counter(a, 'net')).toBe(1);
    });
    it(`retrieves and re-scores ${a} AUTO CORAL while preserving AUTO credit`, () => {
      const sim = make(a, season.testing!.scoringSpots(a)[0]); sim.rules.onPeriodChange(sim.ctx.clock.start()); load(sim, 0);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
      expect(sim.ctx.score.category(a, 'autoCoral')).toBe(7);
      for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c);
      run(sim, 2, { ...IDLE_COMMAND, descend: true, scoringLevel: 4 });
      expect(sim.ctx.score.category(a, 'autoCoral')).toBe(0);
      expect(sim.ctx.score.counter(a, 'autoCoral')).toBe(1);
      expect(sim.ctx.score.counter(a, 'coralL4')).toBe(0);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
      expect(sim.ctx.score.category(a, 'autoCoral')).toBe(7);
      expect(sim.ctx.score.category(a, 'teleopCoral')).toBe(0);
      expect(sim.ctx.score.counter(a, 'autoCoral')).toBe(1);
    });
    for (const station of [1, 2, 3]) it(`runs ${a} station ${station} AUTO leave + L4 with the real field`, () => {
      const sim = make(a, season.startPose(a, station), station); sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
      const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'reef-l4');
      for (let k = 0; k <= 15 * 90; k++) { for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch); sim.step(auto.update(sim.physics.dt)); }
      expect(sim.ctx.score.counter(a, 'coralL4')).toBe(1);
      expect(sim.ctx.score.counter(a, 'leave')).toBe(1);
      expect(sim.ctx.score.total(a)).toBe(10);
    });
    for (const level of [1, 2]) it(`climbs and assesses ${a} ${level === 1 ? 'shallow' : 'deep'} cage`, () => {
      const p = C.cage(a, 2); const sim = make(a, { x: p.x - 0.75, y: p.y, yaw: 0 }); sim.robot.config.climber.maxLevel = level;
      teleop(sim); sim.rules.requestClimb(sim.robot, level); run(sim, 6);
      expect(sim.robot.climbPhase).toBe('hanging');
      sim.rules.onPeriodChange({ from: season.timeline.at(-1)!, to: null, at: 156 });
      expect(sim.ctx.score.category(a, 'barge')).toBe(level === 1 ? 6 : 12);
      sim.rules.requestDescend(sim.robot); run(sim, 3); expect(sim.robot.isClimbing).toBe(false);
    });
  }
  it('enforces one CORAL and one ALGAE even with an oversized submitted hopper', () => {
    const sim = make('blue', { x: 2, y: 2, yaw: 0 }); sim.robot.config.hopperCapacity = 80;
    teleop(sim);
    for (const i of [0, 1, 126, 127]) sim.pool.placeField(i, 2.63, 2);
    run(sim, 0.2, { ...IDLE_COMMAND, intake: true });
    expect(sim.robot.held.filter((i) => i < 126)).toHaveLength(1);
    expect(sim.robot.held.filter((i) => i >= 126)).toHaveLength(1);
  });
  it('replicates placements, elevator state, reef ALGAE and scored visuals', () => {
    const host = make('blue', season.testing!.scoringSpots('blue')[0]); host.rules.stage(); teleop(host);
    run(host, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
    const client = make(); client.rules.applyNetState!(JSON.parse(JSON.stringify(host.rules.netState!())));
    client.ctx.score.restore(host.ctx.score.snapshot());
    for (let i = 0; i < host.pool.count; i++) client.pool.applyReplicaState(i, host.pool.state[i], host.pool.owner[i], host.pool.tag[i]);
    client.rules.updateVisuals(0.016, 1);
    expect(client.rules.netState!()).toEqual(host.rules.netState!());
    expect(client.ctx.score.category('blue', 'teleopCoral')).toBe(5);
    expect(client.ctx.builder.root.getObjectByName('reefscape-scored-pieces')!.children).toHaveLength(1);
  });
  it('upgrades legacy configs and constrains manual size, extension, inventory and preloads', () => {
    const config = cloneConfig(season.robotDefaults);
    delete config.placement; delete config.processor; delete config.intake.primary; delete config.intake.secondary; delete config.climber.secondsToClimb;
    config.height = 10; config.frameLength = config.frameWidth = 2; config.hopperCapacity = 80; config.preload = 8;
    const upgraded = normalizeReefscapeConfig(config);
    expect(upgraded.height).toBeCloseTo(42 * 0.0254);
    expect(2 * (upgraded.frameLength + upgraded.frameWidth)).toBeCloseTo(120 * 0.0254);
    expect(upgraded.placement!.reach).toBeCloseTo(18 * 0.0254);
    expect(upgraded.hopperCapacity).toBe(2); expect(upgraded.preload).toBe(1);
    upgraded.placement!.reach = 10; upgraded.placement!.maxLevel = 99; upgraded.placement!.liftSpeed = Infinity;
    const clamped = normalizeReefscapeConfig(upgraded);
    expect(clamped.placement).toMatchObject({ reach: 18 * 0.0254, maxLevel: 4, liftSpeed: 1.3 });
    expect(SEASONS[0].robotDefaults.placement).toBeUndefined();
    expect(SEASONS[0].robotDefaults.climber.secondsToClimb).toBeUndefined();
  });
  it('lets the CORAL profile score even without an ALGAE net launcher', () => {
    const config = reefscapeRobotPresets().find((p) => p.id === 'coral')!.config;
    const sim = make('blue', season.testing!.scoringSpots('blue')[0], 2, config); sim.rules.stage(); teleop(sim);
    expect(sim.robot.config.launcher.enabled).toBe(false);
    run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
    expect(sim.ctx.score.counter('blue', 'coralL4')).toBe(1);
    expect(sim.robot.config.hopperCapacity).toBe(1);
    run(sim, 2, { ...IDLE_COMMAND, intake: true });
    expect(sim.robot.held.filter((i) => i >= 126)).toHaveLength(0);
  });
  it('lets a processor-only ALGAE profile feed without a net shooter or CORAL pickup', () => {
    const config = reefscapeRobotPresets().find((p) => p.id === 'algae')!.config; config.launcher.enabled = false;
    const p = C.processor('blue'); const sim = make('blue', { x: p.x, y: 1.05, yaw: -Math.PI / 2 }, 2, config);
    sim.rules.stage(); teleop(sim); expect(sim.robot.held).toHaveLength(0);
    load(sim, 126); run(sim, 1.6, { ...IDLE_COMMAND, pass: true, intake: true });
    expect(sim.ctx.score.counter('blue', 'processor')).toBe(1);
    sim.robot.resetTo({ x: 2, y: 2, yaw: 0 }); sim.pool.placeField(0, 2.63, 2);
    run(sim, 0.2, { ...IDLE_COMMAND, intake: true }); expect(sim.robot.held).toHaveLength(0);
  });
  it('limits driver scoring commands to the configured elevator level', () => {
    const config = cloneConfig(season.robotDefaults); config.placement!.maxLevel = 2;
    const sim = make('blue', season.testing!.scoringSpots('blue')[0], 2, config); teleop(sim); load(sim, 0);
    run(sim, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
    expect(sim.ctx.score.counter('blue', 'coralL2')).toBe(1); expect(sim.ctx.score.counter('blue', 'coralL4')).toBe(0);
  });
  it('uses configured elevator speed and reach in the real mechanism loop', () => {
    for (const speed of [0.25, 2.5]) {
      const config = cloneConfig(season.robotDefaults); config.placement!.liftSpeed = speed;
      const sim = make('blue', season.testing!.scoringSpots('blue')[0], 2, config); teleop(sim); load(sim, 0);
      run(sim, 0.8, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
      expect(sim.ctx.score.counter('blue', 'coralL4')).toBe(speed === 2.5 ? 1 : 0);
    }
    const config = cloneConfig(season.robotDefaults); config.placement!.reach = 0;
    const short = make('blue', season.testing!.scoringSpots('blue')[0], 2, config); teleop(short); load(short, 0);
    run(short, 2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
    expect(short.ctx.score.counter('blue', 'coralL4')).toBe(0);
  });
  it('honors CORAL cycle time rather than the ALGAE shot rate', () => {
    const config = cloneConfig(season.robotDefaults); config.placement!.cycleSeconds = 2;
    const sim = make('blue', season.testing!.scoringSpots('blue')[0], 2, config); teleop(sim); load(sim, 0);
    const command = { ...IDLE_COMMAND, shoot: true, scoringLevel: 1 };
    run(sim, 0.3, command); load(sim, 1); run(sim, 0.8, command);
    expect(sim.ctx.score.counter('blue', 'coralL1')).toBe(1);
    run(sim, 1.2, command); expect(sim.ctx.score.counter('blue', 'coralL1')).toBe(2);
  });
  it('uses a configured cage rise time independently of shallow/deep point values', () => {
    for (const level of [1, 2]) {
      const config = cloneConfig(season.robotDefaults); config.climber.maxLevel = level; config.climber.secondsToClimb = 1;
      const p = C.cage('blue', 2), sim = make('blue', { x: p.x - 0.75, y: p.y, yaw: 0 }, 2, config); teleop(sim);
      sim.rules.requestClimb(sim.robot, level); run(sim, 1.8); expect(sim.robot.climbPhase).toBe('hanging');
    }
  });
  it('replicates the raised elevator collider used by client drive prediction', () => {
    const host = make(); load(host, 0); run(host, 2, { ...IDLE_COMMAND, scoringLevel: 4 });
    const client = make(); client.rules.applyNetState!(host.rules.netState!()); client.rules.updateVisuals(0, 0);
    const collider = client.robot.body.collider(client.robot.body.numColliders() - 1);
    expect(collider.halfExtents()!.y * 2 + 0.2).toBeCloseTo(C.LEVEL_HEIGHTS[4] + 0.15);
  });
  for (const a of ALLIANCES) it(`allows ${a} to harvest neutral ALGAE from the opposing reef`, () => {
    const other = a === 'blue' ? 'red' : 'blue';
    const sim = make(a, season.testing!.scoringSpots(other)[0]); sim.rules.stage(); teleop(sim);
    run(sim, 2, { ...IDLE_COMMAND, intake: true });
    expect((sim.rules as ReefscapeRules).reefAlgae(other, 0)).toBe(false);
    expect((sim.rules as ReefscapeRules).reefAlgae(a, 0)).toBe(true);
    expect(sim.robot.held.filter((i) => i >= 126)).toHaveLength(1);
  });
  it('preserves 2026 commands and sends 2025 reef level selections', () => {
    expect(packCommand(IDLE_COMMAND)).toHaveLength(5);
    expect(unpackCommand(packCommand({ ...IDLE_COMMAND, scoringLevel: 4 }))).toEqual({ ...IDLE_COMMAND, scoringLevel: 4 });
    expect(unpackCommand([0, 0, 0, 0, -1, 10])).toBeNull();
  });
  for (const auto of [true, false]) it(`penalizes physical ${auto ? 'AUTO crossing' : 'protected reef'} opponent contact`, () => {
    const defenderPose = season.testing!.scoringSpots('red')[0];
    const sim = make('blue', { ...defenderPose, x: defenderPose.x - 0.80, yaw: 0 });
    const defender = new Robot(sim.physics, sim.ctx.scene, sim.frame, cloneConfig(season.robotDefaults), 'red', 1, 2, defenderPose);
    sim.ctx.robots.push(defender);
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    if (!auto) for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c);
    run(sim, 0.08, { ...IDLE_COMMAND, vx: 1 });
    expect(sim.ctx.score.fouls).toContainEqual(expect.objectContaining({ alliance: 'blue', kind: 'major', rule: auto ? 'G403' : 'G427' }));
    expect(sim.ctx.score.foulPointsFor('red')).toBe(6);
  });
  it('assesses repeated defender penalties at three-second intervals', () => {
    const sim = make('blue', { x: 11, y: 6, yaw: 0 });
    sim.ctx.robots.push(new Robot(sim.physics, sim.ctx.scene, sim.frame, cloneConfig(season.robotDefaults), 'blue', 1, 3, { x: 11, y: 2, yaw: 0 }));
    teleop(sim); run(sim, 3.2);
    expect(sim.ctx.score.fouls.filter((f) => f.rule === 'G421').map((f) => f.kind)).toEqual(['minor', 'major']);
    expect(sim.ctx.score.foulPointsFor('red')).toBe(8);
  });
  it('awards the opponent BARGE RP for TELEOP cage contact without repeating while touching', () => {
    const sim = make('blue', { ...C.cage('red', 2), yaw: 0 }); teleop(sim);
    sim.rules.beforeStep(sim.physics.dt); sim.rules.beforeStep(sim.physics.dt);
    expect(sim.ctx.score.fouls.filter((f) => f.rule === 'G418')).toHaveLength(1);
    expect(sim.rules.results().rpDetail.red).toContain('BARGE');
  });
  it('has 22 unique visual AprilTags at manual structures', () => {
    const sim = make(); const tags: string[] = [];
    sim.ctx.builder.root.traverse((o) => { if (o.name.startsWith('apriltag-')) tags.push(o.name); });
    expect(new Set(tags).size).toBe(22);
    for (let i = 1; i <= 22; i++) expect(tags).toContain(`apriltag-${i}`);
  });
  it('blocks a raised elevator under the barge, but permits a lowered elevator', () => {
    const lane = season.testing!.traversals()[0];
    for (const level of [1, 4]) {
      const sim = make('blue', { ...lane.from, yaw: 0 }); load(sim, 0);
      run(sim, 2, { ...IDLE_COMMAND, scoringLevel: level });
      run(sim, 3, { ...IDLE_COMMAND, vx: 2, scoringLevel: level });
      if (level === 1) expect(sim.robot.pose.x).toBeGreaterThan(C.FIELD_LENGTH / 2 + 0.7);
      else expect(sim.robot.pose.x).toBeLessThan(C.FIELD_LENGTH / 2 - 0.3);
    }
  });
  it('awards AUTO, CORAL, BARGE, win and Coopertition correctly', () => {
    const score = new Scoreboard(season.foulValues);
    for (const a of ALLIANCES) { score.inc(a, 'processor', 2); score.inc(a, 'leave', 3); score.inc(a, 'autoCoral'); for (const l of [1, 2, 4]) score.inc(a, `coralL${l}`, 7); score.set(a, 'barge', 24); }
    score.add('blue', 'teleopCoral', 5);
    const result = reefscapeResults(score, { blue: 3, red: 3 });
    expect(result.rp).toEqual({ blue: 6, red: 3 });
    expect(result.rows.find((r) => r.label === 'Coopertition points')).toMatchObject({ blue: 1, red: 1 });
    score.counters.red.processor = 1;
    expect(reefscapeResults(score, { blue: 3, red: 3 }).rp.blue).toBe(5);
  });
});
