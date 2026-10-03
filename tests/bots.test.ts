import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { routeThroughBands } from '../src/engine/ai/steering';
import { CycleBot } from '../src/engine/ai/cycleBot';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { localSetup } from '../src/engine/core/game';
import { fieldToSpot, footprintPoly, polysOverlap } from '../src/engine/startPose';
import { footprint } from '../src/engine/robot/config';
import { defaultSettings } from '../src/app/menu';
import { SEASONS } from '../src/seasons';
import { runMatch } from '../src/engine/testing/match';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

describe.each(SEASONS)('$name AI', (season) => {
  it('fills six unique stations and keeps solo practice available', () => {
    const settings = defaultSettings(season);
    const setup = localSetup(settings, season);
    expect(setup.robots).toHaveLength(6);
    expect(new Set(setup.robots.map((r) => r.slot)).size).toBe(6);
    expect(setup.robots.filter((r) => r.alliance === settings.alliance)).toHaveLength(3);
    expect(setup.robots[0].name).toBe('You');
    expect(setup.robots.slice(1).every((r) => !r.manualAuto)).toBe(true);
    expect(localSetup({ ...settings, aiOpponents: false }, season).robots).toHaveLength(1);
  });

  it('places bots clear of a custom player starting spot', () => {
    const settings = defaultSettings(season);
    const dims = { length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry };
    settings.startSpot = fieldToSpot(dims, settings.alliance, season.startPose(settings.alliance, 1));
    const robots = localSetup(settings, season).robots;
    for (let i = 0; i < robots.length; i++) for (let j = i + 1; j < robots.length; j++) {
      const a = footprint(robots[i].config), b = footprint(robots[j].config);
      expect(polysOverlap(footprintPoly(robots[i].start!, a.length, a.width), footprintPoly(robots[j].start!, b.length, b.width))).toBe(false);
    }
  });

  it('difficulty changes opponents while preserving teammates and player', () => {
    const settings = defaultSettings(season);
    const easy = localSetup({ ...settings, aiDifficulty: 'easy' }, season);
    const hard = localSetup({ ...settings, aiDifficulty: 'hard' }, season);
    const enemy = easy.robots.findIndex((r) => r.alliance !== settings.alliance);
    expect(hard.robots[enemy].config.maxSpeed).toBeGreaterThan(easy.robots[enemy].config.maxSpeed);
    expect(hard.robots[enemy].config.launcher.spread).toBeLessThan(easy.robots[enemy].config.launcher.spread);
    expect(hard.robots[1].config).toEqual(easy.robots[1].config);
    expect(settings.robot).toEqual(easy.robots[0].config);
  });

  it.each(['blue', 'red'] as const)('collects and scores repeated TELEOP cycles for %s', (alliance) => {
    const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance, pose: season.startPose(alliance, 2) });
    try {
      sim.ctx.humanPlayerIsAuto = () => true;
      sim.rules.stage();
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      while (sim.ctx.clock.mode !== 'teleop') {
        for (const change of sim.ctx.clock.advance(0.1)) sim.rules.onPeriodChange(change);
      }
      const bot = season.createBotPilot!(sim.ctx, sim.rules, sim.robot);
      for (let step = 0; step < 60 / sim.physics.dt; step++) {
        for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
        sim.step(bot.update(sim.physics.dt));
      }
      const scored = season.testing!.goalCount(sim.ctx, alliance);
      expect(scored).toBeGreaterThan(season.robotDefaults.preload);
    } finally { sim.dispose(); }
  });
});

describe.each(SEASONS)('$name Hard challenge', (season) => {
  it('earns more points than Normal in an idle-player match', () => {
    const totals: number[] = [];
    for (const difficulty of ['normal', 'hard'] as const) {
      const settings = { ...defaultSettings(season), aiDifficulty: difficulty };
      const opponent = localSetup(settings, season).robots.find((r) => r.alliance !== settings.alliance)!;
      const sim = new HeadlessSim(season, R, { robot: opponent.config, alliance: opponent.alliance, station: 2, pose: season.startPose(opponent.alliance, 2) });
      try {
        sim.ctx.settings.alliance = settings.alliance;
        sim.ctx.settings.aiDifficulty = difficulty;
        sim.ctx.humanPlayerIsAuto = () => true;
        sim.rules.stage();
        sim.rules.onPeriodChange(sim.ctx.clock.start());
        const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, opponent.autoRoutine);
        const bot = season.createBotPilot!(sim.ctx, sim.rules, sim.robot);
        while (!sim.ctx.clock.finished) {
          for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
          if (sim.ctx.clock.mode !== 'disabled') sim.step((sim.ctx.clock.mode === 'auto' ? auto : bot).update(sim.physics.dt));
          else { sim.robot.enabled = false; sim.rules.beforeStep(sim.physics.dt); sim.pool.updateDamping(); sim.physics.step(); sim.rules.afterStep(sim.physics.dt); }
        }
        totals.push(sim.ctx.score.total(opponent.alliance));
        console.log(season.id, difficulty, totals.at(-1), 'climb', sim.robot.climbPhase);
        if (difficulty === 'hard') expect(sim.robot.climbPhase).toBe('hanging');
      } finally { sim.dispose(); }
    }
    expect(totals[1]).toBeGreaterThan(totals[0]);
  });
});

