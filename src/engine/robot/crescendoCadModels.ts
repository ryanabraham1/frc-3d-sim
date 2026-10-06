import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';

/** Supplied 2024 assemblies in meters. +X points toward the shooter.
 * 2910: silver turret and pitching shooter, rear intake (TBA 2024 / team binder).
 * 1690: black low chassis, front intake and shared pitching conveyor (Orbit reveal).
 * Joint centers are measured from opposing CAD bearings. Climb travel is fitted,
 * not a rigid-body simulation; drive and scoring tuning retain roster estimates.
 */
export function buildCrescendoCad(id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const typhoon = id === 'typhoon-2910', twister = id === 'twister-118', rush = id === 'gold-rush-27', domotron = id === 'domotron-604';
  if (twister) root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      // Included competition photo: the orange CAD structural swatch is gold anodizing.
      if(m.color.r>.1&&m.color.g>.02&&m.color.r>m.color.g*1.4&&m.color.r>m.color.b*3){m.color.setHex(0xbd901f);m.metalness=.4;m.roughness=.5;}
    }
  });
  if (id === 'doppler-1690') root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      // Orbit's photos show black cut plates, covers and rollers; CAD whites
      // are manufacturing swatches. Keep the metal shafts and gears silver.
      if (m.userData.cadSheet || /^1\.000000_1\.000000_1\.000000/.test(m.name)) {
        m.color.setHex(0x181a1d);m.metalness=.12;m.roughness=.65;
      }
    }
  });
  const pivot = (name: string, at: [number,number,number], parent: THREE.Object3D = root) => {
    const part = root.getObjectByName(name);
    const joint = new THREE.Group(); joint.name = `cad-${name}-pivot`; joint.position.fromArray(at); root.add(joint);
    root.updateMatrixWorld(true); if (part) joint.attach(part);
    if (parent !== root) { root.updateMatrixWorld(true); parent.attach(joint); }
    return joint;
  };
  const turret = typhoon ? pivot('turret',[.1397,.1524,0]) : twister ? pivot('turret',[0,.28085,0]) : undefined;
  const carriage = domotron ? pivot('carriage',[.12225,.24155,0]) : undefined;
  if (turret) {
    const feeder = root.getObjectByName('feeder'); if (feeder) { root.updateMatrixWorld(true); turret.attach(feeder); }
  }
  // Typhoon's paired 6803 pitch bearings; Doppler's rear conveyor shaft.
  const shooter = pivot('shooter',typhoon ? [-.11315,.2742,0] : twister ? [-.1651,.4223,0] : rush ? [.28745,.48165,0] : domotron ? [.12225,.24155,0] : [-.2422,.1027,0],turret ?? carriage ?? root);
  const intake = new THREE.Object3D(); intake.name = 'cad-intake-mouth';
  intake.position.set(typhoon ? -.425 : twister ? -.33 : rush ? -.61 : domotron ? -.49 : .36,.065,0); root.add(intake);
  const shot = new THREE.Object3D(); shot.name = 'cad-shot-mouth';
  shot.position.set(typhoon ? .305 : twister ? .2 : rush ? .39 : domotron ? .238 : .19,typhoon ? .34 : twister ? .45 : rush ? .55 : domotron ? .56 : .18,0); root.add(shot); root.updateMatrixWorld(true); shooter.attach(shot);
  const held = new THREE.Object3D(); held.name='cad-held-note';
  held.position.set(typhoon ? .1397 : twister ? 0 : rush ? .27 : domotron ? .08 : .05,typhoon ? .22 : twister ? .34 : rush ? .5 : domotron ? .3 : .145,0);
  root.add(held);root.updateMatrixWorld(true);(typhoon ? turret! : shooter).attach(held);
  const climbers = typhoon ? [pivot('climber',[-.364,.204,0])] : twister ? [pivot('climber-left',[.06,.335,-.31]),pivot('climber-right',[.06,.335,.31])] : rush ? [] : domotron ? [pivot('climber',[.17,.29,0])] : [pivot('climber-left',[.0175,.147,-.3145]),pivot('climber-right',[.0175,.147,.3145])];
  const skis = twister ? [pivot('ski-left',[-.30,.325,-.27]),pivot('ski-right',[-.30,.325,.27])] : [];
  const rushClimb = rush ? pivot('climber',[0,0,0]) : undefined;
  const amp = rush ? pivot('amp',[.24,.63,0]) : twister ? pivot('diverter',[.1,.6,0],turret) : undefined;
  const point = (o: THREE.Object3D) => { k.visual.updateMatrixWorld(true); return k.visual.worldToLocal(o.getWorldPosition(new THREE.Vector3())); };
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake, heldAnchor:held, lightAt:[0,.3,k.config.frameWidth*.35],
    flow:{ intake:()=>[point(intake),new THREE.Vector3(typhoon ? -.2 : .15,.12,0)], stow:()=>point(held), feed:()=>[point(held),point(shot)] },
    update(s) {
      if (!animated()) { shooter.rotation.z=0; if(turret)turret.rotation.y=0; for(const c of [...climbers,...skis])c.rotation.z=0; if(carriage)carriage.position.y=.24155; if(rushClimb)rushClimb.position.y=0; if(amp)amp.rotation.z=0; return; }
      if(turret)turret.rotation.y=k.turret.rotation.y;
      shooter.rotation.z = s.aiming ? THREE.MathUtils.clamp(s.hood,.14,1.08)-(typhoon ? .435 : twister ? .35 : rush ? .15 : domotron ? .72 : .02) : 0;
      for(const c of climbers)c.rotation.z = s.climb*(typhoon ? 1.8 : twister ? .8 : domotron ? -1.4 : -1.85);
      if(rushClimb)rushClimb.position.y=.35*s.climb;
      for(const ski of skis)ski.rotation.z=-s.climb*.7;
      if(carriage)carriage.position.y=.24155+(s.passing?.25:0);
      if(amp)amp.rotation.z=rush ? (s.passing ? 0 : -.9) : (s.passing ? -.8 : 0);
    },
  };
}
