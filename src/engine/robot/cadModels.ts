import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModelKit, RobotModel, RobotModelBuilder } from './models';
import { getRobotEnvironment } from './models';
import { buildReefscapeCad } from './reefscapeCadModels';
import { buildCrescendoCad } from './crescendoCadModels';
import { buildHeroCad } from './heroCadModels';
import { buildFireweed1540 } from './heroFireweed1540';
import { cadHopper } from './cadHopper';
import { build9470Cad, build6800Cad, build971Cad, build1114Cad, build2910Cad } from './additionalCadModels';

export const HERO_CAD_MODEL_IDS = ['hero-constantine-1318','hero-mantis-6800','hero-fireweed-1540'] as const;
export const CAD_2024_MODEL_IDS = ['doppler-1690','typhoon-2910','twister-118','gold-rush-27','domotron-604','roti-5940','presto-6328','snoopy-6036'] as const;
export const CAD_2025_MODEL_IDS = ['spectre-2910','whisper-1690','wildstang-111','firefly-118','sublime-1678','zuma-581','quixilver-604-2025','subzero-1778'] as const;
export const CAD_MODEL_IDS = ['reblitz-2910', 'toploader-604', 'limestone-1678', 'rubble-581', 'ctrl-alt-defeat-9470', 'downpour-6800', 'mixtape-971', 'simbot-tim-1114'] as const;
export const ADAPTED_CAD_MODEL_IDS = ['overload-254', 'sandspit-3476', 'ripcurrent-4414', 'madtown-2026-1323', 'kepler-1690', 'croquembouche-5940'] as const;
export const CAD_DONOR_DEPENDENCIES: Record<string, readonly string[]> = {
  'overload-254': ['shooter-581-donor'], 'sandspit-3476': ['shooter-581-donor'],
  'ripcurrent-4414': ['rotor-604-donor','mixtape-971'], 'madtown-2026-1323': ['rotor-604-donor','mixtape-971'],
  'kepler-1690': ['mixtape-971'], 'croquembouche-5940': ['mixtape-971'],
};
const assets = new Map<string, THREE.Group>();
const pending = new Map<string, Promise<void>>();
let enabled = true;
let animated = true;
export function setCadModelsEnabled(value: boolean): void { enabled = value; }
export function setCadAnimationEnabled(value: boolean): void { animated = value; }
/** Also used by asset validation to exercise the actual runtime decoder. */
export async function decodeCadModel(id: string, data: ArrayBuffer): Promise<void> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, '');
  assets.set(id, gltf.scene);
}

