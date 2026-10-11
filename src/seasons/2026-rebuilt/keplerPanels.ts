import * as THREE from 'three';

/** Original lightweight plate silhouette from Orbit's public 2026 CAD release.
 * Triangular cutouts are geometry, so the stored balls remain visible through the openings.
 */
export function keplerPanel(parent: THREE.Object3D, width: number, height: number, material: THREE.Material, x: number, y: number, z: number, yaw = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-width/2,0); shape.lineTo(width/2,0); shape.lineTo(width/2,height); shape.lineTo(-width/2,height); shape.closePath();
  const cells = Math.max(2,Math.round(width/.15)), pitch=width/cells;
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
  const pitch=.125;
  for(let x=-hx+.018;x+pitch<hx-.014;x+=pitch)for(let z=-hz+.018;z+pitch<hz-.014;z+=pitch) {
    const triangles=[[[x,z],[x+pitch-.012,z],[x+pitch*.5,z+pitch*.43]],[[x,z+pitch-.012],[x+pitch*.5,z+pitch*.55],[x+pitch-.012,z+pitch-.012]]];
    for(const points of triangles) {
      if(points.some(p=>Math.hypot(p[0]-tx,p[1]-tz)<r+.018))continue;
      const hole=new THREE.Path(points.map(p=>new THREE.Vector2(p[0],p[1])));hole.closePath();outline.holes.push(hole);
    }
  }
  const geo=new THREE.ExtrudeGeometry(outline,{depth:.006,bevelEnabled:false,curveSegments:24});
  const mesh=new THREE.Mesh(geo,material);mesh.name='kepler-curved-bridge';mesh.rotation.x=Math.PI/2;mesh.position.y=y;parent.add(mesh);
}
