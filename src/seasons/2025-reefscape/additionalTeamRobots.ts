import { ARM_SWING_RATE, scoringApproach, scoringSlew } from '@engine/robot/scoringReadiness';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, battery, box, controller, decal, deployableIntake, drivebase, flowAt, intakeDeployTarget, lattice, mat, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, wheelShaft, wire, type ModelKit, type PlaceAnim, type RobotAnimState } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { inch } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';

/** Rules' end effector, or a stowed pose before the first frame. */
export const place = (s: RobotAnimState): PlaceAnim => s.place ?? { height: 0.45, forward: 0.3, level: 1 };

/** The rules park the end effector at 0.45 m while driving (and at the handoff height while taking floor CORAL). */
export const stowed = (p: PlaceAnim): boolean => p.height <= 0.46 && !p.handoff;

/**
 * Elevator + arm inverse kinematics: an arm of length `la` on a carriage riding a vertical elevator at x = `ex`
 * reaches the rules' end-effector point (`forward` from the robot center along `dir` ±1, at `height`). The arm tilts
 * up from the carriage when the piece is within reach (so the carriage stays low), and the carriage height is kept
 * inside its travel. Returns the carriage height and the arm angle in the robot's x-y plane (0 = +x, π = −x).
 */
export function reachWith(p: PlaceAnim, dir: number, ex: number, la: number, yMin: number, yMax: number): { yc: number; phi: number } {
  const dx = Math.max(0, p.forward - dir * ex); // `forward` is measured along the scoring direction
  const up = Math.sqrt(Math.max(0, la * la - Math.min(dx, la) ** 2));
  const yc = THREE.MathUtils.clamp(p.height - up, yMin, yMax);
  const tilt = Math.atan2(p.height - yc, Math.max(0.02, Math.min(dx, la)));
  return { yc, phi: dir > 0 ? tilt : Math.PI - tilt };
}

/** Star / spiked intake wheels (the compliant "spiky" rollers 1690 and 2056 used): `n` wheels across `span`. */
export function starWheels(parent: THREE.Object3D, x: number, y: number, o: { n: number; r: number; span: number; m: THREE.Material; spikes?: number }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  parent.add(g);
  tube(g, [0, 0, -o.span / 2 - 0.01], [0, 0, o.span / 2 + 0.01], 0.008, mat(0x9aa0a6, { metal: 0.7 }));
  const k = o.spikes ?? 8;
  for (let i = 0; i < o.n; i++) {
    const z = o.n === 1 ? 0 : -o.span / 2 + (o.span * i) / (o.n - 1);
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + i * 0.3;
      bar(g, [Math.cos(a) * 0.012, Math.sin(a) * 0.012, z], [Math.cos(a) * o.r, Math.sin(a) * o.r, z], 0.007, o.m);
    }
  }
  return g;
}

