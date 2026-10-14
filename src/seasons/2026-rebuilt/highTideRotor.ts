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
  for (const y of [height*.45,height*.66,height*.87]) {
    // Inside the column, so FUEL circling the rotor passes outside them.
    const axle = new THREE.Group(); axle.position.set(-.06,y,0); tower.add(axle);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.09,8),silver);
    shaft.rotation.x=Math.PI/2; axle.add(shaft);
    // Spaced compliant wheel treads make shaft rotation visible without individual rigid bodies.
    for (const z of [-.032,0,.032]) {
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
  box(tower,.012,height-.005,.11,black,-.108,(height+.005)/2,0).name='hightide-lift-gearbox';
  // The signature curved fin turns with the floor: one full turn of low spiral rib from the rim to the throat. Turning
  // the right way it works as a screw, walking every ball on the plate inward to the lift wheels at the centre (the
  // physical hopper models that as the plate's driven surface: mechHopper `rotor`). [EST: rib height, pitch, full turn]
  const fin = new THREE.Group(); fin.name='hightide-dolphin-fin'; rotor.floor.add(fin);
  const steps=48;
  for (let i=0;i<steps;i++) {
    const a=i/steps*Math.PI*2, b=(i+1)/steps*Math.PI*2;
    // The spiral runs right into the throat at the centre, so it hands each ball to the lift wheels.
    const r0=.02+(radius-.015)*i/steps, r1=.02+(radius-.015)*(i+1)/steps;
    const p=new THREE.Vector3(Math.cos(a)*r0,0,Math.sin(a)*r0),q=new THREE.Vector3(Math.cos(b)*r1,0,Math.sin(b)*r1);
    const h=.008;
    const segment=box(fin,p.distanceTo(q)+.003,h,.006,black,(p.x+q.x)/2,h/2,(p.z+q.z)/2);
    segment.rotation.y=-Math.atan2(q.z-p.z,q.x-p.x);
  }
  return {
    floor:rotor.floor,
    /** The open throat column (origin on its axis, at the rotor floor) and its lift wheels on the open side. */
    tower, lift: rollers, height, fin, radius,
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
