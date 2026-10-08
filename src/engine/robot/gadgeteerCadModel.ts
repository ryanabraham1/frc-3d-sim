import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 9408 Gadgeteer (WCP CADathon: Hero Heist). Onshape Z-up export mapped (-Y,Z,-X) in meters: source +Y (floor intake)
 * is robot -X, the shooter faces robot +X. Joint centres are measured from the CAD shafts; travels are [EST].
 * The elevator carries the claw on the robot's left side in the CAD; placement is still drawn at the front, so the held
 * panel rides the claw and moves out to the placement pose while a placement runs.
 */
export function build9408Cad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: string[]) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); root.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  // Intake: 28.5 in hex shaft at source (y .198, z .177) is the arm hinge; stowed it folds up behind the elevator.
  const intake = pivot('intake', [-.198, .177, 0], ['intake']);
  const wrist = pivot('wrist', [0, .693, .198], ['manip']);
  const flywheel = pivot('flywheel', [.025, .709, 0], ['flywheel']);
  const stages = ['climb-mid1', 'climb-mid2', 'climb-end', 'climb-pad'].map(get);
  const stageY = stages.map(o => o?.position.y ?? 0);
  const contact = new THREE.Object3D(); contact.name = '9408-climb-contact'; contact.position.set(.082, .825, -.241); root.add(contact);
  const pad = get('climb-pad'); if (pad) pad.attach(contact);
  // Lowest of the three 1.25 in intake roller tubes (source y .619, z .143), 0.64 m wide.
  const tip = new THREE.Object3D(); tip.position.set(-.619, .143, 0); root.add(tip); intake.attach(tip);
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .55, emissive: 0xff5a00, emissiveIntensity: .25 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .62, 12), orange);
  bar.name = '9408-intake-marker'; bar.rotation.x = Math.PI / 2; bar.position.set(-.619, .143, 0); root.add(bar); intake.attach(bar);
  // Held SPEECH BUBBLES ride in the hopper behind the shooter (visual only), shown by fill = held / capacity.
  const r = .0889, COUNT = Math.max(1, Math.round(k.config.options?.bubbleCapacity as number || 4));
  const ballMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .7 });
  const ballGeo = new THREE.SphereGeometry(r * .95, 14, 10);
  const spots: [number, number, number][] = [[-.2, .27, .09], [-.2, .27, -.09], [-.3, .3, .09], [-.3, .3, -.09]];
  const balls = Array.from({ length: COUNT }, (_, n) => {
    const m = new THREE.Mesh(ballGeo, ballMat); m.name = '9408-held-bubble';
    m.position.fromArray(spots[n % spots.length]); m.position.y += Math.floor(n / spots.length) * .17;
    m.visible = false; root.add(m); return m;
  });
  // Held STORY PANELS ride the claw, then move out to the season's placement pose.
  const held = new THREE.Object3D(); held.name = '9408-held-anchor'; held.position.set(0, .60, .27); root.add(held);
  const rest = held.position.clone();
  let deploy = 0, extension = 0, wristAngle = 0, reach = 0;
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, climbAnchor: contact, heldAnchor: held, lightAt: [-.26, .53, -.08],
    update(s) {
      const shown = Math.round(s.fill * COUNT); balls.forEach((b, n) => b.visible = n < shown);
      const placing = !!s.place && s.place.level > 0;
      reach = scoringEase(reach, placing ? 1 : 0, s.dt);
      held.position.set(THREE.MathUtils.lerp(rest.x, s.place?.forward ?? rest.x, reach), THREE.MathUtils.lerp(rest.y, s.place?.height ?? rest.y, reach), THREE.MathUtils.lerp(rest.z, 0, reach));
      if (!animated()) return;
      deploy = scoringEase(deploy, s.enabled && !s.climb ? 1 : 0, s.dt);
      intake.rotation.z = -(1 - deploy) * 1.3;
      wristAngle = scoringEase(wristAngle, placing ? .55 : 0, s.dt); wrist.rotation.x = wristAngle;
      flywheel.rotation.z += (s.enabled && (s.aiming || s.firing > 0) ? 60 : 0) * s.dt;
      extension = scoringEase(extension, s.climb > .6 ? 1 : s.climb > 0 ? .2 : 0, s.dt);
      stages.forEach((o, i) => { if (o) o.position.y = stageY[i] + extension * [.3, .6, .9, .9][i]; });
    },
  };
}