// ── 1690 Orbit WHISPER (Chief Delphi reveal and CAD release; Orbit 2025 photos): black, 27 in square. A narrow closed-
//    belt differential elevator stands in the middle of the robot — its two rails one behind the other along the
//    robot's length — braced by an A-frame of black tubes from the bumper corners up to the top cap, with the sponsor
//    plates filling the bottom of the A. The same belts that lift the carriage also turn a carbon arm with a blue
//    vacuum cup that rotates all the way over the top, so WHISPER scores off either end of the robot, including over
//    its own intake. Floor intake: a spiky green/black roller bank that stands upright at one end and drops over the
//    bumper; a conveyor carries the CORAL under the elevator where the arm swings down to grab it. Deep-cage climber
//    at the other end. ──
registerRobotModel('whisper-1690', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const blackTube = tubeMat(0x26282c), black = mat(0x141518, { metal: 0.35, rough: 0.5 });
  const gray = tubeMat(0x8b9096), carbon = mat(0x1b1c1f, { metal: 0.2, rough: 0.35 });
  const blue = mat(0x2f62d4, { rough: 0.45 }), silver = mat(0xc5cbd2, { metal: 0.7 });
  const db = drivebase(k, { tube: blackTube, motorRing: 0x2f62d4 });
  const side = k.groundSide; // intake end
  // Elevator rails sit one behind the other along x; the arm turns on the +z face, the A-frame braces the −z face.
  const rx = 0.05, top = H - 0.02;
  for (const sx of [-1, 1]) bar(k.visual, [sx * rx, bt - 0.02, 0], [sx * rx, top, 0], 0.03, blackTube);
  bar(k.visual, [-rx - 0.02, top, 0], [rx + 0.02, top, 0], 0.03, blackTube);
  box(k.visual, 0.16, 0.05, 0.08, black, 0, bt + 0.01, 0); // differential gearbox at the base
  for (const sz of [-1, 1]) motor(k.visual, sz * 0.05, bt + 0.07, -0.06, 0x2f62d4);
  for (const sx of [-1, 1]) belt(k.visual, [sx * (rx - 0.012), bt + 0.04], [sx * (rx - 0.012), top - 0.03], 0.022, 0.016);
  // Spectrum row 127, authenticated Orbit post-season release: pocketed silver elevator web.
  // Keep the photo-based carbon arm; the published assembly has an unresolved arm reference.
  lattice(k.visual, [-rx, bt + 0.03, -0.021], [0, top - bt - 0.05, 0], [2 * rx, 0, 0], { cells: 12, w: 0.009, m: silver, zig: true });
  // A-frame: black tubes from the four bumper corners up to the elevator cap (−z face), sponsor plates in the A.
  for (const sx of [-1, 1]) {
    bar(k.visual, [sx * (L / 2 - 0.04), bt, -(W / 2 - 0.05)], [sx * rx, top - 0.04, -0.03], 0.028, blackTube);
    bar(k.visual, [sx * (L / 2 - 0.04), bt, W / 2 - 0.05], [sx * (rx + 0.01), top - 0.25, 0.03], 0.024, blackTube);
    plate(k.visual, [[sx * (L / 2 - 0.03), bt - 0.02], [sx * 0.06, bt - 0.02], [sx * 0.06, bt + 0.2], [sx * (L / 2 - 0.12), bt + 0.04]], 0.005, black, -(W / 2 - 0.035));
  }
  decal(k.visual, 'WHISPER', { w: 0.16, h: 0.04, x: side * 0.17, y: bt + 0.05, z: -(W / 2 - 0.032), rotY: Math.PI });
  decal(k.visual, 'Markforged', { w: 0.12, h: 0.025, x: -side * 0.17, y: bt + 0.08, z: -(W / 2 - 0.032), rotY: Math.PI });
  decal(k.visual, 'NVIDIA', { w: 0.09, h: 0.025, x: -side * 0.17, y: bt + 0.04, z: -(W / 2 - 0.032), rotY: Math.PI });
  // Inner stage (gray) and carriage on the +z face.
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sx of [-1, 1]) bar(stage, [sx * (rx - 0.005), bt + 0.05, 0.03], [sx * (rx - 0.005), top - 0.02, 0.03], 0.022, gray);
  bar(stage, [-rx, top - 0.02, 0.03], [rx, top - 0.02, 0.03], 0.02, gray);
  // Second stage (continuous rigging: stage 1 rises half as far as stage 2, the rails always overlap).
  const stage2 = new THREE.Group(); k.visual.add(stage2);
  for (const sx of [-1, 1]) bar(stage2, [sx * (rx - 0.012), bt + 0.1, 0.048], [sx * (rx - 0.012), top - 0.04, 0.048], 0.018, blackTube);
  bar(stage2, [-rx + 0.01, top - 0.04, 0.048], [rx - 0.01, top - 0.04, 0.048], 0.018, blackTube);
  const carriage = new THREE.Group(); stage2.add(carriage);
  box(carriage, 0.14, 0.12, 0.012, black, 0, 0, 0.05);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), black);
  hub.rotation.x = Math.PI / 2; hub.position.z = 0.07; carriage.add(hub);
  // Carbon arm with the vacuum cup at its end (the hose runs along it).
  const la = 0.6;
  const arm = pivot(carriage, 0, 0, 0.08);
  tube(arm, [0, 0, 0], [la - 0.06, 0, 0], 0.016, carbon);
  box(arm, 0.08, 0.05, 0.03, black, la - 0.05, 0, 0);
  const cup = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.04, 24, 1, true), blue);
  cup.rotation.z = -Math.PI / 2; cup.position.x = la; arm.add(cup);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.03 + i * 0.004, 0.005, 6, 18), blue);
    r.rotation.y = Math.PI / 2; r.position.x = la - 0.035 + i * 0.01; arm.add(r);
  }
  wire(arm, [[0.02, 0.02, 0.02], [la * 0.5, 0.024, 0.02], [la - 0.07, 0.02, 0.02]], 0x2f62d4, 0.006);
  const held = pivot(arm, la + .075, 0), algaeHeld = pivot(arm, la + .225, 0);
  // Vacuum pump and electronics on the deck, beside the conveyor.
  box(k.visual, 0.12, 0.07, 0.08, silver, -side * 0.2, bt + 0.035, -0.17);
  battery(k.visual, side * 0.2, bt - 0.02, -0.18, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, -side * (0.08 + i * 0.07), bt, 0.22, 0x46ca79);
  // Floor intake on the intake end: black side plates, a blue spiky star bank and a gray front roller.
  const intakeVisual = new THREE.Group(); k.visual.add(intakeVisual); intakeVisual.rotation.y = Math.PI / 2;
  const intake = deployableIntake({...k, visual:intakeVisual}, { reach: c.intake.reach, rollers: 1, frame: black, rollerMaterial: mat(0x8d9299, { metal: 0.3 }) });
  const stars = [starWheels(intake.tip, side * 0.02, 0.0, { n: 10, r: 0.05, span: c.intake.width * 0.9, m: blue }), starWheels(intake.tip, -side * 0.06, 0.03, { n: 6, r: 0.045, span: c.intake.width * 0.8, m: black })];
  // Conveyor from the intake hinge to the elevator base, under the arm.
  box(k.visual, L / 2 - 0.08, 0.012, 0.12, black, side * (L / 4), bt + 0.02, 0.09);
  for (const sz of [-1, 1]) box(k.visual, L / 2 - 0.08, 0.05, 0.005, mat(0xd9e2ea, { opacity: 0.35 }), side * (L / 4), bt + 0.05, 0.09 + sz * 0.065);
  const conveyor = [0.1, 0.2, 0.3].map(f => roller(k.visual, 0.018, 0.12, black, side * L * f, bt + 0.035, 0.09));
  // Deep-cage climber on the long +z side (the cage-capture U frame swings out over the side bumper, as in Orbit's
  // photos), well outboard of the arm's swing plane. Only one floor intake: the spiky bank on the intake end.
  const cz = W / 2 - 0.04;
  for (const x of [-0.13, 0.13]) plate(k.visual, [[x - 0.04, bt - 0.02], [x + 0.04, bt - 0.02], [x + 0.015, bt + 0.26], [x - 0.015, bt + 0.26]], 0.008, black, cz);
  const climbArm = pivot(k.visual, 0, bt + 0.24, cz + 0.012);
  for (const x of [-0.13, 0.13]) bar(climbArm, [x, 0, 0], [x, 0.2, 0], 0.024, blackTube);
  tube(climbArm, [-0.15, 0.2, 0], [0.15, 0.2, 0], 0.012, silver);
  motor(k.visual, 0.0, bt + 0.06, cz - 0.04, 0x2f62d4);
  camera(k.visual, side * (L / 2 - 0.05), bt + 0.12, -W * 0.3);
  camera(k.visual, -side * (L / 2 - 0.05), bt + 0.12, W * 0.3);
  const yMin = bt + 0.12, yMax = top + 0.75;
  let yc = yMin, phi = Math.PI / 2, deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[0,0,1], algaeAnchor: algaeHeld, algaeGripScale: [.98, .98, .98], handoffStyle:'conveyor',
    intakeAnchor: intake.tip,
    flow: { handoff: () => [flowAt(k, intake.tip), new THREE.Vector3(0, bt + .09, L * .3), new THREE.Vector3(0, bt + .09, .09)] },
    lightAt: [0, top + 0.02, 0],
    update(s) {
      const p = place(s);
      // Stowed: arm straight up. Handoff: cup lowers over the pass-through conveyor.
      // Scoring: swing sideways over either +Z or -Z bumper; the cup has no wrist.
      let goal: { yc: number; phi: number };
      if (p.handoff) goal = { yc: bt + 0.08 + la + .055, phi: -Math.PI / 2 };
      else if (stowed(p)) goal = { yc: yMin, phi: Math.PI / 2 };
      else goal = reachWith(p, p.side === -1 ? -1 : 1, 0, la, yMin, yMax);
      yc = scoringApproach(yc, goal.yc, 12, s.dt);
      phi = scoringSlew(phi, goal.phi, ARM_SWING_RATE, s.dt, 9);
      const ext = Math.max(0, yc - (top - 0.12));
      stage.position.y = ext / 2; stage2.position.y = ext;
      carriage.position.y = yc - ext;
      arm.rotation.set(0, Math.PI / 2, phi);
      deploy = 1; // Pass-through intake stays down while the cup collects.
      intake.update(s, deploy);
      const sp = s.intaking && s.enabled && deploy > 0.8 ? 26 : 0;
      spin(stars[0], -side * sp, s.dt); spin(stars[1], side * sp, s.dt);
      for (const r of conveyor) spin(r, -side * (s.intaking || p.handoff ? 20 : 0), s.dt);
      climbArm.rotation.x = approach(climbArm.rotation.x, (-1.25) * s.climb, 5, s.dt); // out over the +z bumper
      db.update(s);
    },
  };
});

