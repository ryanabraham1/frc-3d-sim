import * as THREE from 'three';

/** Fixed mechanism envelopes in robot coordinates. Radius is the hardware, without the ball margin. */
export interface FuelKeepout { x: number; z: number; radius: number; radiusTop?:number; bottom: number; top: number }
export function clearFuelKeepouts(p: THREE.Vector3, radius: number, envelopes: readonly FuelKeepout[], bounds?: {min:THREE.Vector3;max:THREE.Vector3}): boolean {
  let changed = false;
  for (const e of envelopes) {
    if (p.y + radius <= e.bottom || p.y - radius >= e.top) continue;
    const dx = p.x-e.x, dz = p.z-e.z, distance = Math.hypot(dx,dz), hardwareRadius=e.radiusTop===undefined?e.radius:THREE.MathUtils.lerp(e.radius,e.radiusTop,THREE.MathUtils.clamp((p.y-e.bottom)/(e.top-e.bottom),0,1)), limit = hardwareRadius+radius;
    if (distance >= limit) continue;
    // Move toward the closest free side; the exact centre consistently uses the intake side.
    p.x = e.x+(distance > 1e-6 ? dx/distance : -1)*limit;
    p.z = e.z+(distance > 1e-6 ? dz/distance : 0)*limit;
    if (bounds && (p.x<bounds.min.x+radius || p.x>bounds.max.x-radius || p.z<bounds.min.z+radius || p.z>bounds.max.z-radius)) {
      let best=Infinity,bx=p.x,bz=p.z;
      for(let j=0;j<32;j++) {
        const a=j*Math.PI/16,x=e.x+Math.cos(a)*limit,z=e.z+Math.sin(a)*limit;
        if(x<bounds.min.x+radius || x>bounds.max.x-radius || z<bounds.min.z+radius || z>bounds.max.z-radius)continue;
        const score=(x-e.x-dx)**2+(z-e.z-dz)**2;
        if(score<best){best=score;bx=x;bz=z;}
      }
      p.x=bx;p.z=bz;
    }
    changed = true;
  }
  return changed;
}

export interface HopperChamfer {hx:number;hz:number;cut:number;fixedSide:number}
/** Clip the two fixed hopper corners; the intake-side extension stays free to slide outward. */
export function clearHopperChamfer(p:THREE.Vector3,r:number,c?:HopperChamfer):boolean {
  if(!c)return false;
  const limit=c.hx+c.hz-c.cut-r*Math.SQRT2,dist=c.fixedSide*p.x+Math.abs(p.z)-limit;
  if(dist<=0)return false;
  p.x-=c.fixedSide*dist/2;p.z-=(p.z<0?-1:1)*dist/2;return true;
}


/** Project a whole sphere inside a convex hopper outline, including curved walls sampled from CAD. */
export function clearFuelOutline(p:THREE.Vector3,r:number,points?:readonly [number,number][]):boolean {
  if(!points?.length)return false;
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}
  const sign=area>0?1:-1;let changed=false;
  for(let pass=0;pass<3;pass++)for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    if(length<1e-8)continue;
    const nx=-dz/length*sign,nz=dx/length*sign,d=(p.x-a[0])*nx+(p.z-a[1])*nz;
    if(d>=r)continue;p.x+=nx*(r-d);p.z+=nz*(r-d);changed=true;
  }
  return changed;
}
