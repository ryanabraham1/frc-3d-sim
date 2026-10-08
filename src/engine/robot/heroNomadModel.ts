import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 6995 NOMAD (WCP CADathon Hero Heist gadgeteer), from the team's Onshape assembly. Source axes (Z up, +Y shooter,
 * -Y intake) are mapped to the sim frame by `prepare-robot-cad.mjs` (x forward, y up, z right); the elevator and end
 * effector are turned 180° so the panel lift stands on the shooter (front) side, where the rules place panels.
 * Joint centers are measured from the exported shafts; travel and angles are fitted [EST] (the export is one pose).
 */
export function buildNomadCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: string[]) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); root.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  const slapdown = pivot('slapdown', [-.09, .44, 0], ['slapdown']);
  const hood = pivot('hood', [.24, .40, 0], ['hood']);
  const flywheel = pivot('flywheel', [.24, .40, 0], ['flywheel']);
  const backroller = pivot('backroller', [.105, .285, 0], ['backroller']);
  const stage = get('elevator-stage'), effector = get('effector');
  const effectorY = effector?.position.y ?? 0, stageY = stage?.position.y ?? 0;

  // Panels ride flat on the end-effector rollers; the rules draw them at this anchor.
  const held = new THREE.Object3D(); held.name = 'nomad-panel-anchor'; held.position.set(.37, 1.02, 0); root.add(held);
  if (effector) effector.attach(held);

  // Both ball and panel mouths are on the back (intake) side; mark them like the engine's orange ground intake.
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .55, emissive: 0xff5a00, emissiveIntensity: .25 });
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .60, 12), orange);
  mouth.rotation.x = Math.PI / 2; mouth.position.set(-.345, .26, 0); root.add(mouth);
  const panelMouth = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .56, 12), orange);
  panelMouth.rotation.x = Math.PI / 2; panelMouth.position.set(-.235, .39, 0); root.add(panelMouth);
  if (slapdown) { slapdown.attach(panelMouth); }
  const tip = new THREE.Object3D(); tip.position.set(-.36, .22, 0); root.add(tip);

  // Held SPEECH BUBBLES sit on the midtake belts between the intake and the shooter (visual only, fill = held/capacity).
  const r = .0889, COUNT = Math.max(1, Math.round(k.config.hopperCapacity || 4));
  const ballMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .7 });
  const ballGeo = new THREE.SphereGeometry(r * .95, 14, 10);
  const slots: [number, number][] = [[-.12, -.10], [-.12, .10], [.06, -.10], [.06, .10], [-.30, 0], [.06, 0]];
  const balls = Array.from({ length: COUNT }, (_, n) => {
    const [x, z] = slots[n % slots.length];
    const m = new THREE.Mesh(ballGeo, ballMat); m.position.set(x, .33, z); m.visible = false; root.add(m); return m;
  });

  let deploy = 0, lift = 0, pitch = 0;
  const point = (o: THREE.Object3D, x = 0, y = 0, z = 0) => { k.visual.updateMatrixWorld(true); return k.visual.worldToLocal(o.localToWorld(new THREE.Vector3(x, y, z))); };
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, heldAnchor: held, lightAt: [0, .80, .27],
    flow: {
      intake: () => [new THREE.Vector3(-.38, .22, 0), new THREE.Vector3(-.22, .27, 0), new THREE.Vector3(-.06, .31, 0)],
      stow: () => new THREE.Vector3(-.03, .33, 0),
      feed: () => [new THREE.Vector3(.06, .33, 0), new THREE.Vector3(.16, .36, 0), point(flywheel, -.01, -.02, 0), point(flywheel, .06, .05, 0)],
    },
    update(s) {
      const shown = Math.round(s.fill * COUNT); balls.forEach((b, n) => b.visible = n < shown);
      if (!animated()) return;
      // Slapdown drops to the floor whenever the robot is enabled (panels stay inside it when stowed) [EST travel].
      deploy = scoringEase(deploy, s.enabled ? 1 : 0, s.dt);
      slapdown.rotation.z = deploy * .95;
      // Continuous elevator: the placement pose from the rules drives both stages [EST: stage 1 travels .33 m, carriage .30 m more].
      const want = s.place ? THREE.MathUtils.clamp((s.place.height - .45) / .65, 0, 1) : 0;
      lift = scoringEase(lift, want, s.dt);
      if (stage) stage.position.y = stageY - (1 - lift) * .33;
      if (effector) effector.position.y = effectorY - (1 - lift) * .33;
      // Fixed hood tilts through its 27° range with the launch elevation.
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp(s.hood, .26, 1.22) - .85 : 0, s.dt);
      hood.rotation.z = pitch * .75;
      const spin = (s.enabled && (s.aiming || s.firing > 0) ? 60 : 0) * s.dt;
      flywheel.rotation.z -= spin; backroller.rotation.z += spin;
    },
  };
}
