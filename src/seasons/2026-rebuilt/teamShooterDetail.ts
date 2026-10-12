import * as THREE from 'three';
import { bar, mat, spin, type RobotAnimState } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { hoodLive, scoringEase } from '@engine/robot/scoringReadiness';

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
/**
 * Warren-truss pockets for a side plate: bottom chord at `y0`, top chord `top(x)`, `n` panels between x0 and x1.
 * Up and down triangles alternate and are inset by `web`, leaving the diagonals and chords as plate.
 */
export function trussPockets(x0:number,x1:number,y0:number,top:(x:number)=>number,n:number,web:number):[number,number][][] {
  const holes:[number,number][][]=[];const p=(x1-x0)/n;
  const inset=(tri:[number,number][]):[number,number][]=>{const cx=(tri[0][0]+tri[1][0]+tri[2][0])/3,cy=(tri[0][1]+tri[1][1]+tri[2][1])/3;
    return tri.map(([x,y])=>{const d=Math.hypot(x-cx,y-cy);const f=Math.max(0,(d-web*1.5)/d);return [cx+(x-cx)*f,cy+(y-cy)*f] as [number,number];});};
  for(let i=0;i<n;i++) {
    const a=x0+i*p,b=a+p,m=a+p/2;
    if(top(m)-y0>.03)holes.push(inset([[a,y0],[b,y0],[m,top(m)]]));
    if(i<n-1){const m2=b+p/2;if(Math.min(top(m),top(m2))-y0>.03)holes.push(inset([[m,top(m)],[b,y0],[m2,top(m2)]]));}
  }
  return holes;
}

/**
 * Pocketed sheet whose pockets fan out from a bearing hub (`hub`) to the outline, leaving a solid ring round the hub and
 * a web along every spoke and edge, the way teams pocket shooter side plates. Long edges are split so pockets stay
 * small. Returns the plate mesh (XY profile, extruded along z, centred on `z`).
 */
export function webPlate(parent: THREE.Object3D, outline: [number,number][], hub: [number,number], m: THREE.Material, z: number, o: { t?: number; ring?: number; web?: number; maxEdge?: number } = {}) {
  const ring = o.ring ?? .3, web = o.web ?? .16, maxEdge = o.maxEdge ?? .07;
  const rim: [number,number][] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], n = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]) / maxEdge));
    for (let j = 0; j < n; j++) rim.push([a[0] + (b[0]-a[0]) * j / n, a[1] + (b[1]-a[1]) * j / n]);
  }
  const holes: [number,number][][] = [];
  const at = (v: [number,number], f: number): [number,number] => [hub[0] + (v[0]-hub[0]) * f, hub[1] + (v[1]-hub[1]) * f];
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i], q = rim[(i + 1) % rim.length], mid: [number,number] = [(p[0]+q[0])/2, (p[1]+q[1])/2];
    const off = (v: [number,number]): [number,number] => { const u = at(v, .84); return [u[0] + (mid[0]-v[0]) * web * 2, u[1] + (mid[1]-v[1]) * web * 2]; };
    const tip = at(mid, ring);
    if (Math.hypot(q[0]-p[0], q[1]-p[1]) * .84 < .022 || Math.hypot(mid[0]-hub[0], mid[1]-hub[1]) < .05) continue;
    holes.push([tip, off(p), off(q)]);
  }
  return pocketPlate(parent, outline, holes, m, z, o.t ?? .005);
}

/** Wheel stack on a dead shaft (axis local z): the group spins, so the treads show rotation. */
function wheelStack(parent: THREE.Object3D, x: number, y: number, r: number, zs: number[], width: number, tread: THREE.Material, hub: THREE.Material, shaft: number) {
  const g = new THREE.Group(); g.position.set(x, y, 0); g.userData.flowSpinAxis = 'z'; parent.add(g);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, shaft, 10), hub); axle.rotation.x = Math.PI / 2; g.add(axle);
  for (const z of zs) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 24), tread); w.rotation.x = Math.PI / 2; w.position.z = z; g.add(w);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * .45, r * .45, width + .004, 12), hub); h.rotation.x = Math.PI / 2; h.position.z = z; g.add(h);
    // Two contrasting tread marks per wheel so rotation reads at speed.
    for (const a of [0, Math.PI]) { const mk = new THREE.Mesh(new THREE.BoxGeometry(.008, .006, width + .002), hub); mk.position.set(Math.cos(a) * (r - .002), Math.sin(a) * (r - .002), z); mk.rotation.z = a; g.add(mk); }
  }
  return g;
}

