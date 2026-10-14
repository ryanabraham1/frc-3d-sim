import type { Alliance } from '../coords';
import { MatchClock, type PeriodChange } from '../match/clock';
import { buildPlayerResults } from '../match/playerResults';
import type { MatchSetup, NetGameState } from '../net/protocol';
import { bodyState, restoreBody, captureFields, restoreFields, capturePilot, restorePilot } from '../net/recovery';
import { IDLE_COMMAND, intakeZoneContains, type IntakeZone, type Robot, type RobotCommand } from '../robot/robot';
import { spawnClearance } from '../robot/spawnClearance';
import { drainSpilled } from '../robot/spill';
import { aiOrders } from '../ai/team';
import { describeArchetype } from '../telemetry/archetype';
import { MatchLogger, SRC } from '../telemetry/matchLogger';
import type { MatchWorld } from './matchWorld';
import type { AutoPilot, GameSettings, MatchResults, SeasonDefinition } from './season';

export const PRE_MATCH_COUNTDOWN = 3;

export interface SimEvents {
  /** A match period started or ended (views play the cue and show the banner). */
  periodChange(ch: PeriodChange): void;
  /** The match ended; `results` is final. */
  results(results: MatchResults): void;
}

export interface SimStepInput {
  /** Command for a robot under driver control this step (the screen's driver, or a remote one). */
  command(robot: Robot): RobotCommand;
  /** Human-player button presses this step: [alliance, button]. */
  humanPlayer: [Alliance, number][];
}

/** Settings the AI reads: a multiplayer lobby's bot difficulty applies to both alliances. */
export function botSettings(setup: MatchSetup, settings: GameSettings): GameSettings {
  const skill = setup.botDifficulty;
  return skill ? { ...settings, aiDifficulty: skill, aiAlly: { skill }, aiOpponent: { skill } } : settings;
}

/**
 * The match authority: runs the clock, the AUTO routines and AI drivers, every robot's mechanisms, intake and the
 * season rules over a MatchWorld at a fixed step. Knows nothing about screens, so it runs on a page or in a worker.
 */
export class MatchSim {
  state: NetGameState = 'countdown';
  countdown = PRE_MATCH_COUNTDOWN;
  pausedFrom: NetGameState = 'countdown';
  /** Sim time (s) — advances only while stepping. */
  simTime = 0;
  results: MatchResults | null = null;
  readonly autoPilots = new Map<number, AutoPilot>();
  readonly botPilots = new Map<number, AutoPilot>();
  /** Records the humans' commands and the world for imitation learning. */
  matchLog: MatchLogger | null = null;
  private boostOn = false;
  private boostBase: { cap: number; rate: number; spread: number; speedError: number; intake: number | undefined } | null = null;

  constructor(
    readonly world: MatchWorld,
    readonly season: SeasonDefinition,
    readonly settings: GameSettings,
    private readonly events: SimEvents,
    opts: { log?: { mode: string } } = {},
  ) {
    const { ctx, rules, robots, robotSetups } = world;
    if (opts.log) {
      const aiSettings = botSettings(world.setup, settings);
      this.matchLog = new MatchLogger(
        world,
        (r) => r.controller === 'bot' ? SRC.bot : this.manual(r) ? SRC.human : SRC.autopilot,
        { describe: (r) => describeArchetype(season, r.config), seasonId: season.id, seed: world.setup.seed, fieldLength: season.fieldLength, fieldWidth: season.fieldWidth, mode: opts.log.mode,
          // Bot difficulty per alliance, so logs show how players do against each level (tools/analyze_match_logs.py).
          extra: { aiSkill: { blue: aiOrders(aiSettings, 'blue').skill, red: aiOrders(aiSettings, 'red').skill } } },
      );
    }
    rules.stage();
    for (const r of robots) {
      const rs = robotSetups.get(r.id)!;
      this.autoPilots.set(r.id, season.createAutoPilot(ctx, rules, r, rs.autoRoutine));
      if (r.controller === 'bot' && season.createBotPilot) this.botPilots.set(r.id, season.createBotPilot(ctx, rules, r));
    }
  }

  get clock(): MatchClock { return this.world.clock; }
  get dt(): number { return this.world.physics.dt; }

  /** Is robot `r` under driver control right now (vs. its AUTO routine)? */
  manual(r: Robot): boolean {
    return this.clock.mode === 'teleop' || (this.world.robotSetups.get(r.id)?.manualAuto ?? false);
  }

