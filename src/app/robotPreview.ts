import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SeasonDefinition } from '@engine/core/season';
import { FieldFrame } from '@engine/coords';
import { PhysicsWorld, loadRapier } from '@engine/physics/world';
import { cloneConfig, type RobotConfig } from '@engine/robot/config';
import { IDLE_COMMAND, Robot } from '@engine/robot/robot';
import { setRobotEnvironment } from '@engine/robot/models';
import { prepareCadModels } from '@engine/robot/cadModels';

/**
 * 3D robot previews for the menu: the exact model the match draws, on a clean transparent background.
 *  - `thumb()` renders one still image per robot (cached), used by the robot picker cards.
 *  - `live()` mounts a slowly turning, draggable view of the selected robot, showing its mechanisms in a loop.
 * Everything is lazy: nothing loads (Rapier, three) until the Robot tab asks for a preview.
 */

interface Built {
  scene: THREE.Scene;
  robot: Robot;
  physics: PhysicsWorld;
  /** Size used to frame the camera. */
  scale: number;
  dispose(): void;
}

let rapier: Awaited<ReturnType<typeof loadRapier>> | null = null;
let thumbRenderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
let initialization: Promise<void> | null = null;

function init(): Promise<void> {
  return initialization ??= initialize();
}

async function initialize(): Promise<void> {
  rapier ??= await loadRapier();
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.setClearColor(0x000000, 0);
    const pmrem = new THREE.PMREMGenerator(thumbRenderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  }
  setRobotEnvironment(env);
}

function build(season: SeasonDefinition, config: RobotConfig, alliance: 'red' | 'blue'): Built {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe7efff, 0x6a6470, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(2, 5, 3);
  scene.add(sun);
  // Soft contact shadow so the robot reads as sitting on something without drawing a floor.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.scale.set(1, 0.8, 1);
  scene.add(shadow);
  const physics = new PhysicsWorld(rapier!);
  const robot = new Robot(physics, scene, new FieldFrame(0, 0), cloneConfig(config), alliance, 0, 1, { x: 0, y: 0, yaw: 0 });
  robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
  season.configureRobot?.(robot);
  robot.enabled = false;
  robot.syncVisual(0.016);
  return {
    scene, robot, physics,
    scale: Math.max(1.15, config.height + 0.3),
    dispose() {
      physics.world.free();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
        }
      });
    },
  };
}

