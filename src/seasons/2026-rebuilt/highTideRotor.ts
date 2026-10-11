import * as THREE from 'three';
import { bar, box, dyeRotor, mat, spin } from '@engine/robot/models';

/** Original simplified geometry from HighTide's public 2026 binder, Dye Rotor CAD render.
 * Dimensions are fitted estimates; this assembly only supplies geometry and visual transport.
 */
/* The tub is only a low lip: the hopper walls are the dye rotor's fence (photos show FUEL right down to the floor
 * through the clear fixed end). */
export function highTideRotor(parent: THREE.Object3D, x: number, y0: number, radius: number, top: number, black: THREE.Material, accent: THREE.Material) {
  const rotor = dyeRotor(parent, { x, y0, R: radius, wallH: .03, towerX: x, towerR: .09, towerTop: top, plate: black, accent, motors: 3, guide: false });
  rotor.tower.visible = false;
  const tower = new THREE.Group();
  tower.name = 'hightide-roller-throat';
  tower.position.set(x, y0, 0); parent.add(tower);
  const height = top - y0;
  // Open front throat and curved rear shrink-wrap guide, rather than a solid generic column.
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,height,32,1,true,Math.PI*.1,Math.PI*1.2), black);
  wrap.position.y = height/2; tower.add(wrap);
  for (const y of [.012,height]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.087,.112,32), accent);
    ring.rotation.x=-Math.PI/2; ring.position.y=y;
    (ring.material as THREE.MeshStandardMaterial).side=THREE.DoubleSide; tower.add(ring);
  }
  const rollers: THREE.Group[] = [];
  const urethane = mat(0x34383d,{rough:.8}), silver=mat(0xb6bec8,{metal:.8});
  for (const y of [height*.24,height*.53,height*.82]) {
    const axle = new THREE.Group(); axle.position.set(-.085,y,0); tower.add(axle);
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
    for (const z of [-.105,.105]) bar(tower,[-.085,0,z],[-.085,height,z],.012,black);
  }
  // The signature curved fin travels with the rotating floor and sweeps loose balls to the fixed throat.
  const fin = new THREE.Group(); fin.name='hightide-dolphin-fin'; rotor.floor.add(fin);
  const steps=16;
  for (let i=0;i<steps;i++) {
    const a=i/steps*Math.PI*.8, b=(i+1)/steps*Math.PI*.8;
    const r0=.13+(radius-.16)*i/steps, r1=.13+(radius-.16)*(i+1)/steps;
    const p=new THREE.Vector3(Math.cos(a)*r0,0,Math.sin(a)*r0),q=new THREE.Vector3(Math.cos(b)*r1,0,Math.sin(b)*r1);
    const h=.055+.055*Math.sin(i/steps*Math.PI);
    const segment=box(fin,p.distanceTo(q)+.003,h,.006,black,(p.x+q.x)/2,h/2,(p.z+q.z)/2);
    segment.rotation.y=-Math.atan2(q.z-p.z,q.x-p.x);
  }
  return {
    floor:rotor.floor,
    update(rate:number,dt:number) { spin(rotor.floor,rate,dt,'y'); for(const roller of rollers) spin(roller,-rate*4,dt,'z'); for(const roller of rotor.rollers) spin(roller,rate*4,dt,'y'); },
    feed(r:number) {
      const points=rotor.feed(r);
      // Bend through the open roller mouth before climbing the centre throat.
      points.splice(-2,2,new THREE.Vector3(x-.08,y0+r+.01,0),new THREE.Vector3(x,y0+height-r-.02,0));
      return points;
    },
  };
}
