import * as THREE from 'three';
import { buildSpectreCad } from './spectreCadModel';
import { bar, tubeMat } from './models';
import type { ModelKit, RobotModel } from './models';

// Supplied 2025 assemblies. Shaft centers are measured from CAD, in meters.
// Single exported poses do not specify actuator travel; travel and wrist aiming
// are fitted to the existing simulator placement targets.
const forward = new THREE.Vector3(1,0,0), axis = new THREE.Vector3(0,0,1);
const ease = (a:number,b:number,dt:number) => dt > 0 ? a+(b-a)*(1-Math.exp(-9*dt)) : b;
const replaces: RobotModel['replaces'] = ['chassis','mast','hopper','intakeRollers','climber','funnel'];
function pivot(root:THREE.Group,name:string,at:[number,number,number]) {
  const part=root.getObjectByName(name), g=new THREE.Group();g.name=`cad-${name}-pivot`;g.position.fromArray(at);root.add(g);
  root.updateMatrixWorld(true);if(part)g.attach(part);return g;
}
function anchor(root:THREE.Group,parent:THREE.Object3D,at:[number,number,number]) {
  const a=new THREE.Object3D();a.position.fromArray(at);root.add(a);root.updateMatrixWorld(true);parent.attach(a);return a;
}
function point(k:ModelKit,o:THREE.Object3D) {k.visual.updateMatrixWorld(true);return k.visual.worldToLocal(o.getWorldPosition(new THREE.Vector3()));}

type Fit = { shoulder:[number,number,number]; wrist:[number,number,number]; grip:[number,number,number];
  intake:[number,number,number]; tip:[number,number,number]; stageRaised:number; stageTop:number; climb:[number,number,number] };
const fits:Record<string,Fit> = {
  'whisper-1690': {shoulder:[-.2147,.8365,0],wrist:[0,.46,0],grip:[0,.25,0],intake:[0,.285,.3859],tip:[0,.10,.67],stageRaised:0,stageTop:1.065,climb:[.26,.28,0]},
  'quixilver-604-2025': {shoulder:[.1016,1.208,0],wrist:[.62,1.08,0],grip:[.71,1.12,0],intake:[-.30,.70,0],tip:[-.3,.75,0],stageRaised:.4,stageTop:1.035,climb:[-.3429,.46355,0]},
  'subzero-1778': {shoulder:[-.0635,.2667,.006],wrist:[-.0635,.68,.006],grip:[-.24,.756,.006],intake:[-.27,.17,0],tip:[-.58,.07,0],stageRaised:0,stageTop:1.035,climb:[.28,.25,.22]},
  'firefly-118': {shoulder:[.0127,1.02235,0],wrist:[.283,1.164,0],grip:[.40,1.24,0],intake:[-.29,.22,0],tip:[-.58,.08,0],stageRaised:0,stageTop:1.04,climb:[.27,.205,0]},
  'sublime-1678': {shoulder:[.1778,.52025,.1524],wrist:[.1778,.52025,-.127],grip:[.16,.82,-.06],intake:[-.28,.18,0],tip:[-.55,.09,0],stageRaised:0,stageTop:1.03,climb:[.03,.32,-.305]},
  'zuma-581': {shoulder:[.1651,1.85,0],wrist:[-.1379,1.3651,-.3895],grip:[-.165,1.335,-.45],intake:[-.27,.18,0],tip:[-.58,.08,0],stageRaised:.7874,stageTop:1.05,climb:[0,.444,.343]},
};

