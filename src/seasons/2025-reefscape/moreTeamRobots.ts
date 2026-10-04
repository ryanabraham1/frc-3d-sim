import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, battery, box, controller, decal, deployableIntake, drivebase, intakeDeployTarget, lattice, mat, pivot, plate, registerRobotModel, sidePlates, spin, tube, tubeMat, wheelShaft, type ModelKit } from '@engine/robot/models';
import { belt, motor } from '@engine/robot/mechanicalDetail';
import { inch, lb } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';
import { place, reachWith, stowed, starWheels } from './additionalTeamRobots';

/**
 * Three more real 2025 REEFSCAPE robots, in the clean flat style of the reference. Each is an elevator + end-effector
 * robot with a floor CORAL intake on the back (groundSide) and the scoring end on the front, as the rules score CORAL
 * off the front (`scoreSide` 0).
 *
 *  - 1678 Citrus Circuits SUBLIME: lime green, one tall black elevator tower with sponsor panels and a purple LED strip,
 *    green star-wheel floor intake (CD reveal photo; CAD / strategy release).
 *  - 971 Spartan Robotics FIDDLER: silver truss elevator and a claw of six maroon wheels in two banks that grips CORAL
 *    and ALGAE; a narrow floor intake (CD reveal still).
 *  - 341 Miss Daisy XXIII: blue, 5 ft continuous elevator, lantern-gear shoulder and 180° wrist with blue compliant
 *    wheels, green wheeled CORAL floor intake, compact deep climber (CD CAD release post and CAD render).
 */

