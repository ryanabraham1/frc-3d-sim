import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance, FieldPose } from '../src/engine/coords';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND, type RobotCommand } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { inch } from '../src/engine/units';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { heroRobotPresets } from '../src/seasons/wcp-hero-heist/config';
import { CLASS_LIMITS, TOWER_HEIGHT_LIMIT, pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
import { CHUTE, DISTRICTS, PAD_Y, collectorZone, towerZone, trussX } from '../src/seasons/wcp-hero-heist/geometry';
import { shootingSpot } from '../src/seasons/wcp-hero-heist/bots';
import type { HeroHeistRules, HeroNetState } from '../src/seasons/wcp-hero-heist/rules';
import { pointInPolygon } from '../src/engine/zones';
import { packCommand, unpackCommand } from '../src/engine/net/protocol';

beforeAll(async () => { await RAPIER.init(); });
const sims: HeadlessSim[] = [];
afterEach(() => { while (sims.length) sims.pop()!.dispose(); });

const preset = (id: string): RobotConfig => cloneConfig(heroRobotPresets().find(p => p.id === id)!.config);
function make(robot: RobotConfig, alliance: Alliance = 'blue', pose: FieldPose = heroHeist.startPose(alliance, 2), extra: ConstructorParameters<typeof HeadlessSim>[2]['extraRobots'] = []) {
  const sim = new HeadlessSim(heroHeist, RAPIER, { robot, alliance, pose, extraRobots: extra });
  sims.push(sim);
  return sim;
}
const rules = (sim: HeadlessSim) => sim.rules as HeroHeistRules;
function start(sim: HeadlessSim) { sim.rules.onPeriodChange(sim.ctx.clock.start()); }
/** Physics AND the match clock. */
function run(sim: HeadlessSim, seconds: number, cmd: RobotCommand | (() => RobotCommand) = IDLE_COMMAND) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
    sim.step(typeof cmd === 'function' ? cmd() : cmd);
  }
}
/** Jump the clock to `t` s after the start (no physics). */
function jump(sim: HeadlessSim, t: number) { for (const ch of sim.ctx.clock.advance(t - sim.ctx.clock.elapsed)) sim.rules.onPeriodChange(ch); }
const firstOf = (sim: HeadlessSim, color: Alliance, kind: 'bubble' | 'panel') => {
  for (let i = 0; i < sim.pool.count; i++) { const id = pieceIdentity(i); if (id.color === color && id.kind === kind && sim.pool.state[i] === 'reserve') return i; }
  throw new Error('none left');
};
function givePanel(sim: HeadlessSim, color: Alliance = sim.robot.alliance) {
  const i = firstOf(sim, color, 'panel');
  sim.pool.hold(i, sim.robot.id);
  rules(sim).panels.set(sim.robot.id, [...(rules(sim).panels.get(sim.robot.id) ?? []), i]);
  return i;
}

describe('WCP CADathon: Hero Heist — registration', () => {
  it('is a standalone game, not presented as a 2025 season', () => {
    expect(heroHeist.id).toBe('wcp-hero-heist');
    expect(heroHeist.label).toBe('WCP CADathon: Hero Heist');
    expect(heroHeist.endgameSeconds).toBe(20);
    expect(heroHeist.mapSymmetry).toBe('mirror');
  });
});

describe('Hero Heist staging and piece conservation (manual pp. 9-10)', () => {
  it('stages 15 bubbles and 5 panels per color, draws legal preloads from the stock and conserves all 84 pieces', () => {
    const sim = make(preset('gadgeteer-hybrid'));
    sim.rules.stage();
    const count = (state: string, color: Alliance, kind: string) => [...Array(84).keys()].filter(i => sim.pool.state[i] === state && pieceIdentity(i).color === color && pieceIdentity(i).kind === kind).length;
    for (const a of ['red', 'blue'] as const) {
      expect(count('field', a, 'bubble')).toBe(15);
      expect(count('field', a, 'panel')).toBe(5);
    }
    // The gadgeteer preloads 1 panel and 3 bubbles of its own color.
    expect(rules(sim).panelCount(sim.robot)).toBe(1);
    expect(sim.robot.held).toHaveLength(3);
    expect(count('reserve', 'blue', 'bubble')).toBe(12);
    expect(count('reserve', 'blue', 'panel')).toBe(6);
    expect(count('reserve', 'red', 'bubble') + count('reserve', 'red', 'panel')).toBe(15 + 7);
    expect(sim.pool.countIn('field') + sim.pool.countIn('held') + sim.pool.countIn('reserve')).toBe(84);
    // Blue's bubbles sit between the CENTER LINE and the blue TOWER ZONE.
    for (let i = 30; i < 60; i++) if (sim.pool.state[i] === 'field') expect(sim.frame.toField(sim.pool.position(i)).x).toBeLessThan(8.23);
  });
});