export function buildReefscapeCad(id:string,root:THREE.Group,k:ModelKit,animated:()=>boolean):RobotModel {
  if(id==='spectre-2910')return buildSpectreCad(root,k,animated);
  if(id==='wildstang-111')return wildstang(root,k,animated);
  if(id==='zuma-581'||id==='subzero-1778')return sideScorer(id,root,k,animated);
  const f=fits[id], carriage=pivot(root,'carriage',[0,0,0]), stage=root.getObjectByName('elevator-stage');
  const arm=pivot(root,'arm',f.shoulder), wrist=pivot(root,'effector',f.wrist);
  root.updateMatrixWorld(true);arm.attach(wrist);carriage.attach(arm);
  // The post-season export omits its carbon arm reference. A measured
  // connecting tube preserves the load path; its cross-section is an estimate.
  if(id==='whisper-1690'){const connector=new THREE.Group();root.add(connector);bar(connector,f.shoulder,f.wrist,.035,tubeMat(0x242628));root.updateMatrixWorld(true);arm.attach(connector);}
  const held=anchor(root,wrist,f.grip);
  const algaeGrip:[number,number,number]=id==='whisper-1690'?[0,.205,0]:id==='firefly-118'?[.18,1.34,0]:id==='sublime-1678'?[.12,.63,-.22]:[.72,1.13,0];
  const algaeHeld=anchor(root,wrist,algaeGrip);
  const intake=pivot(root,'intake',f.intake), tip=anchor(root,intake,f.tip);
  const climb=pivot(root,'climber',f.climb);
  const latch=root.getObjectByName('climber-latch');if(latch){root.updateMatrixWorld(true);climb.attach(latch);}
  const grip=k.config.climber.gripOffset;const climbHeld=anchor(root,climb,[grip?.[0]??f.climb[0],id==='firefly-118'?.31:f.climb[1]+.1,grip?.[1]??f.climb[2]]);
  const sourceVector=new THREE.Vector3().fromArray(f.wrist).sub(new THREE.Vector3().fromArray(f.shoulder));
  const length=sourceVector.length(), neutral=new THREE.Quaternion().setFromUnitVectors(sourceVector.normalize(),forward);
  // Keep the mouth in the same orientation as the imported arm's neutral pose.
  const q=new THREE.Quaternion();let yc=.38,phi=1.2,deploy=0,climbAngle=0;
  return {replaces:root.getObjectByName('climber')?replaces:replaces.filter(p=>p!=='climber'),climbAnchor:climbHeld,heldAnchor:held,coralAxis:id==='whisper-1690'?[0,1,0]:id==='quixilver-604-2025'?[0,0,1]:[1,0,0],algaeAnchor:algaeHeld,algaeGripScale:id==='zuma-581'?[.76,.94,.76]:[.78,.96,.76],intakeAnchor:tip,lightAt:[f.shoulder[0],f.stageTop,.15],
    flow:{handoff:()=>[point(k,tip),new THREE.Vector3(-.28,.25,0),point(k,held)]},
    update(s){if(!animated())return;
      const p=s.place??{height:.45,forward:.3,level:1}, parked=p.height<=.46&&!p.handoff;
      let targetY:number,targetPhi:number;
      if(p.handoff){targetY=.31+length;targetPhi=-Math.PI/2;}
      else if(parked){targetY=id==='quixilver-604-2025'?.808:.38;targetPhi=1.22;}
      else {
        const reach=THREE.MathUtils.clamp(p.forward-f.shoulder[0],.02,length);
        targetY=THREE.MathUtils.clamp(p.height+(id==='whisper-1690'?.21:0)-Math.sqrt(Math.max(0,length*length-reach*reach)),.32,2.2);
        targetPhi=Math.atan2(p.height+(id==='whisper-1690'?.21:0)-targetY,id==='whisper-1690'&&p.side===-1?-reach:reach);
      }
      yc=ease(yc,targetY,s.dt);phi=ease(phi,targetPhi,s.dt);
      carriage.position.y=yc-f.shoulder[1];
      if(stage)stage.position.y=id==='quixilver-604-2025'?carriage.position.y:Math.max(0,yc-(f.stageTop-.13))-f.stageRaised;
      arm.quaternion.copy(q.setFromAxisAngle(axis,phi)).multiply(neutral);
      const toolAngle=parked||p.handoff?0:p.level===4?-1.1:p.level===1?0:-.5;
      wrist.quaternion.copy(arm.quaternion).invert().multiply(q.setFromAxisAngle(axis,toolAngle));
      if(id!=='whisper-1690')wrist.quaternion.multiply(neutral);
      deploy=ease(deploy,s.intaking||p.handoff?1:0,s.dt);
      // Exports contain deployed intake geometry. Fold it up around the main shaft.
      if(id==='whisper-1690')intake.rotation.x=-(1-deploy)*1.2;else intake.rotation.z=-(1-deploy)*1.2;
      const fold=id==='firefly-118'?Math.PI/2:id==='sublime-1678'?Math.PI/2:-1.1;
      climbAngle=ease(climbAngle,fold*(1-s.climb),s.dt);climb.rotation[id==='firefly-118'?'z':'x']=climbAngle;
    }};
}