// A whole all-AI match (the player's station driven by a bot too) through the engine's step order.
describe.each(SEASONS)('$name all-AI match', (season) => {
  it('every robot scores, the alliance plan runs and fouls stay rare', () => {
    const settings = { ...defaultSettings(season), seed: 3, alliance: 'blue' as const, aiDifficulty: 'hard' as const, aiAlly: { skill: 'hard' as const } };
    const res = runMatch(season, R, settings, { playerBot: true });
    console.log(season.id, 'all-AI', res.score, JSON.stringify(res.categories), 'fouls', res.foulList);
    for (const pts of res.robotPoints) expect(pts).toBeGreaterThan(0);
    for (const a of ['blue', 'red'] as const) {
      expect(res.fouls[a]).toBeLessThan(res.score[a === 'blue' ? 'red' : 'blue'] * 0.15);
      const cat = res.categories[a];
      if (season.year === 2024) { expect(cat.speakerAmplified ?? 0).toBeGreaterThan(0); expect((cat.onstage ?? 0) + (cat.park ?? 0)).toBeGreaterThan(0); }
      if (season.year === 2025) { expect(cat.autoCoral ?? 0).toBeGreaterThan(21); expect(cat.barge ?? 0).toBeGreaterThanOrEqual(24); }
      if (season.year === 2026) { expect(cat.towerTeleop ?? 0).toBeGreaterThanOrEqual(60); expect(cat.towerAuto ?? 0).toBeGreaterThan(0); expect(res.counters[a].fuelActive).toBeGreaterThan(600); }
    }
  }, 300_000);
});

it('two AI robots pass head-on without needing the player to bump them', () => {
  const season = SEASONS[0], x = season.fieldLength / 2, y = season.fieldWidth / 2;
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: { x: x - 1.5, y, yaw: 0 },
    extraRobots: [{ config: season.robotDefaults, alliance: 'blue', station: 1, pose: { x: x + 1.5, y, yaw: Math.PI }, id: 1 }] });
  try {
    sim.ctx.clock.start();
    const robots = sim.ctx.robots;
    const goals = [{ x: x + 1.5, y }, { x: x - 1.5, y }];
    const pilots = robots.map((r, i) => {
      const pilot: CycleBot = new CycleBot(sim.ctx, r, { accepts: () => false, supply: () => ({ ...goals[i], yaw: 0 }), wantsScore: () => true, score: () => pilot.driveTo(goals[i]) });
      return pilot;
    });
    for (let i = 0; i < 8 / sim.physics.dt; i++) {
      sim.ctx.clock.advance(sim.physics.dt);
      for (const [k, r] of robots.entries()) { r.enabled = true; r.drive(pilots[k].update(sim.physics.dt), sim.physics.dt); r.tick(sim.physics.dt); }
      sim.physics.step();
    }
    for (const [i, r] of robots.entries()) expect(Math.hypot(r.pose.x - goals[i].x, r.pose.y - goals[i].y)).toBeLessThan(0.5);
  } finally { sim.dispose(); }
});

it('REBUILT defender role reduces a shooter’s physical scoring instead of just following it', () => {
  const season = SEASONS[0];
  const totals: number[] = [];
  for (const defense of [false, true]) {
    const config = season.botRobotConfig!('hard');
    const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 2,
      pose: { x: 2.6, y: 5.5, yaw: 0 }, extraRobots: [
        { config, alliance: 'red', station: 3, pose: { x: 5.8, y: 5.5, yaw: Math.PI }, id: 1 },
        { config, alliance: 'red', station: 1, pose: season.startPose('red', 1), id: 2 },
      ] });
    try {
      sim.ctx.settings.aiDifficulty = 'hard';
      sim.ctx.settings.aiOpponent = { roles: { 3: 'defender' } };
      sim.rules.stage();
      sim.load(72);
      for (const piece of sim.ctx.robots[1].held.splice(0)) sim.pool.reserve(piece);
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      // SHIFT 1 with red's HUB inactive: the defender's moment.
      while (sim.ctx.clock.current.id !== 'shift1') for (const change of sim.ctx.clock.advance(0.1)) sim.rules.onPeriodChange(change);
      (sim.rules as unknown as { firstInactive: string }).firstInactive = 'red';
      const defender = season.createBotPilot!(sim.ctx, sim.rules, sim.ctx.robots[1]);
      const dt = sim.physics.dt;
      for (let i = 0; i < 12 / dt; i++) {
        for (const change of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(change);
        for (const [k, r] of sim.ctx.robots.entries()) {
          r.enabled = true;
          let cmd = k === 0 ? { ...IDLE_COMMAND, shoot: true } : k === 1 && defense ? defender.update(dt) : { ...IDLE_COMMAND };
          const target = sim.rules.aimTarget(r);
          cmd = r.autoAlign(cmd, target); r.lastCommand = cmd; r.drive(cmd, dt); r.tick(dt); r.aimTurretAt(target, dt);
          if (cmd.shoot) {
            const shot = r.launch(target, sim.rng);
            if (shot) { const piece = r.held.pop()!; sim.pool.placeWorld(piece, shot.pos, shot.vel); r.noteLaunch(piece); sim.rules.onLaunch(r, piece); }
          }
        }
        sim.rules.beforeStep(dt); sim.pool.updateDamping(); sim.physics.step(); sim.rules.afterStep(dt);
      }
      totals.push(sim.ctx.score.earned('blue'));
    } finally { sim.dispose(); }
  }
  console.log('REBUILT shooting without/with defense', totals);
  expect(totals[1]).toBeLessThan(totals[0]);
});

it('routes to fuel inside a barrier lane instead of stopping at its exit', () => {
  const goal = { x: 2, y: 1.5 };
  expect(routeThroughBands({ x: 0.6, y: 1.5 }, goal, [{ xMin: 1, xMax: 3, gaps: [{ yMin: 0, yMax: 3 }] }], 0.4, 0.5)).toBe(goal);
});