describe('Hero Heist CITY BLOCKS — real openings and exit sensors', () => {
  /** Throw a bubble at district `d` from just outside its window (offset along the window's u axis). */
  function throwAt(sim: HeadlessSim, i: number, d: (typeof DISTRICTS)[number], offset = 0) {
    const b = d.cityBlock, c = b.center, n = b.normal;
    const out = d.region === 'downtown' ? 0.45 : 0.4;
    const p = { x: c.x + n.x * out + b.u.x * offset, y: c.y + n.y * out + b.u.y * offset, z: c.z + n.z * out };
    const speed = 3.2;
    sim.pool.placeWorld(i, sim.frame.toWorld(p.x, p.y, p.z), sim.frame.velToWorld(-n.x * speed, -n.y * speed, -n.z * speed + 0.6));
  }
  it('a bubble through each of the 20 windows passes its exit sensor once, sets OWNERSHIP and returns to its squad', () => {
    const sim = make(preset('mystic-turret'), 'blue', { x: 8.2, y: 4.1, yaw: 0 });
    sim.rules.stage();
    start(sim); // AUTO
    for (const d of DISTRICTS) {
      const i = firstOf(sim, 'red', 'bubble');
      throwAt(sim, i, d);
      sim.run(1.2);
      expect(sim.pool.state[i], d.label).toBe('reserve');
      expect(sim.pool.tag[i], d.label).toBe('dc:red:bubble');
      expect(rules(sim).ownership.districts[d.id], d.label).toEqual({ support: 'red', strength: 1 });
    }
    expect(sim.ctx.score.category('red', 'autoBubbles')).toBe(40); // 20 neutral AUTO bubbles × 2
    expect(sim.ctx.score.counter('red', 'bubbles')).toBe(20);
  });
  it('a bubble aimed at the wall beside a window bounces off and does not score', () => {
    const sim = make(preset('mystic-turret'), 'blue', { x: 8.2, y: 4.1, yaw: 0 });
    sim.rules.stage();
    start(sim);
    for (const id of [1, 8, 12]) {
      const i = firstOf(sim, 'blue', 'bubble');
      throwAt(sim, i, DISTRICTS[id], 0.55);
      sim.run(1.2);
      expect(rules(sim).ownership.districts[id].strength, DISTRICTS[id].label).toBe(0);
    }
  });
  it.each([8, 12, 13, 19] as const)('the real launcher scores into %s from a legal LAUNCH ZONE spot', (id) => {
    const d = DISTRICTS[id];
    const spot = shootingSpot(d);
    const c = d.cityBlock.center;
    const cfg = preset('mystic-turret');
    cfg.launcher.spread = 0; cfg.launcher.speedError = 0;
    const sim = make(cfg, 'blue', { ...spot, yaw: Math.atan2(c.y - spot.y, c.x - spot.x) });
    sim.run(0.4);
    rules(sim).preferredBlock.set(sim.robot.id, id);
    sim.load(4);
    expect(rules(sim).fullyInLaunchZone(sim.robot)).toBe(true);
    sim.run(5, { ...IDLE_COMMAND, shoot: true });
    sim.run(2);
    const sensed = sim.ctx.score.counter('red', 'bubbleSensed') + sim.ctx.score.counter('blue', 'bubbleSensed');
    expect(sensed, d.label).toBeGreaterThanOrEqual(3);
  });
});

