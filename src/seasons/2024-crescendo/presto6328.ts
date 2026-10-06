import * as THREE from 'three';
import type { ModelKit, RobotModel } from '@engine/robot/models';
import { bar, box, decal, drivebase, hook, mat, pivot, roller, sidePlates, wheelShaft, tubeMat, underBumperIntake, underBumperEntry, flowAt } from '@engine/robot/models';

/** Presto: rear intake, center-pivot arm with belt-fed shooter, AMP backpack,
 * blue tubes, black sponsor skin, orange flywheels. Sources: supplied
 * MA24B export, 6328's 2024 Open Alliance thread and TBA match/pit photos.
 * Lightweight fallback; native complete team CAD is used by the default renderer.
 */
export function buildPresto6328(k: ModelKit, cad?: THREE.Group, animated: () => boolean = () => true): RobotModel {
  const visual = cad ?? k.visual;
  const frame = new THREE.Group(); frame.name = 'frame'; visual.add(frame);
  const kit = { ...k, visual: frame };
  const blue = tubeMat(0x1763c4), black = mat(0x16191e), silver = mat(0xc8cdd3);
  const base = drivebase(kit, { motorRing: 0x1763c4 });
  const fallbackIntake = cad ? undefined : underBumperIntake(kit, { n: 3 });
  box(frame,k.config.frameLength*.9,.008,k.config.frameWidth*.9,black,0,.16,0);
  for (const z of [-.25,.25]) {
    bar(frame,[-.17,.19,z],[-.238,.298,z],.03,blue);
    bar(frame,[.18,.19,z],[-.238,.298,z],.03,blue);
  }
  const arm = pivot(visual,-.238,.298); arm.name = 'cad-shooter-pivot';
  for (const z of [-.24,.24]) bar(arm,[0,0,z],[.657,0,z],.03,blue);
  sidePlates(arm,[[-.04,-.06],[.46,-.06],[.5,.06],[.1,.08],[-.04,.06]],.24,black,[[.12,0,.025],[.3,0,.025]],.006);
  for (const x of [.1,.22,.34]) roller(arm,.025,.44,silver,x,.01);
  const fly = [wheelShaft(arm,.43,.055,{n:4,r:.05,w:.065,span:.32,colors:[0xe97422]}),wheelShaft(arm,.43,-.055,{n:4,r:.05,w:.065,span:.32,colors:[0xe97422]})];
  for (const z of [-.26,.26]) {
    box(arm,.065,.055,.045,black,.025,0,z);
    for (const dy of [-.022,.022]) bar(arm,[.025,dy,z],[.43,.055+dy,z],.008,black);
    roller(arm,.022,.015,silver,.025,0,z); roller(arm,.022,.015,silver,.43,.055,z);
  }
  box(arm,.39,.005,.43,mat(0xab956a),.22,-.056,0);
  for (const z of [-.252,.252]) decal(arm,'MECHANICAL ADVANTAGE',{w:.31,h:.04,x:.22,y:.0,z,rotY:z>0?0:Math.PI});
  const backpack = pivot(arm,.48,.12);
  box(backpack,.015,.23,.38,black,0,.12,0);
  roller(backpack,.025,.36,silver,0,.25);
  const climb = new THREE.Group(); arm.add(climb);
  for (const z of [-.29,.29]) {
    bar(arm,[0,-.07,z],[.56,-.07,z],.025,blue);
    hook(climb,.23,-.1,z,.1,silver,-1,.01);
  }
  const held = pivot(arm,.2,0);
  const shot = pivot(arm,.46,0);
  const intake = new THREE.Object3D(); intake.position.set(-.413,.063,0); visual.add(intake);
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[-.12,.3,.27],
    flow:{intake:()=>[...underBumperEntry(k,.0254),flowAt(k,held,0,0,0)],stow:()=>flowAt(k,held,0,0,0),feed:()=>[flowAt(k,held,0,0,0),flowAt(k,shot,0,0,0)]},
    update(s) {
      base.update(s);fallbackIntake?.update(s);
      arm.rotation.z = animated() ? s.climb > 0 ? THREE.MathUtils.degToRad(s.climb > .5 ? 105 : 88) : (s.amp ?? s.passing) ? THREE.MathUtils.degToRad(110) : s.aiming || s.firing > 0 ? s.hood : THREE.MathUtils.degToRad(5.8) : 0;
      backpack.rotation.z = animated() && (s.amp ?? s.passing) ? -.5 : 0;
      climb.position.x = animated() && s.climb > .5 ? .4 : 0;
      for(const w of fly)w.rotation.z -= (s.enabled?50:0)*s.dt;
    },
  };
}
