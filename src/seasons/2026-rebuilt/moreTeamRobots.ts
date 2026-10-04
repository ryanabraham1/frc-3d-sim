import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, dyeRotor, decal, deployableIntake, drivebase, fillBlock, flowAt, hopperStow, hopperWalls, jitter, lattice, mat, overBumperIntake, pivot, plate, registerRobotModel, roller, spin, wheelShaft, tubeMat, hoodShell, columnFeed, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { hoodFor, turretShooter } from '@engine/robot/turretShooter';
import { inch } from '@engine/units';
import { motor } from '@engine/robot/mechanicalDetail';
import { slidingHopper } from '@engine/robot/slidingHopper';
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
 *    static hood, twin top intake rollers; 15–16 BPS sustained, 20–25 initial (CD reveal Q&A); capacity 50 [EST], sized like similar compact boxes (254).
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

/** A black net lid: a grid of fine lines across the top of the hopper. */
function netRoof(parent: THREE.Object3D, o: { x: number; y: number; length: number; width: number; nx?: number; nz?: number; color?: number; dome?: number; opening?: { x: number; z: number; radius: number } }): void {
  const pts: number[] = [];
  const nx = o.nx ?? 12, nz = o.nz ?? 10, dome = o.dome ?? 0;
  const h = (u: number, v: number) => o.y + dome * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const seg = 6;
  for (let i = 0; i <= nx; i++) for (let j = 0; j < nz * seg; j++) {
    const u = i / nx, v0 = j / (nz * seg), v1 = (j + 1) / (nz * seg);
    pts.push(o.x - o.length / 2 + u * o.length, h(u, v0), -o.width / 2 + v0 * o.width, o.x - o.length / 2 + u * o.length, h(u, v1), -o.width / 2 + v1 * o.width);
  }
  for (let j = 0; j <= nz; j++) for (let i = 0; i < nx * seg; i++) {
    const v = j / nz, u0 = i / (nx * seg), u1 = (i + 1) / (nx * seg);
    pts.push(o.x - o.length / 2 + u0 * o.length, h(u0, v), -o.width / 2 + v * o.width, o.x - o.length / 2 + u1 * o.length, h(u1, v), -o.width / 2 + v * o.width);
  }
  // Leave clearance around a turret so the net never crosses the moving shooter.
  const positions: number[] = [];
  for (let i = 0; i < pts.length; i += 6) {
    const hole = o.opening;
    if (hole && Math.hypot((pts[i] + pts[i + 3]) / 2 - hole.x, (pts[i + 2] + pts[i + 5]) / 2 - hole.z) < hole.radius) continue;
    positions.push(...pts.slice(i, i + 6));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  parent.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: o.color ?? 0x15171a })));
}

/** Pocketed sheet-metal side plate along the lower part of a long side (a row of lightening holes). */
function sidePlate(parent: THREE.Object3D, o: { x0: number; x1: number; y0: number; y1: number; z: number; m: THREE.Material; holes?: number; r?: number }): void {
  const holes: [number, number, number][] = [];
  const n = o.holes ?? 7, r = o.r ?? 0.02;
  for (let i = 0; i < n; i++) holes.push([o.x0 + ((i + 0.5) / n) * (o.x1 - o.x0), (o.y0 + o.y1) / 2, r]);
  plate(parent, [[o.x0, o.y0], [o.x1, o.y0], [o.x1, o.y1], [o.x0, o.y1]], 0.006, o.m, o.z, holes);
}

/** Hopper wall shell with corner posts and a rim, in a frame colour. */
function shell(k: ModelKit, o: { x?: number; lengthK?: number; widthK?: number; wall: THREE.Material; frame: THREE.Material; top?: number }): { y0: number; h: number; length: number; width: number } {
  const c = k.config, L = c.frameLength, W = c.frameWidth;
  const y0 = c.bumperTop, h = (o.top ?? c.height - 0.03) - y0;
  const length = L * (o.lengthK ?? 0.96), width = W * (o.widthK ?? 0.96);
  hopperWalls(k.visual, { x: o.x ?? 0, y0, length, width, height: h, m: o.wall, frame: o.frame });
  return { y0, h, length, width };
}

