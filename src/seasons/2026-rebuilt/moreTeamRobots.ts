import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, fillBlock, flowAt, hopperStow, hopperWalls, jitter, lattice, mat, overBumperIntake, pivot, plate, registerRobotModel, roller, spin, tubeMat, wheelShaft, hoodShell, columnFeed, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { hoodFor, turretShooter } from '@engine/robot/turretShooter';
import { inch } from '@engine/units';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

/**
 * Five more real 2026 REBUILT robots. Looks follow each team's published CAD / reveal photos, drawn in the clean,
 * flat-shaded style of the reference: solid frame colours, clear hopper walls, and only the parts that matter
 * (every part is bolted to a post, rail or plate that reaches the frame).
 *
 *  - 6329 Bucks' Wrath ROMAN: purple, 20.75 in spindexer drum + roller floor, "upkicker" into a turret on the drum
 *    centre, long four-bar intake that folds on impact (CD reveal + Roman II CAD release).
 *  - 1778 Chill Out HAILSTORM: blue, spindexer with a grip-taped "bottle rocket" cone, compact turret (CD CAD release).
 *  - 5940 BREAD Croquembouche: gold truss frame, black net roof, DOUBLE turret (CD double-turret CAD release).
 *  - 7769 The CREW CHUNK: black sponsor-plated polycarb walls and net, wide static-hood shooter, racked intake that
 *    slides out (CD CAD release, hopper "almost 70", 50–60 in play).
 *  - 9128/10340 Itkan Triple Threat: black hex-perforated hopper, three fixed lanes with tubing-wrapped rollers and a
 *    static hood, wide front intake bank; 15–16 BPS sustained, 20–25 initial, ~80 FUEL (CD reveal Q&A).
 */

const FUEL = 0xf2c200;
const FUEL_R = inch(5.91) / 2;
const clearMat = () => mat(0xdde5f0, { opacity: 0.2, rough: 0.2, metal: 0 });
const smokeMat = (o = 0.45) => mat(0x2a2e34, { opacity: o, rough: 0.3, metal: 0.1 });

/** Intakes latch down when the match is enabled and stay down (like 4414's). */
function latch(state: { v: number }, s: RobotAnimState): number {
  state.v = approach(state.v, s.enabled || state.v > 0.95 ? 1 : 0, 4, s.dt);
  return state.v;
}

/**
 * Spindexer bowl: a spinning floor disc with radial ribs and a centre cone inside a clear circular fence, FUEL
 * thrown to the rim by the spin and carried round to the open tower in the middle.
 */
function spindexer(parent: THREE.Object3D, o: { x: number; y0: number; R: number; wallH: number; coneH: number; plate: THREE.Material; rib: THREE.Material; cone: THREE.Material; rim: THREE.Material }): { floor: THREE.Group } {
  const g = new THREE.Group();
  g.position.set(o.x, o.y0, 0);
  parent.add(g);
  const fence = new THREE.Mesh(new THREE.CylinderGeometry(o.R, o.R, o.wallH, 40, 1, true), mat(0xdde5f0, { opacity: 0.22, rough: 0.2 }));
  (fence.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  fence.position.y = o.wallH / 2;
  g.add(fence);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(o.R, 0.009, 8, 48), o.rim);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = o.wallH;
  g.add(rim);
  const floor = new THREE.Group();
  g.add(floor);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(o.R * 0.98, o.R * 0.98, 0.012, 40), o.plate);
  disc.position.y = 0.012;
  floor.add(disc);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(o.R * 0.8, 0.02, 0.014), o.rib);
    rib.position.set(Math.cos(a) * o.R * 0.5, 0.028, Math.sin(a) * o.R * 0.5);
    rib.rotation.y = -a;
    floor.add(rib);
  }
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.075, o.coneH, 20), o.cone);
  cone.position.y = 0.018 + o.coneH / 2;
  floor.add(cone);
  return { floor };
}

/** Hopper wall shell with corner posts and a rim, in a frame colour. */
function shell(k: ModelKit, o: { x?: number; lengthK?: number; widthK?: number; wall: THREE.Material; frame: THREE.Material; top?: number }): { y0: number; h: number; length: number; width: number } {
  const c = k.config, L = c.frameLength, W = c.frameWidth;
  const y0 = c.bumperTop, h = (o.top ?? c.height - 0.03) - y0;
  const length = L * (o.lengthK ?? 0.96), width = W * (o.widthK ?? 0.96);
  hopperWalls(k.visual, { x: o.x ?? 0, y0, length, width, height: h, m: o.wall, frame: o.frame });
  return { y0, h, length, width };
}

