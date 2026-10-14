import * as THREE from 'three';
import {cloneCadPart} from '@engine/robot/cadModels';

/** Independently riggable sections extracted from Ryan's supplied image-generated GLBs. */
export function suppliedRobotPart(robot:'hightide'|'kepler',name:string,material:THREE.Material) {
  const part=cloneCadPart(`${robot}-supplied-parts`,name);
  if(!part)return undefined;
  part.name=`${robot}-supplied-${name}`;
  part.userData.suppliedGeometry=true;
  part.userData.fuelStructure=true;
  part.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    o.material=material;
    o.geometry.computeVertexNormals();
    o.castShadow=true;o.receiveShadow=true;
  });
  return part;
}
