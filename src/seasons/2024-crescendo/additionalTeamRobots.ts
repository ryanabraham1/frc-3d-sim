import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, controller, decal, drivebase, hook, lattice, link, mat, pivot, plate, pointIn, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, underBumperIntake, wheelShaft, wire, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { belt, camera, motor } from '@engine/robot/mechanicalDetail';
import { inch } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

/** Flywheels spool up when enabled, peak right after a shot. */
const flywheel = (s: RobotAnimState): number => (s.enabled ? 40 + 50 * s.firing : 0);

// ── 118 Robonauts TWISTER (2024 Twister Technical Binder, Chief Delphi CAD release; TBA 2024 photos): 27 × 27 in gold
//    box-tube frame, dual-sided roller dust-pan intake that lifts the NOTE straight up through the open belly into a
//    turret on an 11 in ring centered in the robot. Electronics "pods" (PDH, roboRIO, CANivore) sit on both sides of
//    the turret and carry its mounting plate. On the turret: white pocketed truss side plates, a leadscrew-pitched
//    shooter with eight 2 in wheels, and a gold truss diverter arm for the AMP / TRAP on top. Climb: gold truss "chain
//    arms" with red hooks folded down along both sides, and "skis" (truss towers with wheels) at the back corners. ──
registerRobotModel('twister-118', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const goldTube = tubeMat(0xc9962b), gold = mat(0xc9962b, { metal: 0.65, rough: 0.35 });
  const white = mat(0xeef0f2, { metal: 0.1, rough: 0.5 }), red = mat(0xc8242b, { rough: 0.5 });
  const black = mat(0x16171a, { metal: 0.3, rough: 0.6 }), gray = mat(0x8d9299, { metal: 0.5 });
  const db = drivebase(k, { tube: goldTube, motorRing: 0xc9962b, crossRails: [] });
  const intake = underBumperIntake(k, { n: 2, width: c.intake.width });
  // The other half of the dual-sided dust pan (front): a 1.25 in silicone roller under the bumper and white guides.
  // [The simulator captures NOTES on the back mouth only.]
  const front = k.groundSide === 1 ? -1 : 1;
  const frontRoller = roller(k.visual, 0.016, c.intake.width, gray, front * (k.fp.length / 2 + 0.015), 0.06);
  for (const sz of [-1, 1]) plate(k.visual, [[front * (L / 2 - 0.12), bt - 0.01], [front * (k.fp.length / 2 + 0.03), 0.03], [front * (k.fp.length / 2 + 0.03), 0.09], [front * (L / 2 - 0.12), bt + 0.03]], 0.006, white, sz * (c.intake.width / 2 + 0.006));

  // Electronics pods: gold 1×1 box frames on both sides of the turret, from the frame rails up to the turret deck.
  const deckY = bt + 0.17;
  const podZ0 = 0.18, podZ1 = W / 2 - 0.035, podX = 0.2;
  for (const sz of [-1, 1]) {
    for (const x of [-podX, podX]) for (const z of [podZ0, podZ1]) bar(k.visual, [x, bt - 0.02, sz * z], [x, deckY, sz * z], 0.025, goldTube);
    for (const z of [podZ0, podZ1]) bar(k.visual, [-podX, deckY, sz * z], [podX, deckY, sz * z], 0.025, goldTube);
    for (const x of [-podX, podX]) bar(k.visual, [x, deckY, sz * podZ0], [x, deckY, sz * podZ1], 0.025, goldTube);
    box(k.visual, podX * 2, 0.004, podZ1 - podZ0, mat(0x2b2d31, { opacity: 0.6 }), 0, bt + 0.02, sz * (podZ0 + podZ1) / 2);
    for (let i = 0; i < 4; i++) controller(k.visual, -0.14 + i * 0.09, bt + 0.025, sz * (podZ0 + podZ1) / 2, [0x39ff6a, 0x3b8bff, 0x39ff6a, 0xff3b3b][i]);
    box(k.visual, 0.15, 0.03, 0.1, mat(0x8b1d1d), 0, bt + 0.09, sz * (podZ0 + podZ1) / 2); // PDH / roboRIO shelf
    wire(k.visual, [[-0.12, bt + 0.05, sz * podZ0], [0, bt + 0.12, sz * (podZ0 + 0.04)], [0.12, bt + 0.05, sz * podZ0]], 0xd23a2a, 0.005);
  }
  // Turret deck: gold plate bridging the pods with the bearing ring on top; energy-chain twist capsule underneath.
  const ringR = inch(5.5);
  box(k.visual, podX * 2 + 0.03, 0.006, podZ0 * 2 + 0.03, gold, 0, deckY + 0.003, 0);
  const capsule = new THREE.Mesh(new THREE.TorusGeometry(ringR - 0.02, 0.025, 8, 36), mat(0xb7bcc3, { metal: 0.3 }));
  capsule.rotation.x = Math.PI / 2; capsule.position.set(0, deckY - 0.035, 0); k.visual.add(capsule);
  // Elevator rollers that turn the NOTE up into the turret (2 in flex wheels) under the deck.
  const lift = [roller(k.visual, 0.025, 0.3, black, -0.05, bt + 0.06), roller(k.visual, 0.025, 0.3, black, 0.05, bt + 0.06)];
  motor(k.visual, podX + 0.04, bt + 0.05, 0.1); // turret Kraken on the chassis, chain to the ring
  belt(k.visual, [podX + 0.04, bt + 0.05], [ringR * 0.9, deckY + 0.01], 0.1, 0.012);

  // Turret: everything above the ring yaws.
  const t = k.turret;
  t.position.set(0, deckY + 0.006, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.012, 8, 40), gold);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; t.add(ring);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(ringR - 0.01, ringR - 0.01, 0.01, 36), white);
  disc.position.y = 0.02; t.add(disc);
  const hh = H - t.position.y - 0.02;
  // White pocketed truss side plates rising from the ring to the shooter pivot.
  const spts: [number, number][] = [[-0.13, 0.02], [0.12, 0.02], [0.16, hh * 0.45], [0.07, hh - 0.02], [-0.1, hh], [-0.16, hh * 0.5]];
  const holes: [number, number, number][] = [];
  // Dense pocketing (the CAD's white plates are mostly holes): staggered rows of pockets inside the outline.
  for (let row = 0, y = 0.06; y < hh - 0.04; row++, y += 0.042) for (let x = -0.1 + (row % 2) * 0.021; x < 0.11; x += 0.042) if (Math.abs(x) < 0.12 - Math.abs(y - hh * 0.5) * 0.12) holes.push([x, y, 0.016]);
  sidePlates(t, spts, 0.12, white, holes, 0.008);
  for (const [x, y] of [[-0.11, 0.05], [0.1, 0.05], [-0.08, hh - 0.03], [0.05, hh - 0.04]] as const) box(t, 0.018, 0.018, 0.24, gold, x, y, 0);
  // Passive carbon rollers + active feeder that reorient the NOTE on its way up.
  const feed = [roller(t, 0.015, 0.22, black, -0.02, 0.07), roller(t, 0.02, 0.22, gray, 0.04, 0.13), roller(t, 0.015, 0.22, black, -0.03, 0.18)];
  // Shooter: pivots at the back top of the plates, leadscrew pitch from the turret disc.
  const shooter = pivot(t, -0.06, hh - 0.06);
  sidePlates(shooter, [[-0.04, -0.06], [0.2, -0.06], [0.24, 0], [0.2, 0.07], [-0.04, 0.07]], 0.105, white, [[0.08, 0, 0.022]], 0.006);
  const wheels = [
    wheelShaft(shooter, 0.15, 0.033, { n: 4, r: 0.0254, w: 0.022, span: 0.17, colors: [0x2c2e33] }),
    wheelShaft(shooter, 0.15, -0.033, { n: 4, r: 0.0254, w: 0.022, span: 0.17, colors: [0x2c2e33] }),
  ];
  for (const sz of [-1, 1]) { motor(shooter, 0.05, 0.0, sz * 0.14, 0x57ba6b); belt(shooter, [0.05, 0], [0.15, 0.033], sz * 0.115, 0.012); }
  box(shooter, 0.03, 0.12, 0.21, gold, -0.035, 0.005, 0);
  const held = pivot(shooter, 0.06, 0);
  const screw = link(t, 0.006, mat(0xc0c4ca, { metal: 0.8 }));
  box(t, 0.05, 0.05, 0.05, gray, 0.1, 0.05, 0.0); // Falcon on the leadscrew nut
  const screwBase = new THREE.Vector3(0.1, 0.075, 0), screwTop = new THREE.Vector3();
  // Diverter: gold truss arm with red sprockets on the top of the turret; folds back, swings forward for AMP / TRAP.
  const div = pivot(t, -0.1, hh + 0.005);
  lattice(div, [0, -0.02, -0.07], [0.24, 0, 0], [0, 0.04, 0], { cells: 4, w: 0.012, m: gold, zig: true });
  lattice(div, [0, -0.02, 0.07], [0.24, 0, 0], [0, 0.04, 0], { cells: 4, w: 0.012, m: gold, zig: true });
  for (let i = 1; i < 4; i++) box(div, 0.012, 0.012, 0.14, gold, i * 0.08, 0.02, 0);
  for (const x of [0, 0.24]) {
    for (const sz of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 18), red);
      sp.rotation.x = Math.PI / 2; sp.position.set(x, 0, sz * 0.08); div.add(sp);
    }
  }
  sidePlates(div, [[0.22, -0.03], [0.32, -0.05], [0.33, 0.03], [0.22, 0.03]], 0.075, white);
  box(div, 0.1, 0.05, 0.004, white, 0.27, 0.0, 0.08);
  decal(div, 'ROBONAUTS', { w: 0.09, h: 0.022, color: '#c8242b', background: '#ffffff', x: 0.27, y: 0.0, z: 0.0825 });
  const divRollers = [roller(div, 0.02, 0.14, black, 0.29, -0.02), roller(div, 0.012, 0.14, gray, 0.32, 0.01)];
  motor(t, -0.1, hh - 0.04, -0.15);

  // Climb, per side: a chain arm pivoting on a truss tower at the back and folded forward along the frame rail (red
  // hook at the front), and a ski tower with a wheel on top at the back corner.
  const towerX = -L / 2 + 0.06, pvY = bt + 0.2;
  const chainArms: THREE.Group[] = [], skis: THREE.Group[] = [];
  const armLen = L - 0.13, stow = -Math.asin((pvY - bt - 0.035) / armLen);
  for (const sz of [-1, 1]) {
    const z = sz * (W / 2 - 0.02);
    plate(k.visual, [[towerX - 0.05, bt - 0.02], [towerX + 0.07, bt - 0.02], [towerX + 0.02, pvY + 0.03], [towerX - 0.03, pvY + 0.03]], 0.006, gold, z, [[towerX + 0.005, bt + 0.06, 0.018]]);
    const arm = pivot(k.visual, towerX, pvY, z - sz * 0.012);
    lattice(arm, [0, -0.022, 0], [armLen, 0, 0], [0, 0.044, 0], { cells: 9, w: 0.013, m: gold, zig: true });
    plate(arm, [[armLen - 0.02, -0.02], [armLen + 0.04, -0.02], [armLen + 0.07, 0.05], [armLen + 0.04, 0.09], [armLen + 0.01, 0.05], [armLen - 0.02, 0.02]], 0.01, red);
    motor(arm, 0.02, 0, -sz * 0.03, 0x57ba6b);
    chainArms.push(arm);
    const ski = pivot(k.visual, towerX + 0.02, bt + 0.02, sz * (W / 2 - 0.11));
    const skiLen = H - bt - 0.08;
    lattice(ski, [-0.02, 0, 0], [0, skiLen, 0], [0.04, 0, 0], { cells: 7, w: 0.012, m: gold, zig: true });
    const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 18), white);
    sw.rotation.x = Math.PI / 2; sw.position.set(0, skiLen, 0); ski.add(sw);
    ski.rotation.z = -0.12;
    skis.push(ski);
  }
  camera(k.visual, podX, deckY + 0.02, W * 0.32);

  let tilt = 0, divAng = 0.1, arms = stow;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [podX, deckY + 0.03, -(podZ0 + podZ1) / 2],
    update(s) {
      db.update(s); intake.update(s);
      tilt = approach(tilt, s.hood - 0.6, 10, s.dt); shooter.rotation.z = tilt;
      screw.set(screwBase, pointIn(t, shooter, 0.12, -0.06, 0, screwTop));
      divAng = approach(divAng, s.passing || s.climb > 0.1 ? -0.55 : 0.1, 6, s.dt); div.rotation.z = divAng;
      // Chain arms swing up to reach the chain, then winch down (climb 0.25) to lift the robot.
      arms = approach(arms, s.climb > 0.1 ? stow + (1.5 - stow) * Math.min(1, s.climb * 1.15) : stow, 4, s.dt);
      for (const a of chainArms) a.rotation.z = arms;
      for (const ski of skis) ski.rotation.z = approach(ski.rotation.z, s.climb > 0.1 ? 0.35 : -0.12, 4, s.dt);
      const fs = flywheel(s);
      spin(wheels[0], -fs, s.dt); spin(wheels[1], fs, s.dt);
      const feedRate = s.intaking ? 25 : s.firing > 0 ? 30 : 0;
      for (const r of [...feed, ...lift]) spin(r, feedRate, s.dt);
      spin(frontRoller, s.intaking && s.enabled ? 28 : 0, s.dt);
      for (const r of divRollers) spin(r, s.passing ? -25 : 0, s.dt);
    },
  };
});

