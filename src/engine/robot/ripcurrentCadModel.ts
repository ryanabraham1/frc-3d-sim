import * as THREE from 'three';
import { fillBlock, type ModelKit, type RobotModel } from './models';
import { hopperNetCeiling } from './config';

/** User-supplied Top Assembly.glb, a 4414 clone. CAD geometry and finishes are retained.
 * Source Z-up is mapped to game Y-up, intake (-Y) to back (-X).
 * The export provides a single pose and no joint limits: retain the intake/hood pose;
 * rotate the complete pancake assembly about its measured vertical ring at the origin.
 */
export function buildRipcurrentCad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const turret = root.getObjectByName('turret')!;
  k.visual.userData.fuelKeepouts = [
    {x:0,z:0,radius:.09,bottom:.28,top:.34},
    {x:0,z:0,radius:.19,bottom:.34,top:.68},
  ];
  // Measured CAD panel tops/outline, independent of the old procedural footprint.
  const rim = .554, area = {cx:-.13,sx:.48,sz:.43};
  k.visual.userData.hopperNetProfile = {rim,area,openingRadius:.245};
  k.visual.userData.hopperChamfer = {hx:.35,hz:.43,cut:.17,fixedSide:1};
  // A continuous sewn hem makes the clipped diamond strands read as fabric.
  const perimeter = [[-.61,-.43],[.18,-.43],[.35,-.26],[.35,.26],[.18,.43],[-.61,.43]];
  const seam = new THREE.CurvePath<THREE.Vector3>();
  perimeter.forEach(([x,z],i)=>{const next=perimeter[(i+1)%perimeter.length];seam.add(new THREE.LineCurve3(new THREE.Vector3(x,rim,z),new THREE.Vector3(next[0],rim,next[1])));});
  const thread = new THREE.MeshStandardMaterial({color:0x25282b,roughness:1});
  const hem = new THREE.Mesh(new THREE.TubeGeometry(seam,128,.0014,5,true),thread);
  hem.name='cad-4414-net-hem';hem.userData.fuelNoContact=true;k.visual.add(hem);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(.245,.0014,5,96),thread);
  collar.rotation.x=Math.PI/2;collar.position.y=rim;collar.name='cad-4414-net-turret-opening';collar.userData.fuelNoContact=true;k.visual.add(collar);
  const ceiling = hopperNetCeiling({...k.config,hopperExpansion:{...k.config.hopperExpansion!,area}},rim);
  const pile = fillBlock(k.visual,{x:area.cx,y0:.12,length:area.sx*2,width:area.sz*2,height:k.config.hopperExpansion!.fullHeight-.12,exactFloor:true,color:0xf2c200,capacity:k.config.hopperCapacity,keepouts:k.visual.userData.fuelKeepouts,ceiling,
    inside:(x,z)=>x+Math.abs(z)<.61});
  const tip = new THREE.Object3D(); tip.name = 'cad-4414-intake-anchor';
  tip.position.set(-.59, .10, 0); root.add(tip);
  const point = (x: number, y: number, z = 0) => {
    k.visual.updateMatrixWorld(true);
    return k.visual.worldToLocal(turret.localToWorld(new THREE.Vector3(x,y,z)));
  };
  return {
    replaces: ['bumpers','chassis','launcher','hopper','intakeRollers','climber','funnel'],
    lightAt: [0,.48,.32], intakeAnchor: tip,
    flow: {
      intake: () => [tip.position.clone(), new THREE.Vector3(-.28,.22,0)],
      stow: () => new THREE.Vector3(-.25,.27,0),
      feed: () => [new THREE.Vector3(0,.25,0),point(0,.34),point(.08,.52)],
    },
    update(s) {
      pile.set(s.fill);
      // CAD-pose mode shows the original exported heading.
      turret.rotation.y = isAnimated() ? k.turret.rotation.y : 0;
    },
  };
}