describe('Hero Heist MAILBOXES — physical alignment decides a delivery', () => {
  it.each([[8, 'DOWNTOWN slit'], [1, 'UPTOWN diagonal slit'], [12, 'low FOOTHILL basket'], [13, 'high FOOTHILL basket']])('a squared-up COMMANDER delivers into district %i (%s)', (id: number) => {
    const sim = make(preset('commander-roller'));
    const d = DISTRICTS[id];
    // Low and high baskets share an approach; the robot takes the one a panel helps most (high on a tie).
    if (id === 12) rules(sim).ownership.districts[13] = { support: 'blue', strength: 4 };
    sim.robot.resetTo(rules(sim).alignPose(sim.robot, d));
    sim.run(0.3);
    givePanel(sim);
    start(sim);
    jump(sim, 20); // TELEOP
    run(sim, 2.5, { ...IDLE_COMMAND, pass: true });
    expect(rules(sim).panelCount(sim.robot)).toBe(0);
    expect(rules(sim).ownership.districts[id], d.label).toEqual({ support: 'blue', strength: 2 });
    expect(sim.ctx.score.category('blue', 'ownership')).toBe(id === 12 ? 35 : 10);
  });
  it('with the driver aligning (no assist) a panel 2 in off the slit hits the wall and drops to the carpet', () => {
    const cfg = preset('commander-roller');
    cfg.options = { ...cfg.options, placeAlign: false };
    const sim = make(cfg);
    const d = DISTRICTS[8];
    sim.robot.resetTo(rules(sim).alignPose(sim.robot, d, inch(2)));
    sim.run(0.3);
    const i = givePanel(sim);
    start(sim); jump(sim, 20);
    run(sim, 2.5, { ...IDLE_COMMAND, pass: true });
    expect(rules(sim).ownership.districts[8].strength).toBe(0);
    expect(sim.pool.state[i]).toBe('field');
    expect(sim.frame.toField(sim.pool.position(i)).z).toBeLessThan(0.1);
  });
  it('the vision assist squares the robot up from a sloppy approach and delivers', () => {
    const sim = make(preset('gadgeteer-hybrid'));
    const d = DISTRICTS[9];
    const p = rules(sim).alignPose(sim.robot, d, inch(5), 0.15);
    sim.robot.resetTo({ ...p, yaw: p.yaw + 0.12 });
    sim.run(0.3);
    givePanel(sim);
    start(sim); jump(sim, 20);
    run(sim, 3.5, { ...IDLE_COMMAND, pass: true });
    expect(rules(sim).ownership.districts[9]).toEqual({ support: 'blue', strength: 2 });
  });
  it('a GADGETEER (60 in max) in a FOOTHILL column delivers into the low basket, never the high one', () => {
    const sim = make(preset('gadgeteer-hybrid'));
    sim.robot.resetTo(rules(sim).alignPose(sim.robot, DISTRICTS[13]));
    sim.run(0.3);
    givePanel(sim);
    start(sim); jump(sim, 20);
    run(sim, 2.5, { ...IDLE_COMMAND, pass: true });
    expect(rules(sim).ownership.districts[13].strength).toBe(0);
    expect(rules(sim).ownership.districts[12]).toEqual({ support: 'blue', strength: 2 });
  });
  it('follows the manual\'s worked example: blue +3 → three red panels → neutral, red 2, red 4', () => {
    const sim = make(preset('commander-roller'), 'red');
    const d = DISTRICTS[6];
    rules(sim).ownership.districts[6] = { support: 'blue', strength: 3 };
    sim.robot.resetTo(rules(sim).alignPose(sim.robot, d));
    sim.run(0.3);
    for (let k = 0; k < 3; k++) givePanel(sim);
    start(sim); jump(sim, 20);
    const seen: string[] = [];
    run(sim, 6, () => { const s = rules(sim).ownership.districts[6]; const key = `${s.support}:${s.strength}`; if (seen.at(-1) !== key) seen.push(key); return { ...IDLE_COMMAND, pass: true }; });
    expect(seen).toEqual(['blue:3', 'null:0', 'red:2', 'red:4']);
    expect(sim.ctx.score.category('red', 'ownership')).toBe(25);
  });
});

