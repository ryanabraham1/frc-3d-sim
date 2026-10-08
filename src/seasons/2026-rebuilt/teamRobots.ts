import { scoringApproach } from '@engine/robot/scoringReadiness';
import { cadRebuiltTeamRobots } from './cadTeamRobots';
import { additionalRebuiltTeamRobots } from './additionalTeamRobots';
import { moreRebuiltTeamRobots } from './moreTeamRobots';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, fillBlock, hoodShell, hopperWalls, INTAKE_ORANGE, lattice, mat, pivot, plate, registerRobotModel, roller, spin, tubeMat, bumperRing, darkTubeMat, type ModelKit, type RobotAnimState, columnFeed, dyeRotor, flowAt, hopperStow, jitter, overBumperIntake } from '@engine/robot/models';
import { adaptedDumper, adaptedRotorColumn, adaptedTurretShooter } from '@engine/robot/adaptedCadParts';
import { hoodFor, turretShooter } from '@engine/robot/turretShooter';
import { inch } from '@engine/units';
import { hopperNetCeiling } from '@engine/robot/config';
import { slidingHopper } from '@engine/robot/slidingHopper';
import { build, INTAKE_RATE_BOOST, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

/**
 * Real 2026 REBUILT robots (docs/ROBOT-ARCHETYPES.md "Real team robots"). Capabilities come from each team's tech
 * binder / Chief Delphi thread; values the teams didn't publish are marked [EST]. Models are simplified.
 */

const FUEL = 0xf2c200;
/** Dye-rotor feed: round the plate, along the spiral, up the tower and into the turret's shooter wheel. */
function dyeFeed(k: ModelKit, dye: { feed(r: number): THREE.Vector3[] }, wheel: THREE.Object3D): () => THREE.Vector3[] {
  return () => [...dye.feed(FUEL_R), flowAt(k, wheel, -0.06, 0, 0), flowAt(k, wheel, 0.03, 0.03, 0)];
}

/** FUEL radius (5.91 in ball) for piece-flow paths. */
const FUEL_R = inch(5.91) / 2;


/** Intakes that latch down at the start of the match (and stay down) — 4414 and 1690 both deploy once. */
function latchDeploy(state: { v: number }, s: RobotAnimState): number {
  state.v = approach(state.v, s.enabled || state.v > 0.95 ? 1 : 0, 4, s.dt);
  return state.v;
}

function flywheelSpeed(s: RobotAnimState): number {
  return s.enabled ? 45 + 45 * s.firing : 0;
}

// ── 4414 HighTide RIPCURRENT (binder CAD renders, 2026.team4414.com): dark smoked bumper-height hopper walls, teal
//    truss accents, a huge flat spoked "dye rotor" disc on the floor, the turret on a center column as a black
//    pancake plate, and a smoked hopper extension that slides out with the intake ──
registerRobotModel('ripcurrent-4414', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const teal = mat(0x17a3b3, { metal: 0.5, rough: 0.4 });
  const tealTube = tubeMat(0x17a3b3);
  const black = mat(0x16171a, { metal: 0.35, rough: 0.5 });
  const smoke = mat(0x2b2e33, { opacity: 0.5, metal: 0.15, rough: 0.3 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0x17a3b3 });
  const hopH = H - bt - 0.05;
  // Smoked walls on the bumpers (the bumper backing doubles as the hopper wall), teal trusses along the top.
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: 0, y0: bt, length: L * 0.97, width: W * 0.97, height: hopH, m: smoke });
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.48, H - 0.06, sz * W * 0.485], [L * 0.96, 0, 0], [0, 0.05, 0], { cells: 8, w: 0.012, m: teal, zig: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [sx * L * 0.485, bt, sz * W * 0.485], [sx * L * 0.485, H - 0.01, sz * W * 0.485], 0.02, tealTube);
  // TBA 2026 front/rear views: teal triangulated corner strips and black sponsor panels.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) lattice(k.visual, [sx * L * .48 - .022, bt, sz * W * .488], [.044, 0, 0], [0, H - bt - .01, 0], { cells: 7, w: .008, m: teal, zig: true });
    decal(k.visual, 'fabworks.', { w: L * .42, h: .055, x: -.08, y: H - .15, z: sz * W * .491, rotY: sz > 0 ? 0 : Math.PI });
    decal(k.visual, 'RIPCURRENT', { w: .18, h: .035, x: .10, y: bt + .06, z: sz * W * .491, rotY: sz > 0 ? 0 : Math.PI });
  }
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.97, width: W * 0.97, height: (c.hopperExpansion?.fullHeight ?? H) - bt - .04, color: FUEL, capacity: c.hopperCapacity, inside: (x,z) => Math.hypot(x-(L*.05),z) > .095, ceiling: hopperNetCeiling(c) });
  // Dye rotor: pocketed spinning plate in a fenced tub, spiral guide wall into the open tower under the turret.
  const rr = Math.min(L, W) * 0.44;
  const dye = dyeRotor(k.visual, { x: L * 0.05, y0: bt + 0.02, R: rr, wallH: 0.1, towerX: L * 0.05, towerR: 0.09, towerTop: H - 0.08, plate: black, accent: teal, motors: 2 });
  const cadColumn = adaptedRotorColumn(k.visual, { x: L * 0.05, y0: bt + .02, top: H - .08, radius: .085, color: 0x17a3b3 });
  if (cadColumn) dye.tower.visible = false;
  const t = k.turret;
  t.position.set(L * 0.05, H - 0.07, 0);
  // Pancake turret: wide black disc with a teal ring, shooter on top.
  const sh = adaptedTurretShooter(t, { width: .20, topY: .06, color: 0x17a3b3 }) ?? turretShooter(t, { width: Math.max(0.19, 0.16 + 0.04), wheel: mat(0xb87333, { metal: 0.8, rough: 0.3 }), plate: black, accent: teal, height: 0.15, topY: 0.06 });
  // Smoked hopper extension that slides out over the deployed intake.
  const tray = new THREE.Group();
  tray.name = 'sliding-hopper';
  k.visual.add(tray);
  hopperWalls(tray, { intakeSide: k.groundSide, floorDepth: .12, x: side * (L / 2 - 0.14), y0: bt + 0.02, length: 0.26, width: W * 0.92, height: hopH * 0.9, m: smoke });
  for (const sz of [-1, 1]) bar(tray, [side * (L / 2 - 0.27), bt + 0.02 + hopH * 0.9, sz * W * 0.46], [side * (L / 2 - 0.01), bt + 0.02 + hopH * 0.9, sz * W * 0.46], 0.015, tealTube);
  const trayFill = fillBlock(tray, { x: side * (L / 2 - .14), y0: bt + .03, length: .25, width: W * .88, height: hopH * .9, color: FUEL, capacity: 12 });
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black });
  const deploy = { v: 0 };
  let rotorRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.9, width: W * 0.9, height: hopH, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.4, H - 0.01, W * 0.4],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: dyeFeed(k, dye, sh.flywheel) },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      const d = latchDeploy(deploy, s);
      intake.update(s, d);
      tray.position.x = side * d * 0.2;
      trayFill.set(d > .35 ? s.fill : 0);
      fill.set(s.fill);
      // Slowly counter-rotates to agitate; spins hard to feed while firing.
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 9 : -1.2, 6, s.dt);
      spin(dye.floor, rotorRate, s.dt, 'y');
      for (const r of dye.rollers) spin(r, rotorRate * 4, s.dt, 'y');
      sh.update(s);
      cadColumn?.update(s);
    },
  };
});

