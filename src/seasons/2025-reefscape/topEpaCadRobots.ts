import type { TeamRobot } from '@engine/core/season';
import { approach, bar, deployableIntake, drivebase, intakeDeployTarget, mat, pivot, registerRobotModel, sidePlates, spin, tubeMat, wheelShaft, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';
import { inch } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';
import { place, reachWith, stowed } from './additionalTeamRobots';

/**
 * Public Onshape releases of the next five 2025 teams by EPA (Spectrum CAD Collection). The imported CAD rigs are in
 * `src/engine/robot/<name>CadModel.ts`; these light procedural builders are the headless / no-asset fallback and
 * follow the same layout (intake end, scoring end, climber side). Unpublished rates are simulator estimates.
 */

// ── 5940 BREAD Taiyaki: left-side cascade elevator, pivoting CORAL+ALGAE effector, rear floor intake, right climber ──
registerRobotModel('taiyaki-5940', (k: ModelKit) => {
  const silver = tubeMat(0xb9bec4), black = mat(0x1a1b1e, { metal: .3, rough: .5 }), db = drivebase(k, { tube: silver });
  const ex = .19, ez = -.13, bt = k.config.bumperTop, la = .43, y0 = .25;
  for (const z of [ez - .07, ez + .07]) bar(k.visual, [ex, bt, z], [ex, 1.04, z], .035, silver);
  const carriage = pivot(k.visual, ex, y0, -.095), head = pivot(carriage, 0, 0);
  sidePlates(head, [[0, -.03], [la, -.03], [la, .03], [0, .03]], .05, black);
  sidePlates(head, [[.05, .2], [.36, .2], [.36, .26], [.05, .26]], .05, black);
  const wheels = wheelShaft(head, la, 0, { n: 2, r: .025, w: .02, span: .07, colors: [0x2a2c2f] });
  const held = pivot(head, la, 0, .095), algae = pivot(head, .17, -.41, .25);
  const intake = deployableIntake(k, { reach: k.config.intake.reach, rollers: 2, frame: black, rollerMaterial: mat(0x222326) });
  const climb = pivot(k.visual, .03, .44, .34);
  bar(climb, [0, 0, 0], [0, .28, 0], .03, mat(0xc0362c));
  let deploy = 0, yc = y0, phi = Math.PI / 2;
  return { replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis: [0, 0, 1], handoffStyle: 'conveyor', algaeAnchor: algae, algaeGripScale: [.8, .96, .8], intakeAnchor: intake.tip,
    update(s) {
      const p = place(s), goal = stowed(p) || p.handoff ? { yc: y0, phi: Math.PI / 2 } : reachWith(p, 1, ex, la, y0, y0 + 1.62);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      carriage.position.y = yc; head.rotation.z = phi;
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt); intake.update(s, deploy);
      spin(wheels, s.intaking ? 20 : s.firing > 0 ? -30 : 0, s.dt);
      climb.rotation.x = approach(climb.rotation.x, 1.1 * Math.max(0, (s.climb - .25) / .75), 5, s.dt); db.update(s);
    } };
});

