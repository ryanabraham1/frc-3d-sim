import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Alliance } from '../src/engine/coords';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND, type RobotCommand } from '../src/engine/robot/robot';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import { wrapAngle } from '../src/engine/units';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import { ReefscapeRules } from '../src/seasons/2025-reefscape/rules';
import { normalizeReefscapeConfig, reefscapeRobotOptions, reefscapeRobotPresets } from '../src/seasons/2025-reefscape/config';
import * as C from '../src/seasons/2025-reefscape/constants';

/** Side scoring (1778 SubZero's swinging arm), the ground-intake → end effector handoff, and the elevator NET outtake. */

const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });
function make(a: Alliance, pose: { x: number; y: number; yaw: number }, robot: RobotConfig) {
  const sim = new HeadlessSim(season, RAPIER, { robot, alliance: a, pose, station: 2 });
  sims.push(sim); return sim;
}
function run(sim: HeadlessSim, seconds: number, command: RobotCommand | (() => RobotCommand) = IDLE_COMMAND) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
    sim.step(typeof command === 'function' ? command() : command);
  }
}
function teleop(sim: HeadlessSim) { sim.rules.onPeriodChange(sim.ctx.clock.start()); for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c); }
function load(sim: HeadlessSim, i: number) { sim.pool.hold(i, sim.robot.id); sim.robot.held.push(i); }
const preset = (id: string): RobotConfig => cloneConfig(reefscapeRobotPresets().find((p) => p.id === id)!.config);
const subZero = () => cloneConfig(season.teamRobots!.find((t) => t.id === 'subzero-1778')!.config);
const rulesOf = (sim: HeadlessSim) => sim.rules as ReefscapeRules;
const holdingCoral = (sim: HeadlessSim) => sim.robot.held.some((i) => i < C.CORAL_COUNT);

describe('2025 side scoring (swinging arm)', () => {
  it('is a robot option and normalizes', () => {
    const opt = reefscapeRobotOptions.find((o) => o.id === 'scoreSide')!;
    const c = cloneConfig(season.robotDefaults);
    expect(opt.get(c)).toBe('front');
    opt.set(c, 'sides');
    expect(c.placement!.scoreSide).toBe('sides');
    const bad = cloneConfig(c); (bad.placement as { scoreSide: string }).scoreSide = 'top';
    expect(normalizeReefscapeConfig(bad).placement!.scoreSide).toBe('front');
    expect(subZero().placement!.scoreSide).toBe('sides');
  });

  for (const a of ['blue', 'red'] as Alliance[]) for (const level of [2, 4]) {
    it(`${a}: lines up side-on to the REEF and places L${level} out of the side facing it`, () => {
      const sim = make(a, season.testing!.scoringSpots(a)[0], subZero()); teleop(sim); load(sim, 0);
      const rules = rulesOf(sim);
      const pose = rules.alignPose(sim.robot, level)!;
      const t = rules.placementTarget(sim.robot, level)!;
      // Parallel to the face: the robot's heading is 90° off the direction into the REEF.
      expect(Math.abs(Math.abs(wrapAngle(pose.yaw - (t.approach.faceYaw + Math.PI))) - Math.PI / 2)).toBeLessThan(1e-6);
      const m = rules.mechanisms.get(sim.robot.id)!;
      let sideAtRelease = 0;
      run(sim, 4, () => { if (holdingCoral(sim)) sideAtRelease = m.side; return { ...IDLE_COMMAND, shoot: holdingCoral(sim), scoringLevel: level }; });
      expect(sim.ctx.score.counter(a, `coralL${level}`)).toBe(1);
      expect(Math.abs(sideAtRelease)).toBe(1);
      // The bumpers sit against the REEF with the robot's side, not its nose.
      const reef = C.reefCenter(a);
      const toReef = Math.atan2(reef.y - sim.robot.pose.y, reef.x - sim.robot.pose.x);
      expect(Math.abs(Math.cos(toReef - sim.robot.pose.yaw))).toBeLessThan(0.55);
    });
  }

  it('elevator and arm stay stowed while carrying, and only deploy while Space is held', () => {
    const sim = make('blue', season.testing!.scoringSpots('blue')[0], subZero()); teleop(sim); load(sim, 0);
    const m = rulesOf(sim).mechanisms.get(sim.robot.id)!;
    run(sim, 1, { ...IDLE_COMMAND, scoringLevel: 4 });
    expect([m.height, m.side]).toEqual([0.45, 0]);
    run(sim, 0.3, { ...IDLE_COMMAND, shoot: true, scoringLevel: 4 });
    expect(m.height).toBeGreaterThan(0.7);
    run(sim, 1.5, { ...IDLE_COMMAND, scoringLevel: 4 }); // let go before it placed: back down
    expect(m.height).toBeCloseTo(0.45, 2);
  });

  it('a front scorer parked side-on cannot place; a side scorer can', () => {
    for (const [config, expected] of [[cloneConfig(season.robotDefaults), 0], [subZero(), 1]] as const) {
      config.autoAlign = false;
      const probe = make('blue', season.testing!.scoringSpots('blue')[0], subZero()); load(probe, 0);
      const pose = rulesOf(probe).alignPose(probe.robot, 2)!;
      const sim = make('blue', pose, config); teleop(sim); load(sim, 0);
      run(sim, 3, () => ({ ...IDLE_COMMAND, shoot: holdingCoral(sim), scoringLevel: 2 }));
      expect(sim.ctx.score.counter('blue', 'coralL2')).toBe(expected);
    }
  });
});

