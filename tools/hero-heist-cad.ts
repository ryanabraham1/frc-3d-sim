import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene=new THREE.Scene();scene.background=new THREE.Color(0x182230);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xdcecff,0x696350,2));
const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(5,12,8);scene.add(sun);
const status=document.querySelector<HTMLElement>('#status')!;
const select=document.querySelector<HTMLSelectElement>('#asset')!;
let asset:THREE.Group|null=null, generation=0;
const views:Record<string,[number[],number[]]>={overview:[[13,13,15],[0,.7,0]],overhead:[[0,23,.001],[0,0,0]],uptown:[[0,4,-.2],[0,1.5,-4.1]],downtown:[[0,3,0],[0,1,4.1]],foothills:[[-5,3,-.8],[-7.4,1.7,-3.5]],tower:[[-2,3,3],[-4.1148,1.5,0]],station:[[-4.5,2,1],[-6, .7,4.3]]};
function view(id:string){const [eye,target]=views[id]??views.overview;camera.position.set(eye[0],eye[1],eye[2]);controls.target.set(target[0],target[1],target[2]);controls.update();}
async function load(){
  status.textContent='Loading prepared CAD…';const start=performance.now(),gen=++generation,name=select.value;
  const gltf=await new GLTFLoader().loadAsync(`/assets/hero-heist/${name}.glb`);
  const dispose=(root:THREE.Group)=>{const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();root.traverse(n=>{if(n instanceof THREE.Mesh){geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());};
  if(gen!==generation){dispose(gltf.scene);return;}
  if(asset){scene.remove(asset);dispose(asset);}asset=gltf.scene;scene.add(asset);
  if(name==='field')view('overview');else {camera.position.set(.9,.7,1);controls.target.set(0,0,0);controls.update();}
  renderer.render(scene,camera);
  const b=new THREE.Box3().setFromObject(asset),s=b.getSize(new THREE.Vector3());
  status.textContent=`Prepared ${name}: ${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)} m · ${renderer.info.render.calls} draw calls · loaded ${(performance.now()-start).toFixed(0)} ms. Drag to orbit, scroll to zoom. Staged pieces are removed from field CAD.`;
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view!));select.onchange=()=>void load();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
void load().catch(error=>{status.textContent=String(error);});
/** Inspection hook: `cad.look([eye],[target])` places the camera in Three world coordinates. */
Object.assign(window,{cad:{camera,controls,look(eye:number[],target:number[]){camera.position.set(eye[0],eye[1],eye[2]);controls.target.set(target[0],target[1],target[2]);controls.update();}}});