// ── 4414 HighTide TIDEPOD (Chief Delphi reveal; TBA 2024 photo): an elevator robot. Two teal perforated uprights lean
//    back toward the intake, braced from the front corners by teal truss A-frames; a black inner stage rides inside
//    them with a black shooter pod (stacked flywheel and AMP rollers) on its carriage. A broad under-bumper roller
//    path feeds the NOTE up the elevator face. The elevator raises the pod for the AMP / TRAP and hooks the chain. ──
registerRobotModel('tidepod-4414', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const tealTube = tubeMat(0x16a5b0), teal = mat(0x16a5b0, { metal: 0.6, rough: 0.35 });
  const black = mat(0x15171a, { metal: 0.35, rough: 0.55 }), blackTube = tubeMat(0x2a2d32);
  const silver = mat(0xc5cbd2, { metal: 0.7, rough: 0.3 }), rollerM = mat(0x1c1d20, { rough: 0.8 });
  const db = drivebase(k, { motorRing: 0x16a5b0 });
  const intake = underBumperIntake(k, { n: 3, width: c.intake.width });
  const side = k.groundSide; // the elevator leans toward the intake
  const lean = 0.2, baseX = -side * 0.04, ez = W / 2 - 0.07;
  const el = new THREE.Group();
  el.position.set(baseX, bt - 0.01, 0); el.rotation.z = -side * lean; k.visual.add(el); // -side·lean leans toward the intake
  const railH = (H - bt - 0.01) / Math.cos(lean);
  for (const sz of [-1, 1]) {
    bar(el, [0, 0, sz * ez], [0, railH, sz * ez], 0.032, tealTube);
    bar(el, [-side * 0.03, 0, sz * ez], [-side * 0.03, railH, sz * ez], 0.02, tealTube);
  }
  bar(el, [0, railH - 0.015, -ez], [0, railH - 0.015, ez], 0.03, blackTube);
  bar(el, [0, 0.03, -ez], [0, 0.03, ez], 0.03, blackTube);
  for (const sz of [-1, 1]) belt(el, [0, 0.05], [0, railH - 0.05], sz * (ez - 0.025), 0.02);
  // Teal truss A-frames from the front corners (away from the intake) up to the uprights.
  const at = (y: number, z: number): [number, number, number] => [baseX + side * Math.sin(lean) * y, bt - 0.01 + Math.cos(lean) * y, z];
  for (const sz of [-1, 1]) {
    const top = at(railH * 0.62, sz * ez);
    const foot: [number, number, number] = [-side * (L / 2 - 0.05), bt, sz * ez];
    const v: [number, number, number] = [top[0] - foot[0], top[1] - foot[1], 0];
    lattice(k.visual, foot, v, [side * 0.05, 0, 0], { cells: 6, w: 0.014, m: teal, zig: true });
    plate(k.visual, [[foot[0] - side * 0.04, bt - 0.02], [foot[0] + side * 0.1, bt - 0.02], [foot[0] + side * 0.02, bt + 0.08]], 0.006, silver, sz * (ez + 0.018));
  }
  // Inner black stage and the carriage with the shooter pod.
  const stage = new THREE.Group(); el.add(stage);
  const sz2 = ez - 0.04, stageH = railH - 0.06;
  for (const sz of [-1, 1]) bar(stage, [-side * 0.045, 0.06, sz * sz2], [-side * 0.045, stageH, sz * sz2], 0.025, blackTube);
  bar(stage, [-side * 0.045, stageH, -sz2], [-side * 0.045, stageH, sz2], 0.022, blackTube);
  const hooks: THREE.Mesh[] = [];
  for (const sz of [-1, 1]) hooks.push(hook(stage, -side * 0.045, stageH, sz * (sz2 - 0.02), 0.07, silver, 1, 0.009));
  const carriage = new THREE.Group(); stage.add(carriage);
  carriage.position.set(-side * 0.07, stageH - 0.14, 0);
  box(carriage, 0.03, 0.1, 2 * sz2 - 0.03, black, 0, 0, 0);
  // The pod hangs on the carriage, on the front side of the uprights (it counter-rotates the lean so it sits level).
  const pod = pivot(carriage, -side * 0.03, 0.0);
  sidePlates(pod, [[-0.1, -0.07], [0.1, -0.07], [0.13, 0.0], [0.09, 0.07], [-0.1, 0.07]], sz2 - 0.03, black, [[0.0, 0.0, 0.025]], 0.008);
  const fly = [
    wheelShaft(pod, 0.07, 0.032, { n: 4, r: 0.032, w: 0.025, span: 2 * sz2 - 0.12, colors: [0x2a2b2e, 0x4a4d52] }),
    wheelShaft(pod, 0.07, -0.034, { n: 4, r: 0.032, w: 0.025, span: 2 * sz2 - 0.12, colors: [0x4a4d52, 0x2a2b2e] }),
  ];
  const ampRollers = [roller(pod, 0.02, 2 * sz2 - 0.08, rollerM, -0.06, 0.035), roller(pod, 0.02, 2 * sz2 - 0.08, rollerM, -0.06, -0.035)];
  for (const sz of [-1, 1]) motor(pod, -0.02, 0.0, sz * (sz2 - 0.06), 0x57ba6b);
  const held = pivot(pod, 0.0, 0.0);
  // Broad roller path from the intake mouth up the inside of the uprights.
  const path: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) path.push(roller(k.visual, 0.022, 2 * ez - 0.06, rollerM, side * (L / 2 - 0.1 - i * 0.07), bt + 0.04 + i * 0.045));
  for (const sz of [-1, 1]) plate(k.visual, [[side * (L / 2 - 0.04), bt - 0.02], [side * (L / 2 - 0.34), bt + 0.14], [side * (L / 2 - 0.34), bt + 0.2], [side * (L / 2 - 0.04), bt + 0.04]], 0.006, black, sz * (ez - 0.01));
  for (let i = 0; i < 4; i++) controller(k.visual, -side * (0.06 + i * 0.06), bt + 0.004, 0.0, [0x39ff6a, 0xff3b3b, 0x3b8bff, 0x39ff6a][i]);
  camera(k.visual, -side * (L / 2 - 0.08), bt + 0.06, -W * 0.3);
  let ext = 0, tilt = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [baseX, bt + 0.03, W * 0.3],
    update(s) {
      db.update(s); intake.update(s);
      // Up for the AMP / TRAP and to hook the chain; pulls back down to lift the robot (climb 0.25).
      const up = s.passing ? 0.32 : s.climb > 0.1 ? 0.36 * Math.min(1, s.climb * 1.1) : 0;
      ext = approach(ext, up, 5, s.dt); stage.position.y = ext;
      // Pod pitch: aim angle while shooting (level = the lean undone), nosed down for the AMP.
      tilt = approach(tilt, side * lean + (s.passing ? -0.5 : s.hood - 0.6), 9, s.dt); pod.rotation.z = tilt;
      const fs = flywheel(s);
      spin(fly[0], -fs, s.dt); spin(fly[1], fs, s.dt);
      for (const r of ampRollers) spin(r, s.passing || s.intaking ? 25 : 0, s.dt);
      for (const r of path) spin(r, s.intaking && s.enabled ? -side * 26 : 0, s.dt);
      void hooks;
    },
  };
});