function wildstang(root:THREE.Group,k:ModelKit,animated:()=>boolean):RobotModel {
  const shaft:[number,number,number]=[-.088,.645463,0];
  const carriage=pivot(root,'carriage',[0,0,0]),arm=pivot(root,'arm',shaft);
  const coral=pivot(root,'coral-head',[-.005,.431,.20]),algae=pivot(root,'algae-head',[.085,.91,-.32]);
  root.updateMatrixWorld(true);arm.attach(coral);arm.attach(algae);carriage.attach(arm);
  const held=anchor(root,coral,[-.005,.431,.20]),algaeHeld=anchor(root,algae,[.085,.91,-.32]);
  const intake=pivot(root,'intake',[.0603,.2556,.33435]),tip=anchor(root,intake,[.0603,.096,.735]);
  const stage=root.getObjectByName('elevator-stage'),climb=pivot(root,'climber',[.28,.45,0]);
  const climbHeld=anchor(root,climb,[.72,.53,.05]);
  const coralVector=held.position.clone();coral.getWorldPosition(coralVector).sub(new THREE.Vector3().fromArray(shaft));
  const algaeVector=new THREE.Vector3().fromArray([.085,.91,-.32]).sub(new THREE.Vector3().fromArray(shaft));
  let yc=.76,angle=0,deploy=0;
  return {replaces,climbAnchor:climbHeld,heldAnchor:held,coralAxis:[1,0,0],algaeAnchor:algaeHeld,algaeGripScale:[.70,1.04,1.07],intakeAnchor:tip,flow:{handoff:()=>[point(k,tip),new THREE.Vector3(0,.27,.26),point(k,held)]},lightAt:[-.20,1.07,0],
    update(s){if(!animated())return;deploy=ease(deploy,s.intaking||s.place?.handoff?1:0,s.dt);intake.rotation.x=-(1-deploy)*1.3;
      const p=s.place??{height:.45,forward:.3,level:1},v=p.algae?algaeVector:coralVector;
      const length=Math.hypot(v.y,v.z),reach=Math.min(length,p.forward),side=p.side===-1?1:-1;
      const targetAngle=p.height<=.46 ? -.15 : Math.atan2(Math.sqrt(Math.max(0,length*length-reach*reach)),side*reach)-Math.atan2(v.y,v.z);
      const targetY=p.height<=.46 ? .76 : p.height-Math.sqrt(Math.max(0,length*length-reach*reach));
      yc=ease(yc,Math.max(.42,targetY),s.dt);angle=ease(angle,targetAngle,s.dt);
      carriage.position.y=yc-shaft[1];arm.rotation.x=-angle;
      if(stage)stage.position.y=Math.max(0,yc-.92);
      climb.rotation.z=ease(climb.rotation.z,1.5*(1-s.climb),s.dt);
    }};
}

/** Zuma's shoulder rotates about the carriage face normal (+X), not a
 * front-facing pitch axis. Keep the source arm and claw roll connected. */
function sideScorer(id:string,root:THREE.Group,k:ModelKit,animated:()=>boolean):RobotModel {
  const zuma=id==='zuma-581';
  const shaft:[number,number,number]=zuma?[.175,1.828,.00035]:[.02,.306,-.042],end:[number,number,number]=zuma?[-.1379,1.3651,-.3895]:[-.0635,.68,.006];
  const hasClimber=!!root.getObjectByName('climber');
  const carriage=pivot(root,'carriage',[0,0,0]),arm=pivot(root,'arm',shaft),head=pivot(root,'effector',end);
  root.updateMatrixWorld(true);arm.attach(head);carriage.attach(arm);
  const held=anchor(root,head,zuma?[-.165,1.335,-.45]:[-.24,.756,.006]),algae=anchor(root,head,zuma?[-.15,1.245,-.49]:[-.43,.76,.01]);
  const radial=new THREE.Vector3(0,end[1]-shaft[1],end[2]-shaft[2]);
  algae.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),radial.clone().normalize());
  const intake=pivot(root,'intake',[-.27,.18,0]),tip=anchor(root,intake,[-.58,.08,0]);
  const climb=pivot(root,'climber',[0,.444,.343]),stage=root.getObjectByName('elevator-stage');
  const climbHeld=anchor(root,climb,[0,.54,.49]);
  const r=radial.length(),bindAngle=Math.atan2(radial.y,radial.z);
  // Zuma's tube crosses its rigid arm in the source Y/Z plane, not along
  // the wheel shafts or the uncorrected source Z axis.
  const coralAxis:[number,number,number]=zuma?[0,-radial.z/r,radial.y/r]:[0,0,1];
  let yc=.42,phi=Math.PI/2,deploy=0;
  return {replaces:hasClimber?replaces:replaces.filter(p=>p!=='climber'),climbAnchor:hasClimber?climbHeld:undefined,heldAnchor:held,coralAxis,algaeAnchor:algae,algaeGripScale:zuma?[1,1,.96]:[.78,.94,.72],algaeGripThroat:zuma,intakeAnchor:tip,lightAt:[.17,1.07,.15],
    flow:{handoff:()=>[point(k,tip),new THREE.Vector3(-.27,.25,0),point(k,held)]},
    update(s){if(!animated())return;const p=s.place??{height:.45,forward:.3,level:1},parked=p.height<=.46&&!p.handoff;
      let y=.42,angle=Math.PI/2;
      if(p.handoff){y=.32+r;angle=-Math.PI/2;}
      else if(!parked){const reach=Math.min(r,Math.max(.02,p.forward)),rise=Math.sqrt(Math.max(0,r*r-reach*reach));y=Math.max(.32,p.height-rise);angle=Math.atan2(rise,(p.side===-1?1:-1)*reach);}
      yc=ease(yc,y,s.dt);phi=ease(phi,angle,s.dt);carriage.position.y=yc-shaft[1];
      if(stage)stage.position.y=zuma?Math.max(0,yc-.92)-.7874:Math.max(0,yc-shaft[1])*.5;
      arm.rotation.x=bindAngle-phi;
      // The head is rigidly mounted: preserve its CAD transform relative
      // to the arm. CORAL follows that same rotation through its local axis.
      deploy=ease(deploy,s.intaking||p.handoff?1:0,s.dt);intake.rotation.z=-(1-deploy)*1.2;
      climb.rotation.x=ease(climb.rotation.x,-1.1*(1-s.climb),s.dt);
    }};
}