// ── 6329 ROMAN (TBA 2026 photos + CAD): a clear polycarbonate box the full width of the frame on SILVER pocketed side
//    plates with purple 3D-printed brackets, a black net lid, a big spindexer drum with the turret over its centre, and
//    a wide roller bank (black rollers with yellow / purple rings) on long four-bar arms that folds up over the top ──
registerRobotModel('roman-6329', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const purple = mat(0x7b4bd6, { metal: 0.25, rough: 0.45 }), steel = tubeMat(0xaeb4bd), steelM = mat(0xaeb4bd, { metal: 0.7, rough: 0.35 }), black = mat(0x17181b, { metal: 0.3, rough: 0.5 });
  const db = drivebase(k, { tube: steel, motorRing: 0x7b4bd6 });
  const sh0 = shell(k, { wall: clearMat(), frame: steel });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  for (const sz of [-1, 1]) {
    sidePlate(k.visual, { x0: -L * 0.46, x1: L * 0.46, y0: bt, y1: bt + 0.17, z: sz * (W * 0.48 + 0.004), m: steelM, holes: 8 });
    for (const x of [-L * 0.3, 0, L * 0.3]) box(k.visual, 0.05, 0.03, 0.02, purple, x, bt + 0.19, sz * (W * 0.48 + 0.01));
    decal(k.visual, '6329', { w: 0.2, h: 0.07, color: '#e8eef8', x: -side * 0.0, y: bt + 0.3, z: sz * (W * 0.48 + 0.006), rotY: sz > 0 ? 0 : Math.PI });
  }
  // Spectrum row 70: Roman I retains the spindexer/turret; Roman II is a different fixed drum shooter.
  // Long triangular pocketed side frames support the clear walls and the four-bar pivots.
  for (const sz of [-1, 1]) {
    lattice(k.visual, [-side * L * 0.43, bt + 0.16, sz * W * 0.47], [side * L * 0.82, 0, 0], [0, H - bt - 0.21, 0], { cells: 4, w: 0.013, m: steelM, zig: true });
  }
  netRoof(k.visual, { x: 0, y: H - 0.02, length: L * 0.96, width: W * 0.96, opening: { x: 0.02, z: 0, radius: 0.2 } });
  // Drum 20.75 in across with a ~6 in centre; the turret stands over its centre.
  const R = inch(20.75) / 2, cx = 0.02;
  const drum = spindexer(k.visual, { x: cx, y0: bt + 0.01, R, wallH: 0.1, coneH: 0.07, plate: black, rib: purple, cone: purple, rim: purple });
  // Roller floor from the intake to the drum: purple rollers, wide and uninterrupted.
  const floorRollers: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) floorRollers.push(roller(k.visual, 0.02, W * 0.9, purple, side * (R + 0.03 + i * 0.05) + cx, bt + 0.03));
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [cx + sx * 0.1, bt + 0.11, sz * 0.1], [cx + sx * 0.1, H - 0.1, sz * 0.1], 0.016, steel); // open tower
  const t = k.turret;
  t.position.set(cx, H - 0.07, 0);
  const sh = turretShooter(t, { width: 0.19, wheel: mat(0x7b4bd6, { rough: 0.5 }), plate: black, accent: purple, height: 0.15, topY: 0.06 });
  const turretRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 8, 32), purple);
  turretRing.rotation.x = Math.PI / 2; turretRing.position.y = -0.015; t.add(turretRing);
  // Four-bar intake: two long silver arms and a black roller bank with yellow / purple rings, folded up over the top.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: steel, stow: Math.PI * 0.92, rollerMaterial: black });
  const slide = slidingHopper(k);
  wheelShaft(intake.tip, 0, 0, { n: 10, r: 0.035, w: 0.02, span: c.intake.width * 0.9, colors: [0x7b4bd6] });
  box(intake.tip, 0.016, 0.075, c.intake.width * 0.65, black, -side * 0.04, 0.065, 0);
  decal(intake.tip, '6329', { w: c.intake.width * 0.6, h: 0.06, x: -side * 0.052, y: 0.065, z: 0, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  const d = { v: 0 };
  let spinRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-side * L * 0.35, H - 0.01, W * 0.38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: columnFeed(k, cx, sh.flywheel, R * 0.8, FUEL_R) },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      { const dv = latch(d, s); intake.update(s, dv); slide.set(dv, s.fill); }
      spinRate = approach(spinRate, !s.enabled ? 0 : s.firing > 0 ? 7 : -1, 6, s.dt);
      spin(drum.floor, spinRate, s.dt, 'y');
      for (const r of floorRollers) spin(r, -side * (s.enabled && (s.intaking || s.firing > 0) ? 18 : 0), s.dt);
      sh.update(s);
    },
  };
});

