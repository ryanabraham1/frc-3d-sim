import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, battery, box, controller, decal, drivebase, hook, hoodShell, mat, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, underBumperIntake, wheelShaft, wire, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { inch, lb } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

/**
 * Real 2024 CRESCENDO robots (docs/ROBOT-ARCHETYPES.md "Real team robots"). Capabilities come from each team's
 * Chief Delphi reveal / tech binder; numbers the teams didn't publish are marked [EST]. Models are simplified.
 */

/** Flywheels spool up when enabled, peak right after a shot. */
function flywheelSpeed(s: RobotAnimState): number {
  return s.enabled ? 40 + 50 * s.firing : 0;
}

// ── 254 Vortex (photos: team254.com/first/2024, Chief Delphi "2024 VORTEX"): black turret shooter with tall pocketed
//    D-shaped side plates and two pairs of big flywheels out the sides; blue "goalpost" climber uprights at the back
//    with a black truss crossbar and the NASA sponsor panel; blue side rails; black triangular sponsor side panels ──
registerRobotModel('vortex-254', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const black = mat(0x17181b, { metal: 0.35, rough: 0.55 });
  const blue = mat(0x1f5fd0, { metal: 0.6, rough: 0.35 }); // blue anodized tube
  const blueTube = tubeMat(0x1f5fd0);
  const panel = mat(0x0d0e10, { opacity: 0.88, metal: 0.1, rough: 0.3 });
  const wheelM = mat(0x0f0f10, { metal: 0.1, rough: 0.9 });
  const base = drivebase(k, { motorRing: 0x1f5fd0 });
  const intake = underBumperIntake(k, { n: 2 });
  const bx = -L / 2 + 0.035; // goalpost x (back)
  const pz = W / 2 - 0.035;
  // Blue side rails: low at the front corners, rising toward the goalpost; bent down at the front.
  for (const sz of [-1, 1]) {
    bar(k.visual, [L / 2 - 0.03, bt + 0.04, sz * (W / 2 - 0.02)], [bx, bt + 0.17, sz * (W / 2 - 0.02)], 0.022, blueTube);
    bar(k.visual, [L / 2 - 0.03, bt, sz * (W / 2 - 0.02)], [L / 2 - 0.03, bt + 0.04, sz * (W / 2 - 0.02)], 0.022, blueTube);
  }
  // Goalpost: fixed blue outer uprights; the crossbar + truss is the climber hook and rises on inner tubes.
  for (const sz of [-1, 1]) bar(k.visual, [bx, bt, sz * pz], [bx, H - 0.1, sz * pz], 0.03, blueTube);
  const climb = new THREE.Group();
  k.visual.add(climb);
  for (const sz of [-1, 1]) bar(climb, [bx, H - 0.35, sz * pz], [bx, H - 0.02, sz * pz], 0.022, blueTube);
  tube(climb, [bx + 0.01, H - 0.015, -pz - 0.02], [bx + 0.01, H - 0.015, pz + 0.02], 0.016, black);
  bar(climb, [bx + 0.01, H - 0.075, -pz], [bx + 0.01, H - 0.075, pz], 0.014, black);
  for (let i = 0; i < 8; i++) {
    const z0 = -pz + (2 * pz * i) / 8;
    const z1 = -pz + (2 * pz * (i + 1)) / 8;
    bar(climb, [bx + 0.01, i % 2 ? H - 0.075 : H - 0.02, z0], [bx + 0.01, i % 2 ? H - 0.02 : H - 0.075, z1], 0.008, black);
  }
  for (const sz of [-1, 1]) box(climb, 0.06, 0.05, 0.02, black, bx + 0.03, H - 0.03, sz * pz); // hook brackets
  // NASA sponsor panel hanging under the crossbar, leaning back slightly.
  const sponsor = new THREE.Group();
  sponsor.position.set(bx + 0.03, H - 0.09, 0);
  sponsor.rotation.z = 0.12;
  k.visual.add(sponsor);
  const ph = H - bt - 0.2;
  box(sponsor, 0.004, ph, 2 * pz - 0.04, panel, 0, -ph / 2, 0);
  for (const side of [-1, 1]) decal(sponsor, 'NASA', { w: 0.12, h: 0.12, round: true, background: '#1d4fa3', x: side * 0.004, y: -ph * 0.42, rotY: side * Math.PI / 2 });
  // Black triangular sponsor panels on the back corners.
  for (const sz of [-1, 1]) {
    plate(k.visual, [[bx - 0.015, bt], [bx + 0.2, bt], [bx + 0.02, H - 0.12], [bx - 0.015, H - 0.12]], 0.004, black, sz * (W / 2 - 0.012));
    let y = bt + 0.27;
    for (const name of ['AMEX', 'J&J MedTech', 'fabworks']) {
      decal(k.visual, name, { w: 0.07, h: 0.022, x: bx + 0.045, y, z: sz * (W / 2 - 0.008), rotY: sz > 0 ? 0 : Math.PI });
      y -= 0.05;
    }
  }
  // Turret: big black bearing disc; everything above it yaws.
  const t = k.turret;
  const ty = bt + 0.05;
  t.position.set(L * 0.08, ty, 0);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.3, W * 0.3, 0.02, 40), black);
  t.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(W * 0.3, 0.008, 6, 40), k.mats.alu);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.012;
  t.add(ring);
  // Tall pocketed D-shaped side plates.
  const sH = H - ty - 0.03;
  const k2 = sH / 0.42;
  const pts: [number, number][] = [[-0.15, 0], [0.18, 0], [0.25, 0.1], [0.27, 0.27], [0.2, 0.39], [0.04, 0.42], [-0.1, 0.36], [-0.16, 0.2]].map(([x, y]) => [x, y * k2]);
  const holes: [number, number, number][] = [[0.07, 0.19 * k2, 0.075], [-0.07, 0.31 * k2, 0.03], [-0.08, 0.1 * k2, 0.035], [0.19, 0.12 * k2, 0.028]];
  sidePlates(t, pts, 0.09, black, holes, 0.008);
  for (const [x, y] of [[-0.12, 0.05], [0.16, 0.04], [-0.06, 0.38], [0.22, 0.33]] as const) box(t, 0.02, 0.02, 0.19, black, x, y * k2, 0); // standoffs
  // Two axles of big flywheels out both sides at the top front (the quad flywheel shooter).
  const fly: THREE.Group[] = [];
  for (const [x, y] of [[0.13, 0.385], [0.235, 0.29]] as const) {
    tube(t, [x, y * k2, -0.17], [x, y * k2, 0.17], 0.008, k.mats.alu);
    for (const sz of [-1, 1]) fly.push(roller(t, 0.052, 0.06, wheelM, x, y * k2, sz * 0.135));
    fly.push(roller(t, 0.035, 0.17, black, x, y * k2, 0));
  }
  // Feeder rollers inside the plates and the moving hood.
  const feed = [roller(t, 0.025, 0.17, blue, -0.06, 0.12 * k2), roller(t, 0.025, 0.17, blue, 0.04, 0.24 * k2)];
  const hood = pivot(t, 0.2, 0.33 * k2);
  hoodShell(hood, 0.06, 0.17, black);
  const held = pivot(t, 0.02, 0.2 * k2);
  held.rotation.z = 0.7;
  // Amplifier: roller arm on top of the shooter that flips out for the AMP / TRAP.
  const amp = pivot(t, 0.02, 0.43 * k2);
  sidePlates(amp, [[0, -0.012], [0.22, -0.012], [0.22, 0.012], [0, 0.012]], 0.08, black);
  roller(amp, 0.02, 0.16, blue, 0.22, 0);
  let ampAng = 0;
  let hoodAng = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [bx + 0.03, bt + 0.2, 0],
    update(s) {
      base.update(s);
      intake.update(s);
      const fs = flywheelSpeed(s);
      for (const w of fly) spin(w, -fs, s.dt);
      for (const r of feed) spin(r, s.intaking || s.firing > 0 ? -20 : 0, s.dt);
      hoodAng = approach(hoodAng, (s.hood - 0.6) * 0.9, 10, s.dt);
      hood.rotation.z = hoodAng;
      ampAng = approach(ampAng, s.passing || s.climb > 0.2 ? -1.0 : 0, 6, s.dt);
      amp.rotation.z = ampAng;
      climb.position.y = approach(climb.position.y, s.climb * 0.3, 6, s.dt);
    },
  };
});

