import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * Team 254's WCP CADathon Gadgeteer (Onshape "TLA", Bellarmine / Cheesy Poofs).
 * Source axes (Z up, intake toward -Y) are mapped to robot axes by `tools/prepare-robot-cad.mjs` ('yzx'): the intake rollers sit at the
 * back (-x), the turret over the chassis centre and the three-stage elevator with its disk claw and suction pad on the front (+x).
 *
 * Checklist (CLAUDE.md): archetype = turret shooter + elevator-mounted disk claw + suction-pad climb (Gadgeteer, 1 panel, 3 bubbles,
 * claims High climb: sheet row 17). Intake end = back rollers + serializer; scoring end = front (turret fires any way, claw presents forward).
 * Measured from the CAD: turret ring centre, hood/flywheel axes, elevator stage travel from the resting plates (stage 2 rises 0.45 m,
 * stage 3 0.90 m from stowed; the export is the fully extended pose), claw pivot tube. Estimates are marked [EST].
 * Joint centres below are robot metres (x forward, y up, z lateral).
 */
export const POOFS_254_STAGE_TRAVEL = [0.45, 0.90] as const;
/** Claw pivot tube height with the elevator stowed (CAD 1.65 m minus the 0.90 m stage-3 travel). */
const STOWED_PIVOT_Y = 1.65 - .90;
const PIVOT = { intake: [-.0065, .19, 0], turret: [-.0365, .54, 0], claw: [.1885, 1.65, 0] } as const;

