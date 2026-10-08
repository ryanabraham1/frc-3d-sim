import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 3005 RoboChargers "Surge" (public Onshape "3005 2024: FULL ROBOT (PUBLIC)").
 *
 * Checklist (CLAUDE.md "verify before you build"):
 * - Archetype: "pivoting launcher with a diverter to allow for amp and speaker shots" (reveal; lead-screw "4: Pivot"
 *   drive) with the flip-down diverter head on its nose
 *   + one 2-stage telescoping climber. Source: Onshape root mates (Revolute 1 launcher <-> frame, Revolute 2
 *   diverter <-> launcher nose, Slider 1/2 in "7: Telescoping Climber") and the Chief Delphi reveal (refs/cd-456489).
 * - Intake end: both. Full-width under-bumper roller intake feeding the launcher from either bumper face
 *   (reveal: "under-the-bumper, double-sided intake"), so the roster entry uses `dualSideIntake`.
 * - Scoring end: front (+X, the launcher nose); the diverter at the nose places AMP notes.
 * - Colours: black launcher and side plates (SRPP, "self-reinforced polypropylene", per the team in the reveal
 *   thread, not carbon fibre), silver tube frame, blue bumpers (TBA 2024 photo refs/3005-2024/sheet.jpg). The CAD's
 *   grey appearance swatch on the launcher plates is recoloured black.
 * - Capacity 1 NOTE (rule). Launcher export angle 18.4 deg; launcher range 10..60 deg, the diverter's AMP
 *   swing and the 0.45 m climber stroke are [EST] (no published constants found).
 */
const CLIMB = new THREE.Vector3(0,.994,-.108).normalize();

export function buildSurgeCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const launcher = cadJoint(root,['shooter'],[-.2222,.3302,0],'cad-shooter-pivot');
  const diverter = cadJoint(root,['diverter'],[.2685,.4983,0],'cad-diverter-pivot',launcher);
  const hooks = root.getObjectByName('climber')!, mid = root.getObjectByName('climber-mid');
  const hookRest = hooks.position.clone(), midRest = mid?.position.clone() ?? new THREE.Vector3();
  // The CAD shows the launcher plates in a grey appearance swatch; the real SRPP plates are black.
  const black = new Map<THREE.Material,THREE.Material>();
  for (const name of ['shooter','diverter']) root.getObjectByName(name)?.traverse(o => {
    const mesh = o as THREE.Mesh, m = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (!mesh.isMesh || !m?.color) return;
    const { r, g, b } = m.color, hi = Math.max(r,g,b), lo = Math.min(r,g,b);
    if (hi - lo > .08 || hi < .15 || hi > .75) return;
    if (!black.has(m)) { const c = m.clone(); c.color.setHex(0x1c1d20); c.metalness = .2; c.roughness = .45; black.set(m,c); }
    mesh.material = black.get(m)!;
  });
  const intake = cadAnchor(root,root,[-.3,.07,0],'cad-intake-mouth');
  const tilt = THREE.MathUtils.degToRad(18.4);
  const held = cadAnchor(root,launcher,[0,.41,0],'cad-held-note',tilt);
  const shot = cadAnchor(root,launcher,[.26,.5,0],'cad-shot-mouth',tilt);
  cadAnchor(root,hooks,[.05,.75,-.2],'cad-climb-hook');
  let pitch = 0, flip = 0, reach = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.3,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.15,.12,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), climbing = s.climb > 0, aim = s.aiming || s.firing > 0;
      const angle = s.amp ? THREE.MathUtils.degToRad(55) : aim || s.passing ? THREE.MathUtils.clamp(s.hood,THREE.MathUtils.degToRad(10),THREE.MathUtils.degToRad(60)) : tilt;
      pitch = active ? scoringActuator(pitch,(climbing ? THREE.MathUtils.degToRad(10) : angle)-tilt,3,s.dt) : 0;
      flip = active ? scoringActuator(flip,s.amp ? -1.6 : 0,5,s.dt) : 0;
      reach = active ? actuator(reach,climbing ? (s.climb > .5 ? .45 : .06) : 0,.8,s.dt) : 0;
      launcher.rotation.z = pitch; diverter.rotation.z = flip;
      hooks.position.copy(hookRest).addScaledVector(CLIMB,reach);
      if (mid) mid.position.copy(midRest).addScaledVector(CLIMB,reach/2);
    },
  };
}
