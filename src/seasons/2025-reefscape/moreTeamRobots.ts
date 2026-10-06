import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, battery, box, controller, decal, deployableIntake, drivebase, flowAt, intakeDeployTarget, lattice, mat, pivot, plate, registerRobotModel, sidePlates, spin, tube, tubeMat, wheelShaft, type ModelKit } from '@engine/robot/models';
import { belt, motor } from '@engine/robot/mechanicalDetail';
import { inch, lb } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';
import { place, reachWith, stowed, starWheels } from './additionalTeamRobots';

/**
 * Three more real 2025 REEFSCAPE robots, in the clean flat style of the reference, checked against The Blue Alliance
 * photos. Rules score CORAL off the front (`scoreSide` 0); SubLime and Miss Daisy collect on the back, Fiddler's claw
 * collects at the front.
 *
 *  - 1678 Citrus Circuits SUBLIME: lime green, one tall black elevator tower with sponsor panels and a purple LED strip,
 *    green star-wheel floor intake (CD reveal photo; CAD / strategy release).
 *  - 971 Spartan Robotics FIDDLER: one tall silver column and a V-shaped claw of six orange wheels that grips CORAL and
 *    ALGAE and also IS the floor intake (TBA photos), so intake and scoring share the front.
 *  - 341 Miss Daisy XXIII: silver and yellow, thin continuous elevator, lantern-gear shoulder and white claw, green
 *    roller bank on a tilted front arm, red hoop climber (TBA photos, CD CAD release post).
 */