// ── 1690 Doppler (photos: Chief Delphi reveal, reveal video): an 11 in pancake robot with its electronics laid out
//    open on the deck; a black shooter box on a silver ladder arm that lies flat and swings up to vertical for the
//    AMP / TRAP; two thin black J-hooks for the chain. Intake and shooter share the front (the arm takes the NOTE
//    straight from the intake) ──
registerRobotModel('doppler-1690', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const deckM = mat(0x202328, { metal: 0.5, rough: 0.45 });
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 });
  const silverTube = tubeMat(0xc9ced5);
  const black = mat(0x131416, { metal: 0.3, rough: 0.55 });
  const poly = mat(0xd9e2ea, { opacity: 0.3, metal: 0, rough: 0.15 });
  const base = drivebase(k, { motorRing: 0x3a8dde });
  const intake = underBumperIntake(k, { n: 2 });
  const deckY = bt + 0.006;
  box(k.visual, L * 0.94, 0.006, W * 0.9, deckM, 0, deckY, 0);
  // Electronics laid out on the deck: battery, roboRIO, power distribution, a row of motor controllers, CAN wiring.
  battery(k.visual, -L * 0.3, deckY, -W * 0.22, Math.PI / 2);
  box(k.visual, 0.15, 0.03, 0.1, mat(0x2b2d31), -L * 0.05, deckY + 0.015, W * 0.25);
  box(k.visual, 0.07, 0.004, 0.06, mat(0xe8e8e8), -L * 0.05, deckY + 0.032, W * 0.25);
  box(k.visual, 0.16, 0.035, 0.09, mat(0x8b1d1d, { rough: 0.6 }), -L * 0.06, deckY + 0.018, -W * 0.02);
  for (let i = 0; i < 5; i++) controller(k.visual, L * 0.12 + i * 0.065 - 0.13, deckY, -W * 0.3, [0x39ff6a, 0xff3b3b, 0x39ff6a, 0x3b8bff, 0x39ff6a][i]);
  wire(k.visual, [[-L * 0.06, deckY + 0.03, -W * 0.02], [0, deckY + 0.05, -W * 0.15], [L * 0.1, deckY + 0.03, -W * 0.28]], 0xd4b106);
  wire(k.visual, [[-L * 0.05, deckY + 0.03, W * 0.25], [L * 0.05, deckY + 0.04, W * 0.12], [L * 0.2, deckY + 0.03, -W * 0.25]], 0x2e7d32);
  wire(k.visual, [[-L * 0.3, deckY + 0.2, -W * 0.15], [-L * 0.2, deckY + 0.08, -W * 0.05], [-L * 0.1, deckY + 0.03, -W * 0.02]], 0xc62828, 0.006);
  // Silver ladder arm on gusset towers at the back; lies flat forward, the shooter box at its end over the intake.
  const px = -L / 2 + 0.07;
  const py = H - 0.03;
  for (const sz of [-1, 1]) plate(k.visual, [[px - 0.05, deckY], [px + 0.09, deckY], [px + 0.03, py + 0.025], [px - 0.03, py + 0.025]], 0.006, silver, sz * 0.165, [[px + 0.01, (deckY + py) / 2, 0.015]]);
  tube(k.visual, [px, py, -0.19], [px, py, 0.19], 0.009, silver);
  const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 24), black);
  sprocket.rotation.x = Math.PI / 2;
  sprocket.position.set(px, py, 0.18);
  k.visual.add(sprocket);
  const pv = pivot(k.visual, px, py);
  const armLen = L * 0.62;
  for (const sz of [-1, 1]) bar(pv, [0, 0, sz * 0.14], [armLen, 0, sz * 0.14], 0.022, silverTube);
  for (let i = 1; i <= 5; i++) bar(pv, [armLen * (i / 6), 0, -0.14], [armLen * (i / 6), 0, 0.14], 0.012, silverTube);
  const head = pivot(pv, armLen, 0);
  sidePlates(head, [[-0.06, -0.05], [0.12, -0.05], [0.15, 0.0], [0.12, 0.06], [-0.06, 0.06]], 0.155, black, [[0.0, 0.0, 0.018], [0.07, 0.0, 0.015]]);
  box(head, 0.2, 0.004, 0.3, poly, 0.04, 0.062, 0);
  const wheels = [
    wheelShaft(head, 0.11, 0.025, { n: 4, r: 0.032, w: 0.025, span: 0.24, colors: [0x141414] }),
    wheelShaft(head, 0.11, -0.03, { n: 4, r: 0.026, w: 0.025, span: 0.24, colors: [0x3a3d42] }),
    wheelShaft(head, 0.0, 0.0, { n: 3, r: 0.02, w: 0.02, span: 0.22, colors: [0x2a5bd7] }),
  ];
  const held = pivot(head, 0.04, 0.0);
  // Two thin black J-hooks on telescoping posts.
  const hooks = new THREE.Group();
  k.visual.add(hooks);
  for (const sz of [-1, 1]) {
    tube(k.visual, [-L * 0.08, deckY, sz * (W / 2 - 0.07)], [-L * 0.08, H, sz * (W / 2 - 0.07)], 0.011, black);
    hook(hooks, -L * 0.08, deckY + 0.02, sz * (W / 2 - 0.07), H - deckY + 0.04, black, 1, 0.007);
  }
  let arm = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [-L * 0.3, deckY + 0.24, -W * 0.22],
    update(s) {
      base.update(s);
      intake.update(s);
      // Raises toward the shot elevation while holding a NOTE; straight up for the AMP / TRAP.
      const target = s.passing || s.climb > 0.2 ? 1.5 : s.fill > 0 && s.enabled ? Math.min(1.2, s.hood) : s.firing > 0 ? 0.7 : 0;
      arm = approach(arm, target, 7, s.dt);
      pv.rotation.z = arm;
      head.rotation.z = -arm * 0.5;
      const fs = flywheelSpeed(s);
      wheels[0].rotation.z -= fs * s.dt;
      wheels[1].rotation.z += fs * s.dt;
      wheels[2].rotation.z -= (s.intaking ? 25 : s.firing > 0 ? 30 : 0) * s.dt;
      hooks.position.y = approach(hooks.position.y, s.climb * 0.25, 6, s.dt);
    },
  };
});

