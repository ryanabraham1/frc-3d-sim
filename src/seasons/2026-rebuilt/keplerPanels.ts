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