// ── 6329 ROMAN ──
registerRobotModel('roman-6329', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const purple = mat(0x7b4bd6, { metal: 0.25, rough: 0.45 }), steel = tubeMat(0xb3b9c2), black = mat(0x17181b, { metal: 0.3, rough: 0.5 });
  const db = drivebase(k, { tube: steel, motorRing: 0x7b4bd6 });
  const sh0 = shell(k, { wall: clearMat(), frame: steel });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  // Drum 20.75 in across with a ~6 in centre; the turret stands over its centre.
  const R = inch(20.75) / 2, cx = -side * -0.02;
  const drum = spindexer(k.visual, { x: cx, y0: bt + 0.01, R, wallH: 0.1, coneH: 0.07, plate: black, rib: purple, cone: purple, rim: purple });
  // Roller floor from the intake to the drum: purple rollers on a dead shaft, wide and uninterrupted.
  const floorRollers: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) floorRollers.push(roller(k.visual, 0.02, W * 0.9, purple, side * (R + 0.03 + i * 0.05) + cx, bt + 0.03));
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [cx + sx * 0.1, bt + 0.11, sz * 0.1], [cx + sx * 0.1, H - 0.1, sz * 0.1], 0.016, steel); // open tower
  const t = k.turret;
  t.position.set(cx, H - 0.07, 0);
  const sh = turretShooter(t, { width: 0.19, wheel: mat(0x7b4bd6, { rough: 0.5 }), plate: black, accent: purple, height: 0.15, topY: 0.06 });
  decal(k.visual, 'ROMAN', { w: 0.2, h: 0.045, color: '#ffffff', background: '#7b4bd6', x: -side * 0.0, y: bt + 0.07, z: W / 2 - 0.004, rotY: 0 });
  decal(k.visual, 'ROMAN', { w: 0.2, h: 0.045, color: '#ffffff', background: '#7b4bd6', x: 0, y: bt + 0.07, z: -(W / 2 - 0.004), rotY: Math.PI });
  // Four-bar intake with long arms: a clear pocketed pair of arms and a purple roller bank.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: steel, stow: Math.PI * 0.85, rollerMaterial: purple });
  const d = { v: 0 };
  let spinRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-side * L * 0.35, H - 0.01, W * 0.38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: columnFeed(k, cx, sh.flywheel, R * 0.8, FUEL_R) },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      intake.update(s, latch(d, s));
      spinRate = approach(spinRate, !s.enabled ? 0 : s.firing > 0 ? 7 : -1, 6, s.dt);
      spin(drum.floor, spinRate, s.dt, 'y');
      for (const r of floorRollers) spin(r, -side * (s.enabled && (s.intaking || s.firing > 0) ? 18 : 0), s.dt);
      sh.update(s);
    },
  };
});

// ── 1778 HAILSTORM ──
registerRobotModel('hailstorm-1778', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const blue = mat(0x2f62d4, { metal: 0.3, rough: 0.45 }), steel = tubeMat(0xb7bdc6), black = mat(0x181a1e, { metal: 0.3, rough: 0.5 }), tan = mat(0xcbb98a, { rough: 0.9 });
  const db = drivebase(k, { tube: steel, motorRing: 0x2f62d4 });
  const sh0 = shell(k, { wall: smokeMat(0.32), frame: steel });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  // Spindexer with the grip-taped "bottle rocket" cone, off-centre toward the turret end; the turret sits in its throat.
  const R = Math.min(L, W) * 0.4, cx = -side * -0.04;
  const drum = spindexer(k.visual, { x: cx, y0: bt + 0.01, R, wallH: 0.09, coneH: 0.16, plate: black, rib: blue, cone: tan, rim: blue });
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [cx + sx * 0.1, bt + 0.1, sz * 0.1], [cx + sx * 0.1, H - 0.1, sz * 0.1], 0.016, steel);
  const t = k.turret;
  t.position.set(cx, H - 0.07, 0);
  const sh = turretShooter(t, { width: 0.19, wheel: mat(0xb7bdc6, { metal: 0.8, rough: 0.3 }), plate: black, accent: blue, height: 0.15, topY: 0.06 });
  decal(k.visual, 'HAILSTORM', { w: 0.24, h: 0.04, color: '#ffffff', background: '#2f62d4', x: 0, y: bt + 0.065, z: W / 2 - 0.004, rotY: 0 });
  decal(k.visual, 'HAILSTORM', { w: 0.24, h: 0.04, color: '#ffffff', background: '#2f62d4', x: 0, y: bt + 0.065, z: -(W / 2 - 0.004), rotY: Math.PI });
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blue, rollerMaterial: black });
  const d = { v: 0 };
  let spinRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-side * L * 0.38, H - 0.01, W * 0.38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: columnFeed(k, cx, sh.flywheel, R * 0.8, FUEL_R) },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      intake.update(s, latch(d, s));
      spinRate = approach(spinRate, !s.enabled ? 0 : s.firing > 0 ? 8 : -1.2, 6, s.dt);
      spin(drum.floor, spinRate, s.dt, 'y');
      sh.update(s);
    },
  };
});