// ── 2056 OP Robotics LIGHTNING (OPR25 Technical Binder): 32 × 28 in, raw aluminum. A 2-stage continuous belt elevator of
//    2×2 tube with knee braces and a billet U plate across the top stands near the middle; a riveted sheet-metal
//    truss arm on the carriage carries the gripper (3 in blue compliant wheels) out over the front. The 20 in
//    polycarbonate floor intake with blue star wheels pivots over the back bumper, a "straightenator" of compliant
//    and star wheels centres the CORAL and feeds it under the elevator into a printed cradle, where the arm swings
//    down to take it. Rope-winch deep climber with large printed guides at the intake end. ──
registerRobotModel('lightning-2056', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const alu = tubeMat(0xc4cbd3), aluM = mat(0xc4cbd3, { metal: 0.75, rough: 0.3 });
  const blue = mat(0x2a55d6, { rough: 0.55 }), black = mat(0x16181b, { metal: 0.3, rough: 0.55 }), poly = mat(0xd9e2ea, { opacity: 0.45, rough: 0.2 });
  const db = drivebase(k, { tube: alu, motorRing: 0x2a55d6 });
  const side = k.groundSide; // intake end (back)
  const ex = side * 0.05, ez = 0.15, top = H - 0.02;
  for (const sz of [-1, 1]) bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.05, alu);
  box(k.visual, 0.05, 0.035, 2 * ez + 0.05, aluM, ex, top - 0.02, 0); // billet U plate
  // Knee braces to the frame on both sides of each upright, with corner gussets.
  for (const sz of [-1, 1]) {
    bar(k.visual, [side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.4, sz * ez], 0.025, alu);
    bar(k.visual, [-side * 0.3, bt - 0.01, sz * (W / 2 - 0.06)], [ex, bt + 0.32, sz * ez], 0.025, alu);
    plate(k.visual, [[-side * (L / 2 - 0.03), bt - 0.02], [-side * (L / 2 - 0.2), bt - 0.02], [-side * (L / 2 - 0.03), bt + 0.16]], 0.005, aluM, sz * (W / 2 - 0.03));
    decal(k.visual, sz > 0 ? 'Motorola' : 'GM', { w: 0.07, h: 0.03, x: -side * (L / 2 - 0.07), y: bt + 0.03, z: sz * (W / 2 - 0.026), rotY: sz > 0 ? 0 : Math.PI });
  }
  for (const sz of [-1, 1]) { motor(k.visual, ex - side * 0.05, bt + 0.04, sz * 0.06, 0x2a55d6); camera(k.visual, ex - side * 0.04, bt + 0.45, sz * (ez + 0.04)); }
  for (const sz of [-1, 1]) belt(k.visual, [ex + side * 0.03, bt + 0.06], [ex + side * 0.03, top - 0.05], sz * (ez - 0.03), 0.02);
  // Stage 1 and carriage (inside the fixed uprights, on the front side).
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex - side * 0.04, bt + 0.06, sz * (ez - 0.01)], [ex - side * 0.04, top - 0.02, sz * (ez - 0.01)], 0.035, alu);
  bar(stage, [ex - side * 0.04, top - 0.03, -ez], [ex - side * 0.04, top - 0.03, ez], 0.03, alu);
  const stage2 = new THREE.Group(); k.visual.add(stage2);
  for (const sz of [-1, 1]) bar(stage2, [ex - side * 0.07, bt + 0.1, sz * (ez - 0.03)], [ex - side * 0.07, top - 0.05, sz * (ez - 0.03)], 0.028, alu);
  bar(stage2, [ex - side * 0.07, top - 0.06, -ez + 0.02], [ex - side * 0.07, top - 0.06, ez - 0.02], 0.025, alu);
  const carriage = new THREE.Group(); stage2.add(carriage);
  box(carriage, 0.012, 0.16, 2 * ez - 0.1, aluM, ex - side * 0.095, 0, 0);
  // Gripper arm: truss of formed sheet metal, pivoting on the carriage.
  const la = 0.5;
  const arm = pivot(carriage, ex - side * 0.11, 0.05);
  lattice(arm, [0, -0.03, -0.045], [la - 0.05, 0, 0], [0, 0.06, 0], { cells: 5, w: 0.012, m: aluM, zig: true });
  lattice(arm, [0, -0.03, 0.045], [la - 0.05, 0, 0], [0, 0.06, 0], { cells: 5, w: 0.012, m: aluM, zig: true });
  motor(arm, 0.08, 0.04, 0.0, 0x2a55d6);
  const grip = pivot(arm, la - 0.03, 0);
  sidePlates(grip, [[-0.04, -0.06], [0.07, -0.06], [0.07, 0.06], [-0.04, 0.06]], 0.06, black);
  const gripWheels = [
    wheelShaft(grip, 0.05, 0.045, { n: 2, r: 0.038, w: 0.03, span: 0.1, colors: [0x2a55d6] }),
    wheelShaft(grip, 0.05, -0.045, { n: 2, r: 0.038, w: 0.03, span: 0.1, colors: [0x2a55d6] }),
  ];
  const held = pivot(grip, 0.06, 0), algaeHeld = pivot(grip, .23, 0);
  // Floor intake (back): polycarbonate side plates, blue star wheels on the front roller.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: poly, rollerMaterial: black });
  const stars = starWheels(intake.tip, side * 0.04, 0, { n: 7, r: 0.045, span: c.intake.width * 0.85, m: blue, spikes: 6 });
  // Straightenator: two rows of blue compliant wheels on vertical axles, funnelling the CORAL under the elevator.
  const straight: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12), blue);
    w.position.set(side * (L / 2 - 0.12 - i * 0.07), bt + 0.04, sz * (0.14 - i * 0.02));
    k.visual.add(w); straight.push(w);
  }
  box(k.visual, L / 2 - 0.1, 0.006, 0.34, poly, side * (L / 4 + 0.02), bt + 0.012, 0);
  box(k.visual, 0.14, 0.05, 0.12, black, ex - side * 0.02, bt + 0.04, 0); // printed CORAL cradle under the elevator
  battery(k.visual, -side * 0.28, bt - 0.02, 0.15, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, -side * (0.18 + i * 0.065), bt, -0.2, 0x46ca79);
  // Climber at the intake end: 2×1.5 tube arm with a round cage bar, swung up by surgical tubing, winched in.
  const cx = side * (L / 2 - 0.1), cz = W / 2 - 0.05;
  plate(k.visual, [[cx - 0.06, bt - 0.02], [cx + 0.06, bt - 0.02], [cx + 0.02, bt + 0.22], [cx - 0.02, bt + 0.22]], 0.009, aluM, cz);
  const climb = pivot(k.visual, cx, bt + 0.2, cz - 0.03);
  bar(climb, [0, 0, 0], [0, 0.32, 0], 0.035, alu);
  tube(climb, [-0.07, 0.3, 0], [0.07, 0.3, 0], 0.012, aluM);
  box(climb, 0.1, 0.06, 0.05, black, 0, 0.24, 0); // printed cage guide
  let yc = bt + 0.2, phi = -0.6, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.7, dir = -side;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[1,0,0], algaeAnchor: algaeHeld, algaeGripScale:[.96,.96,.96], handoffStyle:'conveyor',
    intakeAnchor: intake.tip,
    flow: { handoff: () => [flowAt(k, intake.tip), new THREE.Vector3(side * L * .3, bt + .1, 0), new THREE.Vector3(ex - side * .02, bt + .1, 0)] },
    lightAt: [ex, top + 0.01, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      // Handoff / stow: the arm reaches down into the cradle under the elevator.
      if (p.handoff) {
        const dx = side * .09 - .06, length = la - .03;
        const angle = Math.atan2(-Math.sqrt(length * length - dx * dx), dx);
        goal = { yc: bt + .1 - .05 - length * Math.sin(angle), phi: angle };
      } else if (stowed(p)) goal = { yc: bt + (p.algae ? .2 : .05) + la * .9, phi: dir > 0 ? -1.35 : Math.PI + 1.35 };
      else goal = reachWith(p, dir, ex, la, yMin, yMax);
      yc = scoringApproach(yc, goal.yc, 12, s.dt);
      phi = scoringSlew(phi, goal.phi, ARM_SWING_RATE, s.dt, 9);
      const ext = Math.max(0, yc - (top - 0.12));
      stage.position.y = ext / 2; stage2.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      grip.rotation.z = -phi + (p.handoff ? 0 : p.level === 4 ? -1.2 : p.level === 1 ? 0 : -0.5);
      for (const w of gripWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      spin(stars, -side * (s.intaking && deploy > 0.8 ? 26 : 0), s.dt);
      for (const w of straight) spin(w, s.intaking ? 20 : 0, s.dt, 'y');
      climb.rotation.z = approach(climb.rotation.z, (side * 1.1) * s.climb, 5, s.dt);
      db.update(s);
    },
  };
});

