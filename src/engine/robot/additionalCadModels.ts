import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import { box, bar, mat, fillBlock, drivebase, roller, hoodShell } from './models';
import type { ModelKit, RobotModel } from './models';
import { hopperNetCeiling } from './config';

// Source: user-supplied 9470 MAIN, Valor VR26A and 971 Championship assemblies.
// Dimensions/pivots below are in meters, measured from the exported shafts/rings.
// Photo references: refs/{9470,6800,971}-2026/sheet.jpg (TBA, three or more views).
// 9470's complete export supplies its intake, indexer and sliding hopper; retraction travel remains estimated.
// 6800's supplied wide-shooter variant differs from the turret in Valor's earlier binder.
// 971 keeps both imported turrets, with a shared simulated aim and alternating feeds.
const ease = (a:number,b:number,dt:number) => dt > 0 ? THREE.MathUtils.lerp(a,b,1-Math.exp(-7*dt)) : b;
function articulation(root: THREE.Group) {
  return (name:string, at:[number,number,number], yaw=0) => {
    const g=new THREE.Group(); g.name=`cad-${name}-pivot`; g.position.fromArray(at); g.rotation.y=yaw;
    root.add(g); root.updateMatrixWorld(true);
    const part=root.getObjectByName(name); if(part) g.attach(part);
    return g;
  };
}
function point(k:ModelKit,o:THREE.Object3D,x=0,y=0,z=0) {
  k.visual.updateMatrixWorld(true);
  return k.visual.worldToLocal(o.localToWorld(new THREE.Vector3(x,y,z)));
}
function fuel(k:ModelKit,front:number,back:number,base:number,rim:number,width:number,compactFront=front,inside?:(x:number,z:number)=>boolean) {
  const g=new THREE.Group();g.name='cad-hopper-fuel';k.visual.add(g);
  // A stretching net roof lets FUEL rise above the rigid rim into the net's dome.
  const e=k.config.hopperExpansion,netted=!!e&&e.mechanism!=='telescoping',roof=netted?e!.fullHeight:rim;
  const pile=fillBlock(g,{x:(front+back)/2,y0:base,length:back-front,width,height:roof-base-.006,exactFloor:true,color:0xf2c200,capacity:k.config.hopperCapacity,inside,ceiling:netted?hopperNetCeiling(k.config,rim):undefined});
  const mesh=g.getObjectByName('hopper-fuel-pile')!;
  let fill=0,deploy=0;
  return {update(f:number,d:number){fill=f;deploy=d;
    const edge=THREE.MathUtils.lerp(compactFront,front,d);
    mesh.userData.resizeFuelBin({x:(edge+back)/2,length:back-edge,height:roof-base-.006});pile.set(f);
  },stow(){
    const f=deploy<.5?compactFront:front;
    for(let i=0;i<100;i++) {
      const x=f+.075+Math.random()*(back-f-.15),z=(Math.random()-.5)*(width-.15);
      if(!inside||inside(x,z))return new THREE.Vector3(x,base+.075+fill*(rim-base-.15),z);
    }
    return new THREE.Vector3((f+back)/2,base+.075,0);
  }};
}
const replaces:RobotModel['replaces']=['chassis','launcher','hopper','intakeRollers','climber','funnel'];

/** S26-A000 supplies the intake/hopper only; drivetrain and shooter remain procedural.
 * CAD origin is shifted 12 inches so the hopper lies over the existing chassis.
 * The lower pickup carriage translates for deployment; upper panels stay rigid.
 * Travel is a simulator approximation because the export contains only one pose.
 */