// ── 5940 CROQUEMBOUCHE (double turret) ──
registerRobotModel('croquembouche-5940', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const gold = mat(0xe0a924, { metal: 0.5, rough: 0.4 }), goldTube = tubeMat(0xe0a924), black = mat(0x17181b, { metal: 0.3, rough: 0.5 }), net = new THREE.LineBasicMaterial({ color: 0x15171a });
  const db = drivebase(k, { tube: goldTube, motorRing: 0xe0a924 });
  const top = H - 0.03;
  // Low open hopper: gold corner posts, a black net roof, clear sides.
  const sh0 = shell(k, { wall: smokeMat(0.22), frame: goldTube, top });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  const pts: number[] = [];
  const nx = 12, nz = 10;
  for (let i = 0; i <= nx; i++) pts.push(-L * 0.48 + (i / nx) * L * 0.96, top + 0.012, -W * 0.48, -L * 0.48 + (i / nx) * L * 0.96, top + 0.012, W * 0.48);
  for (let j = 0; j <= nz; j++) pts.push(-L * 0.48, top + 0.012, -W * 0.48 + (j / nz) * W * 0.96, L * 0.48, top + 0.012, -W * 0.48 + (j / nz) * W * 0.96);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  k.visual.add(new THREE.LineSegments(geo, net));
  // Two turrets, one over each half of the robot, each with its own flywheel; both follow the single aim.
  const tz = W * 0.25, tx = L * 0.12;
  const turrets: { g: THREE.Group; sh: ReturnType<typeof turretShooter> }[] = [];
  for (const sz of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(tx, H - 0.07, sz * tz);
    k.visual.add(g);
    const sh = turretShooter(g, { width: 0.19, wheel: black, plate: black, accent: gold, height: 0.15, topY: 0.06 });
    turrets.push({ g, sh });
    for (const sx of [-1, 1]) bar(k.visual, [tx + sx * 0.1, bt, sz * tz + sx * 0.08], [tx + sx * 0.1, H - 0.12, sz * tz + sx * 0.08], 0.018, goldTube);
  }
  // Floor conveyor under the hopper: black rollers carrying FUEL forward to both turret throats.
  const conv: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) conv.push(roller(k.visual, 0.016, W * 0.9, black, -L * 0.38 + i * L * 0.12, bt + 0.03));
  decal(k.visual, 'BREAD', { w: 0.14, h: 0.04, color: '#17181b', background: '#e0a924', x: -L * 0.2, y: bt + 0.07, z: W / 2 - 0.004, rotY: 0 });
  decal(k.visual, 'BREAD', { w: 0.14, h: 0.04, color: '#17181b', background: '#e0a924', x: -L * 0.2, y: bt + 0.07, z: -(W / 2 - 0.004), rotY: Math.PI });
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: gold, rollerMaterial: black });
  const d = { v: 0 };
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-side * L * 0.38, H - 0.01, W * 0.38],
    flow: {
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: pile.stow,
      feed: () => {
        const t = turrets[Math.random() < 0.5 ? 0 : 1];
        const z = t.g.position.z;
        return [new THREE.Vector3(-L * 0.3, bt + 0.04 + FUEL_R, z), new THREE.Vector3(tx - 0.12, bt + 0.05 + FUEL_R, z), flowAt(k, t.sh.flywheel, -0.09, -0.02, 0), flowAt(k, t.sh.flywheel, 0.02, 0.04, 0)];
      },
    },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      intake.update(s, latch(d, s));
      for (const t of turrets) { t.g.rotation.y = k.turret.rotation.y; t.sh.update(s); }
      for (const r of conv) spin(r, s.enabled && (s.intaking || s.firing > 0) ? 16 : 0, s.dt);
    },
  };
});

