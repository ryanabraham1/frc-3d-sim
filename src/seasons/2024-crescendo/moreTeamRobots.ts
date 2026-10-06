import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, drivebase, mat, overRollers, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, underBumperEntry, underBumperIntake, wheelShaft, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { motor } from '@engine/robot/mechanicalDetail';
import { inch, lb } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

/**
 * Three more real 2024 CRESCENDO robots, drawn in the clean flat style of the reference (solid colours, only the
 * parts that carry load). All three put the floor intake under the back bumper and the shooter on a pivoting arm at
 * the front, fed by a short conveyor up the tower, so the arm angle follows `s.hood` like the other pivot robots.
 *
 *  - 1114 Simbotics SKYFALL: red anodized frame, black triangular gusset plates (GM / WCP / GoBeyond), three white
 *    rollers on the arm (TBA / CD reveal photo), hooks that rise from the tower.
 *  - 2910 Jack in the Bot TYPHOON: a TURRET robot (CD tech binder thread: any-angle feed into a turret platter), silver
 *    frame with green brackets, climber gearbox on the frame. The other two use a pivoting shooter arm.
 *  - 581 Blazing Bulldogs TITAN: 25.5 × 28.5 in black frame, tall pocketed black tower, rear shooter pivot and long
 *    hook arms (the CD CAD release write-up and the CAD renders).
 */

const flywheel = (s: RobotAnimState): number => (s.enabled ? 40 + 50 * s.firing : 0);
const armAngle = (s: RobotAnimState, rest: number): number => (s.climb > 0.2 ? 0 : s.passing ? 1.75 : s.enabled && (s.aiming || s.firing > 0) ? s.hood : rest);

// ── 1114 SKYFALL (TBA 2024 photos): a low red wedge with black gusset plates carrying GM / WCP / GoBeyond logos, a black
//    SIMBOT SKYFALL nameplate and white LED strip at the front, a silver pocketed shooter arm with ORANGE wheels, hooks ──
registerRobotModel('skyfall-1114', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const red = mat(0xd2202b, { metal: 0.35, rough: 0.4 }), redTube = tubeMat(0xd2202b), black = mat(0x141518, { metal: 0.3, rough: 0.5 }), white = mat(0xf0f1f3, { rough: 0.55 }), silver = mat(0xc6ccd3, { metal: 0.75, rough: 0.3 });
  const base = drivebase(k, { tube: redTube, motorRing: 0xd2202b });
  const intake = underBumperIntake(k, { n: 3 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, black, 0, bt + 0.004, 0);
  const px = -L * 0.1, py = H - 0.05, tz = W * .3;
  const tri: [number, number][] = [[-L / 2 + 0.05, bt], [L * 0.22, bt], [px + 0.05, py + 0.03], [px - 0.05, py + 0.03]];
  for (const sz of [-1, 1]) {
    // Spectrum row 219 Skyfall 2.0: red triangular frame carrying the pocketed silver shooter.
    // Black sponsor skins retained from the match photos; frame proportions follow the CAD.
    // https://cad.onshape.com/documents/e29d35b669bb6a8cac1e92e8/v/4af41b0ba26263d387049e38/e/ed9bd1dd1db19a55b178226c
    plate(k.visual, tri, 0.007, black, sz * tz);
    bar(k.visual,[tri[0][0],bt,sz*tz],[px,py,sz*tz],.025,redTube);
    bar(k.visual,[tri[1][0],bt,sz*tz],[px,py,sz*tz],.025,redTube);
    const out = sz * (tz + 0.005), rotY = sz > 0 ? 0 : Math.PI;
    decal(k.visual, 'gm', { w: 0.07, h: 0.07, background: '#ffffff', color: '#111111', x: -L * 0.22, y: bt + 0.1, z: out, rotY });
    decal(k.visual, 'WCP', { w: 0.065, h: 0.065, round: true, background: '#ffffff', color: '#111111', x: -L * 0.04, y: bt + 0.16, z: out, rotY });
    decal(k.visual, 'GOBEYOND', { w: 0.11, h: 0.03, background: '#ffffff', color: '#111111', x: L * 0.08, y: bt + 0.07, z: out, rotY });
  }
  decal(k.visual, 'SIMBOT SKYFALL', { w: 0.3, h: 0.06, color: '#ffffff', background: '#141518', x: L / 2 - 0.1, y: bt + 0.09, z: 0, rotY: Math.PI / 2 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.3), mat(0xcfe0ff, { emissive: 0x7fa8ff }));
  led.position.set(L / 2 - 0.095, bt + 0.16, 0); k.visual.add(led);
  for (const x of [-L / 2 + 0.08, L * 0.2]) bar(k.visual, [x, bt + 0.02, -tz], [x, bt + 0.02, tz], 0.025, redTube);
  bar(k.visual, [px, py + 0.02, -tz], [px, py + 0.02, tz], 0.025, redTube); // top cross tube
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, white, -L / 2 + 0.07 + i * 0.05, bt + 0.06 + i * 0.06, 0));
  // Shooter arm: red side rails, white wheel pair at the far end, white feed rollers.
  const arm = pivot(k.visual, px, py);
  const armLen = inch(18);
  sidePlates(arm, [[-0.04, -0.05], [armLen, -0.06], [armLen + 0.04, 0], [armLen, 0.07], [-0.04, 0.05]], tz-.015, silver, [[0.08, 0, 0.022], [0.2, 0, 0.026], [0.3, 0, 0.022]]);
  for (const [x, y] of [[0.0, -0.045], [0.0, 0.04], [armLen - 0.02, -0.055]] as const) box(arm, 0.018, 0.018, (tz-.015)*2, red, x, y, 0);
  const wheels = [wheelShaft(arm, armLen, 0.042, { n: 3, r: inch(2), w: 0.04, span: (tz-.035)*2, colors: [0xff6a2a] }), wheelShaft(arm, armLen, -0.042, { n: 3, r: inch(2), w: 0.04, span: (tz-.035)*2, colors: [0xff6a2a] })];
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

