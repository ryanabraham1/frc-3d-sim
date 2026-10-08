import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * 1318 "Constantine" (Hero Heist Mystic) rig. Source CAD axes (-Y,Z,-X), meters: the full-width intake and the
 * shooter exit are both on CAD -Y, which is sim +X (front), so the config uses `intake.groundSide:'front'`.
 * Joint centers are read from the assembly; travel and angles are fitted [EST].
 */
export function buildConstantineCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number,number,number], parts: string[]) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); root.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  // Shooter wheels and hood share the flywheel axle (hood arc gear is centred on it).
  const hood = pivot('hood', [-.07,.56,0], ['hood']);
  const flywheel = pivot('flywheel', [-.07,.56,0], ['flywheel']);
  // Touch-it-own-it 4-bar: links swing about their lower pivots, the roller frame translates along the arc.
  const links = pivot('intake-links', [.19,.16,0], ['intake-links']);
  const coupler = new THREE.Group(); coupler.name = 'cad-intake-coupler'; root.add(coupler);
  const intake = get('intake'); if (intake) coupler.attach(intake);
  const stageMid = get('climb-mid'), stageTop = get('climb-top');
  const midY = stageMid?.position.y ?? 0, topY = stageTop?.position.y ?? 0;
  // Suction cups sit on the CAD +X side (sim -Z), 0.91 m up.
  const contact = new THREE.Object3D(); contact.name = 'constantine-climb-contact'; contact.position.set(0,.915,-.20); root.add(contact);
  if (stageTop) stageTop.attach(contact);
  // Lowest roller bar is the mouth; the same orange marker the engine's ground intake uses.
  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: .55, emissive: 0xff5a00, emissiveIntensity: .25 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.60,12), orange);
  bar.rotation.x = Math.PI/2; bar.position.set(.30,.16,0); root.add(bar); coupler.attach(bar);
  const tip = new THREE.Object3D(); tip.position.set(.30,.16,0); root.add(tip); coupler.attach(tip);
  // Held SPEECH BUBBLES ride the indexer loop (visual only), shown as fill = held / capacity.
  const COUNT = 6, ball = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .7 });
  const geo = new THREE.SphereGeometry(.0889*.8,14,10);
  const path = [[.23,.37],[.05,.34],[-.10,.32],[-.185,.47],[-.07,.56]].map(([x,y]) => new THREE.Vector2(x,y));
  const along = (t: number) => {
    const lens = path.slice(1).map((p,i) => p.distanceTo(path[i])), total = lens.reduce((a,b) => a+b,0);
    let d = t*total;
    for (let i = 0; i < lens.length; i++) { if (d <= lens[i] || i === lens.length-1) return path[i].clone().lerp(path[i+1], Math.min(1, d/lens[i])); d -= lens[i]; }
    return path[path.length-1].clone();
  };
  const balls = Array.from({ length: COUNT }, (_,n) => {
    const m = new THREE.Mesh(geo, ball), p = along(n/(COUNT-1));
    m.position.set(p.x,p.y,0); m.visible = false; root.add(m); return m;
  });
  const L = .30, SWING = .8;
  let deploy = 0, extension = 0, pitch = 0;
  return {
    replaces: ['chassis','hopper','launcher','climber','intakeRollers','funnel'],
    intakeAnchor: tip, climbAnchor: contact, lightAt: [-.22,.30,.15],
    update(s) {
      const shown = Math.round(s.fill*COUNT); balls.forEach((b,n) => b.visible = n < shown);
      if (!animated()) return;
      deploy = scoringEase(deploy, s.enabled && !s.climb ? 1 : 0, s.dt);
      links.rotation.z = -deploy*SWING;
      coupler.position.set(deploy*L*Math.sin(SWING), deploy*L*(Math.cos(SWING)-1), 0);
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp(s.hood,.26,1.22)-.85 : 0, s.dt);
      hood.rotation.z = THREE.MathUtils.clamp(pitch,-.4,.4);
      flywheel.rotation.z -= (s.enabled && (s.aiming || s.firing > 0) ? 45 : 0)*s.dt;
      extension = scoringEase(extension, s.climb > .6 ? 1 : s.climb > 0 ? .2 : 0, s.dt);
      if (stageMid) stageMid.position.y = midY + extension*.22;
      if (stageTop) stageTop.position.y = topY + extension*.44;
    },
  };
}