// ── 118 Robonauts FIREFLY (2025 Technical Binder, CAD release; TBA 2025 photos): 29 × 29 in gold chassis. A single-
//    stage gold elevator (SDS bearing blocks, constant-force springs) in the middle with the FIREFLY plate across its
//    top; on the carriage a cycloidal-geared gold truss arm swings the big white polycarbonate end effector, which
//    takes CORAL from the floor intake and ALGAE from the REEF and floor. White CORAL floor intake pivots over one
//    bumper; two counter-rotating ALGAE paddles stand at the other end next to the gold truss cage climber. ──
registerRobotModel('firefly-118', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const goldTube = tubeMat(0xc9962b), gold = mat(0xc9962b, { metal: 0.65, rough: 0.35 });
  const white = mat(0xeef0f2, { rough: 0.5 }), black = mat(0x16171a, { metal: 0.3, rough: 0.55 }), dark = mat(0x2a2c30, { opacity: 0.9, rough: 0.3 });
  const db = drivebase(k, { tube: goldTube, motorRing: 0xc9962b });
  const side = k.groundSide; // CORAL intake end
  const ex = side * 0.03, ez = 0.14, top = H - 0.02;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt - 0.02, sz * ez], [ex, top, sz * ez], 0.04, goldTube);
    bar(k.visual, [side * (L / 2 - 0.06), bt - 0.01, sz * ez], [ex, bt + 0.42, sz * ez], 0.022, goldTube);
    bar(k.visual, [-side * (L / 2 - 0.08), bt - 0.01, sz * ez], [ex, bt + 0.36, sz * ez], 0.022, goldTube);
  }
  box(k.visual, 0.04, 0.07, 2 * ez + 0.05, white, ex, top - 0.03, 0);
  decal(k.visual, 'FIREFLY', { w: 0.2, h: 0.045, color: '#c8242b', background: '#ffffff', x: ex - side * 0.0205, y: top - 0.03, z: 0, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  for (const sz of [-1, 1]) belt(k.visual, [ex, bt + 0.05], [ex, top - 0.06], sz * (ez - 0.025), 0.016);
  motor(k.visual, ex, bt + 0.05, 0, 0xc9962b);
  // Moving stage + carriage on the front face of the uprights.
  const stage = new THREE.Group(); k.visual.add(stage);
  for (const sz of [-1, 1]) bar(stage, [ex - side * 0.03, bt + 0.06, sz * (ez - 0.01)], [ex - side * 0.03, top - 0.03, sz * (ez - 0.01)], 0.026, goldTube);
  bar(stage, [ex - side * 0.03, top - 0.04, -ez], [ex - side * 0.03, top - 0.04, ez], 0.024, goldTube);
  const carriage = new THREE.Group(); stage.add(carriage);
  box(carriage, 0.012, 0.14, 2 * ez - 0.05, white, ex - side * 0.05, 0, 0);
  // Cycloidal gearbox (gold disc) and the truss arm.
  const la = 0.6, ax = ex - side * 0.08;
  const cyc = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 28), gold);
  cyc.rotation.x = Math.PI / 2; cyc.position.set(ax, 0.03, 0.09); carriage.add(cyc);
  const arm = pivot(carriage, ax, 0.03);
  lattice(arm, [0, -0.025, 0.06], [la - 0.06, 0, 0], [0, 0.05, 0], { cells: 6, w: 0.013, m: gold, zig: true });
  lattice(arm, [0, -0.025, -0.06], [la - 0.06, 0, 0], [0, 0.05, 0], { cells: 6, w: 0.013, m: gold, zig: true });
  // End effector: big white curved claw plates with white wheels.
  const eff = pivot(arm, la - 0.05, 0);
  sidePlates(eff, [[-0.04, -0.08], [0.06, -0.09], [0.13, -0.02], [0.16, 0.08], [0.12, 0.16], [0.09, 0.1], [0.06, 0.04], [-0.04, 0.06]], 0.085, white, [[0.03, -0.01, 0.025]], 0.008);
  box(eff, 0.06, 0.012, 0.17, white, 0.02, -0.075, 0);
  const effWheels = [
    wheelShaft(eff, 0.0, 0.02, { n: 3, r: 0.035, w: 0.022, span: 0.13, colors: [0xdfe3e7] }),
    wheelShaft(eff, 0.09, -0.04, { n: 3, r: 0.03, w: 0.022, span: 0.13, colors: [0xdfe3e7] }),
  ];
  for (const sz of [-1, 1]) fasteners(eff, [[0.1, 0.1], [0.12, 0.03], [-0.02, -0.05]], sz * 0.093);
  const held = pivot(eff, 0.05, -0.01), algaeHeld = pivot(eff,-.14,.08);
  // White diamond-pocketed bellypan over the electronics.
  const pockets: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) for (let j = -2; j <= 2; j++) pockets.push([-side * (0.11 + i * 0.05 + (j & 1) * 0.025), j * 0.05, 0.014]);
  const pan = plate(k.visual, [[-side * 0.06, -(W / 2 - 0.08)], [-side * 0.32, -(W / 2 - 0.08)], [-side * 0.32, W / 2 - 0.08], [-side * 0.06, W / 2 - 0.08]], 0.006, white, 0, pockets);
  pan.rotation.x = Math.PI / 2; pan.position.y = bt + 0.06; // lies flat over the electronics
  battery(k.visual, -side * 0.2, bt - 0.02, 0.14, Math.PI / 2);
  for (let i = 0; i < 3; i++) controller(k.visual, -side * (0.12 + i * 0.065), bt, -0.18, 0x46ca79);
  // CORAL floor intake: white side plates, roller pair.
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: white, rollerMaterial: mat(0xbfc4c9, { metal: 0.3 }) });
  // ALGAE paddles at the other end (two counter-rotating rollers on a gold pivot) and the cage climber beside them.
  const ax2 = -side * (L / 2 - 0.08);
  for (const sz of [-1, 1]) plate(k.visual, [[ax2 - 0.04, bt - 0.02], [ax2 + 0.05, bt - 0.02], [ax2 + 0.02, bt + 0.18], [ax2 - 0.02, bt + 0.18]], 0.008, gold, sz * 0.2);
  const algae = pivot(k.visual, ax2, bt + 0.16);
  for (const sz of [-1, 1]) box(algae, 0.03, 0.28, 0.1, dark, 0, 0.14, sz * 0.12);
  const algaeRollers = [roller(algae, 0.025, 0.36, black, 0, 0.26), roller(algae, 0.025, 0.36, black, -side * 0.04, 0.2)];
  const clz = -(W / 2 - 0.05);
  const climb = pivot(k.visual, -side * (L / 2 - 0.16), bt + 0.05, clz);
  lattice(climb, [-0.02, 0, 0], [0, 0.38, 0], [0.04, 0, 0], { cells: 5, w: 0.012, m: gold, zig: true });
  plate(climb, [[-0.06, 0.32], [0.06, 0.32], [0.08, 0.42], [0.03, 0.4], [0, 0.36], [-0.03, 0.4], [-0.08, 0.42]], 0.01, white);
  let yc = bt + 0.2, phi = 1.2, deploy = 0;
  const yMin = bt + 0.12, yMax = top + 0.58, dir = -side; // single stage: the carriage rides to the top of the raised stage
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[1,0,0], handoffStyle:'fold', algaeAnchor: algaeHeld, algaeGripScale:[.74,.96,.74],
    intakeAnchor: intake.tip,
    lightAt: [ex, top + 0.01, 0],
    update(s) {
      const p = place(s);
      let goal: { yc: number; phi: number };
      // Handoff: the end effector swings back down over the CORAL intake. Stowed: arm up, claw over the elevator.
      if (p.handoff) goal = { yc: bt + 0.3, phi: dir > 0 ? Math.PI + 0.9 : -0.9 };
      else if (stowed(p)) goal = { yc: yMin, phi: dir > 0 ? 1.25 : Math.PI - 1.25 };
      else goal = reachWith(p, dir, ax, la, yMin, yMax);
      yc = scoringApproach(yc, goal.yc, 12, s.dt);
      phi = scoringSlew(phi, goal.phi, ARM_SWING_RATE, s.dt, 9);
      const ext = Math.min(top - bt - 0.25, Math.max(0, yc - (top - 0.14)));
      stage.position.y = ext; carriage.position.y = yc - ext;
      arm.rotation.z = phi;
      eff.rotation.z = -phi + (p.level === 4 ? -1.2 : p.level === 1 ? 0 : -0.5);
      for (const w of effWheels) spin(w, s.intaking ? 22 : s.firing > 0 ? -30 : 0, s.dt);
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt);
      intake.update(s, deploy);
      for (const r of algaeRollers) spin(r, s.intaking ? 20 : 0, s.dt);
      climb.rotation.x = approach(climb.rotation.x, (-1.2) * s.climb, 5, s.dt); // swings out over the side
      db.update(s);
    },
  };
});