describe('2025 front-and-back scoring (arm over the top)', () => {
  const whisper = () => cloneConfig(season.teamRobots!.find((t) => t.id === 'whisper-1690')!.config);

  it('is a robot option and WHISPER uses it, with one floor intake', () => {
    const opt = reefscapeRobotOptions.find((o) => o.id === 'scoreSide')!;
    const c = cloneConfig(season.robotDefaults);
    opt.set(c, 'ends');
    expect(c.placement!.scoreSide).toBe('ends');
    expect(whisper().placement!.scoreSide).toBe('ends');
    expect(whisper().intake.groundSide).toBe('back'); // one floor intake; the arm scores over it too
  });

  for (const tail of [false, true]) it(`places L4 ${tail ? 'tail-first out of the back' : 'nose-first out of the front'}`, () => {
    const spot = season.testing!.scoringSpots('blue')[0];
    const reef = C.reefCenter('blue');
    const toReef = Math.atan2(reef.y - spot.y, reef.x - spot.x);
    const sim = make('blue', { ...spot, yaw: toReef + (tail ? Math.PI : 0) }, whisper()); teleop(sim); load(sim, 0);
    const rules = rulesOf(sim);
    expect(rules.placementTarget(sim.robot, 4)!.side).toBe(tail ? 2 : 0);
    // Auto-align keeps whichever end already faces the REEF instead of turning around.
    const pose = rules.alignPose(sim.robot, 4)!;
    const t = rules.placementTarget(sim.robot, 4)!;
    expect(Math.abs(wrapAngle(pose.yaw - (t.approach.faceYaw + (tail ? 0 : Math.PI))))).toBeLessThan(1e-6);
    const m = rules.mechanisms.get(sim.robot.id)!;
    let sideAtRelease = -1;
    run(sim, 4, () => { if (holdingCoral(sim)) sideAtRelease = m.side; return { ...IDLE_COMMAND, shoot: holdingCoral(sim), scoringLevel: 4 }; });
    expect(sim.ctx.score.counter('blue', 'coralL4')).toBe(1);
    expect(sideAtRelease).toBe(tail ? 2 : 0);
  });
});