// ── 1678 SUBLIME ──
registerRobotModel('sublime-1678', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const lime = mat(0x5ad23c, { rough: 0.5 }), limeTube = tubeMat(0x5ad23c), black = mat(0x15171a, { metal: 0.3, rough: 0.5 }), silver = mat(0xc5cbd2, { metal: 0.7, rough: 0.3 }), clear = mat(0xdde5f0, { opacity: 0.3, rough: 0.2 });
  const db = drivebase(k, { tube: limeTube, motorRing: 0x5ad23c });
  // One tall tower (TBA photo): a thin black sponsor panel standing on silver rails, a purple LED strip across the top.
  const ex = -side * 0.05, ez = 0.12, top = H - 0.02;
  for (const sz of [-1, 1]) bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.035, black);
  plate(k.visual, [[ex - 0.1, bt - 0.02], [ex + 0.1, bt - 0.02], [ex + 0.1, top], [ex - 0.1, top]], 0.012, black, 0);
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI, z = sz * 0.008;
    decal(k.visual, 'SUBLIME', { w: 0.17, h: 0.05, color: '#5ad23c', background: '#15171a', x: ex, y: top - 0.2, z, rotY });
    decal(k.visual, 'fabworks', { w: 0.16, h: 0.035, color: '#ffffff', background: '#15171a', x: ex, y: top - 0.3, z, rotY });
    decal(k.visual, 'UCDAVIS  MMF', { w: 0.16, h: 0.035, color: '#ffffff', background: '#15171a', x: ex, y: top - 0.38, z, rotY });
    // Gusset from the tower foot to the frame rail.
    plate(k.visual, [[ex - 0.3, bt - 0.02], [ex - 0.04, bt - 0.02], [ex - 0.04, bt + 0.28]], 0.006, silver, sz * (ez + 0.03));
  }
  box(k.visual, 0.22, 0.03, 0.06, black, ex, top + 0.01, 0);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.012), mat(0xa65bff, { emissive: 0x7b3bd6 }));
  led.position.set(ex, top + 0.03, 0.032); k.visual.add(led);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex + side * 0.0, bt + 0.06, sz * (ez - 0.03)], [ex, top - 0.03, sz * (ez - 0.03)], 0.03, silver);
  const carriage = new THREE.Group(); stage.add(carriage);
  box(carriage, 0.04, 0.12, 2 * ez - 0.08, black, ex + side * 0.05, 0, 0);
  // Spectrum row 126 release + pit photos: dark elevator, large side-mounted climber sweep.
  // https://1678.onshape.com/documents/0d5fb3dc444f66866c3df100/w/3aa4dce6ea2c22f3ef57d096/e/0f84fb27f2a02ead9cf842de
  // Short arm and wrist: the end effector is a clear box with a pair of green rollers.
  const la = 0.62, arm = pivot(carriage, ex + side * 0.07, 0.04);
  for (const sz of [-1, 1]) bar(arm, [0, 0, sz * 0.06], [la - 0.05, 0, sz * 0.06], 0.026, silver);
  const eff = pivot(arm, la - 0.04, 0);
  sidePlates(eff, [[-0.03, -0.06], [0.1, -0.06], [0.14, 0], [0.1, 0.07], [-0.03, 0.06]], 0.085, clear, [], 0.008);
  const effWheels = [wheelShaft(eff, 0.0, 0.02, { n: 3, r: 0.035, w: 0.03, span: 0.12, colors: [0x5ad23c] }), wheelShaft(eff, 0.08, -0.03, { n: 3, r: 0.03, w: 0.03, span: 0.12, colors: [0x5ad23c] })];
  const held = pivot(eff, 0.05, -0.005), algaeHeld = pivot(eff,-.12,.02);
  // Floor intake: lime plates with two banks of green star wheels.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, rollerMaterial: mat(0x1c1e22) });
  const stars = [starWheels(intake.tip, -side * 0.0, 0, { n: 7, r: 0.05, span: c.intake.width * 0.85, m: lime }), starWheels(intake.tip, -side * -0.07, 0.03, { n: 7, r: 0.045, span: c.intake.width * 0.85, m: black })];
  box(k.visual, L / 2 - 0.1, 0.012, 0.16, black, side * L * 0.25, bt + 0.02, 0);
  battery(k.visual, -side * 0.28, bt - 0.02, 0.18, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, side * (0.15 + i * 0.065), bt, 0.24, 0x46ca79);
  // Climber at the scoring end: two lime posts and a lime cage hook that swings out.
  const climb = pivot(k.visual, -side * (L / 2 - 0.1), bt + 0.05, 0);
  for (const sz of [-1, 1]) { plate(k.visual, [[-side * (L / 2 - 0.14), bt - 0.02], [-side * (L / 2 - 0.06), bt - 0.02], [-side * (L / 2 - 0.08), bt + 0.2], [-side * (L / 2 - 0.12), bt + 0.2]], 0.008, lime, sz * 0.2); bar(climb, [0, 0, sz * 0.2], [0, 0.3, sz * 0.2], 0.022, limeTube); }
  tube(climb, [0, 0.3, -0.2], [0, 0.3, 0.2], 0.012, silver);
  // Broad pocketed hook cheeks attach to the same rotating cross shaft.
  for (const sign of [-1,1]) plate(climb,[[0,.03],[.12,.2],[.12,.52],[.04,.66],[-.09,.66],[-.14,.54],[-.07,.5],[-.035,.57],[.035,.57],[.045,.23],[-.04,.06]],.008,black,sign*.2,
    [[.035,.3,.022],[.035,.44,.022]]);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.7, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[1,0,0], handoffStyle:'conveyor', algaeAnchor: algaeHeld, algaeGripScale:[.76,.96,.72], intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    flow: { handoff: () => [flowAt(k, intake.tip), new THREE.Vector3(side * L * .3, bt + .09, 0), new THREE.Vector3(ex, bt + .1, 0)] },
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      if (p.handoff) goal = { yc: bt + .1 + la - .04, phi: -Math.PI / 2 };
      else if (stowed(p)) goal = { yc: bt + 0.3, phi: dir > 0 ? 1.25 : Math.PI - 1.25 };
      else goal = reachWith(p, dir, ex, la, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.max(0, yc - (top - 0.16));
      stage.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.handoff ? 0 : p.level === 4 ? -1.1 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      for (const st of stars) spin(st, -side * (s.intaking && s.enabled && deploy > 0.8 ? 26 : 0), s.dt);
      climb.rotation.x = approach(climb.rotation.x, (-1.2) * s.climb, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 971 FIDDLER (TBA 2025 photos): a low square robot with ONE tall silver perforated elevator column and a black
//    cable chain at the back end, a carriage and arm carrying a V-shaped claw: two arms each with three ORANGE wheels
//    that grip CORAL and ALGAE. There is no separate intake: the claw drops to the floor at the open end to pick CORAL
//    up, so the intake and the scoring end are the same end (config.intake.groundSide = front). A small hook arm
//    stands at that end for the climb. ──
registerRobotModel('fiddler-971', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 }), silverTube = tubeMat(0xc9ced5), orange = mat(0xff6a2a, { rough: 0.5 }), black = mat(0x16171a, { metal: 0.3, rough: 0.55 }), gray = mat(0x8f959d, { metal: 0.6, rough: 0.4 });
  const db = drivebase(k, { tube: silverTube, motorRing: 0xc8242b });
  const dir = 1; // scores (and picks up) off the front
  const ex = -0.14, top = H - 0.02;
  // Elevator: a thick perforated column on the centreline with the cable chain beside it, gussets to the frame.
  // Spectrum row 119, 2025 971 Main Robot + pit photos: open blue/silver braced elevator.
  // https://frc971.onshape.com/documents/7fe785bbcbd521f1316ad2c6/v/5a4a017acd66b28d2f8c7684/e/194d67360c254300114d8b67
  // Elevator/arm, same-end claw intake/scoring; orange grip wheels; timings and dimensions [EST].
  const towerHalf = .14, blueTube = tubeMat(0x477aa9);
  for (const sign of [-1,1]) {
    bar(k.visual,[ex,bt,sign*towerHalf],[ex,top,sign*towerHalf],.03,silverTube);
    bar(k.visual,[ex-.09,bt,sign*towerHalf],[ex-.09,top,sign*towerHalf],.023,silverTube);
    bar(k.visual,[ex-.09,bt,sign*towerHalf],[ex,top,sign*towerHalf],.015,blueTube);
  }
  bar(k.visual,[ex,bt,-towerHalf],[ex,top,towerHalf],.015,blueTube);
  bar(k.visual,[ex,bt,towerHalf],[ex,top,-towerHalf],.015,blueTube);
  box(k.visual, 0.03, top - bt - 0.1, 0.05, black, ex + 0.05, (top + bt) / 2 - 0.02, 0.1); // cable chain
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt, sz * 0.08], [ex + 0.3, bt, sz * (W / 2 - 0.06)], 0.022, silverTube);
    plate(k.visual, [[ex - 0.06, bt - 0.02], [ex + 0.22, bt - 0.02], [ex + 0.02, bt + 0.3]], 0.006, gray, sz * 0.1);
  }
  box(k.visual, 0.1, 0.04, 0.2, silver, ex, top, 0);
  const stage = new THREE.Group(); stage.name = 'fiddler-moving-stage'; k.visual.add(stage);
  for (const sign of [-1,1]) bar(stage,[ex+.06,bt+.15,sign*.1],[ex+.06,top-.05,sign*.1],.026,silverTube);
  bar(stage,[ex+.06,top-.05,-.1],[ex+.06,top-.05,.1],.024,silverTube);
  const middleStage = stage.clone(); middleStage.name = 'fiddler-middle-stage'; k.visual.add(middleStage);
  const carriage = new THREE.Group(); carriage.name = 'fiddler-carriage'; stage.add(carriage);
  box(carriage, 0.03, 0.14, 0.18, gray, ex + 0.1, 0, 0);
  // Arm and V-shaped claw: each side arm carries three orange wheels.
  const la = 0.78, ax = ex + 0.14, arm = pivot(carriage, ax, 0.03);
  bar(arm, [0, 0, 0], [la - 0.12, 0, 0], 0.03, silverTube);
  box(arm, 0.06, 0.07, 0.1, black, la - 0.12, 0, 0);
  const eff = pivot(arm, la - 0.1, 0);
  const wheels: THREE.Mesh[] = [];
  for (const sz of [-1, 1]) {
    const a2 = pivot(eff, 0, 0, 0);
    a2.rotation.y = sz * 0.5;
    bar(a2, [0, 0, 0], [0.2, 0, 0], 0.012, gray);
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.026, 18), orange);
      w.rotation.x = Math.PI / 2; w.position.set(0.04 + i * 0.075, 0, 0.0); a2.add(w); wheels.push(w);
    }
  }
  const held = pivot(eff, 0.13, 0), algaeHeld = pivot(eff, .25, 0);
  const tip = pivot(eff, 0.13, -0.02);
  // Hook arm at the open end for the climb.
  const hook = pivot(k.visual, L / 2 - 0.12, bt + 0.05, W / 2 - 0.08);
  for (const sz of [-1, 1]) plate(k.visual, [[L / 2 - 0.2, bt - 0.02], [L / 2 - 0.08, bt - 0.02], [L / 2 - 0.12, bt + 0.2], [L / 2 - 0.18, bt + 0.2]], 0.008, gray, sz * (W / 2 - 0.08));
  bar(hook, [0, 0, 0], [0, 0.3, 0], 0.024, silverTube);
  box(hook, 0.07, 0.03, 0.03, black, 0.0, 0.3, 0);
  battery(k.visual, -0.02, bt - 0.02, 0.2, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, 0.06 + i * 0.065, bt, -0.2, 0x46ca79);
  let yc = bt + 0.2, phi = 1.2;
  const yMin = bt + 0.1, yMax = top + 1.2;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[1,0,0], handoffStyle:'direct', algaeAnchor: algaeHeld, algaeGripScale:[.96,.96,.96], intakeAnchor: tip, lightAt: [ex, top + 0.02, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      // Handoff / intake: the claw dips to the floor at the front. Stowed: arm up over the elevator.
      const collecting = !!p.handoff || (s.enabled && s.intaking && stowed(p));
      const pitch = collecting ? -.1 : p.level === 4 ? -1.2 : p.level === 1 ? 0 : -.5;
      if (collecting) goal = { yc: .11 - .03 + Math.sin(.75) * (la - .1) + Math.sin(.1) * .13, phi: -.75 };
      else if (stowed(p)) goal = { yc: yMin, phi: 1.25 };
      else goal = reachWith({ ...p, forward: p.forward - .13 * Math.cos(pitch), height: p.height - .03 - .13 * Math.sin(pitch) }, dir, ax, la - .1, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.max(0, yc - (top - 0.14));
      middleStage.position.y = ext * .5;
      stage.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + pitch;
      for (const w of wheels) w.rotation.z += (s.intaking ? 22 : s.firing > 0 ? -30 : 0) * s.dt;
      hook.rotation.x = approach(hook.rotation.x, (-1.2) * s.climb, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 341 MISS DAISY (TBA 2025 photos): all SILVER aluminium with YELLOW printed brackets: one tall, thin continuous
//    elevator with a yellow-trimmed carriage, a blue sponsor banner across its foot, a white claw on a lantern-gear
//    shoulder, a long green-wheeled roller bank on a tilted arm over the front bumper, and a red cage-hoop climber ──
registerRobotModel('miss-daisy-341', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const yellow = mat(0xe8c21a, { rough: 0.5 }), red = mat(0xc8242b, { rough: 0.5 }), redTube = tubeMat(0xc8242b), white = mat(0xeef0f2, { rough: 0.5 }), silver = mat(0xc5cbd2, { metal: 0.7, rough: 0.3 }), silverTube = tubeMat(0xc5cbd2), black = mat(0x16181b, { metal: 0.3, rough: 0.55 }), green = mat(0x3fa84a, { rough: 0.6 });
  // Spectrum row 105 / Team 341 CAD Release: yellow carriage brackets and exposed black belts.
  // https://cad.onshape.com/documents/2d1e3ac103dba342712c2c99/w/060f69714e723dd87d33ba97/e/bbd3959b191284cc99eb4f56
  // Keep the white later-season claw seen in the pit photo; the CAD uses blue grip hubs.
  const db = drivebase(k, { tube: silverTube, motorRing: 0xe8c21a });
  // Continuous elevator: tall silver uprights with a black top plate, the carriage riding on the moving stages.
  const ex = -side * 0.08, ez = 0.13, top = H - 0.02;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.04, silverTube);
    bar(k.visual, [side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.4, sz * ez], 0.022, silverTube);
    bar(k.visual, [-side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.36, sz * ez], 0.022, silverTube);
  }
  box(k.visual, 0.05, 0.05, 2 * ez + 0.06, black, ex, top, 0);
  for (const sz of [-1, 1]) belt(k.visual, [ex + side * 0.03, bt + 0.05], [ex + side * 0.03, top - 0.05], sz * (ez - 0.03), 0.018);
  motor(k.visual, ex - side * 0.03, bt + 0.05, 0, 0xe8c21a);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex - side * 0.045, bt + 0.06, sz * (ez - 0.01)], [ex - side * 0.045, top - 0.03, sz * (ez - 0.01)], 0.03, silverTube);
  bar(stage, [ex - side * 0.045, top - 0.04, -ez], [ex - side * 0.045, top - 0.04, ez], 0.026, silverTube);
  const stage2 = new THREE.Group(); k.visual.add(stage2);
  for (const sz of [-1, 1]) bar(stage2, [ex - side * 0.07, bt + 0.1, sz * (ez - 0.03)], [ex - side * 0.07, top - 0.06, sz * (ez - 0.03)], 0.024, silverTube);
  const carriage = new THREE.Group(); stage2.add(carriage);
  box(carriage, 0.012, 0.15, 2 * ez - 0.1, silver, ex - side * 0.09, 0, 0);
  for (const sign of [-1,1]) box(carriage,.045,.035,.06,yellow,ex-side*.065,sign*.06,sign*(ez-.03));
  // Lantern-gear shoulder (a big round gear plate) and a truss arm with a 180° wrist.
  const la = 0.5, ax = ex - side * 0.1;
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 28), silver);
  gear.rotation.x = Math.PI / 2; gear.position.set(ax, 0.04, 0.09); carriage.add(gear);
  const arm = pivot(carriage, ax, 0.04);
  lattice(arm, [0, -0.025, 0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  lattice(arm, [0, -0.025, -0.06], [la - 0.05, 0, 0], [0, 0.05, 0], { cells: 5, w: 0.012, m: silver, zig: true });
  const eff = pivot(arm, la - 0.04, 0);
  sidePlates(eff, [[-0.03, -0.06], [0.1, -0.06], [0.14, 0], [0.1, 0.07], [-0.03, 0.06]], 0.085, white, [], 0.008);
  box(eff, 0.04, 0.03, 0.18, yellow, -0.02, 0.05, 0);
  const effWheels = [wheelShaft(eff, 0.02, 0.03, { n: 3, r: 0.034, w: 0.028, span: 0.12, colors: [0xeef0f2] }), wheelShaft(eff, 0.1, -0.03, { n: 3, r: 0.03, w: 0.028, span: 0.12, colors: [0xeef0f2] })];
  const held = pivot(eff, 0.06, 0), algaeHeld = pivot(eff, .22, 0);
  // Floor CORAL intake: a row of green wheels across the front on blue plates.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: silverTube, rollerMaterial: green });
  const bank = starWheels(intake.tip, 0, 0, { n: 9, r: 0.04, span: c.intake.width * 0.88, m: green, spikes: 5 });
  box(k.visual, L / 2 - 0.1, 0.012, 0.14, black, side * L * 0.25, bt + 0.02, 0);
  battery(k.visual, -side * 0.3, bt - 0.02, 0.2, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, side * (0.1 + i * 0.065), bt, -0.2, 0x46ca79);
  // Blue sponsor banner across the foot of the tower.
  for (const sz of [-1, 1]) decal(k.visual, 'TEAM 341  MISS DAISY', { w: 0.3, h: 0.07, color: '#ffffff', background: '#2a55d6', x: ex, y: bt + 0.08, z: sz * (ez + 0.03), rotY: sz > 0 ? 0 : Math.PI });
  for (const y of [bt + 0.35, top - 0.1]) box(k.visual, 0.05, 0.05, 2 * ez + 0.08, yellow, ex, y, 0);
  // Compact deep climber at the scoring end: a short blue tower and swing arm.
  const cz = -(W / 2 - 0.05), climb = pivot(k.visual, -side * (L / 2 - 0.14), bt + 0.05, cz);
  plate(k.visual, [[-side * (L / 2 - 0.2), bt - 0.02], [-side * (L / 2 - 0.08), bt - 0.02], [-side * (L / 2 - 0.1), bt + 0.2], [-side * (L / 2 - 0.18), bt + 0.2]], 0.008, red, cz);
  bar(climb, [0, 0, 0.012], [0, 0.32, 0.012], 0.028, redTube);
  tube(climb, [-0.14, 0.32, 0.012], [0.14, 0.32, 0.012], 0.014, redTube);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.7, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[1,0,0], handoffStyle:'toss', algaeAnchor: algaeHeld, algaeGripScale:[.94,1,.94], intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    flow: { handoff: () => [flowAt(k, intake.tip), new THREE.Vector3(side * L * .3, bt + .09, 0), new THREE.Vector3(ex, bt + .1, 0)] },
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      if (p.handoff) goal = { yc: bt + .1 + la - .04, phi: -Math.PI / 2 };
      else if (stowed(p)) goal = { yc: bt + 0.3, phi: dir > 0 ? Math.PI + 0.9 : -0.9 };
      else goal = reachWith(p, dir, ax, la, yMin, yMax);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      const ext = Math.max(0, yc - (top - 0.14));
      stage.position.y = ext / 2; stage2.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.handoff ? 0 : p.level === 4 ? -1.2 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, p.handoff ? 1 : intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      spin(bank, -side * (s.intaking && s.enabled && deploy > 0.8 ? 26 : 0), s.dt);
      climb.rotation.x = approach(climb.rotation.x, (-1.2) * s.climb, 5, s.dt);
      db.update(s);
    },
  };
});

