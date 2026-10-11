import * as THREE from 'three';
import { bar, mat, roller, spin, type RobotAnimState } from '@engine/robot/models';
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
/**
 * Laser-cut X truss plate (RIPCURRENT's teal corner columns, Kepler's silver tower plates): `cols` × `rows` square-ish cells, each with four
 * triangular pockets so the rails and diagonals are one extruded sheet (one draw call, not a bar per member).
 */
export function xTruss(parent: THREE.Object3D, w: number, h: number, cols: number, rows: number, m: THREE.Material, x = 0, z = 0, t = .005): THREE.Mesh {
  const rail = .009, web = .0065;
  const outline: [number, number][] = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const holes: [number, number][][] = [];
  const cw = (w - 2 * rail) / cols, ch = (h - 2 * rail) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const l = -w / 2 + rail + i * cw + web / 2, r = l + cw - web, b = rail + j * ch + web / 2, tp = b + ch - web;
    const mx = (l + r) / 2, my = (b + tp) / 2, dx = web * .9, dy = web * .9;
    holes.push([[l, b], [r, b], [mx, my - dy]]);
    holes.push([[l, tp], [mx, my + dy], [r, tp]]);
    holes.push([[l, b + dy], [l, tp - dy], [mx - dx, my]]);
    holes.push([[r, b + dy], [mx + dx, my], [r, tp - dy]]);
  }
  const plate = pocketPlate(parent, outline, holes, m, z, t);
  plate.position.x = x;
  return plate;
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
  bearing(root,.164,0,black);
  // The supplied reconstruction and team render both show a broad pancake deck, not a wire-thin bearing ring.
  const deckShape=new THREE.Shape();deckShape.absarc(0,0,.162,0,Math.PI*2,false);
  const aperture=new THREE.Path();aperture.absarc(0,0,.113,0,Math.PI*2,true);deckShape.holes.push(aperture);
  for(let j=0;j<12;j++) {
    const a=j*Math.PI/6,points=[[-.10,.129],[-.065,.149],[.065,.149],[.10,.129]].map(([da,r])=>new THREE.Vector2(Math.cos(a+da)*r,Math.sin(a+da)*r));
    const hole=new THREE.Path(points);hole.closePath();deckShape.holes.push(hole);
  }
  const pancake=new THREE.Mesh(new THREE.ExtrudeGeometry(deckShape,{depth:.007,bevelEnabled:false,curveSegments:48}),black);
  pancake.rotation.x=-Math.PI/2;pancake.position.y=.007;pancake.name='hightide-pocketed-pancake-deck';root.add(pancake);
  const race=new THREE.Mesh(new THREE.RingGeometry(.156,.159,64),alloy);race.rotation.x=-Math.PI/2;race.position.y=.011;root.add(race);
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
  const guideMesh=new THREE.Mesh(new THREE.ExtrudeGeometry(guide,{depth:.182,bevelEnabled:false,curveSegments:16}),mat(0x60676c,{opacity:.32,rough:.4,metal:0}));
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
/** Kepler's released CAD uses a hollow side-guided hood and a center stack of compliant wheels. */
export function keplerShooter(t:THREE.Object3D) {
  const black=mat(0x25292c,{metal:.45,rough:.48}),rubber=mat(0x121719,{rough:.92}),alloy=mat(0x929ca2,{metal:.8,rough:.4}),green=mat(0x65a93d,{rough:.8});
  const root=new THREE.Group();root.name='kepler-gear-shooter';root.userData.fuelStructure=true;t.add(root);
  bearing(root,.102,-.11,black);
  // Low fixed cheeks support the main shaft; the taller guide moves with the hood.
  for(const z of [-.102,.102]) {
    pocketPlate(root,[[-.125,-.112],[.091,-.112],[.057,-.026],[-.036,.015],[-.125,-.018]],[
      [[-.101,-.083],[.049,-.083],[-.023,-.013]],
    ],alloy,z); // raw aluminium cheeks (match photos), black hood guides
    fasteners(root,[[-.112,-.098],[.075,-.098],[-.067,-.048]],z*1.04);
    motor(root,-.067,-.048,z*1.18);
  }
  const flywheel=roller(root,.042,.169,rubber,-.067,-.048,0);flywheel.name='kepler-flywheel';
  const hood=new THREE.Group();hood.position.copy(flywheel.position);hood.name='kepler-adjustable-hood';root.add(hood);
  // The middle stays open: only curved side rails guide the ball. A solid hood obscured both the ball and wheels.
  for(const z of [-.096,.096]) {
    const guide=new THREE.Shape();guide.moveTo(-.058,.012);guide.quadraticCurveTo(-.070,.12,.070,.151);
    guide.lineTo(.119,.118);guide.lineTo(.116,.099);guide.lineTo(.071,.131);
    guide.quadraticCurveTo(-.045,.111,-.042,.012);guide.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(guide,{depth:.006,bevelEnabled:false,curveSegments:24}),black);
    mesh.position.z=z-.003;hood.add(mesh);
    bar(hood,[-.044,.010,z],[.082,.124,z],.006,alloy);
  }
  const upper=roller(hood,.018,.184,rubber,.071,.137,0);upper.name='kepler-hood-shaft';
  for(const z of [-.023,0,.023]) {
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.029,.029,.021,24),green);tire.rotation.x=Math.PI/2;tire.position.z=z;upper.add(tire);
  }
  // Small black pocketed gears sit outside the side guide, with metallic bores and visible teeth.
  function gear(parent:THREE.Object3D,x:number,y:number,r:number,z:number) {
    const group=new THREE.Group();group.position.set(x,y,z);parent.add(group);
    const outline:[number,number][]=[];
    for(let i=0;i<96;i++){const a=i*Math.PI/48,rr=r*(i%4<2?1:.92);outline.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
    const holes:[number,number][][]=[];
    for(let j=0;j<3;j++) {const a=j*Math.PI*2/3;holes.push([.35,.76,.76].map((rr,i)=>{const angle=a+[-.18,-.32,.32][i];return [Math.cos(angle)*r*rr,Math.sin(angle)*r*rr] as [number,number];}));}
    pocketPlate(group,outline,holes,black,0,.007);
    const bore=new THREE.Mesh(new THREE.RingGeometry(.004,.008,16),alloy);bore.position.z=.004;group.add(bore);
    return group;
  }
  const gears=[gear(root,-.067,-.048,.025,.116),gear(hood,.020,.073,.032,.116),gear(hood,.071,.137,.027,.116)];
  const feeder=roller(root,.029,.16,rubber,-.075,-.164,0);feeder.name='kepler-upfeed';
  camera(root,.071,-.089,-.11);
  let angle=0,speed=0;
  return {flywheel,hood,update(s:RobotAnimState) {
    angle=scoringEase(angle,(s.aiming||s.firing>0?THREE.MathUtils.clamp(s.hood,.5,1.28):1.28)-1.28,s.dt);hood.rotation.z=angle;
    speed=scoringEase(speed,s.enabled&&(s.aiming||s.firing>0)?65:0,s.dt);
    spin(flywheel,speed,s.dt);spin(upper,-speed,s.dt);spin(feeder,-speed*.5,s.dt);gears.forEach((g,i)=>spin(g,speed*(i%2?-1:1),s.dt));
  }};
}
