import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, drivebase, mat, overRollers, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, underBumperEntry, underBumperIntake, wheelShaft, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { inch, lb } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

/**
 * Three more real 2024 CRESCENDO robots, drawn in the clean flat style of the reference (solid colours, only the
 * parts that carry load). All three put the floor intake under the back bumper and the shooter on a pivoting arm at
 * the front, fed by a short conveyor up the tower, so the arm angle follows `s.hood` like the other pivot robots.
 *
 *  - 1114 Simbotics SKYFALL: red anodized frame, black triangular gusset plates (GM / WCP / GoBeyond), three white
 *    rollers on the arm (TBA / CD reveal photo), hooks that rise from the tower.
 *  - 2910 Jack in the Bot TYPHOON: red bumpers, silver truss tower, big sprocket-and-chain shooter with a bank of black
 *    wheels, climber gearbox on the frame (CD tech binder release post; photo of the chain-driven shooter).
 *  - 581 Blazing Bulldogs TITAN: 25.5 × 28.5 in black frame, tall pocketed black tower, rear shooter pivot and long
 *    hook arms (the CD CAD release write-up and the CAD renders).
 */

const flywheel = (s: RobotAnimState): number => (s.enabled ? 40 + 50 * s.firing : 0);
const armAngle = (s: RobotAnimState, rest: number): number => (s.climb > 0.2 ? 0 : s.passing ? 1.75 : s.fill > 0 && s.enabled ? Math.min(1.1, s.hood) : s.firing > 0 ? s.hood : rest);

