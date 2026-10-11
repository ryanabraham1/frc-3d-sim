import * as THREE from 'three';

/** Fixed mechanism envelopes in robot coordinates. Radius is the hardware, without the ball margin. */
export interface FuelKeepout { x: number; z: number; radius: number; bottom: number; top: number }
export function clearFuelKeepouts(p: THREE.Vector3, radius: number, envelopes: readonly FuelKeepout[], bounds?: {min:THREE.Vector3;max:THREE.Vector3}): boolean {
  let changed = false;
  for (const e of envelopes) {
    if (p.y + radius <= e.bottom || p.y - radius >= e.top) continue;
    const dx = p.x-e.x, dz = p.z-e.z, distance = Math.hypot(dx,dz), limit = e.radius+radius;
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