// ── 4522 SCREAM AXL (photos: The Blue Alliance 2024 media): raw silver perforated aluminum everywhere, a tall braced
//    elevator, a carriage with four big gray/white flywheels that rises for the AMP / TRAP, one tall climber tube,
//    the electronics open on the bellypan ──
registerRobotModel('axl-4522', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const silver = mat(0xc9ced5, { metal: 0.7, rough: 0.3 });
  const silverTube = tubeMat(0xc9ced5);
  const dark = mat(0x2a2c30, { metal: 0.4 });
  const base = drivebase(k, { motorRing: 0xc9ced5 });
  const intake = underBumperIntake(k, { n: 2 });
  const deckY = bt + 0.006;
  box(k.visual, L * 0.94, 0.006, W * 0.9, mat(0x2c2f34, { metal: 0.5 }), 0, deckY - 0.02, 0);
  // Perforated top rails around the frame + an X brace.
  for (const sz of [-1, 1]) bar(k.visual, [-L / 2 + 0.03, bt + 0.012, sz * (W / 2 - 0.03)], [L / 2 - 0.03, bt + 0.012, sz * (W / 2 - 0.03)], 0.025, silverTube);
  for (const sx of [-1, 1]) bar(k.visual, [sx * (L / 2 - 0.03), bt + 0.012, -W / 2 + 0.03], [sx * (L / 2 - 0.03), bt + 0.012, W / 2 - 0.03], 0.025, silverTube);
  bar(k.visual, [-L / 2 + 0.05, bt + 0.012, -W / 2 + 0.05], [L / 2 - 0.05, bt + 0.012, W / 2 - 0.05], 0.022, silverTube);
  bar(k.visual, [-L / 2 + 0.05, bt + 0.012, W / 2 - 0.05], [L / 2 - 0.05, bt + 0.012, -W / 2 + 0.05], 0.022, silverTube);
  // Electronics open on the bellypan.
  battery(k.visual, -L * 0.3, deckY - 0.02, W * 0.18, Math.PI / 2);
  for (let i = 0; i < 4; i++) controller(k.visual, -L * 0.3 + i * 0.07, deckY - 0.02, -W * 0.3, [0x39ff6a, 0xff3b3b, 0x3b8bff, 0x39ff6a][i], 0xb3261e);
  wire(k.visual, [[-L * 0.3, deckY + 0.02, -W * 0.3], [-L * 0.1, deckY + 0.06, -W * 0.1], [0.05, deckY + 0.02, 0.05]], 0xd4b106);
  // Elevator: perforated 2×1 uprights with a diagonal brace to each front corner and a black belt.
  const ex = -0.03;
  const ez = 0.14;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt, sz * ez], [ex, H - 0.02, sz * ez], 0.032, silverTube);
    bar(k.visual, [L / 2 - 0.05, bt + 0.02, sz * (W / 2 - 0.05)], [ex + 0.02, H * 0.72, sz * ez], 0.02, silverTube);
    plate(k.visual, [[ex - 0.12, bt + 0.01], [ex + 0.03, bt + 0.01], [ex + 0.01, bt + 0.16]], 0.005, silver, sz * (ez + 0.02), [[ex - 0.03, bt + 0.05, 0.015]]);
  }
  bar(k.visual, [ex, H - 0.02, -ez], [ex, H - 0.02, ez], 0.03, silverTube);
  bar(k.visual, [ex + 0.005, bt + 0.05, 0], [ex + 0.005, H - 0.05, 0], 0.012, mat(0x111111, { rough: 0.8 }));
  const stage = new THREE.Group();
  k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex + 0.035, bt + 0.05, sz * (ez - 0.03)], [ex + 0.035, H - 0.06, sz * (ez - 0.03)], 0.026, silverTube);
  bar(stage, [ex + 0.035, H - 0.06, -(ez - 0.03)], [ex + 0.035, H - 0.06, ez - 0.03], 0.022, silverTube);
  // Shooter carriage: pocketed silver side plates, two shafts of big gray/white flywheels.
  const carriage = pivot(k.visual, ex + 0.1, H - 0.12);
  sidePlates(carriage, [[-0.08, -0.09], [0.15, -0.09], [0.21, 0.0], [0.17, 0.11], [-0.08, 0.11]], 0.125, silver, [[-0.03, 0.0, 0.025], [0.05, 0.04, 0.02], [0.05, -0.05, 0.018], [0.13, -0.03, 0.016]]);
  for (const [x, y] of [[-0.06, -0.07], [-0.06, 0.09]] as const) box(carriage, 0.02, 0.02, 0.25, silver, x, y, 0);
  const wheels = [
    wheelShaft(carriage, 0.15, 0.06, { n: 2, r: 0.052, w: 0.045, span: 0.12, colors: [0x8d9299, 0xe8e8e8] }),
    wheelShaft(carriage, 0.1, -0.05, { n: 2, r: 0.052, w: 0.045, span: 0.12, colors: [0xe8e8e8, 0x8d9299] }),
  ];
  const held = pivot(carriage, 0.0, 0.0);
  // One tall perforated climber tube at the front corner, a hook on its sliding inner tube.
  const cx = L / 2 - 0.07;
  const cz = -(W / 2 - 0.09);
  bar(k.visual, [cx, bt, cz], [cx, H - 0.03, cz], 0.04, silverTube);
  const climber = new THREE.Group();
  k.visual.add(climber);
  bar(climber, [cx, H - 0.35, cz], [cx, H + 0.02, cz], 0.028, silverTube);
  hook(climber, cx, H - 0.02, cz, 0.08, dark, -1, 0.009);
  let lift = 0;
  let tilt = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [-L * 0.38, bt + 0.04, -W * 0.2],
    update(s) {
      base.update(s);
      intake.update(s);
      const up = s.passing || s.climb > 0.2;
      lift = approach(lift, up ? inch(14) : 0, 5, s.dt);
      stage.position.y = lift * 0.5;
      carriage.position.y = H - 0.12 + lift;
      // Up for the SPEAKER, pitched down when raised (AMP / TRAP).
      tilt = approach(tilt, up ? -0.6 : (s.hood - 0.6) * 0.6, 8, s.dt);
      carriage.rotation.z = tilt;
      const fs = flywheelSpeed(s);
      wheels[0].rotation.z -= fs * s.dt;
      wheels[1].rotation.z += fs * s.dt;
      climber.position.y = approach(climber.position.y, s.climb * 0.3, 6, s.dt);
    },
  };
});

