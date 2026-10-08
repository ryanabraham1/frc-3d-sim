import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, fillBlock, flowAt, hopperStow, hopperWalls, mat, overBumperIntake, registerRobotModel, roller, spin, tubeMat, type ModelKit } from '@engine/robot/models';
import { turretShooter } from '@engine/robot/turretShooter';
import { flatNet } from '@engine/robot/rebuiltCadKit';
import { inch } from '@engine/units';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

/**
 * Second batch of imported public CAD for 2026 (next top teams by EPA from the Spectrum CAD Collection). The loaded CAD
 * rigs live in src/engine/robot/<name>CadModel.ts; these individual builders are the lightweight fallbacks (headless
 * runs, "Previous models", or an unavailable asset). Checklists are in each rig's header comment.
 */
const FUEL = 0xf2c200, FUEL_R = inch(5.91) / 2;

/** Latch the intake down once the match is enabled. */
function latch(state: { v: number }, enabled: boolean, dt: number): number {
  state.v = approach(state.v, enabled || state.v > .95 ? 1 : 0, 4, dt);
  return state.v;
}

// ── 1706 MIRAGE: black-walled hopper with a sliding extension box over the back intake, two spindexer floors with blue
//    cones, and two blue-ringed turrets side by side at the front sharing one aim. ──
registerRobotModel('mirage-1706', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const alu = mat(0xc4c9d0, { metal: 0.7, rough: 0.35 }), aluTube = tubeMat(0xc4c9d0), black = mat(0x1a1c20, { metal: 0.2, rough: 0.6 }), blue = mat(0x2d55d8, { rough: 0.45 });
  const db = drivebase(k, { tube: aluTube, motorRing: 0x2d55d8 });
  hopperWalls(k.visual, { intakeSide: side, floorDepth: .12, x: -L * .2, y0: bt, length: L * .6, width: W * .97, height: H - bt - .01, m: black, frame: aluTube });
  for (const sz of [-1, 1]) decal(k.visual, 'MIRAGE', { w: .2, h: .05, color: '#f1f1f1', background: '#1a1c20', x: -L * .2, y: H - .1, z: sz * (W * .485 + .004), rotY: sz > 0 ? 0 : Math.PI });
  const fill = fillBlock(k.visual, { x: -L * .2, y0: bt + .03, length: L * .55, width: W * .9, height: H - bt - .1, color: FUEL, capacity: c.hopperCapacity });
  // Spindexer floors with blue cones, one under each turret's feed.
  const rotors = [-1, 1].map(sz => {
    const g = new THREE.Group(); g.position.set(-.0885, bt + .02, sz * .1775); k.visual.add(g);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(.125, .125, .01, 32), mat(0x55595f, { metal: .3 })); g.add(disc);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(.02, .05, .1, 16), blue); cone.position.y = .055; g.add(cone);
    return g;
  });
  const extension = new THREE.Group(); k.visual.add(extension);
  hopperWalls(extension, { intakeSide: side, floorDepth: .12, x: side * (L / 2 + .07), y0: bt + .06, length: .3, width: W * .95, height: H - bt - .07, m: black });
  const turrets = [-1, 1].map(sz => {
    const g = new THREE.Group(); g.position.set(.165, .33, sz * .2225); k.visual.add(g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.11, .012, 8, 32), blue); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (const sx of [-1, 1]) bar(k.visual, [.165 + sx * .09, bt, sz * .2225], [.165 + sx * .09, .32, sz * .2225], .016, aluTube);
    return { g, sh: turretShooter(g, { width: .17, wheel: black, plate: alu, accent: blue, height: .15, topY: .06 }) };
  });
  box(k.visual, .05, .12, .05, alu, .25, .5, 0); // Limelight mast on the remnant telescoping tube
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: alu, rollerMaterial: black });
  const d = { v: 0 };
  const pile = hopperStow({ x: -L * .2, y0: bt + .03, length: L * .5, width: W * .85, height: H - bt - .12, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * .3, H - .01, W * .38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow,
      feed: (shot = 0) => { const t = turrets[shot % 2], r = rotors[shot % 2]; return [flowAt(k, r, .1, .08), flowAt(k, t.g, 0, -.05), flowAt(k, t.sh.flywheel, -.08, 0, 0), flowAt(k, t.sh.flywheel, .02, .04, 0)]; } },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      const dv = latch(d, s.enabled, s.dt); intake.update(s, dv);
      extension.position.x = side * (dv - 1) * .3;
      for (const t of turrets) { t.g.rotation.y = k.turret.rotation.y; t.sh.update(s); }
      for (const r of rotors) spin(r, s.enabled ? (s.firing > 0 || s.intaking ? 7 : 1.2) : 0, s.dt, 'y');
    },
  };
});