// ── 422 Wisp: continuous 3-stage elevator with a fixed wrist-less manipulator, rear funnel + flip-up floor arm, right climber ──
registerRobotModel('wisp-422', (k: ModelKit) => {
  const silver = tubeMat(0xc4c8cc), green = mat(0x2f9d4a, { rough: .6 }), black = mat(0x1a1b1e, { metal: .3, rough: .5 }), db = drivebase(k, { tube: silver });
  const bt = k.config.bumperTop, y0 = .0;
  for (const z of [-.2, .2]) bar(k.visual, [.02, bt, z], [.02, .95, z], .03, silver);
  const carriage = pivot(k.visual, .02, y0);
  sidePlates(carriage, [[0, .1], [.3, .1], [.3, .36], [0, .36]], .12, black);
  const wheels = wheelShaft(carriage, .24, .3, { n: 4, r: .038, w: .02, span: .2, colors: [0x2f9d4a] });
  const held = pivot(carriage, .2, .24), algae = pivot(carriage, .4, .5);
  sidePlates(k.visual, [[-.38, .45], [-.12, .3], [-.12, .62], [-.38, .8]], .18, mat(0xd8e6ee, { opacity: .45 }));
  const intake = deployableIntake(k, { reach: k.config.intake.reach, rollers: 1, frame: green, rollerMaterial: black });
  const climb = pivot(k.visual, -.05, .41, .34);
  bar(climb, [0, 0, 0], [0, .2, -.1], .03, black);
  let deploy = 0, yc = y0, hx = .2;
  return { replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis: [0, 0, 1], handoffStyle: 'fold', algaeAnchor: algae, algaeGripScale: [.82, .94, .82], intakeAnchor: intake.tip,
    update(s) {
      const p = place(s), down = stowed(p) || !!p.handoff;
      // No wrist: the elevator alone sets the height; the held marker follows the release point out over the bumper.
      yc = approach(yc, down ? y0 : THREE.MathUtils.clamp(p.height - (p.algae ? .5 : .24), 0, 1.6), 12, s.dt); carriage.position.y = yc;
      hx = approach(hx, down ? .2 : Math.max(.2, p.forward), 12, s.dt); held.position.x = hx;
      deploy = approach(deploy, intakeDeployTarget(s), 7, s.dt); intake.update(s, deploy);
      spin(wheels, s.intaking ? 20 : s.firing > 0 ? -30 : 0, s.dt);
      climb.rotation.x = approach(climb.rotation.x, 1.5 * Math.max(0, (s.climb - .25) / .75), 5, s.dt); db.update(s);
    } };
});

// ── 1706 Singularity: three-stage elevator + pivoting CORAL/ALGAE arm, rear funnel, front floor-ALGAE roller, rear harpoon ──
registerRobotModel('singularity-1706', (k: ModelKit) => {
  const silver = tubeMat(0xc0c4c8), black = mat(0x1b1c1f, { metal: .3, rough: .5 }), db = drivebase(k, { tube: silver });
  const ex = .076, bt = k.config.bumperTop, y0 = .37, la = .44; // la: arm pivot to the CORAL leaving the channel exit
  for (const z of [-.24, .24]) bar(k.visual, [ex, bt, z], [ex, .91, z], .03, silver);
  const carriage = pivot(k.visual, ex, y0), arm = pivot(carriage, 0, 0);
  sidePlates(arm, [[0, -.04], [la, -.04], [la, .04], [0, .04]], .065, black);
  const wheels = wheelShaft(arm, la - .05, 0, { n: 2, r: .025, w: .02, span: .05, colors: [0x2a2c2f] });
  const held = pivot(arm, la, 0), algae = pivot(arm, .3, .2);
  sidePlates(k.visual, [[-.5, .82], [-.08, .42], [-.08, .5], [-.5, .9]], .2, mat(0xd8e6ee, { opacity: .45 }));
  const roller = pivot(k.visual, .3, .38);
  bar(roller, [0, 0, -.22], [0, 0, .22], .016, black);
  const climb = pivot(k.visual, -.3, .46);
  bar(climb, [0, 0, 0], [-.14, .06, 0], .03, silver);
  let yc = y0, phi = -.7, out = 0;
  return { replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis: [1, 0, 0], handoffStyle: 'direct', algaeAnchor: algae, algaeGripScale: [.8, .96, .8], intakeAnchor: held,
    update(s) {
      const p = place(s), goal = stowed(p) ? { yc: y0, phi: -.7 } : reachWith(p, 1, ex, la, y0, y0 + 1.8);
      yc = approach(yc, goal.yc, 12, s.dt); phi = approach(phi, goal.phi, 9, s.dt);
      carriage.position.y = yc; arm.rotation.z = phi;
      out = approach(out, s.intaking && stowed(p) ? .43 : 0, 6, s.dt); roller.position.x = .3 + out;
      spin(wheels, s.intaking ? 20 : s.firing > 0 ? -30 : 0, s.dt);
      climb.rotation.z = approach(climb.rotation.z, .7 * Math.max(0, (s.climb - .25) / .75), 5, s.dt); db.update(s);
    } };
});

