import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, drivebase, ledStrip, mat, pivot, plate, registerRobotModel, roller, sidePlates, spin, tube, tubeMat, underBumperIntake, wheelShaft, overRollers, underBumperEntry, type ModelKit } from '@engine/robot/models';
import { inch, lb } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

/**
 * 2056 OP Robotics LOW-KEY (2024). Source: Orchard Park Robotics 2024 Crescendo Technical Binder (2056.ca) and the
 * Chief Delphi "Team 2056 OP Robotics - 2024 Technical Binder Release" thread.
 *
 * Under-the-bumper intake whose conveyor hands the NOTE up into a shooter on a single-jointed 17 in shoulder arm
 * (~107:1, Kraken X60), pivoting on a solid dead axle at the top of a short tower so the robot fits under the STAGE.
 * 4 in flywheels top and bottom, left/right pairs at 8000/4000 RPM for spin; the arm angle follows the Limelight
 * distance and the chassis snaps its heading to the SPEAKER, AMP or pass. Pneumatic double hook (two 1½ in bore, 10 in
 * stroke cylinders, ~200 lb) for the chain; no TRAP. SDS MK4i L3, 16 ft/s, 124 lb.
 */

// ── Model (binder photos): white triangular tower plates covered in sponsor logos with an LED strip on the front edge,
//    black 3D-printed shoulder gearbox covers, a raw-aluminum pocketed shooter box with blue stealth flywheels on the
//    arm, riveted aluminum baseplate, two silver pneumatic cylinders with a hook plate ──
registerRobotModel('lowkey-2056', (k: ModelKit) => {
  const c = k.config;
  const L = c.frameLength;
  const W = c.frameWidth;
  const H = c.height;
  const bt = c.bumperTop;
  const white = mat(0xf2f3f5, { metal: 0.05, rough: 0.6 });
  const silver = mat(0xc6ccd3, { metal: 0.75, rough: 0.3 });
  const silverTube = tubeMat(0xc6ccd3);
  const black = mat(0x121315, { metal: 0.25, rough: 0.65 });
  const blue = mat(0x2a6fe0, { metal: 0.2, rough: 0.5 });
  const base = drivebase(k, { motorRing: 0x2a6fe0 });
  const intake = underBumperIntake(k, { n: 3 });
  const deckY = bt + 0.004;
  box(k.visual, L * 0.95, 0.006, W * 0.92, silver, 0, deckY, 0); // riveted 1/8 in baseplate
  for (let i = 0; i < 9; i++) for (const sz of [-1, 1]) box(k.visual, 0.012, 0.004, 0.012, mat(0x9aa1a9, { metal: 0.8 }), -L * 0.44 + i * L * 0.11, deckY + 0.004, sz * W * 0.44);
  box(k.visual, L * 0.4, 0.004, W * 0.6, mat(0xdfe6ec, { opacity: 0.35 }), L * 0.12, deckY + 0.05, 0); // polycarbonate electronics cover
  // Tower: white triangular plates rising to the shoulder axle near the back (the intake / conveyor side).
  const px = -L * 0.16;
  const py = H - 0.03;
  const tz = 0.17;
  const tri: [number, number][] = [[-L / 2 + 0.05, bt], [L * 0.22, bt], [px + 0.05, py + 0.03], [px - 0.05, py + 0.03]];
  for (const sz of [-1, 1]) {
    plate(k.visual, tri, 0.006, white, sz * tz);
    // Sponsor logos on the outside face.
    const out = sz * (tz + 0.004);
    const rotY = sz > 0 ? 0 : Math.PI;
    decal(k.visual, 'SDS', { w: 0.07, h: 0.07, round: true, background: '#ffffff', color: '#111111', x: px - 0.02, y: py - 0.12, z: out, rotY });
    decal(k.visual, 'gm', { w: 0.07, h: 0.07, background: '#1a63c9', x: -L * 0.3, y: bt + 0.1, z: out, rotY });
    decal(k.visual, 'WCP', { w: 0.065, h: 0.065, round: true, background: '#1a63c9', x: -L * 0.12, y: bt + 0.16, z: out, rotY });
    decal(k.visual, 'BARLOW', { w: 0.12, h: 0.03, background: '#ffffff', color: '#1b1b1b', x: L * 0.06, y: bt + 0.1, z: out, rotY });
    decal(k.visual, 'Westbrook', { w: 0.12, h: 0.025, background: '#ffffff', color: '#1f8a4c', x: L * 0.06, y: bt + 0.05, z: out, rotY });
    ledStrip(k.visual, [L * 0.21, bt + 0.02, sz * (tz + 0.006)], [px + 0.05, py + 0.02, sz * (tz + 0.006)], k.alliance === 'red' ? 0xff3b3b : 0x3b7bff);
    // Black shoulder gearbox cover outside the plate.
    box(k.visual, 0.1, 0.12, 0.05, black, px, py - 0.04, sz * (tz + 0.03));
  }
  tube(k.visual, [px, py, -tz - 0.05], [px, py, tz + 0.05], 0.011, silver); // solid 7/8 in dead axle
  for (const x of [-L / 2 + 0.08, L * 0.18]) bar(k.visual, [x, bt + 0.02, -tz], [x, bt + 0.02, tz], 0.025, silverTube);
  // Conveyor: blue sushi rollers carrying the NOTE from the back intake up to the shooter's mouth at the axle.
  const conveyor: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) conveyor.push(roller(k.visual, 0.0127, 0.3, blue, -L / 2 + 0.07 + i * 0.05, bt + 0.06 + i * 0.07, 0));
  // Shooter box on the 17 in arm: pocketed aluminum side rails, flywheels at the far end, feed rollers inboard.
  const arm = pivot(k.visual, px, py);
  const armLen = inch(17);
  sidePlates(arm, [[-0.04, -0.06], [armLen, -0.07], [armLen + 0.05, 0.0], [armLen, 0.07], [-0.04, 0.05]], 0.15, silver,
    [[0.06, 0, 0.025], [0.15, 0, 0.03], [0.25, 0, 0.03], [0.34, 0, 0.025]]);
  for (const [x, y] of [[0.0, -0.05], [0.0, 0.04], [armLen - 0.02, -0.06]] as const) box(arm, 0.018, 0.018, 0.3, silver, x, y, 0);
  const flywheels = [
    wheelShaft(arm, armLen, 0.042, { n: 2, r: inch(2), w: 0.04, span: 0.24, colors: [0x2a6fe0] }),
    wheelShaft(arm, armLen, -0.042, { n: 2, r: inch(2), w: 0.04, span: 0.24, colors: [0x2a6fe0] }),
  ];
  const feed = [roller(arm, 0.0127, 0.28, blue, 0.08, 0), roller(arm, 0.0127, 0.28, blue, 0.2, 0)];
  box(arm, armLen, 0.006, 0.28, mat(0x7f8892, { metal: 0.4 }), armLen / 2, -0.055, 0);
  const held = pivot(arm, 0.18, 0);
  // Pneumatic hanger: two silver cylinders with the machined double-hook plate on their rods.
  const hx = L * 0.08;
  for (const sz of [-1, 1]) tube(k.visual, [hx, deckY, sz * 0.05], [hx, H - 0.08, sz * 0.05], 0.022, silver);
  const hanger = new THREE.Group();
  k.visual.add(hanger);
  for (const sz of [-1, 1]) tube(hanger, [hx, H - 0.25, sz * 0.05], [hx, H - 0.02, sz * 0.05], 0.008, silver);
  box(hanger, 0.04, 0.03, 0.16, black, hx, H - 0.02, 0);
  for (const dz of [-0.05, 0.05]) {
    box(hanger, 0.012, 0.09, 0.025, silver, hx, H + 0.025, dz);
    box(hanger, 0.05, 0.012, 0.025, silver, hx - 0.02, H + 0.065, dz); // hook lip opening toward the back
  }
  let ang = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held,
    lightAt: [px, py + 0.06, 0],
    // Under the bumper, up the blue sushi-roller conveyor to the shooter mouth at the axle, along the feed rollers.
    flow: { intake: () => [...underBumperEntry(k, inch(1)), ...overRollers(k, conveyor, 0.03), ...overRollers(k, feed, 0.02)] },
    update(s) {
      base.update(s);
      intake.update(s);
      // Home: arm down so the shooter mouth meets the conveyor. Holding a NOTE it tracks the shot angle; AMP raises
      // it past vertical to drop the NOTE in; the climber hook stows it flat.
      const target = s.climb > 0.2 ? 0 : (s.amp ?? s.passing) ? 1.75 : s.fill > 0 && s.enabled ? Math.min(1.1, s.hood) : s.firing > 0 ? s.hood : 0.12;
      ang = approach(ang, target, 8, s.dt);
      arm.rotation.z = ang;
      const fs = s.enabled ? 40 + 50 * s.firing : 0;
      flywheels[0].rotation.z -= fs * s.dt;
      flywheels[1].rotation.z += fs * s.dt;
      for (const r of feed) spin(r, s.intaking || s.firing > 0 ? -22 : 0, s.dt);
      // Cylinders extend (rods up) to reach the chain, then retract to lift the robot.
      hanger.position.y = approach(hanger.position.y, s.climb > 0.5 ? inch(10) : s.climb > 0.1 ? inch(2) : 0, 10, s.dt);
    },
  };
});

