import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 9408 Gadgeteer (WCP CADathon: Hero Heist). Onshape Z-up export mapped (-Y,Z,-X) in meters: source +Y (floor intake)
 * is robot -X, the shooter faces robot +X. Joint centres are measured from the CAD shafts; travels are [EST].
 * Binder (9408 technical binder): pivoting upright-stowing intake, 4 in flywheel + 2 in backspin wheels with adjustable hood,
 * 2-stage cascade elevator, two-joint arm with a two-panel end effector, telescope + suction cup. The CAD end effector is on
 * the robot's left side; placement is still drawn at the front, so the held panel rides it and moves to the placement pose.
 */
export function build9408Cad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: string[]) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); root.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  // Intake: pivoting arm (binder: 50:1 pivot, stows upright) on the 28.5 in hex shaft at source (y .198, z .177).
  const intake = pivot('intake', [-.198, .177, 0], ['intake']);
  // Elevator: 2-stage cascade. The carriage (arm shoulder + end effector) rides the stage, which moves half as far.
  const stage1 = pivot('elevator-stage', [0, 0, 0], ['elevator-stage']);
  const carriage = pivot('carriage', [0, 0, 0], ['arm']);
  // Two-joint arm: the elbow shaft is at source (x -.186, z .387); the end effector (plate + rollers, holds two panels) hangs off it.
  const elbow = pivot('elbow', [0, .387, .186], ['manip']); carriage.attach(elbow);
  const hood = pivot('hood', [-.03, .61, 0], ['hood']);
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
  const claw = new THREE.Object3D(); claw.position.set(0, .60, .27); root.add(claw); elbow.attach(claw);
  const held = new THREE.Object3D(); held.name = '9408-held-anchor'; held.position.set(0, .60, .27); root.add(held);
  const rest = new THREE.Vector3(), tmp = new THREE.Vector3();
  let deploy = 0, extension = 0, reach = 0, lift = 0, hoodAngle = 0;
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, climbAnchor: contact, heldAnchor: held, lightAt: [-.26, .53, -.08],
    update(s) {
      const shown = Math.round(s.fill * COUNT); balls.forEach((b, n) => b.visible = n < shown);
      const placing = !!s.place && s.place.level > 0;
      reach = scoringEase(reach, placing ? 1 : 0, s.dt);
      if (animated()) {
        const want = s.place ? THREE.MathUtils.clamp((s.place.height - .5) * .6, 0, .55) : 0;
        lift = scoringEase(lift, placing ? want : 0, s.dt);
        carriage.position.y = lift; stage1.position.y = lift / 2;
        elbow.rotation.x = scoringEase(elbow.rotation.x, placing ? .9 : 0, s.dt);
      }
      // Held panels ride the end effector, then swing out to the season's placement pose.
      root.updateMatrixWorld(true); claw.getWorldPosition(tmp); rest.copy(k.visual.worldToLocal(tmp));
      held.position.set(THREE.MathUtils.lerp(rest.x, s.place?.forward ?? rest.x, reach), THREE.MathUtils.lerp(rest.y, s.place?.height ?? rest.y, reach), THREE.MathUtils.lerp(rest.z, 0, reach));
      if (!animated()) return;
      deploy = scoringEase(deploy, s.enabled && !s.climb ? 1 : 0, s.dt);
      intake.rotation.z = -(1 - deploy) * 1.45;
      hoodAngle = scoringEase(hoodAngle, s.aiming ? THREE.MathUtils.clamp(s.hood - .85, -.4, .4) : 0, s.dt); hood.rotation.z = hoodAngle;
      flywheel.rotation.z += (s.enabled && (s.aiming || s.firing > 0) ? 60 : 0) * s.dt;
      extension = scoringEase(extension, s.climb > .6 ? 1 : s.climb > 0 ? .2 : 0, s.dt);
      stages.forEach((o, i) => { if (o) o.position.y = stageY[i] + extension * [.3, .6, .9, .9][i]; });
    },
  };
}