export function additionalReefscapeTeamRobots(): TeamRobot[] {
  return [
    { id: 'whisper-1690', team: 1690, name: 'WHISPER',
      description: '1690 Orbit. Center differential elevator whose carbon arm rotates over the top: the rigid vacuum cup scores CORAL and ALGAE on the intake side and its opposite. Spiky floor intake, conveyor to the arm, deep climb. Simulator estimates: 2.2 m/s lift, 0.30 s rel0.35 s harvest and 5.4 m/s drive.',
      source: 'https://www.chiefdelphi.com/t/orbit-1690-2025-robot-reveal-whisper/492064 — reveal, team Q&A; 1690 CAD release; 1690orbit.com 2025 photos',
      config: whisper() },
    { id: 'lightning-2056', team: 2056, name: 'LIGHTNING',
      description: '2056 OP Robotics. 32 × 28 in. Two-stage continuous-belt elevator, truss gripper arm, polycarbonate star-wheel floor intake with a "straightenator" feeding a cradle under the elevator; all REEF levels, NET, PROCESSOR and rope-winch deep climb. 15 ft/s drive; full elevator travel in about 0.6 s. Simulator tuning: 2.5 m/s lift, 0.40 s rel0.45 s harvest.',
      source: 'https://2056.ca/wp-content/uploads/2025/05/OPR25-2056-Technical-Binder.pdf',
      config: config(2056, 'lightning-2056', 2.5, 0.40, 0.45, 4.572, 3.0, 40, [32, 28]) },
    { id: 'firefly-118', team: 118, name: 'Firefly',
      description: '118 Robonauts. 29 in square. Single-stage elevator with a cycloidal-driven arm and a white end effector that takes CORAL from the floor intake and ALGAE from the REEF; separate ALGAE floor rollers; L1–L4, NET, PROCESSOR and deep cage climb. Simulator estimates: 1.9 m/s lift, 0.25 s rel0.30 s harvest, 4.9 m/s drive and 2.0 s climb.',
      source: 'Supplied 00_0000_2025_Firefly.stp; https://www.chiefdelphi.com/t/2025-robonauts-cad-and-code-release/502317 — Firefly technical binder; TBA 2025 photos',
      config: config(118, 'firefly-118', 1.9, 0.25, 0.30, 4.9, 2.0, 40, [29, 29]) },
  ];
}