// ── 3005 Relay: three-stage chain elevator carrying a laterator with a CORAL ejector and a pivoting ALGAE gripper ──
registerRobotModel('relay-3005', (k: ModelKit) => {
  const black = mat(0x1a1b1e, { metal: .3, rough: .5 }), grey = tubeMat(0x3a3d42), db = drivebase(k, { tube: grey });
  const bt = k.config.bumperTop, ex = -.02, y0 = 0;
  for (const z of [-.3, .3]) bar(k.visual, [ex, bt, z], [ex, 1.04, z], .035, black);
  const carriage = pivot(k.visual, ex, y0);
  sidePlates(carriage, [[0, .15], [.3, .15], [.3, .42], [0, .42]], .085, black);
  const rollers = wheelShaft(carriage, .2, .2, { n: 1, r: .023, w: .04, span: 0, colors: [0x2a2c2f] });
  const held = pivot(carriage, .15, .3);
  const gripper = pivot(carriage, .33, .41);
  for (const z of [-.19, .19]) bar(gripper, [0, 0, z], [-.2, .33, z], .025, grey);
  const algae = pivot(gripper, -.25, .39);
  const climb = pivot(k.visual, .03, .46, .32);
  bar(climb, [0, 0, 0], [0, .12, -.22], .03, black);
  let yc = y0, hx = .15, tilt = 0;
  return { replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis: [.908, -.419, 0], handoffStyle: 'direct', algaeAnchor: algae, algaeGripScale: [.8, .96, .8], intakeAnchor: held,
    update(s) {
      const p = place(s), down = stowed(p);
      yc = approach(yc, down ? y0 : THREE.MathUtils.clamp(p.height - (p.algae ? .77 : .3), 0, 1.75), 12, s.dt); carriage.position.y = yc;
      hx = approach(hx, down ? .15 : Math.max(.15, p.forward), 12, s.dt); held.position.x = hx;
      tilt = approach(tilt, p.algae ? -1.2 : 0, 7, s.dt); gripper.rotation.z = tilt;
      spin(rollers, s.intaking ? 20 : s.firing > 0 ? -30 : 0, s.dt);
      climb.rotation.x = approach(climb.rotation.x, 1.6 * Math.max(0, (s.climb - .25) / .75), 5, s.dt); db.update(s);
    } };
});

