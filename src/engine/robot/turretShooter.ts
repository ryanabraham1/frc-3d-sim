import * as THREE from 'three';
import { approach, hoodShell, mat, pivot, roller, sidePlates, spin, type RobotAnimState } from './models';
import { belt, fasteners, motor } from './mechanicalDetail';

/**
 * Turret shooter in the style of 2026's top turret robots (4414 RIPCURRENT CAD): an oval pocketed turret plate on a
 * big bearing ring with a short shroud below, an A-frame of lightened side plates, a wide flywheel stack (copper
 * wheels on a hex shaft) at the throat, a backspin roller at the apex, timing belts up the front legs, Krakens on the
 * side and an adjustable curved hood.
 *
 * Build it into the robot's turret group (it yaws with the turret; +x = shot direction). The hood rests stowed (flat,
 * so the robot fits under the TRENCH) and swings up to the solved launch angle while the driver aims (`s.aiming`),
 * so it visibly re-adjusts with range; it follows `s.hood` between shots.
 */
export interface TurretShooter {
  update(s: RobotAnimState): void;
  /** Main flywheel (anchor for the piece-flow path into the shooter). */
  flywheel: THREE.Object3D;
  hood: THREE.Group;
}

export function turretShooter(turret: THREE.Object3D, o: {
  /** Distance between the side plates (wheel width). */
  width: number;
  wheelR?: number;
  /** Plate / frame material, accent (bearing ring, hood) and wheel material. */
  plate: THREE.Material;
  accent: THREE.Material;
  wheel?: THREE.Material;
  /** Turret plate outer size (stadium) and apex height above it. */
  plateLength?: number;
  plateWidth?: number;
  height?: number;
  /** Height (turret frame) of the top of the A-frame: keep it inside the robot's legal height. */
  topY: number;
}): TurretShooter {
  const w = o.width;
  const wr = o.wheelR ?? 0.051; // 4 in flywheels
  const PL = o.plateLength ?? Math.max(0.3, w + 0.16);
  const PW = o.plateWidth ?? w + 0.11;
  const H = o.height ?? 0.2;
  const g = new THREE.Group();
  g.position.y = o.topY - H - 0.04;
  turret.add(g);
  const steel = mat(0xb9c0c8, { metal: 0.85, rough: 0.3 });

  // Oval turret plate with slotted pockets and a bolt circle, on a bearing ring and a short shroud.
  const shape = new THREE.Shape();
  const r = PW / 2;
  const half = PL / 2 - r;
  shape.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.absarc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  const throat = new THREE.Path();
  throat.absellipse(0.01, 0, w * 0.42, w * 0.36, 0, Math.PI * 2, false, 0);
  shape.holes.push(throat);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const cx = Math.cos(a) * (PL / 2 - 0.035), cz = Math.sin(a) * (PW / 2 - 0.03);
    const slot = new THREE.Path();
    slot.absellipse(cx, cz, 0.016, 0.006, 0, Math.PI * 2, false, a + Math.PI / 2);
    shape.holes.push(slot);
  }
  const plateMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: 18 }), o.plate);
  plateMesh.rotation.x = Math.PI / 2;
  g.add(plateMesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(PL, PW) * 0.44, 0.011, 8, 40), o.accent);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.012;
  g.add(ring);
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(PL, PW) * 0.42, Math.min(PL, PW) * 0.42, 0.05, 32, 1, true), o.plate);
  (shroud.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  shroud.position.y = -0.04;
  g.add(shroud);
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6), steel, 14);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    m4.makeTranslation(Math.cos(a) * (PL / 2 - 0.012), 0.004, Math.sin(a) * (PW / 2 - 0.01));
    bolts.setMatrixAt(i, m4);
  }
  g.add(bolts);

  // A-frame side plates: front leg up to the apex roller, back leg down to the plate, triangular lightening holes.
  const fx = 0.05; // flywheel x (front of the throat)
  const fy = wr + 0.03;
  const ax = -0.02;
  const ay = H;
  const legs: [number, number][] = [[-PL / 2 + 0.04, 0], [fx + wr + 0.03, 0], [fx + wr + 0.02, fy + 0.02], [ax + 0.035, ay + 0.02], [ax - 0.035, ay + 0.02], [-PL / 2 + 0.03, 0.03]];
  sidePlates(g, legs, w / 2 + 0.006, o.plate, [[fx, fy, 0.024], [ax, ay - 0.05, 0.018], [-0.06, 0.05, 0.022]]);
  // Standoffs tying the plates together.
  for (const [x, y] of [[-PL / 2 + 0.05, 0.02], [ax, ay - 0.005], [fx + wr + 0.015, 0.02]] as const) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, w + 0.012, 8), steel);
    st.rotation.x = Math.PI / 2;
    st.position.set(x, y, 0);
    g.add(st);
  }
  // Flywheel stack: copper wheels with dark spacers on a steel hex shaft.
  const fly = new THREE.Group();
  fly.position.set(fx, fy, 0);
  g.add(fly);
  const copper = o.wheel ?? mat(0xc07a45, { metal: 0.75, rough: 0.35 });
  const nWheels = Math.max(2, Math.round(w / 0.045));
  for (let i = 0; i < nWheels; i++) {
    const z = -w / 2 + (w * (i + 0.5)) / nWheels;
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, (w / nWheels) * 0.62, 22), copper);
    wh.rotation.x = Math.PI / 2;
    wh.position.z = z;
    fly.add(wh);
    // Spokes make the spin readable.
    const sp = new THREE.Mesh(new THREE.BoxGeometry(wr * 1.7, 0.006, (w / nWheels) * 0.64), o.plate);
    sp.position.z = z;
    fly.add(sp);
  }
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, w + 0.03, 6), steel);
  shaft.rotation.x = Math.PI / 2;
  fly.add(shaft);
  // Backspin / top roller at the apex and a kicker in the throat.
  const top = roller(g, 0.028, w * 0.95, o.plate, ax, ay - 0.015);
  const kicker = roller(g, 0.018, w * 0.85, mat(0x1c1d20, { rough: 0.8 }), fx - wr - 0.02, 0.025);
  // Belts up the front legs to the top roller, motors on the side plates.
  for (const sign of [-1, 1]) {
    const z = sign * (w / 2 + 0.02);
    belt(g, [fx, fy], [ax, ay - 0.015], z, 0.022);
    motor(g, -PL / 2 + 0.085, 0.07, sign * (w / 2 + 0.055), 0x39d353);
    belt(g, [-PL / 2 + 0.085, 0.07], [fx, fy], z + sign * 0.012, 0.016);
    fasteners(g, [[-PL / 2 + 0.06, 0.03], [ax, ay - 0.04], [fx + wr, 0.03], [-0.05, 0.11]], z - sign * 0.012);
  }
  // Hood: a curved shell over the flywheel, hinged at the back so it opens up / folds down over the wheel.
  const hood = pivot(g, fx - wr * 0.2, fy + wr * 0.4);
  const shell = hoodShell(hood, wr + 0.022, w * 0.98, o.accent);
  shell.position.x = wr * 0.2;
  shell.position.y = -wr * 0.4;
  // Hood rack (the adjustment gear sector) on one side.
  const rack = new THREE.Mesh(new THREE.RingGeometry(wr + 0.03, wr + 0.045, 18, 1, Math.PI * 0.2, Math.PI * 0.55), o.plate);
  rack.position.z = w / 2 + 0.002;
  (rack.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  hood.add(rack);

  let hoodAng = HOOD_STOW;
  let flySpeed = 0;
  return {
    flywheel: fly,
    hood,
    update(s) {
      // Stowed flat when idle; up to the solved angle while aiming (and just after a shot). Steeper launches
      // (close shots) open the hood further.
      const want = s.aiming || s.firing > 0 ? hoodFor(s.hood) : HOOD_STOW;
      hoodAng = s.dt > 0 ? approach(hoodAng, want, 5, s.dt) : want;
      hood.rotation.z = hoodAng;
      flySpeed = approach(flySpeed, !s.enabled ? 0 : s.aiming || s.firing > 0 ? 70 : 20, 4, s.dt);
      spin(fly, -flySpeed, s.dt);
      spin(top, flySpeed * 0.8, s.dt);
      spin(kicker, s.firing > 0 ? -40 : 0, s.dt);
    },
  };
}

/** Hood angle (rad, about its hinge) at rest: folded down over the flywheel. */
const HOOD_STOW = -0.35;

/** Hood angle for a launch elevation `theta` (rad): flatter shots (long range) close the hood, lobs open it. */
export function hoodFor(theta: number): number {
  return Math.max(-0.3, Math.min(0.75, (theta - 0.75) * 1.4));
}