// ── 2910 TYPHOON (CD tech binder thread + TBA 2024 photos): a TURRET robot. A low silver frame with green corner brackets
//    and a black sponsor deck; the NOTE goes under the bumper, up a belly conveyor and is fed from any angle (two entry
//    points, "teacup" rollers) into a turret platter on a bearing ring. On the platter: pocketed silver side plates, a
//    shooter that pitches on its pivot with banks of black wheels, and big black pulleys with chain/belt drive; climber
//    hooks on posts at the front corners. ──
registerRobotModel('typhoon-2910', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const silver = mat(0xc6ccd3, { metal: 0.75, rough: 0.3 }), silverTube = tubeMat(0xc6ccd3), black = mat(0x141518, { metal: 0.3, rough: 0.5 }), red = mat(0xc8242b, { rough: 0.5 }), green = mat(0x2e8f4e, { rough: 0.5 });
  const base = drivebase(k, { tube: silverTube, motorRing: 0x2e8f4e });
  const intake = underBumperIntake(k, { n: 3 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, black, 0, bt + 0.004, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k.visual, 0.07, 0.06, 0.07, green, sx * (L / 2 - 0.06), bt + 0.03, sz * (W / 2 - 0.06));
  // Turret deck: two silver pocketed pods on the frame carry a plate with the bearing ring on top.
  const deckY = bt + 0.15, podX = 0.2, podZ0 = 0.12, podZ1 = W / 2 - 0.04;
  for (const sz of [-1, 1]) {
    for (const x of [-podX, podX]) for (const z of [podZ0, podZ1]) bar(k.visual, [x, bt, sz * z], [x, deckY, sz * z], 0.024, silverTube);
    plate(k.visual, [[-podX, bt], [podX, bt], [podX, deckY], [-podX, deckY]], 0.006, silver, sz * podZ1, [[-0.1, bt + 0.07, 0.02], [0, bt + 0.07, 0.02], [0.1, bt + 0.07, 0.02]]);
  }
  box(k.visual, podX * 2 + 0.03, 0.006, podZ1 * 2, silver, 0, deckY + 0.003, 0);
  for (const sz of [-1, 1]) motor(k.visual, -podX - 0.04, bt + 0.07, sz * 0.1, 0x2a6fe0);
  // Belly conveyor from the back intake up to the turret's feed ("teacup" rollers).
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, black, -L / 2 + 0.07 + i * 0.06, bt + 0.04 + i * 0.03, 0));
  // Turret: everything on the platter yaws with the aim.
  // Spectrum row 250 / 2024 released assembly + TBA pit photo: wide drum, blue hubs, rear goalpost.
  // https://2910.onshape.com/documents/b05af223ad0d2a358074cc0a/v/0769959730f43a1859a1f370/e/9d8b5a55e5c746878f41c2bc
  const shooterHalf = W * .29;
  const t = k.turret;
  t.position.set(0, deckY + 0.006, 0);
  const ringR = inch(6);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.012, 8, 40), green);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; t.add(ring);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(ringR - 0.01, ringR - 0.01, 0.012, 36), silver);
  disc.position.y = 0.022; t.add(disc);
  const hh = H - t.position.y - 0.03;
  const holes: [number, number, number][] = [];
  for (let row = 0, y = 0.05; y < hh - 0.03; row++, y += 0.045) for (let x = -0.09 + (row % 2) * 0.022; x < 0.1; x += 0.045) holes.push([x, y, 0.017]);
  sidePlates(t, [[-0.14, 0.02], [0.13, 0.02], [0.15, hh * 0.5], [0.06, hh], [-0.1, hh - 0.01], [-0.16, hh * 0.45]], shooterHalf + .014, silver, holes, 0.008);
  box(t, 0.02, 0.02, 0.26, silver, -0.1, 0.05, 0);
  const feed = [roller(t, 0.015, 0.2, black, -0.02, 0.07), roller(t, 0.02, 0.2, black, 0.04, 0.12)];
  // Shooter: pitches on a pivot between the plates; banks of black wheels, big black pulleys on the sides.
  const shooter = pivot(t, -0.06, hh - 0.07);
  sidePlates(shooter, [[-0.04, -0.06], [0.2, -0.06], [0.24, 0], [0.2, 0.07], [-0.04, 0.07]], shooterHalf, silver, [[0.08, 0, 0.022]], 0.006);
  const wheels = [
    wheelShaft(shooter, 0.15, 0.033, { n: 4, r: inch(2), w: 0.055, span: shooterHalf * 1.7, colors: [0x49a8ce, 0x23262b, 0x23262b, 0x49a8ce] }),
    wheelShaft(shooter, 0.15, -0.033, { n: 4, r: inch(2), w: 0.055, span: shooterHalf * 1.7, colors: [0x49a8ce, 0x23262b, 0x23262b, 0x49a8ce] }),
  ];
  const pulleys: THREE.Mesh[] = [];
  for (const sz of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 28), black);
    pl.rotation.x = Math.PI / 2; pl.position.set(0.04, 0.0, sz * (shooterHalf + .025)); shooter.add(pl); pulleys.push(pl);
    motor(shooter, 0.12, -0.05, sz * (shooterHalf + .04), 0x2a6fe0);
  }
  box(shooter,.27,.008,shooterHalf*2,silver,.08,.085,0);
  const held = pivot(shooter, 0.06, 0);
  // Climb: two chain hooks on telescoping posts at the front corners.
  const hanger = new THREE.Group();
  k.visual.add(hanger);
  for (const sz of [-1, 1]) {
    const hx = L / 2 - 0.1, hz = sz * (W / 2 - 0.06);
    tube(k.visual, [hx, bt + 0.01, hz], [hx, H - 0.12, hz], 0.024, silver);
    tube(hanger, [hx, H - 0.3, hz], [hx, H - 0.06, hz], 0.01, silver);
    box(hanger, 0.012, 0.07, 0.03, red, hx, H - 0.02, hz);
    box(hanger, 0.05, 0.012, 0.03, red, hx - 0.02, H + 0.015, hz);
  }
  // Joined goalpost above the shooter; its feet remain on the frame and its top follows the climb.
  bar(hanger,[L/2-.1,H+.015,-(W/2-.06)],[L/2-.1,H+.015,W/2-.06],.016,black);
  let tilt = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [podX, deckY + 0.03, -(podZ0 + podZ1) / 2],
    flow: { intake: () => [...underBumperEntry(k, inch(1)), ...overRollers(k, conveyor, 0.03), ...overRollers(k, feed, 0.025)] },
    update(s) {
      base.update(s); intake.update(s);
      tilt = approach(tilt, s.enabled && (s.aiming || s.firing > 0) ? s.hood : 0, 10, s.dt);
      shooter.rotation.z = tilt;
      for (const w of wheels) spin(w, flywheel(s) * (w === wheels[0] ? -1 : 1), s.dt);
      for (const pl of pulleys) pl.rotation.z += flywheel(s) * s.dt * 0.3;
      for (const r of [...conveyor, ...feed]) spin(r, s.intaking || s.firing > 0 ? -22 : 0, s.dt);
      hanger.position.y = approach(hanger.position.y, s.climb > 0.5 ? inch(10) : s.climb > 0.1 ? inch(2) : 0, 10, s.dt);
    },
  };
});

