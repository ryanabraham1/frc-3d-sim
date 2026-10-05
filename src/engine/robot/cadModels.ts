import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModelKit, RobotModel, RobotModelBuilder } from './models';
import { getRobotEnvironment } from './models';
import { cadHopper } from './cadHopper';

export const CAD_MODEL_IDS = ['toploader-604', 'limestone-1678', 'rubble-581'] as const;
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
export async function prepareCadModels(ids: readonly (string | undefined)[] = CAD_MODEL_IDS): Promise<void> {
  if (typeof document === 'undefined') return;
  await Promise.all([...new Set(ids)].filter((id): id is typeof CAD_MODEL_IDS[number] => CAD_MODEL_IDS.includes(id as typeof CAD_MODEL_IDS[number])).map(id => {
    if (assets.has(id)) return Promise.resolve();
    let request = pending.get(id);
    if (!request) {
      request = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/robots/2026/${id}.glb`)
        .then(gltf => { assets.set(id, gltf.scene); })
        .catch(error => { console.warn(`CAD model ${id} unavailable; using procedural model.`, error); })
        .finally(() => { pending.delete(id); });
      pending.set(id, request);
    }
    return request;
  }));
}

export function cadRobotModelBuilder(id: string | undefined): RobotModelBuilder | undefined {
  return enabled && id && assets.has(id) ? kit => buildCadModel(id, kit) : undefined;
}

function buildCadModel(id: string, k: ModelKit): RobotModel {
  const root = assets.get(id)!.clone(true);
  root.name = `cad-${id}`;
  root.userData.cadModel = id;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Each robot owns geometry; preview disposal and visual merging cannot alter the cached asset.
    m.geometry = m.geometry.clone();
    const materialCopies = (Array.isArray(m.material) ? m.material : [m.material]).map(material => {
      const copy = material.clone() as THREE.MeshStandardMaterial;
      if (copy.isMeshStandardMaterial) {
        // Onshape's exported CAD swatches need a darker, matte finish under the game's bright field lighting.
        if (copy.name !== 'rubber') copy.color.convertSRGBToLinear();
        if (copy.userData.cadSheet) copy.flatShading = true;
        copy.envMap = getRobotEnvironment(); copy.envMapIntensity = .25;
      }
      return copy;
    });
    m.material = Array.isArray(m.material) ? materialCopies : materialCopies[0];
    m.castShadow = m.receiveShadow = true;
  });
  k.visual.add(root);
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parent: THREE.Object3D = root): THREE.Group => {
    const group = new THREE.Group(); group.name = `cad-${name}-pivot`; group.position.fromArray(at);
    parent.add(group);
    const part = get(name);
    if (part) { part.removeFromParent(); part.position.sub(group.position); group.add(part); }
    return group;
  };
  const isToploader = id === 'toploader-604', isLimestone = id === 'limestone-1678';
  const intakePivot: [number, number, number] = isToploader ? [-.3048,.206375,0] : isLimestone ? [-.311652,.322253,0] : [0,0,0];
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
      intake: () => [point(intakeTip,0,.075), new THREE.Vector3(-.28,.3,0)],
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
      hopper.update(s.fill, deploy, s.dt);
      if (!animated) return;
      if (isToploader) {
        intake.rotation.z = -(1-deploy)*1.9;
        if (slider) slider.position.x = (1-deploy)*.23;
        if (turret) turret.rotation.y = k.turret.rotation.y - Math.PI/2;
        if (serializer) serializer.rotation.y += (s.enabled ? s.firing > 0 ? 8 : 1.5 : 0)*s.dt;
      } else if (isLimestone) {
        // Shaft 1507 defines the slapdown axis; the whole intake rides the horizontal hopper slide.
        intake.position.x = intakePivot[0] - deploy*.25;
        intake.rotation.z = -deploy*2.1;
      } else {
        intake.position.x = (1-deploy)*.22;
      }
      // CAD contact tangent: the fixed drum hoods are exported near their high-shot position, not the UI's 52-degree middle shot.
      // Rotate from that measured reference to the actual requested launch angle.
      const cadShotAngle = isToploader ? .90 : isLimestone ? 1.265 : 1.349;
      hoodAngle = ease(hoodAngle, s.aiming ? THREE.MathUtils.clamp(s.hood,.5,1.25)-cadShotAngle : 0, s.dt);
      hood.rotation[isToploader ? 'x' : 'z'] = hoodAngle;
      flywheel.rotation[isToploader ? 'x' : 'z'] += (s.enabled && (s.aiming || s.firing > 0) ? 45 : 0)*s.dt;
    },
  };
}
