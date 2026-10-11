import * as THREE from 'three';

/** Original lightweight plate silhouette from Orbit's public 2026 CAD release.
 * Triangular cutouts are geometry, so the stored balls remain visible through the openings.
 */
export function keplerPanel(parent: THREE.Object3D, width: number, height: number, material: THREE.Material, x: number, y: number, z: number, yaw = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-width/2,0); shape.lineTo(width/2,0); shape.lineTo(width/2,height); shape.lineTo(-width/2,height); shape.closePath();
  const cells = Math.max(2,Math.round(width/.28)), pitch=width/cells;
  const lower=Math.min(.075,height*.3), upper=height-.016, pad=.014;
  for(let i=0;i<cells;i++) {
    const left=-width/2+i*pitch+pad,right=left+pitch-2*pad,mid=(left+right)/2,cy=(lower+upper)/2;
    if(right-left<.035 || upper-lower<.045)continue;
    for(const points of [
      [[left,lower],[right,lower],[mid,cy-pad]],
      [[left,upper],[mid,cy+pad],[right,upper]],
      [[left,lower+pad],[left,upper-pad],[mid-pad,cy]],
      [[right,lower+pad],[mid+pad,cy],[right,upper-pad]],
    ]) {
      const hole=new THREE.Path(); hole.moveTo(points[0][0],points[0][1]);
      for(const point of points.slice(1))hole.lineTo(point[0],point[1]);
      hole.closePath(); shape.holes.push(hole);
    }
  }
  const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.004,bevelEnabled:false}),material);
  panel.name='kepler-pocketed-panel'; panel.position.set(x,y,z); panel.rotation.y=yaw;
  parent.add(panel); return panel;
}

/** Horizontal pocketed bridge follows the curved turret clearance in Orbit's CAD release. */
export function keplerBridge(parent:THREE.Object3D,L:number,W:number,y:number,tx:number,tz:number,material:THREE.Material) {
  const hx=L*.46,hz=W*.46,r=.245;
  const start=Math.atan2(-Math.sqrt(r*r-(hx-tx)**2),hx-tx);
  const end=Math.atan2(hz-tz,-Math.sqrt(r*r-(hz-tz)**2))-Math.PI*2;
  const outline=new THREE.Shape();outline.moveTo(-hx,-hz);outline.lineTo(hx,-hz);
  outline.lineTo(tx+Math.cos(start)*r,tz+Math.sin(start)*r);
  outline.absarc(tx,tz,r,start,end,true);outline.lineTo(-hx,hz);outline.closePath();
  // Wide trapezoidal windows leave a narrow perimeter and cross braces, as in the released bridge.
  // Every vertex is tested against the crescent so no pocket cuts across the turret opening.
  const windowBounds:number[][]=[];
  const pitchX=(hx*2-.036)/4,pitchZ=(hz*2-.036)/3;
  for(let i=0;i<4;i++)for(let j=0;j<3;j++) {
    const x=-hx+.018+i*pitchX,z=-hz+.018+j*pitchZ;
    const points=[[x+.006,z+.006],[x+pitchX-.014,z+.012],[x+pitchX-.020,z+pitchZ-.016],[x+.012,z+pitchZ-.014]];
    if(points.some(p=>Math.hypot(p[0]-tx,p[1]-tz)<r+.012))continue;
    windowBounds.push([x+.006,x+pitchX-.014,z+.006,z+pitchZ-.014]);
    const hole=new THREE.Path(points.map(p=>new THREE.Vector2(p[0],p[1])));hole.closePath();outline.holes.push(hole);
  }
  // Curved trapezoidal pockets keep the crescent light instead of leaving a solid slab beside the shooter.
  for(let j=0;j<6;j++) {
    const a=Math.PI+j*Math.PI/12+.025,b=a+Math.PI/12-.05;
    const points=[[a,r+.014],[b,r+.014],[b,r+.064],[a,r+.064]].map(([angle,radius])=>[tx+Math.cos(angle)*radius,tz+Math.sin(angle)*radius]);
    if(points.some(p=>p[0]<-hx+.014||p[0]>hx-.014||p[1]<-hz+.014||p[1]>hz-.014))continue;
    const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
    if(windowBounds.some(([ax,bx,az,bz])=>maxX>ax-.008&&minX<bx+.008&&maxZ>az-.008&&minZ<bz+.008))continue;
    // Existing rectangular windows occupy the farther edge; leave a web between them and these inner pockets.
    const hole=new THREE.Path(points.map(p=>new THREE.Vector2(p[0],p[1])));hole.closePath();outline.holes.push(hole);
  }
  const geo=new THREE.ExtrudeGeometry(outline,{depth:.006,bevelEnabled:false,curveSegments:24});
  const mesh=new THREE.Mesh(geo,material);mesh.name='kepler-curved-bridge';mesh.rotation.x=Math.PI/2;mesh.position.y=y;parent.add(mesh);
}
