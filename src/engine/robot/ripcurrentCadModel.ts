import * as THREE from 'three';
import { fillBlock, type ModelKit, type RobotModel } from './models';
import { scoringEase, nearestTurn } from './scoringReadiness';
import { hopperNetCeiling } from './config';

/** NOMAD 6995 Tide Dye clone. CAD pivots + motion ranges reference its public
 * RobotVisualizer, HoodConstants (0–40 degrees), IntakeConstants (0.31 m / 10.8 degrees),
 * DyeRotorConstants (120 RPM feed / 30 RPM reverse), and measured CAD shafts.
 * The ELP cameras, net-support plates and gearbox remain fixed; the central Limelight
 * follows the turret. The intake export is at full extension.
 */
// The CAD shoots toward (-cos(1.198), 0, +sin(1.198)), opposite the old reference.
export const RIPCURRENT_EXPORT_YAW = 1.198 - Math.PI;
export function buildRipcurrentCad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  type Rig = {pivot:[number,number,number];axis:[number,number,number];parent:string;kind:string};
  const joints = new Map<string,{node:THREE.Group;axis:THREE.Vector3;rig:Rig;angle:number;steer?:THREE.Group}>();
  const parts=root.children.filter(n=>n.userData.rig);
  root.updateMatrixWorld(true);
  for(const part of parts){
    const rig=part.userData.rig as Rig,node=new THREE.Group();
    node.name=`cad-${part.name}-pivot`;node.position.fromArray(rig.pivot);root.add(node);root.updateMatrixWorld(true);node.attach(part);
    if(rig.kind==='hood'){node.userData.hood=true;node.userData.hoodRotor=node;}
    joints.set(part.name,{node,axis:new THREE.Vector3(...rig.axis).normalize(),rig,angle:0});
  }
  for(const [name,j] of joints){
    const parent=joints.get(j.rig.parent)?.node;
    if(parent)parent.attach(j.node);
    if(j.rig.kind==='drive'){
      const steer=new THREE.Group();steer.name=`cad-${name}-steer`;steer.position.copy(j.node.position);root.add(steer);root.updateMatrixWorld(true);steer.attach(j.node);j.steer=steer;
    }
  }
  // Seat the complete shooter assembly together; seating just the hood separates it from its flywheel.
  joints.get('hood')!.node.userData.hoodRotor=joints.get('shooter-frame')!.node;
  // Dedicated bumper swatch prevents the alliance tint from recoloring other dark CAD parts.
  root.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(m instanceof THREE.MeshStandardMaterial&&m.name==='4414-bumper-fabric')m.color.copy((k.mats.bumper as THREE.MeshStandardMaterial).color);
  }});
  const turret=joints.get('turret')!.node,hood=joints.get('hood')!,slide=joints.get('intake-slide')!;
  // Start aligned even before the first animation frame; CAD-pose mode still keeps the export heading.
  if(isAnimated())turret.rotation.y=k.turret.rotation.y-RIPCURRENT_EXPORT_YAW;
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
  tip.position.set(-.59, .10, 0); root.add(tip);root.updateMatrixWorld(true);slide.node.attach(tip);
  const point = (x: number, y: number, z = 0) => {
    k.visual.updateMatrixWorld(true);
    return k.visual.worldToLocal(joints.get('shooter-frame')!.node.localToWorld(new THREE.Vector3(x,y,z)));
  };
  let deploy=0,hoodAngle=0,rotorSpeed=0;
  const spin=(j:typeof hood,rate:number,dt:number)=>{j.angle=(j.angle+rate*dt)%(Math.PI*2);j.node.quaternion.setFromAxisAngle(j.axis,j.angle);};
  return {
    replaces: ['bumpers','chassis','launcher','hopper','intakeRollers','climber','funnel'],
    lightAt: [0,.48,.32], intakeAnchor: tip,
    flow: {
      intake: () => {k.visual.updateMatrixWorld(true);return [k.visual.worldToLocal(tip.getWorldPosition(new THREE.Vector3())),new THREE.Vector3(-.28,.22,0)];},
      stow: () => new THREE.Vector3(-.25,.27,0),
      feed: () => [point(0,.25),point(-.018275,.43,.066485),point(-.018275-.08*Math.cos(1.198),.56,.066485+.08*Math.sin(1.198))],
    },
    update(s) {
      pile.set(s.fill);
      if(!isAnimated()){
        for(const j of joints.values()){j.node.quaternion.identity();j.angle=0;if(j.steer)j.steer.rotation.y=0;}
        slide.node.position.set(0,0,0);return;
      }
      const targetYaw=k.turret.rotation.y-RIPCURRENT_EXPORT_YAW;
      turret.rotation.y=scoringEase(turret.rotation.y,nearestTurn(targetYaw,turret.rotation.y),s.dt);
      // Team code maps launch elevation = 85 degrees - hood actuator angle (limited to 0..40).
      // The supplied CAD is at the high-lob / zero-actuator reference.
      const desired=s.aiming||s.firing>0 ? THREE.MathUtils.clamp(85*Math.PI/180-s.hood,0,40*Math.PI/180) : 40*Math.PI/180;
      hoodAngle=scoringEase(hoodAngle,desired,s.dt);// [EST] Register the supplied export zero by 1 degree; actuator travel remains the code's 0..40 degrees.
      hood.node.quaternion.setFromAxisAngle(hood.axis,-hoodAngle-Math.PI/180);
      hood.node.userData.hoodParked=hoodAngle>39.5*Math.PI/180;
      // Linear rack: latch deployed after enabling, retract partially only on an explicit squeeze.
      deploy=scoringEase(deploy,s.enabled||s.deployed||s.fill>.5?1:0,s.dt);
      const retract=(1-deploy)*.31+(s.squeeze??0)*.10;
      slide.node.position.set(retract,retract*Math.sin(10.8*Math.PI/180),0);
      k.visual.userData.hopperNetProfile.area={cx:-.13+retract/2,sx:.48-retract/2,sz:.43};
      const hemPositions=hem.geometry.getAttribute('position') as THREE.BufferAttribute;
      const original=hem.userData.originalPositions??=Float32Array.from(hemPositions.array);
      for(let i=0;i<hemPositions.count;i++){const x=original[i*3];hemPositions.setX(i,x+retract*THREE.MathUtils.clamp((.18-x)/.79,0,1));}
      hemPositions.needsUpdate=true;hem.geometry.computeBoundingSphere();
      // Hook RPMs from DyeRotorConstants; index wheels and flywheel only run while commanded.
      rotorSpeed=scoringEase(rotorSpeed,!s.enabled?0:s.firing>0?120*Math.PI/30:-30*Math.PI/30,s.dt);
      const rotor=joints.get('dye-rotor')!;
      spin(rotor,rotorSpeed,s.dt);
      for(const j of joints.values()){
        if(j.rig.kind==='flywheel')spin(j,s.enabled&&(s.aiming||s.firing>0)?70:0,s.dt);
        if(j.rig.kind==='index')spin(j,s.enabled&&(s.aiming||s.firing>0)?2160*Math.PI/30:0,s.dt);
        if(j.rig.kind==='intakeRoller')spin(j,s.enabled&&s.intaking?-35:0,s.dt);
        if(j.rig.kind==='drive'){
          const [x,,z]=j.rig.pivot,vx=s.vx+s.omega*z,vz=s.vz-s.omega*x,speed=Math.hypot(vx,vz);
          if(speed>.02&&j.steer){const target=Math.atan2(-vz,vx)-Math.atan2(j.axis.x,j.axis.z);j.steer.rotation.y=scoringEase(j.steer.rotation.y,nearestTurn(target,j.steer.rotation.y),s.dt);}
          spin(j,-speed/.0508,s.dt);
        }
      }
    },
  };
}
