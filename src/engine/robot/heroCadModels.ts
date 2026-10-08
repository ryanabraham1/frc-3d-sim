import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/** Mantis source axes (-Y,Z,-X), meters. Joint centers measured from source shafts. */
export function buildHeroCad(_id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number,number,number], parts: string[], parent: THREE.Object3D = root) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); parent.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o=get(part); if(o)g.attach(o); }
    return g;
  };
  const fold = pivot('fold',[.3048,.6223,0],['magazine','shooter','turret','hood','flywheel']);
  const turret = pivot('turret',[.155,.6501,0],['turret','hood','flywheel']);
  fold.attach(turret);
  const hood = pivot('hood',[.0554,.72425,0],['hood']); turret.attach(hood);
  const flywheel = pivot('flywheel',[.048,.72425,0],['flywheel']); turret.attach(flywheel);
  const left = pivot('intake-left',[0,.24003,-.18415],['intake-left']);
  const right = pivot('intake-right',[0,.24003,.18415],['intake-right']);
  const stages = ['climb-mid1','climb-mid2','climb-end','climb-pad'].map(get);
  const stageY = stages.map(o=>o?.position.y??0);
  const contact=new THREE.Object3D(); contact.name='mantis-climb-contact'; contact.position.set(-.1423,.80,0); root.add(contact);
  const pad=get('climb-pad'); if(pad)pad.attach(contact);
  const tip=new THREE.Object3D(); tip.position.set(0,.10,-.53);root.add(tip);left.attach(tip);
  let deploy=0, folding=0, extension=0, pitch=0;
  return {
    replaces:['chassis','hopper','launcher','climber','intakeRollers','funnel'],
    intakeAnchor:tip,climbAnchor:contact,lightAt:[-.26,.53,.08],
    update(s) {
      if(!animated())return;
      deploy=scoringEase(deploy,s.enabled && !s.climb?1:0,s.dt);
      folding=scoringEase(folding,s.climb>0?1:0,s.dt);
      // The exported side four-bars are retracted. Travel is fitted to floor roller contact [EST].
      left.rotation.x=-deploy*.82; right.rotation.x=deploy*.70;
      fold.rotation.z=folding*1.55;
      turret.rotation.y=k.turret.rotation.y;
      pitch=scoringEase(pitch,s.aiming?THREE.MathUtils.clamp(s.hood,.26,1.22)-.85:0,s.dt);
      hood.rotation.z=pitch;
      flywheel.rotation.z+=(s.enabled&&(s.aiming||s.firing>0)?45:0)*s.dt;
      extension=scoringEase(extension,s.climb>.6?.97:s.climb>0?.16:0,s.dt);
      stages.forEach((o,i)=>{if(o)o.position.y=stageY[i]+extension*[1/3,2/3,1,1][i];});
    },
  };
}