export function lowKey2056(): TeamRobot {
  const c = build({ ground: true, source: true, shooter: 'pivot', aim: 'align', amp: true, climb: 1 });
  c.teamNumber = 2056;
  c.model = 'lowkey-2056';
  c.mass = lb(124);
  c.maxSpeed = 4.88; // 16 ft/s (SDS MK4i L3, Kraken X60)
  c.height = inch(24); // [EST] "short enough to fit under the STAGE"
  c.launcher.height = inch(22); // [EST] shoulder axle at the top of the tower
  c.climber.secondsPerLevel = 1.2; // [EST] pneumatic, quick-exhaust valves: "pretty fast"
  return {
    id: 'lowkey-2056', team: 2056, name: 'LOW-KEY',
    description: '2056 OP Robotics. Under-bumper intake conveys the NOTE up into a shooter on a 17 in shoulder arm (fits under the STAGE); arm angle tracks distance while the chassis snaps to the SPEAKER, AMP or pass heading. Spin from 8000/4000 RPM flywheel pairs, pneumatic double-hook chain climb, no TRAP. 16 ft/s, 124 lb.',
    source: 'OP Robotics 2024 Crescendo Technical Binder (2056.ca); Chief Delphi "Team 2056 OP Robotics - 2024 Technical Binder Release"',
    config: normalizeCrescendoConfig(c),
  };
}