// ── 1778 HAILSTORM (TBA 2026 photos + CAD): clear polycarbonate box with white etched "CHILL OUT 1778" lettering on
//    a silver frame, a drilled steel rail across the intake end, big silver pocketed intake arms with blue / black
//    rollers, a spindexer with a blue bowl and a grip-taped cone, and a compact turret whose cream-coloured shooter
//    wheel sits at the top ──
registerRobotModel('hailstorm-1778', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const blue = mat(0x2f62d4, { metal: 0.3, rough: 0.45 }), steel = tubeMat(0xb7bdc6), steelM = mat(0xb7bdc6, { metal: 0.7, rough: 0.35 }), black = mat(0x181a1e, { metal: 0.3, rough: 0.5 }), tan = mat(0xcbb98a, { rough: 0.9 });
  const db = drivebase(k, { tube: steel, motorRing: 0x2f62d4 });
  const sh0 = shell(k, { wall: clearMat(), frame: steel });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  // Drilled steel rail across the intake end, with the white etched lettering on the clear sides.
  box(k.visual, 0.03, 0.08, W * 0.94, steelM, side * (L * 0.46), bt + 0.1, 0);
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI, z = sz * (W * 0.48 + 0.006);
    decal(k.visual, 'CHILL OUT 1778', { w: 0.3, h: 0.07, color: '#f4f6fb', x: 0, y: bt + 0.2, z, rotY });
    decal(k.visual, 'HAILSTORM', { w: 0.2, h: 0.03, color: '#f4f6fb', x: -side * L * 0.25, y: H - 0.07, z, rotY });
  }
  // Big spindexer (blue bowl, white fence, grip-taped cone) filling the back of the box; a steel ramp lifts FUEL to the
  // compact turret that stands toward the shooting end, as in the CAD.
  const R = Math.min(L, W) * 0.44, cx = -L * 0.07;
  const drum = spindexer(k.visual, { x: cx, y0: bt + 0.01, R, wallH: 0.1, coneH: 0.16, plate: blue, rib: black, cone: tan, rim: mat(0xf1f1f1, { rough: 0.6 }) });
  const tx = L * 0.27;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bar(k.visual, [tx + sx * 0.1, bt + 0.04, sz * 0.1], [tx + sx * 0.1, H - 0.1, sz * 0.1], 0.016, steel);
  plate(k.visual, [[tx - 0.3, bt + 0.012], [tx - 0.08, bt + 0.012], [tx - 0.08, bt + 0.1]], 0.1, steelM, 0);
  const t = k.turret;
  t.position.set(tx, H - 0.07, 0);
  const sh = turretShooter(t, { width: 0.19, wheel: mat(0xefe6cf, { rough: 0.7 }), plate: black, accent: blue, height: 0.15, topY: 0.06 });
  // Big silver pocketed triangular arm plates on both sides of the intake end.
  for (const sz of [-1, 1]) {
    const e = side * (L / 2);
    plate(k.visual, [[e - side * 0.26, bt], [e + side * 0.0, bt], [e - side * 0.02, bt + 0.26]], 0.008, steelM, sz * (W / 2 - 0.05), [[e - side * 0.1, bt + 0.06, 0.025], [e - side * 0.06, bt + 0.14, 0.02]]);
  }
  // Intake: silver pocketed arms, black rollers with blue rings.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: steel, rollerMaterial: black });
  const slide = slidingHopper(k);
  const d = { v: 0 };
  let spinRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: sh0.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-side * L * 0.38, H - 0.01, W * 0.38],
    flow: {
      intake: overBumperIntake(k, intake.tip, FUEL_R),
      stow: pile.stow,
      // Round the drum rim, up the ramp and into the turret's wheel.
      feed: () => { const a = Math.random() * Math.PI * 2; return [new THREE.Vector3(cx + Math.cos(a) * R * 0.8, bt + 0.04 + FUEL_R, Math.sin(a) * R * 0.8), new THREE.Vector3(tx - 0.12, bt + 0.08 + FUEL_R, 0), flowAt(k, sh.flywheel, -0.06, 0, 0), flowAt(k, sh.flywheel, 0.03, 0.03, 0)]; },
    },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      { const dv = latch(d, s); intake.update(s, dv); slide.set(dv, s.fill); }
      spinRate = approach(spinRate, !s.enabled ? 0 : s.firing > 0 ? 8 : -1.2, 6, s.dt);
      spin(drum.floor, spinRate, s.dt, 'y');
      sh.update(s);
    },
  };
});

