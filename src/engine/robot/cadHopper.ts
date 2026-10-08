import * as THREE from 'three';
import { fillBlock } from './models';
import type { ModelKit } from './models';
import { hopperNetCeiling } from './config';

/** Imported assemblies omit fabric and deployed configurations. Fit these to the CAD frame. */
export function cadHopper(id: string, k: ModelKit, parts: {slider?:THREE.Object3D;lift?:THREE.Object3D;front?:THREE.Object3D}) {
  const limestone = id === 'limestone-1678', top = id === 'toploader-604';
  const group = new THREE.Group(); group.name = 'cad-hopper-fuel'; k.visual.add(group);
  const base = top ? .1524 : limestone ? .17 : .14;
  const back = top ? .23 : limestone ? .075 : .16;
  const width = top ? .67 : limestone ? .65 : .67;
  const front = top ? -.61 : limestone ? -.56 : -.64;
  const roof = top ? .69 : limestone ? .53 : .51;
  // A stretching net roof (581): FUEL can rise above the rigid roof into the net's dome.
  const e = k.config.hopperExpansion, netted = !limestone && !top && !!e && e.mechanism !== 'telescoping';
  const raised = limestone ? e?.fullHeight ?? .737 : netted ? e!.fullHeight : roof;
  const inside = (x: number, z: number) => !top || Math.hypot(x-.0254,z) > .09;
  // Allocate against the fully deployed cavity; the live roof must not discard the upper expansion's balls.
  let liveFront = front, liveRoof = raised;
  const pile = fillBlock(group, { x:(front+back)/2, y0:base, length:back-front, width, height:raised-base-.006, exactFloor:true, color:0xf2c200, capacity:k.config.hopperCapacity, inside,
    ceiling: limestone ? x => x < -.31 ? .51+(liveRoof-.51)*THREE.MathUtils.clamp((x-liveFront)/(-.31-liveFront),0,1) : liveRoof : top ? (x,z) => Math.hypot(x-.0254,z) < .23 ? .54 : liveRoof : netted ? hopperNetCeiling(k.config, roof) : undefined });
  const mesh = group.getObjectByName('hopper-fuel-pile')!;
  const extension = new THREE.Group(); extension.name = 'cad-hopper-extension'; k.visual.add(extension);
  const netGeometry = new THREE.BufferGeometry();
  const net = new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({color:0x24292b, transparent:true,opacity:.8}));
  net.name = 'cad-hopper-net';
  if (limestone) extension.add(net);
  let fraction = 0, horizontal = 0, vertical = 0;
  const settle = (a:number,b:number,dt:number) => dt > 0 ? THREE.MathUtils.lerp(a,b,1-Math.exp(-7*dt)) : b;
  const update = (fill:number,deployed:number,dt:number, hopperRaised = 0) => {
    fraction = THREE.MathUtils.clamp(fill,0,1);
    horizontal = deployed;
    const e=k.config.hopperExpansion;
    const lift = limestone && e ? hopperRaised : 0;
    vertical=settle(vertical,lift,dt);
    liveFront = THREE.MathUtils.lerp(top ? -.35 : -.31, front, horizontal);
    liveRoof = netted ? raised : THREE.MathUtils.lerp(roof, raised, vertical);
    mesh.userData.resizeFuelBin({x:(liveFront+back)/2,length:back-liveFront,height:liveRoof-base-.006});
    pile.set(fraction);
    if(!limestone)return;
    const xf=THREE.MathUtils.lerp(-.31,front,horizontal), y=THREE.MathUtils.lerp(roof,raised,vertical);
    // The upper posts, nested side rails and folded hopper panels are from the supplied GLB.
    if(parts.lift) parts.lift.position.y=y-roof;
    // The vertical roof remains inside the chassis; only the intake-end wall translates.
    if(parts.front) parts.front.position.x=xf+.31;
    const vertices:number[]=[];
    const segment=(a:number[],b:number[])=>vertices.push(...a,...b);
    const bodyFront=-.31;
    for(let i=0;i<=20;i++) {
      const t=i/20,x=bodyFront+(back-bodyFront)*t,z=(t-.5)*width;
      segment([x,y,-width/2],[x,y,width/2]); segment([bodyFront,y,z],[back,y,z]);
      for(const side of [-1,1]) segment([x,roof-.015,side*width/2],[x,y,side*width/2]);
      // Front retention net slopes down to the horizontally extended CAD intake lip.
      const bx=xf+(bodyFront-xf)*t,by=.51+(y-.51)*t;
      segment([bx,by,-width/2],[bx,by,width/2]);
      segment([xf,.51,z],[bodyFront,y,z]);
    }
    for(let i=0;i<=8;i++) {
      const h=roof+(y-roof)*i/8;
      for(const z of [-width/2,width/2]) segment([bodyFront,h,z],[back,h,z]);
    }
    netGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); netGeometry.computeBoundingSphere();
  };
  return { update, stow: () => {
    const f=horizontal>.5 ? front : -.31;
    let x:number,z:number;
    do {x=f+.08+Math.random()*Math.max(.01,back-f-.16);z=(Math.random()-.5)*(width-.16);} while(!inside(x,z));
    const y=roof+(raised-roof)*vertical;
    const ceiling=limestone && x<-.31 ? .51+(y-.51)*THREE.MathUtils.clamp((x-front)/(-.31-front),0,1) : y;
    return new THREE.Vector3(x,base+.075+fraction*(ceiling-base-.15),z);
  }};
}