// ── 1323 MadTown 2024 (TBA 2024 pit photo): low and long. A single blue pocketed shooter arm runs nearly the full
//    length of the robot, hinged on blue towers over the intake end and resting on the frame with its black flywheels
//    at the far end; gas struts help lift it. Black sponsor panels line both frame sides. NOTES ride up the arm's
//    rollers from the intake to the flywheels; the arm swings up to aim and past vertical for the AMP. ──
registerRobotModel('madtown-2024-1323', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, bt = c.bumperTop;
  const blueTube = tubeMat(0x2563d8), blue = mat(0x2563d8, { metal: 0.6, rough: 0.35 });
  const black = mat(0x141518, { metal: 0.3, rough: 0.5 }), poly = mat(0x0d0e10, { opacity: 0.85, rough: 0.25 });
  const db = drivebase(k, { tube: blueTube, motorRing: 0x2563d8 });
  const intake = underBumperIntake(k, { n: 3, width: c.intake.width });
  const side = k.groundSide; // pivot over the intake; flywheels toward the front
  const pz = W / 2 - 0.075, px = side * (L / 2 - 0.08), py = bt + 0.25;
  // Pivot towers: blue pocketed plates on the frame rails, braced to the frame.
  for (const sz of [-1, 1]) {
    plate(k.visual, [[px - 0.08, bt - 0.02], [px + 0.06, bt - 0.02], [px + 0.025, py + 0.03], [px - 0.025, py + 0.03]], 0.008, blue, sz * (pz + 0.02), [[px - 0.01, bt + 0.07, 0.022]]);
    bar(k.visual, [px - side * 0.18, bt - 0.01, sz * (pz + 0.02)], [px, py - 0.04, sz * (pz + 0.02)], 0.02, blueTube);
  }
  tube(k.visual, [px, py, -pz - 0.03], [px, py, pz + 0.03], 0.01, mat(0xc0c4ca, { metal: 0.8 }));
  // Black sponsor panels on both sides, under the arm.
  for (const sz of [-1, 1]) {
    plate(k.visual, [[-side * (L / 2 - 0.03), bt - 0.02], [side * (L / 2 - 0.03), bt - 0.02], [side * (L / 2 - 0.03), bt + 0.13], [-side * (L / 2 - 0.03), bt + 0.06]], 0.004, black, sz * (W / 2 - 0.008));
    decal(k.visual, 'WE BELIEVE', { w: 0.14, h: 0.03, x: side * 0.12, y: bt + 0.06, z: sz * (W / 2 - 0.004), rotY: sz > 0 ? 0 : Math.PI });
    decal(k.visual, 'MADERA UNIFIED', { w: 0.16, h: 0.022, x: -side * 0.1, y: bt + 0.03, z: sz * (W / 2 - 0.004), rotY: sz > 0 ? 0 : Math.PI });
  }
  // The arm: two long blue pocketed side plates, lying on the frame when stowed.
  const arm = pivot(k.visual, px, py);
  const len = L - 0.17, restY = bt + 0.08;
  const stow = Math.asin((py - restY) / len); // tilt down toward the far end
  const holes: [number, number, number][] = [];
  for (let i = 1; i < 7; i++) holes.push([-side * len * (i / 7.5), 0, 0.026]);
  sidePlates(arm, [[side * 0.04, -0.045], [-side * len, -0.05], [-side * (len + 0.06), 0.0], [-side * len, 0.07], [side * 0.04, 0.045]], pz, blue, holes, 0.008);
  for (let i = 0; i < 4; i++) box(arm, 0.02, 0.02, 2 * pz, blue, -side * len * (0.2 + i * 0.2), -0.04, 0);
  box(arm, len * 0.55, 0.006, 2 * pz - 0.02, poly, -side * len * 0.45, 0.07, 0).rotation.z = side * 0.05; // black poly hood
  const feed: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) feed.push(roller(arm, 0.02, 2 * pz - 0.02, black, -side * len * (0.15 + i * 0.17), -0.015));
  // Flywheels at the far end: two big black shafts.
  const fly = [roller(arm, 0.05, 2 * pz - 0.03, black, -side * (len - 0.04), 0.02), roller(arm, 0.04, 2 * pz - 0.03, black, -side * (len - 0.14), 0.035)];
  for (const sz of [-1, 1]) { motor(arm, -side * (len - 0.09), 0.02, sz * (pz + 0.035), 0x57ba6b); belt(arm, [-side * (len - 0.09), 0.02], [-side * (len - 0.04), 0.02], sz * (pz + 0.015), 0.02); }
  const held = pivot(arm, -side * (len - 0.2), 0.02);
  // Gas struts from the frame to the arm (re-pinned every frame so they stay attached).
  const struts = [-1, 1].map(sz => ({ rod: link(k.visual, 0.008, mat(0x202124, { metal: 0.6 })), base: new THREE.Vector3(-side * 0.02, bt + 0.005, sz * (pz - 0.025)), sz, tip: new THREE.Vector3() }));
  // Chain climb: telescoping tubes just inside the frame rails, clear of the arm plates.
  const hookX = -side * 0.12, hookZ = W / 2 - 0.04;
  const climbers = new THREE.Group(); k.visual.add(climbers);
  for (const sz of [-1, 1]) {
    bar(k.visual, [hookX, bt - 0.02, sz * hookZ], [hookX, py, sz * hookZ], 0.03, blueTube);
    bar(climbers, [hookX, py - 0.2, sz * hookZ], [hookX, py + 0.02, sz * hookZ], 0.022, blueTube);
    hook(climbers, hookX, py, sz * hookZ, 0.05, black, side > 0 ? -1 : 1, 0.008);
  }
  camera(k.visual, -side * (L / 2 - 0.06), bt + 0.06, 0.1);
  let ang = -stow;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [px, py + 0.04, 0],
    update(s) {
      db.update(s); intake.update(s);
      // Arm angle above horizontal toward the far end: resting, raised to the shot angle, or past vertical (AMP).
      const target = s.passing ? 1.9 : s.fill > 0 && s.enabled ? Math.max(0.15, s.hood) : -stow;
      ang = approach(ang, target, 6, s.dt);
      arm.rotation.z = -side * ang; // positive ang lifts the far (front) end
      for (const st of struts) st.rod.set(st.base, pointIn(k.visual, arm, -side * len * 0.4, -0.045, st.sz * (pz - 0.025), st.tip));
      const fs = flywheel(s);
      spin(fly[0], side * fs, s.dt); spin(fly[1], -side * fs, s.dt);
      for (const r of feed) spin(r, s.intaking || s.firing > 0 ? side * 24 : 0, s.dt);
      climbers.position.y = approach(climbers.position.y, s.climb * 0.5, 6, s.dt); // telescopes up to the chain
    },
  };
});

