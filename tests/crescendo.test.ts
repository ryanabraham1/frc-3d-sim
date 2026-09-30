import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance, FieldPose } from '../src/engine/coords';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND, type RobotCommand } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { crescendo2024 as season } from '../src/seasons/2024-crescendo';
import { CrescendoRules } from '../src/seasons/2024-crescendo/rules';
import * as C from '../src/seasons/2024-crescendo/constants';
import { ampPoints, ensembleEarned, melodyEarned, speakerPoints, stagePoints } from '../src/seasons/2024-crescendo/scoring';
import { crescendoRobotOptions, crescendoRobotPresets, normalizeCrescendoConfig } from '../src/seasons/2024-crescendo/config';

const sims: HeadlessSim[] = [];
beforeAll(async () => {
  await RAPIER.init();
});
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

function make(a: Alliance = 'blue', pose: FieldPose = season.startPose(a, 2), robot = cloneConfig(season.robotDefaults)) {
  const sim = new HeadlessSim(season, RAPIER, { robot, alliance: a, pose });
  sims.push(sim);
  return sim;
}
const rules = (sim: HeadlessSim) => sim.rules as CrescendoRules;
const preset = (id: string) => cloneConfig(crescendoRobotPresets().find((p) => p.id === id)!.config);
/** Step physics AND the match clock (HeadlessSim.step alone never advances the clock). */
function run(sim: HeadlessSim, seconds: number, cmd: RobotCommand | (() => RobotCommand) = IDLE_COMMAND) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
    sim.step(typeof cmd === 'function' ? cmd() : cmd);
  }
}
function startMatch(sim: HeadlessSim) {
  sim.rules.onPeriodChange(sim.ctx.clock.start());
}
/** Jump the clock (no physics) — `seconds` after the match start. */
function jump(sim: HeadlessSim, seconds: number) {
  startMatch(sim);
  for (const ch of sim.ctx.clock.advance(seconds)) sim.rules.onPeriodChange(ch);
}
const TELEOP = 18;
const ENDGAME = 18 + 115;
function give(sim: HeadlessSim, i = C.FIELD_NOTES) {
  sim.pool.hold(i, sim.robot.id);
  sim.robot.held.push(i);
}
const ampPose = (a: Alliance): FieldPose => {
  const amp = C.ampCenter(a);
  return { x: amp.x, y: C.W - inch(33) / 2 - 0.06, yaw: Math.PI / 2 };
};
const inch = (v: number) => v * 0.0254;