// ── 1987 CYCLONE: clear clock-face hopper walls around a dye-rotor floor, one black turret on the rotor axis with a
//    floating hood, rack intake out the back carrying the hopper's end wall. ──
registerRobotModel('cyclone-1987', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const alu = mat(0xc4c9d0, { metal: 0.7, rough: 0.35 }), aluTube = tubeMat(0xc4c9d0), black = mat(0x1a1c20, { metal: 0.2, rough: 0.6 });
  const clear = mat(0xdde8f0, { rough: 0.15 }); clear.transparent = true; clear.opacity = .25; clear.depthWrite = false;
  const db = drivebase(k, { tube: aluTube, motorRing: 0xc8202a });
  hopperWalls(k.visual, { intakeSide: side, floorDepth: .1, x: -L * .1, y0: bt, length: L * .8, width: W * .97, height: H - bt - .01, m: clear, frame: aluTube });
  const fill = fillBlock(k.visual, { x: -L * .15, y0: bt + .03, length: L * .6, width: W * .85, height: H - bt - .14, color: FUEL, capacity: c.hopperCapacity });
  const rotor = new THREE.Group(); rotor.position.set(.038, bt + .02, 0); k.visual.add(rotor);
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .01, 36), mat(0x55595f, { metal: .3 })));
  box(rotor, .2, .02, .02, black, -.1, .03, 0); // sweeper arm
  bar(k.visual, [.294, bt, .178], [.294, .42, .178], .019, aluTube); // fixed "cell tower" column
  const t = new THREE.Group(); t.position.set(.038, .41, 0); k.visual.add(t);
  const sh = turretShooter(t, { width: .15, wheel: black, plate: black, accent: alu, height: .13, topY: .06 });
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: alu, rollerMaterial: black });
  const d = { v: 0 };
  const pile = hopperStow({ x: -L * .15, y0: bt + .03, length: L * .5, width: W * .8, height: H - bt - .16, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * .3, H - .01, W * .38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow,
      feed: () => [flowAt(k, rotor, -.12, .08), flowAt(k, t, 0, -.1), flowAt(k, sh.flywheel, -.08, 0, 0), flowAt(k, sh.flywheel, .02, .04, 0)] },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      intake.update(s, latch(d, s.enabled, s.dt));
      t.rotation.y = k.turret.rotation.y; sh.update(s);
      spin(rotor, s.enabled ? (s.firing > 0 || s.intaking ? 6 : 1) : 0, s.dt, 'y');
    },
  };
});

// ── 9496 MATTERHORN: black fixed drum shooter across the front with three printed shot guides, vertical three-roller
//    feeder, sloped roller floor, black net roof, pivoting intake and a telescoping hopper end. ──
registerRobotModel('matterhorn-9496', (k: ModelKit) => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop, side = k.groundSide;
  const black = mat(0x1a1c20, { metal: 0.3, rough: 0.55 }), blackTube = tubeMat(0x24262b), orange = mat(0xf07a1a, { rough: 0.5 }), brass = mat(0xb08d3c, { metal: .8, rough: .3 });
  const db = drivebase(k, { tube: blackTube, motorRing: 0xf07a1a });
  hopperWalls(k.visual, { intakeSide: side, floorDepth: .12, x: -L * .15, y0: bt, length: L * .7, width: W * .97, height: H - bt - .01, m: black, frame: blackTube });
  const fill = fillBlock(k.visual, { x: -L * .2, y0: bt + .03, length: L * .55, width: W * .9, height: H - bt - .1, color: FUEL, capacity: c.hopperCapacity });
  const drum = roller(k.visual, .051, W * .76, black, .127, .454);
  for (const sz of [-1, 1]) roller(k.visual, .051, .02, brass, .127, .454, sz * W * .37);
  const feeders = [.28, .334, .388].map(y => roller(k.visual, .022, W * .76, black, .158, y));
  for (const sz of [-1, 0, 1]) box(k.visual, .05, .15, .17, orange, .31, .48, sz * .19); // printed shot guides
  const net = flatNet(k.visual, -L / 2, .1, H, W * .9);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, frame: black, rollerMaterial: orange });
  const d = { v: 0 };
  const pile = hopperStow({ x: -L * .2, y0: bt + .03, length: L * .5, width: W * .85, height: H - bt - .12, r: FUEL_R });
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    lightAt: [-L * .3, H - .01, W * .38],
    flow: { intake: overBumperIntake(k, intake.tip, FUEL_R), stow: pile.stow,
      feed: (shot = 0) => { const z = ((shot % 3) - 1) * .19; return [new THREE.Vector3(.05, bt + .1, z), new THREE.Vector3(.23, .3, z), new THREE.Vector3(.23, .45, z), new THREE.Vector3(.25, .6, z)]; } },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      net.visible = !c.hopperExpansion;
      intake.update(s, latch(d, s.enabled, s.dt));
      spin(drum, s.enabled && (s.aiming || s.firing > 0) ? 40 : 0, s.dt);
      for (const f of feeders) spin(f, s.enabled && (s.intaking || s.firing > 0) ? 20 : 0, s.dt);
    },
  };
});