// ── 5940 CROQUEMBOUCHE (TBA 2026 photos): black / gunmetal triangulated truss frame, smoked polycarbonate with a yellow
//    tint, a black net roof, two turrets side by side over a floor conveyor and a swing-arm intake with blue plates and
//    green-and-black wheels ──
registerRobotModel('croquembouche-5940', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const gun = mat(0x2c3036, { metal: 0.6, rough: 0.4 }), gunTube = tubeMat(0x2c3036), black = mat(0x17181b, { metal: 0.3, rough: 0.5 }), blue = mat(0x2a63d6, { rough: 0.5 }), yellow = mat(0xe0b020, { rough: 0.5 });
  const db = drivebase(k, { tube: gunTube, motorRing: 0xe0b020 });
  const top = H - 0.03;
  // Smoked yellow-tinted walls with a triangulated truss on each long side (the 5940 hallmark), black corner posts.
  const sh0 = shell(k, { wall: mat(0x6b5a14, { opacity: 0.28, rough: 0.3 }), frame: gunTube, top });
  for (const sz of [-1, 1]) lattice(k.visual, [-L * 0.48, bt + 0.01, sz * (W * 0.48 + 0.004)], [L * 0.96, 0, 0], [0, sh0.h - 0.02, 0], { cells: 7, w: 0.012, m: gun, zig: true });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.92, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  netRoof(k.visual, { x: 0, y: top + 0.012, length: L * 0.96, width: W * 0.96, dome: 0.03 });
  // Two turrets, one over each half of the robot; both follow the single aim.
  const tz = W * 0.25, tx = L * 0.12;
  const turrets: { g: THREE.Group; sh: ReturnType<typeof turretShooter> }[] = [];
  for (const sz of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(tx, H - 0.07, sz * tz);
    k.visual.add(g);
    const sh = turretShooter(g, { width: 0.19, wheel: black, plate: black, accent: yellow, height: 0.15, topY: 0.06 });
    turrets.push({ g, sh });
    for (const sx of [-1, 1]) bar(k.visual, [tx + sx * 0.1, bt, sz * tz + sx * 0.08], [tx + sx * 0.1, H - 0.12, sz * tz + sx * 0.08], 0.018, gunTube);
  }
  // Floor conveyor: black rollers carrying FUEL forward to both turret throats.
  const conv: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) conv.push(roller(k.visual, 0.016, W * 0.9, black, -L * 0.38 + i * L * 0.12, bt + 0.03));
  for (const sz of [-1, 1]) decal(k.visual, 'BREAD', { w: 0.14, h: 0.04, color: '#17181b', background: '#e0b020', x: -L * 0.2, y: bt + 0.07, z: sz * (W / 2 - 0.004), rotY: sz > 0 ? 0 : Math.PI });
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: blue, rollerMaterial: mat(0x35b24a, { rough: 0.6 }) });
  const slide = slidingHopper(k);
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
      { const dv = latch(d, s); intake.update(s, dv); slide.set(dv, s.fill); }
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
  // Spectrum row 82 / Full Robot: open hopper, wide blue twin wheel banks and blue hood plates.
  // https://ostcse.onshape.com/documents/692fc43a78732f76f6a7fc01/w/68c7f5631809df4361fcb808/e/ae1887b4c2531db24673e5e9
  // Racked intake/rear collection, front wide shooter; black sponsor walls; timings remain [EST].
  for(const sign of [-1,1]) bar(k.visual,[hx-hl*.5,H-.03,sign*W*.46],[hx+hl*.5,H-.03,sign*W*.46],.016,black);
  // Wide shooter at the front: base plate, two 4 in stealth-wheel banks, and a static hood (no outer belts).
  const sx = L / 2 - 0.1, wheels: THREE.Group[] = [];
  for (const sz of [-1, 0, 1]) plate(k.visual, [[sx - 0.08, bt], [sx + 0.08, bt], [sx + 0.08, H - 0.12], [sx + 0.02, H - 0.04], [sx - 0.08, H - 0.04]], 0.008, black, sz * W * 0.46);
  box(k.visual, 0.2, 0.012, W * 0.9, black, sx - 0.02, bt + 0.07, 0);
  const stealth = mat(0x2756c9, { rough: 0.55 });
  wheels.push(roller(k.visual, 0.051, W * 0.9, stealth, sx + 0.02, H - 0.1), roller(k.visual, 0.04, W * 0.9, stealth, sx - 0.07, H - 0.07));
  const hood = pivot(k.visual, sx + 0.05, H - 0.07);
  hoodShell(hood, 0.07, W * 0.9, blue);
  // Split blue drum banks, joined by the exposed common shaft.
  for(const sign of [-1,1]) {
    const bank=roller(k.visual,.06,W*.32,blue,sx+.02,H-.1,sign*W*.23);wheels.push(bank);
    motor(k.visual,sx-.04,H-.16,sign*W*.47,0x2756c9);
  }
  // Racked intake that slides out the intake end (independent drives each side).
  const slide = new THREE.Group();
  k.visual.add(slide);
  for (const sz of [-1, 1]) {
    box(slide, 0.4, 0.02, 0.03, steel, side * (L / 2 - 0.14), bt - 0.01, sz * (W / 2 - 0.04));
    box(slide, 0.03, 0.12, 0.03, blue, side * (L / 2 + 0.05), bt + 0.04, sz * (W / 2 - 0.04));
  }
  const rollers = [roller(slide, 0.03, W * 0.84, mat(0x38923f, { rough: 0.55 }), side * (L / 2 + 0.06), bt + 0.0), roller(slide, 0.025, W * 0.84, mat(0x38923f, { rough: 0.55 }), side * (L / 2 + 0.01), bt + 0.05)];
  const hop = slidingHopper(k);
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
      hop.set(out, s.fill);
      for (const r of rollers) spin(r, -side * (s.enabled && (s.intaking || s.firing > 0) ? 24 : 0), s.dt);
      const fs = s.enabled ? 45 + 45 * s.firing : 0;
      for (const w of wheels) spin(w, -fs, s.dt);
      hoodAng = approach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = hoodAng;
    },
  };
});

// ── 9128 TRIPLE THREAT (TBA 2026 photos): a black box with SOLID black side and back panels (hex cut-outs), a domed
//    black hex-pattern net lid, two long black grip-wrapped rollers side by side at the intake end on swing arms, an
//    orange status light, and three fixed shooter lanes with a static hood at the other end ──
registerRobotModel('triple-threat-9128', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const black = mat(0x14161a, { metal: 0.35, rough: 0.5 }), blackTube = tubeMat(0x20242a), gray = mat(0x8c939c, { metal: 0.6, rough: 0.4 });
  const db = drivebase(k, { tube: blackTube, motorRing: 0x2a5be0 });
  const hx = -L * 0.06, hl = L * 0.8;
  const sh0 = shell(k, { x: hx, lengthK: 0.8, wall: mat(0x101215, { opacity: 0.94, rough: 0.5 }), frame: blackTube });
  // Hex cut-outs in the side panels: two staggered rows of dark hexagons.
  const hexMat = mat(0x2a2e35, { rough: 0.6 });
  for (const sz of [-1, 1]) for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 6), hexMat);
    hex.rotation.x = Math.PI / 2;
    hex.position.set(hx - hl * 0.4 + i * (hl * 0.16) + (row ? hl * 0.08 : 0), bt + 0.09 + row * 0.055, sz * (W * 0.48 + 0.006));
    k.visual.add(hex);
  }
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.94, width: W * 0.92, height: sh0.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  netRoof(k.visual, { x: hx, y: H - 0.03, length: hl, width: W * 0.96, nx: 9, nz: 7, dome: 0.045 });
  // Three fixed lanes at the front: dividers, a tubing-wrapped roller per lane and one static hood across all three.
  const sx = L / 2 - 0.09, rolls: THREE.Group[] = [];
  for (const z of [-W * 0.46, -W * 0.15, W * 0.15, W * 0.46]) plate(k.visual, [[sx - 0.09, bt], [sx + 0.08, bt], [sx + 0.08, H - 0.12], [sx + 0.02, H - 0.04], [sx - 0.09, H - 0.04]], 0.008, black, z);
  for (const z of [-W * 0.3, 0, W * 0.3]) rolls.push(roller(k.visual, 0.045, W * 0.26, mat(0x2b2f36, { rough: 0.9 }), sx + 0.01, H - 0.1, z));
  const hood = new THREE.Group();
  hood.position.set(sx + 0.05, H - 0.06, 0);
  k.visual.add(hood);
  hoodShell(hood, 0.05, W * 0.92, gray);
  box(k.visual, 0.24, 0.012, W * 0.9, black, sx - 0.03, bt + 0.07, 0);
  for (const sz of [-1, 1]) decal(k.visual, 'TRIPLE THREAT', { w: 0.3, h: 0.04, color: '#cbd5ee', x: hx, y: bt + 0.2, z: sz * (W / 2 + 0.004), rotY: sz > 0 ? 0 : Math.PI });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), mat(0xff9a1a, { emissive: 0xff7a00 }));
  light.position.set(hx, bt + 0.12, side * (0) + W * 0.2);
  k.visual.add(light);
  // Two long, black foam-wrapped intake rollers side by side on swing arms (the intake is the top roller pair).
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, rollerMaterial: mat(0x1d2025, { rough: 0.95 }) });
  const slide = slidingHopper(k);
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
      { const dv = latch(d, s); intake.update(s, dv); slide.set(dv, s.fill); }
      const fs = s.enabled ? 45 + 45 * s.firing : 0;
      for (const r of rolls) spin(r, -fs, s.dt);
      hoodAng = approach(hoodAng, s.aiming || s.firing > 0 ? 0.15 + hoodFor(s.hood) * 0.8 : -0.25, 5, s.dt);
      hood.rotation.z = hoodAng;
    },
  };
});