/** Preload before constructing robots; headless simulation retains lightweight procedural models. */
export async function prepareCadModels(ids: readonly (string | undefined)[] = [...HERO_CAD_MODEL_IDS,...CAD_MODEL_IDS,...CAD_2024_MODEL_IDS,...CAD_2025_MODEL_IDS,...ADAPTED_CAD_MODEL_IDS]): Promise<void> {
  if (typeof document === 'undefined') return;
  const requested = ids.flatMap(id => id ? [id,...(CAD_DONOR_DEPENDENCIES[id] ?? [])] : []);
  const assetIds: readonly string[] = [...HERO_CAD_MODEL_IDS,...CAD_MODEL_IDS,...CAD_2024_MODEL_IDS,...CAD_2025_MODEL_IDS,'intake-581-donor','shooter-581-donor','rotor-604-donor'];
  await Promise.all([...new Set(requested)].filter(id => assetIds.includes(id)).map(id => {
    if (assets.has(id)) return Promise.resolve();
    let request = pending.get(id);
    if (!request) {
      request = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/robots/${(HERO_CAD_MODEL_IDS as readonly string[]).includes(id) ? 'wcp-hero-heist' : (CAD_2024_MODEL_IDS as readonly string[]).includes(id) ? 2024 : (CAD_2025_MODEL_IDS as readonly string[]).includes(id) ? 2025 : 2026}/${id}.glb`)
        .then(gltf => { assets.set(id, gltf.scene); })
        .catch(error => { console.warn(`CAD model ${id} unavailable; using procedural model.`, error); })
        .finally(() => { pending.delete(id); });
      pending.set(id, request);
    }
    return request;
  }));
}

/** Independent geometry/material ownership for photo-fitted donor mechanisms. */
export function cloneCadPart(id: string, name: string): THREE.Object3D | undefined {
  const source = enabled && assets.get(id)?.getObjectByName(name);
  return source ? ownedClone(source) : undefined;
}

export function cadRobotModelBuilder(id: string | undefined): RobotModelBuilder | undefined {
  return enabled && id && assets.has(id) ? kit => buildCadModel(id, kit) : undefined;
}

function buildCadModel(id: string, k: ModelKit): RobotModel {
  const root = ownedClone(assets.get(id)!);
  root.name = `cad-${id}`;
  root.userData.cadModel = id;
  k.visual.add(root);
  if (id === 'hero-fireweed-1540') return buildFireweed1540(id,root,k,()=>animated);
  if ((HERO_CAD_MODEL_IDS as readonly string[]).includes(id)) return buildHeroCad(id,root,k,()=>animated);
  if ((CAD_2024_MODEL_IDS as readonly string[]).includes(id)) return buildCrescendoCad(id,root,k,()=>animated);
  if ((CAD_2025_MODEL_IDS as readonly string[]).includes(id)) return buildReefscapeCad(id,root,k,()=>animated);
  if (id === 'reblitz-2910') return build2910Cad(root,k,()=>animated);
  if (id === 'simbot-tim-1114') return build1114Cad(root,k,()=>animated);
  if (id === 'ctrl-alt-defeat-9470') return build9470Cad(root,k,()=>animated);
  if (id === 'downpour-6800') return build6800Cad(root,k,()=>animated);
  if (id === 'mixtape-971') return build971Cad(root,k,()=>animated);
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parent: THREE.Object3D = root): THREE.Group => {
    const group = new THREE.Group(); group.name = `cad-${name}-pivot`; group.position.fromArray(at);
    parent.add(group);
    const part = get(name);
    if (part) { part.removeFromParent(); part.position.sub(group.position); group.add(part); }
    return group;
  };
  const isToploader = id === 'toploader-604', isLimestone = id === 'limestone-1678';
  // The flat CAD fabric proxy must give way to the load-driven net, rather than cover its bulge.
  const fabricRoof = get('hopper-roof');
  if (fabricRoof && k.config.hopperExpansion?.mechanism !== 'telescoping' && k.config.hopperExpansion) fabricRoof.visible = false;
  const intakePivot: [number, number, number] = isToploader ? [-.3048,.206375,0] : isLimestone ? [-.30465,.1689,0] : [0,0,0];
  const intake = pivot('intake', intakePivot);
  const flywheelCenter: [number, number, number] = isToploader ? [.02608,.5969,-.07444] : isLimestone ? [.2881,.4768,.00947] : [.28575,.47625,0];
  const flywheel = pivot('flywheel', flywheelCenter);
  // Rubble's hood plate has concentric circular faces and its bearing bore at the drum shaft.
  const hood = pivot('hood', flywheelCenter);
  const turret = isToploader ? pivot('turret', [.0254,.5588,0]) : undefined;
  if (turret) { turret.attach(hood); turret.attach(flywheel); }
  const serializer = isToploader ? pivot('serializer', [.0254,.23,0]) : undefined;
  const slider = get('hopper-slide');
  const hopperLift = get('hopper-lift');
  const hopperFront = get('hopper-front');

  const hopper = cadHopper(id,k,{ slider, lift:hopperLift, front:hopperFront });
  const intakeTip = new THREE.Object3D();
  intakeTip.position.set(isToploader ? -.58 : isLimestone ? -.143 : -.62, isToploader ? .085 : isLimestone ? .3675 : .09, 0);
  root.add(intakeTip); intake.attach(intakeTip);
  let deploy = 0;
  let hoodAngle = 0;
  const ease = (from: number, to: number, dt: number) => dt > 0 ? from + (to - from) * (1 - Math.exp(-7 * dt)) : to;
  const point = (o: THREE.Object3D, x = 0, y = 0, z = 0) => {
    k.visual.updateMatrixWorld(true);
    return k.visual.worldToLocal(o.localToWorld(new THREE.Vector3(x,y,z)));
  };
  return {
    replaces: ['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    lightAt: [0,.65,k.config.frameWidth*.35], intakeAnchor: intakeTip,
    flow: {
      intake: () => isLimestone
        ? [new THREE.Vector3(-.65,.17,0),new THREE.Vector3(-.52,.30,0),new THREE.Vector3(-.40,.46,0),new THREE.Vector3(-.26,.59,0),new THREE.Vector3(-.13,.49,0)]
        : isToploader ? [new THREE.Vector3(-.58,.12,0),new THREE.Vector3(-.40,.22,0),new THREE.Vector3(-.28,.3,0)]
        : [point(intakeTip,0,.075), new THREE.Vector3(-.28,.3,0)],
      stow: hopper.stow,
      feed: (shot = 0) => {
        const z = isToploader ? 0 : ((shot % 4) - 1.5) * .145;
        return [new THREE.Vector3(-.22,.3,z), new THREE.Vector3(.05,.32,z),
          isToploader ? point(flywheel,0,.035,.06) : point(flywheel,-.06,.035,z),
          isToploader ? point(flywheel,0,.07,-.025) : point(flywheel,.02,.07,z)];
      },
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      hopper.update(s.fill, deploy, s.dt, s.blocker);
      if (!animated) return;
      if (isToploader) {
        intake.rotation.z = -(1-deploy)*1.9;
        if (slider) slider.position.x = (1-deploy)*.23;
        if (turret) turret.rotation.y = k.turret.rotation.y - Math.PI/2;
        if (serializer) serializer.rotation.y += (s.enabled ? s.firing > 0 ? 8 : 1.5 : 0)*s.dt;
      } else if (isLimestone) {
        // The lower 0409 shaft is the intake hinge; 1507 is an upper roller shaft.
        // Deploy toward the floor around the fixed hinge, independently of the hopper slide.
        intake.rotation.z = deploy*2.4;
      } else {
        intake.position.x = (1-deploy)*.22;
      }
      // CAD contact tangent: the fixed drum hoods are exported near their high-shot position, not the UI's 52-degree middle shot.
      // Rotate from that measured reference to the actual requested launch angle.
      const cadShotAngle = isToploader ? .90 : isLimestone ? 1.265 : 1.349;
      hoodAngle = scoringEase(hoodAngle, s.aiming ? THREE.MathUtils.clamp(s.hood,.5,1.25)-cadShotAngle : 0, s.dt);
      hood.rotation[isToploader ? 'x' : 'z'] = hoodAngle;
      flywheel.rotation[isToploader ? 'x' : 'z'] += (s.enabled && (s.aiming || s.firing > 0) ? 45 : 0)*s.dt;
    },
  };
}

function ownedClone<T extends THREE.Object3D>(source:T):T {
  const clone=source.clone(true) as T;
  clone.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Each robot owns geometry; preview disposal and visual merging cannot alter the cached asset.
    m.geometry = m.geometry.clone();
    const materialCopies = (Array.isArray(m.material) ? m.material : [m.material]).map(material => {
      const copy = material.clone() as THREE.MeshStandardMaterial;
      if (copy.isMeshStandardMaterial) {
        // Onshape's exported CAD swatches need a darker, matte finish under the game's bright field lighting.
        if (copy.name !== 'rubber') copy.color.convertSRGBToLinear();
        if (copy.userData.cadSheet && !copy.userData.cadSmoothSheet) copy.flatShading = true;
        copy.envMap = getRobotEnvironment(); copy.envMapIntensity = .25;
      }
      return copy;
    });
    m.material = Array.isArray(m.material) ? materialCopies : materialCopies[0];
    m.castShadow = m.receiveShadow = true;
  });
  return clone;
}