// ── 1678 SUBLIME ──
registerRobotModel('sublime-1678', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const lime = mat(0x5ad23c, { rough: 0.5 }), limeTube = tubeMat(0x5ad23c), black = mat(0x15171a, { metal: 0.3, rough: 0.5 }), silver = mat(0xc5cbd2, { metal: 0.7, rough: 0.3 }), clear = mat(0xdde5f0, { opacity: 0.3, rough: 0.2 });
  const db = drivebase(k, { tube: limeTube, motorRing: 0x5ad23c });
  // One tall tower: two black sponsor plates with a silver rail pair between them, braced to the frame by gussets.
  const ex = -side * 0.05, ez = 0.12, top = H - 0.02;
  for (const sz of [-1, 1]) {
    plate(k.visual, [[ex - 0.1, bt - 0.02], [ex + 0.1, bt - 0.02], [ex + 0.04, top], [ex - 0.04, top]], 0.008, black, sz * (ez + 0.03));
    bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.035, silver);
    plate(k.visual, [[ex - 0.3, bt - 0.02], [ex - 0.04, bt - 0.02], [ex - 0.04, bt + 0.28]], 0.006, black, sz * (ez + 0.03));
    const rotY = sz > 0 ? 0 : Math.PI, z = sz * (ez + 0.036);
    decal(k.visual, 'SUBLIME', { w: 0.13, h: 0.04, color: '#5ad23c', background: '#15171a', x: ex, y: top - 0.14, z, rotY });
    decal(k.visual, 'fabworks', { w: 0.11, h: 0.03, color: '#ffffff', background: '#15171a', x: ex, y: top - 0.2, z, rotY });
    decal(k.visual, 'UCDAVIS', { w: 0.11, h: 0.03, color: '#ffffff', background: '#15171a', x: ex, y: top - 0.26, z, rotY });
  }
  box(k.visual, 0.1, 0.03, 2 * ez + 0.08, black, ex, top, 0);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 2 * ez), mat(0xa65bff, { emissive: 0x7b3bd6 }));
  led.position.set(ex + 0.052, top - 0.02, 0); k.visual.add(led);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex + side * 0.0, bt + 0.06, sz * (ez - 0.03)], [ex, top - 0.03, sz * (ez - 0.03)], 0.03, silver);
  const carriage = new THREE.Group(); stage.add(carriage);
  box(carriage, 0.04, 0.12, 2 * ez - 0.08, black, ex + side * 0.05, 0, 0);
  // Short arm and wrist: the end effector is a clear box with a pair of green rollers.
  const la = 0.62, arm = pivot(carriage, ex + side * 0.07, 0.04);
  for (const sz of [-1, 1]) bar(arm, [0, 0, sz * 0.06], [la - 0.05, 0, sz * 0.06], 0.026, silver);
  const eff = pivot(arm, la - 0.04, 0);
  sidePlates(eff, [[-0.03, -0.06], [0.1, -0.06], [0.14, 0], [0.1, 0.07], [-0.03, 0.06]], 0.085, clear, [], 0.008);
  const effWheels = [wheelShaft(eff, 0.0, 0.02, { n: 3, r: 0.035, w: 0.03, span: 0.12, colors: [0x5ad23c] }), wheelShaft(eff, 0.08, -0.03, { n: 3, r: 0.03, w: 0.03, span: 0.12, colors: [0x5ad23c] })];
  const held = pivot(eff, 0.05, -0.005);
  // Floor intake: lime plates with two banks of green star wheels.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: lime, rollerMaterial: mat(0x1c1e22) });
  const stars = [starWheels(intake.tip, -side * 0.0, 0, { n: 7, r: 0.05, span: c.intake.width * 0.85, m: lime }), starWheels(intake.tip, -side * -0.07, 0.03, { n: 7, r: 0.045, span: c.intake.width * 0.85, m: black })];
  box(k.visual, L / 2 - 0.1, 0.012, 0.16, black, side * L * 0.25, bt + 0.02, 0);
  battery(k.visual, -side * 0.28, bt - 0.02, 0.18, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, side * (0.15 + i * 0.065), bt, 0.24, 0x46ca79);
  // Climber at the scoring end: two lime posts and a lime cage hook that swings out.
  const climb = pivot(k.visual, -side * (L / 2 - 0.1), bt + 0.05, 0);
  for (const sz of [-1, 1]) { plate(k.visual, [[-side * (L / 2 - 0.14), bt - 0.02], [-side * (L / 2 - 0.06), bt - 0.02], [-side * (L / 2 - 0.08), bt + 0.2], [-side * (L / 2 - 0.12), bt + 0.2]], 0.008, lime, sz * 0.2); bar(climb, [0, 0, sz * 0.2], [0, 0.3, sz * 0.2], 0.022, limeTube); }
  tube(climb, [0, 0.3, -0.2], [0, 0.3, 0.2], 0.012, silver);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.7, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      if (p.handoff || stowed(p)) goal = { yc: bt + 0.3, phi: dir > 0 ? 1.25 : Math.PI - 1.25 };
      else goal = reachWith(p, dir, ex, la, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.max(0, yc - (top - 0.16));
      stage.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.level === 4 ? -1.1 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      for (const st of stars) spin(st, -side * (s.intaking && s.enabled && deploy > 0.8 ? 26 : 0), s.dt);
      climb.rotation.x = approach(climb.rotation.x, s.climb > 0.1 ? -1.2 : 0, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 971 FIDDLER ──
registerRobotModel('fiddler-971', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 }), silverTube = tubeMat(0xc9ced5), maroon = mat(0x8e2a31, { rough: 0.5 }), black = mat(0x16171a, { metal: 0.3, rough: 0.55 }), white = mat(0xe7eaee, { rough: 0.5 });
  const db = drivebase(k, { tube: silverTube, motorRing: 0x8e2a31 });
  // Truss elevator off-centre toward the scoring end; zig-zag lattice on both rails, with cross-ties.
  const ex = -side * 0.04, ez = 0.14, top = H - 0.02;
  for (const sz of [-1, 1]) {
    lattice(k.visual, [ex - 0.04, bt - 0.02, sz * ez], [0.08, 0, 0], [0, top - bt + 0.02, 0], { cells: 8, w: 0.012, m: silver, zig: true, border: true });
    bar(k.visual, [-side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.38, sz * ez], 0.022, silverTube);
    bar(k.visual, [side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.32, sz * ez], 0.022, silverTube);
  }
  box(k.visual, 0.06, 0.04, 2 * ez + 0.04, silver, ex, top, 0);
  motor(k.visual, ex, bt + 0.05, 0, 0x8e2a31);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex - side * 0.03, bt + 0.06, sz * (ez - 0.01)], [ex - side * 0.03, top - 0.03, sz * (ez - 0.01)], 0.026, silverTube);
  const carriage = new THREE.Group(); stage.add(carriage);
  box(carriage, 0.012, 0.14, 2 * ez - 0.05, silver, ex - side * 0.05, 0, 0);
  // Arm with a claw at the end: two banks of three maroon wheels that grip the CORAL between them.
  const la = 0.6, ax = ex - side * 0.08, arm = pivot(carriage, ax, 0.03);
  lattice(arm, [0, -0.025, 0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  lattice(arm, [0, -0.025, -0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  const eff = pivot(arm, la - 0.04, 0);
  sidePlates(eff, [[-0.03, -0.07], [0.12, -0.07], [0.15, 0.0], [0.12, 0.08], [-0.03, 0.07]], 0.085, white, [], 0.008);
  const effWheels = [wheelShaft(eff, 0.08, 0.04, { n: 3, r: 0.03, w: 0.024, span: 0.12, colors: [0x8e2a31] }), wheelShaft(eff, 0.08, -0.04, { n: 3, r: 0.03, w: 0.024, span: 0.12, colors: [0x8e2a31] })];
  const held = pivot(eff, 0.06, 0);
  // Narrow floor intake: maroon wheels on a gray frame, only about 14 in wide.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, width: inch(15), frame: silverTube, rollerMaterial: maroon });
  box(k.visual, L / 2 - 0.1, 0.012, 0.12, black, side * L * 0.25, bt + 0.02, 0);
  battery(k.visual, -side * 0.28, bt - 0.02, 0.2, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, side * (0.12 + i * 0.065), bt, -0.2, 0x46ca79);
  // Deep-cage climber at the scoring end: two silver truss arms swinging out over the side, hooks on top.
  const clz = -(W / 2 - 0.05);
  const climb = pivot(k.visual, -side * (L / 2 - 0.15), bt + 0.05, clz);
  lattice(climb, [-0.02, 0, 0], [0, 0.36, 0], [0.04, 0, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  plate(climb, [[-0.05, 0.3], [0.05, 0.3], [0.07, 0.4], [0.02, 0.38], [0, 0.34], [-0.02, 0.38], [-0.07, 0.4]], 0.01, maroon);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.6, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      if (p.handoff) goal = { yc: bt + 0.3, phi: dir > 0 ? Math.PI + 0.9 : -0.9 };
      else if (stowed(p)) goal = { yc: yMin, phi: dir > 0 ? 1.25 : Math.PI - 1.25 };
      else goal = reachWith(p, dir, ax, la, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.min(top - bt - 0.25, Math.max(0, yc - (top - 0.14)));
      stage.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.level === 4 ? -1.2 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      climb.rotation.x = approach(climb.rotation.x, s.climb > 0.1 ? -1.2 : 0, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 341 MISS DAISY ──
registerRobotModel('miss-daisy-341', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const blue = mat(0x2a55d6, { rough: 0.5 }), blueTube = tubeMat(0x2a55d6), silver = mat(0xc5cbd2, { metal: 0.7, rough: 0.3 }), silverTube = tubeMat(0xc5cbd2), black = mat(0x16181b, { metal: 0.3, rough: 0.55 }), green = mat(0x3fa84a, { rough: 0.6 });
  const db = drivebase(k, { tube: silverTube, motorRing: 0x2a55d6 });
  // Continuous elevator: tall silver uprights with a black top plate, the carriage riding on the moving stages.
  const ex = -side * 0.08, ez = 0.13, top = H - 0.02;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.04, silverTube);
    bar(k.visual, [side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.4, sz * ez], 0.022, silverTube);
    bar(k.visual, [-side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.36, sz * ez], 0.022, silverTube);
  }
  box(k.visual, 0.05, 0.05, 2 * ez + 0.06, black, ex, top, 0);
  for (const sz of [-1, 1]) belt(k.visual, [ex + side * 0.03, bt + 0.05], [ex + side * 0.03, top - 0.05], sz * (ez - 0.03), 0.018);
  motor(k.visual, ex - side * 0.03, bt + 0.05, 0, 0x2a55d6);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex - side * 0.045, bt + 0.06, sz * (ez - 0.01)], [ex - side * 0.045, top - 0.03, sz * (ez - 0.01)], 0.03, silverTube);
  bar(stage, [ex - side * 0.045, top - 0.04, -ez], [ex - side * 0.045, top - 0.04, ez], 0.026, silverTube);
  const stage2 = new THREE.Group(); k.visual.add(stage2);
  for (const sz of [-1, 1]) bar(stage2, [ex - side * 0.07, bt + 0.1, sz * (ez - 0.03)], [ex - side * 0.07, top - 0.06, sz * (ez - 0.03)], 0.024, silverTube);
  const carriage = new THREE.Group(); stage2.add(carriage);
  box(carriage, 0.012, 0.15, 2 * ez - 0.1, silver, ex - side * 0.09, 0, 0);
  // Lantern-gear shoulder (a big round gear plate) and a truss arm with a 180° wrist.
  const la = 0.5, ax = ex - side * 0.1;
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 28), silver);
  gear.rotation.x = Math.PI / 2; gear.position.set(ax, 0.04, 0.09); carriage.add(gear);
  const arm = pivot(carriage, ax, 0.04);
  lattice(arm, [0, -0.025, 0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  lattice(arm, [0, -0.025, -0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  const eff = pivot(arm, la - 0.04, 0);
  sidePlates(eff, [[-0.03, -0.06], [0.1, -0.06], [0.14, 0], [0.1, 0.07], [-0.03, 0.06]], 0.085, black, [], 0.008);
  const effWheels = [wheelShaft(eff, 0.02, 0.03, { n: 3, r: 0.034, w: 0.028, span: 0.12, colors: [0x2a55d6] }), wheelShaft(eff, 0.1, -0.03, { n: 3, r: 0.03, w: 0.028, span: 0.12, colors: [0x2a55d6] })];
  const held = pivot(eff, 0.06, 0);
  // Floor CORAL intake: a row of green wheels across the front on blue plates.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blue, rollerMaterial: green });
  const bank = starWheels(intake.tip, 0, 0, { n: 9, r: 0.04, span: c.intake.width * 0.88, m: green, spikes: 5 });
  box(k.visual, L / 2 - 0.1, 0.012, 0.14, black, side * L * 0.25, bt + 0.02, 0);
  battery(k.visual, -side * 0.3, bt - 0.02, 0.2, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, side * (0.1 + i * 0.065), bt, -0.2, 0x46ca79);
  decal(k.visual, 'MISS DAISY', { w: 0.2, h: 0.04, color: '#ffffff', background: '#2a55d6', x: -side * 0.18, y: bt + 0.06, z: W / 2 - 0.03, rotY: 0 });
  // Compact deep climber at the scoring end: a short blue tower and swing arm.
  const cz = -(W / 2 - 0.05), climb = pivot(k.visual, -side * (L / 2 - 0.14), bt + 0.05, cz);
  plate(k.visual, [[-side * (L / 2 - 0.2), bt - 0.02], [-side * (L / 2 - 0.08), bt - 0.02], [-side * (L / 2 - 0.1), bt + 0.2], [-side * (L / 2 - 0.18), bt + 0.2]], 0.008, blue, cz);
  bar(climb, [0, 0, 0.012], [0, 0.3, 0.012], 0.03, blueTube);
  tube(climb, [-0.06, 0.3, 0.012], [0.06, 0.3, 0.012], 0.012, silver);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.7, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      if (p.handoff || stowed(p)) goal = { yc: bt + 0.3, phi: dir > 0 ? Math.PI + 0.9 : -0.9 };
      else goal = reachWith(p, dir, ax, la, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.max(0, yc - (top - 0.14));
      stage.position.y = ext / 2; stage2.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.level === 4 ? -1.2 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      spin(bank, -side * (s.intaking && s.enabled && deploy > 0.8 ? 26 : 0), s.dt);
      climb.rotation.x = approach(climb.rotation.x, s.climb > 0.1 ? -1.2 : 0, 5, s.dt);
      db.update(s);
    },
  };
});

const cfg = (team: number, model: string, o: { lift: number; release: number; harvest: number; speed: number; climb: number; height: number; weight: number; cycle: number; frame?: [number, number]; algae?: 'reef' | 'reefGround'; algaeScore?: 'processor' | 'both' }) => {
  const c = build({ coral: 'l4', intake: 'ground', algae: o.algae ?? 'reefGround', algaeScore: o.algaeScore ?? 'both', climb: 2, align: true, speed: o.speed, weight: o.weight, cycle: o.cycle });
  c.teamNumber = team; c.model = model; c.height = inch(o.height); c.mass = lb(o.weight);
  if (o.frame) { c.frameLength = inch(o.frame[0]); c.frameWidth = inch(o.frame[1]); }
  c.placement!.liftSpeed = o.lift; c.placement!.cycleSeconds = o.release; c.placement!.harvestSeconds = o.harvest;
  c.climber.secondsToClimb = o.climb;
  return normalizeReefscapeConfig(c);
};

export function moreReefscapeTeamRobots(): TeamRobot[] {
  return [
    { id: 'sublime-1678', team: 1678, name: 'SubLime',
      description: '1678 Citrus Circuits. A lime-green single tall elevator tower with a purple LED strip, a short arm and clear end effector that places CORAL on all levels and handles ALGAE, with a star-wheel CORAL floor intake and a deep-cage climb. One of the fastest cyclers of 2025. Lift, release and speed are simulator estimates.',
      source: 'Chief Delphi "1678 Citrus Circuits 2025 Robot: SubLime" and "1678 2025 CAD, Code and Strategy Release"',
      config: cfg(1678, 'sublime-1678', { lift: 2.5, release: 0.3, harvest: 0.4, speed: 4.8, climb: 2.2, height: 40, weight: 126, cycle: 0.5 }) },
    { id: 'fiddler-971', team: 971, name: 'Fiddler',
      description: '971 Spartan Robotics. A swerve robot with a silver truss elevator and a claw of maroon wheel banks that grips CORAL and pulls ALGAE off the REEF; narrow CORAL floor intake (a known trade-off against defense) and a deep climb. Dimensions, lift and timings are estimates.',
      source: 'Chief Delphi "FRC 971 Spartan Robotics 2025 robot reveal - Fiddler" (reveal video still and Q&A)',
      config: cfg(971, 'fiddler-971', { lift: 2.1, release: 0.35, harvest: 0.45, speed: 4.9, climb: 2.0, height: 40, weight: 124, cycle: 0.55, algae: 'reef' }) },
    { id: 'miss-daisy-341', team: 341, name: 'Miss Daisy',
      description: '341 Miss Daisy XXIII (Archimedes alliance captain, 82% win rate). Coral floor intake, continuous elevator, lantern-gear driven shoulder, 180° wrist and a compact deep climber; a "superstructure" in code keeps the arm from hitting the robot. Timings and speed are estimates.',
      source: 'Chief Delphi "Team 341 - Miss Daisy 2025 CAD, Code, and Documentation Release"',
      config: cfg(341, 'miss-daisy-341', { lift: 2.3, release: 0.35, harvest: 0.35, speed: 4.5, climb: 2.3, height: 41, weight: 128, cycle: 0.6, algae: 'reef', algaeScore: 'processor' }) },
  ];
}
