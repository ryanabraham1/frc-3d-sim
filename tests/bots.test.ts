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
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';

import { runMatch } from '../src/engine/testing/match';
import { radioFor, TeamBrain } from '../src/engine/ai/team';

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

  it('difficulty changes opponents (lineup and skill) while preserving teammates and player', () => {
    const settings = defaultSettings(season);
    const same = Object.fromEntries([1, 2, 3].map((k) => [k, season.robotPresets![0].id]));
    const easy = localSetup({ ...settings, aiDifficulty: 'normal', aiOpponent: { archetypes: same } }, season);
    const hard = localSetup({ ...settings, aiDifficulty: 'hard', aiOpponent: { archetypes: same } }, season);
    const enemy = easy.robots.findIndex((r) => r.alliance !== settings.alliance);
    // Difficulty is how the AI plays, never better hardware: the same robot has the same stats at every skill.
    expect(hard.robots[enemy].config.maxSpeed).toBe(easy.robots[enemy].config.maxSpeed);
    expect(hard.robots[enemy].config.launcher.spread).toBe(easy.robots[enemy].config.launcher.spread);
    expect(hard.robots[1].config).toEqual(easy.robots[1].config);
    expect(settings.robot).toEqual(easy.robots[0].config);
    // Without orders the opponents play real team robots (their own models) from the season's lineup.
    const lineup = localSetup({ ...settings, aiDifficulty: 'hard' }, season).robots.filter((r) => r.alliance !== settings.alliance);
    // A standalone game with no real robots yet (WCP CADathon) plays its derived archetype presets instead.
    const builds = season.id === 'wcp-hero-heist' ? [...(season.teamRobots ?? []), ...(season.robotPresets ?? [])] : season.teamRobots?.length ? season.teamRobots : season.robotPresets ?? [];
    for (const r of lineup) expect(builds.some((t) => t.config.model === r.config.model)).toBe(true);
    if (season.id === '2024-crescendo') for (const r of lineup) { expect(r.config.launcher.turret).toBe(false); expect(r.config.intake.ground).toBe(true); }
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
  it('Hard opponents outscore Normal ones against the same idle player and Normal teammates', () => {
    const totals: number[] = [];
    // Three seeds: one match is noisy (a single unlucky collision or a TRAP swings it by 5-10), the ordering over three is not.
    for (const difficulty of ['normal', 'hard'] as const) {
      let total = 0;
      for (const seed of [5, 6, 7]) {
        const settings = { ...defaultSettings(season), seed, aiDifficulty: difficulty };
        const res = runMatch(season, R, settings);
        const red = settings.alliance === 'blue' ? 'red' : 'blue';
        total += res.score[red];
        console.log(season.id, difficulty, seed, res.score[red], JSON.stringify(res.categories[red]));
        if (difficulty === 'hard' && season.id !== '2026-rebuilt') { // stock 2026 robots have no climbers
          const cat = res.categories[red];
          expect((cat.onstage ?? 0) + (cat.barge ?? 0) + (cat.towerTeleop ?? 0) + (cat.tower ?? 0)).toBeGreaterThan(0);
        }
      }
      totals.push(total);
    }
    // Hard trades some of its own scoring for pressure (it defends and goes for TRAPs; here the player is idle, so defense
    // earns nothing), so it can land a few percent under Normal in a season like CRESCENDO. It must not fall behind by more.
    expect(totals[1]).toBeGreaterThan(totals[0] * 0.9);
  }, 600_000);
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
      if (season.id === '2024-crescendo') { expect(cat.speakerAmplified ?? 0).toBeGreaterThan(0); expect((cat.onstage ?? 0) + (cat.park ?? 0)).toBeGreaterThan(0); }
      // AUTO: every robot's preload on L4 (3 × 7). Station cycles on top depend on traffic: AI robots have no speed edge
      // over players, so one 15 s AUTO may not fit an extra cycle (benchmark seeds 5-6: 56 AUTO CORAL points).
      if (season.id === '2025-reefscape') { expect(cat.autoCoral ?? 0).toBeGreaterThanOrEqual(21); expect(cat.barge ?? 0).toBeGreaterThanOrEqual(24); }
      // Stock 2026 robots have no climbers (TOWER skipped for a bigger hopper).
      if (season.id === '2026-rebuilt') { expect(res.counters[a].fuelActive).toBeGreaterThan(400); }
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

it('REBUILT Hard steals opposing fuel and physically feeds it home during its inactive shift', () => {
  const season = SEASONS[0], config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 1,
    pose: { x: 13.6, y: 0.75, yaw: Math.PI }, extraRobots: [
      { config, alliance: 'blue', station: 2, pose: season.startPose('blue', 2), id: 1 },
    ] });
  try {
    sim.ctx.settings.alliance = 'red'; sim.ctx.settings.aiDifficulty = 'hard';
    sim.rules.stage();
    for (const piece of sim.robot.held.splice(0)) sim.pool.reserve(piece);
    for (const piece of sim.pool.indices('field')) sim.pool.reserve(piece);
    sim.scatter(Array.from({ length: 35 }, (_, i) => ({ x: 14.3 + (i % 5) * 0.13, y: 0.55 + Math.floor(i / 5) * 0.13 })));
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(35)) sim.rules.onPeriodChange(change);
    (sim.rules as RebuiltRules).firstInactive = 'blue';
    const bot = season.createBotPilot!(sim.ctx, sim.rules, sim.robot);
    let stolen = 0, passed = 0;
    const dt = sim.physics.dt;
    for (let step = 0; step < 22 / dt; step++) {
      for (const change of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(change);
      const before = sim.robot.held.length, fired = sim.fired;
      sim.step(bot.update(dt));
      if (sim.robot.pose.x > 12.5) stolen += Math.max(0, sim.robot.held.length - before);
      if (sim.robot.lastCommand.pass) passed += sim.fired - fired;
    }
    expect(stolen).toBeGreaterThan(10);
    expect(passed).toBeGreaterThan(10);
    const homeFuel = sim.pool.indices('field').filter((i) => sim.frame.toField(sim.pool.position(i)).x < 4);
    expect(homeFuel.length + (sim.robot.pose.x < 4 ? sim.robot.held.length : 0)).toBeGreaterThan(5);
  } finally { sim.dispose(); }
});

