import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { intakeDeployTarget } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 5800 Wolverine "Multiclass" (WCP CADathon: Hero Heist), straight from the team's Onshape assembly.
 * CAD axes were remapped with 'yzx' (robot forward = CAD +Y, up = CAD +Z, robot z = CAD +X), meters, so the
 * elevator + wrist face the FRONT and the 4-bar floor intake faces the BACK, as the sim expects. All joint centers
 * below were read from the assembly's mates (world coordinates), not guessed:
 *   - 4-bar intake: gearbox pivots A (inner link, driven, 0..0.797 rad in the CAD limit) and B (middle link),
 *     coupler (outer link) joints P and Q; solved as a planar four-bar every frame.
 *   - turret: vertical axis through (0.033, 0.416). Three 4" wheels share one horizontal axle (direction
 *     (0.852, 0, 0.523)); the bubble leaves toward CAD (-0.852, 0.523), i.e. 58.5° off the CAD x axis, so the turret
 *     is offset by TURRET_BASE to make "yaw 0" fire forward. Fixed hood (no hood actuator in the CAD) [EST 45°].
 *   - elevator: 2-stage cascade, stage 1 travels 0.5334 m, carriage another 0.4064 m (slider mate limits).
 *   - wrist: manipulator rotates about the carriage pivot (0.248, 0.182); its compliant wheels handle panels only
 *     (binder: the 4-bar is the single ground intake).
 */
const A = new THREE.Vector2(-0.1216, 0.1842), B = new THREE.Vector2(-0.2413, 0.1715);
const P0 = new THREE.Vector2(-0.2108, 0.4662), Q0 = new THREE.Vector2(-0.2515, 0.4123);
const DEPLOY_MAX = 0.797;
const REST_SIDE = Math.sign((P0.x - B.x) * (Q0.y - B.y) - (P0.y - B.y) * (Q0.x - B.x));
const TURRET_AT: [number, number, number] = [0.0333, 0.416, 0];
const TURRET_BASE = -1.0212;
const WHEEL_AXIS = new THREE.Vector3(0.852, 0, 0.523).normalize();
const WHEEL_CENTERS: [number, number, number][] = [[-0.055, 0.5, 0.061], [-0.0165, 0.5, 0.084], [0.0215, 0.5, 0.1075]];
// Binder: continuous belt elevator, max stroke 21.875 in (0.556 m) for the carriage; the first stage moves half of it.
// (The CAD slider limits, 21 in + 16 in, are the unrestricted mate ranges.)
const CARRIAGE_TOTAL = 0.5556, STAGE1_TRAVEL = CARRIAGE_TOTAL / 2, CARRIAGE_TRAVEL = CARRIAGE_TOTAL / 2;
const WRIST_AT: [number, number, number] = [0.2476, 0.1818, 0];
/** Spindexer center (CAD (0,-0.044)) and the bubble ring radius that fits its 0.48 m width. */
const RING_AT = [-0.0444, 0.21] as const, RING_RADIUS = 0.15, BUBBLE_RADIUS = 0.0889, MAX_SHOWN = 6;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Planar four-bar: inner link at angle `theta` about A; returns the coupler pose and the middle-link angle. */
export function solveFourBar(theta: number) {
  const ca = Math.cos(theta), sa = Math.sin(theta);
  const rel = P0.clone().sub(A);
  const P = new THREE.Vector2(A.x + rel.x * ca - rel.y * sa, A.y + rel.x * sa + rel.y * ca);
  const lenB = Q0.distanceTo(B), lenC = Q0.distanceTo(P0);
  // Circle(B, lenB) ∩ Circle(P, lenC).
  const d = P.distanceTo(B), a = (lenB * lenB - lenC * lenC + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, lenB * lenB - a * a));
  const ux = (P.x - B.x) / d, uy = (P.y - B.y) / d;
  const m = new THREE.Vector2(B.x + a * ux, B.y + a * uy);
  const q1 = new THREE.Vector2(m.x - h * uy, m.y + h * ux), q2 = new THREE.Vector2(m.x + h * uy, m.y - h * ux);
  // Keep the exported assembly mode: Q stays on the same side of the line B→P as in the CAD pose.
  const side = (q: THREE.Vector2) => Math.sign((P.x - B.x) * (q.y - B.y) - (P.y - B.y) * (q.x - B.x));
  const Q = side(q1) === REST_SIDE ? q1 : q2;
  const ang = (v: THREE.Vector2) => Math.atan2(v.y, v.x);
  return {
    P, Q,
    inner: theta,
    middle: wrap(ang(Q.clone().sub(B)) - ang(Q0.clone().sub(B))),
    outer: wrap(ang(Q.clone().sub(P)) - ang(Q0.clone().sub(P0))),
  };
}

