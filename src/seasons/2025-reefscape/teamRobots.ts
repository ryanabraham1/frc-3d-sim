import { additionalReefscapeTeamRobots } from './additionalTeamRobots';
import { moreReefscapeTeamRobots } from './moreTeamRobots';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, intakeDeployTarget, lattice, ledStrip, mat, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, type ModelKit, type PlaceAnim, type RobotAnimState } from '@engine/robot/models';
import { inch, lb } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';
import { subZero1778 } from './subZero1778';

/**
 * Real 2025 REEFSCAPE robots (docs/ROBOT-ARCHETYPES.md "Real team robots"). The REEFSCAPE rules own the end
 * effector pose (`RobotAnimState.place`: height / forward reach / level); these models draw the mechanism that
 * gets it there — elevator, pivoting elevator or telescoping arm — and replace the generic mast.
 */

/** Rules' end effector, or a stowed pose before the first frame. */
function place(s: RobotAnimState): PlaceAnim {
  return s.place ?? { height: 0.45, forward: 0.3, level: 1 };
}

/** Wrist pitch per level: flat for the L1 trough, angled for L2/L3, straight down over L4. */
function wristFor(level: number): number {
  return level === 4 ? -1.25 : level === 1 ? 0 : -0.55;
}

/** End effector: side plates and two rollers that spin while intaking or releasing. */
function endEffector(parent: THREE.Object3D, plateM: THREE.Material, roll: THREE.Material, w = 0.26): { wrist: THREE.Group; rollers: THREE.Group[] } {
  const wrist = pivot(parent, 0, 0);
  sidePlates(wrist, [[-0.02, -0.07], [0.17, -0.07], [0.2, -0.02], [0.2, 0.05], [0.14, 0.075], [-0.02, 0.07]], w / 2, plateM, [[0.06, 0, 0.025]]);
  box(wrist, 0.04, 0.03, w + 0.01, plateM, -0.01, 0, 0);
  box(wrist, 0.16, 0.008, w, plateM, 0.06, -0.065, 0);
  const rollers = [roller(wrist, 0.028, w - 0.01, roll, 0.13, 0.045), roller(wrist, 0.028, w - 0.01, roll, 0.13, -0.045)];
  return { wrist, rollers };
}

function spinRollers(rollers: THREE.Group[], s: RobotAnimState): void {
  const rate = s.intaking ? 22 : s.firing > 0 ? -30 : 0;
  for (const r of rollers) spin(r, rate, s.dt);
}

