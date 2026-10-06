import {expect,it} from 'vitest';
import * as THREE from 'three';
import {coralGeometry} from '../src/seasons/2025-reefscape/field';
import {fitCoralInTool} from '../src/seasons/2025-reefscape/coralVisual';
it('seats rigid CORAL clear of a tool plate without changing the tube shape',()=>{
 const mouth=new THREE.Group(),anchor=new THREE.Object3D();mouth.add(anchor);
 const plate=new THREE.Mesh(new THREE.BoxGeometry(.008,.3,.2));plate.position.x=.05;mouth.add(plate);
 const coral=new THREE.Mesh(coralGeometry());coral.userData.heldGamePiece=true;anchor.add(coral);
 const before=coral.geometry.getAttribute('position').array.slice();mouth.updateMatrixWorld(true);
 fitCoralInTool(coral,anchor);expect(coral.position.x).toBeLessThan(-.005);expect(coral.position.length()).toBeLessThanOrEqual(.04001);
 expect(coral.geometry.getAttribute('position').array).toEqual(before);expect(coral.scale.toArray()).toEqual([1,1,1]);
 const seat=coral.position.clone();coral.position.set(0,0,0);fitCoralInTool(coral,anchor);expect(coral.position.distanceTo(seat)).toBeLessThan(1e-8);
});
it('permits a support rod inside the hollow CORAL bore',()=>{
 const mouth=new THREE.Group(),anchor=new THREE.Object3D();mouth.add(anchor);
 mouth.add(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.2,16)));
 const coral=new THREE.Mesh(coralGeometry());coral.userData.heldGamePiece=true;anchor.add(coral);mouth.updateMatrixWorld(true);
 fitCoralInTool(coral,anchor);expect(coral.position.length()).toBe(0);
});