// ── 7769 CHUNK ──
registerRobotModel('chunk-7769', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const blue = mat(0x2756c9, { metal: 0.3, rough: 0.5 }), blueTube = tubeMat(0x2756c9), black = mat(0x15161a, { metal: 0.3, rough: 0.5 }), steel = mat(0xbcc2ca, { metal: 0.8, rough: 0.3 });
  const db = drivebase(k, { tube: blueTube, motorRing: 0x2756c9 });
  const hx = -L * 0.1, hl = L * 0.76;
  const sh0 = shell(k, { x: hx, lengthK: 0.76, wall: smokeMat(0.7), frame: blueTube });
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.94, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  // Sponsor plates on the black walls (APTIV, Nissan, Beninigo, Autodesk as in the CAD).
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI, z = sz * (W * 0.48 + 0.006);
    decal(k.visual, 'APTIV', { w: 0.14, h: 0.035, color: '#ffffff', background: '#15161a', x: hx - 0.05, y: H - 0.1, z, rotY });
    decal(k.visual, 'NISSAN  BENINGO', { w: 0.2, h: 0.03, color: '#ffffff', background: '#15161a', x: hx - 0.05, y: H - 0.15, z, rotY });
    decal(k.visual, '#WeBuildAsOne', { w: 0.2, h: 0.03, color: '#9fb8ff', background: '#15161a', x: hx - 0.05, y: bt + 0.07, z, rotY });
  }
  // Net lid.
  lattice(k.visual, [hx - hl / 2, H - 0.03, -W * 0.48], [hl, 0, 0], [0, 0, W * 0.96], { cells: 8, w: 0.008, m: black });
  // Wide shooter at the front: base plate, two 4 in stealth-wheel banks, and a static hood (no outer belts).
  const sx = L / 2 - 0.1, wheels: THREE.Group[] = [];
  for (const sz of [-1, 0, 1]) plate(k.visual, [[sx - 0.08, bt], [sx + 0.08, bt], [sx + 0.08, H - 0.12], [sx + 0.02, H - 0.04], [sx - 0.08, H - 0.04]], 0.008, black, sz * W * 0.46);
  box(k.visual, 0.2, 0.012, W * 0.9, black, sx - 0.02, bt + 0.07, 0);
  wheels.push(roller(k.visual, 0.051, W * 0.9, black, sx + 0.02, H - 0.1), roller(k.visual, 0.04, W * 0.9, black, sx - 0.07, H - 0.07));
  const hood = pivot(k.visual, sx + 0.05, H - 0.07);
  hoodShell(hood, 0.05, W * 0.9, steel);
  // Racked intake that slides out the intake end (independent drives each side).
  const slide = new THREE.Group();
  k.visual.add(slide);
  for (const sz of [-1, 1]) {
    box(slide, 0.4, 0.02, 0.03, steel, side * (L / 2 - 0.14), bt - 0.01, sz * (W / 2 - 0.04));
    box(slide, 0.03, 0.12, 0.03, blue, side * (L / 2 + 0.05), bt + 0.04, sz * (W / 2 - 0.04));
  }
  const rollers = [roller(slide, 0.03, W * 0.84, mat(0xff7a1a, { rough: 0.55 }), side * (L / 2 + 0.06), bt + 0.0), roller(slide, 0.025, W * 0.84, mat(0xff7a1a, { rough: 0.55 }), side * (L / 2 + 0.01), bt + 0.05)];
  let out = 0, hoodAng = 0;
  const pile = hopperStow({ x: hx, y0: bt + 0.03, length: hl * 0.9, width: W * 0.88, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.02, 0],
    flow: {
      intake: () => { const z = jitter(W * 0.6); return [flowAt(k, rollers[0], -side * 0.02, 0.03, z), flowAt(k, rollers[1], -side * 0.03, 0.04, z), new THREE.Vector3(side * (L / 2 - 0.12), bt + 0.05 + FUEL_R, z * 0.8)]; },
      stow: pile.stow,
      feed: () => { const z = jitter(W * 0.8); return [new THREE.Vector3(hx + hl * 0.2, bt + 0.04 + FUEL_R, z), new THREE.Vector3(sx - 0.07, bt + 0.05 + FUEL_R, z), new THREE.Vector3(sx - 0.03, H - 0.14, z), new THREE.Vector3(sx + 0.03, H - 0.07, z)]; },
    },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      // Out to collect, jostled in and out while shooting ("truffle shuffle" keeps the hopper from jamming).
      const shuffle = s.firing > 0 ? 0.35 + 0.15 * Math.sin(s.time * 9) : 1;
      out = approach(out, !s.enabled ? 0 : shuffle, 5, s.dt);
      slide.position.x = side * (out - 1) * 0.12;
      for (const r of rollers) spin(r, -side * (s.enabled && (s.intaking || s.firing > 0) ? 24 : 0), s.dt);
      const fs = s.enabled ? 45 + 45 * s.firing : 0;
      for (const w of wheels) spin(w, -fs, s.dt);
      hoodAng = approach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = hoodAng;
    },
  };
});