export function build1114Cad(root:THREE.Group,k:ModelKit,isAnimated:()=>boolean):RobotModel {
  const db=drivebase(k,{motorRing:0xb93628});
  const intake=articulation(root)('intake',[0,0,0]);
  const tip=new THREE.Object3D();tip.position.set(-.15445,.085,0);intake.add(tip);
  const pile=fuel(k,-.325,.245,.15,.695,.73);
  const dark=mat(0x17191c,{rough:.85}),silver=mat(0xbdc4cc,{metal:.7});
  const x=.27,y=k.config.launcher.height,width=.63;
  const drum=roller(k.visual,.051,width,dark,x,y);
  const hood=new THREE.Group();hood.name='cad-hood-pivot';hood.position.set(x,y,0);k.visual.add(hood);
  hoodShell(hood,.062,width+.015,silver);
  const feeds=[.35,.46,.57].map(h=>roller(k.visual,.025,width,dark,.235,h));
  // Supplemental telescoping supports keep the exported pickup carriage connected
  // to the frame throughout the approximated horizontal deployment.
  const rails=[-.365,.365].map(z=>{const rail=box(k.visual,1,.018,.018,silver,-.147,.195,z);rail.scale.x=.025;return rail;});
  for(const z of [-.335,.335]) {
    bar(k.visual,[x,.23,z],[x,y+.06,z],.022,silver);
  }
  let deploy=0,angle=0;
  return {replaces,lightAt:[x,y+.1,.32],intakeAnchor:tip,
    flow:{intake:()=>[point(k,tip,0,.075),new THREE.Vector3(-.30,.22,0),new THREE.Vector3(-.24,.30,0)],stow:pile.stow,
      feed:(shot=0)=>{const z=((shot%4)-1.5)*.14;return [new THREE.Vector3(-.15,.32,z),
        ...feeds.map(r=>point(k,r,-.035,.055,z)),point(k,drum,-.035,.08,z)];}},
    update(s){db.update(s);deploy=ease(deploy,s.enabled||s.fill>.5?1:0,s.dt);pile.update(s.fill,deploy);
      if(!isAnimated())return;
      intake.position.x=-.36*deploy;
      for(const rail of rails){rail.scale.x=.025+.36*deploy;rail.position.x=-.147-.18*deploy;}
      angle=scoringEase(angle,s.aiming||s.firing>0 ? (s.hood-.9)*.8 : -.2,s.dt);hood.rotation.z=angle;
      drum.rotation.z+=(s.enabled&&(s.aiming||s.firing>0)?45:0)*s.dt;
      for(const r of feeds)r.rotation.z+=(s.enabled&&(s.intaking||s.firing>0)?32:0)*s.dt;
    }};
}

/** Complete supplied wide-drum robot with a clear, horizontally extending hopper. */
export function build9470Cad(root:THREE.Group,k:ModelKit,isAnimated:()=>boolean):RobotModel {
  const p=articulation(root),wheel=p('flywheel',[.24765,.492823,0]),hood=p('hood',[.24765,.492823,0]);
  const intake=p('intake',[0,0,0]),extension=root.getObjectByName('hopper-slide')!;
  const roof=root.getObjectByName('hopper-roof')!,slideRoof=root.getObjectByName('hopper-roof-slide')!;
  // The supplied export is deployed. Keep its actual intake and sliding walls together.
  // Robot renders the flexible net in place of the CAD's flat ceiling sheets.
  roof.visible=slideRoof.visible=!k.config.hopperExpansion;
  for(const panel of [root.getObjectByName('hopper-walls')!,extension,roof,slideRoof])panel.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    o.castShadow=false;
    for(const material of (Array.isArray(o.material)?o.material:[o.material]))material.depthWrite=false;
  });
  extension.userData.fuelStructure=true;
  const tip=new THREE.Object3D();tip.position.set(-.61,.10,0);intake.add(tip);
  const pile=fuel(k,-.628,.014,.205,.545,.64,-.408);
  let deploy=0,angle=0;
  return {replaces,lightAt:[0,.56,.28],intakeAnchor:tip,
    flow:{intake:()=>[point(k,tip),new THREE.Vector3(-.28,.24,0)],stow:pile.stow,feed:(shot=0)=>{
      const z=((shot%4)-1.5)*.14;return [new THREE.Vector3(-.2,.24,z),new THREE.Vector3(.07,.33,z),point(k,wheel,-.05,0,z),point(k,wheel,.025,.07,z)];}},
    update(s){deploy=ease(deploy,s.enabled?1:0,s.dt);pile.update(s.fill,deploy);
      if(!isAnimated())return; intake.position.x=(1-deploy)*.22;
      extension.position.x=slideRoof.position.x=intake.position.x;
      angle=scoringEase(angle,s.aiming?THREE.MathUtils.clamp(s.hood,.5,1.25)-1.43:0,s.dt);hood.rotation.z=angle;
      wheel.rotation.z+=(s.enabled&&s.aiming?45:0)*s.dt;
    }};
}

