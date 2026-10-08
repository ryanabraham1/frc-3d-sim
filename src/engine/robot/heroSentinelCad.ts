import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { intakeDeployTarget } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 1923 MidKnight Inventors "Sentinel" (Gadgeteer), from the team's Onshape assembly "Full Robot Assy." (field and
 * bumper omitted). Source axes (-Y,Z,-X), meters: the slapdown intake sits at the robot's back (-X), the ball tunnel
 * shoots forward over its 4 in flywheel, and the pink panel arm hangs off the left side (-Z) pivoting at the front.
 * Joint centers are measured from the CAD shafts/sprockets: intake hinge = 32T plate sprocket (source y .318, z .314),
 * panel-arm hinge = 32T/35 mm bearing pair (source y -.286, z .320), flywheel = 4 in Stealth stack (y -.100, z .2555).
 * Binder (Google Doc linked from the sheet): 1-stage elevator on a dead MAXSpline pivot with a fixed-angle claw (Pink Arm),
 * FRC2910-2022-style mecanum slapdown intake on a zombie hex pivot, ball tunnel + adjustable hooded shooter (NEO Vortex).
 * Travel limits, stow angle and arm extension are simulator estimates [EST]: the CAD is a single pose. Not checked against
 * photos; see docs/HERO-HEIST-SENTINEL.md.
 */
const INTAKE_HINGE: [number, number, number] = [-.318, .314, 0];
const ARM_HINGE: [number, number, number] = [.286, .320, 0];
const FLYWHEEL: [number, number, number] = [.100, .2555, 0];
/** Claw gripping point (between the two 2.5 in compliant wheels) and the outward arm axis, from the CAD pose. */
const CLAW: [number, number, number] = [-.292, .357, -.260];
const ARM_AXIS = Math.atan2(.357 - ARM_HINGE[1], CLAW[0] - ARM_HINGE[0]);
const ARM_REACH = Math.hypot(CLAW[0] - ARM_HINGE[0], CLAW[1] - ARM_HINGE[1]);
const SLIDE_MAX = .20;
/** Bubble seats inside the ball tunnel (shooter end first), robot frame. */
export const SENTINEL_BUBBLES: [number, number, number][] = [[.19, .19, 0], [.02, .17, 0], [-.15, .25, 0]];
const BUBBLE_R = .0889 * .96;

export function buildSentinel1923Cad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: string[], parent: THREE.Object3D = root) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); parent.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  const intake = pivot('intake', INTAKE_HINGE, ['intake-arm']);
  const arm = pivot('arm', ARM_HINGE, ['arm']);
  const slide = pivot('arm-slide', [0, 0, 0], ['arm-slide'], arm);
  const flywheel = pivot('flywheel', FLYWHEEL, ['flywheel']);
  // Binder: the hood pivots on the flywheel's zombie axle (80T gear, 4:1 from a Kraken) so the launch angle is adjustable.
  const hood = pivot('hood', FLYWHEEL, ['hood']);
  const out = new THREE.Vector3(Math.cos(ARM_AXIS), Math.sin(ARM_AXIS), 0);

  // Panel rides here (rules.ts parents the held STORY PANEL on this anchor); it sits just beyond the claw wheels.
  const held = new THREE.Object3D(); held.name = 'sentinel-held-panel';
  held.position.fromArray(CLAW); root.add(held); root.updateMatrixWorld(true); slide.attach(held);
  const heldBase = held.position.clone();
  const tip = new THREE.Object3D(); tip.position.set(-.63, .13, 0); root.add(tip); root.updateMatrixWorld(true); intake.attach(tip);

  // Held SPEECH BUBBLES drawn in the tunnel (visual only), driven by RobotAnimState.fill.
  const bubbleMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .55 });
  const geo = new THREE.SphereGeometry(BUBBLE_R, 16, 12);
  const bubbles = SENTINEL_BUBBLES.map(p => { const m = new THREE.Mesh(geo, bubbleMat); m.name = 'sentinel-held-bubble'; m.position.fromArray(p); m.visible = false; root.add(m); return m; });

  let deploy = 0, hoodPitch = 0, rot = 0, ext = 0, grip = 0;
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, heldAnchor: held, lightAt: [-.2, .45, .30],
    flow: {
      stow: () => new THREE.Vector3(...SENTINEL_BUBBLES[1]),
      intake: () => [new THREE.Vector3(-.60, .16, 0), new THREE.Vector3(-.42, .24, 0), new THREE.Vector3(-.2, .26, 0)],
    },
    update(s) {
      for (let i = 0; i < bubbles.length; i++) bubbles[i].visible = i < Math.round(THREE.MathUtils.clamp(s.fill, 0, 1) * bubbles.length);
      if (!animated()) return;
      // Slapdown intake: upright behind the frame when stowed, laid to the carpet while collecting [EST travel].
      deploy = scoringEase(deploy, intakeDeployTarget(s), s.dt);
      intake.rotation.z = -(1 - deploy) * 1.75;
      const flywheelRate = s.enabled && (s.aiming || s.firing > 0) ? 70 : s.enabled ? 6 : 0;
      flywheel.rotation.z += flywheelRate * s.dt;
      hoodPitch = scoringEase(hoodPitch, s.aiming ? THREE.MathUtils.clamp(s.hood, .35, 1.22) - .85 : 0, s.dt);
      hood.rotation.z = hoodPitch;
      // Panel arm: aims the claw at the mailbox pose the season gives us, else folds back along the left side.
      let rotTarget = 0, extTarget = 0, gripTarget = 0;
      if (s.place && s.place.level > 0) {
        const dx = s.place.forward - ARM_HINGE[0], dy = s.place.height - ARM_HINGE[1];
        const dist = Math.hypot(dx, dy);
        rotTarget = Math.atan2(dy, dx) - ARM_AXIS;
        if (rotTarget > 0) rotTarget -= Math.PI * 2;
        extTarget = THREE.MathUtils.clamp(dist - .28 - ARM_REACH, 0, SLIDE_MAX);
        gripTarget = .24;
      }
      rot = scoringEase(rot, rotTarget, s.dt);
      ext = scoringEase(ext, extTarget, s.dt);
      grip = scoringEase(grip, gripTarget, s.dt);
      arm.rotation.z = rot;
      slide.position.copy(out).multiplyScalar(ext);
      held.position.copy(heldBase).addScaledVector(out, .04 + grip);
    },
  };
}
