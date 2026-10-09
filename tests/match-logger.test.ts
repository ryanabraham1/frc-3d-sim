/**
 * MATCH LOGGER — the JSONL a behaviour-cloning run trains on. Real Rapier loop (HeadlessSim) on every season:
 * the human's executed commands and poses are recorded at 30 Hz, bots carry no commands, shots and score events
 * show up, and the file is self-describing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { COMMAND_FIELDS, ROBOT_FIELDS, SRC } from '../src/engine/telemetry/matchLogger';
import type { RobotCommand } from '../src/engine/robot/robot';

beforeAll(async () => { await RAPIER.init(); });
const sims: HeadlessSim[] = [];
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); });

const parse = (text: string) => text.trim().split('\n').map((l) => JSON.parse(l));

describe.each(SEASONS.map((s) => [s.id, s] as const))('match logger %s', (_id, season) => {
  function make() {
    // Standalone games without real robots (WCP CADathon) log their first archetype preset.
    const build = (season.teamRobots ?? season.robotPresets!)[0];
    const cfg = cloneConfig(build.config);
    const sim = new HeadlessSim(season, RAPIER, {
      robot: cfg, alliance: 'blue', pose: season.startPose('blue', 1), log: true,
      extraRobots: [{ config: cloneConfig(build.config), alliance: 'red', station: 1, id: 7, pose: season.startPose('red', 1) }],
    });
    sims.push(sim);
    return sim;
  }

  it('records the human commands and poses at 30 Hz, no commands for bots', () => {
    const sim = make();
    const cmd: RobotCommand = { vx: 1.5, vy: 0, omega: 0.3, intake: true, shoot: false, pass: false, climb: null, descend: false };
    sim.run(2, cmd);
    sim.log!.finish({ blue: 0, red: 0 });
    const lines = parse(sim.log!.toJSONL());
    const header = lines[0];
    expect(header.type).toBe('header');
    expect(header.robotFields).toEqual([...ROBOT_FIELDS]);
    expect(header.commandFields).toEqual([...COMMAND_FIELDS]);
    expect(header.robots.map((r: { id: number }) => r.id)).toEqual([0, 7]);
    expect(lines.at(-1).type).toBe('end');

    const frames = lines.filter((l) => l.type === 'frame');
    expect(frames.length).toBeGreaterThan(50);
    expect(frames.length).toBeLessThan(70);
    const last = frames.at(-1);
    const human = last.rows.find((r: { r: number[] }) => r.r[0] === 0);
    const bot = last.rows.find((r: { r: number[] }) => r.r[0] === 7);
    expect(human.r[ROBOT_FIELDS.indexOf('src')]).toBe(SRC.human);
    expect(human.c[COMMAND_FIELDS.indexOf('vx')]).toBeCloseTo(1.5, 1);
    expect(human.c[COMMAND_FIELDS.indexOf('intake')]).toBe(1);
    expect(bot.r[ROBOT_FIELDS.indexOf('src')]).toBe(SRC.bot);
    expect(bot.c).toBeUndefined();
    // The robot actually moved, so the logged pose follows the sim.
    const x0 = frames[0].rows[0].r[1], x1 = last.rows[0].r[1];
    expect(Math.abs(x1 - x0)).toBeGreaterThan(0.5);
    expect(lines.some((l) => l.type === 'pieces')).toBe(true);
    expect(lines.some((l) => l.type === 'period')).toBe(true);
  });

  it('records each robot\'s archetype: label from the season lineup + mechanism features', () => {
    const sim = make();
    sim.run(0.2);
    sim.log!.finish();
    const [bot0] = parse(sim.log!.toJSONL())[0].robots;
    const first = (season.teamRobots ?? season.robotPresets!)[0];
    expect(bot0.archetype.label).toBe(first.id);
    const f = bot0.archetype.features;
    expect(['none', 'fixed', 'pivot', 'turret']).toContain(f.shooter);
    expect(f.capacity).toBe(first.config.hopperCapacity);
    expect(f.team).toBe(first.config.teamNumber);
    // A tweaked build is still described by its mechanisms, labelled custom.
    const tweaked = cloneConfig(first.config);
    tweaked.mass -= 3; // down, so the season's max-weight clamp can't undo it
    const sim2 = new HeadlessSim(season, RAPIER, { robot: tweaked, alliance: 'blue', pose: season.startPose('blue', 1), log: true });
    sims.push(sim2);
    const h2 = parse(sim2.log!.toJSONL())[0].robots[0].archetype;
    expect(h2.label).toMatch(/^(custom|model:)/);
    expect(h2.features.mass).toBeCloseTo(sim2.robot.config.mass, 5);
  });

  it('logs launches', () => {
    const sim = make();
    sim.load(3);
    sim.run(3, { vx: 0, vy: 0, omega: 0, intake: false, shoot: true, pass: false, climb: null, descend: false });
    const lines = parse(sim.log!.toJSONL());
    expect(lines.filter((l) => l.type === 'launch').length).toBe(sim.fired);
  });
});