describe('2025 ground intake → end effector handoff', () => {
  it('a floor-intaken CORAL is handed off for handoffSeconds before it can be scored', () => {
    const config = preset('all-rounder'); config.placement!.handoffSeconds = 0.6;
    const sim = make('blue', { x: 2, y: 2, yaw: 0 }, config); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    sim.pool.placeField(0, 1.37, 2, C.CORAL_RADIUS); // behind the robot: the ground intake is on the back
    const m = rulesOf(sim).mechanisms.get(sim.robot.id)!;
    let pickedAt = -1, doneAt = -1;
    for (let n = 0; n < 120; n++) {
      run(sim, sim.physics.dt, { ...IDLE_COMMAND, intake: true });
      if (pickedAt < 0 && holdingCoral(sim)) pickedAt = n;
      if (pickedAt >= 0 && doneAt < 0 && m.handoff === 0) doneAt = n;
      if (pickedAt >= 0 && m.handoff > 0) expect(m.height).toBeLessThan(0.5); // end effector waits low for the intake
    }
    expect(pickedAt).toBeGreaterThanOrEqual(0);
    expect((doneAt - pickedAt) * sim.physics.dt).toBeCloseTo(0.6, 1);
  });

  it('cannot release CORAL mid-handoff, then scores once it is in the end effector', () => {
    const config = preset('all-rounder'); config.placement!.handoffSeconds = 1.5;
    const sim = make('blue', season.testing!.scoringSpots('blue')[0], config); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    load(sim, 0);
    rulesOf(sim).mechanisms.get(sim.robot.id)!.handoff = 1e-6; // as if just picked off the carpet
    run(sim, 1.2, { ...IDLE_COMMAND, shoot: true, scoringLevel: 2 });
    expect(holdingCoral(sim)).toBe(true);
    run(sim, 3, () => ({ ...IDLE_COMMAND, shoot: holdingCoral(sim), scoringLevel: 2 }));
    expect(sim.ctx.score.counter('blue', 'coralL2')).toBe(1);
  });

  it('station (funnel) CORAL and direct-pickup end effectors skip the handoff', () => {
    expect(season.teamRobots!.find((t) => t.id === 'spectre-2910')!.config.placement!.handoffSeconds).toBe(0);
    const config = preset('all-rounder'); config.placement!.handoffSeconds = 0;
    const sim = make('blue', { x: 2, y: 2, yaw: 0 }, config); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    sim.pool.placeField(0, 1.37, 2, C.CORAL_RADIUS);
    run(sim, 0.4, { ...IDLE_COMMAND, intake: true });
    expect(holdingCoral(sim)).toBe(true);
    expect(rulesOf(sim).mechanisms.get(sim.robot.id)!.handoff).toBe(0);
  });

  it('animates the CORAL from the intake up into the team model end effector', () => {
    const team = season.teamRobots!.find((t) => t.id === 'undertow-254')!;
    const sim = make('blue', { x: 2, y: 2, yaw: 0 }, cloneConfig(team.config)); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    load(sim, 0);
    const rules = rulesOf(sim), m = rules.mechanisms.get(sim.robot.id)!;
    const mesh = (rules as unknown as { heldVisuals: Map<number, { coral: THREE.Mesh }> }).heldVisuals.get(sim.robot.id)!.coral;
    const coralPos = () => {
      sim.robot.visual.updateMatrixWorld(true);
      return sim.robot.visual.worldToLocal(mesh.getWorldPosition(new THREE.Vector3()));
    };
    const step = (cmd = IDLE_COMMAND) => { run(sim, 1 / 60, cmd); sim.robot.syncVisual(1 / 60); rules.updateVisuals(1 / 60, 0); };
    // The intake is out on the carpet when it grabs the CORAL; then the handoff folds it in.
    for (let k = 0; k < 40; k++) step({ ...IDLE_COMMAND, intake: true });
    m.handoff = 1e-6;
    step();
    const start = coralPos();
    expect(start.x).toBeLessThan(-0.15); // on the back intake
    while (m.handoff > 0) step();
    for (let k = 0; k < 30; k++) step();
    sim.robot.visual.updateMatrixWorld(true);
    const end = coralPos();
    const anchor = sim.robot.visual.worldToLocal(sim.robot.modelHeldAnchor!.getWorldPosition(new THREE.Vector3()));
    expect(end.distanceTo(anchor)).toBeLessThan(0.05);
    expect(end.distanceTo(start)).toBeGreaterThan(0.2);
  });
});

