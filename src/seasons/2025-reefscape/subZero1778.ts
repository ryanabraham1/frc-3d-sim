import { scoringApproach, scoringPosition } from '@engine/robot/scoringReadiness';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, intakeDeployTarget, ledStrip, mat, pivot, registerRobotModel, roller, sidePlates, spin, tubeMat, type ModelKit } from '@engine/robot/models';
import { transferFold } from './transferVisual';
import { lb, wrapAngle } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';

/**
 * 1778 Chill Out SubZero (2025): a belt elevator braced by an A-frame, with a long arm on the carriage that pivots
 * side to side (290° each way from straight down). The arm hangs straight down to take CORAL from the floor intake,
 * which folds up underneath it, then swings up to either side so the robot scores parallel to the REEF face — bumpers
 * resting on the REEF while the arm and elevator move down onto the BRANCH. No climber (the robot was at the weight
 * limit), CORAL waits in the intake while ALGAE occupies the arm (user-specified buffered variant).
 *
 * Sources: Chief Delphi "1778 Chill Out | REEFSCAPE Robot Reveal" and "1778 2025 CAD & Code Release" (CAD renders,
 * team Q&A on the arm range, handoff linebreak, belt elevator, A-frame and weight).
 */

/** Arm length from the carriage pivot to the held CORAL. [EST] from the CAD render. */
const ARM = 0.55;

// ── Model (CAD render): silver perforated 2×1 elevator uprights with an A-frame brace straight back, black belts,
//    a carriage with a big blue arm sprocket, a silver arm tube with a black end effector (black wheels on blue hubs),
//    black-plated floor intake across the front that folds up under the arm; LEDs added for Championships ──
registerRobotModel('subzero-1778', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const silver = tubeMat(0xc4cad1, { metal: 0.75, rough: 0.3 });
  const black = mat(0x141518, { metal: 0.3, rough: 0.6 });
  const blue = mat(0x2a63d4, { metal: 0.5, rough: 0.35 });
  const ICE = 0x6fd3ff;
  const db = drivebase(k, { motorRing: 0x2a63d4 });
  box(k.visual, L * 0.94, 0.008, W * 0.9, mat(0x24272c, { metal: 0.5 }), 0, bt + 0.004, 0);
  // Elevator uprights just off the arm plane (the arm swings across the robot at x = 0), on the side away from the
  // floor intake; the A-frame brace runs from them to the frame rail on that face.
  const away = -k.groundSide;
  const ex = away * 0.08;
  const ez = 0.15;
  for (const sz of [-1, 1]) {
    bar(k.visual, [ex, bt, sz * ez], [ex, H - 0.02, sz * ez], 0.04, silver);
    bar(k.visual, [ex + away * 0.005, bt + 0.05, sz * (ez - 0.03)], [ex + away * 0.005, H - 0.05, sz * (ez - 0.03)], 0.01, black); // belt
    // A-frame brace running straight out to the frame rail.
    bar(k.visual, [ex + away * 0.01, H * 0.82, sz * ez], [away * (L / 2 - 0.04), bt + 0.01, sz * ez], 0.028, silver);
    ledStrip(k.visual, [ex - away * 0.022, bt + 0.06, sz * ez], [ex - away * 0.022, H - 0.06, sz * ez], ICE);
  }
  bar(k.visual, [ex, H - 0.02, -ez], [ex, H - 0.02, ez], 0.035, silver);
  bar(k.visual, [away * (L / 2 - 0.04), bt + 0.02, -ez], [away * (L / 2 - 0.04), bt + 0.02, ez], 0.03, silver);
  for (const sz of [-1, 1]) decal(k.visual, 'CHILL OUT 1778', { w: 0.2, h: 0.035, x: away * L * 0.28, y: bt + 0.12, z: sz * (ez + 0.016), rotY: sz > 0 ? 0 : Math.PI, background: '#2a3f9e' });
  // Two cascading stages (each rides half the extension of the next) so the elevator stays overlapped at L4.
  const stages: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    k.visual.add(g);
    const sx = ex - away * 0.03 * (i + 1), iz = ez - 0.03 * (i + 1);
    for (const sz of [-1, 1]) bar(g, [sx, bt + 0.06, sz * iz], [sx, H - 0.04, sz * iz], 0.03 - i * 0.004, silver);
    bar(g, [sx, H - 0.04, -iz], [sx, H - 0.04, iz], 0.024, silver);
    stages.push(g);
  }
  // Carriage: black plate with the big blue arm sprocket; the arm pivots about the robot's long (x) axis.
  const carriage = new THREE.Group();
  k.visual.add(carriage);
  box(carriage, 0.03, 0.2, 0.26, black, ex - away * 0.06, 0, 0);
  const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 30), blue);
  sprocket.rotation.z = Math.PI / 2;
  sprocket.position.x = ex - away * 0.04;
  carriage.add(sprocket);
  const arm = pivot(carriage, 0, 0);
  // Built hanging straight down (-y); rotation.x swings it out (positive = robot left, -z).
  const tubeR = 0.026;
  const armTube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, ARM - 0.06, 14), silver);
  armTube.position.y = -(ARM - 0.06) / 2;
  arm.add(armTube);
  box(arm, 0.05, 0.05, 0.05, black, 0, 0, 0); // pivot hub
  // End effector: black side plates and wheels on blue hubs that clamp the CORAL across the arm's end.
  // Supplied CAD: the claw sits 0.24 m aft of the arm on a cross plate, so it releases aft of center
  // (placement.toolOffset).
  const head = pivot(arm, -0.24, -ARM);
  bar(arm, [0, -ARM + 0.03, 0], [-0.24, -ARM + 0.03, 0], 0.02, silver);
  sidePlates(head, [[-0.07, -0.03], [0.07, -0.03], [0.08, 0.07], [-0.08, 0.07]], 0.12, black, [[0, 0.03, 0.02]]);
  const wheels = [roller(head, 0.03, 0.22, black, -0.045, 0.045), roller(head, 0.03, 0.22, black, 0.045, 0.045)];
  for (const w of wheels) for (const z of [-0.06, 0.06]) roller(w, 0.018, 0.02, blue, 0, 0, z);
  // Match/CAD photos: the tube crosses the hanging arm, seated below
  // the pair of rollers; ALGAE sits farther out in the same open claw.
  const held = pivot(head, 0, 0), algaeHeld = pivot(head, 0, -.19);
  // Floor intake across the front: folds up and back under the arm to hand the CORAL off.
  const intake = deployableIntake(k, { reach: c.intake.reach, hingeY: bt + 0.12, rollers: 2, frame: black, stow: Math.PI - 0.45 });
  let lift = 0.97;
  let swing = 0;
  let deploy = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis:[0,0,1], algaeAnchor: algaeHeld, algaeGripScale:[.94,1,.94], handoffStyle: 'fold',
    intakeAnchor: intake.tip,
    lightAt: [ex, H + 0.02, 0],
    update(s) {
      const p = s.place ?? { height: 0.45, forward: 0.3, level: 1 };
      const side = p.side ?? 0;
      const handoff = (p.handoff ?? 0) > 0;
      // Arm angle from straight down: reach the rules' end effector out of the scoring side — below the pivot for
      // L1–L3 (CORAL pointing down onto the BRANCH), up and over for L4. Otherwise (handoff, driving) it hangs
      // straight down, tucked inside the frame.
      let theta = 0;
      if (side !== 0 && !handoff) {
        const t = Math.asin(Math.min(1, Math.max(0, p.forward / ARM)));
        theta = side * (p.level === 4 ? Math.PI - t : t);
      }
      swing += wrapAngle(theta - swing) * Math.min(1, 12 * s.dt);
      scoringPosition(swing,theta);
      arm.rotation.x = swing;
      // SubZero raises its intake while the receiving arm hangs down.
      // Drive folding from transfer progress so even a short handoff reaches
      // the meeting pose before the piece leaves the roller bank.
      deploy = handoff ? 1 - transferFold(p.handoff!) : approach(deploy, intakeDeployTarget(s), 8, s.dt);
      intake.update(s, deploy);
      k.visual.updateMatrixWorld(true);
      const transferY = k.visual.worldToLocal(intake.tip.getWorldPosition(new THREE.Vector3())).y;
      // Carriage height that puts the end effector at the rules' height.
      lift = scoringApproach(lift, Math.max(bt + 0.32, (handoff ? transferY : p.height) + Math.cos(swing) * ARM), 14, s.dt);
      carriage.position.y = lift;
      const ext = Math.max(0, lift + 0.12 - (H - 0.04));
      stages[0].position.y = ext / 2;
      stages[1].position.y = ext;
      const spinRate = s.intaking ? 22 : s.firing > 0 ? -30 : 0;
      for (const w of wheels) spin(w, spinRate, s.dt);
      db.update(s);
    },
  };
});

