import { scoringApproach } from '@engine/robot/scoringReadiness';
import * as THREE from 'three';
import { bar, box, drivebase, flowAt, link, mat, plate, pivot, pointIn, roller, sidePlates, spin, tubeMat, underBumperEntry, underBumperIntake, wheelShaft, type ModelKit, type RobotModel } from '@engine/robot/models';
import { motor } from '@engine/robot/mechanicalDetail';

/** Skyfall 2.0: chassis-aimed pivot shooter, one NOTE, rear under-bumper intake.
 * User's six CAD views: red open A-frame, circular pivot gears, broad red shooter tray,
 * tan guide panels, purple wheels and white outer rollers, arm-mounted climbing hooks.
 * TBA 1114/2024 photos: black sponsor skins are omitted to expose the supplied CAD structure.
 * Team CAD release: https://www.chiefdelphi.com/t/475819 (rear AMP feed, arm swings onto chain).
 * Public ArmConstants: intake -45.27°, AMP 23.5°, climb reach 90°, pull -39°.
 * Dimensions and horizontal CAD datum relative to motor encoder are fitted from images [EST].
 * Drive/capacity/rate remain the existing simulator configuration.
 */
export function buildSkyfall1114(k: ModelKit): RobotModel {
  const { frameLength: L, frameWidth: W, bumperTop: bt } = k.config;
  const red = mat(0xdc161e, { metal: .35, rough: .38 }), redTube = tubeMat(0xdc161e);
  const silver = mat(0xbfc3c6, { metal: .7, rough: .35 }), black = mat(0x202125), white = mat(0xe8e9e8);
  const tan = mat(0xc3af7b), base = drivebase(k, { tube: redTube, motorRing: 0xdc161e });
  const intake = underBumperIntake(k, { n: 3 });
  box(k.visual, L*.94, .006, W*.9, red, 0, bt+.008, 0);
  const px = .035, py = bt+.36, z = W*.36;
  const arm = pivot(k.visual, px, py); arm.name = 'skyfall-shooter-arm';
  const half = W*.34, rear = -.26, nose = .29;
  // Open triangular towers and perforated central uprights, with a continuous load path to the chassis.
  for (const sign of [-1, 1]) {
    const zz = sign*z;
    bar(k.visual, [-L*.43,bt,zz], [px,py,zz], .025, redTube);
    bar(k.visual, [L*.4,bt,zz], [px,py,zz], .028, redTube);
    plate(k.visual, [[px-.027,bt],[px+.027,bt],[px+.027,py],[px-.027,py]], .007, red, zz,
      Array.from({length:5},(_,i)=>[px,bt+.045+i*.058,.016] as [number,number,number]));
    plate(k.visual, [[px-.10,py-.13],[px+.10,py-.13],[px+.04,py+.035],[px-.04,py+.035]], .007, red, zz,
      [[px-.047,py-.095,.022],[px+.047,py-.095,.022]]);
    plate(k.visual, [[-L*.43,bt],[-L*.24,bt],[-L*.30,bt+.10]], .007, silver, zz);
    plate(k.visual, [[L*.14,bt],[L*.41,bt],[L*.25,bt+.14]], .007, red, zz, [[L*.28,bt+.048,.025]]);
    // Pivot output gear and bearing flange stay concentric with the moving tray.
    const gear = roller(arm, .113, .009, silver, 0, 0, sign*(z+.013)); gear.name = `skyfall-pivot-gear-${sign}`;
    for (let i=0;i<48;i++) {
      const a=i*Math.PI/24;
      const tooth=box(gear,.008,.008,.012,silver,.113*Math.cos(a),.113*Math.sin(a),0); tooth.rotation.z=a;
    }
    roller(k.visual,.038,.016,black,px,py,zz+sign*.026);
    roller(k.visual,.029,.019,silver,px,py,zz+sign*.032);
    roller(k.visual,.012,.022,red,px,py,zz+sign*.044);
    // Fixed pivot gearbox and the belt run up the rear tower.
    roller(k.visual,.025,.012,silver,L*.26,bt+.09,zz);
    motor(k.visual,L*.24,bt+.10,zz-sign*.06);
    for (const d of [-.012,.012]) bar(k.visual,[L*.26+d,bt+.09,zz],[px+d,py,zz],.005,black);
  }
  for (const x of [-L*.38,L*.32]) bar(k.visual,[x,bt+.025,-z],[x,bt+.025,z],.022,redTube);
  bar(k.visual,[px,py,-z],[px,py,z],.024,redTube);
  // The full-width arm tray extends on both sides of its pivot rather than forming a long narrow boom.
  sidePlates(arm, [[rear,-.035],[nose,-.035],[nose,.035],[rear,.035]], half, red,
    Array.from({length:8},(_,i)=>[rear+.034+i*.064,0,.015] as [number,number,number]));
  for (const x of [rear,nose]) {
    box(arm,.018,.023,half*2,red,x,.045,0);
    sidePlates(arm,[[x-.026,-.045],[x+.026,-.045],[x+.026,.105],[x-.026,.105]],half,red,[[x,.08,.012]]);
  }
  // Red X brace and segmented polycarbonate guide floor leave the interior visible.
  for (const sign of [-1,1]) bar(arm,[rear,.086,sign*half],[nose,.086,-sign*half],.010,red);
  for (let i=0;i<3;i++) box(arm,.14,.004,half*1.8,tan,rear+.075+i*.165,-.036,0);
  const rollers: THREE.Group[] = [];
  // Purple inner rollers and white outer rollers bend the NOTE around the end of the tray.
  for (const [x,y] of [[nose+.006,.01],[nose+.060,-.027],[nose+.10,-.079]] as const) {
    rollers.push(roller(arm,.019,half*1.9,white,x,y));
    rollers.push(wheelShaft(arm,x-.025,y-.023,{n:3,r:.028,w:.025,span:half*1.65,colors:[0x783f92]}));
    for (const sign of [-1,1]) {
      roller(arm,.012,.009,black,x,y,sign*(half+.008));
      bar(arm,[nose,.02,sign*half],[x,y,sign*half],.009,black);
    }
  }
  for (const sign of [-1,1]) {
    const zz=sign*(half+.016);
    for (const [x,y,r] of [[nose-.01,-.084,.030],[nose+.092,-.127,.021],[nose+.033,.007,.018]] as const) roller(arm,r,.008,black,x,y,zz);
    bar(arm,[nose-.01,-.084,zz],[nose+.092,-.127,zz],.006,black);
    motor(arm,nose-.065,.08,sign*(half-.035));
    // Hooks belong to this rotating arm: no independent telescoping posts.
    const hook=plate(arm,[[rear+.03,-.04],[rear-.20,-.31],[rear-.18,-.35],[rear-.145,-.32],[rear-.14,-.27],[rear+.065,-.075]],.008,red,sign*(half+.02));
    hook.name=`skyfall-climb-hook-${sign}`;
  }
  box(arm,.045,.04,.065,black,rear+.04,.09,0); // camera on the moving rear cross member
  const held=pivot(arm,.08,-.013); held.name='skyfall-note-throat';
  const ampExit=pivot(arm,rear,-.018);
  const struts=[-1,1].map(sign=>({sign,body:link(k.visual,.009,black),rod:link(k.visual,.004,silver)}));
  let angle=0, amping=false;
  return { replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'], heldAnchor:held,
    climbAnchor: pivot(arm,rear-.16,-.30), lightAt:[px,py+.1,0],
    flow:{ intake:()=>[...underBumperEntry(k,.025),new THREE.Vector3(-L*.15,bt+.13,0),flowAt(k,arm,rear,-.03,0)],
      feed:()=>[flowAt(k,held),amping?flowAt(k,ampExit):flowAt(k,arm,nose+.10,-.04,0)] },
    update(s) {
      base.update(s); intake.update(s); amping=!!s.amp;
      // CAD horizontal datum is the intake hard stop (-45.27° encoder); outlet angle is fitted.
      const datum=45.27*Math.PI/180;
      const target=s.climb>.5 ? -(Math.PI/2+datum) : s.climb>.1 ? (-39*Math.PI/180+datum)
        : s.amp ? -(23.5*Math.PI/180+datum) : s.enabled&&(s.aiming||s.firing>0) ? THREE.MathUtils.clamp(s.hood-datum,-.35,.65) : 0;
      angle=scoringApproach(angle,target,10,s.dt); arm.rotation.z=angle;
      held.rotation.z=datum;
      for(const r of rollers) spin(r,s.enabled&&(s.intaking||s.firing>0)?-32:0,s.dt);
      for(const {sign,body,rod} of struts) {
        const fixed=new THREE.Vector3(px+.05,bt+.10,sign*(z-.025));
        const moving=pointIn(k.visual,arm,-.10,-.035,sign*(z-.025));
        const join=fixed.clone().lerp(moving,.55);
        body.set(fixed,join); rod.set(join,moving);
      }
    }
  };
}