// ── 1323 MadTown (match photos, 2026 Champs): squared-off black hopper box with sponsor panels (WE BELIEVE,
//    fabworks…), a black slatted cage on top, a turret over a dye rotor like 4414's, and a black slatted SHOT BLOCKER
//    hinged on the top edge of the intake side that swings out and up over a neighbouring trench robot's shooter ──
registerRobotModel('madtown-2026-1323', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const blue = mat(0x2d6fe0, { metal: 0.5, rough: 0.4 });
  const black = mat(0x131417, { metal: 0.3, rough: 0.55 });
  const blackTube = darkTubeMat(0x17181b);
  const smoke = mat(0x1d1f23, { opacity: 0.62, metal: 0.1, rough: 0.3 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0x2d6fe0 });
  const hopH = H - bt - 0.04;
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: 0, y0: bt, length: L * 0.96, width: W * 0.96, height: hopH, m: smoke });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [sx * L * 0.48, bt, sz * W * 0.48], [sx * L * 0.48, H - 0.02, sz * W * 0.48], 0.022, blackTube);
  // Slatted black cage around the top of the hopper.
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.48, H - 0.1, sz * W * 0.48], [L * 0.96, 0, 0], [0, 0.08, 0], { cells: 7, w: 0.012, m: black });
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI;
    const z = sz * (W * 0.48 + 0.006);
    decal(k.visual, 'WE BELIEVE', { w: 0.16, h: 0.035, x: -L * 0.22, y: H - 0.15, z, rotY });
    decal(k.visual, 'fabworks', { w: 0.14, h: 0.03, x: -L * 0.22, y: bt + hopH * 0.35, z, rotY });
    decal(k.visual, 'AT', { w: 0.07, h: 0.05, x: 0, y: H - 0.15, z, rotY });
    decal(k.visual, 'MADTOWN', { w: 0.15, h: 0.035, x: L * 0.22, y: H - 0.16, z, rotY });
  }
  // The net roof stretches over the load: FUEL past the rigid box rides up into its dome.
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.97, width: W * 0.97, height: (c.hopperExpansion?.fullHeight ?? H) - bt - .04, color: FUEL, capacity: c.hopperCapacity, inside: (x,z) => Math.hypot(x,z) > .095, ceiling: hopperNetCeiling(c) });
  // Concentric floor rotor, feed column and turret bearing at the center of the chassis.
  const tx = 0;
  const rr = Math.min(L, W) * 0.42;
  const dye = dyeRotor(k.visual, { x: 0, y0: bt + 0.02, R: rr, wallH: 0.09, towerX: tx, towerR: 0.085, towerTop: H - 0.08, plate: black, accent: blue, motors: 2, motorSide: 1 });
  const cadColumn = adaptedRotorColumn(k.visual, { x: tx, y0: bt + .02, top: H - .08, radius: .085, color: 0x2d6fe0 });
  if (cadColumn) dye.tower.visible = false;
  const t = k.turret;
  t.position.set(tx, H - 0.07, 0);
  const sh = adaptedTurretShooter(t, { width: .20, topY: .06, color: 0x2d6fe0 }) ?? turretShooter(t, { width: Math.max(0.19, 0.15 + 0.04), wheel: mat(0x2b2d31, { rough: 0.7 }), plate: black, accent: blue, height: 0.15, topY: 0.06 });
  // Photo reference: horizontal slotted shield carried by an upright lifting frame.
  const b = c.shotBlocker!;
  const len = b.reach;
  const hinge = pivot(k.visual, side * L / 2, H);
  hinge.name = 'madtown-blocker-lift';
  const panel = new THREE.Group();
  panel.name = 'madtown-blocker-shield';
  hinge.add(panel);
  for (const z of [-b.width / 2, b.width / 2]) bar(panel, [0, 0, z], [len, 0, z], 0.02, blackTube);
  for (let i = 0; i <= 4; i++) bar(panel, [(len * i) / 4, 0, -b.width / 2], [(len * i) / 4, 0, b.width / 2], 0.015, black);
  for (let i = 1; i < 8; i++) box(panel, len, 0.006, 0.012, black, len / 2, 0.005, -b.width / 2 + (b.width * i) / 8);
  const liftPosts: THREE.Mesh[] = [];
  const blockerWall = box(k.visual,.008,1,b.width,black,side*L/2,H,0);
  blockerWall.name = 'madtown-blocker-wall';
  for (const z of [-b.width*.42,b.width*.42]) {
    bar(k.visual,[side*(L/2-.025),bt,z],[side*(L/2-.025),H-.025,z],.026,blackTube);
    const post = box(k.visual,.018,1,.018,k.mats.alu,side*(L/2-.025),H,z);
    liftPosts.push(post);
    roller(k.visual,.027,.026,black,side*(L/2-.025),H-.05,z);
  }
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blackTube });
  const slide = slidingHopper(k);
  const deploy = { v: 0 };
  let rotorRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.9, width: W * 0.9, height: hopH, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [side * L * 0.4, H - 0.01, W * 0.4],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: dyeFeed(k, dye, sh.flywheel) },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      { const dv = latchDeploy(deploy, s); intake.update(s, dv); slide.set(dv, s.fill); }
      fill.set(s.fill);
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 8 : -1.2, 6, s.dt);
      spin(dye.floor, rotorRate, s.dt, 'y');
      for (const r of dye.rollers) spin(r, rotorRate * 4, s.dt, 'y');
      sh.update(s);
      cadColumn?.update(s);
      hinge.position.set(side*L/2,H+b.rise*s.blocker,0);
      // Pack the slotted shield into the intake-side bay so the centered hood can turn while stowed.
      const shieldLength = .55+.45*s.blocker;
      panel.position.x = side*b.reach*(s.blocker-1)*shieldLength;
      panel.scale.x = side*shieldLength;
      blockerWall.visible = s.blocker>.02;
      blockerWall.scale.y = Math.max(.001,b.rise*s.blocker);
      blockerWall.position.y = H+b.rise*s.blocker/2;
      for (const post of liftPosts) {
        post.scale.y = .03+b.rise*s.blocker;
        post.position.y = H-.015+b.rise*s.blocker/2;
      }
    },
  };
});

