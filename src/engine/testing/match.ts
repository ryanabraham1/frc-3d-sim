import type { Alliance } from '../coords';
import { localSetup } from '../core/game';
import type { AutoPilot, GameSettings, SeasonDefinition } from '../core/season';
import type { RapierModule } from '../physics/world';
import { IDLE_COMMAND, intakeZoneContains, type RobotCommand } from '../robot/robot';
import { HeadlessSim } from './headless';
import { drainSpilled } from '../robot/spill';

export interface MatchRunOptions {
  /** Drive the player's station with a bot too (an all-AI match), instead of leaving it idle. */
  playerBot?: boolean;
  /** Stop after this many seconds of match time (default: the whole match). */
  seconds?: number;
  /** Called after every physics step. */
  onStep?: (sim: HeadlessSim) => void;
}

export interface MatchRunResult {
  score: Record<Alliance, number>;
  /** Points by scoreboard category, per alliance. */
  categories: Record<Alliance, Record<string, number>>;
  /** Points credited to each robot, by robot id. */
  robotPoints: number[];
  /** Foul points each alliance gave away. */
  fouls: Record<Alliance, number>;
  /** Every foul called: "alliance rule". */
  foulList: string[];
  counters: Record<Alliance, Record<string, number>>;
}

/**
 * A complete single-player match in Node: the player's robot plus the five AI robots `localSetup` creates, AUTO
 * routines then TELEOP bot pilots, with the same per-robot order as Game.step (command → season assist → chassis
 * auto-align → drive → climb → tick → aim → mechanisms/launch, then intake → beforeStep → physics → afterStep).
 * Keep it in sync with Game.step. Used by the AI tests and the strategy benchmark.
 */
export function runMatch(season: SeasonDefinition, R: RapierModule, settings: GameSettings, opts: MatchRunOptions = {}): MatchRunResult {
  const setup = localSetup(settings, season);
  const player = setup.robots[0];
  const sim = new HeadlessSim(season, R, {
    robot: player.config, alliance: player.alliance, station: player.station, pose: player.start!, seed: settings.seed,
    extraRobots: setup.robots.slice(1).map((r) => ({ config: r.config, alliance: r.alliance, station: r.station, pose: r.start!, id: r.id })),
  });
  try {
    Object.assign(sim.ctx.settings, settings, { robot: sim.robot.config });
    sim.ctx.humanPlayerIsAuto = () => true;
    const { ctx, rules, pool, physics } = sim;
    const dt = physics.dt;
    rules.stage();
    const autos: (AutoPilot | null)[] = ctx.robots.map((r, i) => (i === 0 && !opts.playerBot ? null : season.createAutoPilot(ctx, rules, r, setup.robots[i].autoRoutine)));
    const bots: (AutoPilot | null)[] = ctx.robots.map((r, i) => (i === 0 && !opts.playerBot ? null : season.createBotPilot?.(ctx, rules, r) ?? null));
    rules.onPeriodChange(ctx.clock.start());
    const limit = opts.seconds ?? Infinity;
    while (!ctx.clock.finished && ctx.clock.elapsed < limit) {
      for (const change of ctx.clock.advance(dt)) rules.onPeriodChange(change);
      const mode = ctx.clock.mode, enabled = mode !== 'disabled';
      for (const [i, r] of ctx.robots.entries()) {
        r.enabled = enabled;
        let cmd: RobotCommand = IDLE_COMMAND;
        if (enabled) cmd = (mode === 'auto' ? autos[i] : bots[i])?.update(dt) ?? IDLE_COMMAND;
        if (enabled && rules.adjustCommand) cmd = rules.adjustCommand(r, cmd, dt);
        const target = cmd.pass && !cmd.shoot && rules.passTarget ? rules.passTarget(r) : rules.aimTarget(r);
        if (enabled) cmd = r.autoAlign(cmd, target);
        r.lastCommand = cmd;
        r.overheadLimit = rules.overheadClearance?.(r) ?? Infinity;
        r.drive(cmd, dt);
        if (enabled) {
          if (cmd.descend && r.isClimbing) rules.requestDescend(r);
          else if (cmd.climb !== null && !r.isClimbing && !r.tippedOver && r.config.climber.maxLevel > 0) rules.requestClimb(r, cmd.climb);
        }
        r.tick(dt);
        drainSpilled(r, pool);
        r.aimTurretAt(target, dt);
        if (!rules.handleMechanisms) r.advanceScoringMechanisms(dt);
        const handled = enabled && rules.handleMechanisms?.(r, cmd, dt);
        if (enabled && !handled && (cmd.shoot || cmd.pass)) {
          const shot = r.launch(target, sim.rng);
          if (shot) {
            const idx = r.held.pop()!;
            pool.placeWorld(idx, shot.pos, shot.vel);
            r.noteLaunch(idx);
            rules.onLaunch(r, idx);
          }
        }
      }
      if (enabled && !rules.handlesIntake) {
        const zones = ctx.robots.flatMap((r) => {
          r.tickIntake(dt);
          const z = r.lastCommand.intake && r.intakeRoom > 0 ? r.intakeZone() : null;
          return z ? [{ r, z }] : [];
        });
        for (let i = 0; i < pool.count && zones.length; i++) {
          if (pool.state[i] !== 'field') continue;
          const p = pool.position(i);
          for (let k = 0; k < zones.length; k++) {
            const { r, z } = zones[k];
            if (ctx.robots.some(other => other !== r && other.shieldsPiece(p, pool.radius))) continue;
            if (r.justLaunched(i) || !intakeZoneContains(z, p, pool.radius, 0.4)) continue;
            pool.hold(i, r.id);
            r.held.push(i);
            if (r.intakeRoom <= 0) zones.splice(k, 1);
            break;
          }
        }
      }
      rules.beforeStep(dt);
      pool.updateDamping();
      physics.step();
      rules.afterStep(dt);
      opts.onStep?.(sim);
    }
    const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((s, n) => s + n, 0);
    return {
      score: { blue: ctx.score.total('blue'), red: ctx.score.total('red') },
      categories: { blue: { ...ctx.score.points.blue }, red: { ...ctx.score.points.red } },
      robotPoints: ctx.robots.map((r) => sum(ctx.score.robots[r.id]?.points)),
      fouls: { blue: ctx.score.foulPointsFor('red'), red: ctx.score.foulPointsFor('blue') },
      foulList: ctx.score.fouls.map((f) => `${f.alliance}#${f.robotId} ${f.rule}${f.note ? ` (${f.note})` : ''} @${f.t.toFixed(0)}`),
      counters: { blue: { ...ctx.score.counters.blue }, red: { ...ctx.score.counters.red } },
    };
  } finally {
    sim.dispose();
  }
}