/**
 * RIPCURRENT's pancake turret (binder "pancake turret", Behind the Bumpers "compact pancake turret"; match photos
 * mYDBhBN / 0DqbRg6; the supplied image reconstruction). A wide, flat, pocketed black turret plate rides on the bearing
 * flush with the hopper top, with a slot over the dye-rotor throat. Only a low head stands on it (photo: about 3 in):
 * two black pocketed side plates carrying the quad-Kraken 3 in flywheel BELOW the plate in the slot, and a curved
 * black hood concentric with the flywheel that pivots on the flywheel axis (a sector gear and a small hood motor on the
 * +z plate). FUEL comes straight up the throat behind the flywheel, wraps over it under the hood and leaves forward
 * at the hood angle. Turret local +x is the shot direction.
 */
export function highTideShooter(t:THREE.Object3D, fixed:THREE.Object3D, x:number,y:number, width:number) {
  const black=mat(0x202326,{metal:.5,rough:.42}),rubber=mat(0x141618,{rough:.85}),alloy=mat(0x9aa3a9,{metal:.8,rough:.35});
  const root=new THREE.Group(); root.name='hightide-pancake-shooter'; root.userData.fuelStructure=true; t.add(root);
  bearing(root,.164,0,black);
  // Turret plate: Ø13 in pancake with a rounded slot (ball path, flywheel and hood) and pockets round the rim.
  const deckShape=new THREE.Shape();deckShape.absarc(0,0,.165,0,Math.PI*2,false);
  const sx=.125,sz=.093,cr=.025,slot=new THREE.Path();
  slot.moveTo(-sx+cr,-sz);slot.lineTo(sx-cr,-sz);slot.absarc(sx-cr,-sz+cr,cr,-Math.PI/2,0,false);slot.lineTo(sx,sz-cr);
  slot.absarc(sx-cr,sz-cr,cr,0,Math.PI/2,false);slot.lineTo(-sx+cr,sz);slot.absarc(-sx+cr,sz-cr,cr,Math.PI/2,Math.PI,false);
  slot.lineTo(-sx,-sz+cr);slot.absarc(-sx+cr,-sz+cr,cr,Math.PI,Math.PI*1.5,false);deckShape.holes.push(slot);
  for(let j=0;j<16;j++) {
    const a=j*Math.PI/8,pts=[[-.07,.134],[-.05,.155],[.05,.155],[.07,.134]].map(([da,r])=>[Math.cos(a+da)*r,Math.sin(a+da)*r]);
    if(pts.some(([px,pz])=>Math.abs(px)<sx+.008&&Math.abs(pz)<sz+.008))continue;
    const hole=new THREE.Path(pts.map(([px,pz])=>new THREE.Vector2(px,pz)));hole.closePath();deckShape.holes.push(hole);
  }
  const pancake=new THREE.Mesh(new THREE.ExtrudeGeometry(deckShape,{depth:.007,bevelEnabled:false,curveSegments:24}),black);
  pancake.rotation.x=-Math.PI/2;pancake.position.y=.002;pancake.name='hightide-pocketed-pancake-deck';root.add(pancake);
  const race=new THREE.Mesh(new THREE.RingGeometry(.157,.161,64),alloy);race.rotation.x=-Math.PI/2;race.position.y=.0095;root.add(race);
  // Stationary deck plate under the bearing, pocketed, spanning the hopper and tied down to the hopper rails.
  const support=new THREE.Group(); support.name='hightide-fixed-bearing-wings'; support.position.set(x,y-.012,0); fixed.add(support);
  const wing = pocketPlate(support,[[-.12,-width*.43],[.12,-width*.43],[.17,-.12],[.17,.12],[.12,width*.43],[-.12,width*.43],[-.17,.12],[-.17,-.12]],[
    [[-.095,-width*.4],[.095,-width*.4],[0,-.18]], [[-.095,width*.4],[0,.18],[.095,width*.4]],
    Array.from({length:48},(_,i)=>[Math.cos(-i*Math.PI/24)*.145,Math.sin(-i*Math.PI/24)*.145] as [number,number]),
  ],black,0,.008); wing.rotation.x=Math.PI/2;
  for(const z of [-width*.4,width*.4])bar(fixed,[x,y-.02,z],[x,y-.23,z],.018,black);
  // Flywheel axis sits in the slot below the plate; the ball rises at x = F.x - rb, right over the throat.
  const F:[number,number]=[.07,-.075], wheelR=.038, rb=wheelR+.075-.012, hoodR=.176;
  const plateZ=.088;
  // Low A-frame side plates (photo mYDBhBN: sloped truss legs, flat top bar, about 4 in above the turret plate),
  // Warren-truss pocketed between a bottom chord and the sloped/flat top chord.
  const topY=.105, xl=-.118, xr=.122, kneeL=-.03, kneeR=.06;
  const chord=(px:number)=>px<kneeL?(px-xl)/(kneeL-xl)*topY:px>kneeR?topY-(px-kneeR)/(xr-kneeR)*topY:topY;
  const outline:[number,number][]=[[xl,-.088],[xr,-.088],[xr,0],[kneeR,topY],[kneeL,topY],[xl,0]];
  const holes=trussPockets(xl+.012,xr-.012,-.07,(px:number)=>Math.max(-.05,chord(px)-.016),4,.007).filter(tri=>tri.every(([px,py])=>Math.hypot(px-F[0],py-F[1])>.03));
  for(const z of [-plateZ,plateZ]) {
    pocketPlate(root,outline,holes,black,z,.006).name='hightide-shooter-side-plate';
    const bore=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,.012,16),alloy);bore.rotation.x=Math.PI/2;bore.position.set(F[0],F[1],z);root.add(bore);
    fasteners(root,[[-.105,-.075],[.11,-.075],[.11,.0],[-.105,-.04]],z+Math.sign(z)*.004);
    // Quad Krakens: one coaxial per side, one belted from below the plate per side.
    motor(root,F[0],F[1],z+Math.sign(z)*.04);
    const m2:[number,number]=[-.07,-.062];
    motor(root,m2[0],m2[1],z+Math.sign(z)*.04);
    belt(root,m2,F,z+Math.sign(z)*.009,.018);
  }
  // Standoffs tie the two plates together at the knees and the front foot.
  for(const [px,py] of [[kneeL+.01,topY-.012],[kneeR-.005,topY-.012],[xr-.012,-.075],[xl+.012,-.075]] as [number,number][]) {
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.0055,.0055,2*plateZ,8),alloy);st.rotation.x=Math.PI/2;st.position.set(px,py,0);root.add(st);
  }
  const flywheel=wheelStack(root,F[0],F[1],wheelR,[-.06,-.02,.02,.06],.034,rubber,alloy,2*plateZ+.01); flywheel.name='hightide-quad-flywheel';
  // Hood: a curved black sheet concentric with the flywheel, pivoting on its axis. Rotating the hood group by the
  // exit angle puts the hood's lip where the ball leaves (direction = lip angle - 90°).
  const hood=new THREE.Group(); hood.name='hightide-adjustable-hood'; hood.userData.hood=true; hood.userData.hoodRotor=hood; hood.position.set(F[0],F[1],0); root.add(hood);
  // 29°: raised for a steep shot, a longer shell's tail swings down across the throat and over the rotor plate.
  const span=.5, shell=new THREE.Shape();
  shell.absarc(0,0,hoodR+.006,0,span,false);shell.absarc(0,0,hoodR,span,0,true);shell.closePath();
  const shellMesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shell,{depth:2*plateZ-.012,bevelEnabled:false,curveSegments:20}),black);
  shellMesh.geometry.translate(0,0,-(plateZ-.006));hood.add(shellMesh);
  // Sector gear on the +z hood flank and the small hood motor whose pinion drives it.
  const teeth:[number,number][]=[];
  for(let i=0;i<=40;i++){const a=-.75+i*1/40;teeth.push([Math.cos(a)*(i%2?.13:.124),Math.sin(a)*(i%2?.13:.124)]);}
  for(let i=40;i>=0;i--){const a=-.75+i*1/40;teeth.push([Math.cos(a)*.1,Math.sin(a)*.1]);}
  pocketPlate(hood,teeth,[],black,plateZ-.01,.004);
  const pinion:[number,number]=[F[0]+.143*Math.cos(2.3),F[1]+.143*Math.sin(2.3)];
  const hoodMotor=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.04,14),black);hoodMotor.rotation.x=Math.PI/2;hoodMotor.position.set(pinion[0],pinion[1],plateZ+.024);root.add(hoodMotor);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.019,.019,.005,14),alloy);cap.rotation.x=Math.PI/2;cap.position.set(pinion[0],pinion[1],plateZ+.046);root.add(cap);
  camera(root,-.13,.02,.12);
  let exit=Math.PI/2+.5,speed=0;hood.rotation.z=exit;
  const ballAt=(a:number)=>[F[0]+rb*Math.cos(a),F[1]+rb*Math.sin(a)] as [number,number];
  return {flywheel,hood,
    /** Ball centre path through the head in turret-local coordinates: up the throat, round the flywheel, out the lip. */
    path:()=>[ballAt(Math.PI*1.08),ballAt(Math.PI),ballAt((Math.PI+exit)/2),ballAt(exit)].map(([px,py])=>new THREE.Vector3(px,py,0)),
    root,
    update(s:RobotAnimState) {
      exit=scoringEase(exit,Math.PI/2+(hoodLive(s)?THREE.MathUtils.clamp(s.hood,.5,1.28):.5),s.dt); hood.rotation.z=exit;
      speed=scoringEase(speed,s.enabled&&hoodLive(s)?70:0,s.dt);
      // Back of the wheel moves up: the wheel turns clockwise seen from +z.
      spin(flywheel,-speed,s.dt);
    }};
}
/**
 * KEPLER's turret head, after the match photos (refs/1690-2026 jJiksKT close-up and nGnBPZM side view) and the team's
 * CAD thread (CD 520673). The head is COMPACT and DARK: it sits low in the clear tower (the clear shield reaches nearly
 * to its top), black 3D-printed hood rails, black Talon FX motors and wiring, dark-anodised pocketed side plates with
 * only their edges catching light, green wheels at the hood lip. Mechanism per the team: 8 in turret bearing, beltless
 * shooter (the hood roller is gear-driven off the flywheel through a train inside the plate pocket; only the end gears
 * show), and a "hollow hood" that guides the ball only at its sides (printed PLA). FUEL rises through the bearing behind
 * the flywheel, wraps over it under the hood rails, and leaves past the green lip roller. The hood pivots on the
 * flywheel axis. Turret local +x shoots.
 */