// Unpublished timings/dimensions are [EST]; 2056 drive speed and frame, 118 frame are from the teams' binders.
function config(team: number, model: string, lift: number, release: number, harvest: number, speed: number, climb: number, height: number, frame?: [number, number]) {
  const c = build({ coral: 'l4', intake: 'ground', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true });
  c.teamNumber = team; c.model = model;
  c.options = { ...c.options, dualPieceStorage: team === 118, coralBuffer: team === 2056 };
  c.height = inch(height); c.maxSpeed = speed;
  if (frame) { c.frameLength = inch(frame[0]); c.frameWidth = inch(frame[1]); }
  c.placement!.liftSpeed = lift; c.placement!.cycleSeconds = release; c.placement!.harvestSeconds = harvest;
  c.climber.secondsToClimb = climb;
  return normalizeReefscapeConfig(c);
}

/** WHISPER scores off both ends (the arm rotates over the top), including the end with its one floor intake. */
function whisper() {
  const c = config(1690, 'whisper-1690', 2.2, 0.30, 0.35, 5.4, 2.5, 36);
  c.placement!.scoreSide = 'sides';
  c.intake.groundYaw = -Math.PI / 2;
  c.frameLength = c.frameWidth = .744; c.height = 1.065;
  c.options = { ...c.options, coralBuffer: true, dualPieceStorage: true };
  return normalizeReefscapeConfig(c);
}
