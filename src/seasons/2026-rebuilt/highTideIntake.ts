import * as THREE from 'three';
import { approach, bar, box, flowAt, mat, roller, spin, type ModelKit, type RobotAnimState } from '@engine/robot/models';
import { belt, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { pocketPlate } from './teamShooterDetail';

/** RIPCURRENT's translating intake carriage and separate bottom bar, fitted to its published intake render. */
export function highTideIntake(k:ModelKit) {
  const c=k.config,side=k.groundSide,width=c.frameWidth*.87;
  const carbon=mat(0x25282b,{metal:.15,rough:.7}),rubber=mat(0x171b1e,{rough:.95}),alloy=mat(0xa5adb2,{metal:.8});
  const root=new THREE.Group();root.name='hightide-intake-carriage';k.visual.add(root);
  const rollers:THREE.Group[]=[];
  const end=c.frameLength/2;
  const points:[number,number][]=[[side*(end+.045),.048],[side*(end-.025),.125],[side*(end-.11),c.bumperTop+.015]];
  for(const [x,y] of points) {
    const drum=roller(root,.028,width,rubber,x,y,0);drum.name='hightide-intake-rubber';rollers.push(drum);
    for(const z of [-width/2,width/2]) {
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(.029,.029,.008,18),alloy);cap.rotation.x=Math.PI/2;cap.position.z=z;drum.add(cap);
    }
  }
  for(const z of [-width/2-.016,width/2+.016]) {
    const outline:[number,number][]=[[side*(end-.20),.018],[side*(end+.085),.018],[side*(end+.085),.12],[side*(end+.02),.17],[side*(end-.16),c.bumperTop+.07],[side*(end-.20),c.bumperTop+.07]];
    pocketPlate(root,outline,[ [[side*(end-.13),.065],[side*(end+.025),.065],[side*(end-.04),.14]] ],carbon,z,.007);
    fasteners(root,points,z+Math.sign(z)*.005);
    for(let i=0;i<points.length-1;i++)belt(root,points[i],points[i+1],z+Math.sign(z)*.012,.018);
    motor(root,points[1][0],points[1][1],z);
    bar(k.visual,[side*(end-.27),c.bumperTop-.035,z],[side*(end+.05),c.bumperTop-.035,z],.018,alloy);
  }
  // A low ramp supports the ball between the lower drum and the powered kicker, instead of an invisible lift.
  const start=new THREE.Vector3(points[0][0],.045,0),finish=new THREE.Vector3(points[2][0],c.bumperTop-.005,0);
  const ramp=box(root,start.distanceTo(finish),.005,width*.96,carbon,(start.x+finish.x)/2,(start.y+finish.y)/2,0);
  ramp.rotation.z=Math.atan2(finish.y-start.y,finish.x-start.x);
  let speed=0;
  return {root, rollers, intake:()=>{
    const z=(Math.random()-.5)*width*.6;
    return rollers.map(drum=>flowAt(k,drum,0,.028+.075,z));
  }, update(s:RobotAnimState,deployed:number) {
    root.position.x=side*deployed*.20;
    // During low-load squeeze the inner kicker still carries FUEL over the bumper into the rotor; braking it while
    // retracting the extension pins the final balls between that drum and the tray end wall.
    const conveying=s.intaking||((s.squeeze??0)>0&&(s.aiming||s.firing>0));
    speed=approach(speed,s.enabled&&conveying?32:0,8,s.dt);
    // Tops of the drums run inward (toward the hopper), as they carry FUEL up the ramp.
    for(const drum of rollers)spin(drum,side*speed,s.dt);
  }};
}