describe('2025 ALGAE NET from a raised elevator', () => {
  it('no 2025 archetype or team robot shoots: NET scoring is the elevator outtake option', () => {
    for (const p of reefscapeRobotPresets()) expect(p.config.launcher.enabled, p.id).toBe(false);
    for (const t of season.teamRobots!) expect(t.config.launcher.enabled, t.id).toBe(false);
    expect(preset('all-rounder').options!.net).toBe(true);
    // Legacy configs that flagged the NET with the launcher migrate to the outtake option.
    const legacy = preset('all-rounder'); delete legacy.options!.net; legacy.launcher.enabled = true;
    const migrated = normalizeReefscapeConfig(legacy);
    expect([migrated.options!.net, migrated.launcher.enabled]).toEqual([true, false]);
  });

  for (const a of ['blue', 'red'] as Alliance[]) {
    it(`${a}: raises the elevator to full height at the BARGE before the ALGAE leaves, and it drops into the NET`, () => {
      const n = C.netCenter(a);
      const sim = make(a, { x: n.x + (a === 'blue' ? -2.2 : 2.2), y: n.y, yaw: C.sideYaw(a, 0) }, preset('all-rounder')); teleop(sim); load(sim, 126);
      const m = rulesOf(sim).mechanisms.get(sim.robot.id)!;
      let heightAtRelease = 0;
      for (let k = 0; k < 400 && sim.robot.held.includes(126); k++) { heightAtRelease = m.height; run(sim, sim.physics.dt, { ...IDLE_COMMAND, shoot: true }); }
      expect(heightAtRelease).toBeGreaterThan(1.95);
      run(sim, 2);
      expect(sim.ctx.score.counter(a, 'net')).toBe(1);
    });
  }

  it('the ALGAE button (G) scores the NET while the robot still holds CORAL; Space places the CORAL instead', () => {
    const n = C.netCenter('blue');
    const sim = make('blue', { x: n.x - 2.2, y: n.y, yaw: 0 }, preset('all-rounder')); teleop(sim); load(sim, 0); load(sim, 126);
    for (let k = 0; k < 600 && sim.robot.held.includes(126); k++) run(sim, sim.physics.dt, { ...IDLE_COMMAND, pass: true });
    expect(sim.robot.held.includes(126)).toBe(false);
    expect(holdingCoral(sim)).toBe(true);
    run(sim, 2);
    expect(sim.ctx.score.counter('blue', 'net')).toBe(1);
    // Space is the CORAL button: the CORAL goes first and the ALGAE stays put until Space is held with ALGAE only.
    const sim2 = make('blue', { x: n.x - 2.2, y: n.y, yaw: 0 }, preset('all-rounder')); teleop(sim2); load(sim2, 0); load(sim2, 126);
    for (let k = 0; k < 600 && holdingCoral(sim2); k++) run(sim2, sim2.physics.dt, { ...IDLE_COMMAND, shoot: true });
    expect(holdingCoral(sim2)).toBe(false);
    expect(sim2.robot.held.includes(126)).toBe(true);
  });

  it('physical: outtaking from the wrong distance misses the NET', () => {
    for (const [offset, expected] of [[0, 1], [-0.75, 0]] as const) {
      const config = preset('all-rounder'); config.autoAlign = false;
      const probe = make('blue', { x: 6, y: 6, yaw: 0 }, config); load(probe, 126);
      const pose = rulesOf(probe).netPose(probe.robot)!;
      const sim = make('blue', { x: pose.x + offset, y: pose.y, yaw: pose.yaw }, config); teleop(sim); load(sim, 126);
      run(sim, 3, { ...IDLE_COMMAND, shoot: true });
      expect(sim.robot.held.includes(126), `offset ${offset}`).toBe(false);
      expect(sim.ctx.score.counter('blue', 'net'), `offset ${offset}`).toBe(expected);
    }
  });

  it('bots score ALGAE in the NET with the elevator outtake', () => {
    const n = C.netCenter('blue');
    const sim = make('blue', { x: n.x - 3.5, y: n.y - 1, yaw: 0 }, preset('algae')); teleop(sim); load(sim, 126);
    const bot = season.createBotPilot!(sim.ctx, sim.rules, sim.robot);
    run(sim, 8, () => (sim.robot.held.length ? bot.update(sim.physics.dt) : IDLE_COMMAND));
    expect(sim.ctx.score.counter('blue', 'net')).toBe(1);
  });
});