// ── 9128 TRIPLE THREAT ──
registerRobotModel('triple-threat-9128', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const black = mat(0x14161a, { metal: 0.35, rough: 0.5 }), blackTube = tubeMat(0x20242a), gray = mat(0x8c939c, { metal: 0.6, rough: 0.4 });
  const db = drivebase(k, { tube: blackTube, motorRing: 0x2a5be0 });
  const hx = -L * 0.06, hl = L * 0.8;
  const sh0 = shell(k, { x: hx, lengthK: 0.8, wall: smokeMat(0.55), frame: blackTube });
  // Hex-perforated black side panels: a honeycomb of small cells on each long side.
  for (const sz of [-1, 1]) lattice(k.visual, [hx - hl / 2, bt + 0.03, sz * (W * 0.48 + 0.004)], [hl, 0, 0], [0, sh0.h - 0.06, 0], { cells: 7, w: 0.008, m: black, zig: true });
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.94, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  // Three fixed lanes at the front: dividers, a tubing-wrapped roller per lane and one static hood across all three.
  const sx = L / 2 - 0.09, rolls: THREE.Group[] = [];
  for (const z of [-W * 0.46, -W * 0.15, W * 0.15, W * 0.46]) plate(k.visual, [[sx - 0.09, bt], [sx + 0.08, bt], [sx + 0.08, H - 0.12], [sx + 0.02, H - 0.04], [sx - 0.09, H - 0.04]], 0.008, black, z);
  for (const z of [-W * 0.3, 0, W * 0.3]) rolls.push(roller(k.visual, 0.045, W * 0.26, mat(0x2b2f36, { rough: 0.9 }), sx + 0.01, H - 0.1, z));
  const hood = new THREE.Group();
  hood.position.set(sx + 0.05, H - 0.06, 0);
  k.visual.add(hood);
  hoodShell(hood, 0.05, W * 0.92, gray);
  box(k.visual, 0.24, 0.012, W * 0.9, black, sx - 0.03, bt + 0.07, 0);
  decal(k.visual, 'TRIPLE THREAT', { w: 0.3, h: 0.04, color: '#cbd5ee', background: '#14161a', x: hx, y: bt + 0.075, z: W / 2 + 0.004, rotY: 0 });
  decal(k.visual, 'TRIPLE THREAT', { w: 0.3, h: 0.04, color: '#cbd5ee', background: '#14161a', x: hx, y: bt + 0.075, z: -(W / 2 + 0.004), rotY: Math.PI });
  // Wide intake bank on the intake end: a row of grey wheels on a black ramp plate.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 1, frame: black, rollerMaterial: mat(0x2b2f36, { rough: 0.8 }) });
  const bank = wheelShaft(k.visual, side * (L / 2 - 0.03), bt + 0.05, { n: 8, r: 0.035, w: 0.03, span: W * 0.8, colors: [0x8c939c] });
  box(k.visual, 0.012, 0.09, W * 0.86, black, side * (L / 2 - 0.045), bt + 0.1, 0);
  const d = { v: 0 };
  let hoodAng = 0;
  const pile = hopperStow({ x: hx, y0: bt + 0.03, length: hl * 0.9, width: W * 0.88, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [hx, H - 0.02, 0],
    flow: {
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: pile.stow,
      feed: () => { const lane = [-W * 0.3, 0, W * 0.3][Math.floor(Math.random() * 3)]; return [new THREE.Vector3(hx + hl * 0.2, bt + 0.04 + FUEL_R, lane), new THREE.Vector3(sx - 0.07, bt + 0.05 + FUEL_R, lane), new THREE.Vector3(sx - 0.03, H - 0.14, lane), new THREE.Vector3(sx + 0.03, H - 0.09, lane)]; },
    },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      intake.update(s, latch(d, s));
      spin(bank, -side * (s.enabled && s.intaking ? 22 : 0), s.dt);
      const fs = s.enabled ? 45 + 45 * s.firing : 0;
      for (const r of rolls) spin(r, -fs, s.dt);
      hoodAng = approach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = hoodAng;
    },
  };
});

