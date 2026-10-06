import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, decal, deployableIntake, drivebase, flowAt, intakeDeployTarget, mat, pivot, registerRobotModel, sidePlates, spin, tubeMat, wheelShaft } from '@engine/robot/models';
import { inch } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';
import { place, stowed } from './additionalTeamRobots';

// Team reveal portrait + published SuperstructurePosition/CoralPath code. Opposite,
// independently driven CORAL and ALGAE heads on one rotating elevator arm.
// Geometry, drive speed and actuator timings are gameplay-scale estimates.
registerRobotModel('wildstang-111', k => {
  const c = k.config, H = c.height, bt = c.bumperTop, ex = -.12;
  const silver = tubeMat(0xbcc5cd), black = mat(0x191b20);
  const db = drivebase(k, { tube: silver, motorRing: 0x6dc338 });
  const floorVisual=new THREE.Group();k.visual.add(floorVisual);
  const floor = deployableIntake({...k,visual:floorVisual},{reach:c.intake.reach,rollers:2,frame:black,rollerMaterial:mat(0x6dc338)});
  floorVisual.rotation.y=Math.PI/2;let deploy=0;
  for (const z of [-.14, .14]) {
    bar(k.visual, [ex, bt, z], [ex, H, z], .035, silver);
    bar(k.visual, [ex-.08, bt, z], [ex-.08, H, z], .026, silver);
    for (let y=bt+.12; y<H-.1; y+=.14) {
      bar(k.visual, [ex, y, z], [ex-.08, y+.14, z], .012, silver);
    }
  }
  bar(k.visual, [ex,H,-.14], [ex,H,.14], .03, silver);
  box(k.visual,.008,H-bt-.1,.23,black,ex-.095,(H+bt)/2,0);
  decal(k.visual,'WILDSTANG',{w:.23,h:.07,color:'#ffffff',background:'#ae2527',x:ex-.102,y:H-.18,z:0,rotY:-Math.PI/2});
  const stage = new THREE.Group(); stage.name='wildstang-moving-stage'; k.visual.add(stage);
  for (const z of [-.1,.1]) bar(stage,[ex+.05,bt+.08,z],[ex+.05,H-.04,z],.028,silver);
  const middleStage=stage.clone(); middleStage.name='wildstang-middle-stage'; k.visual.add(middleStage);
  const carriage = pivot(stage,0,0);
  box(carriage,.05,.18,.25,black,ex+.07,0,0);
  // The axle runs fore/aft: the arm swings across the robot's sides,
  // in front of the elevator rails rather than through their plane.
  const px = ex+.27, arm = pivot(carriage,px,0); arm.name='wildstang-shared-arm';
  bar(carriage,[ex+.07,0,0],[px,0,0],.04,silver);
  const armGeometry = new THREE.Group(); armGeometry.rotation.y=Math.PI/2; arm.add(armGeometry);
  for (const z of [-.07,.07]) {
    bar(armGeometry,[-.46,0,z],[.66,0,z],.025,silver);
    bar(armGeometry,[-.46,0,z],[0,.09,z],.02,silver);
    bar(armGeometry,[0,.09,z],[.66,0,z],.02,silver);
  }
  const coralHead = pivot(armGeometry,.66,0), algaeHead = pivot(armGeometry,-.46,0);
  sidePlates(coralHead,[[-.08,-.08],[.14,-.08],[.14,.09],[-.08,.09]],.11,black);
  const coralRollers=[wheelShaft(coralHead,0,.065,{n:3,r:.035,w:.04,span:.18,colors:[0x6dc338]}),wheelShaft(coralHead,0,-.065,{n:3,r:.035,w:.04,span:.18,colors:[0x6dc338]})];
  const algaeRollers: THREE.Group[]=[];
  for (const x of [-.205,.205]) {
    bar(algaeHead,[0,0,-.16],[x,0,-.16],.022,silver);
    bar(algaeHead,[0,0,.16],[x,0,.16],.022,silver);
    algaeRollers.push(wheelShaft(algaeHead,x,0,{n:2,r:.06,w:.04,span:.3,colors:[0x6dc338]}));
  }
  const held=pivot(coralHead,0,0), algaeHeld=pivot(algaeHead,0,0);
  const climb=pivot(k.visual,c.frameLength*.3,bt, .22);
  bar(climb,[0,0,0],[0,.5,0],.04,silver); box(climb,.12,.04,.05,black,-.04,.5,0);
  let yc=bt+.18, phi=1.1;
  return {
    replaces:['chassis','mast','hopper','intakeRollers','climber','funnel'], heldAnchor:held, algaeAnchor:algaeHeld, algaeGripScale:[.70,1.04,1.07], intakeAnchor:floor.tip,
    flow:{handoff:()=>[flowAt(k,floor.tip),new THREE.Vector3(-.20,bt+.12,0),flowAt(k,held)]},
    update(s) {
      deploy=approach(deploy,intakeDeployTarget(s),7,s.dt);floor.update(s,deploy);
      const p=place(s), algae=!!p.algae, length=algae?.46:.66;
      const reach=Math.min(length,Math.max(0,p.forward)), side=p.side===-1?-1:1;
      let height=p.height, angle=0;
      if (p.handoff) { height=bt+.12; angle=-1.2; }
      else if (stowed(p)) { height=bt+.52; angle=s.intaking?Math.PI-1.1:1.1; } // lower ALGAE holder clears the carpet
      else {
        height=Math.max(bt+.12,p.height-Math.sqrt(Math.max(0,length*length-reach*reach)));
        angle=Math.atan2(p.height-height,side*reach)+(algae?Math.PI:0);
      }
      yc=approach(yc,height,10,s.dt); phi=approach(phi,angle,9,s.dt);
      const ext=Math.max(0,yc-(H-.16)); middleStage.position.y=ext*.5; stage.position.y=ext; carriage.position.y=yc-ext;
      arm.rotation.x=phi;
      for (const r of coralRollers) spin(r,s.intaking?20:s.firing>0?-25:0,s.dt);
      for (const r of algaeRollers) spin(r,s.intaking?18:s.passing?-24:0,s.dt);
      climb.rotation.z=approach(climb.rotation.z,(-1.1) * s.climb,5,s.dt); db.update(s);
    },
  };
});

export function wildStang111(): TeamRobot {
  const c=build({coral:'l4',intake:'both',algae:'reef',algaeScore:'both',climb:2,align:true,speed:4.7});
  c.teamNumber=111; c.model='wildstang-111'; c.height=inch(42);
  c.options={...c.options,dualPieceStorage:true};c.intake.groundYaw=-Math.PI/2;
  c.placement!.scoreSide='sides';
  c.placement!.handoffSeconds=.6; c.placement!.liftSpeed=1.8; c.placement!.cycleSeconds=.45; c.climber.secondsToClimb=3;
  return {id:'wildstang-111',team:111,name:'WildStang',description:'111 WildStang. Elevator with a shared rotating arm carrying independent CORAL and ALGAE heads on opposite ends, green rollers, deployable ground intake, station-fed CORAL and a deep climber. Can hold one of each. Dimensions, speeds and timings are simulator estimates.',source:'Supplied 25W - WildStang 2025.glb; team reveal https://www.chiefdelphi.com/t/492790; team code https://github.com/wildstang/2025_111_robot_software',config:normalizeReefscapeConfig(c)};
}