// ── 254 Undertow (photo: team254.com/first/2025): tall blue two-stage elevator with a black zig-zag across the top,
//    a huge smoked-gray CORAL funnel at the back with the NASA logo, black sponsor plate, black ground-intake linkage
//    out the back, end effector with two black rollers ──
registerRobotModel('undertow-254', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const blue = mat(0x1f5fd0, { metal: 0.6, rough: 0.35 });
  const blueTube = tubeMat(0x1f5fd0);
  const black = mat(0x151619, { metal: 0.35, rough: 0.55 });
  const smoke = mat(0x2a2d33, { opacity: 0.72, metal: 0.1, rough: 0.25 });
  const db = drivebase(k, { motorRing: 0x1f5fd0 });
  // Elevator: fixed blue uprights with the zig-zag truss on top; two nested stages.
  const ex = 0.12;
  const ez = 0.16;
  const fixedH = H - bt - 0.03;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt, sz * ez], [ex, H - 0.03, sz * ez], 0.035, blueTube);
    bar(k.visual, [ex - 0.03, bt, sz * ez], [ex - 0.03, H - 0.03, sz * ez], 0.035, blueTube);
  }
  lattice(k.visual, [ex - 0.015, H - 0.08, -ez], [0, 0, 2 * ez], [0, 0.05, 0], { cells: 6, w: 0.012, m: black, zig: true });
  const stages: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const iz = ez - 0.035 * (i + 1);
    for (const sz of [-1, 1]) bar(g, [ex + 0.02 + i * 0.015, bt + 0.04, sz * iz], [ex + 0.02 + i * 0.015, bt + fixedH - 0.02, sz * iz], 0.028, blueTube);
    bar(g, [ex + 0.02 + i * 0.015, bt + fixedH - 0.03, -iz], [ex + 0.02 + i * 0.015, bt + fixedH - 0.03, iz], 0.022, i ? black : blue);
    k.visual.add(g);
    stages.push(g);
  }
  for (const sz of [-1, 1]) {
    bar(k.visual, [-L * 0.36, bt, sz * W * 0.34], [ex - 0.03, H * 0.7, sz * ez], 0.025, blue);
    bar(k.visual, [ex, bt, sz * ez], [ex, H - 0.04, sz * ez], 0.008, black);
  }
  box(k.visual, 0.08, 0.08, 0.3, black, ex - 0.025, bt + 0.04, 0);
  // End effector on the inner stage.
  const carriage = new THREE.Group();
  k.visual.add(carriage);
  box(carriage, 0.05, 0.16, 0.24, black, 0, 0, 0);
  const eff = endEffector(carriage, mat(0x8a9099, { metal: 0.2 }), black);
  const reach = box(carriage, 1, 0.03, 0.16, blue);
  const held = pivot(eff.wrist, 0.1, 0);
  // Smoked CORAL funnel on the back: an open chute leaning back toward the station, NASA logo on both sides.
  const fun = new THREE.Group();
  fun.position.set(-L / 2 + 0.2, H - 0.62, 0);
  fun.rotation.z = 0.32; // top leans out over the back
  k.visual.add(fun);
  const fw = W * 0.82;
  const fh = 0.55;
  for (const sz of [-1, 1]) plate(fun, [[-0.16, 0], [0.12, 0], [0.16, fh], [-0.3, fh]], 0.006, smoke, (sz * fw) / 2);
  box(fun, 0.006, fh, fw, smoke, -0.23, fh / 2, 0).rotation.z = 0.25; // back wall
  box(fun, 0.006, fh * 0.55, fw, smoke, 0.14, fh * 0.28, 0); // low front wall
  for (const sz of [-1, 1]) {
    decal(fun, 'NASA', { w: 0.13, h: 0.13, round: true, background: '#1d4fa3', x: -0.05, y: fh * 0.6, z: sz * (fw / 2 + 0.006), rotY: sz > 0 ? 0 : Math.PI });
    bar(fun, [-0.16, 0, (sz * fw) / 2], [-0.3, fh, (sz * fw) / 2], 0.012, black); // edge trim
  }
  for (const sz of [-1, 1]) bar(k.visual, [-L * 0.32, bt, sz * fw * 0.38], [fun.position.x, fun.position.y + 0.04, sz * fw * 0.38], 0.03, black);
  // Black sponsor plate on the side.
  plate(k.visual, [[-L * 0.25, bt], [0.02, bt], [0.02, bt + 0.2], [-L * 0.2, bt + 0.24]], 0.005, black, -W / 2 + 0.03);
  let y = bt + 0.19;
  for (const name of ['Johnson&Johnson MedTech', 'Greg and Gloria Shean', 'fabworks.']) {
    decal(k.visual, name, { w: 0.15, h: 0.025, x: -L * 0.12, y, z: -W / 2 + 0.024, rotY: Math.PI });
    y -= 0.045;
  }
  // Black ground-intake linkage out the back with the (orange) intake rollers.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, stow: Math.PI - 0.5 });
  // Roller claw that swings out of the side to latch the CAGE.
  const claw = pivot(k.visual, -L * 0.1, H - 0.3, W / 2 - 0.04);
  box(claw, 0.03, 0.22, 0.03, blue, 0, 0.11, 0);
  const clawRoller = roller(claw, 0.03, 0.12, black, 0, 0.22);
  let ext = 0;
  let wrist = 0;
  let deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'funnel', 'climber'],
    heldAnchor: held,
    intakeAnchor: intake.tip,
    lightAt: [ex - 0.015, H - 0.01, 0],
    update(s) {
      const p = place(s);
      ext = approach(ext, Math.max(0, p.height - (H - 0.15)), 14, s.dt);
      stages[0].position.y = ext * 0.5;
      stages[1].position.y = ext;
      const carriageY = p.height <= H - 0.15 ? p.height : H - 0.15 + ext;
      carriage.position.set(ex + 0.07, carriageY, 0);
      const forward = Math.max(0.06, p.forward - ex - 0.17);
      reach.scale.x = forward; reach.position.x = forward / 2;
      eff.wrist.position.x = forward;
      // Handoff: the wrist flips back to meet the ground intake folding up over the back bumper.
      wrist = approach(wrist, p.handoff ? Math.PI - 0.5 : wristFor(p.level), 8, s.dt);
      eff.wrist.rotation.z = wrist;
      spinRollers(eff.rollers, s);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      claw.rotation.x = approach(claw.rotation.x, s.climb > 0.1 ? 1.3 : 0, 5, s.dt); // swings out to the robot's right (+z)
      spin(clawRoller, s.climb > 0.5 ? 12 : 0, s.dt);
      db.update(s);
    },
  };
});