// ── 190 Redundancy: two-stage elevator with "Gustav" CORAL effector and ALGAE claw, rear clapping funnel, front ALGAE roller ──
registerRobotModel('redundancy-190', (k: ModelKit) => {
  const black = mat(0x18191b, { metal: .3, rough: .5 }), red = mat(0xc4242b, { rough: .5 }), db = drivebase(k, { tube: black });
  const bt = k.config.bumperTop, ex = .11, y0 = 0;
  for (const z of [-.22, .22]) bar(k.visual, [ex, bt, z], [ex, 1.06, z], .03, black);
  const carriage = pivot(k.visual, ex, y0);
  sidePlates(carriage, [[-.03, .16], [.21, .16], [.21, .71], [-.03, .71]], .06, red);
  const star = wheelShaft(carriage, .14, .66, { n: 2, r: .05, w: .015, span: .04, colors: [0x2f9d4a] });
  const held = pivot(carriage, .09, .52), claw = pivot(carriage, .02, .69);
  for (const z of [-.1, .1]) bar(claw, [0, 0, z], [.15, -.61, z], .025, black);
  const algae = pivot(claw, .31, -.39);
  sidePlates(k.visual, [[-.36, .95], [-.05, .6], [-.05, .7], [-.36, 1.04]], .2, mat(0xd8e6ee, { opacity: .45 }));
  const roller = pivot(k.visual, .35, .46);
  bar(roller, [0, 0, -.3], [0, 0, .3], .02, red);
  const climb = pivot(k.visual, -.22, .13);
  bar(climb, [0, 0, 0], [.04, .45, 0], .03, red);
  let yc = y0, hx = .09, tilt = 0, out = 0;
  return { replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'], heldAnchor: held, coralAxis: [.905, -.426, 0], handoffStyle: 'direct', algaeAnchor: algae, algaeGripScale: [.8, .96, .8], intakeAnchor: held,
    update(s) {
      const p = place(s), down = stowed(p);
      yc = approach(yc, down ? y0 : THREE.MathUtils.clamp(p.height - (p.algae ? .62 : .52), 0, 1.5), 12, s.dt); carriage.position.y = yc;
      hx = approach(hx, down ? .09 : Math.max(.09, p.forward - ex), 12, s.dt); held.position.x = hx;
      tilt = approach(tilt, p.algae ? .9 : 0, 7, s.dt); claw.rotation.z = tilt;
      out = approach(out, s.intaking && down ? .25 : 0, 6, s.dt); roller.position.x = .35 + out;
      spin(star, s.firing > 0 ? -30 : 0, s.dt);
      climb.rotation.z = approach(climb.rotation.z, 1.2 * Math.max(0, (s.climb - .25) / .75), 5, s.dt); db.update(s);
    } };
});

function team(teamNumber: number, model: string, o: { frame: [number, number]; height: number; lift: number; release: number; harvest: number; speed: number; climb: number; intake: 'ground' | 'funnel' | 'both'; algae: 'reef' | 'reefGround'; algaeScore: 'processor' | 'net' | 'both'; storage: 'shared' | 'separate' | 'buffered'; floorAlgaeFront?: boolean }) {
  const c = build({ coral: 'l4', intake: o.intake, algae: o.algae, algaeScore: o.algaeScore, climb: 2, align: true, speed: o.speed });
  c.teamNumber = teamNumber; c.model = model;
  c.frameLength = inch(o.frame[0]); c.frameWidth = inch(o.frame[1]); c.height = o.height;
  c.options = { ...c.options, dualPieceStorage: o.storage !== 'shared', coralBuffer: o.storage === 'buffered' };
  c.placement!.liftSpeed = o.lift; c.placement!.cycleSeconds = o.release; c.placement!.harvestSeconds = o.harvest;
  c.climber.secondsToClimb = o.climb;
  if (o.floorAlgaeFront) c.intake.groundYaw = 0; // floor ALGAE enters the front roller; CORAL stays station-fed
  return normalizeReefscapeConfig(c);
}

