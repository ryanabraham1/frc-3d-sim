import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/** Alliance tint for the held SPEECH BUBBLEs (matches the season's piece colours). */
const BUBBLE_COLOR = { red: 0xe83d4f, blue: 0x337fe8 } as const;
const INTAKE_ORANGE = 0xff7a1a;

/**
 * 6731 Multiclass (WCP CADathon 2025). Source axes (-Y,Z,-X), meters, floor at y = 0 (CAD offset 0.048 m).
 * Fixed rear over-bumper intake on an arm hinged on the 26.125 in hex at (x -0.0955, y 0.194) [pivot measured from the
 * CAD, travel is an estimate], fixed front shooter whose hood assembly pivots on the 3DP hood gear hex. The six SPEECH
 * BUBBLEs modelled in the CAD are the held-piece display: bubble-N is shown while `fill` holds more than N pieces.
 */
export function buildMulticlassCad(_id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number,number,number], parts: string[], parent: THREE.Object3D = root) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at).sub(parent.position); parent.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o=get(part); if(o)g.attach(o); }
    return g;
  };
  const arm = pivot('intake',[-.0955,.194,0],['intake']);
  const rollers = [
    pivot('roller-main',[-.561,.064,0],['roller-main'],arm),
    pivot('roller-stub1',[-.501,.182,0],['roller-stub1'],arm),
    pivot('roller-stub2',[-.447,.234,0],['roller-stub2'],arm),
  ];
  const hood = pivot('hood',[.0795,.513,0],['hood','flywheel']);
  const flywheel = pivot('flywheel',[.272,.378,0],['flywheel'],hood);
  const feeder = pivot('feeder',[.032,.402,0],['feeder']);
  // Every intake side is marked: the compliant roller reads as the orange intake bar.
  get('roller-main')?.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.color.setHex(INTAKE_ORANGE).convertSRGBToLinear();
    m.material = mat;
  });
  const bubbles: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const b = get(`bubble-${i}`); if (!b) continue;
    b.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.setHex(BUBBLE_COLOR[k.alliance]).convertSRGBToLinear(); mat.metalness = 0; mat.roughness = .5;
      m.material = mat;
    });
    bubbles.push(b);
  }
  const tip = new THREE.Object3D(); tip.position.set(-.56,.07,0); arm.add(tip);
  let deploy = 0, pitch = 0, spin = 0;
  return {
    replaces: ['chassis','hopper','launcher','climber','intakeRollers','funnel'],
    intakeAnchor: tip, lightAt: [-.1,.54,.2],
    update(s) {
      const held = Math.round(THREE.MathUtils.clamp(s.fill,0,1) * bubbles.length);
      bubbles.forEach((b,i) => { b.visible = i < held; });
      if (!animated()) return;
      // The exported pose is the deployed one. Stow raises the arm over the frame [EST travel].
      deploy = scoringEase(deploy, s.enabled ? 1 : 0, s.dt);
      arm.rotation.z = -(1 - deploy) * 1.0;
      spin += (s.intaking && s.enabled ? 30 : 0) * s.dt;
      rollers.forEach(r => { r.rotation.z = spin; });
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp(s.hood - .85, -.45, .5) : 0, s.dt);
      hood.rotation.z = pitch;
      const shooting = s.enabled && (s.aiming || s.firing > 0);
      flywheel.rotation.z -= (shooting ? 60 : 0) * s.dt;
      feeder.rotation.z -= (shooting && s.firing > 0 ? 25 : 0) * s.dt;
    },
  };
}