// ── 581 TITAN (TBA 2024 photo): black bumpers, a tall SILVER perforated-tube tower with a diagonal brace, a black TITAN
//    nameplate (Google / fabworks / WCP) at its base, a purple LED strip along the top, grey shooter, long chain hooks ──
registerRobotModel('titan-581', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const black = mat(0x1a1c20, { metal: 0.35, rough: 0.5 }), blackTube = tubeMat(0x24272d), gray = mat(0x8b929b, { metal: 0.6, rough: 0.4 }), red = mat(0xc8242b, { rough: 0.5 });
  const base = drivebase(k, { tube: blackTube, motorRing: 0xc8242b });
  const intake = underBumperIntake(k, { n: 2 });
  box(k.visual, L * 0.94, 0.006, W * 0.9, gray, 0, bt + 0.004, 0);
  // Tall silver tower: two perforated uprights per side with a diagonal brace, nameplate at the base, LED strip on top.
  const px = -L * 0.06, py = H - 0.03, tz = 0.17;
  const silverTube = tubeMat(0xc6ccd3);
  for (const sz of [-1, 1]) {
    bar(k.visual, [px - 0.05, bt, sz * tz], [px - 0.05, py, sz * tz], 0.028, silverTube);
    bar(k.visual, [px + 0.07, bt, sz * tz], [px + 0.07, py, sz * tz], 0.028, silverTube);
    bar(k.visual, [L * 0.22, bt, sz * tz], [px + 0.07, py - 0.08, sz * tz], 0.026, silverTube); // diagonal brace
    bar(k.visual, [px - 0.05, py, sz * tz], [px + 0.07, py, sz * tz], 0.026, silverTube);
    bar(k.visual, [-L / 2 + 0.06, bt + 0.02, sz * tz], [px - 0.05, bt + 0.02, sz * tz], 0.026, silverTube);
    box(k.visual, 0.01, 0.01, 0.01, black, px, py, sz * tz);
  }
  decal(k.visual, 'TITAN', { w: 0.2, h: 0.07, color: '#ffffff', background: '#121315', x: px + 0.04, y: bt + 0.06, z: 0, rotY: 0 });
  decal(k.visual, 'TITAN', { w: 0.2, h: 0.07, color: '#ffffff', background: '#121315', x: px + 0.04, y: bt + 0.06, z: 0, rotY: Math.PI });
  for (const sz of [-1, 1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.012), mat(0xb36bff, { emissive: 0x8a3be0 }));
    led.position.set(px + 0.01, py + 0.02, sz * (tz + 0.01)); k.visual.add(led);
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

// Domotron fallback: silver elevator with yellow hubs and a pitching conveyor,
// measured layout from supplied CAD and 604's TBA 2024 photos. Motion is fitted.
registerRobotModel('domotron-604', (k: ModelKit) => {
  const silver=mat(0xaeb5bd,{metal:.65}), yellow=mat(0xe7ba22), black=mat(0x17191c), W=k.config.frameWidth;
  const base=drivebase(k,{tube:silver}), intake=underBumperIntake(k,{n:4});
  for(const z of [-W*.36,W*.36])bar(k.visual,[.12,.15,z],[.12,.65,z],.025,silver);
  const carriage=new THREE.Group();carriage.position.set(.12,.25,0);k.visual.add(carriage);
  for(const z of [-W*.28,W*.28])bar(carriage,[0,-.1,z],[0,.35,z],.025,silver);
  const head=pivot(carriage,0,0);
  sidePlates(head,[[-.16,-.03],[.22,-.03],[.3,.22],[-.16,.22]],W*.25,silver,[],.006);
  const wheels=[roller(head,.045,W*.5,black,.2,.12),roller(head,.045,W*.5,black,.25,.2)];
  for(const z of [-W*.27,W*.27])box(head,.035,.07,.02,yellow,.2,.12,z);
  return {replaces:['chassis','launcher','intakeRollers','climber'],update(s){base.update(s);intake.update(s);carriage.position.y=.25+(s.passing?.25:0)+s.climb*.18;head.rotation.z=s.aiming?s.hood-.5:0;for(const w of wheels)spin(w,s.enabled?12:0,s.dt);}};
});

// Gold RUSH fallback: yellow braced pivot shooter, rear floor intake (TBA 2024).
// CAD is preferred in browsers; all speeds and actuator timing are estimates.
registerRobotModel('gold-rush-27', (k: ModelKit) => {
  const gold=mat(0xdcb326,{metal:.4}), black=mat(0x151719), L=k.config.frameLength, W=k.config.frameWidth;
  const base=drivebase(k,{tube:gold}), intake=underBumperIntake(k,{n:3});
  for(const z of [-W*.32,W*.32]) {
    bar(k.visual,[-L*.3,.18,z],[.05,.55,z],.025,gold);
    bar(k.visual,[L*.3,.18,z],[.05,.55,z],.025,gold);
  }
  const head=pivot(k.visual,.05,.55);
  sidePlates(head,[[-.18,-.08],[.24,-.08],[.24,.2],[-.18,.2]],W*.25,gold,[],.006);
  for(const x of [-.08,.15])roller(head,.065,W*.5,black,x,.05);
  const climb=pivot(k.visual,-L*.25,.22);
  for(const z of [-W*.38,W*.38])bar(climb,[0,0,z],[.46,0,z],.025,gold);
  return {replaces:['chassis','launcher','intakeRollers','climber'],update(s){base.update(s);intake.update(s);head.rotation.z=s.aiming?s.hood-.3:0;climb.rotation.z=s.climb*1.7;}};
});

const cfg = (team: number, model: string, o: { turret?: boolean; speed: number; accel: number; climb: number; height: number; frame?: [number, number]; intake?: number; mass?: number }, level: 0 | 1 | 2 = 2) => {
  const c = build({ ground: true, source: true, shooter: 'pivot', aim: o.turret ? 'turret' : 'align', amp: true, climb: level });
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
    { id: 'domotron-604', team: 604, name: 'Domotron',
      description: '604 Quixilver. Floor intake, elevator-mounted pitching NOTE launcher and chain climber. Drive speed and mechanism timing are simulator estimates.',
      source: 'User-supplied 2024 FRC604.glb; 604robotics.com 2024 Domotron',
      config: cfg(604, 'domotron-604', { speed: 4.8, accel: 10, climb: 2.2, height: 25, intake: 24, frame: [29.5,29.5] }, 1) },
    { id: 'gold-rush-27', team: 27, name: 'Gold RUSH',
      description: 'Team RUSH. 2024 CRESCENDO robot with a chassis-aimed pivot shooter, floor intake, AMP mechanism and chain climber. Drive performance and timing are simulator estimates.',
      source: 'User-supplied 0000_2024RobotTopLevelAssembly.STEP; Team RUSH 2024 reveal; FIRST 2024 robot name',
      config: cfg(27, 'gold-rush-27', { speed: 4.8, accel: 10, climb: 2.2, height: 25, intake: 24 }, 1) },
    { id: 'skyfall-1114', team: 1114, name: 'Skyfall',
      description: '1114 Simbotics. Low red robot: under-bumper intake into a pivoting shooter arm with white wheels, chassis-aimed, hooks for the chain. Quick and consistent; a mid-weight SPEAKER cycler. Drive, accel and climb time are simulator estimates.',
      source: 'Chief Delphi "Team 1114 - Simbot Skyfall" reveal photo; Team 1114 2024 code release',
      config: cfg(1114, 'skyfall-1114', { speed: 5.0, accel: 10, climb: 1.6, height: 22, intake: 24 }) },
    { id: 'typhoon-2910', team: 2910, name: 'Typhoon',
      description: '2910 Jack in the Bot. Turret robot: notes go under the bumper and are fed from any angle into a turret platter with a pitching shooter, so it shoots on the move; dual hooks. The climb gearbox overloaded its motors (burned one at DCMP), so its climb is slow. Speed, accel and shooter timing are estimates.',
      source: 'Chief Delphi "2910 CAD, Code, and Tech Binder Release 2024" (Typhoon; climber stalling note)',
      config: cfg(2910, 'typhoon-2910', { turret: true, speed: 4.6, accel: 10, climb: 2.4, height: 23, intake: 24 }, 1) },
    { id: 'titan-581', team: 581, name: 'Titan',
      description: '581 Blazing Bulldogs. 25.5 × 28.5 in. Rebuilt in 20 days into a simple, fast cycler: under-bumper intake, centring queuer rollers, pivoting shooter, long hook arms for the chain and TRAP. Drive speed and timings are estimates.',
      source: 'Chief Delphi "581 Blazing Bulldogs 2024 CAD and Code Release" (Titan write-up, 25.5 × 28.5 in frame)',
      config: cfg(581, 'titan-581', { speed: 5.1, accel: 10, climb: 1.5, height: 22, intake: 25, frame: [28.5, 25.5] }) },
  ];
}