// ── 254 Overload (photo: Chief Delphi "Team 254 Presents: Overload"): a low black smoked hopper box covered in sponsor
//    decals and the NASA logo, a full-width wall of black pocketed shooter plates with long rollers at the front, and
//    an intake that slides out the back on blue triangulated truss rails ──
registerRobotModel('overload-254', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const black = mat(0x141518, { metal: 0.35, rough: 0.5 });
  const blue = mat(0x1f5fd0, { metal: 0.6, rough: 0.35 });
  const blueTube = tubeMat(0x1f5fd0);
  const smoke = mat(0x1e2024, { opacity: 0.6, metal: 0.1, rough: 0.25 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0x1f5fd0 });
  // Closed smoked hopper box behind the shooter with a light lid.
  const hx = -L * 0.12;
  const hl = L * 0.72;
  const hopH = H - bt - 0.03;
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: hx, y0: bt, length: hl, width: W * 0.98, height: hopH, m: smoke });
  // Flexible net roof is drawn by Robot from hopperExpansion, following actual load.
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.97, width: W * 0.97, height: (c.hopperExpansion?.fullHeight ?? H) - bt - .04, color: FUEL, capacity: c.hopperCapacity, ceiling: hopperNetCeiling(c) });
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI;
    const z = sz * (W * 0.49 + 0.006);
    let y = H - 0.08;
    for (const name of ['Greg & Gloria Shean', 'VIVIDHOSTING    LinkedIn', 'BOEING    THE GO FAMILY', 'Johnson&Johnson MedTech']) {
      decal(k.visual, name, { w: hl * 0.62, h: 0.03, x: hx - hl * 0.12, y, z, rotY });
      y -= 0.055;
    }
    decal(k.visual, 'NASA', { w: 0.11, h: 0.11, round: true, background: '#1d4fa3', x: hx + hl * 0.36, y: H - 0.13, z, rotY });
  }
  const legacyShooter = new THREE.Group(); k.visual.add(legacyShooter);
  // Shooter across the full width at the front: a wall of pocketed black plates, long rollers along the top.
  const sx = L / 2 - 0.09;
  const shooterPts: [number, number][] = [[-0.08, bt], [0.08, bt], [0.08, H - 0.12], [0.02, H - 0.02], [-0.08, H - 0.02]];
  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const z = -W * 0.45 + (i * W * 0.9) / 3;
    const p = plate(legacyShooter, shooterPts, 0.008, black, z, [[0, bt + 0.08, 0.03], [0, (bt + H) / 2, 0.035], [0.02, H - 0.1, 0.025]]);
    p.position.x = sx;
  }
  wheels.push(roller(legacyShooter, 0.045, W * 0.92, black, sx + 0.02, H - 0.08), roller(legacyShooter, 0.035, W * 0.92, black, sx - 0.07, H - 0.04));
  const flywheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), mat(0x8a9099, { metal: 0.8, rough: 0.3 }));
  flywheel.rotation.x = Math.PI / 2;
  flywheel.position.set(sx - 0.01, (bt + H) / 2, W * 0.47);
  legacyShooter.add(flywheel);
  for (const sz of [-1, 1]) bar(legacyShooter, [sx - 0.08, H - 0.015, sz * W * 0.47], [sx + 0.08, H - 0.015, sz * W * 0.47], 0.02, blueTube);
  bar(legacyShooter, [sx - 0.08, H - 0.015, -W * 0.47], [sx - 0.08, H - 0.015, W * 0.47], 0.02, blueTube);
  box(legacyShooter, 0.2, 0.015, W * 0.9, black, sx - 0.03, H - 0.14, 0);
  const hood = pivot(legacyShooter, sx + 0.04, H - 0.06);
  hoodShell(hood, 0.05, W * 0.9, black);
  const cadShooter = adaptedDumper(k.visual, { x: sx + .02, y: H - .065, width: W * .92, color: 0x141518 });
  legacyShooter.visible = !cadShooter;
  // Intake slides out the back on blue truss rails.
  const slide = new THREE.Group();
  k.visual.add(slide);
  for (const sz of [-1, 1]) lattice(slide, [side * (L / 2 - 0.25), bt - 0.02, sz * (W / 2 - 0.03)], [side * 0.36, 0, 0], [0, 0.07, 0], { cells: 5, w: 0.016, m: blue, zig: true });
  const rollers = [roller(slide, 0.03, W * 0.9, INTAKE_ORANGE(), side * (L / 2 + 0.1), bt - 0.03), roller(slide, 0.025, W * 0.9, INTAKE_ORANGE(), side * (L / 2 + 0.05), bt + 0.03)];
  const hop = slidingHopper(k);
  let out = 0;
  let beltSpin = 0;
  let hoodAng = 0;
  const pile = hopperStow({ x: hx, y0: bt + 0.03, length: hl * 0.9, width: W * 0.9, height: hopH, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.02, 0],
    flow: {
      // Under the low roller, over the upper one and straight into the back of the hopper.
      intake: () => {
        const z = jitter(W * 0.6);
        return [flowAt(k, rollers[0], -side * 0.02, 0.03, z), flowAt(k, rollers[1], -side * 0.03, 0.04, z), new THREE.Vector3(side * (L / 2 - 0.12), bt + 0.05 + FUEL_R, z * 0.8)];
      },
      stow: pile.stow,
      // Full-width shooter: each ball rolls forward along the floor in its lane, up the pocketed plates into the rollers.
      feed: () => {
        const z = jitter(W * 0.8);
        return [new THREE.Vector3(hx + hl * 0.2, bt + 0.04 + FUEL_R, z), new THREE.Vector3(sx - 0.07, bt + 0.05 + FUEL_R, z), new THREE.Vector3(sx - 0.04, H - 0.16, z), new THREE.Vector3(sx + 0.03, H - 0.06, z)];
      },
    },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      // Out to collect; pulled back in while shooting so it squeezes FUEL toward the shooter.
      out = approach(out, !s.enabled ? 0 : s.firing > 0 ? 0.3 : 1, 5, s.dt);
      slide.position.x = side * (out - 1) * 0.12;
      hop.set(out, s.fill);
      beltSpin = s.enabled && (s.intaking || s.firing > 0) ? 24 : 0;
      for (const r of rollers) spin(r, -side * beltSpin, s.dt);
      fill.set(s.fill);
      const fs = flywheelSpeed(s);
      for (const r of wheels) spin(r, -fs, s.dt);
      spin(flywheel, fs, s.dt, 'y');
      // Dumper hood: lies flat until the driver shoots, then lifts to the solved angle (range-dependent).
      hoodAng = scoringApproach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = hoodAng;
      cadShooter?.update(s);
    },
  };
});

