import { beforeAll, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { localSetup } from '../src/engine/core/game';
import { defaultSettings } from '../src/app/menu';
import { SEASONS } from '../src/seasons';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
const log = (...a: unknown[]) => process.stderr.write(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

it.each(SEASONS.flatMap((s, i) => [1, 2, 3].map((seed) => [s.id, i, seed] as const)))('bench %s %i %i', (_id, idx, seed) => {
  const season = SEASONS[idx];
  const settings = { ...defaultSettings(season), aiDifficulty: 'hard' as const };
  const setup = localSetup(settings, season);
  const sim = new HeadlessSim(season, R, {
    robot: setup.robots[0].config, alliance: settings.alliance, station: settings.station, pose: setup.robots[0].start!, seed,
    extraRobots: setup.robots.slice(1).map((r) => ({ ...r, pose: r.start! })),
  });
  try {
    sim.ctx.settings.aiDifficulty = 'hard';
    sim.ctx.humanPlayerIsAuto = () => true;
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(season.timeline.filter((p) => p.mode !== 'teleop').slice(0, 2).reduce((s, p) => s + p.duration, 0))) sim.rules.onPeriodChange(change);
    // The player's robot is a bot too (Normal teammate behaviour) so we measure Hard vs Normal.
    const pilots = sim.ctx.robots.map((r) => season.createBotPilot!(sim.ctx, sim.rules, r));
    const dt = sim.physics.dt;
    let near = 0, atSource = 0;
    for (let step = 0; step < 100 / dt; step++) {
      for (const change of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(change);
      for (const [i, r] of sim.ctx.robots.entries()) {
        r.enabled = true;
        let cmd = pilots[i]?.update(dt) ?? { ...IDLE_COMMAND };
        if (sim.rules.adjustCommand) cmd = sim.rules.adjustCommand(r, cmd, dt);
        const target = cmd.pass && !cmd.shoot && sim.rules.passTarget ? sim.rules.passTarget(r) : sim.rules.aimTarget(r);
        cmd = r.autoAlign(cmd, target);
        if (season.year === 2026 && r.alliance !== settings.alliance && r.station === 3) {
          const d = Math.min(...sim.ctx.robots.filter((o) => o.alliance === settings.alliance).map((o) => Math.hypot(r.pose.x - o.pose.x, r.pose.y - o.pose.y)));
          if (d < 1.4) near++;
        }
        if (season.year === 2024 && r.alliance !== settings.alliance && r.pose.x < 3 && r.pose.y < 2) atSource++;
        r.lastCommand = cmd; r.drive(cmd, dt); r.tick(dt); r.aimTurretAt(target, dt);
        const handled = sim.rules.handleMechanisms?.(r, cmd, dt);
        if (!handled && (cmd.shoot || cmd.pass)) {
          const shot = r.launch(target, sim.rng);
          if (shot) { const piece = r.held.pop()!; sim.pool.placeWorld(piece, shot.pos, shot.vel); r.noteLaunch(piece); sim.rules.onLaunch(r, piece); }
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
      if (false && step % 450 === 0) log(Math.round(step * dt), sim.ctx.robots.filter((r) => r.alliance === "red").map((r) => `${r.station}:(${r.pose.x.toFixed(1)},${r.pose.y.toFixed(1)}) h${r.held.length} ${r.lastCommand.shoot ? "S" : ""}${r.lastCommand.intake ? "I" : ""}`).join("  "), sim.pool.indices("field").map((i) => sim.frame.toField(sim.pool.position(i))).filter((q) => q.x < 4 && q.y < 3).map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}`).join(" "));
      sim.rules.beforeStep(dt); sim.pool.updateDamping(); sim.physics.step(); sim.rules.afterStep(dt);
    }
    const pts = sim.ctx.robots.map((r) => `${r.alliance[0]}${r.station}:${Object.values(sim.ctx.score.robots[r.id]?.points ?? {}).reduce((s, n) => s + n, 0)}`);
    log(season.id, seed, 'player', settings.alliance, 'earned', { blue: sim.ctx.score.earned('blue'), red: sim.ctx.score.earned('red') }, pts.join(' '), 'defNear', near, 'atSource', atSource);
  } finally { sim.dispose(); }
});
