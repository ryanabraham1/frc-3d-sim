import * as THREE from 'three';

/** Separate connected roller surfaces in a merged CAD mesh around measured parallel Z shafts.
 * Shared vertex buffers stay shared. Only index lists and transforms are created, once at model construction.
 */
export function articulateRollers(root: THREE.Object3D, source: THREE.Object3D | undefined, axes: readonly (readonly [number, number])[]): THREE.Group[] {
  if (!source) return [];
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const pivots = axes.map(([x,y],i) => {
    const pivot=new THREE.Group(); pivot.name=`cad-feeder-shaft-${i}`;
    pivot.position.set(x,y,0); root.add(pivot); return pivot;
  });
  const meshes:THREE.Mesh[]=[];
  source.traverse(o=>{if(o instanceof THREE.Mesh && o.geometry.index)meshes.push(o);});
  for(const mesh of meshes) {
    const geometry=mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));
    const position=geometry.getAttribute('position'), indices=geometry.index!;
    const parents=new Int32Array(position.count);
    for(let i=0;i<parents.length;i++)parents[i]=i;
    const find=(value:number):number=>{
      while(parents[value]!==value){parents[value]=parents[parents[value]];value=parents[value];}
      return value;
    };
    for(let i=0;i<indices.count;i+=3) {
      const a=find(indices.getX(i));
      parents[find(indices.getX(i+1))]=a; parents[find(indices.getX(i+2))]=a;
    }
    const components=new Map<number,THREE.Box3>(),point=new THREE.Vector3();
    for(let i=0;i<position.count;i++) {
      const id=find(i);let bounds=components.get(id);
      if(!bounds){bounds=new THREE.Box3();components.set(id,bounds);}
      bounds.expandByPoint(point.fromBufferAttribute(position,i));
    }
    const destinations=new Map<number,number>(),center=new THREE.Vector3(),size=new THREE.Vector3();
    for(const [id,bounds] of components) {
      bounds.getCenter(center);bounds.getSize(size);
      let best=-1,distance=.035**2;
      // Large connected frame surfaces stay fixed. Do not rotate brackets with a neighbouring shaft.
      if(size.x<.11 && size.y<.11)for(let i=0;i<axes.length;i++) {
        const d=(center.x-axes[i][0])**2+(center.y-axes[i][1])**2;
        if(d<distance){best=i;distance=d;}
      }
      destinations.set(id,best);
    }
    const buckets=new Map<string,{destination:number;material:number;indices:number[]}>();
    for(let i=0;i<indices.count;i+=3) {
      const destination=destinations.get(find(indices.getX(i))) ?? -1;
      const material=geometry.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex ?? 0;
      const key=`${destination}:${material}`;
      let bucket=buckets.get(key);if(!bucket){bucket={destination,material,indices:[]};buckets.set(key,bucket);}
      bucket.indices.push(indices.getX(i),indices.getX(i+1),indices.getX(i+2));
    }
    for(const {destination,material,indices:subset} of buckets.values()) {
      const part=new THREE.BufferGeometry();
      for(const [name,attribute] of Object.entries(geometry.attributes))part.setAttribute(name,attribute);
      part.setIndex(subset);part.computeBoundingSphere();
      const surface=new THREE.Mesh(part,Array.isArray(mesh.material)?mesh.material[material]:mesh.material);surface.name='cad-feeder-roller-surface';
      surface.castShadow=mesh.castShadow;surface.receiveShadow=mesh.receiveShadow;
      if(destination<0)root.add(surface);
      else {surface.position.copy(pivots[destination].position).negate();pivots[destination].add(surface);}
    }
    mesh.visible=false;
  }
  return pivots.filter(pivot=>pivot.children.length>0);
}