  /** REBUILT practice boost (the driver's Period key): triple capacity and fire rate, perfect shots. */
  setBoost(player: Robot | null, on: boolean): void {
    const c = player?.config;
    if (!c || this.season.id !== '2026-rebuilt') return;
    this.boostOn = on;
    if (on && !this.boostBase) {
      this.boostBase = { cap: c.hopperCapacity, rate: c.launcher.rate, spread: c.launcher.spread, speedError: c.launcher.speedError, intake: c.intake.rate };
      c.hopperCapacity = this.boostBase.cap * 3;
      c.launcher.rate = this.boostBase.rate * 3;
      c.launcher.spread = 0;
      c.launcher.speedError = 0;
      player!.packLimit = true;
      if (this.boostBase.intake !== undefined) c.intake.rate = this.boostBase.intake * 3;
    } else if (!on && this.boostBase) {
      c.hopperCapacity = this.boostBase.cap;
      c.launcher.rate = this.boostBase.rate;
      c.launcher.spread = this.boostBase.spread;
      c.launcher.speedError = this.boostBase.speedError;
      player!.packLimit = false;
      c.intake.rate = this.boostBase.intake;
      this.boostBase = null;
    }
  }
  get boost(): boolean { return this.boostOn; }

  pause(): boolean {
    if (this.state !== 'running' && this.state !== 'countdown' && this.state !== 'waiting') return false;
    this.pausedFrom = this.state;
    this.state = 'paused';
    return true;
  }

  resume(): boolean {
    if (this.state !== 'paused') return false;
    this.state = this.pausedFrom;
    return true;
  }

  /** Is the clock (and so the physics) advancing? */
  get stepping(): boolean {
    return this.state === 'countdown' || this.state === 'running';
  }

