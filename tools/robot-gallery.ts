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
// Focused view: drag to orbit, wheel to zoom.
let orbit = 0, tiltView = 0.55, zoom = 0.6, dragging = false;
addEventListener('pointerdown', e => { if (focus >= 0 && (e.target as HTMLElement).closest('.card')) dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', e => { if (!dragging) return; orbit -= e.movementX * 0.01; tiltView = THREE.MathUtils.clamp(tiltView + e.movementY * 0.01, 0.05, 1.45); });
(window as unknown as { view(o: number, t: number, z: number): void }).view = (o, t, z) => { orbit = o; tiltView = t; zoom = z; };
addEventListener('wheel', e => { if (focus < 0) return; zoom = THREE.MathUtils.clamp(zoom * (1 + e.deltaY * 0.001), 0.25, 2); }, { passive: true });
let items: { scene: THREE.Scene; robot: Robot; physics: PhysicsWorld; el: HTMLElement; camera: THREE.PerspectiveCamera; t: number; next: number }[] = [];
/** One game piece as it rests on the carpet (the token the robot's piece flow animates). */
function pieceToken(s: typeof SEASONS[number]): (() => THREE.Object3D) | null {
  const gp = s.gamePiece;
  const m = new THREE.MeshStandardMaterial({ color: gp.color, roughness: 0.65 });
  if (gp.shape === 'tube') return null;
  if (gp.shape === 'ring') {
    const tube = (gp.radius - (gp.innerRadius ?? gp.radius * 0.8)) / 2;
    const geo = new THREE.TorusGeometry(gp.radius - tube, tube, 10, 28).rotateX(Math.PI / 2);
    return () => new THREE.Mesh(geo, m);
  }
  const geo = new THREE.SphereGeometry(gp.radius, 14, 10);
  return () => new THREE.Mesh(geo, m);
}
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
    robot.projectile = { radius: s.gamePiece.radius, airDamping: s.gamePiece.airDamping ?? 0.02 };
    s.configureRobot?.(robot);
    const token = pieceToken(s);
    if (token && s.pieceFlow !== false) robot.enablePieceFlow(token, s.gamePiece.shape !== 'ring');
    const camera = new THREE.PerspectiveCamera(35,1,0.01,40);
    items.push({scene,robot,physics,el,camera,t:0,next:0});
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
    r.blockerDeploy=pose.value==='score'?1:0; // shot blocker (1323) out in the extended pose
    r.placeAnim = {height:pose.value==='score'?1.75:0.45,forward:pose.value==='score'?0.7:0.3,level:pose.value==='score'?4:r.config.placement?.maxLevel ?? 1,side:pose.value==='score'&&r.config.placement?.scoreSide==='sides'?1:0};
    if (pose.value === 'flow') {
      // Loop: intake from the carpet for 2.4 s (or until full), then fire everything at the launcher's rate.
      const c = r.config, cap = Math.max(1, c.hopperCapacity), cycle = 2.4 + Math.min(2.5, cap / Math.max(1, c.launcher.rate)) + 0.6;
      i.t = (i.t + dt) % cycle;
      if (i.t < dt) { r.held.length = 0; i.next = 0; }
      const intaking = i.t < 2.4;
      r.lastCommand = { ...IDLE_COMMAND, intake: intaking, shoot: !intaking };
      if (intaking && i.t >= i.next && r.held.length < cap) {
        i.next = i.t + Math.max(0.12, 2.0 / cap);
        const side = c.intake.ground === false ? (c.intake.stationSide === 'front' ? 1 : -1) : (c.intake.groundSide === 'front' ? 1 : -1);
        const L = r.footprint.length, lat = (Math.random() - 0.5) * c.intake.width * 0.7;
        r.noteCapture({ x: side * (L / 2 + 0.12), y: c.intake.ground === false ? c.height + 0.25 : SEASONS.find(x => x.id === seasonSelect.value)!.gamePiece.radius, z: lat });
        r.held.push(-1);
      } else if (!intaking && i.t >= i.next && r.held.length > 0 && i.t > 2.7) {
        i.next = i.t + 1 / Math.max(1, c.launcher.rate);
        r.held.pop();
      }
    } else r.held.length=pose.value==='full'?r.config.hopperCapacity:pose.value==='loaded'?Math.round(r.config.hopperCapacity*0.6):0;
    r.syncVisual(dt);
    // Gallery uses the exact built model, animated through Robot; climb preview is driven by its replicated state.
    const scale=Math.max(1.15,r.config.height+0.3,pose.value==='score' && r.config.placement?.enabled ? 2.2 : 0);
    if (focus >= 0) {
      const d=scale*3.0*zoom, a=Math.atan2(2,1.8)+orbit+(reverse?Math.PI:0);
      i.camera.position.set(Math.cos(a)*Math.cos(tiltView)*d,Math.sin(tiltView)*d+scale*0.3,Math.sin(a)*Math.cos(tiltView)*d);
    } else i.camera.position.set((reverse?-1:1)*scale*1.8,scale*1.4,(reverse?-1:1)*scale*2);
    i.camera.lookAt(0,scale*0.4,0); i.camera.aspect=rect.width/rect.height; i.camera.updateProjectionMatrix();
    renderer.setViewport(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
    renderer.setScissor(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
    renderer.render(i.scene,i.camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