// ── 1690 Orbit Kepler (CAD render, Chief Delphi "FRC Orbit 1690 2026 Robot CAD Release"): dark gray robot whose hopper
//    walls are black X-lattice panels, a curved lattice arch over the top, turret shooter at the far end from the intake ──
registerRobotModel('kepler-1690', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const black = mat(0x1b1d21, { metal: 0.4, rough: 0.5 });
  const gray = mat(0x3a3e45, { metal: 0.45, rough: 0.45 });
  const db = drivebase(k, { motorRing: 0x3a8dde });
  const top = H - 0.07;
  const mount = c.launcher.mounts?.[0] ?? { forward: L*.27, side: -W*.27 };
  const tx = mount.forward, tz = -mount.side;
  const deckY = H-.315;
  const lowTop = deckY + .015;
  const clear = mat(0x69717b, { opacity: 0.28, rough: 0.5, metal: 0 });
  // The intake/back and far walls are tall; the turret corner has low clear walls.
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: 0, y0: bt, length: L * 0.92, width: W * 0.92, height: lowTop - bt, m: clear, frame: gray });
  box(k.visual, L*.92, top-lowTop, .006, clear, 0, (top+lowTop)/2, -W*.46);
  box(k.visual, .006, top-lowTop, W*.92, clear, -L*.46, (top+lowTop)/2, 0);
  // Keep the rest of both adjacent faces enclosed: only the turret corner is lowered.
  const sideEnd = tx-.24, frontEnd = tz-.24;
  const sideLength = sideEnd+L*.46, frontWidth = frontEnd+W*.46;
  const upperHopper = new THREE.Group(); upperHopper.name = 'kepler-upper-hopper'; k.visual.add(upperHopper);
  box(upperHopper,sideLength,top-lowTop,.006,clear,(sideEnd-L*.46)/2,(top+lowTop)/2,W*.46);
  box(upperHopper,.006,top-lowTop,frontWidth,clear,L*.46,(top+lowTop)/2,(frontEnd-W*.46)/2);
  for (const z of [-W*.46,W*.46]) bar(upperHopper,[-L*.46,top,z],[sideEnd,top,z],.018,gray);
  bar(upperHopper,[sideEnd,lowTop,W*.46],[sideEnd,top,W*.46],.018,gray);
  bar(upperHopper,[L*.46,lowTop,frontEnd],[L*.46,top,frontEnd],.018,gray);
  bar(upperHopper,[L*.46,top,-W*.46],[L*.46,top,frontEnd],.018,gray);
  // X-lattice walls on all four sides.
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.47, bt, sz * W * 0.47], [L * 0.94, 0, 0], [0, (sz>0?lowTop:top) - bt, 0], { cells: 5, w: 0.014, m: black });
  for (const sx of [-1, 1]) lattice(k.visual, [sx * L * 0.47, bt, -W * 0.47], [0, 0, W * 0.94], [0, (sx>0?lowTop:top) - bt, 0], { cells: 4, w: 0.014, m: black });
  box(k.visual, L * 0.92, 0.006, W * 0.92, gray, 0, bt + 0.01, 0);
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.02, length: L * 0.97, width: W * 0.97, height: (top - bt) * 0.97, color: FUEL, capacity: c.hopperCapacity, inside: (x,z) => Math.hypot(x-tx,z-tz) > .23 });
  // Curved lattice arch over the front half.
  const arch: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    arch.push([L * 0.32 + Math.sin(a) * 0.06, top + Math.sin(a) * 0.04, -W * 0.47 * Math.cos(a)]);
  }
  for (let i = 0; i < 8; i++) {
    // Keep the corner aperture open throughout the turret and hood sweep.
    if (arch[i][2] > tz-.23 || arch[i+1][2] > tz-.23) continue;
    bar(k.visual, arch[i], arch[i + 1], 0.014, black);
    bar(k.visual, [arch[i][0] - 0.14, arch[i][1] - 0.02, arch[i][2]], [arch[i + 1][0] - 0.14, arch[i + 1][1] - 0.02, arch[i + 1][2]], 0.014, black);
    bar(k.visual, arch[i], [arch[i + 1][0] - 0.14, arch[i + 1][1] - 0.02, arch[i + 1][2]], 0.01, black);
  }
  // Right corner opposite the intake, on an 8 in bearing over a compact deck.
  const t = k.turret;
  t.position.set(tx, top + 0.01, tz);
  // Deck under the turret plate, bolted to the lattice walls.
  box(k.visual, 0.3, 0.008, .29, gray, tx, deckY, tz);
  // Carry the imported bearing plate down to the deck; the hopper walls brace the fixed pedestal.
  for (const z of [tz-.10, tz+.10]) {
    bar(k.visual, [tx, bt, z], [tx, H-.31, z], .022, gray);
    bar(k.visual, [tx-.12, bt, z], [tx, H-.31, z], .016, gray);
  }
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.102, .11, .124, 32, 1, true), gray);
  pedestal.position.set(tx, H-.253, tz); k.visual.add(pedestal);
  const sh = adaptedTurretShooter(t, { width: .20, topY: .06, color: 0x3a3e45 }) ?? turretShooter(t, { width: Math.max(0.19, 0.14 + 0.04), wheel: gray, plate: black, accent: gray, height: 0.15, topY: 0.06 });
  // Exposed spur gear driving the flywheel (Kepler's shooter is gear-driven, no belts).
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 18), k.mats.alu);
  gear.rotation.x = Math.PI / 2;
  gear.position.copy(sh.flywheel.position).add(new THREE.Vector3(0, 0, .13));
  sh.flywheel.parent!.add(gear);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 1, frame: black });
  const slide = slidingHopper(k);
  const deploy = { v: 0 };
  const pile = hopperStow({ x: 0, y0: bt + 0.02, length: L * 0.88, width: W * 0.88, height: top - bt, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.4, top, W * 0.3],
    flow: {
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: () => {
        const p = pile.stow();
        if (Math.hypot(p.x-tx,p.z-tz) < .23) p.x = tx-.24;
        return p;
      },
      // Floor belts carry FUEL diagonally toward the corner bearing, then lift it into the turret.
      feed: () => {
        const z = jitter(W * 0.5);
        return [new THREE.Vector3(-L * 0.25, bt + 0.03 + FUEL_R, z), new THREE.Vector3(tx - 0.08, bt + 0.03 + FUEL_R, tz + z * 0.15), new THREE.Vector3(tx, top - 0.06, tz), flowAt(k, sh.flywheel, -0.06, 0, 0), flowAt(k, sh.flywheel, 0.03, 0.03, 0)];
      },
    },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      { const dv = latchDeploy(deploy, s); intake.update(s, dv); slide.set(dv, s.fill); }
      fill.set(s.fill);
      sh.update(s);
      spin(gear, flywheelSpeed(s) * 0.6, s.dt, 'z');
    },
  };
});