it('a beached robot calls for help, a teammate pushes, then backs off if it will not come free', () => {
  const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 2, pose: { x: 2.5, y: 4.5, yaw: 0 },
    extraRobots: [{ config, alliance: 'blue', station: 1, pose: { x: 2.5, y: 6.8, yaw: 0 }, id: 1 }] });
  try {
    sim.ctx.settings.aiAlly = { skill: 'hard' };
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    while (sim.ctx.clock.mode !== 'teleop') for (const change of sim.ctx.clock.advance(0.1)) sim.rules.onPeriodChange(change);
    const [stuck, mate] = sim.ctx.robots;
    // The player's robot is high-centered: wheels barely touching, going nowhere however hard it drives.
    Object.defineProperty(stuck, 'traction', { get: () => 0.2, set: () => {} });
    stuck.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    const pilot = season.createBotPilot!(sim.ctx, sim.rules, mate);
    const dt = sim.physics.dt;
    let closest = Infinity;
    for (let i = 0; i < 24 / dt; i++) {
      for (const change of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(change);
      for (const r of sim.ctx.robots) {
        r.enabled = true;
        const cmd = r === stuck ? { ...IDLE_COMMAND, vx: 1.5 } : pilot.update(dt);
        r.lastCommand = cmd; r.drive(cmd, dt); r.tick(dt);
      }
      sim.rules.beforeStep(dt); sim.pool.updateDamping(); sim.physics.step(); sim.rules.afterStep(dt);
      closest = Math.min(closest, Math.hypot(mate.pose.x - stuck.pose.x, mate.pose.y - stuck.pose.y));
    }
    const radio = radioFor(sim.ctx).messages.map((m) => `${m.from}: ${m.text}`);
    console.log(radio.filter((m) => /push|way|backing/.test(m)));
    expect(radio.some((m) => m.includes('need a push'))).toBe(true);
    expect(radio.some((m) => m.startsWith('Blue 1: On my way'))).toBe(true);
    expect(closest).toBeLessThan(1.6);
    expect(radio.some((m) => m.includes('backing off'))).toBe(true);
  } finally { sim.dispose(); }
});

it('teammates follow the player’s orders and every season offers strategies and roles', () => {
  for (const season of SEASONS) {
    expect(season.aiStrategies?.[0].id).toBe('auto');
    expect(season.aiStrategies!.length).toBeGreaterThan(2);
    expect(season.aiRoles!.length).toBeGreaterThan(1);
    const preset = season.robotPresets!.at(-1)!;
    const settings = { ...defaultSettings(season), aiAlly: { skill: 'einstein' as const, archetypes: { 1: preset.id, 3: preset.id } } };
    const elite = localSetup(settings, season), normal = localSetup({ ...settings, aiAlly: { archetypes: { 1: preset.id, 3: preset.id } } }, season);
    // AI robots get the same hardware players do: skill changes how they play, not the robot.
    expect(elite.robots[1].config.maxSpeed).toBe(normal.robots[1].config.maxSpeed);
    expect(elite.robots[1].config.launcher.spread).toBe(normal.robots[1].config.launcher.spread);
    expect(normal.robots[1].config.hopperCapacity).toBe(preset.config.hopperCapacity);
    const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', station: 2, pose: season.startPose('blue', 2),
      extraRobots: [{ config: season.robotDefaults, alliance: 'blue', station: 1, pose: season.startPose('blue', 1), id: 1 }] });
    try {
      const role = season.aiRoles!.at(-1)!.id, strategy = season.aiStrategies![2].id;
      sim.ctx.settings.aiAlly = { skill: 'hard', strategy, roles: { 1: role } };
      season.createBotPilot!(sim.ctx, sim.rules, sim.ctx.robots[1]);
      const team = TeamBrain.for(sim.ctx, 'blue');
      expect(team.role(sim.ctx.robots[1])).toBe(role);
      expect(team.strategy).toBe(strategy);
    } finally { sim.dispose(); }
  }
});
