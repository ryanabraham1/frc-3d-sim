import * as THREE from 'three';
import { cloneCadPart } from './cadModels';
import type { RobotAnimState } from './models';
import type { TurretShooter } from './turretShooter';

// Donor geometry is deliberately labelled as adapted. Layouts and finishes come from
// each destination builder and its TBA 2026 photos, not the donor robot's layout.
const ease = (a: number, b: number, dt: number) => dt > 0 ? a + (b-a)*(1-Math.exp(-7*dt)) : b;
function finish(part: THREE.Object3D, color?: number) {
  if (color === undefined) return;
  part.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial && m.name !== 'rubber' && !m.transparent && (m.userData.cadSheet || m.name === 'team-accent')) {
        m.color.setHex(color); m.metalness = .45; m.roughness = .55;
      }
    }
  });
}
function assembly(id: string, names: string[], origin: THREE.Vector3, scale: THREE.Vector3, color?: number) {
  const parts = names.map(name => cloneCadPart(id,name));
  if (parts.some(p => !p)) return undefined;
  const root = new THREE.Group(); root.name = `adapted-cad-${id}`;
  root.userData.cadDonor = id;
  root.scale.copy(scale);
  parts.forEach(part => { part!.position.sub(origin); finish(part!,color); root.add(part!); });
  return root;
}
function hinge(root: THREE.Group, name: string, at: THREE.Vector3) {
  const part = root.getObjectByName(name)!;
  const g = new THREE.Group(); g.name = `adapted-${name}-pivot`; g.position.copy(at);
  // Coordinates are still in source meters within the shared scaled assembly.
  part.removeFromParent(); part.position.sub(at); g.add(part); root.add(g);
  return g;
}

/** Compact 971 left head: bearing plate, feeder, pocketed cheeks, drum and real hood sector. */
export function adaptedTurretShooter(parent: THREE.Object3D, o: { width: number; topY: number; color?: number }): TurretShooter | undefined {
  const base = new THREE.Vector3(.147955,.334898,-.20955);
  const scale = new THREE.Vector3(.9,.95,o.width/.256413);
  const root = assembly('mixtape-971',['turret-left','hood-left','flywheel-left'],base,scale,o.color);
  if (!root) return;
  root.position.y = o.topY - .20079*scale.y;
  parent.add(root);
  const at = new THREE.Vector3(.205334,.477139,-.209588).sub(base);
  const hood = hinge(root,'hood-left',at), wheel = hinge(root,'flywheel-left',at);
  wheel.userData.flowSpinAxis = 'z';
  let angle = 0, speed = 0;
  return {hood,flywheel:wheel,update(s) {
    angle = ease(angle,(s.aiming || s.firing>0 ? THREE.MathUtils.clamp(s.hood,.5,1.25) : 1.28)-1.28,s.dt);
    hood.rotation.z = angle;
    speed = ease(speed,s.enabled && (s.aiming || s.firing>0) ? 50 : 0,s.dt);
    wheel.rotation.z += speed*s.dt;
  }};
}

/** Rubble's complete shooter, shortened in X/Y and widened for the destination's lanes. */
export function adaptedDumper(parent: THREE.Object3D, o: { x: number; y: number; width: number; color: number }) {
  const origin = new THREE.Vector3(.28575,.47625,0);
  const root = assembly('shooter-581-donor',['frame','hood','flywheel'],origin,new THREE.Vector3(.82,.82,o.width/.70505),o.color);
  if (!root) return;
  root.position.set(o.x,o.y,0); parent.add(root);
  const hood = hinge(root,'hood',new THREE.Vector3()), wheel = hinge(root,'flywheel',new THREE.Vector3());
  wheel.userData.flowSpinAxis = 'z';
  wheel.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m instanceof THREE.MeshStandardMaterial && !m.userData.cadSheet) {
        m.color.setHex(0x202328); m.metalness = 0; m.roughness = .85;
      }
    }
  });
  let angle = 0;
  return {root,hood,flywheel:wheel,update(s: RobotAnimState) {
    angle = ease(angle,(s.aiming || s.firing>0 ? THREE.MathUtils.clamp(s.hood,.5,1.25) : 1.349)-1.349,s.dt);
    hood.rotation.z = angle;
    wheel.rotation.z += (s.enabled && (s.aiming || s.firing>0) ? 50 : 0)*s.dt;
  }};
}

/** 604's ramps, chains, pocketed cheeks and feed rollers; shorten only the vertical travel. */
export function adaptedRotorColumn(parent: THREE.Object3D, o: { x: number; y0: number; top: number; radius: number; color: number }) {
  const base = new THREE.Vector3(.0254,.1524,0);
  const scale = new THREE.Vector3(o.radius/.116,o.top>o.y0 ? (o.top-o.y0)/.371475 : 1,o.radius/.116);
  const root = assembly('rotor-604-donor',['frame','rotor','infeed','upfeed'],base,scale,o.color);
  if (!root) return;
  root.position.set(o.x,o.y0,0); parent.add(root);
  const rotor = hinge(root,'rotor',new THREE.Vector3(0,0,0));
  const infeed = hinge(root,'infeed',new THREE.Vector3(.115097,.235538,.09127).sub(base));
  const upfeed = hinge(root,'upfeed',new THREE.Vector3(.115925,.315912,-.00402).sub(base));
  return {root,update(s: RobotAnimState) {
    const speed = s.enabled ? s.firing>0 ? 8 : 1.2 : 0;
    rotor.rotation.y += speed*s.dt;
    infeed.rotation.y += speed*4*s.dt;
    upfeed.rotation.z += speed*4*s.dt;
  }};
}