describe('Hero Heist hero classes (manual p. 18)', () => {
  it('GADGETEER possession: (1,3), (2,0), (0,4) legal; (2,1) and (1,4) refused at the intake; shared tools never mix', () => {
    const cfg = preset('gadgeteer-hybrid');
    cfg.options = { ...cfg.options, panelCapacity: 2, bubbleCapacity: 4 };
    const sim = make(heroHeist.normalizeRobotConfig!(cfg));
    const r = rules(sim);
    expect(r.canTake(sim.robot, 'panel')).toBe(true);
    givePanel(sim);
    sim.load(3);
    expect(r.canTake(sim.robot, 'bubble')).toBe(false); // (1,4)
    expect(r.canTake(sim.robot, 'panel')).toBe(false); // (2,3)
    const flex = make(preset('gadgeteer-flex'));
    flex.load(1);
    expect(rules(flex).canTake(flex.robot, 'panel')).toBe(false);
    expect(rules(flex).canTake(flex.robot, 'bubble')).toBe(true);
  });
  it('MYSTICs never touch panels and COMMANDERs never touch bubbles', () => {
    const m = make(preset('mystic-fixed'));
    expect(rules(m).canTake(m.robot, 'panel')).toBe(false);
    const c = make(preset('commander-simple'));
    expect(rules(c).canTake(c.robot, 'bubble')).toBe(false);
    expect(c.robot.config.launcher.enabled).toBe(false);
    expect(c.robot.config.intake.ground).toBe(false);
  });
  it('every preset starts legally inside its TOWER ZONE within its class limits', () => {
    for (const p of heroRobotPresets()) {
      const sim = make(p.config, 'red', heroHeist.startPose('red', 1));
      const hero = p.config.options!.heroClass as keyof typeof CLASS_LIMITS;
      expect(p.config.height).toBeLessThanOrEqual(CLASS_LIMITS[hero].startHeight);
      expect(sim.robot.corners().every(q => pointInPolygon(q, towerZone('red')))).toBe(true);
    }
  });
});

describe('Hero Heist human players (DISTRIBUTION CENTER)', () => {
  it.each(['blue', 'red'] as const)('%s: H opens the chute and bubbles stream out until closed; B slides a panel over the guardrail', (a) => {
    const sim = make(preset('gadgeteer-hybrid'), a, { x: a === 'blue' ? 3 : 13.4, y: 5, yaw: 0 });
    sim.rules.stage();
    start(sim);
    const ours = (kind: string) => sim.pool.indices('field').filter(i => pieceIdentity(i).color === a && pieceIdentity(i).kind === kind).length;
    const bubbles0 = ours('bubble'), panels0 = ours('panel');
    rules(sim).humanPlayerAction(a, 1);
    rules(sim).humanPlayerAction(a, 2);
    run(sim, 2.5);
    expect(rules(sim).chuteOpen[a]).toBe(true);
    expect(ours('bubble') - bubbles0).toBeGreaterThanOrEqual(5);
    expect(ours('panel') - panels0).toBe(1);
    rules(sim).humanPlayerAction(a, 1); // close
    const fed = ours('bubble');
    run(sim, 1.5);
    expect(ours('bubble')).toBe(fed);
    const landed = sim.pool.indices('field').map(i => ({ i, p: sim.frame.toField(sim.pool.position(i)) })).filter(({ i, p }) => pieceIdentity(i).color === a && p.y < 2.2 && p.z < 0.2);
    expect(landed.filter(({ i }) => pieceIdentity(i).kind === 'bubble').length).toBeGreaterThanOrEqual(5);
    expect(landed.some(({ i, p }) => pieceIdentity(i).kind === 'panel' && pointInPolygon(p, collectorZone(a)))).toBe(true);
    for (const { i, p } of landed) if (pieceIdentity(i).kind === 'bubble') expect(p.y).toBeLessThan(CHUTE.y1 + 1.2);
  });
});