export function buildMulticlass5800(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: (THREE.Object3D | undefined | null)[], parent: THREE.Object3D = root) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); parent.add(g);
    root.updateMatrixWorld(true);
    for (const o of parts) if (o) g.attach(o);
    return g;
  };
  const inner = pivot('intake-inner', [A.x, A.y, 0], [get('intake-inner')]);
  const middle = pivot('intake-middle', [B.x, B.y, 0], [get('intake-middle')]);
  const outer = pivot('intake-outer', [P0.x, P0.y, 0], [get('intake-outer')]);
  // Deployed floor roller (outer link tube roller, CAD center (-0.305, 0.24)); the engine's intake capture rides here.
  const tip = new THREE.Object3D(); tip.position.set(-0.305, 0.24, 0); root.add(tip); outer.attach(tip);

  const turret = pivot('turret', TURRET_AT, [get('turret')]);
  const wheels = WHEEL_CENTERS.map((c, i) => { const w = pivot(`flywheel-${i}`, c, [get(`flywheel-${i}`)]); turret.attach(w); return w; });

  const stage = pivot('elevator-stage', [0, 0, 0], [get('elevator-stage')]);
  const carriage = pivot('carriage-lift', [0, 0, 0], [get('carriage')]);
  const wrist = pivot('wrist', WRIST_AT, [get('wrist'), get('wrist-roller')], carriage);
  // Held panels (STORY PANEL, disc normal = local +Y) stand upright on the wrist's wheel face, just outside the front bumper
  // [EST: the CAD has no panel, so the grip point is fitted to the wheel face]. rules.ts parents the held panel here and
  // places it by its center, so the anchor is that center's low point: the disc centre sits 0.24 m above it.
  const held = new THREE.Object3D(); held.name = 'hero5800-held'; held.position.set(0.43, 0.50, 0); held.rotation.z = -Math.PI / 2; root.add(held); wrist.attach(held);

  // The only ground intake (binder) is the rear 4-bar: mark it with an orange roller bar.
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55, emissive: 0xff5a00, emissiveIntensity: 0.25 });
  // The rear roller is shrouded by the CAD's own tubes: stand the orange bar just outside it, riding the deploying link.
  const rearBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 12), orange);
  rearBar.rotation.x = Math.PI / 2; rearBar.position.set(-0.375, 0.22, 0); root.add(rearBar); outer.attach(rearBar);

  // Held SPEECH BUBBLES ride in the spindexer (visual only). Shown count = round(fill × capacity).
  const ballMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: 0.7 });
  const ballGeo = new THREE.SphereGeometry(BUBBLE_RADIUS * 0.95, 14, 10);
  // Binder: a 5-star spindexer rotates the bubbles (it turns while intaking and feeding), so the balls ride its star.
  const star = pivot('spindexer-star', [RING_AT[0], 0, 0], [get('spindexer-star')]);
  const balls = Array.from({ length: MAX_SHOWN }, (_, n) => {
    const a = (n / MAX_SHOWN) * Math.PI * 2, m = new THREE.Mesh(ballGeo, ballMat);
    m.position.set(Math.cos(a) * RING_RADIUS, RING_AT[1], Math.sin(a) * RING_RADIUS); m.visible = false; star.add(m); return m;
  });
  const capacity = Math.max(1, Math.min(MAX_SHOWN, k.config.hopperCapacity || MAX_SHOWN));

  let deploy = 0, lift = 0, wristAngle = 0, spin = 0;
  const solved = (v: number) => solveFourBar(v * DEPLOY_MAX);
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, heldAnchor: held, lightAt: [-0.12, 0.45, -0.3],
    update(s) {
      const shown = Math.round(s.fill * capacity); balls.forEach((b, n) => { b.visible = n < shown; });
      turret.rotation.y = k.turret.rotation.y + TURRET_BASE;
      if (!animated()) return;
      if (s.enabled && (s.intaking || s.aiming || s.firing > 0)) star.rotation.y += (s.aiming || s.firing > 0 ? 4 : 2) * s.dt;
      deploy = scoringEase(deploy, intakeDeployTarget(s) ? 1 : 0, s.dt);
      const f = solved(deploy);
      inner.rotation.z = f.inner; middle.rotation.z = f.middle;
      outer.position.set(f.P.x, f.P.y, 0); outer.rotation.z = f.outer;
      // Elevator follows the season's placement pose (the held panel's center height); the wrist tips forward for reach.
      const wantLift = s.place ? THREE.MathUtils.clamp((s.place.height - 0.50) / (STAGE1_TRAVEL + CARRIAGE_TRAVEL), 0, 1) : 0;
      const wantWrist = s.place ? THREE.MathUtils.clamp((s.place.forward - 0.43) / 0.25, 0, 1) * 1.1 : 0;
      lift = scoringEase(lift, wantLift, s.dt); wristAngle = scoringEase(wristAngle, wantWrist, s.dt);
      stage.position.y = lift * STAGE1_TRAVEL;
      carriage.position.y = lift * (STAGE1_TRAVEL + CARRIAGE_TRAVEL);
      wrist.rotation.z = -wristAngle;
      const shooting = s.enabled && (s.aiming || s.firing > 0);
      spin += (shooting ? 55 : s.enabled ? 6 : 0) * s.dt;
      for (const w of wheels) w.setRotationFromAxisAngle(WHEEL_AXIS, spin);
    },
  };
}
