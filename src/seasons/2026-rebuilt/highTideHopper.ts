import * as THREE from 'three';
import { bar, box, lattice } from '@engine/robot/models';
import { pocketPlate } from './teamShooterDetail';

/** Fitted from HighTide's Robot CAD render: two clipped corners at the fixed teal end, straight sliding intake end. */
export function highTideHopper(parent:THREE.Object3D,L:number,W:number,bottom:number,top:number,side:number,smoke:THREE.Material,teal:THREE.Material,black:THREE.Material) {
  const hx=L*.485,hz=W*.485,cut=.065;
  const points:[number,number][]=[[-hx,-hz],[hx-cut,-hz],[hx,-hz+cut],[hx,hz-cut],[hx-cut,hz],[-hx,hz]];
  if(side>0)for(const p of points)p[0]*=-1;
  const root=new THREE.Group();root.name='hightide-chamfered-hopper';root.userData.fuelStructure=true;parent.add(root);
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const edge=new THREE.Group();edge.position.set((a[0]+b[0])/2,bottom,(a[1]+b[1])/2);edge.rotation.y=-Math.atan2(dz,dx);root.add(edge);
    box(edge,length,top-bottom,.005,smoke,0,(top-bottom)/2,0);
    const h=top-bottom;
    // Teal pocketed rail at the fixed end, black carbon rails beside the sliding intake.
    const fixed=(a[0]+b[0])/2*side<0;
    lattice(edge,[-length/2,h-.025,0],[length,0,0],[0,.025,0],{cells:Math.max(1,Math.round(length/.075)),w:.009,m:fixed?teal:black,zig:true});
    bar(root,[a[0],bottom,a[1]],[a[0],top,a[1]],.015,fixed?teal:black);
    if(fixed) {
      for(const sign of [-1,1]) {
        const strip=new THREE.Group();strip.position.x=sign*(length/2-.022);edge.add(strip);
        const holes:[number,number][][]=[];
        for(let j=0;j<5;j++){const y=.025+j*(h-.05)/5;holes.push([[-.013,y],[.013,y],[0,y+(h-.05)/5-.012]]);}
        pocketPlate(strip,[[-.023,0],[.023,0],[.023,h],[-.023,h]],holes,teal,0);
      }
    }
  }
  return {hx,hz,cut,fixedSide:-side,inside:(x:number,z:number)=>-side*x+Math.abs(z)<=hx+hz-cut-.075*Math.SQRT2};
}