// ── 9483 Overcharge "Enigma" (photo: The Blue Alliance 2026 media; Chief Delphi "Team 9483 Presents: Enigma"): too
//    tall for the TRENCH, a giant black hopper box with big white team numbers and silver corner extrusions, a
//    spindexer bowl with a grip-taped cone for a floor, a turret shooter on 3 Kraken X60s, intake on silver arms ──
registerRobotModel('enigma-9483', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const black = mat(0x141518, { rough: 0.45 });
  const smoke = mat(0x1a1b1f, { opacity: 0.72, rough: 0.3 });
  const silverTube = tubeMat(0xc9ced5);
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 });
  const db = drivebase(k, { motorRing: 0x2f6fd6 });
  const hopH = H - bt - 0.04;
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: 0, y0: bt, length: L * 0.97, width: W * 0.97, height: hopH, m: smoke });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [sx * L * 0.485, bt, sz * W * 0.485], [sx * L * 0.485, H - 0.04, sz * W * 0.485], 0.03, silverTube);
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI;
    const z = sz * (W * 0.485 + 0.006);
    decal(k.visual, '9483', { w: 0.3, h: 0.11, x: 0, y: bt + hopH * 0.55, z, rotY });
    decal(k.visual, 'BOEING   Altinbas   OVERCHARGE', { w: 0.42, h: 0.03, x: 0, y: bt + hopH * 0.85, z, rotY });
    decal(k.visual, 'ROBOTICS · ISTANBUL', { w: 0.3, h: 0.025, x: 0, y: bt + hopH * 0.25, z, rotY });
  }
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.97, width: W * 0.97, height: hopH * 0.97, color: FUEL, capacity: c.hopperCapacity });
  // Spindexer bowl: a wide grippy disc floor with a center cone, spinning.
  const spindex = new THREE.Group();
  spindex.position.set(0, bt + 0.02, 0);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(L, W) * 0.44, Math.min(L, W) * 0.4, 0.02, 36), mat(0x26282c, { rough: 0.95 }));
  spindex.add(bowl);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 20), mat(0x2b2d31, { rough: 0.95 }));
  cone.position.y = 0.07;
  spindex.add(cone);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    box(spindex, 0.2, 0.02, 0.01, silver, Math.cos(a) * 0.17, 0.02, -Math.sin(a) * 0.17).rotation.y = a;
  }
  k.visual.add(spindex);
  // Turret on top, toward the front.
  const t = k.turret;
  t.position.set(L * 0.18, H - 0.06, 0);
  box(k.visual, 0.24, 0.035, W * 0.95, silver, L * 0.18, H - 0.06 - 0.19 - 0.083, 0);
  const colH = H - 0.06 - 0.19 - 0.1 - bt; // up to the support beam under the turret plate
  const feedColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, colH, 16), black);
  feedColumn.position.set(L * 0.18, bt + colH / 2, 0);
  k.visual.add(feedColumn);
  const sh = turretShooter(t, { width: Math.max(0.19, 0.16 + 0.04), wheel: mat(0x8a9099, { metal: 0.6 }), plate: black, accent: silver, height: 0.15, topY: 0.06 });
  // Intake on silver arms with a silver roller.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: silver });
  const slide = slidingHopper(k);
  const deploy = { v: 0 };
  let rate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.05, length: L * 0.9, width: W * 0.9, height: hopH, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.45, H - 0.02, W * 0.4],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: columnFeed(k, L * 0.18, sh.flywheel, Math.min(L, W) * 0.36, FUEL_R) },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      { const dv = latchDeploy(deploy, s); intake.update(s, dv); slide.set(dv, s.fill); }
      fill.set(s.fill);
      rate = approach(rate, !s.enabled ? 0 : s.firing > 0 ? 8 : 1.5, 5, s.dt);
      spin(spindex, rate, s.dt, 'y');
      sh.update(s);
    },
  };
});