// ── 2910 Spectre (photos: The Blue Alliance 2025 media): low dark chassis, a gray lattice-truss telescoping arm on a
//    big geared pivot, green LED strips glowing along the arm and frame, brass ballast up front ──
registerRobotModel('spectre-2910', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const bt = c.bumperTop;
  const deck = mat(0x1d1f23, { metal: 0.4, rough: 0.5 });
  const gray = tubeMat(0xa7aeb6);
  const black = mat(0x141517, { metal: 0.35 });
  const brass = mat(0xc9a13a, { metal: 0.85, rough: 0.3 });
  const GREEN = 0x39ff6a;
  const db = drivebase(k, { motorRing: GREEN });
  box(k.visual, L * 0.95, 0.01, W * 0.92, deck, 0, bt + 0.005, 0);
  for (const sz of [-1, 1]) ledStrip(k.visual, [-L / 2 + 0.03, bt + 0.015, sz * (W / 2 - 0.03)], [L / 2 - 0.03, bt + 0.015, sz * (W / 2 - 0.03)], GREEN);
  box(k.visual, 0.06, 0.06, W * 0.8, brass, L / 2 - 0.06, bt + 0.04, 0);
  // Pivot: dark side towers with a big visible gear.
  const px = -L * 0.2;
  const py = bt + 0.27;
  sidePlates(k.visual,[[px-.2,bt],[px+.22,bt],[px+.12,py+.08],[px-.08,py+.08]],.15,k.mats.alu,
    [[px-.08,bt+.07,.027],[px+.04,bt+.11,.035],[px+.02,py,.025]]);
  for (const sz of [-1, 1]) {
    const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 32), gray);
    gear.rotation.x = Math.PI / 2;
    gear.position.set(px, py, sz * 0.145);
    k.visual.add(gear);
  }
  // Spectrum row 154 / 2025 Robot Top Level Assembly: wide nested truss stages on pocketed cheek plates.
  // https://2910.onshape.com/documents/f33ab032b00dc4b711aa86a6/w/951c0955d38b370eab02b587/e/415a66cb7efdf4aba6199086
  // Telescoping arm, same-end collection/scoring, silver structure, black wheels and blue hubs; rates [EST].
  // Telescoping lattice-truss arm (three stages) with green LEDs.
  const arm = pivot(k.visual, px, py);
  const seg = 0.6;
  const truss = (parent: THREE.Object3D, h: number, w: number): void => {
    for (const sy of [-1, 1]) lattice(parent, [0, (sy * h) / 2, -w / 2], [seg, 0, 0], [0, 0, w], { cells: 5, w: 0.012, m: gray, zig: true });
    for (const sz of [-1, 1]) lattice(parent, [0, -h / 2, (sz * w) / 2], [seg, 0, 0], [0, h, 0], { cells: 5, w: 0.01, m: gray, zig: true, border: false });
  };
  truss(arm, 0.09, 0.22);
  ledStrip(arm, [0.02, 0.05, 0], [seg - 0.02, 0.05, 0], GREEN);
  const mid = new THREE.Group();
  const inner = new THREE.Group();
  arm.add(mid, inner);
  truss(mid, 0.07, 0.17);
  truss(inner, 0.05, 0.13);
  ledStrip(inner, [0.02, 0.026, 0], [seg - 0.02, 0.026, 0], GREEN);
  box(arm, seg, 0.014, 0.11, black, seg / 2, -0.048, 0);
  box(mid, seg, 0.012, 0.075, mat(0x69717a, { metal: 0.5 }), seg / 2, -0.034, 0);
  const tip = pivot(arm, seg, 0);
  const eff = endEffector(tip, black, mat(0x6f757d, { metal: 0.3 }), 0.2);
  const held = pivot(eff.wrist, 0.1, 0);
  // Climber: a carriage with blue compliant wheels that slides along the arm and grabs the CAGE.
  const climber = new THREE.Group();
  arm.add(climber);
  roller(climber, 0.04, 0.16, mat(0x2f80ed, { metal: 0.1 }), 0, 0.07);
  // Side brackets carry the roller on the truss (it slides along the top chords).
  sidePlates(climber, [[-0.035, 0.035], [0.035, 0.035], [0.02, 0.085], [-0.02, 0.085]], 0.088, black);
  let ang = 0.3;
  let len = seg;
  let wrist = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    intakeAnchor: held,
    lightAt: [-L * 0.42, bt + 0.03, W * 0.3],
    update(s) {
      const p = place(s);
      const collecting = s.enabled && s.intaking || !!p.handoff;
      const pitch = collecting ? 0 : wristFor(p.level);
      const forward = collecting ? k.fp.length / 2 + c.intake.reach * .6 : p.forward;
      const height = collecting ? .11 : p.height;
      // Solve to the piece center, including the wrist-to-piece offset.
      const dx = forward - px - .1 * Math.cos(pitch);
      const dy = height - py - .1 * Math.sin(pitch);
      ang = approach(ang, Math.atan2(dy, dx), 10, s.dt);
      len = approach(len, Math.max(seg, Math.hypot(dx, dy)), 10, s.dt);
      arm.rotation.z = ang;
      const travel = len - seg;
      mid.position.x = travel * 0.5;
      inner.position.x = travel;
      tip.position.x = seg + travel;
      wrist = approach(wrist, pitch - ang, 8, s.dt);
      tip.rotation.z = wrist;
      spinRollers(eff.rollers, s);
      climber.position.x = approach(climber.position.x, s.climb > 0.1 ? seg * 0.3 : seg * 0.8, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 1323 MadTown (photo: The Blue Alliance 2025 media): a blue anodized four-stage elevator on tall black pivot towers,
//    resting leaned forward ~45° with its end effector high; black cable chains along the stages, black sponsor
//    gussets, black end effector with a differential wrist; CORAL + ALGAE floor intakes on the back ──
registerRobotModel('madtown-1323', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const bt = c.bumperTop;
  const blue = mat(0x2b74ff, { metal: 0.45, rough: 0.35 });
  const blueTube = tubeMat(0x2b74ff);
  const black = mat(0x141517, { metal: 0.35, rough: 0.55 });
  const chain = mat(0x0c0c0d, { rough: 0.9 });
  const db = drivebase(k, { motorRing: 0x2b74ff });
  box(k.visual, L * 0.95, 0.008, W * 0.92, black, 0, bt + 0.004, 0);
  // Tall black pivot towers (pocketed), sponsor decals, axle and drive sprocket.
  const px = -L * 0.16;
  const py = bt + 0.3;
  for (const sz of [-1, 1]) {
    plate(k.visual, [[px - 0.2, bt], [px + 0.2, bt], [px + 0.06, py + 0.05], [px - 0.05, py + 0.05]], 0.006, black, sz * 0.17, [[px, bt + 0.08, 0.03], [px, bt + 0.2, 0.02]]);
    let y = bt + 0.05;
    for (const name of ['MADTOWN ROBOTICS', 'Madera, CA']) {
      decal(k.visual, name, { w: 0.13, h: 0.02, x: px + 0.12, y, z: sz * 0.174, rotY: sz > 0 ? 0 : Math.PI });
      y -= 0.025;
    }
  }
  tube(k.visual, [px, py, -0.2], [px, py, 0.2], 0.012, k.mats.alu);
  const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 30), black);
  sprocket.rotation.x = Math.PI / 2;
  sprocket.position.set(px, py, 0.185);
  k.visual.add(sprocket);
  box(k.visual, 0.26, 0.04, 0.34, black, px, bt + 0.02, 0);
  bar(k.visual, [px - 0.16, bt + 0.08, -0.17], [px - 0.16, bt + 0.08, 0.17], 0.025, blue);
  const tilt = pivot(k.visual, px, py);
  // Four nested blue stages along the elevator (local +y), each with a black cable chain on its side.
  const stageLen = 0.5;
  const stages: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const half = 0.13 - i * 0.02;
    for (const sz of [-1, 1]) {
      bar(g, [0, -0.06, sz * half], [0, stageLen, sz * half], 0.032 - i * 0.003, blueTube);
      bar(g, [0.025, -0.03, sz * (half + 0.018)], [0.025, stageLen - 0.04, sz * (half + 0.018)], 0.012, chain);
    }
    bar(g, [0, stageLen - 0.01, -half], [0, stageLen - 0.01, half], 0.02, i === 3 ? black : blue);
    box(g, 0.012, stageLen * 0.85, 0.014, chain, -0.023 - i * 0.004, stageLen * 0.45, 0);
    if (i === 0) bar(g, [0, -0.05, -half], [0, -0.05, half], 0.025, blue);
    tilt.add(g);
    stages.push(g);
  }
  // Carriage + end effector (differential wrist) riding the last stage; it holds the CORAL / ALGAE.
  const carriage = new THREE.Group();
  tilt.add(carriage);
  sidePlates(carriage, [[-0.03, -0.06], [0.06, -0.06], [0.06, 0.06], [-0.03, 0.06]], 0.09, black);
  const eff = endEffector(carriage, black, black, 0.22);
  const diff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), blue);
  diff.rotation.x = Math.PI / 2;
  diff.position.z = 0.12;
  eff.wrist.add(diff);
  const held = pivot(eff.wrist, 0.13, 0);
  const coralIntake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, stow: Math.PI - 0.45 });
  const algaeIntake = deployableIntake(k, { reach: c.intake.reach * 0.6, hingeY: bt + 0.12, rollers: 1, width: c.intake.width * 0.8, frame: blue, stow: Math.PI - 0.25 });
  // Rest pose from the photo: leaned forward, end effector up high.
  const REST_LEAN = 0.72;
  const REST_ALONG = 0.72;
  let lean = REST_LEAN;
  let along = REST_ALONG;
  let wrist = 0;
  let deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    intakeAnchor: coralIntake.tip,
    lightAt: [-L * 0.42, bt + 0.04, 0],
    update(s) {
      const p = place(s);
      // At rest (end effector parked low, not scoring the trough) hold the photo pose; otherwise reach the rules'
      // end effector so CORAL leaves exactly where it is placed.
      // Handoff: elevator upright and short, wrist pointing back down at the CORAL intake folding in.
      const handoff = (p.handoff ?? 0) > 0;
      const resting = !handoff && p.height < 0.55 && p.level !== 1;
      const dx = p.forward - px;
      const dy = p.height - py;
      lean = approach(lean, handoff ? -0.12 : resting ? REST_LEAN : Math.max(0.05, Math.min(1.2, Math.atan2(dx, dy))), 8, s.dt);
      along = approach(along, handoff ? 0.3 : resting ? REST_ALONG : Math.max(0.2, Math.hypot(dx, dy)), 10, s.dt);
      tilt.rotation.z = -lean;
      const ext = Math.max(0, along - stageLen + 0.05);
      for (let i = 1; i < stages.length; i++) stages[i].position.y = (ext * i) / (stages.length - 1);
      carriage.position.set(0.04, along, 0);
      wrist = approach(wrist, (handoff ? Math.PI - 0.6 : resting ? -0.2 : wristFor(p.level)) + lean, 8, s.dt);
      eff.wrist.rotation.z = wrist;
      spinRollers(eff.rollers, s);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      coralIntake.update(s, deploy);
      // The ALGAE intake doubles as the CAGE latch: out while intaking or climbing.
      algaeIntake.update(s, Math.max(deploy * 0.7, s.climb > 0.1 ? 0.6 : 0));
      db.update(s);
    },
  };
});