export function buildPoofs254Cad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: readonly [number, number, number], parts: string[], parent: THREE.Object3D = root) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.set(at[0], at[1], at[2]); parent.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  // Rigid groups that ride the elevator: stage 2 (half travel), stage 3 with the claw base and suction pad (full travel).
  const stage2 = get('stage2'), stage3 = get('stage3'), pad = get('pad'), clawBase = get('claw-base');
  const lifted = [stage3, pad, clawBase];
  const intake = pivot('intake', PIVOT.intake, ['intake']);
  // The CAD shooter exits along source +X = robot +z, so the turret group carries a +90° yaw offset (shot direction -> robot +x at yaw 0).
  const turret = pivot('turret', PIVOT.turret, ['turret', 'hood', 'flywheel']);
  const hood = pivot('hood', [0, .195, .055], ['hood'], turret); turret.attach(hood);
  const flywheel = pivot('flywheel', [0, .195, .055], ['flywheel'], turret); turret.attach(flywheel);
  const claw = pivot('claw', PIVOT.claw, ['claw']);

  // Climb contact: the suction pad face (top of the pad), carried by stage 3.
  const contact = new THREE.Object3D(); contact.name = '254-climb-contact'; contact.position.set(-.0115, 1.751, 0); root.add(contact);
  if (pad) pad.attach(contact);
  // Held STORY PANEL anchor: the claw rollers pinch the disc edge; the disc extends toward the anchor's -x (archetype fork-tip convention).
  const held = new THREE.Object3D(); held.name = '254-held-anchor'; root.add(held); claw.attach(held);
  const GRIP = new THREE.Vector3(-.1275, 1.81, 0).sub(new THREE.Vector3(...PIVOT.claw)); // rollers relative to the pivot tube
  held.position.copy(GRIP);
  const HOLD = .304;      // disc centre sits one panel radius outside the pinch point (rim touching the rollers)
  const intakeTip = new THREE.Object3D(); intakeTip.position.set(-.6165, .235, 0); root.add(intakeTip); intake.attach(intakeTip);

  // Mark the real intake mouth like the engine's orange ground intake.
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .55, emissive: 0xff5a00, emissiveIntensity: .25 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.034, .034, .60, 16), orange);
  bar.rotation.x = Math.PI / 2; bar.position.set(-.6165, .235, 0); root.add(bar); intake.attach(bar);

  // Held SPEECH BUBBLES ride in the serializer/feeder (visual only): fill = held / capacity.
  const r = .0889, COUNT = 3, ballMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .7 });
  const ballGeo = new THREE.SphereGeometry(r * .95, 14, 10);
  const slots: [number, number, number][] = [[-.285, .29, -.17], [-.285, .29, .17], [-.12, .30, 0]];
  const balls = slots.map(p => { const m = new THREE.Mesh(ballGeo, ballMat); m.position.set(...p); m.visible = false; root.add(m); return m; });

  const lifted3 = [...lifted, claw], base3 = lifted3.map(o => o?.position.y ?? 0), base2 = stage2?.position.y ?? 0;
  const TRAVEL2 = POOFS_254_STAGE_TRAVEL[0], TRAVEL3 = POOFS_254_STAGE_TRAVEL[1];
  /** Elevator at e (0 = stowed, 1 = the exported CAD pose). */
  const setElevator = (e: number) => {
    lifted3.forEach((o, i) => { if (o) o.position.y = base3[i] - (1 - e) * TRAVEL3; });
    if (stage2) stage2.position.y = base2 - (1 - e) * TRAVEL2;
  };
  /**
   * Claw swing φ (0 = exported pose, jaws toward the back; π = jaws forward, rotation about the lateral pivot tube) and the offset `slide`
   * the motorised jaw rollers push the disc out of the jaws by (0 = rim at the rollers, HOLD = disc centre at the rollers).
   * Returns the panel centre in robot x / height above the stowed pivot.
   */
  const clawCenter = (phi: number, slide = 0) => { const cx = -.316 - (HOLD - slide), cy = .16; return { x: PIVOT.claw[0] + cx * Math.cos(phi) + cy * Math.sin(phi), y: -cx * Math.sin(phi) + cy * Math.cos(phi) }; };
  /** Nearest pose of the claw and elevator to a panel centre at (forward, height): the season's mailboxes sit lower and closer than the swing alone reaches. */
  const solveClaw = (forward: number, height: number) => {
    let best = { phi: 0, slide: 0, e: 0, err: Infinity };
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 4; j++) {
      const phi = i / 60 * Math.PI, slide = j / 4 * HOLD, c = clawCenter(phi, slide);
      const e = THREE.MathUtils.clamp((height - STOWED_PIVOT_Y - c.y) / TRAVEL3, 0, 1);
      const err = Math.hypot(c.x - forward, STOWED_PIVOT_Y + TRAVEL3 * e + c.y - height) + .02 * slide;
      if (err < best.err) best = { phi, slide, e, err };
    }
    return best;
  };
  let deploy = 0, e = 0, phi = 0, slide = 0, pitch = 0, spin = 0;
  const PAD_REACH = .95;
  setElevator(0);
  intake.rotation.z = 0;
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: intakeTip, climbAnchor: contact, heldAnchor: held, lightAt: [-.28, .45, .28],
    update(s) {
      const shown = Math.round(s.fill * COUNT); balls.forEach((b, n) => b.visible = n < shown);
      if (!animated()) { setElevator(1); claw.rotation.z = 0; return; }
      deploy = scoringEase(deploy, s.enabled && !s.climb ? 1 : 0, s.dt);
      intake.rotation.z = -(1 - deploy) * .7;
      turret.rotation.y = k.turret.rotation.y + Math.PI / 2;
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp(s.hood, .26, 1.22) - .85 : 0, s.dt);
      hood.rotation.x = -pitch * .6;
      spin += (s.enabled && (s.aiming || s.firing > 0) ? 60 : 0) * s.dt; flywheel.rotation.x = -spin;
      // Elevator + claw: follow the season's placement pose while a panel is being scored, deploy for the pad while climbing.
      const placing = !!s.place && s.place.level > 0 && s.climb === 0;
      let targetE = 0, targetPhi = 0, targetSlide = 0;
      if (placing) ({ e: targetE, phi: targetPhi, slide: targetSlide } = solveClaw(s.place!.forward, s.place!.height));
      else if (s.climb > 0) targetE = s.climb > .6 ? PAD_REACH : .05;
      e = scoringEase(e, targetE, s.dt); phi = scoringEase(phi, targetPhi, s.dt); slide = scoringEase(slide, targetSlide, s.dt);
      setElevator(e); claw.rotation.z = -phi;
      // Rules draw an idle panel 0.242 m behind the anchor and a scoring panel exactly at it: keep its rim in the jaws in both.
      held.position.copy(GRIP).add(new THREE.Vector3(placing ? -(HOLD - slide) : -(HOLD - .242), 0, 0)); held.rotation.set(0, 0, 0);
    },
  };
}