// ── 4946 The Alpha Dogs "Moto Moto" (photos + 2026 Engineering Report, Chief Delphi): an over-the-BUMP "roomba" —
//    a half-circle robot (16.375 in radius, 30 in flat edge) about 30 in tall; a 35 in round clear hopper around a
//    dye rotor that feeds an 11 in turret on a center column; silver perforated goalpost over the intake on the flat
//    side, whose bottom piece rides up over the BUMP on omni wheels ──
registerRobotModel('motomoto-4946', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const R = W / 2;
  const side = k.groundSide; // flat edge = intake face
  const flatX = side * (L / 2);
  const centerX = flatX - side * (L - R); // semicircle center
  const silverTube = tubeMat(0xc9ced5);
  const black = mat(0x141518, { rough: 0.5 });
  const gray = mat(0x5d6168, { metal: 0.3, rough: 0.6 });
  const clear = mat(0xdde8f0, { opacity: 0.42, metal: 0, rough: 0.12 });
  // D-shaped frame outline (flat edge on the intake face, semicircle opposite) and its bumper.
  const outline: [number, number][] = [[flatX, -R], [flatX, R]];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI / 2 - (i / 24) * Math.PI; // +90° → −90°: the arc bulging away from the flat edge
    outline.push([centerX - side * R * Math.cos(a), R * Math.sin(a)]);
  }
  const db = drivebase(k, { motorRing: 0x8a8f96, outline, modulePositions: [
    [flatX - side * 0.09, -R * 0.72], [flatX - side * 0.09, R * 0.72],
    [centerX - side * R * 0.52, -R * 0.48], [centerX - side * R * 0.52, R * 0.48],
  ] });
  bumperRing(k, outline, c.bumperThickness);
  for (const sz of [-1, 1]) {
    const radial = R + c.bumperThickness + 0.008;
    decal(k.visual, String(c.teamNumber), { w: 0.22, h: (c.bumperTop - c.bumperBottom) * 0.75,
      x: centerX - side * radial * Math.SQRT1_2, y: (c.bumperTop + c.bumperBottom) / 2,
      z: sz * radial * Math.SQRT1_2, rotY: Math.atan2(-side, sz) });
  }
  // Round clear hopper wall following the semicircle, straight clear walls to the flat edge.
  const hopH = H - bt - 0.05;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, hopH, 40, 1, true, side > 0 ? Math.PI : 0, Math.PI), clear);
  wall.position.set(centerX, bt + hopH / 2, 0);
  k.visual.add(wall);
  for (const sz of [-1, 1]) box(k.visual, Math.abs(flatX - centerX), hopH, 0.006, clear, (flatX + centerX) / 2, bt + hopH / 2, sz * (R + 0.02));
  for (const y of [bt + 0.015, H - 0.045]) {
    outline.forEach(([x, z], i) => {
      const next = outline[(i + 1) % outline.length];
      bar(k.visual, [x, y, z], [next[0], y, next[1]], 0.018, gray);
    });
  }
  for (const i of [2, 8, 14, 20, 26]) {
    const [x, z] = outline[Math.min(i, outline.length - 1)];
    bar(k.visual, [x, bt, z], [x, H - 0.045, z], 0.014, gray);
  }
  // Keep the round pieces inside the curved half of the hopper.
  // The round hopper: FUEL packs the whole D-shaped footprint (semicircle plus the straight run to the flat edge).
  const fill = fillBlock(k.visual, {
    x: (flatX + centerX - side * R) / 2, y0: bt + 0.03, length: Math.abs(flatX - centerX) + R, width: W * 0.97, height: hopH * 0.97,
    color: FUEL, capacity: c.hopperCapacity,
    inside: (x, z) => (side * (x - centerX) > 0 || Math.hypot(x - centerX, z) < R - 0.01) && side * (flatX - x) > 0.01,
  });
  // Dye rotor filling the round hopper, its tower rising to the 11 in turret ring at the top.
  const dye = dyeRotor(k.visual, { x: centerX, y0: bt + 0.02, R: R * 0.86, wallH: 0.1, towerX: centerX, towerR: 0.11, towerTop: H - 0.07, plate: gray, accent: black, motors: 2, motorSide: side > 0 ? 1 : -1 });
  // Spectrum row 57 / MOTO MOTO, Houston finalist build: the tall tapered feed funnel is a defining silhouette.
  // https://cad.onshape.com/documents/705d953d40f0cc3373a8313b/w/deefd59a3b22618d064531b8/e/eec4de188759a18321ec20c9
  // Turret, D-frame and same flat-side intake; clear curved hopper, black funnel, silver portal. Rates [EST].
  const funnelH = Math.max(.12,H-bt-.19);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(.16,.075,funnelH,28,1,true),black);
  funnel.position.set(centerX,bt+.1+funnelH/2,0);k.visual.add(funnel);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(.12,.008,6,28),gray);
  seam.rotation.x=Math.PI/2;seam.position.set(centerX,bt+.1+funnelH*.55,0);k.visual.add(seam);
  const t = k.turret;
  t.position.set(centerX, H - 0.06, 0);
  const sh = turretShooter(t, { width: Math.max(0.19, 0.15 + 0.04), wheel: mat(0x2f6fd6, { metal: 0.3 }), plate: black, accent: mat(0xc62828, { metal: 0.2 }), height: 0.15, topY: 0.06 });
  // Silver perforated goalpost over the intake on the flat side.
  const gx = flatX - side * 0.03;
  for (const sz of [-1, 1]) bar(k.visual, [gx, bt, sz * (R - 0.03)], [gx, H - 0.01, sz * (R - 0.03)], 0.025, silverTube);
  bar(k.visual, [gx, H - 0.01, -(R - 0.03)], [gx, H - 0.01, R - 0.03], 0.025, silverTube);
  for (const sz of [-1, 1]) bar(k.visual, [gx, H - 0.01, sz * (R - 0.03)], [centerX, H - 0.05, sz * 0.15], 0.02, silverTube);
  // Intake on the flat side: silver frame, green compliant wheels.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 3, frame: silverTube, width: W * 0.9, rollerMaterial: mat(0x388d3c) });
  const slide = slidingHopper(k);
  const deploy = { v: 0 };
  let rotorRate = 0;
  let load = 0;
  return {
    replaces: ['bumpers', 'chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [gx, H + 0.01, 0],
    flow: {
      // Under the goalpost, in over the flat edge and onto the pile in the round hopper.
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: () => {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - 0.08);
        return new THREE.Vector3(centerX + Math.cos(a) * d, bt + 0.03 + FUEL_R + hopH * Math.min(0.92, load) * 0.9, Math.sin(a) * d);
      },
      feed: dyeFeed(k, dye, sh.flywheel),
    },
    update(s) {
      db.update(s);
      load = s.fill;
      { const dv = latchDeploy(deploy, s); intake.update(s, dv); slide.set(dv, s.fill); }
      fill.set(s.fill);
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 10 : -1.2, 6, s.dt);
      spin(dye.floor, rotorRate, s.dt, 'y');
      for (const r of dye.rollers) spin(r, rotorRate * 4, s.dt, 'y');
      sh.update(s);
    },
  };
});