function teamConfig(team: number, model: string, base: Parameters<typeof build>[0], tweak: (c: ReturnType<typeof build>) => void) {
  const c = build(base);
  c.teamNumber = team;
  c.model = model;
  tweak(c);
  return normalizeCrescendoConfig(c);
}

export function crescendoTeamRobots(): TeamRobot[] {
  return [
    {
      id: 'vortex-254', team: 254, name: 'Vortex',
      description: '254 Cheesy Poofs. Full-width under-bumper intake, NOTES fed around a 360° turret into a quad-flywheel hooded shooter (shoots on the move), "amplifier" arm for the AMP and TRAP, 1 s chain climb. 125 lb.',
      source: '254 2024 Technical Binder; Chief Delphi "Team 254 Presents: 2024 VORTEX"',
      config: teamConfig(254, 'vortex-254', { ground: true, source: true, shooter: 'pivot', aim: 'turret', amp: true, climb: 2 }, (c) => {
        c.mass = lb(125);
        c.maxSpeed = 4.8; // [EST]
      }),
    },
    {
      id: 'doppler-1690', team: 1690, name: 'Doppler',
      description: '1690 Orbit (2024 World Champions). Only 11 in tall: full-width intake, a shoulder arm that lifts the shooter to fire, chassis-aimed with vision intake assist, deployable climb hooks. 5.6 m/s swerve.',
      source: 'Chief Delphi "Orbit 1690 Presents: 2024 robot reveal - Doppler"; 1690 2024 CAD release',
      config: teamConfig(1690, 'doppler-1690', { ground: true, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: 1 }, (c) => {
        c.height = inch(11);
        c.launcher.height = inch(11);
        // Intake under the arm's shooter end: both on the front (an exception to the usual opposite-face layout).
        c.intake.groundSide = 'front';
        c.intake.stationSide = 'front';
        c.maxSpeed = 5.6;
        c.mass = lb(115); // [EST]
      }),
    },
    {
      id: 'axl-4522', team: 4522, name: 'AXL',
      description: '4522 Team SCREAM (2024 World Champions, captain). Under-bumper intake hands off to a shooter on a belt elevator: shoots up into the SPEAKER, rises and shoots down into the AMP and TRAP; winch climber with stabilizer bars.',
      source: 'Chief Delphi "Team SCREAM Open Alliance 4522/4766 build thread 2024"; Onshape "How Team SCREAM Designs Winning Robots"',
      config: teamConfig(4522, 'axl-4522', { ground: true, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: 2 }, (c) => {
        c.height = inch(22); // [EST] compact "tiny bot"
        c.launcher.height = inch(20);
      }),
    },
  ];
}
