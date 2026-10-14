import {expect,it,vi} from 'vitest';
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

it('reuses a seat after scoring at a different angle and ignores distant CAD',()=>{
 const tool=new THREE.Group(),anchor=new THREE.Object3D();tool.add(anchor);
 const plate=new THREE.Mesh(new THREE.BoxGeometry(.008,.3,.2));plate.position.x=.05;tool.add(plate);
 const distant=new THREE.Mesh(new THREE.BoxGeometry(1,1,1,20,20,20));distant.position.x=10;tool.add(distant);
 distant.geometry.computeBoundingBox();
 const read=vi.spyOn(distant.geometry.getAttribute('position'),'getX');
 const coral=new THREE.Mesh(coralGeometry());coral.userData.heldGamePiece=true;anchor.add(coral);
 const dispose=vi.spyOn(THREE.BufferGeometry.prototype,'dispose');
 tool.updateMatrixWorld(true);fitCoralInTool(coral,anchor);
 const seat=coral.position.clone();expect(dispose).toHaveBeenCalled();
 // A changing pose waits until settled, then calibrates the new angle.
 coral.position.set(0,0,0);coral.rotation.z=.5;fitCoralInTool(coral,anchor);
 coral.position.set(0,0,0);fitCoralInTool(coral,anchor);
 const searches=dispose.mock.calls.length;
 coral.position.set(0,0,0);coral.rotation.z=0;fitCoralInTool(coral,anchor);
 coral.position.set(0,0,0);fitCoralInTool(coral,anchor);
 expect(coral.position.distanceTo(seat)).toBeLessThan(1e-8);
 expect(dispose.mock.calls.length).toBe(searches);expect(read).not.toHaveBeenCalled();
 dispose.mockRestore();read.mockRestore();
});