const cfg = (team: number, model: string, o: Parameters<typeof build>[0], tweak: (c: ReturnType<typeof build>) => void) => {
  const c = build(o);
  c.teamNumber = team;
  c.model = model;
  tweak(c);
  return normalizeRebuiltConfig(c);
};

export function moreRebuiltTeamRobots(): TeamRobot[] {
  return [
    { id: 'roman-6329', team: 6329, name: 'ROMAN',
      description: "6329 Bucks' Wrath (Einstein, Curie alliance with 2056). Turret over a 20.75 in spindexer drum fed by a wide, uninterrupted roller floor, an \"upkicker\" lifting FUEL into the shooter, and a long-armed four-bar intake that folds out of the way on impacts. Capacity, rate and speed are simulator estimates.",
      source: 'Chief Delphi "6329 Bucks\' Wrath Robot Reveal 2026: ROMAN" (reveal Q&A and Roman II CAD release)',
      config: cfg(6329, 'roman-6329', { intake: 'both', aim: 'turret', hopper: 60, tall: false, rate: 14, climb: 0 }, (c) => { c.maxSpeed = 4.6; setRebuiltAccuracy(c, 88); }) },
    { id: 'hailstorm-1778', team: 1778, name: 'HAILSTORM',
      description: '1778 Chill Out. Compact turret over a spindexer with a grip-taped "bottle rocket" cone (copied from 4180) for a tight, steady stream; simple spindexer chosen over a dye rotor. A reliable, consistent mid-high build. Capacity, rate and speed are simulator estimates.',
      source: 'Chief Delphi "1778 2026 CAD & Code Release" (HAILSTORM Q&A: spindexer, bottle-rocket cone, turret encoders)',
      config: cfg(1778, 'hailstorm-1778', { intake: 'both', aim: 'turret', hopper: 45, tall: false, rate: 11, climb: 0 }, (c) => { c.maxSpeed = 4.7; setRebuiltAccuracy(c, 86); }) },
    { id: 'croquembouche-5940', team: 5940, name: 'Croquembouche',
      description: '5940 BREAD. Their pre-DCMP DOUBLE TURRET robot: two independent turrets over a floor conveyor, black net roof. Twice the stream but power-hungry (brownouts, so they rebuilt into a drum shooter for DCMP). Both turrets share one simulated aim. Capacity and rate are estimates.',
      source: 'Chief Delphi "5940 BREAD 2026 Double Turret CAD Release" (Croquembouche, Q&A on brownouts)',
      config: cfg(5940, 'croquembouche-5940', { intake: 'both', aim: 'turret', hopper: 55, tall: false, rate: 16, climb: 0 }, (c) => { c.maxSpeed = 4.3; setRebuiltAccuracy(c, 84); }) },
    { id: 'chunk-7769', team: 7769, name: 'CHUNK',
      description: '7769 The CREW (5 blue banners). Wide static-hood shooter on 4 in stealth wheels, black sponsor-plated polycarb hopper, intake on independently driven racks that slides out and shuffles while firing to prevent jams. Hopper almost 70, mostly 50–60 in play (team). Shoots from the TRENCH without being pushed under. Rate and speed are estimates.',
      source: 'Chief Delphi "FRC 7769 - CAD & Tech Slides : CHUNK" and Q&A',
      config: cfg(7769, 'chunk-7769', { intake: 'both', aim: 'align', dumper: true, hopper: 68, tall: false, rate: 15, climb: 0 }, (c) => { c.maxSpeed = 4.8; setRebuiltAccuracy(c, 84); }) },
    { id: 'triple-threat-9128', team: 9128, name: 'Triple Threat',
      description: '9128 Itkan Robotics (twin of 10340). Three fixed shooter lanes with tubing-wrapped rollers under one static hood, black hex-perforated hopper, wide front intake. About 80 FUEL; 15–16 FUEL/s once the hopper is emptied, 20–25 in the first volley (team). Went undefeated at its first event.',
      source: 'Chief Delphi "Itkan Robotics 2026 Robot Reveal: Triple Threat" (BPS and hopper Q&A)',
      config: cfg(9128, 'triple-threat-9128', { intake: 'both', aim: 'align', dumper: true, hopper: 80, tall: false, rate: 16, climb: 0 }, (c) => { c.launcher.exits = 3; c.maxSpeed = 4.7; setRebuiltAccuracy(c, 82); }) },
  ];
}
