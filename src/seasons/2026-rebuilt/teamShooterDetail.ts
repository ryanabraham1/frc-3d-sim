import * as THREE from 'three';
import { bar, box, hoodShell, mat, roller, spin, type RobotAnimState } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { scoringEase } from '@engine/robot/scoringReadiness';

/** Original pocketed sheet geometry, fitted to the teams' public CAD renders. */
export function pocketPlate(parent: THREE.Object3D, outline: [number,number][], holes: [number,number][][], material: THREE.Material, z: number, thickness=.005) {
  const shape = new THREE.Shape(outline.map(p=>new THREE.Vector2(...p)));
  for (const triangle of holes) {
    const hole = new THREE.Path(triangle.map(p=>new THREE.Vector2(...p))); hole.closePath(); shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false}); geo.translate(0,0,-thickness/2);
  const plate = new THREE.Mesh(geo,material); plate.position.z=z; parent.add(plate); return plate;
}
function bearing(parent:THREE.Object3D,r:number,y:number,material:THREE.Material) {
  for (const [inner,outer,dy] of [[r-.015,r,-.007],[r-.008,r+.008,0],[r-.015,r,.007]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner,outer,48),material);
    ring.rotation.x=-Math.PI/2; ring.position.y=y+dy; (ring.material as THREE.MeshStandardMaterial).side=THREE.DoubleSide; parent.add(ring);
  }
  const points:[number,number][]=[];
  for(let i=0;i<16;i++)points.push([Math.cos(i*Math.PI/8)*(r-.009),Math.sin(i*Math.PI/8)*(r-.009)]);
  const bolts=new THREE.Group(); bolts.rotation.x=-Math.PI/2; bolts.position.y=y+.01; parent.add(bolts); fasteners(bolts,points,0);
}
/** RIPCURRENT: pancake bearing, quad motor flywheel, tall pocketed cheeks and concentric adjustable hood. */
export function highTideShooter(t:THREE.Object3D, fixed:THREE.Object3D, x:number,y:number, width:number) {
  const black=mat(0x25282c,{metal:.55,rough:.4}),rubber=mat(0x131619,{rough:.85}),alloy=mat(0x90999f,{metal:.8,rough:.35}),brass=mat(0xba9454,{metal:.85,rough:.3});
  const root=new THREE.Group(); root.name='hightide-pancake-shooter'; root.userData.fuelStructure=true; t.add(root);
  bearing(root,.164,0,alloy);
  const support=new THREE.Group(); support.name='hightide-fixed-bearing-wings'; support.position.set(x,y-.012,0); fixed.add(support);
  // Stationary wings brace the bearing to the hopper rails, while the head rotates inside them.
  const wing = pocketPlate(support,[[-.12,-width*.43],[.12,-width*.43],[.17,-.12],[.17,.12],[.12,width*.43],[-.12,width*.43],[-.17,.12],[-.17,-.12]],[
    [[-.095,-width*.4],[.095,-width*.4],[0,-.18]], [[-.095,width*.4],[0,.18],[.095,width*.4]],
    Array.from({length:48},(_,i)=>[Math.cos(-i*Math.PI/24)*.145,Math.sin(-i*Math.PI/24)*.145] as [number,number]),
  ],black,0,.008); wing.rotation.x=Math.PI/2;
  for(const z of [-width*.4,width*.4])bar(fixed,[x,y-.02,z],[x,y-.23,z],.018,black);
  const hood=new THREE.Group(); hood.name='hightide-adjustable-hood';hood.position.set(.05,.046,0);root.add(hood);
  // Stowed, both shafts sit low in the bearing. The back roller rises with the hood, rather than staying on a tall
  // fixed A-frame. This is the mechanism's flat datum, not the raised pose shown in the isolated CAD render.
  for(const z of [-.107,.107]) {
    pocketPlate(hood,[[.025,-.024],[.025,.041],[-.155,.047],[-.168,-.021]],[
      [[-.014,-.007],[-.057,.025],[-.115,-.007]],
    ],black,z);
    fasteners(hood,[[0,0],[-.14,.012]],z*1.05);
    belt(hood,[0,0],[-.14,.012],z*1.12,.016);
    for(const px of [.005,.10])motor(root,px,-.031,z*1.25);
  }
  const flywheel=roller(root,.038,.158,rubber,.05,.046,0); flywheel.name='hightide-quad-flywheel';
  for(const z of [-.077,.077]) {
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(.0385,.0385,.007,24),brass); disc.rotation.x=Math.PI/2;disc.position.z=z;flywheel.add(disc);
  }
  const backspin=roller(hood,.032,.158,rubber,-.14,.012,0); backspin.name='hightide-backspin-roller';
  // Thin bent guide between the wheels; its whole frame travels on the hood shaft.
  const guide=new THREE.Shape();guide.moveTo(.015,.043);guide.quadraticCurveTo(-.085,.069,-.163,.044);
  guide.lineTo(-.164,.036);guide.quadraticCurveTo(-.085,.061,.014,.035);guide.closePath();
  const guideMesh=new THREE.Mesh(new THREE.ExtrudeGeometry(guide,{depth:.182,bevelEnabled:false,curveSegments:16}),black);
  guideMesh.geometry.translate(0,0,-.091);hood.add(guideMesh);
  // Rotating upper feed train leads through the bearing aperture into the hood, never over the hopper rim.
  const feeds:THREE.Group[]=[];
  for(const [px,py] of [[-.09,-.20],[-.09,-.12],[-.065,-.035]])feeds.push(roller(root,.029,.153,rubber,px,py,0));
  for(const z of [-.09,.09]) {
    pocketPlate(root,[[-.13,-.235],[-.025,-.235],[.025,.02],[-.12,.02]],[
      [[-.113,-.208],[-.04,-.208],[-.072,-.148]], [[-.106,-.133],[-.039,-.12],[-.074,-.059]],
    ],black,z);
    belt(root,[-.09,-.20],[-.065,-.035],z*1.15,.016);
  }
  camera(root,.103,.028,.11);
  let angle=0,speed=0;hood.rotation.z=angle;
  return {flywheel,hood,update(s:RobotAnimState) {
    angle=scoringEase(angle,(s.aiming||s.firing>0 ? -(THREE.MathUtils.clamp(s.hood,.5,1.28)-.5):0),s.dt); hood.rotation.z=angle;
    speed=scoringEase(speed,s.enabled&&(s.aiming||s.firing>0)?70:0,s.dt);
    spin(flywheel,speed,s.dt);spin(backspin,-speed*.65,s.dt);for(const wheel of feeds)spin(wheel,-speed*.6,s.dt);
  }};
}
/** Kepler's compact gear-driven head: its own corner bearing, triangular cheeks and adjustable hood. */
export function keplerShooter(t:THREE.Object3D) {
  const black=mat(0x24282d,{metal:.65,rough:.35}),rubber=mat(0x161b1c,{rough:.85}),alloy=mat(0xc1c8ca,{metal:.85}),green=mat(0x55a638);
  const root=new THREE.Group();root.name='kepler-gear-shooter';root.userData.fuelStructure=true;t.add(root);
  bearing(root,.102,-.11,alloy);
  for(const z of [-.102,.102]) {
    pocketPlate(root,[[-.13,-.11],[.108,-.11],[.028,.092],[-.011,.116]],[
      [[-.1,-.078],[.054,-.078],[-.017,.073]], [[.033,.065],[.075,-.063],[.024,-.038]],
    ],black,z);
    fasteners(root,[[-.113,-.098],[.091,-.097],[0,.092]],z*1.04);
    motor(root,-.082,-.055,z*1.2);
  }
  const flywheel=roller(root,.042,.169,rubber,-.067,-.048,0);flywheel.name='kepler-flywheel';
  const upper=roller(root,.029,.166,green,.004,.089,0);
  const gears:THREE.Group[]=[];
  // Spur teeth remain readable as the shaft turns; no belts on this head.
  for(const [x,y,r] of [[-.067,-.048,.032],[-.03,.018,.037],[.004,.089,.027]]) {
    const gear=new THREE.Group();gear.position.set(x,y,.118);root.add(gear);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(r*.9,r*.9,.012,24),alloy);hub.rotation.x=Math.PI/2;gear.add(hub);
    for(let j=0;j<24;j++) {const a=j*Math.PI/12;const tooth=box(gear,.007,.006,.014,alloy,Math.cos(a)*r,Math.sin(a)*r,0);tooth.rotation.z=a;}
    gears.push(gear);
  }
  const hood=new THREE.Group();hood.position.copy(flywheel.position);hood.name='kepler-adjustable-hood';root.add(hood);
  hoodShell(hood,.108,.183,black,24);
  for(const z of [-.097,.097])pocketPlate(hood,[[-.098,0],[-.08,.095],[.01,.13],[.073,.048],[.027,0]],[ [[-.068,.026],[-.052,.087],[.029,.048]] ],black,z);
  const feeder=roller(root,.029,.16,rubber,-.075,-.164,0); feeder.name='kepler-upfeed';
  camera(root,.086,-.088,-.11);
  let angle=0,speed=0;
  return {flywheel,hood,update(s:RobotAnimState) {
    angle=scoringEase(angle,(s.aiming||s.firing>0?THREE.MathUtils.clamp(s.hood,.5,1.28):1.28)-1.28,s.dt);hood.rotation.z=angle;
    speed=scoringEase(speed,s.enabled&&(s.aiming||s.firing>0)?65:0,s.dt);
    spin(flywheel,speed,s.dt);spin(upper,-speed,s.dt);spin(feeder,-speed*.5,s.dt);gears.forEach((g,i)=>spin(g,speed*(i%2?-1:1),s.dt));
  }};
}