// ── 1114 SKYFALL ──
registerRobotModel('skyfall-1114', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const red = mat(0xd2202b, { metal: 0.35, rough: 0.4 }), redTube = tubeMat(0xd2202b), black = mat(0x141518, { metal: 0.3, rough: 0.5 }), white = mat(0xf0f1f3, { rough: 0.55 }), silver = mat(0xc6ccd3, { metal: 0.75, rough: 0.3 });
  const base = drivebase(k, { tube: redTube, motorRing: 0xd2202b });
  const intake = underBumperIntake(k, { n: 3 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, black, 0, bt + 0.004, 0);
  const px = -L * 0.1, py = H - 0.05, tz = 0.17;
  const tri: [number, number][] = [[-L / 2 + 0.05, bt], [L * 0.22, bt], [px + 0.05, py + 0.03], [px - 0.05, py + 0.03]];
  for (const sz of [-1, 1]) {
    plate(k.visual, tri, 0.007, black, sz * tz);
    const out = sz * (tz + 0.005), rotY = sz > 0 ? 0 : Math.PI;
    decal(k.visual, 'gm', { w: 0.07, h: 0.07, background: '#ffffff', color: '#111111', x: -L * 0.22, y: bt + 0.1, z: out, rotY });
    decal(k.visual, 'WCP', { w: 0.065, h: 0.065, round: true, background: '#ffffff', color: '#111111', x: -L * 0.04, y: bt + 0.16, z: out, rotY });
    decal(k.visual, 'GOBEYOND', { w: 0.11, h: 0.03, background: '#ffffff', color: '#111111', x: L * 0.08, y: bt + 0.07, z: out, rotY });
  }
  for (const x of [-L / 2 + 0.08, L * 0.2]) bar(k.visual, [x, bt + 0.02, -tz], [x, bt + 0.02, tz], 0.025, redTube);
  bar(k.visual, [px, py + 0.02, -tz], [px, py + 0.02, tz], 0.025, redTube); // top cross tube
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, white, -L / 2 + 0.07 + i * 0.05, bt + 0.06 + i * 0.06, 0));
  // Shooter arm: red side rails, white wheel pair at the far end, white feed rollers.
  const arm = pivot(k.visual, px, py);
  const armLen = inch(18);
  sidePlates(arm, [[-0.04, -0.05], [armLen, -0.06], [armLen + 0.04, 0], [armLen, 0.07], [-0.04, 0.05]], 0.15, red, [[0.08, 0, 0.022], [0.2, 0, 0.026]]);
  for (const [x, y] of [[0.0, -0.045], [0.0, 0.04], [armLen - 0.02, -0.055]] as const) box(arm, 0.018, 0.018, 0.3, red, x, y, 0);
  const wheels = [wheelShaft(arm, armLen, 0.042, { n: 3, r: inch(2), w: 0.04, span: 0.24, colors: [0xf0f1f3] }), wheelShaft(arm, armLen, -0.042, { n: 3, r: inch(2), w: 0.04, span: 0.24, colors: [0xf0f1f3] })];
  const feed = [roller(arm, 0.0127, 0.28, white, 0.08, 0), roller(arm, 0.0127, 0.28, white, 0.2, 0)];
  const held = pivot(arm, 0.18, 0);
  // Hooks: two silver posts on the tower with red hook heads that rise to the chain.
  const hx = L * 0.1, hanger = new THREE.Group();
  k.visual.add(hanger);
  for (const sz of [-1, 1]) {
    tube(k.visual, [hx, bt + 0.01, sz * 0.06], [hx, H - 0.1, sz * 0.06], 0.022, silver);
    tube(hanger, [hx, H - 0.28, sz * 0.06], [hx, H - 0.04, sz * 0.06], 0.009, silver);
    box(hanger, 0.012, 0.07, 0.03, red, hx, H + 0.0, sz * 0.06);
    box(hanger, 0.05, 0.012, 0.03, red, hx - 0.02, H + 0.035, sz * 0.06);
  }
  let ang = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [px, py + 0.06, 0],
    flow: { intake: () => [...underBumperEntry(k, inch(1)), ...overRollers(k, conveyor, 0.03), ...overRollers(k, feed, 0.02)] },
    update(s) {
      base.update(s); intake.update(s);
      ang = approach(ang, armAngle(s, 0.12), 8, s.dt);
      arm.rotation.z = ang;
      for (const w of wheels) spin(w, flywheel(s) * (w === wheels[0] ? -1 : 1), s.dt);
      for (const r of [...conveyor, ...feed]) spin(r, s.intaking || s.firing > 0 ? -22 : 0, s.dt);
      hanger.position.y = approach(hanger.position.y, s.climb > 0.5 ? inch(10) : s.climb > 0.1 ? inch(2) : 0, 10, s.dt);
    },
  };
});