// Spectrum row 110: Zuma's broad silver elevator, carbon arm/wrist and black roller intake.
registerRobotModel('zuma-581', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, bt = c.bumperTop, top = c.height - 0.02, side = k.groundSide;
  const alu = tubeMat(0xbec6d0), silver = mat(0xbec6d0, { metal: 0.7 }), black = mat(0x17191c, { rough: 0.6 });
  const db = drivebase(k, { tube: alu });
  const ex = -side * 0.06, ez = W * 0.24;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt, sz * ez], [ex, top, sz * ez], 0.035, alu);
    bar(k.visual, [side * L * 0.35, bt, sz * W * 0.4], [ex, top - 0.12, sz * ez], 0.025, alu);
    belt(k.visual, [ex, bt + 0.06], [ex, top - 0.025], sz * (ez - 0.02), 0.016);
    motor(k.visual, ex, bt + 0.06, sz * (ez + 0.04));
  }
  bar(k.visual, [ex, top, -ez], [ex, top, ez], 0.03, alu);
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex + 0.035, bt + 0.06, sz * (ez - 0.025)], [ex + 0.035, top - 0.04, sz * (ez - 0.025)], 0.025, alu);
  bar(stage, [ex + 0.035, top - 0.04, -ez], [ex + 0.035, top - 0.04, ez], 0.025, alu);
  const stage2 = new THREE.Group(); k.visual.add(stage2);
  for (const sz of [-1, 1]) bar(stage2, [ex + 0.06, bt + 0.1, sz * (ez - 0.045)], [ex + 0.06, top - 0.07, sz * (ez - 0.045)], 0.021, alu);
  bar(stage2, [ex + 0.06, top - 0.07, -ez + 0.045], [ex + 0.06, top - 0.07, ez - 0.045], 0.021, alu);
  const carriage = pivot(k.visual, ex, bt + 0.12);
  carriage.rotation.y=Math.PI/2; // Sideways shoulder face, matching the supplied assembly.
  box(carriage, 0.08, 0.12, 2 * ez, black, 0, 0, 0);
  const arm = pivot(carriage, 0.04, 0), la = 0.65;
  for (const sz of [-1, 1]) lattice(arm, [0, -0.025, sz * 0.045], [la - 0.07, 0, 0], [0, 0.05, 0], { cells: 8, w: 0.01, m: silver, zig: true });
  const wrist = pivot(arm, la, 0);
  sidePlates(wrist, [[-0.07, -0.08], [0.1, -0.07], [0.1, 0.07], [-0.07, 0.08]], 0.08, black);
  const wheels = [wheelShaft(wrist, 0.045, -0.055, { n: 2, r: 0.045, w: 0.035, span: 0.12, colors: [0x282a2d] }), wheelShaft(wrist, 0.045, 0.055, { n: 2, r: 0.045, w: 0.035, span: 0.12, colors: [0x282a2d] })];
  const held = pivot(wrist, 0.07, 0), algaeHeld = pivot(wrist, .24, 0);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, rollerMaterial: black });
  const stars = starWheels(intake.tip, 0, 0, { n: 9, r: 0.04, span: c.intake.width * 0.9, m: black });
  box(k.visual, L * 0.42, 0.015, W * 0.52, black, side * L * 0.19, bt + 0.025, 0);
  battery(k.visual, -side * L * 0.25, bt, W * 0.3);
  const climber = pivot(k.visual, side * L * 0.22, bt + 0.05, -W * 0.32);
  for (const sz of [-1, 1]) bar(climber, [0, 0, sz * 0.07], [0, 0.32, sz * 0.07], 0.025, black);
  bar(climber, [0, 0.32, -0.07], [0, 0.32, 0.07], 0.025, alu);
  let yc = bt + 0.15, phi = Math.PI / 2, deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis:[0,0,1], handoffStyle:'conveyor', algaeAnchor: algaeHeld, algaeGripScale:[.94,1,.94], intakeAnchor: intake.tip, lightAt: [ex, top + 0.02, 0],
    flow: { handoff: () => [flowAt(k, intake.tip), new THREE.Vector3(side * L * .3, bt + .09, 0), new THREE.Vector3(ex, bt + .1, 0)] },
    update(s) {
      const p = place(s), yMin = bt + 0.12;
      const goal = p.handoff ? { yc: bt + .1 + la, phi: -Math.PI / 2 } : stowed(p) ? { yc: yMin, phi: Math.PI / 2 } : reachWith(p, 1, ex + 0.04, la, yMin, top + 0.9);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 10, s.dt);
      const ext = Math.max(0, yc - top + 0.1);
      carriage.position.y = yc; stage.position.y = ext / 2; stage2.position.y = ext;
      arm.rotation.z = phi; wrist.rotation.z = -phi + (p.handoff || stowed(p) ? 0 : p.level === 4 ? -Math.PI / 2 : p.level === 1 ? 0 : -.6);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt); intake.update(s, deploy);
      spin(stars, s.enabled && s.intaking ? -side * 25 : 0, s.dt);
      for (const w of wheels) spin(w, s.enabled && (s.intaking || p.handoff) ? 20 : 0, s.dt);
      climber.rotation.z = approach(climber.rotation.z, (-side * 0.9) * s.climb, 5, s.dt);
      db.update(s);
    },
  };
});