export function additionalCrescendoTeamRobots(): TeamRobot[] {
  return [
    { id: 'madtown-2024-1323', team: 1323, name: 'MadTown 2024',
      description: '1323 MadTown Robotics. Low, fast ground-intake SPEAKER cycler: one long pivoting shooter arm that lies flat across the robot, swings up to aim and past vertical for the AMP, plus a chain climb. Simulator estimates: 5.2 m/s drive, 10 m/s² acceleration, 1.5 s per climb level.',
      source: 'https://www.thebluealliance.com/team/1323/2024 — 2024 pit photo; performance [EST]',
      config: config(1323, 'madtown-2024-1323', false, 5.2, 10, 1.5, 24, 24) },
    { id: 'twister-118', team: 118, name: 'Twister',
      description: '118 Robonauts. 27 in square robot with a dual-sided dust-pan intake feeding up through the belly into a 420° turret: eight-wheel leadscrew-pitched shooter, AMP/TRAP diverter arm, chain arms + skis climb. Simulator estimates: 4.8 m/s drive and 2.1 s per climb level; trades sprint speed for aiming freedom.',
      source: 'https://www.chiefdelphi.com/t/2024-robonauts-cad-and-code-release/478131 — 2024 Twister Technical Binder; TBA 2024 photos',
      config: config(118, 'twister-118', true, 4.8, 8.8, 2.1, 25, 25, 27) },
    { id: 'tidepod-4414', team: 4414, name: 'TIDEPOD',
      description: '4414 HighTide. Elevator robot: a teal, rearward-leaning elevator braced by truss A-frames carries the shooter pod up for the AMP / TRAP and hooks the chain; broad under-bumper roller intake. Simulator estimates: 22 in stowed, 5.0 m/s drive, 11 m/s² acceleration and 1.8 s per climb level.',
      source: 'https://www.chiefdelphi.com/t/team-4414-hightide-2024-robot-tidepod/460154 — reveal; TBA 2024 match photo',
      config: config(4414, 'tidepod-4414', false, 5.0, 11, 1.8, 22, 25) },
  ];
}

// Dimensions / timing / drive tuning [EST] unless noted; capabilities follow the team resources.
function config(team: number, model: string, turret: boolean, speed: number, accel: number, climb: number, height: number, intake: number, frame?: number) {
  const c = build({ ground: true, source: true, shooter: 'pivot', aim: turret ? 'turret' : 'align', amp: true, climb: 2 });
  c.teamNumber = team; c.model = model; c.maxSpeed = speed; c.maxAccel = accel;
  c.height = inch(height); c.launcher.height = inch(height - 2); c.intake.width = inch(intake);
  if (frame) c.frameLength = c.frameWidth = inch(frame); // Twister: 27 × 27 in (binder)
  c.climber.secondsPerLevel = climb;
  return normalizeCrescendoConfig(c);
}