// ── 2910 TYPHOON ──
registerRobotModel('typhoon-2910', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const silver = mat(0xc6ccd3, { metal: 0.75, rough: 0.3 }), silverTube = tubeMat(0xc6ccd3), black = mat(0x141518, { metal: 0.3, rough: 0.5 }), red = mat(0xc8242b, { rough: 0.5 });
  const base = drivebase(k, { tube: silverTube, motorRing: 0xc8242b });
  const intake = underBumperIntake(k, { n: 3 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, black, 0, bt + 0.004, 0);
  // Silver pocketed tower plates rising to the shooter axle (a clean stand-in for the photo's chain tower).
  const px = -L * 0.08, py = H - 0.04, tz = 0.18;
  const tri: [number, number][] = [[-L / 2 + 0.06, bt], [L * 0.24, bt], [px + 0.06, py + 0.03], [px - 0.06, py + 0.03]];
  const holes: [number, number, number][] = [];
  for (let row = 0, y = bt + 0.07; y < py - 0.06; row++, y += 0.055) {
    const f = (y - bt) / (py - bt), xmin = -L / 2 + 0.06 + (px - 0.06 + L / 2 - 0.06) * f, xmax = L * 0.24 + (px + 0.06 - L * 0.24) * f;
    for (let x = xmin + 0.06 + (row % 2) * 0.03; x < xmax - 0.05; x += 0.06) holes.push([x, y, 0.017]);
  }
  for (const sz of [-1, 1]) plate(k.visual, tri, 0.007, silver, sz * tz, holes);
  for (const x of [-L / 2 + 0.06, L * 0.24]) bar(k.visual, [x, bt + 0.02, -tz], [x, bt + 0.02, tz], 0.025, silverTube);
  bar(k.visual, [px, py + 0.02, -tz], [px, py + 0.02, tz], 0.025, silverTube);
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, black, -L / 2 + 0.07 + i * 0.05, bt + 0.06 + i * 0.065, 0));
  // Shooter on a pivot arm: a bank of four black wheels each side, driven by big sprockets and a chain.
  const arm = pivot(k.visual, px, py);
  const armLen = inch(17);
  sidePlates(arm, [[-0.04, -0.06], [armLen, -0.07], [armLen + 0.05, 0], [armLen, 0.07], [-0.04, 0.05]], 0.15, silver, [[0.07, 0, 0.025], [0.17, 0, 0.03], [0.27, 0, 0.025]]);
  for (const [x, y] of [[0.0, -0.05], [0.0, 0.04], [armLen - 0.02, -0.06]] as const) box(arm, 0.018, 0.018, 0.3, silver, x, y, 0);
  const wheels = [wheelShaft(arm, armLen, 0.044, { n: 4, r: inch(2), w: 0.03, span: 0.26, colors: [0x23262b] }), wheelShaft(arm, armLen, -0.044, { n: 4, r: inch(2), w: 0.03, span: 0.26, colors: [0x23262b] })];
  const sprockets: THREE.Mesh[] = [];
  for (const sz of [-1, 1]) for (const [x, y, r] of [[armLen, 0.044, 0.04], [armLen - 0.09, -0.044, 0.04]] as const) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.008, 22), silver);
    sp.rotation.x = Math.PI / 2; sp.position.set(x, y, sz * 0.158); arm.add(sp); sprockets.push(sp);
  }
  const feed = [roller(arm, 0.0127, 0.28, black, 0.08, 0), roller(arm, 0.0127, 0.28, black, 0.2, 0)];
  const held = pivot(arm, 0.18, 0);
  // Climb: two chain hooks on telescoping green posts at the front corners.
  const hanger = new THREE.Group();
  k.visual.add(hanger);
  for (const sz of [-1, 1]) {
    const hx = L / 2 - 0.1, hz = sz * (W / 2 - 0.06);
    tube(k.visual, [hx, bt + 0.01, hz], [hx, H - 0.1, hz], 0.024, silver);
    tube(hanger, [hx, H - 0.3, hz], [hx, H - 0.04, hz], 0.01, silver);
    box(hanger, 0.012, 0.07, 0.03, red, hx, H, hz);
    box(hanger, 0.05, 0.012, 0.03, red, hx - 0.02, H + 0.035, hz);
  }
  let ang = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [px, py + 0.06, 0],
    flow: { intake: () => [...underBumperEntry(k, inch(1)), ...overRollers(k, conveyor, 0.03), ...overRollers(k, feed, 0.02)] },
    update(s) {
      base.update(s); intake.update(s);
      ang = approach(ang, armAngle(s, 0.15), 8, s.dt);
      arm.rotation.z = ang;
      for (const w of wheels) spin(w, flywheel(s) * (w === wheels[0] ? -1 : 1), s.dt);
      for (const sp of sprockets) sp.rotation.y += flywheel(s) * s.dt * 0.4;
      for (const r of [...conveyor, ...feed]) spin(r, s.intaking || s.firing > 0 ? -22 : 0, s.dt);
      hanger.position.y = approach(hanger.position.y, s.climb > 0.5 ? inch(10) : s.climb > 0.1 ? inch(2) : 0, 10, s.dt);
    },
  };
});