function teamConfig(team: number, model: string, base: Parameters<typeof build>[0], tweak: (c: ReturnType<typeof build>) => void) {
  const c = build(base);
  c.teamNumber = team;
  c.model = model;
  tweak(c);
  return normalizeReefscapeConfig(c);
}

export function reefscapeTeamRobots(): TeamRobot[] {
  return [
    ...additionalReefscapeTeamRobots(),
    ...moreReefscapeTeamRobots(),
    {
      id: 'spectre-2910', team: 2910, name: 'Spectre',
      description: '2910 Jack in the Bot (2025 World Champions). Pivot + two-stage telescoping arm + wrist with one end effector for CORAL and ALGAE (L1–L4, NET, PROCESSOR), picks CORAL off the floor, brass ballast up front, 1.5 s deep climb.',
      source: 'Onshape "Spectre: 2025 FIRST World Championship robot"; frcteam2910.org 2025 recap',
      config: teamConfig(2910, 'spectre-2910', { coral: 'l4', intake: 'both', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true }, (c) => {
        c.climber.secondsToClimb = 1.5;
        c.placement!.liftSpeed = 1.6; // [EST]
        c.placement!.handoffSeconds = 0; // the end effector itself picks CORAL off the carpet
      }),
    },
    {
      id: 'madtown-1323', team: 1323, name: 'MadTown 2025',
      description: '1323 MadTown Robotics (2025 World Champions, captain). Pivoting four-stage elevator with a differential wrist, CORAL floor intake working with a floor ALGAE intake (L1 too), NET + PROCESSOR, deep climb latched by the ALGAE intake.',
      source: 'Chief Delphi "1323 MadTown Robot Reveal?"; 2025 MadTown reveal video',
      config: teamConfig(1323, 'madtown-1323', { coral: 'l4', intake: 'ground', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true }, () => {}),
    },
    {
      id: 'undertow-254', team: 254, name: 'Undertow',
      description: '254 Cheesy Poofs. Two-stage continuous belt elevator, wrist end effector for CORAL and ALGAE, ground intake + CORAL STATION funnel, roller claw that latches and pivots the CAGE. 30 × 29.5 × 42 in, 115 lb.',
      source: '254 2025 Technical Binder; Chief Delphi "Team 254 Presents: 2025 UNDERTOW"',
      config: teamConfig(254, 'undertow-254', { coral: 'l4', intake: 'both', algae: 'reef', algaeScore: 'both', climb: 2, align: true }, (c) => {
        c.frameLength = inch(29.5);
        c.frameWidth = inch(30);
        c.height = inch(42);
        c.mass = lb(115);
      }),
    },
    subZero1778(),
  ];
}