describe('Hero Heist TOWER (manual p. 5, G18-G20)', () => {
  it('HIGH clears 45 in, MEDIUM 35 in, and a 46 in COMMANDER is limited to LOW to stay under 78 in', () => {
    const cases: [string, number, number][] = [['mystic-fixed', 3, 50], ['mystic-turret', 2, 35], ['commander-roller', 1, 20]];
    for (const [id, level, pts] of cases) {
      const sim = make(preset(id), 'blue', { x: trussX('blue'), y: PAD_Y[1], yaw: 0 });
      sim.run(0.3);
      start(sim); jump(sim, 120);
      run(sim, 9, { ...IDLE_COMMAND, climb: 3 });
      const r = rules(sim);
      expect(r.towerLevel(sim.robot), id).toBe(level);
      expect(r.robotTowerPoints(sim.robot), id).toBe(pts);
      expect(sim.robot.elevation + sim.robot.config.height, id).toBeLessThanOrEqual(TOWER_HEIGHT_LIMIT + 1e-6);
      run(sim, 10); // match ends: assessed and final
      expect(sim.ctx.score.category('blue', 'tower')).toBe(pts);
    }
  });
  it('a robot parked in its TOWER ZONE earns 5; the tower RP needs 60', () => {
    const sim = make(preset('commander-simple'), 'blue', heroHeist.startPose('blue', 1));
    sim.run(0.3);
    start(sim); jump(sim, 134);
    run(sim, 7);
    expect(sim.ctx.score.category('blue', 'tower')).toBe(5);
    expect(sim.rules.results().rpDetail.blue).not.toContain('TOWER');
  });
});

describe('Hero Heist fouls and RP', () => {
  it('G21: launching from outside the LAUNCH ZONE is a FOUL; from inside it is legal', () => {
    const cfg = preset('mystic-turret');
    const outside = make(cfg, 'blue', { x: 2.2, y: 2.0, yaw: 0 });
    outside.run(0.3); outside.load(1); start(outside);
    rules(outside).preferredBlock.set(0, 6);
    run(outside, 2, { ...IDLE_COMMAND, shoot: true });
    expect(outside.ctx.score.fouls.map(f => f.rule)).toContain('G21');
    const inside = make(cfg, 'blue', { x: 6.4, y: 5.5, yaw: Math.PI / 2 });
    inside.run(0.3); inside.load(1); start(inside);
    run(inside, 2, { ...IDLE_COMMAND, shoot: true });
    expect(inside.fired).toBe(1);
    expect(inside.ctx.score.fouls).toHaveLength(0);
  });
  it.each(heroRobotPresets().filter(p => p.config.launcher.enabled).map(p => p.id))('%s fires its bubbles with its archetype model attached', (id) => {
    const sim = make(preset(id), 'blue', { x: 6.4, y: 5.5, yaw: Math.PI / 2 });
    expect(sim.robot.config.model).toBe(`hero-${id}`);
    sim.run(0.3); sim.load(3);
    sim.run(3, { ...IDLE_COMMAND, shoot: true });
    expect(sim.fired).toBe(3);
  });
  it('G14: contacting an opponent in its COLLECTOR ZONE is a FOUL; in its TOWER ZONE in the last 20 s it awards a HIGH CLIMB', () => {
    const sim = make(preset('mystic-fixed'), 'blue', { x: 14.5, y: 1.95, yaw: -Math.PI / 2 },
      [{ config: preset('mystic-fixed'), alliance: 'red', station: 1, pose: { x: 14.5, y: 0.6, yaw: 0 }, id: 1 }]);
    sim.run(0.3);
    start(sim); jump(sim, 30);
    run(sim, 1.5, { ...IDLE_COMMAND, vy: -1.5 });
    expect(sim.ctx.score.fouls.some(f => f.rule === 'G14' && f.alliance === 'blue')).toBe(true);
    const tower = make(preset('mystic-fixed'), 'blue', { x: 11.2, y: 4.9, yaw: 0 },
      [{ config: preset('mystic-fixed'), alliance: 'red', station: 1, pose: heroHeist.startPose('red', 2), id: 1 }]);
    tower.run(0.3);
    start(tower); jump(tower, 120);
    run(tower, 1.5, { ...IDLE_COMMAND, vx: 1.5 });
    expect(rules(tower).forcedHigh.has(1)).toBe(true);
    run(tower, 20);
    expect(tower.ctx.score.category('red', 'tower')).toBe(50);
  });
  it('AUTO exit RP: counts robots whose bumpers fully leave the TOWER ZONE', () => {
    const sim = make(preset('mystic-fixed'));
    sim.run(0.3);
    start(sim);
    run(sim, 2, { ...IDLE_COMMAND, vx: 2 });
    expect(rules(sim).exited.has(sim.robot.id)).toBe(true);
    expect(sim.ctx.score.counter('blue', 'autoLeave')).toBe(1);
  });
});