/** Valor supplied drum variant: CAD intake and walls slide together, no invented turret. */
export function build6800Cad(root:THREE.Group,k:ModelKit,isAnimated:()=>boolean):RobotModel {
  // Concentric CAD hood faces fit this center within 0.01 mm.
  const p=articulation(root),wheel=p('flywheel',[.26035,.474486,0]),hood=p('hood',[.26035,.474486,0]);
  const intake=p('intake',[0,0,0]),slide=root.getObjectByName('hopper-slide');
  const tip=new THREE.Object3D();tip.position.set(-.592211,.218235,0);intake.add(tip);
  // Fabric roof is absent from the CAD; the gallery photo shows a black net.
  const roof=new THREE.Group();roof.name='cad-6800-hopper-net';root.add(roof);
  // With a stretching net configured, Robot draws that net over the load instead of this flat one.
  roof.visible=!k.config.hopperExpansion;
  const pts:number[]=[];
  for(let i=0;i<=24;i++){const t=i/24;pts.push(t,.514,-.31,t,.514,.31,0,.514,(t-.5)*.62,1,.514,(t-.5)*.62);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  roof.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x181b20,transparent:true,opacity:.8})));
  roof.position.x=-.63;roof.scale.x=.655;
  const pile=fuel(k,-.615,.025,.14,.515,.65,-.4095);
  let deploy=1,angle=0;
  return {replaces,lightAt:[0,.55,.3],intakeAnchor:tip,
    flow:{intake:()=>[point(k,tip,-.02,-.06),new THREE.Vector3(-.35,.25,0)],stow:pile.stow,feed:(shot=0)=>{
      const z=((shot%4)-1.5)*.14;return [new THREE.Vector3(-.3,.24,z),new THREE.Vector3(.05,.3,z),point(k,wheel,-.055,.015,z),point(k,wheel,.03,.06,z)];}},
    update(s){deploy=ease(deploy,s.enabled||s.fill>.5?1:0,s.dt);pile.update(s.fill,deploy);if(!isAnimated())return;
      // Source is extended. 7.5 in travel matches the binder's 13.5 → 21 in hopper.
      intake.position.x=(1-deploy)*.1905;if(slide)slide.position.x=intake.position.x;
      roof.position.x=-.63+intake.position.x;roof.scale.x=.025-roof.position.x;
      // Park the hood forward/down during travel, rather than retaining the raised export.
      const target=s.aiming||s.firing>0 ? THREE.MathUtils.clamp(s.hood,.5,1.25) : 1.5;
      angle=scoringEase(angle,target-.925,s.dt);hood.rotation.z=angle;
      wheel.rotation.z+=(s.enabled&&s.aiming?45:0)*s.dt;
    }};
}

/** Championship twin turrets, source right head exported 60 degrees around its ring. */
export function build971Cad(root:THREE.Group,k:ModelKit,isAnimated:()=>boolean):RobotModel {
  const p=articulation(root);
  const heads=[p('turret-left',[.147955,.32855,-.20955]),p('turret-right',[.147955,.32855,.20955])];
  const wheels=[p('flywheel-left',[.205334,.477139,-.209588]),p('flywheel-right',[.175834,.477139,.1594],Math.PI/3)];
  const hoods=[p('hood-left',[.205334,.477139,-.209588]),p('hood-right',[.175834,.477139,.1594],Math.PI/3)];
  heads.forEach((head,i)=>{head.attach(wheels[i]);head.attach(hoods[i]);});
  const intake=p('intake',[-.28445,.175757,0]);
  const tip=new THREE.Object3D();tip.position.set(-.55,.16535,0);root.add(tip);intake.attach(tip);
  // Keep fuel behind the turret inlets and above the sloping imported roller floor.
  const pile=fuel(k,-.56,.10,.17,.545,.70,-.36,(x,z)=>x<-.04||Math.abs(z)<.105);
  let deploy=1;const angles=[0,0];
  return {replaces,lightAt:[0,.6,.32],intakeAnchor:tip,
    flow:{intake:()=>[point(k,tip),new THREE.Vector3(-.28,.28,0)],stow:pile.stow,feed:(shot=0)=>{
      const head=wheels[shot%2];return [new THREE.Vector3(-.2,.3,0),point(k,head,-.08,-.12),point(k,head,-.035,0),point(k,head,.035,.05)];}},
    update(s){deploy=ease(deploy,s.enabled||s.fill>.5?1:0,s.dt);pile.update(s.fill,deploy);if(!isAnimated())return;
      intake.rotation.z=-(1-deploy)*2.0;
      heads.forEach((head,i)=>{
        head.rotation.y=k.turret.rotation.y-(i===1?Math.PI/3:0);
        // Same hood CAD part: right export is pitched 0.647268 rad below the left.
        const shot = s.aiming || s.firing > 0;
        // Left export is already compact. Park both hoods there during travel;
        // the right export alone is 0.647268 rad higher and must fold down.
        const target = shot ? THREE.MathUtils.clamp(s.hood,.5,1.25) : 1.28;
        angles[i]=scoringEase(angles[i],target-(i===0?1.28:.632732),s.dt);
        hoods[i].rotation.z=angles[i];wheels[i].rotation.z+=(s.enabled&&s.aiming?50:0)*s.dt;
      });
    }};
}

