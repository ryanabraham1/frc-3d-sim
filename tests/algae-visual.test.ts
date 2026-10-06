import { expect,it } from 'vitest';
import * as THREE from 'three';
import { animateAlgaeGrip } from '../src/seasons/2025-reefscape/algaeVisual';

it('fits a held ball against a rigid mouth without shrinking its free side',()=>{
  const mouth=new THREE.Group(),anchor=new THREE.Object3D();mouth.add(anchor);
  const plate=new THREE.Mesh(new THREE.BoxGeometry(.03,.5,.5),new THREE.MeshBasicMaterial());plate.position.x=.12;mouth.add(plate);
  const ball=new THREE.Mesh(new THREE.SphereGeometry(.206,24,16),new THREE.MeshBasicMaterial());anchor.add(ball);
  for(let i=0;i<40;i++)animateAlgaeGrip(ball,true,[1,1,1],.03);
  ball.geometry.computeBoundingBox();
  expect(ball.geometry.boundingBox!.max.x).toBeLessThan(.105);
  expect(ball.geometry.boundingBox!.min.x).toBeCloseTo(-.206,3);
  // The same local deformation remains valid as the whole arm turns.
  mouth.rotation.z=1.1;mouth.position.y=1.5;
  animateAlgaeGrip(ball,true,[1,1,1],.03);
  expect(ball.geometry.boundingBox!.max.x).toBeLessThan(.105);
  const replacement=new THREE.Group(),newAnchor=new THREE.Object3D();replacement.add(newAnchor);
  const opposite=plate.clone();opposite.position.x=-.12;replacement.add(opposite);newAnchor.add(ball);
  animateAlgaeGrip(ball,true,[1,1,1],.03);ball.geometry.computeBoundingBox();
  expect(ball.geometry.boundingBox!.max.x).toBeCloseTo(.206,3);
  expect(ball.geometry.boundingBox!.min.x).toBeGreaterThan(-.105);
});

it('pinches only the lower throat and leaves the shared field ball untouched',()=>{
  const source=new THREE.SphereGeometry(.206,24,16),ball=new THREE.Mesh(source,new THREE.MeshBasicMaterial());
  const before=Array.from(source.getAttribute('position').array);
  for(let i=0;i<40;i++)animateAlgaeGrip(ball,true,[1,1,1],.03,true);
  const original=source.getAttribute('position'),held=ball.geometry.getAttribute('position');
  for(let i=0;i<original.count;i++){
    if(original.getY(i)>=0)expect(held.getX(i)).toBe(original.getX(i));
    if(original.getY(i)<-.1 && Math.abs(original.getX(i))>.05)expect(Math.abs(held.getX(i))).toBeLessThan(Math.abs(original.getX(i)));
  }
  expect(Array.from(source.getAttribute('position').array)).toEqual(before);
});