// Spectrum CAD Collection row 17: Simbot Tim. Tall clear hopper, orange magic-blanket cover,
// active roller wall and passive side rollers. The competition robot omitted its CAD-only climber.
registerRobotModel('simbot-tim-1114', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const alu = tubeMat(0xbdc4cc), silver = mat(0xbdc4cc, { metal: 0.7 }), black = mat(0x17191c, { rough: 0.8 });
  const red = mat(0xb93628, { rough: 0.65 }), fabric = mat(0xb74925, { rough: 1 });
  const db = drivebase(k, { tube: alu, motorRing: 0xb93628 });
  const hx = side * L * 0.08, hl = L * 0.77, top = H - 0.03;
  const sh = shell(k, { x: hx, lengthK: 0.77, wall: clearMat(), frame: alu, top });
  const fill = fillBlock(k.visual, { x: hx, y0: bt + 0.03, length: hl * 0.95, width: W * 0.9, height: sh.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  for (const sz of [-1, 1]) {
    decal(k.visual, 'SIMBOT TIM', { w: 0.31, h: 0.055, x: hx, y: top - 0.15, z: sz * W * 0.485, rotY: sz > 0 ? 0 : Math.PI });
    decal(k.visual, 'GM   WCP   1114', { w: 0.3, h: 0.055, x: hx, y: bt + 0.12, z: sz * W * 0.485, rotY: sz > 0 ? 0 : Math.PI });
    box(k.visual, 0.12, 0.04, 0.02, red, side * L * 0.35, bt + 0.05, sz * W * 0.46);
  }
  // A lightly sagging fabric cover follows the fuel pile, carried by the hopper's perimeter frame.
  const blanketGeo = new THREE.PlaneGeometry(hl * 0.98, W * 0.95, 12, 12);
  blanketGeo.rotateX(-Math.PI / 2);
  const vertices = blanketGeo.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const u = vertices.getX(i) / (hl * 0.49), v = vertices.getZ(i) / (W * 0.475);
    vertices.setY(i, -0.045 * (1 - u * u) * (1 - v * v));
  }
  blanketGeo.computeVertexNormals();
  const blanket = new THREE.Mesh(blanketGeo, fabric); blanket.position.set(hx, top + 0.008, 0); k.visual.add(blanket);
  const tx = -side * L * 0.35, sy = c.launcher.height;
  const feedRolls: THREE.Group[] = [];
  for (const sz of [-1, 1]) {
    plate(k.visual, [[tx - 0.11, bt], [tx + 0.11, bt], [tx + 0.11, sy + 0.08], [tx - 0.06, sy + 0.1]], 0.008, silver, sz * W * 0.44, [[tx, bt + 0.1, 0.035], [tx, sy - 0.08, 0.025]]);
    motor(k.visual, tx, sy - 0.06, sz * W * 0.46, 0xb93628);
    // Passive side rollers run lengthwise along the two clear walls.
    for (const y of [bt + 0.15, bt + 0.23]) {
      const r = roller(k.visual, 0.018, hl * 0.82, black, hx, y, sz * W * 0.41);
      r.rotation.y = Math.PI / 2;
    }
  }
  for (let i = 0; i < 3; i++) feedRolls.push(roller(k.visual, 0.025, W * 0.82, black, tx + side * 0.06, bt + 0.09 + i * (sy - bt - 0.15) / 2));
  const drum = roller(k.visual, 0.051, W * 0.82, black, tx, sy - 0.025);
  const hood = pivot(k.visual, tx, sy - 0.025); hoodShell(hood, 0.062, W * 0.86, silver);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: red, rollerMaterial: black, stow: Math.PI * 0.85 });
  const slide = slidingHopper(k);
  const d = { v: 0 }, pile = hopperStow({ x: hx, y0: bt + 0.03, length: hl * 0.92, width: W * 0.87, height: sh.h * 0.9, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'], lightAt: [tx, sy + 0.1, W * 0.4],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow,
      feed: () => [new THREE.Vector3(hx, bt + 0.06, 0), new THREE.Vector3(tx + side * 0.06, sy - 0.13, 0), flowAt(k, drum, 0, 0, 0)] },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill); { const dv = latch(d, s); intake.update(s, dv); slide.set(dv, s.fill); }
      const speed = s.enabled && (s.intaking || s.firing > 0) ? 32 : 0;
      for (const r of feedRolls) spin(r, side * speed, s.dt);
      spin(drum, side * (s.enabled ? 45 + s.firing * 30 : 0), s.dt);
      hood.rotation.z = approach(hood.rotation.z, -side * hoodFor(s.hood) * 0.14, 6, s.dt);
    },
  };
});