export function keplerShooter(t:THREE.Object3D) {
  const black=mat(0x1c1f22,{metal:.35,rough:.55}),rubber=mat(0x111416,{rough:.92}),dark=mat(0x363b40,{metal:.55,rough:.45}),
    alloy=mat(0x9aa2a8,{metal:.8,rough:.38}),green=mat(0x5fbf3a,{rough:.75});
  const root=new THREE.Group();root.name='kepler-gear-shooter';root.userData.fuelStructure=true;t.add(root);
  bearing(root,.102,-.11,black);
  // Rotating turret plate on the bearing (dark), with the ball opening behind the flywheel.
  const base=new THREE.Shape();base.absarc(0,0,.112,0,Math.PI*2,false);
  const hole=new THREE.Path();hole.absarc(-.04,0,.066,0,Math.PI*2,true);base.holes.push(hole);
  const plate=new THREE.Mesh(new THREE.ExtrudeGeometry(base,{depth:.006,bevelEnabled:false,curveSegments:20}),black);
  plate.rotation.x=-Math.PI/2;plate.position.y=-.104;plate.name='kepler-turret-plate';root.add(plate);
  const F:[number,number]=[.04,-.04], wheelR=.045, rb=wheelR+.075-.015, plateZ=.082;
  // Compact pocketed side plates, about 8 in long and 8 in tall from the turret plate.
  const outline:[number,number][]=[[-.1,-.1],[.1,-.1],[.105,-.025],[.045,.075],[-.045,.085],[-.105,.025]];
  for(const z of [-plateZ,plateZ]) {
    webPlate(root,outline,F,dark,z,{t:.006,ring:.36,web:.12,maxEdge:.11}).name='kepler-shooter-side-plate';
    // Bright machined edges: the only silver the photos show on the head.
    for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];bar(root,[a[0],a[1],z+Math.sign(z)*.0035],[b[0],b[1],z+Math.sign(z)*.0035],.004,alloy);}
    const bore=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.013,16),alloy);bore.rotation.x=Math.PI/2;bore.position.set(F[0],F[1],z);root.add(bore);
  }
  for(const [px,py] of [[-.09,-.09],[.09,-.09],[-.085,.03],[.03,.07]] as [number,number][]) {
    const st=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,2*plateZ,8),alloy);st.rotation.x=Math.PI/2;st.position.set(px,py,0);root.add(st);
  }
  const flywheel=wheelStack(root,F[0],F[1],wheelR,[-.045,0,.045],.03,rubber,black,2*plateZ+.02);flywheel.name='kepler-flywheel';
  // Talon FX (Kraken) on the -z plate, a second on the feeder; black braided leads down into the tower.
  motor(root,F[0],F[1],-plateZ-.04,0x2d2f31);
  const feeder=wheelStack(root,-.05,-.12,.022,[-.04,0,.04],.024,rubber,black,2*plateZ);feeder.name='kepler-upfeed';
  motor(root,-.05,-.12,-plateZ-.04,0x2d2f31);
  const cable=mat(0x14171a,{rough:.9});
  for(const sz of [-1,1])bar(root,[F[0]-.02,F[1]-.03,sz*(plateZ+.03)],[-.09,-.105,sz*(plateZ+.02)],.007,cable);
  // Hollow hood: two black printed rails concentric with the flywheel (no centre sheet), tied by a rod at the back.
  const hood=new THREE.Group();hood.name='kepler-adjustable-hood';hood.userData.hood=true;hood.userData.hoodRotor=hood;hood.position.set(F[0],F[1],0);root.add(hood);
  const hoodR=rb+.075, span=1.05;
  for(const z of [-.058,.058]) {
    const rail=new THREE.Shape();rail.absarc(0,0,hoodR+.024,0,span,false);rail.absarc(0,0,hoodR,span,0,true);rail.closePath();
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(rail,{depth:.022,bevelEnabled:false,curveSegments:18}),black);mesh.position.z=z-.011;hood.add(mesh);
  }
  const tie=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,2*plateZ-.01,8),black);tie.rotation.x=Math.PI/2;tie.position.set(Math.cos(span-.05)*(hoodR+.012),Math.sin(span-.05)*(hoodR+.012),0);hood.add(tie);
  // Green hood roller at the lip; small end gears inside the +z plate on the flywheel and roller shafts.
  const lipA=.12, rollerR=.022, rollerD=rb+.075+rollerR-.012;
  const lip=wheelStack(hood,Math.cos(lipA)*rollerD,Math.sin(lipA)*rollerD,rollerR,[-.028,0,.028],.022,green,black,2*plateZ);lip.name='kepler-hood-shaft';
  const gearMat=mat(0x3a3e42,{metal:.6,rough:.4});
  function gear(parent:THREE.Object3D,x:number,y:number,r:number,z:number) {
    const group=new THREE.Group();group.position.set(x,y,z);parent.add(group);
    const pts:[number,number][]=[];const n=Math.round(r*900)*2;
    for(let i=0;i<n;i++){const a=i*Math.PI*2/n,rr=r*(i%2?1:.88);pts.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
    pocketPlate(group,pts,[],gearMat,0,.005);
    return group;
  }
  const gz=plateZ-.008;
  const gears=[gear(hood,0,0,.02,gz),gear(hood,Math.cos(lipA)*rollerD,Math.sin(lipA)*rollerD,.016,gz)];
  camera(root,-.07,.045,-.105);
  let exit=Math.PI/2+.5,speed=0;hood.rotation.z=exit-lipA;
  const ballAt=(a:number)=>[F[0]+rb*Math.cos(a),F[1]+rb*Math.sin(a)] as [number,number];
  return {flywheel,hood,root,
    path:()=>[ballAt(Math.PI*1.12),ballAt(Math.PI),ballAt((Math.PI+exit)/2),ballAt(exit)].map(([px,py])=>new THREE.Vector3(px,py,0)),
    update(s:RobotAnimState) {
      // The hood's lip (where the roller sits) is placed at the solved exit; the ball leaves at lip angle - 90°.
      exit=scoringEase(exit,Math.PI/2+(hoodLive(s)?THREE.MathUtils.clamp(s.hood,.5,1.28):.5),s.dt);hood.rotation.z=exit-lipA;
      speed=scoringEase(speed,s.enabled&&hoodLive(s)?65:0,s.dt);
      spin(flywheel,-speed,s.dt);spin(lip,speed*1.6,s.dt);spin(feeder,-speed*.5,s.dt);
      gears.forEach((g,i)=>spin(g,(i%2?1:-1)*speed,s.dt));
    }};
}