const cfg = (team: number, model: string, o: { lift: number; release: number; harvest: number; speed: number; climb: number; height: number; weight: number; cycle: number; frame?: [number, number]; frontIntake?: boolean; algae?: 'reef' | 'reefGround'; algaeScore?: 'processor' | 'both' }) => {
  const c = build({ coral: 'l4', intake: 'ground', algae: o.algae ?? 'reefGround', algaeScore: o.algaeScore ?? 'both', climb: 2, align: true, speed: o.speed, weight: o.weight, cycle: o.cycle });
  c.teamNumber = team; c.model = model;
  c.options = { ...c.options, dualPieceStorage: model === 'sublime-1678', coralBuffer:model==='zuma-581', ...(model==='zuma-581'?{coralBufferLocation:'intake'}:{}) };
  c.height = inch(o.height); c.mass = lb(o.weight);
  if (o.frame) { c.frameLength = inch(o.frame[0]); c.frameWidth = inch(o.frame[1]); }
  if (o.frontIntake) { c.intake.groundSide = 'front'; c.intake.stationSide = 'front'; }
  if(model==='zuma-581')c.placement!.scoreSide='sides';
  if (model === 'fiddler-971') c.placement!.handoffSeconds = 0; // claw picks directly from the floor
  c.placement!.liftSpeed = o.lift; c.placement!.cycleSeconds = o.release; c.placement!.harvestSeconds = o.harvest;
  c.climber.secondsToClimb = o.climb;
  return normalizeReefscapeConfig(c);
};

