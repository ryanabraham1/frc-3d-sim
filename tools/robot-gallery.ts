import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SEASONS } from '../src/seasons';
import { PhysicsWorld, loadRapier } from '../src/engine/physics/world';
import { Robot, IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { FieldFrame } from '../src/engine/coords';
import { setRobotEnvironment } from '../src/engine/robot/models';
const R = await loadRapier();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';
document.body.append(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
setRobotEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
pmrem.dispose();
const seasonSelect = document.querySelector<HTMLSelectElement>('#season')!;
for (const s of SEASONS) seasonSelect.add(new Option(`${s.year} ${s.name}`, s.id));
const pose = document.querySelector<HTMLSelectElement>('#pose')!;
let reverse = false;
let red = false;
let focus = -1;
let items: { scene: THREE.Scene; robot: Robot; physics: PhysicsWorld; el: HTMLElement; camera: THREE.PerspectiveCamera }[] = [];
function build() {
  for (const i of items) { i.physics.world.free(); i.scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
  items = [];
  focus = -1;
  const grid = document.querySelector('#grid')!;
  grid.innerHTML = '';
  const s = SEASONS.find(s => s.id === seasonSelect.value)!;
  const configs = [...(s.teamRobots ?? []).map(t => ({ name: `${t.team} · ${t.name}`, config: t.config }))];
  for (const [index, entry] of configs.entries()) {
    const el = document.createElement('div'); el.className = 'card';
    const label = document.createElement('div'); label.className = 'label'; label.textContent = entry.name;
    el.append(label); grid.append(el);
    el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', entry.name);
    el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); } };
    el.onclick = () => { focus = focus === index ? -1 : index; items.forEach((i, n) => { i.el.style.display = focus < 0 || focus === n ? '' : 'none'; i.el.classList.toggle('focus', focus === n); }); };
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe4e6ee);
    scene.add(new THREE.HemisphereLight(0xe7efff, 0x7a7468, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(2, 5, 3); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.MeshStandardMaterial({color:0xd7dbe3,roughness:0.95})); floor.rotation.x = -Math.PI/2; floor.position.y=-0.006; scene.add(floor);
    const physics = new PhysicsWorld(R);
    const robot = new Robot(physics, scene, new FieldFrame(0,0), cloneConfig(entry.config), red ? 'red' : 'blue', index, 1, {x:0,y:0,yaw:0});
    s.configureRobot?.(robot);
    const camera = new THREE.PerspectiveCamera(35,1,0.01,40);
    items.push({scene,robot,physics,el,camera});
  }
}
seasonSelect.onchange = build;
document.querySelector<HTMLButtonElement>('#view')!.onclick = () => { reverse = !reverse; };
document.querySelector<HTMLButtonElement>('#alliance')!.onclick = () => { red = !red; build(); };
build();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now-last)/1000,0.05); last=now;
  renderer.setSize(innerWidth,innerHeight,false);
  for (const i of items) {
    const rect=i.el.getBoundingClientRect(); if(rect.bottom<0||rect.top>innerHeight||!rect.width) continue;
    const r=i.robot; r.enabled=pose.value !== 'idle';
    r.climbPhase=pose.value==='climb'?'align':'none';
    r.lastCommand={...IDLE_COMMAND,intake:pose.value==='intake',pass:pose.value==='score'};
    r.placeAnim = {height:pose.value==='score'?1.75:0.45,forward:pose.value==='score'?0.7:0.3,level:pose.value==='score'?4:r.config.placement?.maxLevel ?? 1};
    r.held.length=pose.value==='loaded'?Math.round(r.config.hopperCapacity*0.6):0;
    r.syncVisual(dt);
    // Gallery uses the exact built model, animated through Robot; climb preview is driven by its replicated state.
    const scale=Math.max(1.15,r.config.height+0.3,pose.value==='score' && r.config.placement?.enabled ? 2.2 : 0);
    i.camera.position.set((reverse?-1:1)*scale*1.8,scale*1.4,(reverse?-1:1)*scale*2);
    i.camera.lookAt(0,scale*0.4,0); i.camera.aspect=rect.width/rect.height; i.camera.updateProjectionMatrix();
    renderer.setViewport(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
    renderer.setScissor(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
    renderer.render(i.scene,i.camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
