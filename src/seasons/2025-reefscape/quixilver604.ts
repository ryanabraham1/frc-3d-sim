import type { TeamRobot } from '@engine/core/season';
import { bar, drivebase, mat, pivot, registerRobotModel, sidePlates, spin, wheelShaft } from '@engine/robot/models';
import { build, normalizeReefscapeConfig } from './config';
import { place, reachWith, stowed } from './additionalTeamRobots';

// Supplied 2025 FRC604 Robot.glb: large station funnel, elevator, arm and claw;
// no CORAL floor intake; the station funnel includes a small climber.
registerRobotModel('quixilver-604-2025',k=>{
  const silver=mat(0xc3c8ce,{metal:.7}),black=mat(0x17191b),db=drivebase(k);
  for(const z of [-.28,.28])bar(k.visual,[.10,.18,z],[.10,1.03,z],.04,silver);
  const carriage=pivot(k.visual,.1,.4),arm=pivot(carriage,0,0),head=pivot(arm,.6,0);
  for(const z of [-.19,.19])bar(arm,[0,0,z],[.6,0,z],.025,silver);
  sidePlates(head,[[-.08,-.08],[.15,-.08],[.15,.1],[-.08,.1]],.17,black);
  const rollers=wheelShaft(head,.1,0,{n:2,r:.04,w:.03,span:.28,colors:[0x27292b]});
  const held=pivot(head,.08,0),algae=pivot(head,.22,.03);
  return {replaces:['chassis','mast','hopper','intakeRollers','funnel'],heldAnchor:held,coralAxis:[1,0,0],handoffStyle:'direct',algaeAnchor:algae,algaeGripScale:[.84,1,.84],intakeAnchor:held,update(s){
    const p=place(s),goal=stowed(p)?{yc:.4,phi:1.2}:reachWith(p,1,.1,.6,.3,1.8);
    carriage.position.y=goal.yc;arm.rotation.z=goal.phi;head.rotation.z=-goal.phi;spin(rollers,s.enabled&&s.intaking?20:0,s.dt);db.update(s);
  }};
});
export function quixilver604():TeamRobot {
  const c=build({coral:'l4',intake:'funnel',algae:'reef',algaeScore:'both',climb:2,align:true,speed:4.7});
  c.model='quixilver-604-2025';c.teamNumber=604;c.frameLength=c.frameWidth=.7366;c.height=1.035;
  c.options={...c.options,dualPieceStorage:false,coralBuffer:false};
  return {id:c.model,team:604,name:'Quixilver',description:'604 Quixilver. Supplied CAD station funnel, elevator, arm and CORAL/ALGAE claw. No ground intake; integrated funnel climber. Actuator travel and performance are simulator estimates.',source:'User supplied 2025 FRC604 Robot.glb',config:normalizeReefscapeConfig(c)};
}