// ── 581 TITAN ──
registerRobotModel('titan-581', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const black = mat(0x1a1c20, { metal: 0.35, rough: 0.5 }), blackTube = tubeMat(0x24272d), gray = mat(0x8b929b, { metal: 0.6, rough: 0.4 }), red = mat(0xc8242b, { rough: 0.5 });
  const base = drivebase(k, { tube: blackTube, motorRing: 0xc8242b });
  const intake = underBumperIntake(k, { n: 2 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, gray, 0, bt + 0.004, 0);
  // Tall pocketed black tower plates with a lightening-hole pattern, the shooter pivot near the top at the back.
  const px = -L * 0.06, py = H - 0.03, tz = 0.17;
  const tri: [number, number][] = [[-L / 2 + 0.05, bt], [L * 0.24, bt], [px + 0.06, py + 0.02], [px - 0.06, py + 0.02]];
  const holes: [number, number, number][] = [];
  for (let row = 0, y = bt + 0.07; y < py - 0.06; row++, y += 0.05) {
    const f = (y - bt) / (py - bt), xmin = -L / 2 + 0.05 + (px - 0.05 + L / 2 - 0.05) * f, xmax = L * 0.24 + (px + 0.05 - L * 0.24) * f;
    for (let x = xmin + 0.06 + (row % 2) * 0.03; x < xmax - 0.05; x += 0.06) holes.push([x, y, 0.015]);
  }
  for (const sz of [-1, 1]) {
    plate(k.visual, tri, 0.007, black, sz * tz, holes);
    decal(k.visual, '581', { w: 0.08, h: 0.05, background: '#c8242b', color: '#ffffff', x: -L * 0.2, y: bt + 0.06, z: sz * (tz + 0.005), rotY: sz > 0 ? 0 : Math.PI });
  }
  for (const x of [-L / 2 + 0.08, L * 0.22]) bar(k.visual, [x, bt + 0.02, -tz], [x, bt + 0.02, tz], 0.025, blackTube);
  bar(k.visual, [px, py + 0.02, -tz], [px, py + 0.02, tz], 0.025, blackTube);
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, red, -L / 2 + 0.07 + i * 0.05, bt + 0.06 + i * 0.065, 0));
  const arm = pivot(k.visual, px, py);
  const armLen = inch(16);
  sidePlates(arm, [[-0.04, -0.06], [armLen, -0.07], [armLen + 0.04, 0], [armLen, 0.07], [-0.04, 0.05]], 0.15, gray, [[0.08, 0, 0.025], [0.2, 0, 0.03]]);
  for (const [x, y] of [[0.0, -0.05], [0.0, 0.04], [armLen - 0.02, -0.06]] as const) box(arm, 0.018, 0.018, 0.3, gray, x, y, 0);
  // Queuer rollers centre the NOTE with pulsed voltage, then two compliant flywheel pairs.
  const wheels = [wheelShaft(arm, armLen, 0.042, { n: 3, r: inch(2), w: 0.04, span: 0.24, colors: [0xc8242b] }), wheelShaft(arm, armLen, -0.042, { n: 3, r: inch(2), w: 0.04, span: 0.24, colors: [0xc8242b] })];
  const feed = [roller(arm, 0.02, 0.28, mat(0xe8e8ea, { rough: 0.7 }), 0.08, 0), roller(arm, 0.02, 0.28, mat(0xe8e8ea, { rough: 0.7 }), 0.2, 0)];
  const held = pivot(arm, 0.18, 0);
  // Long climbing hooks: black tube arms pivoting on the tower sides, hooks at the ends, rise to the chain.
  const hookArms: THREE.Group[] = [];
  for (const sz of [-1, 1]) {
    const z = sz * (tz + 0.03);
    const a = pivot(k.visual, -L * 0.2, bt + 0.05, z);
    bar(a, [0, 0, 0], [L * 0.45, 0.0, 0], 0.024, blackTube);
    box(a, 0.012, 0.07, 0.03, red, L * 0.45, 0.03, 0);
    box(a, 0.05, 0.012, 0.03, red, L * 0.45 - 0.02, 0.065, 0);
    hookArms.push(a);
  }
  let ang = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [px, py + 0.06, 0],
    flow: { intake: () => [...underBumperEntry(k, inch(1)), ...overRollers(k, conveyor, 0.03), ...overRollers(k, feed, 0.02)] },
    update(s) {
      base.update(s); intake.update(s);
      ang = approach(ang, armAngle(s, 0.12), 8, s.dt);
      arm.rotation.z = ang;
      for (const w of wheels) spin(w, flywheel(s) * (w === wheels[0] ? -1 : 1), s.dt);
      for (const r of [...conveyor, ...feed]) spin(r, s.intaking || s.firing > 0 ? -22 : 0, s.dt);
      // Hooks lie along the frame, then swing up to reach the chain.
      for (const a of hookArms) a.rotation.z = approach(a.rotation.z, s.climb > 0.5 ? 1.15 : s.climb > 0.1 ? 0.5 : 0.0, 5, s.dt);
    },
  };
});