  step(dt: number, input: SimStepInput): void {
    const { world, season } = this;
    const { rules, pool, robots } = world;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'running';
        this.onPeriodChange(this.clock.start());
      }
    } else {
      for (const ch of this.clock.advance(dt)) this.onPeriodChange(ch);
      if (this.clock.finished && this.state === 'running') this.finish();
    }

    const mode = this.clock.mode;
    const enabled = mode !== 'disabled';

    if (this.state === 'running') {
      for (const [alliance, button] of input.humanPlayer) {
        if (button <= (season.humanPlayerButtons ?? 1)) rules.humanPlayerAction(alliance, button);
      }
    }

    for (const r of robots) {
      const on = enabled;
      r.enabled = on;
      let cmd: RobotCommand = IDLE_COMMAND;
      if (on) {
        if (!this.manual(r)) cmd = this.autoPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND;
        else if (r.controller === 'bot') cmd = this.botPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND;
        else cmd = input.command(r);
      }
      // Driver-assist layers: season assists (e.g. reef auto-align) then chassis auto-align onto the shot target.
      if (on && rules.adjustCommand) cmd = rules.adjustCommand(r, cmd, dt);
      const target = cmd.pass && !cmd.shoot && rules.passTarget ? rules.passTarget(r) : rules.aimTarget(r);
      if (on) cmd = r.autoAlign(cmd, target);
      r.lastCommand = cmd;
      r.overheadLimit = rules.overheadClearance?.(r) ?? Infinity;
      r.drive(cmd, dt);
      if (on) {
        if (cmd.descend && r.isClimbing) rules.requestDescend(r);
        else if (cmd.climb !== null && !r.isClimbing && !r.tippedOver && r.config.climber.maxLevel > 0) rules.requestClimb(r, cmd.climb);
      }
      r.tick(dt);
      drainSpilled(r, pool);
      r.aimTurretAt(target, dt);
      if (!rules.handleMechanisms) r.advanceScoringMechanisms(dt);
      const handled = on && rules.handleMechanisms?.(r, cmd, dt);
      if (on && !handled && (cmd.shoot || cmd.pass)) {
        const shot = r.launch(target, world.rng);
        if (shot) {
          const idx = r.held.pop()!;
          pool.placeWorld(idx, shot.pos, shot.vel);
          if (r.config.launcher.exitInside) pool.releaseGhost(idx, () => spawnClearance(r, pool.position(idx), pool.colliderRadius, pool.colliderHalfHeight) > 0.02);
          r.noteLaunch(idx);
          rules.onLaunch(r, idx);
          this.matchLog?.launch(r, idx, shot.vel);
        }
      }
    }

    // Intake: robots swallow pieces inside their capture zone.
    if (enabled && !rules.handlesIntake) {
      const zones: { r: Robot; z: IntakeZone }[] = [];
      for (const r of robots) {
        r.tickIntake(dt);
        // Physical hoppers (MechHopper, and StowBay on a model with roller hooks) capture by roller contact; everyone
        // else swallows from the capture zone.
        const z = r.lastCommand.intake && r.intakeRoom > 0 && !r.mech && !r.capturesByContact ? r.intakeZone() : null;
        if (z) zones.push({ r, z });
      }
      for (let i = 0; i < pool.count && zones.length; i++) {
        if (pool.state[i] !== 'field') continue;
        const p = pool.position(i);
        for (let k = 0; k < zones.length; k++) {
          const { r, z } = zones[k];
          if (r.justLaunched(i)) continue;
          // Cheap zone test first; the shield test reads other robots' poses through WASM.
          if (intakeZoneContains(z, p, pool.radius, 0.4)) {
            if (robots.some(other => other !== r && other.shieldsPiece(p, pool.radius))) continue;
            r.noteCapture(p);
            pool.hold(i, r.id);
            r.held.push(i);
            if (r.intakeRoom <= 0) zones.splice(k, 1);
            break;
          }
        }
      }
    }

    rules.beforeStep(dt);
    pool.updateDamping();
    world.physics.step();
    rules.afterStep(dt);
    this.matchLog?.step();
    this.simTime += dt;
  }

  private onPeriodChange(ch: PeriodChange): void {
    this.world.rules.onPeriodChange(ch);
    this.events.periodChange(ch);
  }

  /** End of match: final results (with the per-player breakdown). */
  private finish(): void {
    this.state = 'results';
    const { score, setup, rules } = this.world;
    const res = rules.results();
    Object.assign(res, buildPlayerResults(res, score, setup.robots.map((rs) => ({ id: rs.id, alliance: rs.alliance, name: rs.name, team: rs.config.teamNumber })), this.season.foulValues, 'Game pieces'));
    this.results = res;
    this.events.results(res);
  }

  /** Full gameplay state, independent of rendering and the local driver's camera/input. */
  recoveryState() {
    const { world } = this;
    if (!world.rules.recoveryState) throw new Error('Season does not support host recovery');
    return { version: 1 as const, seasonId: this.season.id,
      fields: captureFields(this, ['state', 'pausedFrom', 'countdown', 'simTime', 'results']),
      clock: world.clock.snapshot(), score: world.score.snapshot(), rng: world.rng.snapshot(),
      pool: world.pool.recoveryState(), rules: world.rules.recoveryState(),
      robots: world.robots.map(r => ({ id: r.id, body: bodyState(r.body), fields: r.recoveryState() })),
      auto: [...this.autoPilots].map(([id, pilot]) => [id, capturePilot(pilot)] as const),
      bots: [...this.botPilots].map(([id, pilot]) => [id, capturePilot(pilot)] as const),
    };
  }

  restoreRecovery(state: SimRecovery): void {
    const { world } = this;
    if (state.version !== 1 || state.seasonId !== this.season.id || !world.rules.restoreRecovery) throw new Error('Incompatible match checkpoint');
    world.clock.restore(state.clock); world.score.restore(state.score); world.rng.restore(state.rng);
    for (const robot of world.robots) { robot.bay?.clear(); robot.mech?.clear(); }
    world.pool.restoreRecovery(state.pool);
    world.rules.restoreRecovery(state.rules);
    for (const saved of state.robots) {
      const robot = world.robot(saved.id);
      if (!robot) throw new Error('Checkpoint robot missing');
      restoreBody(robot.body, saved.body); robot.restoreRecovery(saved.fields);
    }
    for (const [id, saved] of state.auto) { const pilot = this.autoPilots.get(id); if (pilot) restorePilot(pilot, saved); }
    for (const [id, saved] of state.bots) { const pilot = this.botPilots.get(id); if (pilot) restorePilot(pilot, saved); }
    restoreFields(this, ['state', 'pausedFrom', 'countdown', 'simTime', 'results'], state.fields);
  }
}

export type SimRecovery = ReturnType<MatchSim['recoveryState']>;