/** User's Robot 2 assembly: native roller floor, hard roof, pivoting rear intake,
 * fixed wide shooter and overspeed flywheel. Source meters mapped Y/Z/X.
 * Intake hinge and hood bearings are measured; actuator travel is estimated.
 */
export function build2910Cad(root:THREE.Group,k:ModelKit,isAnimated:()=>boolean):RobotModel {
  const p=articulation(root);
  const intake=p('intake',[-.27305,.1698625,0]);
  const hood=p('hood',[.282575,.4699,0]);
  const flywheel=p('flywheel',[.2651125,.3726602,-.3309938]);
  const tip=new THREE.Object3D();tip.position.set(-.610318,.160655,0);
  root.add(tip);root.updateMatrixWorld(true);intake.attach(tip);
  const hopper=root.getObjectByName('hopper');
  // The source exports the clear containment sheets as opaque gray plastic.
  // Give only these panels their own material so shared metal parts stay opaque.
  hopper?.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const clearPanel=(source:THREE.Material)=>{
      const material=source.clone();
      if(material instanceof THREE.MeshStandardMaterial){
        material.color.set(0xdde8f0);
        material.transparent=true;
        material.opacity=.22;
        material.depthWrite=false;
        material.metalness=0;
        material.roughness=.18;
        material.side=THREE.DoubleSide;
        material.flatShading=true;
      }
      return material;
    };
    o.material=Array.isArray(o.material)?o.material.map(clearPanel):clearPanel(o.material);
    o.castShadow=false;
  });
  const pile=fuel(k,-.615,.025,.1905,.5461,.67,-.32);
  let deploy=1,angle=0;
  return {replaces,lightAt:[0,.55,.30],intakeAnchor:tip,
    flow:{intake:()=>[point(k,tip,-.025,-.01),new THREE.Vector3(-.26,.25,0),new THREE.Vector3(-.12,.27,0)],
      stow:pile.stow,feed:(shot=0)=>{const z=((shot%4)-1.5)*.14;
        return [new THREE.Vector3(-.20,.27,z),new THREE.Vector3(.05,.29,z),new THREE.Vector3(.24,.36,z),new THREE.Vector3(.32,.44,z)];}},
    update(s){deploy=ease(deploy,s.enabled?1:0,s.dt);pile.update(s.fill,deploy);
      if(!isAnimated())return;
      // Source pickup is deployed. Fold upward and inward about its real bearing.
      intake.rotation.z=-(1-deploy)*2.65;
      // Fitted horizontal compression; source supplies the extended hopper pose only.
      if(hopper)hopper.position.x=(1-deploy)*.25;
      angle=scoringEase(angle,s.aiming||s.firing>0?THREE.MathUtils.clamp(s.hood,.5,1.25)-1.05:0,s.dt);
      hood.rotation.z=angle;
      flywheel.rotation.z+=(s.enabled&&(s.aiming||s.firing>0)?70:0)*s.dt;
    }};
}