describe('Hero Heist manual shot targets', () => {
  it.each([[3, { x: 8.2, y: 4.6 }], [9, { x: 8.2, y: 3.4 }], [12, { x: 2.6, y: 5.0 }], [5, { x: 8.2, y: 4.6 }]] as const)('a turret driver who picks district %i scores there', (id, at) => {
    const cfg = preset('mystic-turret');
    cfg.launcher.spread = 0; cfg.launcher.speedError = 0;
    const sim = make(cfg, 'blue', { ...at, yaw: 0 });
    sim.run(0.3); sim.load(4); start(sim);
    run(sim, 4, { ...IDLE_COMMAND, shoot: true, aimTarget: id });
    run(sim, 2);
    expect(rules(sim).targets.get(sim.robot.id)).toBe(id);
    expect(rules(sim).ownership.districts[id].support, DISTRICTS[id].label).toBe('red'); // load() hands out red bubbles
    for (const d of DISTRICTS) if (d.id !== id) expect(rules(sim).ownership.districts[d.id].strength, d.label).toBe(0);
  });
  it('only targets on the driver\'s screen count: automatic picks among them and an off-screen pick is ignored', () => {
    const sim = make(preset('mystic-turret'), 'blue', { x: 8.2, y: 4.6, yaw: 0 });
    sim.run(0.3); sim.load(2);
    const r = rules(sim);
    const onlyDowntown = [6, 7, 8, 9, 10, 11].reduce((m, id) => m | (1 << id), 0);
    sim.robot.lastCommand = { ...IDLE_COMMAND, aimTarget: -1, aimVisible: onlyDowntown };
    expect(DISTRICTS[r.targetFor(sim.robot)!.id].region).toBe('downtown');
    sim.robot.lastCommand = { ...IDLE_COMMAND, aimTarget: 3, aimVisible: onlyDowntown };
    expect(r.targetFor(sim.robot)!.id).not.toBe(3);
    sim.robot.lastCommand = { ...IDLE_COMMAND, aimTarget: 3, aimVisible: onlyDowntown | (1 << 3) };
    expect(r.targetFor(sim.robot)!.id).toBe(3);
    sim.robot.lastCommand = { ...IDLE_COMMAND, aimTarget: -1, aimVisible: 0 };
    expect(r.targetFor(sim.robot)).toBeNull();
    expect(heroHeist.aimTargets!.every(t => t.point)).toBe(true);
  });
  it('the pick travels in multiplayer commands; automatic stays the default', () => {
    expect(unpackCommand(JSON.parse(JSON.stringify(packCommand({ ...IDLE_COMMAND, aimVisible: (1 << 19) | 5 }))))).toMatchObject({ aimTarget: -1, aimVisible: (1 << 19) | 5 });
    const cmd = { ...IDLE_COMMAND, shoot: true, aimTarget: 17 };
    expect(unpackCommand(JSON.parse(JSON.stringify(packCommand(cmd))))).toMatchObject({ shoot: true, aimTarget: 17 });
    expect(unpackCommand(packCommand({ ...IDLE_COMMAND, aimTarget: -1 }))?.aimTarget).toBe(-1);
    expect(unpackCommand(packCommand(IDLE_COMMAND))?.aimTarget).toBeUndefined();
    expect(heroHeist.aimTargets).toHaveLength(20);
  });
});

describe('Hero Heist multiplayer state', () => {
  it('net state survives JSON and restores ownership, inventory and tower awards on a replica', () => {
    const host = make(preset('commander-roller'));
    host.rules.stage();
    rules(host).ownership.accept(3, 'red', 'panel', 'teleop');
    rules(host).ownership.accept(3, 'red', 'bubble', 'teleop');
    rules(host).forcedHigh.add(0);
    const wire = JSON.parse(JSON.stringify(host.rules.netState!())) as HeroNetState;
    const client = make(preset('commander-roller'));
    client.rules.applyNetState!(wire);
    expect(rules(client).ownership.districts[3]).toEqual({ support: 'red', strength: 2 }); // a bubble into its own partial district changes nothing
    expect(rules(client).panelCount(client.robot)).toBe(1);
    expect(rules(client).forcedHigh.has(0)).toBe(true);
    expect(rules(client).netState()).toEqual(wire);
  });
});