// Spectrum row 10: Rubble's Champs dumper rebuild, not the earlier dye-rotor turret.
registerRobotModel('rubble-581', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const alu = tubeMat(0xbcc4ce), silver = mat(0xbcc4ce, { metal: 0.7 }), black = mat(0x181b1e, { rough: 0.7 });
  const db = drivebase(k, { tube: alu });
  const sh = shell(k, { wall: mat(0x56616a, { opacity: 0.3 }), frame: alu });
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.025, length: L * 0.9, width: W * 0.9, height: sh.h * 0.9, color: FUEL, capacity: c.hopperCapacity });
  const tx = -side * L * 0.35, sy = c.launcher.height;
  const feeding: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) feeding.push(roller(k.visual, 0.017, W * 0.84, black, side * (L * 0.35 - i * L * 0.12), bt + 0.03 + i * 0.02));
  for (const sz of [-1, 1]) {
    lattice(k.visual, [tx, bt + 0.02, sz * W * 0.44], [0, sy - bt + 0.01, 0], [side * 0.18, 0, 0], { cells: 3, w: 0.015, m: silver, zig: true });
    bar(k.visual, [tx, sy + 0.04, sz * W * 0.44], [side * L * 0.45, H - 0.04, sz * W * 0.44], 0.022, alu);
    decal(k.visual, 'BLAZING BULLDOGS', { w: 0.34, h: 0.035, x: 0, y: bt + 0.12, z: sz * W * 0.485, rotY: sz > 0 ? 0 : Math.PI });
  }
  netRoof(k.visual, { x: 0, y: H - 0.015, length: L * 0.9, width: W * 0.9, dome: 0.01 });
  const drum = roller(k.visual, inch(4) / 2, W * 0.83, black, tx, sy - 0.02);
  const hood = pivot(k.visual, tx, sy - 0.02);
  hoodShell(hood, 0.065, W * 0.86, silver);
  const hoodRolls = [roller(hood, 0.025, W * 0.82, black, side * 0.015, 0.063), roller(hood, 0.025, W * 0.82, black, side * 0.065, 0.015)];
  for (const sz of [-1, 1]) motor(k.visual, tx, sy - 0.08, sz * W * 0.45);
  // Rack-and-pinion intake translates on two straight rails instead of rotating over the hopper.
  const intake = pivot(k.visual, side * L * 0.46, bt - 0.03);
  for (const sz of [-1, 1]) {
    bar(k.visual, [side * L * 0.2, bt - 0.03, sz * W * 0.43], [side * L * 0.47, bt - 0.03, sz * W * 0.43], 0.025, alu);
    plate(intake, [[-side * 0.15, -0.02], [side * 0.13, -0.1], [side * 0.16, -0.02], [-side * 0.15, 0.06]], 0.008, black, sz * W * 0.43);
  }
  const intakeRolls = [roller(intake, 0.038, W * 0.84, black, side * 0.12, -0.1), roller(intake, 0.025, W * 0.84, black, side * 0.05, -0.025)];
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.87, height: sh.h * 0.9, r: FUEL_R });
  const hop = slidingHopper(k);
  let deploy = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'], lightAt: [tx, sy + 0.06, W * 0.4],
    flow: { intake: overBumperIntake(k, intakeRolls[0], FUEL_R), stow: pile.stow,
      feed: () => [new THREE.Vector3(side * L * 0.2, bt + 0.05, 0), new THREE.Vector3(tx + side * 0.08, sy - 0.12, 0), flowAt(k, drum, 0, 0, 0)] },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      deploy = approach(deploy, s.enabled && s.intaking ? 1 : 0, 7, s.dt);
      intake.position.x = side * (L * 0.4 + deploy * c.intake.reach);
      hop.set(deploy, s.fill);
      const speed = s.enabled && (s.intaking || s.firing > 0) ? 30 : 0;
      for (const r of [...feeding, ...intakeRolls]) spin(r, side * speed, s.dt);
      spin(drum, side * (s.enabled ? 50 + s.firing * 35 : 0), s.dt);
      for (const r of hoodRolls) spin(r, -side * speed, s.dt);
      hood.rotation.z = approach(hood.rotation.z, -side * hoodFor(s.hood) * 0.6, 6, s.dt);
    },
  };
});

