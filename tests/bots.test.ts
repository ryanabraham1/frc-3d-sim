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

// Run the same fleet mechanism/physics order as the engine, including a stationary human player.
describe.each(SEASONS)('$name six-robot match', (season) => {
  it('keeps all five AI robots playing through TELEOP traffic', () => {
    const settings = { ...defaultSettings(season), aiDifficulty: 'hard' as const };
    const setup = localSetup(settings, season);
    const sim = new HeadlessSim(season, R, {
      robot: setup.robots[0].config, alliance: settings.alliance, station: settings.station, pose: setup.robots[0].start!,
      extraRobots: setup.robots.slice(1).map((r) => ({ ...r, pose: r.start! })),
    });
    try {
      sim.ctx.settings.aiDifficulty = 'hard';
      sim.ctx.humanPlayerIsAuto = () => true;
      sim.rules.stage();
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      for (const change of sim.ctx.clock.advance(season.timeline.filter((p) => p.mode !== 'teleop').slice(0, 2).reduce((s, p) => s + p.duration, 0))) sim.rules.onPeriodChange(change);
      const pilots = sim.ctx.robots.map((r) => r === sim.robot ? null : season.createBotPilot!(sim.ctx, sim.rules, r));
      const dt = sim.physics.dt;
      let feeds = 0, defenseFrames = 0;
      const scoringPeriods = new Map<number, Set<string>>();
      for (let step = 0; step < 85 / dt; step++) {
        for (const change of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(change);
        for (const [i, r] of sim.ctx.robots.entries()) {
          r.enabled = true;
          let cmd = pilots[i]?.update(dt) ?? { ...IDLE_COMMAND };
          if (sim.rules.adjustCommand) cmd = sim.rules.adjustCommand(r, cmd, dt);
          const target = cmd.pass && !cmd.shoot && sim.rules.passTarget ? sim.rules.passTarget(r) : sim.rules.aimTarget(r);
          cmd = r.autoAlign(cmd, target);
          if (season.year === 2026 && r.alliance !== settings.alliance && r.station === 3 && Math.hypot(r.pose.x - sim.robot.pose.x, r.pose.y - sim.robot.pose.y) < 1.4) defenseFrames++;
          r.lastCommand = cmd; r.drive(cmd, dt); r.tick(dt); r.aimTurretAt(target, dt);
          const handled = sim.rules.handleMechanisms?.(r, cmd, dt);
          if (!handled && (cmd.shoot || cmd.pass)) {
            const shot = r.launch(target, sim.rng);
            if (shot) {
              if (cmd.pass) feeds++;
              else { if (!scoringPeriods.has(r.id)) scoringPeriods.set(r.id, new Set()); scoringPeriods.get(r.id)!.add(sim.ctx.clock.current.id); }
              const piece = r.held.pop()!; sim.pool.placeWorld(piece, shot.pos, shot.vel); r.noteLaunch(piece); sim.rules.onLaunch(r, piece); }
          }
        }
        if (!sim.rules.handlesIntake) for (const r of sim.ctx.robots) {
          if (!r.lastCommand.intake || r.capacityLeft <= 0) continue;
          for (let piece = 0; piece < sim.pool.count; piece++) {
            if (sim.pool.state[piece] !== 'field' || r.justLaunched(piece)) continue;
            const p = sim.pool.position(piece);
            if ((p.y <= 0.4 && r.intakeContains(p, sim.pool.radius)) || r.stationContains(p, sim.pool.radius)) {
              sim.pool.hold(piece, r.id); r.held.push(piece); if (!r.capacityLeft) break;
            }
          }
        }
        sim.rules.beforeStep(dt); sim.pool.updateDamping(); sim.physics.step(); sim.rules.afterStep(dt);
      }
      const points = sim.ctx.robots.slice(1).map((r) => Object.values(sim.ctx.score.robots[r.id]?.points ?? {}).reduce((sum, n) => sum + n, 0));
      console.log(season.id, 'fleet points', points, 'shots', sim.ctx.robots.slice(1).map((r) => sim.ctx.score.robotCounter(r.id, 'shots')));
      if (season.year === 2026) {
        console.log('REBUILT tactics', { feeds, defenseFrames, shootingPeriods: [...scoringPeriods].map(([id, periods]) => [id, [...periods]]) });
        expect(feeds).toBeGreaterThan(10);
        expect(defenseFrames).toBeGreaterThan(10);
        for (const r of sim.ctx.robots.filter((r) => r.alliance !== settings.alliance && r.station !== 3)) expect(scoringPeriods.get(r.id)!.size).toBeGreaterThanOrEqual(2);
      }
      for (const [i, pointsScored] of points.entries()) if (season.year !== 2026 || setup.robots[i + 1].alliance === settings.alliance || setup.robots[i + 1].station !== 3) expect(pointsScored).toBeGreaterThan(0);
      for (const r of sim.ctx.robots.slice(1).filter((r) => season.year !== 2026 || r.alliance === settings.alliance || r.station !== 3)) expect(sim.ctx.score.robotCounter(r.id, 'shots')).toBeGreaterThan(r.config.preload);
    } finally { sim.dispose(); }
  });
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

it('REBUILT defense reduces a shooter’s physical scoring instead of just following it', () => {
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
      sim.rules.stage();
      sim.load(72);
      // With both hubs active, an empty defender can deny more than it could score.
      for (const piece of sim.ctx.robots[1].held.splice(0)) sim.pool.reserve(piece);
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      for (const change of sim.ctx.clock.advance(23)) sim.rules.onPeriodChange(change);
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