export function topEpaCadRobots(): TeamRobot[] {
  return [
    { id: 'taiyaki-5940', team: 5940, name: 'Taiyaki',
      description: '5940 BREAD. 29.5 in square. Two-stage cascade elevator (full height in 0.5 s) carrying a pivoting single-motor end effector with CORAL fingers beside an ALGAE claw, so it can hold one of each. Full-width rear floor intake and star-wheel indexer, torsion-spring deep-cage climber (1.5 s lift). 15 ft/s drive. Cycle and harvest times are simulator estimates.',
      source: 'Public Onshape "5940 BREAD 2025 - Taiyaki" https://cad.onshape.com/documents/96a5f9f437337066b2987626; CAD release and technical binder https://www.chiefdelphi.com/t/501347',
      config: team(5940, 'taiyaki-5940', { frame: [29.5, 29.5], height: 1.06, lift: 2.5, release: .3, harvest: .35, speed: 4.57, climb: 1.5, intake: 'ground', algae: 'reef', algaeScore: 'both', storage: 'separate' }) },
    { id: 'wisp-422', team: 422, name: 'Wisp',
      description: '422 Mech Tech Dragons. About 28.5 in square (CAD). Continuous-belt three-stage elevator carrying a fixed manipulator (no wrist) that ejects CORAL lying across the robot and pins ALGAE under its upper wheels. Rear station funnel plus a star-wheel floor arm that flips CORAL up into the funnel, right-side hook climber. Rates are simulator estimates (the linked binder was removed).',
      source: 'Public Onshape "Wisp Public" (Main Assembly) https://cad.onshape.com/documents/2bae4024a467119e47dc96b0; CAD release https://www.chiefdelphi.com/t/501340, reveal https://www.chiefdelphi.com/t/497928',
      config: team(422, 'wisp-422', { frame: [28.5, 28.5], height: .952, lift: 2.2, release: .35, harvest: .4, speed: 4.6, climb: 2, intake: 'both', algae: 'reef', algaeScore: 'both', storage: 'shared' }) },
    { id: 'singularity-1706', team: 1706, name: 'Singularity',
      description: '1706 Ratchet Rockers. About 28 in square (CAD). Three-stage elevator carrying a pivoting arm with a narrow CORAL channel and ALGAE wheels on its front face, so it can hold one of each. CORAL comes only from the rear station funnel; a front over-the-bumper roller collects floor ALGAE. Rear "harpoon" cage climber with rollers. Rates are simulator estimates.',
      source: 'Public Onshape "RS-000 Singularity - Public Release" https://cad.onshape.com/documents/4b02abefda59b1f999042049; CAD/code release https://www.chiefdelphi.com/t/510177',
      config: team(1706, 'singularity-1706', { frame: [28.1, 28.1], height: .986, lift: 2.2, release: .35, harvest: .4, speed: 4.6, climb: 2, intake: 'funnel', algae: 'reefGround', algaeScore: 'both', storage: 'separate', floorAlgaeFront: true }) },
    { id: 'relay-3005', team: 3005, name: 'Relay',
      description: '3005 RoboChargers. About 29 in square (CAD). Three-stage continuous-chain elevator carrying a "laterator" (sideways slide) with a CORAL ejector and a pivoting ALGAE gripper, so it holds one of each. CORAL is fed from the rear station chute up through the elevator. Right-side deep-cage hook climber. Rates are simulator estimates.',
      source: 'Public Onshape "3005 2025: FULL ROBOT (PUBLIC)" https://cad.onshape.com/documents/be7ecb57773083221899273d; CAD release https://www.chiefdelphi.com/t/504887, reveal https://www.chiefdelphi.com/t/493529',
      config: team(3005, 'relay-3005', { frame: [29.2, 29.2], height: 1.04, lift: 2.2, release: .3, harvest: .4, speed: 4.6, climb: 2, intake: 'funnel', algae: 'reef', algaeScore: 'both', storage: 'separate' }) },
    { id: 'redundancy-190', team: 190, name: 'Redundancy',
      description: '190 Gompei and the H.E.R.D. (V2). About 28 in square (CAD). Two-stage elevator with "Gustav", a CORAL end effector whose star wheels flip CORAL onto L4, and an ALGAE claw. Rear "clapping" station funnel, front over-the-bumper roller for floor ALGAE, gas-spring grappling-hook climber at the back. Rates are simulator estimates.',
      source: 'Public Onshape "A-25B-0000" (V2 Redundancy) https://frc190.onshape.com/documents/b6c840749d995b1ac1b29215; CAD release https://www.chiefdelphi.com/t/503355, reveal https://www.chiefdelphi.com/t/493653',
      config: team(190, 'redundancy-190', { frame: [28, 28], height: 1.063, lift: 2.4, release: .3, harvest: .4, speed: 4.6, climb: 2, intake: 'funnel', algae: 'reefGround', algaeScore: 'both', storage: 'separate', floorAlgaeFront: true }) },
  ];
}