describe('2024 CRESCENDO — manual facts', () => {
  it('uses the manual timing, penalties and robot limits', () => {
    expect(season.timeline.filter((p) => p.mode !== 'disabled').reduce((t, p) => t + p.duration, 0)).toBe(150);
    expect(season.timeline.find((p) => p.id === 'auto')!.duration).toBe(15);
    expect(season.foulValues).toEqual({ minor: 2, major: 5 });
    expect(season.maxRobotHeight).toBeCloseTo(inch(48));
    const c = normalizeCrescendoConfig({ ...cloneConfig(season.robotDefaults), hopperCapacity: 80, preload: 8 });
    expect(c.hopperCapacity).toBe(1);
    expect(c.preload).toBe(1);
  });

  it('matches Table 6-2 point values and RP thresholds', () => {
    expect([speakerPoints(true, false), speakerPoints(false, false), speakerPoints(false, true)]).toEqual([5, 2, 5]);
    expect([ampPoints(true), ampPoints(false)]).toEqual([2, 1]);
    // Two robots on one SPOTLIT chain + one parked + 1 TRAP: 4 + 4 + HARMONY 2 + PARK 1 + TRAP 5.
    const s = stagePoints([{ chain: 0, inStageZone: true }, { chain: 0, inStageZone: true }, { chain: null, inStageZone: true }], [true, false, false], 1);
    expect(s).toMatchObject({ onstage: 8, harmony: 2, park: 1, trap: 5, total: 16, onstageCount: 2 });
    expect(stagePoints([{ chain: 1, inStageZone: true }, { chain: 2, inStageZone: false }], [false, false, false], 0)).toMatchObject({ onstage: 6, harmony: 0, total: 6 });
    expect(melodyEarned(17, false)).toBe(false);
    expect(melodyEarned(18, false)).toBe(true);
    expect(melodyEarned(15, true)).toBe(true);
    expect(ensembleEarned(10, 2)).toBe(true);
    expect(ensembleEarned(16, 1)).toBe(false);
    expect(ensembleEarned(9, 3)).toBe(false);
  });

  for (const a of ['blue', 'red'] as const) {
    it(`stages 107 NOTES + 6 HIGH NOTES per 6.3.4 (${a} robot)`, () => {
      const sim = make(a);
      sim.rules.stage();
      expect(sim.pool.count).toBe(113);
      expect(sim.pool.indices('field')).toHaveLength(11);
      expect(sim.robot.held).toHaveLength(1);
      // 45 per SOURCE AREA + the unused preloads of the robot's alliance (1 robot here) / all 3 for the other.
      expect(sim.pool.indices('reserve', `source:${a}`)).toHaveLength(47);
      expect(sim.pool.indices('reserve', `source:${a === 'blue' ? 'red' : 'blue'}`)).toHaveLength(48);
      expect(sim.pool.indices('reserve', 'high:blue')).toHaveLength(3);
      expect(sim.pool.indices('reserve', 'high:red')).toHaveLength(3);
      // WING SPIKE MARKS 9 ft 6 in from the wall, 4 ft 9 in apart; CENTER LINE marks 5 ft 6 in apart.
      const wing = C.wingSpikes(a);
      expect(C.fromWall(a, wing[0].x)).toBeCloseTo(inch(114));
      expect(wing[1].y - wing[0].y).toBeCloseTo(inch(57));
      const ctr = C.centerSpikes();
      expect(ctr[1].y - ctr[0].y).toBeCloseTo(inch(66));
    });

    it(`scores ${a} SPEAKER shots in AUTO (5) and TELEOP (2)`, () => {
      const spot = season.testing!.scoringSpots(a)[5];
      const sim = make(a, spot);
      startMatch(sim);
      give(sim);
      run(sim, 2.5, { ...IDLE_COMMAND, shoot: true });
      expect(sim.ctx.score.category(a, 'autoSpeaker')).toBe(5);
      const sim2 = make(a, spot);
      jump(sim2, TELEOP + 1);
      give(sim2);
      run(sim2, 2.5, { ...IDLE_COMMAND, shoot: true });
      expect(sim2.ctx.score.category(a, 'speaker')).toBe(2);
      expect(sim2.ctx.score.counter(a, 'notes')).toBe(1);
    });

    it(`${a} AMP: 2 banked NOTES → AMPLIFY → amplified SPEAKER NOTES score 5; NOTES during AMPLIFICATION don't bank`, () => {
      const sim = make(a, ampPose(a));
      jump(sim, TELEOP + 1);
      const r = rules(sim);
      for (let k = 0; k < 2; k++) {
        give(sim, C.FIELD_NOTES + k);
        run(sim, 0.7, { ...IDLE_COMMAND, pass: true });
      }
      expect(sim.ctx.score.category(a, 'amp')).toBe(2);
      expect(r.bank[a]).toBe(2);
      expect(r.pressAmplify(a)).toBe(true);
      expect(r.bank[a]).toBe(0);
      give(sim, C.FIELD_NOTES + 2);
      run(sim, 0.7, { ...IDLE_COMMAND, pass: true });
      expect(r.bank[a]).toBe(0); // delivered while AMPLIFIED
      // Shoot into the AMPLIFIED SPEAKER from a scoring spot.
      sim.robot.resetTo(season.testing!.scoringSpots(a)[6]);
      give(sim, C.FIELD_NOTES + 3);
      run(sim, 2, { ...IDLE_COMMAND, shoot: true });
      expect(sim.ctx.score.category(a, 'speakerAmplified')).toBe(5);
      run(sim, 10);
      expect(r.amplified(a)).toBe(false);
    });
  }

  it('AMP NOTES in AUTO are worth 2 and the AMP needs the robot at its AMP', () => {
    const sim = make('blue', ampPose('blue'));
    startMatch(sim);
    give(sim);
    run(sim, 0.7, { ...IDLE_COMMAND, pass: true });
    expect(sim.ctx.score.category('blue', 'autoAmp')).toBe(2);
    expect(rules(sim).pressAmplify('blue')).toBe(false); // AMP button is a TELEOP action
  });

  it('Coopertition needs a banked NOTE in the first 45 s of TELEOP; both alliances → bonus + MELODY 15', () => {
    const sim = make('blue');
    const r = rules(sim);
    jump(sim, TELEOP + 5);
    expect(r.pressCoop('blue')).toBe(false);
    r.bank.blue = 1;
    r.bank.red = 1;
    expect(r.pressCoop('blue')).toBe(true);
    expect(r.bank.blue).toBe(0);
    expect(r.coopBonus()).toBe(false);
    for (const ch of sim.ctx.clock.advance(45)) sim.rules.onPeriodChange(ch);
    expect(r.pressCoop('red')).toBe(false); // window closed
    const s2 = make('blue');
    const r2 = rules(s2);
    jump(s2, TELEOP + 1);
    r2.bank.blue = r2.bank.red = 1;
    r2.pressCoop('blue');
    r2.pressCoop('red');
    expect(r2.coopBonus()).toBe(true);
    for (let k = 0; k < 15; k++) s2.ctx.score.inc('blue', 'notes');
    expect(r2.results().rpDetail.blue).toContain('MELODY');
  });

  it('LEAVE: clearing the ROBOT STARTING ZONE in AUTO scores 2', () => {
    const sim = make('blue', season.startPose('blue', 1));
    startMatch(sim);
    const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'leave');
    run(sim, 16, () => (sim.ctx.clock.mode === 'auto' ? auto.update(sim.physics.dt) : IDLE_COMMAND));
    expect(sim.ctx.score.category('blue', 'leave')).toBe(2);
  });

  it('the "Speaker + 3 wing notes" AUTO scores all four NOTES', () => {
    const sim = make('blue', season.startPose('blue', 2));
    sim.rules.stage();
    startMatch(sim);
    const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'wing-4');
    run(sim, 18, () => (sim.ctx.clock.mode === 'auto' ? auto.update(sim.physics.dt) : IDLE_COMMAND));
    expect(sim.ctx.score.counter('blue', 'speakerNotes')).toBe(4);
    expect(sim.ctx.score.category('blue', 'autoSpeaker')).toBe(20);
    expect(sim.ctx.score.category('blue', 'leave')).toBe(2);
    expect(sim.ctx.score.fouls).toHaveLength(0);
  });

  it('the "Amp + wing note" AUTO scores the AMP then the SPEAKER', () => {
    const sim = make('blue', season.startPose('blue', 1));
    sim.rules.stage();
    startMatch(sim);
    const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'amp-2');
    run(sim, 18, () => (sim.ctx.clock.mode === 'auto' ? auto.update(sim.physics.dt) : IDLE_COMMAND));
    expect(sim.ctx.score.category('blue', 'autoAmp')).toBe(2);
    expect(sim.ctx.score.category('blue', 'autoSpeaker')).toBe(5);
  });

  for (const a of ['blue', 'red'] as const) {
    it(`${a}: climbs a chain in TELEOP, scores a TRAP, and is assessed ONSTAGE (SPOTLIT 4)`, () => {
      const g = C.chainGeometry(a, 0);
      const pose = { x: g.mid.x + Math.cos(g.normal) * 0.35, y: g.mid.y + Math.sin(g.normal) * 0.35, yaw: g.normal + Math.PI };
      const sim = make(a, pose, preset('amp-trap'));
      const r = rules(sim);
      jump(sim, ENDGAME + 2);
      give(sim);
      run(sim, 4, { ...IDLE_COMMAND, climb: 1 });
      expect(sim.robot.climbPhase).toBe('hanging');
      expect(sim.robot.climbSlot).toBe(0);
      run(sim, 1, { ...IDLE_COMMAND, shoot: true });
      expect(sim.ctx.score.category(a, 'trap')).toBe(5);
      r.spotlit[a][0] = true;
      run(sim, 25);
      expect(sim.ctx.clock.finished).toBe(true);
      expect(sim.ctx.score.category(a, 'onstage')).toBe(4);
      expect(sim.ctx.score.counter(a, 'onstage')).toBe(1);
    });
  }

  it('climbing is refused away from the chains and outside TELEOP; parking in the STAGE ZONE scores 1', () => {
    const sim = make('blue', season.startPose('blue', 2));
    jump(sim, TELEOP + 1);
    run(sim, 1, { ...IDLE_COMMAND, climb: 1 });
    expect(sim.robot.isClimbing).toBe(false);
    const c = C.stageCenter('blue');
    const park = make('blue', { x: c.x - 0.6, y: c.y + 0.9, yaw: 0 });
    jump(park, ENDGAME + 1);
    run(park, 25);
    expect(park.ctx.score.category('blue', 'park')).toBe(1);
  });

  it('a HIGH NOTE dropping over a MICROPHONE SPOTLIGHTS that chain; HIGH NOTES only in the last 20 s (G430)', () => {
    const sim = make('blue');
    const r = rules(sim);
    sim.rules.stage();
    jump(sim, TELEOP + 5);
    expect(r.throwHighNote('blue')).toBe(false);
    const mic = C.micPoint('blue', 1);
    const idx = sim.pool.indices('reserve', 'high:blue')[0];
    sim.pool.placeWorld(idx, sim.frame.toWorld(mic.x, mic.y, mic.z + 0.3), sim.frame.velToWorld(0, 0, -1));
    run(sim, 0.5);
    expect(r.spotlit.blue[1]).toBe(true);
    const s2 = make('blue');
    s2.rules.stage();
    jump(s2, ENDGAME + 1);
    expect(rules(s2).throwHighNote('blue')).toBe(true);
    expect(rules(s2).highNotesLeft.blue).toBe(2);
  });

  it('HIGH NOTES thrown by the AMP human player land on the MICROPHONE most of the time', () => {
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: season.startPose('blue', 2), seed });
      sims.push(sim);
      sim.rules.stage();
      jump(sim, ENDGAME + 2);
      rules(sim).throwHighNote('blue');
      run(sim, 2);
      if (rules(sim).spotlit.blue.some(Boolean)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(5);
  });

  it('G404: an AUTO shot from outside the WING is a TECH FOUL; G414: full-court shots are a FOUL then TECH FOULS', () => {
    const sim = make('blue', { x: C.WING_DEPTH + 1, y: C.SPEAKER_Y, yaw: Math.PI });
    startMatch(sim);
    give(sim);
    run(sim, 0.5, { ...IDLE_COMMAND, shoot: true });
    expect(sim.ctx.score.fouls.map((f) => [f.rule, f.kind])).toEqual([['G404', 'major']]);
    expect(sim.ctx.score.foulPointsFor('red')).toBe(5);
    const s2 = make('blue', { x: C.L - C.WING_DEPTH + 0.5, y: C.SPEAKER_Y, yaw: Math.PI }, preset('turret'));
    jump(s2, TELEOP + 1);
    give(s2, C.FIELD_NOTES);
    give(s2, C.FIELD_NOTES + 1);
    run(s2, 1, { ...IDLE_COMMAND, shoot: true });
    expect(s2.ctx.score.fouls.map((f) => [f.rule, f.kind])).toEqual([['G414', 'minor'], ['G414', 'major']]);
  });

  /** Robot facing the SOURCE opening, `gap` m from its bumpers to the SOURCE wall. */
  const atSource = (a: Alliance, gap: number, config = cloneConfig(season.robotDefaults)): FieldPose => {
    const n = C.sideYaw(C.sourceEnd(a), Math.atan2(C.SOURCE_NORMAL.y, C.SOURCE_NORMAL.x));
    const w = C.sourcePoint(a, 0.5, config.frameLength / 2 + config.bumperThickness + gap);
    return { x: w.x, y: w.y, yaw: n + Math.PI };
  };
  const emptyHanded = (sim: HeadlessSim, a: Alliance) => {
    sim.rules.stage();
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i, `source:${a}`);
  };

  for (const a of ['blue', 'red'] as const) {
    it(`${a}: the SOURCE human player drops a NOTE down the physical 50° CHUTE into a SOURCE intake`, () => {
      const cfg = preset('source-pivot');
      const sim = make(a, atSource(a, 0.02, cfg), cfg);
      sim.ctx.humanPlayerIsAuto = () => true;
      emptyHanded(sim, a);
      jump(sim, TELEOP + 1);
      const before = sim.pool.indices('reserve', `source:${a}`).length;
      run(sim, 2.5, { ...IDLE_COMMAND, intake: true });
      expect(sim.pool.indices('reserve', `source:${a}`).length).toBe(before - 1);
      expect(sim.robot.held).toHaveLength(1);
    });

    it(`${a}: a NOTE the SOURCE drops lands on the carpet, where only a ground intake can pick it up`, () => {
      for (const [id, expected] of [['pivot', 1], ['source-pivot', 0]] as const) {
        const cfg = preset(id);
        const sim = make(a, atSource(a, 1.0, cfg), cfg);
        emptyHanded(sim, a);
        jump(sim, TELEOP + 1);
        rules(sim).humanPlayerAction(a, 1); // H: manual SOURCE drop
        run(sim, 2.5);
        const note = sim.pool.indices('field').find((i) => i >= C.FIELD_NOTES)!;
        const p = sim.frame.toField(sim.pool.position(note));
        expect(p.z, 'lying on the carpet').toBeLessThan(0.05);
        expect(sim.robot.held).toHaveLength(0);
        for (let k = 0; k < 90 * 3 && !sim.robot.held.length; k++) {
          const dx = p.x - sim.robot.pose.x, dy = p.y - sim.robot.pose.y, d = Math.hypot(dx, dy);
          const cmd = { ...IDLE_COMMAND, intake: true, vx: (dx / d) * 1.2, vy: (dy / d) * 1.2 };
          for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
          sim.step(cmd);
        }
        expect(sim.robot.held, id).toHaveLength(expected);
      }
    });
  }

  it('SOURCE human players only drop in TELEOP, one NOTE in the CHUTE at a time', () => {
    const sim = make('blue', atSource('blue', 0.6));
    emptyHanded(sim, 'blue');
    startMatch(sim);
    expect(rules(sim).dropNote('blue')).toBe(false);
    jump(sim, TELEOP + 1);
    expect(rules(sim).dropNote('blue')).toBe(true);
    expect(rules(sim).dropNote('blue')).toBe(false);
  });

  it('offers realistic 2024 archetypes and intake / shooter / aiming options', () => {
    const ids = crescendoRobotPresets().map((p) => p.id);
    expect(ids).toEqual(['pivot', 'turret', 'source-pivot', 'kitbot', 'amp-trap']);
    expect(season.robotDefaults.launcher.turret).toBe(false);
    expect(season.robotDefaults.autoAlign).toBe(true);
    const kit = preset('kitbot');
    expect([kit.intake.ground, kit.intake.station, kit.launcher.minAngle === kit.launcher.maxAngle, kit.climber.maxLevel]).toEqual([false, true, true, 0]);
    const c = cloneConfig(season.robotDefaults);
    const opt = (id: string) => crescendoRobotOptions.find((o) => o.id === id)!;
    opt('intake').set(c, 'source');
    expect([c.intake.ground, c.intake.station]).toEqual([false, true]);
    opt('shooter').set(c, 'none');
    expect(c.launcher.enabled).toBe(false);
    opt('shooter').set(c, 'pivot');
    expect(c.launcher.maxAngle).toBeGreaterThan(c.launcher.minAngle);
    opt('aim').set(c, 'turret');
    expect([c.launcher.turret, c.autoAlign]).toEqual([true, false]);
  });

  it('chassis auto-align turns a turretless robot onto the SPEAKER before it fires', () => {
    const s = C.speakerCenter('blue');
    const sim = make('blue', { x: s.x + 2.4, y: s.y - 1.2, yaw: 0.9 });
    jump(sim, TELEOP + 1);
    give(sim);
    run(sim, 2.5, { ...IDLE_COMMAND, shoot: true });
    expect(sim.robot.held).toHaveLength(0);
    expect(sim.ctx.score.counter('blue', 'speaker') + sim.pool.countIn('reserve', 'speaker:blue')).toBeGreaterThanOrEqual(1);
    // Without auto-align the driver must aim: facing away, the NOTE goes where the robot points.
    const cfg = cloneConfig(season.robotDefaults);
    cfg.autoAlign = false;
    const manual = make('blue', { x: s.x + 2.4, y: s.y - 1.2, yaw: 0.9 }, cfg);
    jump(manual, TELEOP + 1);
    give(manual);
    run(manual, 2.5, { ...IDLE_COMMAND, shoot: true });
    expect(manual.pool.countIn('reserve', 'speaker:blue')).toBe(0);
  });

  it('a fixed SUBWOOFER shooter scores from the SUBWOOFER but not from the WING', () => {
    const cfg = preset('kitbot');
    const s = C.speakerCenter('blue');
    // The KitBot's shooter faces forward: the driver backs off the SUBWOOFER facing the SPEAKER.
    const close = make('blue', { x: C.SUBWOOFER_DEPTH + cfg.frameLength / 2 + cfg.bumperThickness + 0.05, y: s.y, yaw: Math.PI }, cfg);
    jump(close, TELEOP + 1);
    give(close);
    run(close, 2.5, { ...IDLE_COMMAND, shoot: true });
    expect(close.pool.countIn('reserve', 'speaker:blue')).toBe(1);
    const far = make('blue', { x: s.x + 3.6, y: s.y, yaw: Math.PI }, cfg);
    jump(far, TELEOP + 1);
    give(far);
    run(far, 2.5, { ...IDLE_COMMAND, shoot: true });
    expect(far.pool.countIn('reserve', 'speaker:blue')).toBe(0);
  });

  it('a robot without an AMP mechanism cannot score the AMP', () => {
    const cfg = cloneConfig(season.robotDefaults);
    cfg.options = { ...cfg.options, amp: false };
    const sim = make('blue', ampPose('blue'), cfg);
    jump(sim, TELEOP + 1);
    give(sim);
    run(sim, 1, { ...IDLE_COMMAND, pass: true });
    expect(sim.ctx.score.category('blue', 'amp')).toBe(0);
    expect(sim.robot.held).toHaveLength(1);
  });

  it('SPEAKER NOTES stop counting 3 s after TELEOP ends', () => {
    const sim = make('blue', season.testing!.scoringSpots('blue')[5], preset('turret'));
    jump(sim, 150 + 3 + 3.2);
    give(sim);
    const sensorOnly = sim.ctx.score.category('blue', 'speaker');
    // Launch manually (robots are disabled after the match) and let it enter.
    const shot = sim.robot.launch(sim.rules.aimTarget(sim.robot), sim.rng)!;
    sim.pool.placeWorld(sim.robot.held.pop()!, shot.pos, shot.vel);
    run(sim, 1.2);
    expect(sim.pool.countIn('reserve', 'speaker:blue')).toBe(1);
    expect(sim.ctx.score.category('blue', 'speaker')).toBe(sensorOnly);
  });

  it('replicates rules state through JSON (multiplayer)', () => {
    const sim = make('blue');
    const r = rules(sim);
    r.bank.blue = 2;
    r.spotlit.red[2] = true;
    r.trapScored.blue[1] = true;
    const copy = make('blue');
    rules(copy).applyNetState(JSON.parse(JSON.stringify(r.netState())));
    expect(rules(copy).bank.blue).toBe(2);
    expect(rules(copy).amplifiedUntil.blue).toBe(-Infinity);
    expect(rules(copy).spotlit.red).toEqual([false, false, true]);
    expect(rules(copy).trapScored.blue).toEqual([false, true, false]);
  });
});