function frame(camera: THREE.PerspectiveCamera, scale: number, azimuth: number, tilt: number, zoom: number, aspect: number): void {
  const d = scale * 2.45 * zoom;
  camera.position.set(Math.cos(azimuth) * Math.cos(tilt) * d, Math.sin(tilt) * d + scale * 0.25, Math.sin(azimuth) * Math.cos(tilt) * d);
  camera.lookAt(0, scale * 0.36, 0);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

const thumbs = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function configHash(config: RobotConfig): string {
  const json = JSON.stringify(config);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** One still image (data URL) of a robot, rendered once and cached. Renders are serialized on one GL context. */
export function robotThumb(season: SeasonDefinition, config: RobotConfig, alliance: 'red' | 'blue', w = 300, h = 200): Promise<string> {
  // Archetype presets share a model and team number, so the config itself is part of the key.
  const key = `${season.id}|${config.model ?? 'generic'}|${config.teamNumber}|${configHash(config)}|${alliance}|${w}x${h}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  // Fetch/decode independently: a slow CAD download must not hold up every card after it.
  const ready = Promise.all([init(), prepareCadModels([config.model])]);
  const p: Promise<string> = ready.then(() => {
    const render = queue.then(async () => {
      // Yield so a run of renders never freezes scrolling/clicks.
      await new Promise<void>((r) => setTimeout(r));
      const b = build(season, config, alliance);
      const r = thumbRenderer!;
      r.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
      r.setSize(w, h, false);
      const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 40);
      frame(cam, b.scale, Math.atan2(2, 1.8), 0.42, 1, w / h);
      r.render(b.scene, cam);
      // Encode off the main thread (toBlob is async; the buffer is snapshotted at call time).
      const blob = await new Promise<Blob | null>((res) => r.domElement.toBlob(res, 'image/webp', 0.88));
      b.dispose();
      return blob ? URL.createObjectURL(blob) : r.domElement.toDataURL('image/png');
    });
    // A failed thumbnail must not poison the shared rendering queue.
    queue = render.catch(() => undefined);
    return render;
  });
  void p.catch(() => { if (thumbs.get(key) === p) thumbs.delete(key); });
  thumbs.set(key, p);
  return p;
}

export interface LivePreview {
  /** Show the preview inside `host` (call after every menu re-render: the canvas is kept, only re-parented). */
  attach(host: HTMLElement): void;
  set(config: RobotConfig, alliance: 'red' | 'blue'): void;
  dispose(): void;
}

/** Visible picker cards share one GL context; small 2D canvases receive its renders without image encoding. */
export function createRotatingPreviews(season: SeasonDefinition, cards: {host:HTMLElement;config:RobotConfig;alliance:'red'|'blue'}[]): {dispose():void} {
  let disposed=false,renderer:THREE.WebGLRenderer|null=null,frameId=0,last=0;
  const records=cards.map(card=>({...card,visible:false,built:null as Built|null,pending:false,canvas:null as HTMLCanvasElement|null}));
  const camera=new THREE.PerspectiveCamera(32,1,.01,40);
  const prepare=async (record:typeof records[number])=>{
    if(record.pending||record.built)return;
    record.pending=true;
    try {
      await Promise.all([init(),prepareCadModels([record.config.model])]);
      if(disposed||!record.visible||!record.host.isConnected)return;
      renderer??=new THREE.WebGLRenderer({antialias:true,alpha:true});
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.setClearColor(0,0);renderer.setSize(300,200,false);
      record.built=build(season,record.config,record.alliance);
      const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;canvas.className='robot-turntable';
      canvas.setAttribute('aria-hidden','true');record.canvas=canvas;
      record.host.append(canvas);
    } catch { /* Keep the cached thumbnail if a preview cannot load. */ }
    finally {record.pending=false;}
  };
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries) {
      const record=records.find(record=>record.host===entry.target)!;
      record.visible=entry.isIntersecting;
      if(record.visible)void prepare(record);
      else {record.built?.dispose();record.built=null;record.canvas?.remove();record.canvas=null;}
    }
  });
  for(const record of records)observer.observe(record.host);
  const loop=(now:number)=>{
    if(disposed)return;
    frameId=requestAnimationFrame(loop);
    if(document.hidden||now-last<1000/18||!renderer)return;
    last=now;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const record of records) {
      if(!record.visible||!record.built||!record.host.isConnected||!record.canvas)continue;
      if(reduced&&record.canvas.dataset.rendered)continue;
      frame(camera,record.built.scale,.9+(reduced?0:now/1000*.28),.42,1,1.5);
      renderer.render(record.built.scene,camera);
      record.canvas.getContext('2d')?.clearRect(0,0,300,200);
      record.canvas.getContext('2d')?.drawImage(renderer.domElement,0,0);
      record.canvas.dataset.rendered='true';
    }
  };
  frameId=requestAnimationFrame(loop);
  return {dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();renderer?.dispose();
    for(const record of records){record.built?.dispose();record.canvas?.remove();}
  }};
}

/** A turning, draggable 3D view of a robot that runs its mechanisms in a gentle loop. */
export function createLivePreview(season: SeasonDefinition, config: RobotConfig, alliance: 'red' | 'blue'): LivePreview {
  let disposed = false;
  let started = false;
  let host: HTMLElement | null = null;
  let built: Built | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let az = 0.9, tilt = 0.4, zoom = 1, dragging = false, last = 0, clock = 0;
  let needsDraw=true;
  let cur = { config, alliance };
  let wantRebuild = false;
  let revision = 0;
  const prepareCurrent = async () => {
    const requestedRevision = ++revision;
    wantRebuild = false;
    await prepareCadModels([cur.config.model]);
    if (!disposed && requestedRevision === revision) wantRebuild = true;
  };

  const start = async () => {
    void prepareCurrent();
    await init();
    if (disposed) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'robot-live';
    host?.replaceChildren(renderer.domElement);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 40);
    const down = () => (dragging = true);
    const up = () => (dragging = false);
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      az -= e.movementX * 0.01;
      tilt = THREE.MathUtils.clamp(tilt + e.movementY * 0.008, 0.08, 1.2);
      needsDraw=true;
    };
    renderer.domElement.addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    addEventListener('pointermove', move);
    renderer.domElement.addEventListener('wheel', (e) => { zoom = THREE.MathUtils.clamp(zoom * (1 + e.deltaY * 0.001), 0.6, 1.6); needsDraw=true; e.preventDefault(); }, { passive: false });
    const loop = (now: number) => {
      if (disposed) { removeEventListener('pointerup', up); removeEventListener('pointermove', move); return; }
      requestAnimationFrame(loop);
      if(now-last<1000/30)return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!host?.isConnected || document.hidden) return;
      if (wantRebuild) {
        built?.dispose();
        built = build(season, cur.config, cur.alliance);
        wantRebuild = false;
        needsDraw=true;
      }
      const rect = host.getBoundingClientRect();
      if (!built || rect.width < 4) return;
      const pr = Math.min(2, devicePixelRatio || 1);
      renderer!.setPixelRatio(pr);
      if (renderer!.domElement.width !== Math.round(rect.width * pr) || renderer!.domElement.height !== Math.round(rect.height * pr)) {
        renderer!.setSize(rect.width, rect.height, false); needsDraw=true;
      }
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(reduced&&!needsDraw)return;
      clock += reduced ? 0 : dt;
      if (!dragging && !reduced) az += dt * 0.35;
      // Showcase loop: stowed, then intake out and rolling, then stowed (so the intake and its side are visible).
      const r = built.robot;
      const t = clock % 6;
      r.enabled = t > 1.2 && t < 4.2;
      r.lastCommand = { ...IDLE_COMMAND, intake: r.enabled };
      r.held.length = 0;
      r.syncVisual(dt);
      frame(cam, built.scale, az, tilt, zoom, rect.width / rect.height);
      renderer!.render(built.scene, cam);
      needsDraw=false;
    };
    requestAnimationFrame(loop);
  };
  return {
    attach(h) {
      host = h;
      if (renderer) h.replaceChildren(renderer.domElement);
      else if (!started) { started = true; void start(); }
    },
    set(c, a) { cur = { config: c, alliance: a }; if (started) void prepareCurrent(); },
    dispose() { disposed = true; built?.dispose(); renderer?.dispose(); },
  };
}
