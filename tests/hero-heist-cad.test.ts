import {describe,expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {getBounds} from '@gltf-transform/functions';
import * as THREE from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import manifest from '../src/seasons/wcp-hero-heist/cad-manifest.json';

describe('Hero Heist supplied CAD preparation',()=>{
  it('records and removes the actual starting pieces with the correct per-color distribution',()=>{
    for(const color of ['red','blue'])for(const kind of ['bubble','panel'])expect(manifest.staged.filter(p=>p.color===color&&p.kind===kind)).toHaveLength(kind==='bubble'?15:5);
    expect(manifest.parts.filter(p=>p.name==='square_goal_light')).toHaveLength(80);
    expect(manifest.parts.filter(p=>p.name==='v2_vertical_pannel_basket')).toHaveLength(8);
    expect(manifest.source.field.sha256).toBe('0dc5c2150573ed3a7d13a42d265202b6317b5f71d47f2342729aa49dfd6a6894');
    expect(manifest.outputStats.primitives).toBeLessThan(250);
  });
  it('centers each supplied piece in the collision frame and preserves the panel knob',async()=>{
    const io=new NodeIO();
    const bubble=await io.read('public/assets/hero-heist/bubble.glb');
    const b=getBounds(bubble.getRoot().listScenes()[0]);
    expect((b.min[0]+b.max[0])/2).toBeCloseTo(0,5);expect((b.min[1]+b.max[1])/2).toBeCloseTo(0,5);
    expect(b.max[0]-b.min[0]).toBeCloseTo(.1778,4);
    const panel=await io.read('public/assets/hero-heist/panel.glb');
    const p=getBounds(panel.getRoot().listScenes()[0]);
    expect((p.min[0]+p.max[0])/2).toBeCloseTo(0,5);expect((p.min[2]+p.max[2])/2).toBeCloseTo(0,5);
    expect(p.min[1]).toBeCloseTo(-.00635,5);expect(p.max[1]).toBeCloseTo(.05715,5);
    expect(p.max[0]-p.min[0]).toBeCloseTo(.60953,4);
  });
  it('retains real scoring cutouts while blocking the wall beside them',()=>{
    const colliders=JSON.parse(readFileSync('src/seasons/wcp-hero-heist/cad-colliders.json','utf8')) as {vertices:number[];indices:number[]}[];
    const meshes=colliders.map(c=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(c.vertices,3));g.setIndex(c.indices);g.boundsTree=new MeshBVH(g);const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.raycast=acceleratedRaycast;return m;});
    const ray=new THREE.Raycaster();ray.far=6;
    const hits=(x:number,h:number,zDirection:number)=>{ray.set(new THREE.Vector3(x,h,0),new THREE.Vector3(0,0,zDirection));return ray.intersectObjects(meshes).length;};
    expect(hits(-3.048,1.7,-1)).toBe(0); // Actual Uptown city-block passage.
    expect(hits(-2.6,1.7,-1)).toBeGreaterThan(0); // Solid wall next to it.
    expect(hits(-3.048,.65,1)).toBe(0); // Actual Downtown city-block passage.
    expect(hits(-2.6,.65,1)).toBeGreaterThan(0);
    for(const mesh of meshes){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
  });
  it('ships each prepared asset for reproducible local inspection',()=>{
    for(const name of ['field','bubble','panel'])expect(existsSync(`public/assets/hero-heist/${name}.glb`)).toBe(true);
  });
});