const cfg = (team: number, model: string, o: { speed: number; accel: number; climb: number; height: number; frame?: [number, number]; intake?: number; mass?: number }, level: 0 | 1 | 2 = 2) => {
  const c = build({ ground: true, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: level });
  c.teamNumber = team; c.model = model; c.maxSpeed = o.speed; c.maxAccel = o.accel;
  c.height = inch(o.height); c.launcher.height = inch(o.height - 2);
  if (o.intake) c.intake.width = inch(o.intake);
  if (o.frame) { c.frameLength = inch(o.frame[0]); c.frameWidth = inch(o.frame[1]); }
  if (o.mass) c.mass = lb(o.mass);
  c.climber.secondsPerLevel = o.climb;
  return normalizeCrescendoConfig(c);
};

export function moreCrescendoTeamRobots(): TeamRobot[] {
  return [
    { id: 'skyfall-1114', team: 1114, name: 'Skyfall',
      description: '1114 Simbotics. Low red robot: under-bumper intake into a pivoting shooter arm with white wheels, chassis-aimed, hooks for the chain. Quick and consistent; a mid-weight SPEAKER cycler. Drive, accel and climb time are simulator estimates.',
      source: 'Chief Delphi "Team 1114 - Simbot Skyfall" reveal photo; Team 1114 2024 code release',
      config: cfg(1114, 'skyfall-1114', { speed: 5.0, accel: 10, climb: 1.6, height: 22, intake: 24 }) },
    { id: 'typhoon-2910', team: 2910, name: 'Typhoon',
      description: '2910 Jack in the Bot. Chain-and-sprocket shooter on a silver truss tower, eight black flywheels, under-bumper intake, dual hooks. The climb gearbox overloaded its motors (burned one at DCMP), so its climb is slow. Speed, accel and shooter timing are estimates.',
      source: 'Chief Delphi "2910 CAD, Code, and Tech Binder Release 2024" (Typhoon; climber stalling note)',
      config: cfg(2910, 'typhoon-2910', { speed: 4.9, accel: 10, climb: 2.4, height: 23, intake: 24 }, 1) },
    { id: 'titan-581', team: 581, name: 'Titan',
      description: '581 Blazing Bulldogs. 25.5 × 28.5 in. Rebuilt in 20 days into a simple, fast cycler: under-bumper intake, centring queuer rollers, pivoting shooter, long hook arms for the chain and TRAP. Drive speed and timings are estimates.',
      source: 'Chief Delphi "581 Blazing Bulldogs 2024 CAD and Code Release" (Titan write-up, 25.5 × 28.5 in frame)',
      config: cfg(581, 'titan-581', { speed: 5.1, accel: 10, climb: 1.5, height: 22, intake: 25, frame: [28.5, 25.5] }) },
  ];
}