export function subZero1778(): TeamRobot {
  const config = build({ coral: 'l4', intake: 'ground', algae: 'reef', algaeScore: 'both', climb: 0, align: true });
  config.teamNumber = 1778;
  config.model = 'subzero-1778';
  config.options = { ...config.options, coralBuffer: true, coralBufferLocation: 'intake', dualPieceStorage: true };
  config.placement!.scoreSide = 'sides';
  config.placement!.toolOffset = [-0.24, 0]; // supplied CAD: the arm hangs behind the elevator, its claw 24 cm aft of center
  config.placement!.handoffSeconds = 0.35; // [EST] linebreak-triggered: the CORAL is centered by the time the intake is up
  config.placement!.cycleSeconds = 0.4; // [EST] "some of the fastest CORAL scoring in the world"
  config.placement!.liftSpeed = 1.8; // [EST]
  // The arm scores out of both sides, so front/back is only a label: the floor intake keeps the usual back face and
  // the A-frame brace runs to the other one.
  config.mass = lb(115); // at the weight limit
  return {
    id: 'subzero-1778', team: 1778, name: 'SubZero',
    description: '1778 Chill Out (46-7, 14th worldwide). Belt elevator with an arm that swings 290° to either side: scores L1–L4 out of whichever side faces the REEF while parked parallel to it. Floor intake folds up and hands CORAL to the arm hanging straight down. Holds CORAL in its intake while the arm handles ALGAE; ALGAE must leave before the CORAL handoff. No climber (at the weight limit).',
    source: 'Chief Delphi "1778 Chill Out | REEFSCAPE Robot Reveal" and "1778 2025 CAD & Code Release"',
    config: normalizeReefscapeConfig(config),
  };
}