// ── 3476 Code Orange "Sandspit" (photos: The Blue Alliance 2026 media; Chief Delphi reveal): a tall closed clear
//    hopper box with black perforated corner posts and orange rails, teal 3D-printed lattice, an orange A-frame,
//    a 20 FUEL/s wide multi-lane shooter fed by a top roller, and an intake that retracts to compact FUEL into it ──
registerRobotModel('sandspit-3476', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const orangeTube = tubeMat(0xd15a24);
  const blackTube = darkTubeMat(0x17181b);
  const teal = mat(0x1fa59a, { metal: 0.1, rough: 0.6 });
  const black = mat(0x141518, { rough: 0.5 });
  const clear = mat(0xdde8f0, { opacity: 0.3, metal: 0, rough: 0.12 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0xd15a24 });
  // Closed clear hopper box with black dotted corner posts and orange rails.
  const hx = side * L * 0.06;
  const hl = L * 0.8;
  const hopH = H - bt - 0.04;
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: hx, y0: bt, length: hl, width: W * 0.96, height: hopH, m: clear });
  box(k.visual, hl, 0.005, W * 0.96, mat(0xeef2f5, { opacity: 0.5, metal: 0 }), hx, H - 0.04, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [hx + (sx * hl) / 2, bt, sz * W * 0.48], [hx + (sx * hl) / 2, H - 0.04, sz * W * 0.48], 0.035, blackTube);
  for (const y of [bt + hopH * 0.45, H - 0.045]) for (const sz of [-1, 1]) bar(k.visual, [hx - hl / 2, y, sz * W * 0.485], [hx + hl / 2, y, sz * W * 0.485], 0.02, orangeTube);
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.97, width: W * 0.97, height: hopH * 0.97, color: FUEL, capacity: c.hopperCapacity });
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI;
    const z = sz * (W * 0.48 + 0.006);
    decal(k.visual, 'SANDSPIT', { w: 0.22, h: 0.05, x: hx - side * hl * 0.2, y: bt + hopH * 0.2, z, rotY });
    decal(k.visual, 'LASERGRAPHICS', { w: 0.24, h: 0.04, x: hx + side * hl * 0.15, y: bt + hopH * 0.7, z, rotY });
    decal(k.visual, 'Applied Medical', { w: 0.16, h: 0.03, x: hx + side * hl * 0.15, y: bt + hopH * 0.58, z, rotY });
    // Teal printed lattice along the bottom of each side.
    lattice(k.visual, [-L * 0.48, bt - 0.02, sz * (W / 2 - 0.01)], [L * 0.96, 0, 0], [0, 0.06, 0], { cells: 8, w: 0.012, m: teal });
  }
  // Orange A-frame at the shooter end with teal gusset lattice.
  const ax = -side * (L / 2 - 0.04);
  for (const sz of [-1, 1]) {
    bar(k.visual, [ax, bt, sz * (W / 2 - 0.03)], [ax + side * 0.12, H, sz * 0.05], 0.025, orangeTube);
    lattice(k.visual, [ax, bt, sz * (W / 2 - 0.03)], [side * 0.1, H - bt - 0.1, -sz * (W / 2 - 0.1)], [side * 0.04, 0, 0], { cells: 4, w: 0.008, m: teal, zig: true, border: false });
  }
  bar(k.visual, [ax + side * 0.12, H, -0.06], [ax + side * 0.12, H, 0.06], 0.025, orangeTube);
  const legacyShooter = new THREE.Group(); k.visual.add(legacyShooter);
  // Wide multi-lane shooter at the front with a top feeder roller and two big flywheels.
  const sx = -side * (L / 2 - 0.1);
  for (const sz of [-1, 0, 1]) plate(legacyShooter, [[sx - 0.08, bt + 0.05], [sx + 0.08, bt + 0.05], [sx + 0.08, H - 0.1], [sx, H - 0.03], [sx - 0.08, H - 0.03]], 0.008, black, sz * W * 0.4, [[sx, (bt + H) / 2, 0.035]]);
  const wheels = [roller(legacyShooter, 0.05, W * 0.85, black, sx, H - 0.12), roller(legacyShooter, 0.03, W * 0.85, mat(0xa9afb7, { metal: 0.6 }), sx + side * 0.08, H - 0.06)];
  for (const sz of [-1, 1]) {
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.025, 24), mat(0xa9afb7, { metal: 0.7, rough: 0.3 }));
    fly.rotation.x = Math.PI / 2;
    fly.position.set(sx, (bt + H) / 2, sz * (W / 2 - 0.02));
    legacyShooter.add(fly);
    wheels.push(fly as unknown as THREE.Group);
  }
  box(legacyShooter, 0.2, 0.015, W * 0.82, black, sx + side * 0.02, H - 0.18, 0);
  const hood = pivot(legacyShooter, sx - side * 0.05, H - 0.1);
  hoodShell(hood, 0.05, W * 0.85, black);
  const cadShooter = adaptedDumper(k.visual, { x: sx, y: H - .065, width: W * .92, color: 0x17181b });
  legacyShooter.visible = !cadShooter;
  // Intake on the back that retracts while shooting (compacting the FUEL).
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blackTube });
  const slide = slidingHopper(k);
  let out = 0;
  let hoodAng = 0;
  const pile = hopperStow({ x: hx, y0: bt + 0.03, length: hl * 0.9, width: W * 0.9, height: hopH, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.03, 0],
    flow: {
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: pile.stow,
      // 20 FUEL/s wide shooter: lanes across the width, up the plates, under the top feeder roller into the flywheels.
      feed: () => {
        const z = jitter(W * 0.75);
        return [new THREE.Vector3(hx, bt + 0.04 + FUEL_R, z), new THREE.Vector3(sx + side * 0.12, bt + 0.05 + FUEL_R, z), new THREE.Vector3(sx + side * 0.06, H - 0.2, z), new THREE.Vector3(sx, H - 0.1, z)];
      },
    },
    update(s) {
      db.update(s);
      pile.setFill(s.fill);
      out = approach(out, !s.enabled ? 0 : s.firing > 0 ? 0.35 : 1, 5, s.dt);
      { const dv = out; intake.update(s, dv); slide.set(dv, s.fill); }
      fill.set(s.fill);
      const fs = flywheelSpeed(s);
      spin(wheels[0], -fs, s.dt);
      spin(wheels[1], s.firing > 0 || s.intaking ? -25 : 0, s.dt);
      for (const f of wheels.slice(2)) spin(f, fs, s.dt, 'y');
      hoodAng = scoringApproach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = -side * hoodAng;
      cadShooter?.update(s);
    },
  };
});

function teamConfig(team: number, model: string, base: Parameters<typeof build>[0], tweak: (c: ReturnType<typeof build>) => void) {
  const c = build(base);
  c.teamNumber = team;
  c.model = model;
  tweak(c);
  return normalizeRebuiltConfig(c);
}

/**
 * Floor-intake throughput, FUEL/s [EST: nobody publishes it; scaled from each intake's width, roller count and how
 * wide / uninterrupted its ball path is, as discussed in each robot's reveal thread].
 */
const INTAKE_RATE: Record<number, number> = {
  4414: 18, 254: 16, 9128: 17, 6329: 15, 2910: 14, 1323: 14, 3476: 14, 9483: 13, 4946: 13, 5940: 13,
  604: 16, 1678: 12, 7769: 12, 971: 11, 1690: 11, 1778: 11,
};

