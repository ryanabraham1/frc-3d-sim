import { additionalRebuiltTeamRobots } from './additionalTeamRobots';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, climberHooks, decal, deployableIntake, drivebase, fillBlock, hoodShell, hopperWalls, INTAKE_ORANGE, lattice, mat, pivot, plate, registerRobotModel, roller, sidePlates, spin, tubeMat, bumperRing, darkTubeMat, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { belt, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { inch, lb } from '@engine/units';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

/**
 * Real 2026 REBUILT robots (docs/ROBOT-ARCHETYPES.md "Real team robots"). Capabilities come from each team's tech
 * binder / Chief Delphi thread; values the teams didn't publish are marked [EST]. Models are simplified.
 */

const FUEL = 0xf2c200;

/** Intakes that latch down at the start of the match (and stay down) — 4414 and 1690 both deploy once. */
function latchDeploy(state: { v: number }, s: RobotAnimState): number {
  state.v = approach(state.v, s.enabled || state.v > 0.95 ? 1 : 0, 4, s.dt);
  return state.v;
}

function flywheelSpeed(s: RobotAnimState): number {
  return s.enabled ? 45 + 45 * s.firing : 0;
}

/** Hood sector + shooter wheel on a turret / chassis mount; returns the parts to animate. */
function shooterHead(parent: THREE.Object3D, o: { width: number; wheelR: number; wheel: THREE.Material; plate: THREE.Material; hood: THREE.Material; x?: number; y?: number }): { hood: THREE.Group; wheels: THREE.Group[] } {
  const head = pivot(parent, o.x ?? 0, o.y ?? 0);
  sidePlates(head, [[-0.12, -0.03], [0.09, -0.03], [0.12, 0.04], [0.05, 0.12], [-0.08, 0.12], [-0.13, 0.05]], (o.width + 0.02) / 2, o.plate, [[-0.05, 0.05, 0.025]]);
  box(head, 0.03, 0.025, o.width + 0.03, o.plate, -0.1, -0.02, 0); // standoff between the plates
  // Broad feed ramp and a second roller make a complete shooter channel at gameplay scale.
  box(head, 0.2, 0.012, o.width, o.plate, -0.025, -0.028, 0);
  box(head, 0.025, 0.025, o.width + 0.03, o.plate, -0.08, 0.1, 0);
  const wheels = [roller(head, o.wheelR, o.width, o.wheel, 0.02, 0.03), roller(head, o.wheelR * 0.6, o.width, o.wheel, -0.09, 0.015)];
  for(const sign of [-1,1]) {
    const z = sign*(o.width/2+.023);
    motor(head,-.075,-.025,z+sign*.03);
    belt(head,[-.075,-.025],[.02,.03],z);
    fasteners(head,[[-.1,.025],[-.065,.105],[.065,-.015],[.075,.045]],z-sign*.01);
    bar(head,[-.1,.09,z],[.015,.12,z],.008,mat(0xb9c2ca,{metal:.8}));
  }
  const hoodPivot = pivot(head, -0.02, 0.03);
  hoodShell(hoodPivot, o.wheelR + 0.01, o.width, o.hood);
  return { hood: hoodPivot, wheels };
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
  const smoke = mat(0x2b2e33, { opacity: 0.72, metal: 0.15, rough: 0.3 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0x17a3b3 });
  const hopH = H - bt - 0.05;
  // Smoked walls on the bumpers (the bumper backing doubles as the hopper wall), teal trusses along the top.
  hopperWalls(k.visual, { x: 0, y0: bt, length: L * 0.97, width: W * 0.97, height: hopH, m: smoke });
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.48, H - 0.06, sz * W * 0.485], [L * 0.96, 0, 0], [0, 0.05, 0], { cells: 8, w: 0.012, m: teal, zig: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [sx * L * 0.485, bt, sz * W * 0.485], [sx * L * 0.485, H - 0.01, sz * W * 0.485], 0.02, tealTube);
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: hopH * 0.85, color: FUEL });
  // Dye rotor: a big flat spoked disc on the floor that sweeps FUEL into the turret.
  const rotor = new THREE.Group();
  rotor.position.set(L * 0.05, bt + 0.02, 0);
  const rr = Math.min(L, W) * 0.44;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.012, 6, 40), black);
  rim.rotation.x = Math.PI / 2;
  rotor.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), black);
  rotor.add(hub);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    // "Dolphin fin" ramps: curved spokes that rise toward the rim.
    const fin = box(rotor, rr - 0.06, 0.03, 0.01, i % 2 ? teal : black, Math.cos(a) * (rr / 2 + 0.03), 0.02, -Math.sin(a) * (rr / 2 + 0.03));
    fin.rotation.set(0, a + 0.25, 0.08);
  }
  k.visual.add(rotor);
  // Center column up to the turret.
  const t = k.turret;
  t.position.set(L * 0.05, H - 0.07, 0);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, H - 0.07 - bt - 0.04, 16), black);
  column.position.set(L * 0.05, (H - 0.07 + bt + 0.04) / 2, 0);
  k.visual.add(column);
  // Pancake turret: wide black disc with a teal ring, shooter on top.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 32), black);
  t.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, 6, 32), teal);
  ring.rotation.x = Math.PI / 2;
  t.add(ring);
  const sh = shooterHead(t, { width: 0.16, wheelR: inch(1.5), wheel: mat(0xb87333, { metal: 0.8, rough: 0.3 }), plate: black, hood: teal, y: 0.04 });
  // Smoked hopper extension that slides out over the deployed intake.
  const tray = new THREE.Group();
  k.visual.add(tray);
  hopperWalls(tray, { x: side * (L / 2 - 0.14), y0: bt + 0.02, length: 0.26, width: W * 0.92, height: hopH * 0.9, m: smoke });
  for (const sz of [-1, 1]) bar(tray, [side * (L / 2 - 0.27), bt + 0.02 + hopH * 0.9, sz * W * 0.46], [side * (L / 2 - 0.01), bt + 0.02 + hopH * 0.9, sz * W * 0.46], 0.015, tealTube);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black });
  const deploy = { v: 0 };
  let rotorRate = 0;
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.4, H - 0.01, W * 0.4],
    update(s) {
      db.update(s);
      const d = latchDeploy(deploy, s);
      intake.update(s, d);
      tray.position.x = side * d * 0.2;
      fill.set(s.fill);
      // Slowly counter-rotates to agitate; spins hard to feed while firing.
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 9 : -1.2, 6, s.dt);
      spin(rotor, rotorRate, s.dt, 'y');
      for (const w of sh.wheels) spin(w, -flywheelSpeed(s), s.dt);
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.9, 9, s.dt);
      sh.hood.rotation.z = hoodAng;
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
  const smoke = mat(0x1e2024, { opacity: 0.8, metal: 0.1, rough: 0.25 });
  const side = k.groundSide;
  const db = drivebase(k, { motorRing: 0x1f5fd0 });
  // Closed smoked hopper box behind the shooter with a light lid.
  const hx = -L * 0.12;
  const hl = L * 0.72;
  const hopH = H - bt - 0.03;
  hopperWalls(k.visual, { x: hx, y0: bt, length: hl, width: W * 0.98, height: hopH, m: smoke });
  // Flexible net roof is drawn by Robot from hopperExpansion, following actual load.
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.96, width: W * 0.94, height: hopH * 0.9, color: FUEL });
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
  // Shooter across the full width at the front: a wall of pocketed black plates, long rollers along the top.
  const sx = L / 2 - 0.09;
  const shooterPts: [number, number][] = [[-0.08, bt], [0.08, bt], [0.08, H - 0.12], [0.02, H - 0.02], [-0.08, H - 0.02]];
  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const z = -W * 0.45 + (i * W * 0.9) / 3;
    const p = plate(k.visual, shooterPts, 0.008, black, z, [[0, bt + 0.08, 0.03], [0, (bt + H) / 2, 0.035], [0.02, H - 0.1, 0.025]]);
    p.position.x = sx;
  }
  wheels.push(roller(k.visual, 0.045, W * 0.92, black, sx + 0.02, H - 0.08), roller(k.visual, 0.035, W * 0.92, black, sx - 0.07, H - 0.04));
  const flywheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), mat(0x8a9099, { metal: 0.8, rough: 0.3 }));
  flywheel.rotation.x = Math.PI / 2;
  flywheel.position.set(sx - 0.01, (bt + H) / 2, W * 0.47);
  k.visual.add(flywheel);
  for (const sz of [-1, 1]) bar(k.visual, [sx - 0.08, H - 0.015, sz * W * 0.47], [sx + 0.08, H - 0.015, sz * W * 0.47], 0.02, blueTube);
  bar(k.visual, [sx - 0.08, H - 0.015, -W * 0.47], [sx - 0.08, H - 0.015, W * 0.47], 0.02, blueTube);
  box(k.visual, 0.2, 0.015, W * 0.9, black, sx - 0.03, H - 0.14, 0);
  const hood = pivot(k.visual, sx + 0.04, H - 0.06);
  hoodShell(hood, 0.05, W * 0.9, black);
  // Intake slides out the back on blue truss rails.
  const slide = new THREE.Group();
  k.visual.add(slide);
  for (const sz of [-1, 1]) lattice(slide, [side * (L / 2 - 0.25), bt - 0.02, sz * (W / 2 - 0.03)], [side * 0.36, 0, 0], [0, 0.07, 0], { cells: 5, w: 0.016, m: blue, zig: true });
  const rollers = [roller(slide, 0.03, W * 0.9, INTAKE_ORANGE(), side * (L / 2 + 0.1), bt - 0.03), roller(slide, 0.025, W * 0.9, INTAKE_ORANGE(), side * (L / 2 + 0.05), bt + 0.03)];
  const hooks = climberHooks(k.visual, { x: -L * 0.3, y0: bt, length: H - bt - 0.05, spread: W * 0.6, m: k.mats.alu, hook: blue });
  let out = 0;
  let beltSpin = 0;
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.02, 0],
    update(s) {
      db.update(s);
      // Out to collect; pulled back in while shooting so it squeezes FUEL toward the shooter.
      out = approach(out, !s.enabled ? 0 : s.firing > 0 ? 0.3 : 1, 5, s.dt);
      slide.position.x = side * (out - 1) * 0.12;
      beltSpin = s.enabled && (s.intaking || s.firing > 0) ? 24 : 0;
      for (const r of rollers) spin(r, -side * beltSpin, s.dt);
      fill.set(s.fill);
      const fs = flywheelSpeed(s);
      for (const r of wheels) spin(r, -fs, s.dt);
      spin(flywheel, fs, s.dt, 'y');
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.6, 9, s.dt);
      hood.rotation.z = hoodAng;
      hooks.set(s.climb);
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
  hopperWalls(k.visual, { x: 0, y0: bt, length: L * 0.92, width: W * 0.92, height: top - bt, m: mat(0x69717b, { opacity: 0.28, rough: 0.5, metal: 0 }), frame: gray });
  // X-lattice walls on all four sides.
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.47, bt, sz * W * 0.47], [L * 0.94, 0, 0], [0, top - bt, 0], { cells: 5, w: 0.014, m: black });
  for (const sx of [-1, 1]) lattice(k.visual, [sx * L * 0.47, bt, -W * 0.47], [0, 0, W * 0.94], [0, top - bt, 0], { cells: 4, w: 0.014, m: black });
  box(k.visual, L * 0.92, 0.006, W * 0.92, gray, 0, bt + 0.01, 0);
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.02, length: L * 0.9, width: W * 0.9, height: (top - bt) * 0.85, color: FUEL });
  // Curved lattice arch over the front half.
  const arch: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    arch.push([L * 0.32 + Math.sin(a) * 0.06, top + Math.sin(a) * 0.04, -W * 0.47 * Math.cos(a)]);
  }
  for (let i = 0; i < 8; i++) {
    bar(k.visual, arch[i], arch[i + 1], 0.014, black);
    bar(k.visual, [arch[i][0] - 0.14, arch[i][1] - 0.02, arch[i][2]], [arch[i + 1][0] - 0.14, arch[i + 1][1] - 0.02, arch[i + 1][2]], 0.014, black);
    bar(k.visual, arch[i], [arch[i + 1][0] - 0.14, arch[i + 1][1] - 0.02, arch[i + 1][2]], 0.01, black);
  }
  // Turret at the front (opposite the back intake), inside the arch, on an 8 in bearing over a deck.
  const tx = L * 0.17;
  const t = k.turret;
  t.position.set(tx, top + 0.01, 0);
  box(k.visual, 0.3, 0.008, W * 0.94, gray, tx, top - 0.004, 0);
  const bearing = new THREE.Mesh(new THREE.TorusGeometry(inch(4), 0.012, 8, 28), k.mats.alu);
  bearing.rotation.x = Math.PI / 2;
  t.add(bearing);
  const sh = shooterHead(t, { width: 0.14, wheelR: inch(2), wheel: gray, plate: black, hood: gray, y: 0.03 });
  // Exposed spur gear driving the flywheel (Kepler's shooter is gear-driven, no belts).
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 18), k.mats.alu);
  gear.rotation.x = Math.PI / 2;
  gear.position.set(-0.05, 0.08, 0.09);
  sh.hood.parent!.add(gear);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 1, frame: black });
  const hooks = climberHooks(k.visual, { x: -L * 0.36, y0: bt, length: top - bt, spread: W * 0.55, m: k.mats.alu, hook: black });
  const deploy = { v: 0 };
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.4, top, W * 0.3],
    update(s) {
      db.update(s);
      intake.update(s, latchDeploy(deploy, s));
      fill.set(s.fill);
      const fly = flywheelSpeed(s);
      for (const w of sh.wheels) spin(w, -fly, s.dt);
      spin(gear, fly * 0.6, s.dt, 'y');
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.9, 9, s.dt);
      sh.hood.rotation.z = hoodAng;
      hooks.set(s.climb);
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
  const smoke = mat(0x1a1b1f, { opacity: 0.9, rough: 0.3 });
  const silverTube = tubeMat(0xc9ced5);
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 });
  const db = drivebase(k, { motorRing: 0x2f6fd6 });
  const hopH = H - bt - 0.04;
  hopperWalls(k.visual, { x: 0, y0: bt, length: L * 0.97, width: W * 0.97, height: hopH, m: smoke });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [sx * L * 0.485, bt, sz * W * 0.485], [sx * L * 0.485, H - 0.04, sz * W * 0.485], 0.03, silverTube);
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI;
    const z = sz * (W * 0.485 + 0.006);
    decal(k.visual, '9483', { w: 0.3, h: 0.11, x: 0, y: bt + hopH * 0.55, z, rotY });
    decal(k.visual, 'BOEING   Altinbas   OVERCHARGE', { w: 0.42, h: 0.03, x: 0, y: bt + hopH * 0.85, z, rotY });
    decal(k.visual, 'ROBOTICS · ISTANBUL', { w: 0.3, h: 0.025, x: 0, y: bt + hopH * 0.25, z, rotY });
  }
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: hopH * 0.85, color: FUEL });
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
  box(k.visual, 0.24, 0.035, W * 0.95, silver, L * 0.18, H - 0.085, 0);
  const feedColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, hopH - 0.04, 16), black);
  feedColumn.position.set(L * 0.18, bt + (hopH - 0.04) / 2, 0);
  k.visual.add(feedColumn);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 30), black);
  t.add(disc);
  const sh = shooterHead(t, { width: 0.16, wheelR: inch(2), wheel: mat(0x8a9099, { metal: 0.6 }), plate: black, hood: silver, y: 0.03 });
  // Intake on silver arms with a silver roller.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: silver });
  const hooks = climberHooks(k.visual, { x: -L * 0.38, y0: bt, length: H - bt - 0.05, spread: W * 0.6, m: silverTube, hook: black });
  const deploy = { v: 0 };
  let rate = 0;
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.45, H - 0.02, W * 0.4],
    update(s) {
      db.update(s);
      intake.update(s, latchDeploy(deploy, s));
      fill.set(s.fill);
      rate = approach(rate, !s.enabled ? 0 : s.firing > 0 ? 8 : 1.5, 5, s.dt);
      spin(spindex, rate, s.dt, 'y');
      for (const w of sh.wheels) spin(w, -flywheelSpeed(s), s.dt);
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.9, 9, s.dt);
      sh.hood.rotation.z = hoodAng;
      hooks.set(s.climb);
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
  const fill = fillBlock(k.visual, { x: centerX - side * R * 0.25, y0: bt + 0.03, length: R * 1.1, width: W * 0.65, height: hopH * 0.85, color: FUEL });
  // Dye rotor: a wide gray slotted disc on the floor.
  const rotor = new THREE.Group();
  rotor.position.set(centerX - side * R * 0.12, bt + 0.02, 0);
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.78, 0.02, 40), gray));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    box(rotor, R * 0.6, 0.05, 0.015, black, Math.cos(a) * R * 0.55, 0.035, -Math.sin(a) * R * 0.55).rotation.y = a;
  }
  k.visual.add(rotor);
  // Center column to the 11 in turret ring at the top.
  const colH = H - bt - 0.1;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, colH, 24), black);
  column.position.set(centerX, bt + colH / 2 + 0.02, 0);
  k.visual.add(column);
  for (const y of [0.3, 0.6, 0.85]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.015, 24), gray);
    band.position.set(centerX, bt + colH * y, 0);
    k.visual.add(band);
  }
  const t = k.turret;
  t.position.set(centerX, H - 0.06, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(inch(5.5), 0.018, 10, 36), black);
  ring.rotation.x = Math.PI / 2;
  t.add(ring);
  const sh = shooterHead(t, { width: 0.15, wheelR: inch(2), wheel: mat(0x2f6fd6, { metal: 0.3 }), plate: black, hood: mat(0xc62828, { metal: 0.2 }), y: 0.02 });
  // Silver perforated goalpost over the intake on the flat side.
  const gx = flatX - side * 0.03;
  for (const sz of [-1, 1]) bar(k.visual, [gx, bt, sz * (R - 0.03)], [gx, H - 0.01, sz * (R - 0.03)], 0.025, silverTube);
  bar(k.visual, [gx, H - 0.01, -(R - 0.03)], [gx, H - 0.01, R - 0.03], 0.025, silverTube);
  for (const sz of [-1, 1]) bar(k.visual, [gx, H - 0.01, sz * (R - 0.03)], [centerX, H - 0.05, sz * 0.15], 0.02, silverTube);
  // Intake on the flat side: silver frame, green compliant wheels.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 3, frame: silverTube, width: W * 0.9 });
  const deploy = { v: 0 };
  let rotorRate = 0;
  let hoodAng = 0;
  return {
    replaces: ['bumpers', 'chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [gx, H + 0.01, 0],
    update(s) {
      db.update(s);
      intake.update(s, latchDeploy(deploy, s));
      fill.set(s.fill);
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 10 : -1.2, 6, s.dt);
      spin(rotor, rotorRate, s.dt, 'y');
      for (const w of sh.wheels) spin(w, -flywheelSpeed(s), s.dt);
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.9, 9, s.dt);
      sh.hood.rotation.z = hoodAng;
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
  const orange = mat(0xc8501e, { metal: 0.5, rough: 0.35 }); // Code Orange anodizing (darker than the intake orange)
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
  hopperWalls(k.visual, { x: hx, y0: bt, length: hl, width: W * 0.96, height: hopH, m: clear });
  box(k.visual, hl, 0.005, W * 0.96, mat(0xeef2f5, { opacity: 0.5, metal: 0 }), hx, H - 0.04, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(k.visual, [hx + (sx * hl) / 2, bt, sz * W * 0.48], [hx + (sx * hl) / 2, H - 0.04, sz * W * 0.48], 0.035, blackTube);
  for (const y of [bt + hopH * 0.45, H - 0.045]) for (const sz of [-1, 1]) bar(k.visual, [hx - hl / 2, y, sz * W * 0.485], [hx + hl / 2, y, sz * W * 0.485], 0.02, orangeTube);
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.95, width: W * 0.92, height: hopH * 0.88, color: FUEL });
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
  // Wide multi-lane shooter at the front with a top feeder roller and two big flywheels.
  const sx = -side * (L / 2 - 0.1);
  for (const sz of [-1, 0, 1]) plate(k.visual, [[sx - 0.08, bt + 0.05], [sx + 0.08, bt + 0.05], [sx + 0.08, H - 0.1], [sx, H - 0.03], [sx - 0.08, H - 0.03]], 0.008, black, sz * W * 0.4, [[sx, (bt + H) / 2, 0.035]]);
  const wheels = [roller(k.visual, 0.05, W * 0.85, black, sx, H - 0.12), roller(k.visual, 0.03, W * 0.85, mat(0xa9afb7, { metal: 0.6 }), sx + side * 0.08, H - 0.06)];
  for (const sz of [-1, 1]) {
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.025, 24), mat(0xa9afb7, { metal: 0.7, rough: 0.3 }));
    fly.rotation.x = Math.PI / 2;
    fly.position.set(sx, (bt + H) / 2, sz * (W / 2 - 0.02));
    k.visual.add(fly);
    wheels.push(fly as unknown as THREE.Group);
  }
  box(k.visual, 0.2, 0.015, W * 0.82, black, sx + side * 0.02, H - 0.18, 0);
  const hood = pivot(k.visual, sx - side * 0.05, H - 0.1);
  hoodShell(hood, 0.05, W * 0.85, black);
  // Intake on the back that retracts while shooting (compacting the FUEL).
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blackTube });
  const hooks = climberHooks(k.visual, { x: 0, y0: bt, length: H - bt - 0.05, spread: W * 0.55, m: blackTube, hook: orange });
  let out = 0;
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.03, 0],
    update(s) {
      db.update(s);
      out = approach(out, !s.enabled ? 0 : s.firing > 0 ? 0.35 : 1, 5, s.dt);
      intake.update(s, out);
      fill.set(s.fill);
      const fs = flywheelSpeed(s);
      spin(wheels[0], -fs, s.dt);
      spin(wheels[1], s.firing > 0 || s.intaking ? -25 : 0, s.dt);
      for (const f of wheels.slice(2)) spin(f, fs, s.dt, 'y');
      hoodAng = approach(hoodAng, (s.hood - 1.0) * 0.6, 9, s.dt);
      hood.rotation.z = -side * hoodAng;
      hooks.set(s.climb);
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

export function rebuiltTeamRobots(): TeamRobot[] {
  return [
    ...additionalRebuiltTeamRobots(),
    {
      id: 'ripcurrent-4414', team: 4414, name: 'RIPCURRENT',
      description: '4414 HighTide (2026 World Champions, captain). Pancake turret with a 3 in quad-Kraken flywheel and adjustable hood (shoots on the move), "dolphin fin" dye rotor feeding a single high-BPS stream, structural-bumper hopper that extends with the intake to hold 85 FUEL; net bulges above 70 FUEL and loses TRENCH clearance. No climber.',
      source: '4414 2026 Technical Binder (2026.team4414.com); Chief Delphi "Team 4414 HighTide 2026 Tech Binder - RIPCURRENT"',
      config: teamConfig(4414, 'ripcurrent-4414', { intake: 'both', aim: 'turret', hopper: 85, tall: false, rate: 15, climb: 0 }, (c) => {
        // 25 × 32 in frame with chamfered back corners, inside the 110 in perimeter: modeled as an equal-perimeter box.
        c.frameLength = inch(24);
        c.frameWidth = inch(31);
        c.hopperExpansion = { startCount: 70, fullHeight: inch(27) }; // [EST] net expansion above ~70 FUEL
        setRebuiltAccuracy(c, 90); // [EST] precomputed robust shot map
        c.maxSpeed = 4.4; // [EST] geared 7.67:1 for low current draw
      }),
    },
    {
      id: 'overload-254', team: 254, name: 'Overload',
      description: '254 Cheesy Poofs. Fixed multi-wheel shooter aimed by rotating the chassis, 50-FUEL total net hopper, 25 FUEL/s, with a belt floor agitator and a top feeder roller; the intake retracts while shooting to push FUEL into the shooter. 115 lb.',
      source: 'Chief Delphi "Team 254 Presents: Overload"; team254.com/first/2026',
      config: teamConfig(254, 'overload-254', { intake: 'both', aim: 'align', dumper: true, hopper: 50, tall: false, rate: 25, climb: 1 }, (c) => {
        c.hopperExpansion = { startCount: 40, fullHeight: inch(28) }; // [EST] net bulges when over trench-safe load
        c.launcher.exits = 3; // [EST] wide multi-wheel shooter
        c.mass = lb(115);
      }),
    },
    {
      id: 'kepler-1690', team: 1690, name: 'Kepler',
      description: '1690 Orbit. Turret on an 8 in bearing, gear-driven (beltless) shooter with an adjustable hood, intake deployed by surgical tubing, spiked tread for pushing, climber.',
      source: 'Chief Delphi "FRC Orbit 1690 2026 Robot CAD Release"',
      config: teamConfig(1690, 'kepler-1690', { intake: 'both', aim: 'turret', hopper: 40, tall: false, rate: 12, climb: 1 }, (c) => {
        c.wheelCOF = 1.3; // [EST] spiked tread
        c.maxSpeed = 5.0; // [EST]
      }),
    },
    {
      id: 'enigma-9483', team: 9483, name: 'Enigma',
      description: '9483 Overcharge — an over-the-BUMP robot (too tall for the TRENCH). A giant hopper over a grip-taped spindexer bowl, turret shooter on three Kraken X60s, intake on silver arms; went 12-0 as the #1 seed at Istanbul.',
      source: 'Chief Delphi "Team 9483 Presents: Enigma"; "What 1678\'s Robot Reveal Reveals About REBUILT"; The Blue Alliance 2026 media',
      config: teamConfig(9483, 'enigma-9483', { intake: 'both', aim: 'turret', hopper: 80, tall: true, rate: 14, climb: 1 }, (c) => {
        c.hopperCapacity = 90; // [EST] "giant hopper"
        c.climber.maxLevel = 1; // [EST]
      }),
    },
    {
      id: 'motomoto-4946', team: 4946, name: 'Moto Moto',
      description: '4946 The Alpha Dogs — an over-the-BUMP "roomba": a half-circle robot about 30 in tall with a 35 in round hopper, a dye rotor feeding an 11 in turret on a center column (~14 FUEL/s single stream, shoots on the fly), and an intake whose bottom piece rides up over the BUMP on omni wheels.',
      source: '4946 2026 Engineering Report; Chief Delphi "4946 The Alpha Dogs 2026 Robot: Moto Moto" and CAD/documentation release',
      config: teamConfig(4946, 'motomoto-4946', { intake: 'both', aim: 'turret', hopper: 80, tall: true, rate: 14, climb: 0 }, (c) => {
        c.hopperCapacity = 100; // [EST] 35 in round hopper
        // Half circle of 16.375 in radius with a 30 in flat edge: modeled as a 30 × 25 in box (110 in perimeter).
        c.frameWidth = inch(30);
        c.frameLength = inch(25);
        c.intake.width = inch(27);
        setRebuiltAccuracy(c, 88); // [EST] shoots on the fly
      }),
    },
    {
      id: 'sandspit-3476', team: 3476, name: 'Sandspit',
      description: '3476 Code Orange — a tall closed-hopper BUMP bot: a 20 FUEL/s wide multi-lane shooter fed by a top roller, the intake retracts while shooting to compact FUEL into it, chassis-aimed; an Orbit-style climber added for Champs.',
      source: 'Chief Delphi "Team 3476: Code Orange 2026 Sandspit Robot Reveal"; The Blue Alliance 2026 media',
      config: teamConfig(3476, 'sandspit-3476', { intake: 'both', aim: 'align', dumper: true, hopper: 80, tall: true, rate: 20, climb: 1 }, (c) => {
        c.launcher.exits = 3; // [EST] "2/3 lane shooter"
        c.hopperCapacity = 70; // [EST]
      }),
    },
  ];
}