// ── 604 TOPLOADER (checklist, 2026): TBA photos + the team's CAD/code release post. ARCHETYPE: single-stream TURRET over
//    a dye-rotor "serializer" (~15 BPS in the team's prototype), shoots on the fly; a tall BUMP robot (not trench height),
//    27 in square, no climber mentioned. INTAKE on one end: independent polycarbonate arms with silicone-covered
//    rollers; the sliding hopper extension deploys WITH the intake (surgical-tubing return), like 4414's.
//    LOOK: white laminated corrugated-plastic side walls (a notch cut low at the front), a black rear section and
//    black frame, yellow 3D-printed turret ring and wire guides on top, an orange beacon. Capacity 85 (user-reported 80-90):
//    a tall box whose hopper slides out, so well above a trench-height box. ──
registerRobotModel('toploader-604', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const white = mat(0xf2f4f6, { rough: 0.9 }), black = mat(0x17181b, { metal: 0.3, rough: 0.5 }), blackTube = tubeMat(0x1c1e22), yellow = mat(0xe8c21a, { rough: 0.5 }), clear = mat(0xdde5f0, { opacity: 0.25, rough: 0.2 });
  const db = drivebase(k, { tube: blackTube, motorRing: 0xe8c21a });
  const hopH = H - bt - 0.04;
  // White corrugated side walls with a black rear section at the shooting end.
  hopperWalls(k.visual, { x: 0, y0: bt, length: L * 0.96, width: W * 0.96, height: hopH, m: white, frame: blackTube });
  box(k.visual, L * 0.3, hopH, W * 0.96, black, -side * L * 0.33, bt + hopH / 2, 0);
  const fill = fillBlock(k.visual, { x: 0, y0: bt + 0.03, length: L * 0.9, width: W * 0.9, height: hopH * 0.5, color: FUEL, capacity: c.hopperCapacity });
  // Sliding hopper extension that deploys with the intake.
  const tray = new THREE.Group();
  k.visual.add(tray);
  hopperWalls(tray, { x: side * (L / 2 - 0.12), y0: bt + 0.02, length: 0.24, width: W * 0.9, height: hopH * 0.85, m: white, frame: blackTube });
  // Dye rotor and the inset turret, yellow ring and wire guides on top.
  const rr = Math.min(L, W) * 0.4, cx = L * 0.02;
  const dye = dyeRotor(k.visual, { x: cx, y0: bt + 0.02, R: rr, wallH: 0.09, towerX: cx, towerR: 0.085, towerTop: H - 0.08, plate: black, accent: yellow, motors: 2 });
  const t = k.turret;
  t.position.set(cx, H - 0.07, 0);
  const sh = turretShooter(t, { width: 0.19, wheel: mat(0x2a2d32, { rough: 0.8 }), plate: black, accent: yellow, height: 0.15, topY: 0.06 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 40), yellow);
  ring.rotation.x = Math.PI / 2; ring.position.set(cx, H - 0.025, 0); k.visual.add(ring);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 12), mat(0xff8a1a, { emissive: 0xff6a00 }));
  beacon.position.set(-L * 0.38, H + 0.01, -W * 0.38); k.visual.add(beacon);
  for (const sz of [-1, 1]) decal(k.visual, '604', { w: 0.12, h: 0.07, color: '#17181b', x: -L * 0.05, y: bt + 0.18, z: sz * (W * 0.48 + 0.006), rotY: sz > 0 ? 0 : Math.PI });
  // Intake: independent polycarbonate arms with silicone-covered rollers.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: clear, rollerMaterial: mat(0x1d2025, { rough: 0.95 }) });
  const d = { v: 0 };
  let rotorRate = 0;
  const pile = hopperStow({ x: 0, y0: bt + 0.03, length: L * 0.85, width: W * 0.85, height: hopH * 0.5, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * 0.38, H + 0.03, -W * 0.38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow, feed: () => [...dye.feed(FUEL_R), flowAt(k, sh.flywheel, -0.06, 0, 0), flowAt(k, sh.flywheel, 0.03, 0.03, 0)] },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      const dv = latch(d, s);
      intake.update(s, dv);
      tray.position.x = side * dv * 0.2;
      rotorRate = approach(rotorRate, !s.enabled ? 0 : s.firing > 0 ? 9 : -1.2, 6, s.dt);
      spin(dye.floor, rotorRate, s.dt, 'y');
      for (const r of dye.rollers) spin(r, rotorRate * 4, s.dt, 'y');
      sh.update(s);
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
    { id: 'simbot-tim-1114', team: 1114, name: 'Simbot Tim',
      description: '1114 Simbotics. Tall clear hopper with an orange fabric cover, active roller wall, passive side rollers and a wide drum shooter. Chassis aims; competition climber was removed. Capacity, rate, dimensions and speed are simulator estimates.',
      source: 'Spectrum CAD Collection row 17; Team 1114 Simbot Tim CAD release https://www.chiefdelphi.com/t/522887',
      config: cfg(1114, 'simbot-tim-1114', { intake: 'both', aim: 'align', dumper: true, hopper: 70, tall: true, rate: 18, climb: 0 }, c => { c.maxSpeed = 4.7; setRebuiltAccuracy(c, 90); }) },
    { id: 'rubble-581', team: 581, name: 'Rubble',
      description: '581 Blazing Bulldogs. Champs rebuild: full-width drum and adjustable roller hood, translating rack intake, rising roller floor and smoked hopper with a net roof. Capacity, rate and speed are simulator estimates.',
      source: 'Spectrum CAD Collection row 10; Team 581 CAD and code release https://www.chiefdelphi.com/t/521762',
      config: cfg(581, 'rubble-581', { intake: 'both', aim: 'align', dumper: true, hopper: 55, tall: false, rate: 18, climb: 0 }, c => { c.frameLength = inch(28); c.frameWidth = inch(26.75); /* Effective rectangular footprint of the chamfered CAD frame. */ c.maxSpeed = 4.7; setRebuiltAccuracy(c, 86); }) },
    { id: 'roman-6329', team: 6329, name: 'ROMAN',
      description: "6329 Bucks' Wrath (Einstein, Curie alliance with 2056). Turret over a 20.75 in spindexer drum fed by a wide, uninterrupted roller floor, an \"upkicker\" lifting FUEL into the shooter, and a long-armed four-bar intake that folds out of the way on impacts. Capacity, rate and speed are simulator estimates.",
      source: 'Chief Delphi "6329 Bucks\' Wrath Robot Reveal 2026: ROMAN" (reveal Q&A and Roman II CAD release)',
      config: cfg(6329, 'roman-6329', { intake: 'both', aim: 'turret', hopper: 45, tall: false, rate: 14, climb: 0 }, (c) => { c.maxSpeed = 4.6; setRebuiltAccuracy(c, 88); }) },
    { id: 'hailstorm-1778', team: 1778, name: 'HAILSTORM',
      description: '1778 Chill Out. Compact turret over a spindexer with a grip-taped "bottle rocket" cone (copied from 4180) for a tight, steady stream; simple spindexer chosen over a dye rotor. A reliable, consistent mid-high build. Capacity, rate and speed are simulator estimates.',
      source: 'Chief Delphi "1778 2026 CAD & Code Release" (HAILSTORM Q&A: spindexer, bottle-rocket cone, turret encoders)',
      config: cfg(1778, 'hailstorm-1778', { intake: 'both', aim: 'turret', hopper: 40, tall: false, rate: 11, climb: 0 }, (c) => { c.maxSpeed = 4.7; setRebuiltAccuracy(c, 86); }) },
    { id: 'croquembouche-5940', team: 5940, name: 'Croquembouche',
      description: '5940 BREAD. Their pre-DCMP DOUBLE TURRET robot: two independent turrets over a floor conveyor, black net roof. Twice the stream but power-hungry (brownouts, so they rebuilt into a drum shooter for DCMP). Both turrets share one simulated aim. Holds only about 30 FUEL (user-reported); rate is an estimate.',
      source: 'Chief Delphi "5940 BREAD 2026 Double Turret CAD Release" (Croquembouche, Q&A on brownouts)',
      config: cfg(5940, 'croquembouche-5940', { intake: 'both', aim: 'turret', hopper: 30, tall: false, rate: 16, climb: 0 }, (c) => { c.maxSpeed = 4.3; setRebuiltAccuracy(c, 84); }) },
    { id: 'chunk-7769', team: 7769, name: 'CHUNK',
      description: '7769 The CREW (5 blue banners). Wide static-hood shooter on 4 in stealth wheels, black sponsor-plated polycarb hopper, intake on independently driven racks that slides out and shuffles while firing to prevent jams. Under-trench box, so it holds about 45 FUEL [EST; the team quotes almost 70, but a non-expanding trench-height hopper holds far less]. Shoots from the TRENCH without being pushed under. Rate and speed are estimates.',
      source: 'Chief Delphi "FRC 7769 - CAD & Tech Slides : CHUNK" and Q&A',
      config: cfg(7769, 'chunk-7769', { intake: 'both', aim: 'align', dumper: true, hopper: 45, tall: false, rate: 15, climb: 0 }, (c) => { c.maxSpeed = 4.8; setRebuiltAccuracy(c, 84); }) },
    { id: 'triple-threat-9128', team: 9128, name: 'Triple Threat',
      description: '9128 Itkan Robotics (twin of 10340). Three fixed shooter lanes with tubing-wrapped rollers under one static hood, black hex-perforated hopper, twin top intake rollers. Compact trench-height box, so about 40 FUEL [EST: the quoted ~80 does not fit; a non-expanding trench-height box holds roughly 40]; 15–16 FUEL/s once the hopper is emptied, 20–25 in the first volley (team). Went undefeated at its first event.',
      source: 'Chief Delphi "Itkan Robotics 2026 Robot Reveal: Triple Threat" (BPS and hopper Q&A)',
      config: cfg(9128, 'triple-threat-9128', { intake: 'both', aim: 'align', dumper: true, hopper: 40, tall: false, rate: 16, climb: 0 }, (c) => { c.launcher.exits = 3; c.maxSpeed = 4.7; setRebuiltAccuracy(c, 82); }) },
    { id: 'toploader-604', team: 604, name: 'Toploader',
      description: '604 Quixilver. A tall BUMP robot (27 in square) with a single-stream turret over a dye rotor ("serializer": about 15 FUEL/s in the team prototype, chosen over a 23/s full-width shooter so it can feed and score on the move), white corrugated-plastic walls, and a hopper that slides out with the intake. One-driver automated scoring. Holds 80-90 FUEL (user-reported, tall box with a sliding hopper; simulator uses 85). Speed is a simulator estimate.',
      source: 'Chief Delphi "Team 604 Quixilver - 2026 Robot CAD and Code Release" (Toploader); The Blue Alliance 2026 photos',
      config: cfg(604, 'toploader-604', { intake: 'both', aim: 'turret', hopper: 85, tall: true, rate: 14, climb: 0 }, (c) => { c.frameLength = c.frameWidth = inch(27); c.maxSpeed = 4.5; setRebuiltAccuracy(c, 88); }) },
  ];
}