export function rebuiltTeamRobots(): TeamRobot[] {
  return withIntakeRates([
    ...additionalRebuiltTeamRobots(),
    ...moreRebuiltTeamRobots(),
    ...cadRebuiltTeamRobots(),
    {
      id: 'ripcurrent-4414', team: 4414, name: 'RIPCURRENT',
      description: '4414 HighTide (2026 World Champions, captain). Pancake turret with a 3 in quad-Kraken flywheel and adjustable hood (shoots on the move), "dolphin fin" dye rotor feeding a single high-BPS stream, structural-bumper hopper that extends with the intake, under a very stretchy net roof: 57 FUEL fit the rigid box and the net stretches over 28 more for the binder’s 85, bulging up to about 29.5 in (just under the 30 in limit) and losing TRENCH clearance past 57. No climber.',
      source: '4414 2026 Technical Binder (2026.team4414.com); Chief Delphi "Team 4414 HighTide 2026 Tech Binder - RIPCURRENT"',
      config: teamConfig(4414, 'ripcurrent-4414', { intake: 'both', aim: 'turret', hopper: 85, tall: false, rate: 15, climb: 0 }, (c) => {
        // 25 × 32 in frame with chamfered back corners, inside the 110 in perimeter: modeled as an equal-perimeter box.
        c.frameLength = inch(24);
        c.frameWidth = inch(31);
        // Packing real-size FUEL into this hopper: 57 under the rigid rim; the binder's 85 needs the net stretched to
        // about 29.5 in (+28), which this very elastic net does. [EST]
        c.hopperExpansion = { startCount: 57, fullHeight: inch(29.5) };
        setRebuiltAccuracy(c, 90); // [EST] precomputed robust shot map
        c.maxSpeed = 4.4; // [EST] geared 7.67:1 for low current draw
      }),
    },
    {
      id: 'madtown-2026-1323', team: 1323, name: 'MadTown',
      description: '1323 MadTown Robotics (2026 World Champions). A trench-height turret robot in the RIPCURRENT mould: dye rotor feeding a turret that shoots on the move, a net-roofed hopper (50 FUEL in the rigid box, about 24 more as the net stretches: 74) and a lower fire rate (13 FUEL/s) than 4414; past 50 the net bulges above TRENCH height. Its signature SHOT BLOCKER, a slatted panel hinged on the intake-side top edge, swings out 12 in and up to the 30 in height limit over a neighbouring trench robot\'s shooter (F / gamepad L3). Raised, it hits the TRENCH arm, so the robot cannot drive under, and it cannot be raised under the arm. The intake is off while it is up. No climber [EST].',
      source: 'Match photos/video (2026 Champs, Einstein); Chief Delphi "How does 1323 get away with such a complicated robot?" ("turreted dye rotor with a shot blocker"); user tuning relative to 4414',
      config: teamConfig(1323, 'madtown-2026-1323', { intake: 'both', aim: 'turret', hopper: 74, tall: false, rate: 13, climb: 0 }, (c) => {
        c.hopperCovered = true; // net over the hopper
        // Capacity from packing real-size FUEL into this hopper: 50 under the rigid rim, +24 under the stretched net. [EST]
        c.hopperExpansion = { startCount: 50, fullHeight: inch(27) };
        c.frameLength = inch(27); // [EST] near-square frame in photos
        c.frameWidth = inch(27);
        // [R: 12 in extension past the FRAME PERIMETER, on the intake side so the intake and blocker share one side;
        // 30 in max height] Full frame width; deploy time [EST].
        c.shotBlocker = { reach: inch(12), rise: inch(30) - c.height, width: c.frameWidth, seconds: 0.35 };
        setRebuiltAccuracy(c, 88); // [EST]
        c.maxSpeed = 4.6; // [EST]
      }),
    },
    {
      id: 'overload-254', team: 254, name: 'Overload',
      description: '254 Cheesy Poofs. Fixed multi-wheel shooter aimed by rotating the chassis, net hopper (40 FUEL in the rigid box, 62 with the net stretched), 25 FUEL/s, with a belt floor agitator and a top feeder roller; the intake retracts while shooting to push FUEL into the shooter.',
      source: 'Chief Delphi "Team 254 Presents: Overload"; team254.com/first/2026',
      config: teamConfig(254, 'overload-254', { intake: 'both', aim: 'align', dumper: true, hopper: 62, tall: false, rate: 25, climb: 0 }, (c) => {
        c.hopperCovered = true; // net hopper
        // Capacity from packing real-size FUEL into this hopper: 40 under the rigid rim, +22 under the stretched net. [EST]
        c.hopperExpansion = { startCount: 40, fullHeight: inch(27) };
        c.launcher.exits = 3; // [EST] wide multi-wheel shooter
      }),
    },
    {
      id: 'kepler-1690', team: 1690, name: 'Kepler',
      description: '1690 Orbit. Turret on an 8 in bearing, gear-driven (beltless) shooter with an adjustable hood, intake deployed by surgical tubing, spiked tread for pushing.',
      source: 'Chief Delphi "FRC Orbit 1690 2026 Robot CAD Release"',
      config: teamConfig(1690, 'kepler-1690', { intake: 'both', aim: 'turret', hopper: 39, tall: false, rate: 12, climb: 0 }, (c) => {
        c.wheelCOF = 1.3; // [EST] spiked tread
        c.maxSpeed = 5.0; // [EST]
      }),
    },
    {
      id: 'enigma-9483', team: 9483, name: 'Enigma',
      description: '9483 Overcharge — an over-the-BUMP robot (too tall for the TRENCH). A giant hopper over a grip-taped spindexer bowl, turret shooter on three Kraken X60s, intake on silver arms; went 12-0 as the #1 seed at Istanbul.',
      source: 'Chief Delphi "Team 9483 Presents: Enigma"; "What 1678\'s Robot Reveal Reveals About REBUILT"; The Blue Alliance 2026 media',
      config: teamConfig(9483, 'enigma-9483', { intake: 'both', aim: 'turret', hopper: 80, tall: true, rate: 14, climb: 0 }, (c) => {
        c.hopperCapacity = 86; // [EST] "giant hopper": real-size FUEL packed into the modeled box
      }),
    },
    {
      id: 'motomoto-4946', team: 4946, name: 'Moto Moto',
      description: '4946 The Alpha Dogs — an over-the-BUMP "roomba": a half-circle robot about 30 in tall with a 35 in round hopper, a dye rotor feeding an 11 in turret on a center column (~14 FUEL/s single stream, shoots on the fly), and an intake whose bottom piece rides up over the BUMP on omni wheels.',
      source: '4946 2026 Engineering Report; Chief Delphi "4946 The Alpha Dogs 2026 Robot: Moto Moto" and CAD/documentation release',
      config: teamConfig(4946, 'motomoto-4946', { intake: 'both', aim: 'turret', hopper: 80, tall: true, rate: 14, climb: 0 }, (c) => {
        c.hopperCapacity = 88; // [EST] real-size FUEL packed into the 35 in round hopper
        // Half circle of 16.375 in radius with a 30 in flat edge: modeled as a 30 × 25 in box (110 in perimeter).
        c.frameWidth = inch(30);
        c.frameLength = inch(25);
        c.intake.width = inch(27);
        setRebuiltAccuracy(c, 88); // [EST] shoots on the fly
      }),
    },
    {
      id: 'sandspit-3476', team: 3476, name: 'Sandspit',
      description: '3476 Code Orange — a tall closed-hopper BUMP bot: a 20 FUEL/s wide multi-lane shooter fed by a top roller, the intake retracts while shooting to compact FUEL into it, chassis-aimed.',
      source: 'Chief Delphi "Team 3476: Code Orange 2026 Sandspit Robot Reveal"; The Blue Alliance 2026 media',
      config: teamConfig(3476, 'sandspit-3476', { intake: 'both', aim: 'align', dumper: true, hopper: 80, tall: true, rate: 20, climb: 0 }, (c) => {
        c.launcher.exits = 3; // [EST] "2/3 lane shooter"
        c.hopperCapacity = 70; // [EST]
      }),
    },
  ]);
}

function withIntakeRates(robots: TeamRobot[]): TeamRobot[] {
  for (const r of robots) r.config.intake.rate = (INTAKE_RATE[r.team] !== undefined ? Math.round(INTAKE_RATE[r.team] * INTAKE_RATE_BOOST) : r.config.intake.rate);
  return robots;
}