const cfg = (team: number, model: string, o: Parameters<typeof build>[0], tweak: (c: ReturnType<typeof build>) => void) => {
  const c = build(o);
  c.teamNumber = team; c.model = model;
  tweak(c);
  return normalizeRebuiltConfig(c);
};

export const MIRAGE_CAPACITY = 40, CYCLONE_CAPACITY = 35, MATTERHORN_CAPACITY = 40;

export function cadBatchRebuiltTeamRobots(): TeamRobot[] {
  return [
    { id: 'mirage-1706', team: 1706, name: 'Mirage',
      description: '1706 Ratchet Rockers, Championship configuration. Two turrets side by side ("seeing double") with 3 in shooter wheels, rear accelerator wheels and 5 in inertia flywheels, each fed by its own spindexer floor; the intake and a black-walled hopper extension box slide out the back together. Both turrets share one simulated aim and alternate shots. Climber removed for Champs. Capacity, rate and speed are simulator estimates.',
      source: 'Onshape public release "RB-MIRAGE" / "Mirage Public Release" https://cad.onshape.com/documents/23ba2ed5b3893ab97929c8b6; Chief Delphi "1706 Ratchet Rockers 2026 CAD Release - Mirage (Champs Version)"',
      config: cfg(1706, 'mirage-1706', { intake: 'both', aim: 'turret', hopper: MIRAGE_CAPACITY, tall: false, rate: 18, climb: 0 }, c => {
        // Chassis plates: 25.2 in long x 29.5 in wide; CAD top 0.548 m.
        c.frameLength = .64; c.frameWidth = .75; c.height = .55;
        c.launcher.height = .50;
        c.launcher.mounts = [1, -1].map(sign => ({ forward: .165, side: sign * .2225 }));
        c.launcher.muzzleForward = .10;
        c.intake.reach = .2; c.intake.width = .66;
        c.maxSpeed = 4.6; setRebuiltAccuracy(c, 86);
      }) },
    { id: 'cyclone-1987', team: 1987, name: 'Cyclone',
      description: '1987 Broncobots. One turret sitting on the axis of a "dye rotor" floor that sweeps FUEL to a flex-wheel kicker up the centre column; the turret top is braced by a fixed "cell tower" post. 4 in urethane flywheel under a floating hood on a cycloidal drive. Clear clock-face hopper walls; the intake and the hopper end wall run out the back on racks. Loads the public CAD. Capacity, rate and speed are simulator estimates.',
      source: 'Onshape public release "2026_1987_Main" https://cad.onshape.com/documents/7f7a0e7897e017a2df0e247c; Chief Delphi 1987 Broncobots 2026 reveal and CAD threads',
      config: cfg(1987, 'cyclone-1987', { intake: 'both', aim: 'turret', hopper: CYCLONE_CAPACITY, tall: false, rate: 14, climb: 0 }, c => {
        // Drive Train billet rails: 25 in long x 30 in wide; CAD top 0.553 m.
        c.frameLength = inch(25); c.frameWidth = inch(30); c.height = .55;
        c.launcher.height = .50;
        c.launcher.mounts = [{ forward: .038, side: 0 }];
        c.launcher.muzzleForward = .08;
        c.intake.reach = .2; c.intake.width = .70;
        c.maxSpeed = 4.6; setRebuiltAccuracy(c, 85);
      }) },
    { id: 'matterhorn-9496', team: 9496, name: 'Matterhorn',
      description: '9496 LYNK. Fixed full-width drum shooter with brass inertia flywheels and three printed shot guides, fed by a three-roller vertical feeder from a sloped roller floor; black hopper under a net. The intake pivots out the back on a sector gear and pulls the slotted hopper end out with it. Aimed by turning the chassis. Loads the public CAD. Capacity, rate and speed are simulator estimates.',
      source: 'Onshape public release "9496_2026_LYNK_Matterhorn_Public" https://cad.onshape.com/documents/768d7890bafac55a2a891aae; Chief Delphi 9496 build log',
      config: cfg(9496, 'matterhorn-9496', { intake: 'both', aim: 'align', dumper: true, hopper: MATTERHORN_CAPACITY, tall: false, rate: 15, climb: 0 }, c => {
        // Chassis 27 x 27 in; CAD top 0.556 m.
        c.frameLength = inch(27); c.frameWidth = inch(27); c.height = .55;
        c.launcher.height = .50; c.launcher.exitSpan = .57;
        c.launcher.minAngle = c.launcher.maxAngle = c.launcher.angle;
        c.intake.reach = .2; c.intake.width = .62;
        c.maxSpeed = 4.6; setRebuiltAccuracy(c, 84);
      }) },
  ];
}