describe('2025 physical piece storage', () => {
  const team = (id: string) => cloneConfig(season.teamRobots!.find(t => t.id === id)!.config);
  for (const id of ['fiddler-971','spectre-2910','undertow-254','madtown-1323','sublime-1678','miss-daisy-341','zuma-581']) {
    it(`${id}: one shared holder rejects CORAL while carrying ALGAE`, () => {
      const config=team(id);
      expect(config.intake.primary && config.intake.secondary).toBe(true);
      expect(config.hopperCapacity).toBe(1);
      const sim=make('blue',{x:2,y:2,yaw:0},config); teleop(sim);
      for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
      load(sim,126);
      const sign=config.intake.groundSide==='front'?1:-1;
      sim.pool.placeField(0,2+sign*.63,2,C.CORAL_RADIUS);
      run(sim,.5,{...IDLE_COMMAND,intake:true});
      expect(sim.robot.held).toEqual([126]);
      sim.robot.held.length=0; sim.pool.reserve(126);
      run(sim,.5,{...IDLE_COMMAND,intake:true});
      expect(sim.robot.held).toEqual([0]); // same CORAL really was in the capture zone
      const atReef=make('blue',season.testing!.scoringSpots('blue')[0],config); teleop(atReef);
      for (const i of atReef.robot.held.splice(0)) atReef.pool.reserve(i);
      load(atReef,0); run(atReef,3,{...IDLE_COMMAND,intake:true});
      expect(atReef.robot.held).toEqual([0]); // reef removal cannot add ALGAE to the occupied claw

    });
  }

  it('custom storage settings distinguish shared, buffered and independent holders', () => {
    const option=reefscapeRobotOptions.find(o=>o.id==='pieceStorage')!;
    let c=team('whisper-1690');
    for (const mode of ['shared','buffered','separate']) {
      option.set(c,mode); c=normalizeReefscapeConfig(c);
      expect(option.get(c)).toBe(mode);
      expect(c.hopperCapacity).toBe(mode==='shared'?1:2);
    }
  });

  it('WildStang rejects floor CORAL and accepts CORAL at its station mouth', () => {
    const config=team('wildstang-111');
    expect(config.intake.ground).toBe(false); expect(config.intake.station).toBe(true);
    const sim=make('blue',{x:2,y:2,yaw:0},config); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    load(sim,126); sim.pool.placeField(0,1.37,2,C.CORAL_RADIUS);
    run(sim,.5,{...IDLE_COMMAND,intake:true}); expect(sim.robot.held).toEqual([126]);
    sim.pool.placeField(0,1.55,2,config.height+.1);
    run(sim,.15,{...IDLE_COMMAND,intake:true}); expect(sim.robot.held).toEqual([126,0]);
  });

  it('WildStang carries both pieces in independent heads and can place CORAL first', () => {
    const config=team('wildstang-111'); expect(config.hopperCapacity).toBe(2);
    const sim=make('blue',season.testing!.scoringSpots('blue')[0],config); teleop(sim);
    for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
    load(sim,0); load(sim,126);
    run(sim,4,()=>({...IDLE_COMMAND,shoot:holdingCoral(sim),scoringLevel:4}));
    expect(sim.robot.held).toEqual([126]); expect(sim.ctx.score.counter('blue','coralL4')).toBe(1);
    sim.robot.syncVisual(1/60); rulesOf(sim).updateVisuals(1/60,0);
    const visuals=(rulesOf(sim) as unknown as {heldVisuals:Map<number,{algae:THREE.Mesh}>}).heldVisuals.get(sim.robot.id)!;
    expect(visuals.algae.parent).toBe(sim.robot.modelAlgaeAnchor);
  });

  for (const id of ['whisper-1690','subzero-1778','firefly-118','lightning-2056']) {
    it(`${id}: can actually collect CORAL with ALGAE already aboard`, () => {
      const sim=make('blue',{x:2,y:2,yaw:0},team(id)); teleop(sim);
      for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
      load(sim,126); sim.pool.placeField(0,1.37,2,C.CORAL_RADIUS);
      run(sim,.5,{...IDLE_COMMAND,intake:true});
      expect(sim.robot.held).toEqual([126,0]);
    });
  }

  for (const id of ['whisper-1690','subzero-1778','firefly-118','lightning-2056']) {
    it(`${id}: buffered CORAL waits for ALGAE, then transfers and scores`, () => {
      const config=team(id); expect(config.hopperCapacity).toBe(2);
      const sim=make('blue',season.testing!.scoringSpots('blue')[0],config); teleop(sim);
      for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
      load(sim,0); load(sim,126);
      const rules=rulesOf(sim), m=rules.mechanisms.get(sim.robot.id)!;
      run(sim,3,{...IDLE_COMMAND,shoot:true,scoringLevel:4});
      expect(sim.robot.held).toEqual([0,126]); expect(m.handoff).toBe(0);
      sim.robot.syncVisual(1/60); rules.updateVisuals(1/60,0); sim.robot.visual.updateMatrixWorld(true);
      const mesh=(rules as unknown as {heldVisuals:Map<number,{coral:THREE.Mesh}>}).heldVisuals.get(sim.robot.id)!.coral;
      const buffered=sim.robot.visual.worldToLocal(mesh.getWorldPosition(new THREE.Vector3()));
      const held=sim.robot.visual.worldToLocal(sim.robot.modelHeldAnchor!.getWorldPosition(new THREE.Vector3()));
      if (id==='whisper-1690' || id==='lightning-2056') expect(buffered.distanceTo(held)).toBeGreaterThan(.12);
      else expect(buffered.distanceTo(sim.robot.visual.worldToLocal(sim.robot.modelIntakeAnchor!.getWorldPosition(new THREE.Vector3())))).toBeLessThan(1e-6);
      // Move to a legal NET pose and release ALGAE with G.
      const net=rules.netPose(sim.robot)!; const inventory=[...sim.robot.held]; sim.robot.resetTo(net); sim.robot.held.push(...inventory);
      let transferred=false;
      for(let n=0;n<600 && sim.robot.held.includes(126);n++) {
        run(sim,sim.physics.dt,{...IDLE_COMMAND,pass:true});
        transferred ||= !sim.robot.held.includes(126) && m.handoff>0;
      }
      expect(sim.robot.held).toEqual([0]); expect(transferred).toBe(true);
      run(sim,1.5,{...IDLE_COMMAND,pass:true}); // holding G must not eject the waiting CORAL
      expect(sim.robot.held).toEqual([0]);
      const target=rules.alignPose(sim.robot,4)!; const coralInventory=[...sim.robot.held]; sim.robot.resetTo(target); sim.robot.held.push(...coralInventory);
      run(sim,4,()=>({...IDLE_COMMAND,shoot:holdingCoral(sim),scoringLevel:4}));
      expect(holdingCoral(sim)).toBe(false); expect(sim.ctx.score.counter('blue','coralL4')).toBe(1);
    });
  }
});
