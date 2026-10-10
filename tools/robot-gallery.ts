import { fitCoralInTool } from '../src/seasons/2025-reefscape/coralVisual';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SEASONS } from '../src/seasons';
import { PhysicsWorld, loadRapier } from '../src/engine/physics/world';
import { Robot, IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { FieldFrame } from '../src/engine/coords';
import { blendCoralPose, coralReleasePose, coralTransferPose, ejectTravel } from '../src/seasons/2025-reefscape/transferVisual';
import { EJECT_SECONDS } from '../src/seasons/2025-reefscape/rules';
import { animateAlgaeGrip } from '../src/seasons/2025-reefscape/algaeVisual';
import { coralGeometry } from '../src/seasons/2025-reefscape/field';
import { setRobotEnvironment } from '../src/engine/robot/models';
import { prepareCadModels, setCadModelsEnabled, setCadAnimationEnabled, CAD_MODEL_IDS, CAD_2024_MODEL_IDS, CAD_2025_MODEL_IDS, ADAPTED_CAD_MODEL_IDS, HERO_CAD_MODEL_IDS } from '../src/engine/robot/cadModels';
await prepareCadModels();
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
for (const s of SEASONS) seasonSelect.add(new Option(s.label ?? `${s.year} ${s.name}`, s.id));
const requestedSeason = new URLSearchParams(location.search).get('season');
if (SEASONS.some(s => s.id === requestedSeason)) seasonSelect.value = requestedSeason!;
const pose = document.querySelector<HTMLSelectElement>('#pose')!;
const hood = document.querySelector<HTMLSelectElement>('#hood')!;
const turretYaw = document.querySelector<HTMLSelectElement>('#turretYaw')!;
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
let items: { scene: THREE.Scene; robot: Robot; physics: PhysicsWorld; el: HTMLElement; camera: THREE.PerspectiveCamera; t: number; next: number; coral?: THREE.Mesh; algae?: THREE.Mesh }[] = [];
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
  setCadModelsEnabled(document.querySelector<HTMLSelectElement>('#geometry')!.value === 'cad');
  setCadAnimationEnabled(pose.value !== 'cad');
  for (const i of items) { i.physics.world.free(); i.scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
  items = [];
  focus = -1;
  const grid = document.querySelector('#grid')!;
  grid.innerHTML = '';
  const s = SEASONS.find(s => s.id === seasonSelect.value)!;
  const detailedIds: readonly string[] = [...HERO_CAD_MODEL_IDS,...CAD_MODEL_IDS,...CAD_2024_MODEL_IDS,...CAD_2025_MODEL_IDS,...ADAPTED_CAD_MODEL_IDS];
  const configs = [...(s.teamRobots ?? []).filter(t => !new URLSearchParams(location.search).has('cad') || detailedIds.includes(t.config.model ?? '')).map(t => ({ name: `${t.team} · ${t.name}`, config: t.config }))];
  // Standalone games without real robots (WCP CADathon) show their derived archetype presets.
  if (!configs.length) configs.push(...(s.robotPresets ?? []).map(p => ({ name: p.label, config: p.config })));
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
    let adapted = false; robot.visual.traverse(o => { if(o.userData.cadDonor) adapted = true; });
    el.dataset.geometry = robot.visual.getObjectByName(`cad-${entry.config.model}`) ? 'cad' : adapted ? 'adapted-cad' : 'procedural';
    robot.projectile = { radius: s.gamePiece.radius, airDamping: s.gamePiece.airDamping ?? 0.02 };
    s.configureRobot?.(robot);
    const token = pieceToken(s);
    if (token && s.pieceFlow !== false) robot.enablePieceFlow(token, s.gamePiece.shape !== 'ring');
    const camera = new THREE.PerspectiveCamera(35,1,0.01,40);
    const coral = s.gamePiece.shape === 'tube' ? new THREE.Mesh(coralGeometry(),new THREE.MeshStandardMaterial({ color:s.gamePiece.color,roughness:.6 })) : undefined;
    if (coral) { coral.visible=false; robot.visual.add(coral); }
    if(coral)coral.userData.heldGamePiece=true;
    const algae = coral ? new THREE.Mesh(new THREE.SphereGeometry(.206,20,16),new THREE.MeshStandardMaterial({color:0x54cbbb,roughness:.7})) : undefined;
    if (algae) { algae.visible=false; robot.visual.add(algae); }
    items.push({scene,robot,physics,el,camera,t:0,next:0,coral,algae});
  }
}
seasonSelect.onchange = build;
pose.onchange = build;
hood.onchange = () => { if (pose.value !== 'aim') { pose.value = 'aim'; build(); } };
document.querySelector<HTMLSelectElement>('#geometry')!.onchange = event => { setCadModelsEnabled((event.target as HTMLSelectElement).value === 'cad'); build(); };
document.querySelector<HTMLButtonElement>('#view')!.onclick = () => { reverse = !reverse; };
document.querySelector<HTMLButtonElement>('#alliance')!.onclick = () => { red = !red; build(); };
build();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now-last)/1000,0.05); last=now;
  renderer.setSize(innerWidth,innerHeight,false);
  for (const i of items) {
    const rect=i.el.getBoundingClientRect();
    const visible=rect.bottom>=0&&rect.top<=innerHeight&&!!rect.width;
    if(!visible&&pose.value!=='fuel-fill'&&pose.value!=='full')continue;
    const r=i.robot; r.enabled=pose.value !== 'idle' && pose.value !== 'cad';
    r.climbReady=pose.value==='endgame';
    r.climbPhase=pose.value==='climb'?'align':pose.value==='hang'?'hanging':'none';
    r.body.setTranslation({x:0,y:pose.value==='hang'?.28:.002,z:0},false);
    r.ampDeploy = seasonSelect.value === '2024-crescendo' ? pose.value === 'score' : null;
    r.lastCommand={...IDLE_COMMAND,intake:pose.value==='intake',pass:pose.value==='score'||pose.value==='pass',shoot:pose.value==='aim'};
    r.lastShotAngle = pose.value==='pass' ? .5 : Number(hood.value);
    // Exercise the same relative turret target used by gameplay instead of leaving every preview at yaw zero.
    r.turretYaw = r.config.launcher.turret && ['aim','pass','score','flow'].includes(pose.value)
      ? turretYaw.value === 'sweep' ? Math.sin(now / 2200) * Math.PI * .8 : Number(turretYaw.value) : 0;
    r.blockerDeploy=pose.value==='score'?1:0; // shot blocker (1323) out in the extended pose
    r.placeAnim = {algae:pose.value==='algae'||pose.value==='both',height:pose.value==='algae'?2.03:pose.value==='score'?1.75:0.45,forward:pose.value==='algae'?.45:pose.value==='score'?0.7:0.3,level:pose.value==='both'?1:pose.value==='score'?4:r.config.placement?.maxLevel ?? 1,side:(pose.value==='score'||pose.value==='algae')&&r.config.placement?.scoreSide==='sides'?1:0};
    if (pose.value === 'transfer') {
      r.held.length = 1;
      r.placeAnim = {height:.45, forward:.3, level:1,
        handoff:(r.config.placement?.handoffSeconds ?? 0) > 0 ? Number(document.querySelector<HTMLInputElement>('#transfer')!.value) : 0};
      r.lastCommand = {...IDLE_COMMAND, intake: r.modelHandoffStyle === 'direct'};
    }
    if (pose.value === 'flow' && i.coral) {
      // CORAL: collect → conveyor handoff → extend to L4 → retract, using the match's model path.
      i.t = (i.t + dt) % 6;
      const collecting = i.t < .8, transfer = (r.config.placement?.handoffSeconds ?? 0) > 0 && i.t >= .8 && i.t < 2.5, scoring = i.t >= 2.5 && i.t < 5;
      // The rollers eject the CORAL at the end of the scoring hold, as in a match (rules EJECT_SECONDS).
      const eject = scoring && i.t >= 4.4 ? Math.min(1, (i.t-4.4)/EJECT_SECONDS) : 0;
      r.held.length = i.t >= .8 && i.t < 4.4+EJECT_SECONDS ? 1 : 0;
      r.lastCommand = { ...IDLE_COMMAND, intake:collecting, shoot:scoring };
      r.placeAnim = { height:scoring ? 1.75 : .45, forward:scoring ? .7 : .3, level:4,
        side:scoring && r.config.placement?.scoreSide==='sides' ? 1 : 0, handoff:transfer ? (i.t-.8)/1.7 : 0, eject };
    } else if (pose.value === 'flow' || pose.value === 'fuel-fill') {
      // Loop: intake from the carpet for 2.4 s (or until full), then fire everything at the launcher's rate.
      const c = r.config, cap = Math.max(1, c.hopperCapacity), cycle = 2.4 + Math.min(2.5, cap / Math.max(1, c.launcher.rate)) + 0.6;
      i.t = pose.value === 'fuel-fill' ? i.t + dt : (i.t + dt) % cycle;
      if (i.t < dt) { r.held.length = 0; i.next = 0; }
      const intaking = pose.value === 'fuel-fill' ? r.held.length < cap : i.t < 2.4;
      r.lastCommand = { ...IDLE_COMMAND, intake: intaking, shoot: !intaking };
      if (intaking && i.t >= i.next && r.held.length < cap) {
        i.next = i.t + Math.max(0.12, 2.0 / cap);
        const side = c.intake.ground === false ? (c.intake.stationSide === 'front' ? 1 : -1) : (c.intake.groundSide === 'front' ? 1 : -1);
        const L = r.footprint.length, lat = (Math.random() - 0.5) * c.intake.width * 0.7;
        const yaw=c.intake.ground===false?undefined:c.intake.groundYaw;
        const edge=yaw===undefined?L/2:(Math.abs(Math.cos(yaw))*L+Math.abs(Math.sin(yaw))*r.footprint.width)/2;
        r.noteCapture({ x: yaw===undefined?side*(edge+.12):(edge+.12)*Math.cos(yaw)+lat*Math.sin(yaw), y: c.intake.ground === false ? c.height + 0.25 : SEASONS.find(x => x.id === seasonSelect.value)!.gamePiece.radius, z: yaw===undefined?lat:-(edge+.12)*Math.sin(yaw)+lat*Math.cos(yaw) });
        r.held.push(-1);
      } else if (pose.value !== 'fuel-fill' && !intaking && i.t >= i.next && r.held.length > 0 && i.t > 2.7) {
        i.next = i.t + 1 / Math.max(1, c.launcher.rate);
        r.held.pop();
      }
    } else if (pose.value !== 'transfer') r.held.length=pose.value==='full'?r.config.hopperCapacity:pose.value==='both'?(r.config.options?.dualPieceStorage||r.config.options?.coralBuffer?1:0):pose.value==='loaded'?Math.round(r.config.hopperCapacity*0.6):pose.value==='aim'?1:0;
    if (r.manualHopper) {
      const threshold = r.config.hopperExpansion!.startCount;
      r.hopperRaised = pose.value === 'full' || pose.value === 'score' || r.held.length > threshold
        || (['fuel-fill', 'flow'].includes(pose.value) && r.held.length >= threshold);
    }
    r.syncVisual(dt);
    if (seasonSelect.value === '2026-rebuilt') {
      const audit=r.fuelTransportAudit;
      i.el.dataset.fuelHeld=String(r.held.length);
      i.el.dataset.fuelBlocked=String(audit?.blocked ?? 0);
      i.el.querySelector('.label')!.textContent = `${i.el.getAttribute('aria-label')} · FUEL ${r.held.length}/${r.config.hopperCapacity}${pose.value === 'fuel-fill' ? ` · ${r.piecesInTransit} moving · ${audit?.blocked ?? 0} blocked` : ''}`;
    }
    if (i.coral) {
      const anchor = r.modelHeldAnchor, p = r.placeAnim!;
      i.coral.visible = !!anchor && (r.held.length > 0 || pose.value==='score');
      if (anchor) {
        r.visual.updateMatrixWorld(true);
        const end = r.visual.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()));
        i.coral.position.copy(end);
        const dir = p.level === 4 ? new THREE.Vector3(0,-1,0) : p.level === 1 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(Math.cos(.6),-Math.sin(.6),0);
        const scoreQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
        scoreQ.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(p.side ?? 0)*Math.PI/2));
        if(r.modelCoralAxis)scoreQ.copy(anchor.getWorldQuaternion(new THREE.Quaternion())).premultiply(r.visual.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...r.modelCoralAxis).normalize()));
        i.coral.quaternion.copy(scoreQ);
        if (p.handoff) {
          coralTransferPose(r.visual, r.modelIntakeAnchor, end, scoreQ, p.handoff,
            r.modelHandoffPath, r.modelHandoffStyle, i.coral.position, i.coral.quaternion);
        }
      }
    }
    if(i.coral && r.modelHeldAnchor && !r.placeAnim?.handoff && !(pose.value==='both'&&r.config.options?.coralBuffer))fitCoralInTool(i.coral,r.modelHeldAnchor);
    if (pose.value === 'score' && r.placeAnim) r.placeAnim.eject = Number(document.querySelector<HTMLInputElement>('#transfer')!.value);
    if (i.coral?.visible && (r.placeAnim?.eject ?? 0) > 0) {
      // Scoring: slide from the tool's seat to where the match releases the CORAL (same helpers as the rules).
      const p = r.placeAnim!, to = new THREE.Vector3(), toQ = new THREE.Quaternion();
      coralReleasePose(p.height, p.forward, p.side ?? 0, p.level, to, toQ);
      blendCoralPose(i.coral.position, i.coral.quaternion, to, toQ, ejectTravel(p.eject ?? 0));
    }
    if(pose.value==='both' && i.coral && r.config.options?.coralBufferLocation==='intake' && r.modelIntakeAnchor){
      r.visual.updateMatrixWorld(true);i.coral.position.copy(r.visual.worldToLocal(r.modelIntakeAnchor.getWorldPosition(new THREE.Vector3())));
      i.coral.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1));
    }
    if (i.algae) {
      i.algae.visible=(pose.value==='algae'||pose.value==='both') && !!r.config.intake.secondary;
      if (i.algae.visible) {
        r.visual.updateMatrixWorld(true);
        const anchor=r.modelAlgaeAnchor ?? r.modelHeldAnchor;
        if (anchor) { if (i.algae.parent!==anchor) anchor.add(i.algae); i.algae.position.set(0,0,0); }
      }
      animateAlgaeGrip(i.algae,i.algae.visible,r.modelAlgaeGripScale,dt,r.modelAlgaeGripThroat);

    }
    // Gallery uses the exact built model, animated through Robot; climb preview is driven by its replicated state.
    if(!visible)continue;
    const scale=Math.max(new THREE.Box3().setFromObject(r.visual).max.y + .15,pose.value==='algae'?2.6:1.15,r.config.height+0.3,(pose.value==='score' || pose.value==='algae' || pose.value==='flow') && r.config.placement?.enabled ? 2.2 : 0);
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
