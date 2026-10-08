import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 3847 Spectrum "Ultraviolet" (public Onshape "2024 Ultraviolet").
 *
 * Checklist (CLAUDE.md "verify before you build"):
 * - Archetype: front pivoting launcher (sector-gear pivot, Revolute 1 indexer <-> launcher plate) + back "AmpTrap"
 *   roller tower on a 15 degree single-stage elevator ("Elevator Motion" slider) + two slanted 1x1 climber slides
 *   (Slider 1/2, 42 degrees from horizontal). Source: Onshape mates and Spectrum's public 2024-Ultraviolet code
 *   (mechanisms/pivot, elevator, climber, amptrap).
 * - Intake end: back (-X). Fixed under-bumper "2. Intake" with two silicone generative rollers below the AmpTrap
 *   tower (sim x -0.29..-0.37, rollers 8-96 mm off the carpet).
 * - Scoring end: front (+X) launcher for the SPEAKER; the AmpTrap tower over the back scores AMP and TRAP
 *   (the code's "intoAmp" pivot pose feeds it).
 * - Colours: purple powder-coated frame and plates, silver tubes, black rollers (CAD appearances match the team's
 *   purple robots; no 2024 TBA photo was available, so the colours come from the CAD only).
 * - Capacity 1 NOTE (rule). Pivot: code positions are percent of travel, 0 = horizontal (the CAD export pose),
 *   subwoofer 81 %, intoAmp 78 %; the 72 degree full travel is [EST]. Elevator: amp 15 / trap 5 of 29.8
 *   rotations; the 0.45 m stroke behind those rotations is [EST] from the 0.64 m rails. Climber slide stroke
 *   0.35 m is [EST] from the brace overlap.
 */
const LIFT = new THREE.Vector3(-.259,.966,0).normalize();
const SLIDE = new THREE.Vector3(-.748,.663,0).normalize();
const FULL = THREE.MathUtils.degToRad(72);

export function buildUltravioletCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const launcher = cadJoint(root,['shooter'],[0,.2604,0],'cad-shooter-pivot');
  const amp = root.getObjectByName('amp')!, slides = root.getObjectByName('climber')!;
  const ampRest = amp.position.clone(), slideRest = slides.position.clone();
  const intake = cadAnchor(root,root,[-.36,.05,0],'cad-intake-mouth');
  const held = cadAnchor(root,launcher,[.12,.3,0],'cad-held-note');
  const shot = cadAnchor(root,launcher,[.35,.305,0],'cad-shot-mouth');
  cadAnchor(root,slides,[-.17,.658,.26],'cad-climb-hook');
  let pitch = 0, lift = 0, reach = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.3,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.2,.12,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), climbing = s.climb > 0, aim = s.aiming || s.firing > 0;
      const percent = s.amp ? 78 : climbing ? 3 : 1;
      const angle = aim || s.passing ? THREE.MathUtils.clamp(s.hood,0,FULL) : FULL*percent/100;
      pitch = active ? scoringActuator(pitch,angle,4,s.dt) : 0;
      const rotations = climbing ? (s.climb <= .5 ? 5 : 0) : s.amp ? 15 : 0;
      lift = active ? scoringActuator(lift,.45*rotations/29.8,1.2,s.dt) : 0;
      // Code: topClimb 100 % to reach the chain, botClimb 0 % to hang.
      reach = active ? actuator(reach,climbing && s.climb > .5 ? .35 : 0,.7,s.dt) : 0;
      launcher.rotation.z = pitch;
      amp.position.copy(ampRest).addScaledVector(LIFT,lift);
      slides.position.copy(slideRest).addScaledVector(SLIDE,reach);
    },
  };
}
