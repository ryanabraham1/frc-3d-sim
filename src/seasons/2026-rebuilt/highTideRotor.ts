import * as THREE from 'three';
import { box, dyeRotor, mat, spin } from '@engine/robot/models';

/** Original simplified geometry from HighTide's public 2026 binder, Dye Rotor CAD render.
 * Dimensions are fitted estimates; this assembly only supplies geometry and visual transport.
 */
/* The tub is only a low lip: the hopper walls are the dye rotor's fence (photos show FUEL right down to the floor
 * through the clear fixed end). */
export function highTideRotor(parent: THREE.Object3D, x: number, y0: number, radius: number, top: number, black: THREE.Material, accent: THREE.Material) {
  const rotor = dyeRotor(parent, { x, y0, R: radius, wallH: .03, towerX: x, towerR: .09, towerTop: top, plate: black, accent, motors: 3, guide: false });
  rotor.tower.visible = false;
  rotor.floor.name = 'hightide-dye-rotor-floor';
  const tower = new THREE.Group();
  tower.name = 'hightide-roller-throat';
  tower.position.set(x, y0, 0); parent.add(tower);
  // Lift wheels face the quarter of the plate the fin never sweeps (FUEL guided along the fin would otherwise run into
  // them from behind); the fin's inner end delivers each ball onto their working face.
  tower.rotation.y = -Math.PI * 2 / 3;
  const height = top - y0;
  // Open front throat and curved rear shrink-wrap guide, rather than a solid generic column. The guide starts a ball's
  // height above the plate, so the fin can sweep FUEL into the throat from any side. [EST]
  const mouth = .175;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,height-mouth,32,1,true,Math.PI*.1,Math.PI*1.2), black);
  wrap.position.y = (height+mouth)/2; tower.add(wrap);
  for (const y of [mouth,height]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.12,.137,32,1,Math.PI*.6,Math.PI*1.2), accent);
    ring.rotation.x=-Math.PI/2; ring.position.y=y;
    (ring.material as THREE.MeshStandardMaterial).side=THREE.DoubleSide; tower.add(ring);
  }
  const rollers: THREE.Group[] = [];
  const urethane = mat(0x34383d,{rough:.8}), silver=mat(0xb6bec8,{metal:.8});
  // Lift wheels, lowest just clear of the fin, pressing the ball against the guide.
  for (const y of [height*.36,height*.6,height*.84]) {
    // Inside the column, so FUEL circling the rotor passes outside them.
    const axle = new THREE.Group(); axle.position.set(-.06,y,0); tower.add(axle);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.19,8),silver);
    shaft.rotation.x=Math.PI/2; axle.add(shaft);
    // Spaced compliant wheel treads make shaft rotation visible without individual rigid bodies.
    for (const z of [-.064,-.032,0,.032,.064]) {
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.038,.038,.021,12),urethane);
      wheel.rotation.x=Math.PI/2; wheel.position.z=z; axle.add(wheel);
      for (let tooth=0;tooth<6;tooth++) {
        const angle=tooth*Math.PI/3;
        const tread=box(axle,.009,.012,.024,accent,Math.cos(angle)*.038,Math.sin(angle)*.038,z);
        tread.rotation.z=angle;
      }
    }
    rollers.push(axle);
  }
  // Narrow gearbox column behind the wheels carries their shafts (side bars out at the shaft ends would stand in the
  // path the fin guides FUEL along).
  box(tower,.03,height-height*.25,.05,black,-.115,(height+height*.25)/2,0).name='hightide-lift-gearbox';
  // Upright curved dye-rotor blade, matching the user's close-up rather than an 8 mm floor rib.
  // Fitted dimensions [EST]: 25 mm at the throat, 85 mm at the outer tip; one continuous curved wall.
  const fin = new THREE.Group(); fin.name='hightide-dolphin-fin'; rotor.floor.add(fin);
  const steps=48, thickness=.009, bladeHeight=.085, vertices:number[]=[], indices:number[]=[];
  for(let i=0;i<=steps;i++) {
    const t=i/steps, angle=t*Math.PI*1.3, r=.06+(radius-.075)*t;
    const dr=(radius-.075)/(Math.PI*1.3);
    const dx=dr*Math.cos(angle)-r*Math.sin(angle), dz=dr*Math.sin(angle)+r*Math.cos(angle);
    const length=Math.hypot(dx,dz), nx=-dz/length*thickness/2, nz=dx/length*thickness/2;
    const x=Math.cos(angle)*r,z=Math.sin(angle)*r,h=.025+(bladeHeight-.025)*t;
    vertices.push(x+nx,0,z+nz,x-nx,0,z-nz,x+nx,h,z+nz,x-nx,h,z-nz);
    if(i<steps) {
      const n=i*4,m=n+4;
      indices.push(n,m,n+2,n+2,m,m+2,n+1,n+3,m+1,n+3,m+3,m+1,
        n+2,m+2,n+3,n+3,m+2,m+3,n,n+1,m,n+1,m+1,m);
    }
  }
  indices.push(0,2,1,1,2,3,steps*4,steps*4+1,steps*4+2,steps*4+1,steps*4+3,steps*4+2);
  const bladeGeometry=new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  bladeGeometry.setIndex(indices);bladeGeometry.computeVertexNormals();
  const blade=new THREE.Mesh(bladeGeometry,mat(0x3d8bdf,{metal:.3,rough:.5}));blade.name='hightide-curved-rotor-blade';fin.add(blade);
  return {
    floor:rotor.floor,
    /** The open throat column (origin on its axis, at the rotor floor) and its lift wheels on the open side. */
    tower, lift: rollers, height, fin, radius, bladeHeight,
    // Lift wheels sit on the column's -x side: their +x faces run upward while the rotor feeds.
    update(rate:number,dt:number) { spin(rotor.floor,rate,dt,'y'); for(const roller of rollers) spin(roller,rate*4,dt,'z'); for(const roller of rotor.rollers) spin(roller,rate*4,dt,'y'); },
    feed(r:number) {
      const points=rotor.feed(r);
      // Bend through the open roller mouth before climbing the centre throat.
      points.splice(-2,2,new THREE.Vector3(x-.08,y0+r+.01,0),new THREE.Vector3(x,y0+height-r-.02,0));
      return points;
    },
  };
}
