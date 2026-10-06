import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';

// 2910 Spectre: supplied 2025 CAD, TBA pit/match photos, team reveal and
// FRCTeam2910/2025CompetitionRobot-Public ArmPoseConstants. Low silver/black
// chassis, brass forward ballast, A-frame dead axle, two cascade stages, real
// powered wrist, shared coral/algae claw, sliding cage intake on fixed stage.
// Source -Y becomes forward, Z becomes up. Joints measured in meters; motion
// solves simulator targets, with the team's 110° -> -5° climb shoulder poses.
const shaft = new THREE.Vector3(-.26035,.32385,0);
const joint = new THREE.Vector3(.47110156,1.79530156,0);
const sourcePitch = 68*Math.PI/180;
const rail = new THREE.Vector3(Math.cos(sourcePitch),Math.sin(sourcePitch),0);
const normal = new THREE.Vector3(-rail.y,rail.x,0);
const sourceReach = joint.clone().sub(shaft).dot(rail);
const crossOffset = joint.clone().sub(shaft).dot(normal);
const sourceExtension = 1.0287; // 40.5 in; CAD shows the fully extended nested stages.
const baseReach = sourceReach-sourceExtension;
const sourceToolPitch = 23*Math.PI/180; // measured roller-row centers in export.
const rotationAxis = new THREE.Vector3(0,0,1);
const ease=(a:number,b:number,dt:number)=>dt>0?a+(b-a)*(1-Math.exp(-10*dt)):b;

export function buildSpectreCad(root:THREE.Group,k:ModelKit,animated:()=>boolean):RobotModel {
  function mount(name:string,at:THREE.Vector3){
    const part=root.getObjectByName(name)!;const g=new THREE.Group();g.name=`cad-${name}-pivot`;g.position.copy(at);root.add(g);
    root.updateMatrixWorld(true);g.attach(part);return g;
  }
  function anchor(parent:THREE.Object3D,at:THREE.Vector3){const a=new THREE.Object3D();a.position.copy(at);root.add(a);root.updateMatrixWorld(true);parent.attach(a);return a;}
  const arm=mount('arm',shaft),mid=mount('elevator-stage',shaft),inner=mount('carriage',shaft),head=mount('effector',joint);
  const climber=mount('climber',shaft);
  root.updateMatrixWorld(true);arm.attach(mid);mid.attach(inner);inner.attach(head);arm.attach(climber);
  const midBind=mid.position.clone(),innerBind=inner.position.clone(),climbBind=climber.position.clone();
  const held=anchor(head,new THREE.Vector3(.535,1.976,0));
  const algae=anchor(head,new THREE.Vector3(.54,2.165,0));
  const cage=anchor(climber,new THREE.Vector3(-.29,.514,0));
  const gripOffset=held.position.clone();
  const coralAxis:[number,number,number]=[0,0,1];
  let pitch=.15,extension=0,toolPitch=125*Math.PI/180,slide=0;
  return {
    replaces:['chassis','mast','hopper','intakeRollers','climber','funnel'],
    heldAnchor:held,coralAxis,handoffStyle:'direct',algaeAnchor:algae,algaeGripScale:[.90,.82,.96],
    intakeAnchor:held,climbAnchor:cage,lightAt:[-.26,.32,.12],
    flow:{handoff:()=>[]},
    update(s){
      if(!animated())return;
      const p=s.place??{height:.45,forward:.3,level:1};
      const lengthwise=p.level!==1 || !!p.handoff || s.intaking;
      coralAxis[0]=lengthwise?Math.cos(sourceToolPitch):0;
      coralAxis[1]=lengthwise?Math.sin(sourceToolPitch):0;
      coralAxis[2]=lengthwise?0:1;
      const climbing=s.climb>.01;
      const collecting=!!p.handoff || s.intaking&&p.height<=.46;
      const parked=!collecting&&p.height<=.46&&!p.algae;
      let nextPitch=.0,nextExtension=0,nextTool=125*Math.PI/180,nextSlide=0;
      if(climbing){
        const pull=THREE.MathUtils.clamp((1-s.climb)/.75,0,1);
        nextPitch=THREE.MathUtils.lerp(110,-5,pull)*Math.PI/180;
        nextTool=THREE.MathUtils.lerp(35,10,pull)*Math.PI/180;
        nextSlide=.1905*(1-pull);nextExtension=.08255*pull;
      }else if(!parked){
        nextTool=collecting?(p.algae?Math.PI-.92:Math.PI-.035):p.algae?(p.height>1.7?1.0:0):p.level===4?-.65:p.level===1?0:-.35;
        const targetX=(p.side===2?-1:1)*(collecting?k.fp.length/2+k.config.intake.reach*.6:p.forward);
        const targetY=collecting?(p.algae?.23:.11):p.height;
        const offset=(p.algae?algae.position:gripOffset).clone().applyAxisAngle(rotationAxis,nextTool-sourceToolPitch);
        const dx=targetX-offset.x-shaft.x,dy=targetY-offset.y-shaft.y;
        const reach=Math.sqrt(Math.max(baseReach*baseReach,dx*dx+dy*dy-crossOffset*crossOffset));
        nextPitch=Math.atan2(dy,dx)-Math.atan2(crossOffset,reach);
        nextExtension=THREE.MathUtils.clamp(reach-baseReach,0,1.05);
      }
      pitch=ease(pitch,nextPitch,s.dt);extension=ease(extension,nextExtension,s.dt);
      toolPitch=ease(toolPitch,nextTool,s.dt);slide=ease(slide,nextSlide,s.dt);
      arm.rotation.z=pitch-sourcePitch;
      const shift=(extension-sourceExtension)/2;
      mid.position.copy(midBind).addScaledVector(rail,shift);
      inner.position.copy(innerBind).addScaledVector(rail,shift);
      head.rotation.z=toolPitch-sourceToolPitch-arm.rotation.z;
      climber.position.copy(climbBind).addScaledVector(rail,slide);
    },
  };
}