export function moreReefscapeTeamRobots(): TeamRobot[] {
  return [
    { id: 'zuma-581', team: 581, name: 'Zuma',
      description: '581 Blazing Bulldogs. Silver continuous elevator with a long truss arm, rotating wrist and black CORAL/ALGAE gripper, separate floor intake that stages CORAL while ALGAE occupies the claw, and deep-cage climber. Dimensions, lift, release and speed are simulator estimates.',
      source: 'Supplied BB581 2025 TLA.glb; Spectrum CAD Collection row 110, 581 2025 Zuma; team reveal https://www.chiefdelphi.com/t/493323',
      config: cfg(581, 'zuma-581', { lift: 2.2, release: 0.35, harvest: 0.4, speed: 4.7, climb: 2.5, height: 40, weight: 126, cycle: 0.6 }) },
    { id: 'sublime-1678', team: 1678, name: 'SubLime',
      description: '1678 Citrus Circuits. A lime-green single tall elevator tower with a purple LED strip, a short arm and clear end effector that holds CORAL and ALGAE simultaneously and places CORAL on all levels, with a star-wheel CORAL floor intake and a deep-cage climb. One of the fastest cyclers of 2025. Lift, release and speed are simulator estimates.',
      source: 'Supplied 1678-2025-O-0000.glb; Chief Delphi "1678 Citrus Circuits 2025 Robot: SubLime" and "1678 2025 CAD, Code and Strategy Release"',
      config: cfg(1678, 'sublime-1678', { lift: 2.5, release: 0.3, harvest: 0.4, speed: 4.8, climb: 2.2, height: 40, weight: 126, cycle: 0.5 }) },
    { id: 'fiddler-971', team: 971, name: 'Fiddler',
      description: '971 Spartan Robotics. A swerve robot with a silver truss elevator and a V-shaped claw of orange wheels that grips CORAL and ALGAE and also IS the floor intake (it dips to the carpet on the open end, so there is no separate intake mouth), and a deep climb. Dimensions, lift and timings are estimates.',
      source: 'Chief Delphi "FRC 971 Spartan Robotics 2025 robot reveal - Fiddler" (reveal video still and Q&A)',
      config: cfg(971, 'fiddler-971', { lift: 2.1, release: 0.35, harvest: 0.45, speed: 4.9, climb: 2.0, height: 40, weight: 124, cycle: 0.55, algae: 'reef', frontIntake: true }) },
    { id: 'miss-daisy-341', team: 341, name: 'Miss Daisy',
      description: '341 Miss Daisy XXIII (Archimedes alliance captain, 82% win rate). Coral floor intake, continuous elevator, lantern-gear driven shoulder, 180° wrist and a compact deep climber; a "superstructure" in code keeps the arm from hitting the robot. Timings and speed are estimates.',
      source: 'Chief Delphi "Team 341 - Miss Daisy 2025 CAD, Code, and Documentation Release"',
      config: cfg(341, 'miss-daisy-341', { lift: 2.3, release: 0.35, harvest: 0.35, speed: 4.5, climb: 2.3, height: 41, weight: 128, cycle: 0.6, algae: 'reef', algaeScore: 'processor' }) },
  ];
}
