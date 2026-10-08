import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';
import { buildConstantineCad } from './heroConstantineCad';

/** Mantis source axes (-Y,Z,-X), meters. Joint centers measured from source shafts. */
export function buildHeroCad(_id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  if (_id === 'hero-constantine-1318') return buildConstantineCad(root, k, animated);
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
  // Both physical side mouths collect, so mark both roller bars like the engine's orange ground intake.
  const orange=new THREE.MeshStandardMaterial({color:0xff7a1a,roughness:.55,emissive:0xff5a00,emissiveIntensity:.25});
  for(const [pv,sign] of [[left,-1],[right,1]] as const){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.56,12),orange);
    bar.rotation.z=Math.PI/2; bar.position.set(0,.10,sign*.53); root.add(bar); pv.attach(bar);
  }
  // Held SPEECH BUBBLES ride in the spindexer (visual only), so the driver can see the load. Shown by fill = held/capacity.
  const r=.0889, ballMat=new THREE.MeshStandardMaterial({color:k.alliance==='red'?0xe83d4f:0x337fe8,roughness:.7});
  const ballGeo=new THREE.SphereGeometry(r*.95,14,10), COUNT=6;
  const balls=Array.from({length:COUNT},(_,n)=>{
    const a=n/COUNT*Math.PI*2, m=new THREE.Mesh(ballGeo,ballMat);
    m.position.set(.04+Math.cos(a)*.19,.22,Math.sin(a)*.19); m.visible=false; root.add(m); return m;
  });
  let deploy=0, folding=0, extension=0, pitch=0;
  return {
    replaces:['chassis','hopper','launcher','climber','intakeRollers','funnel'],
    intakeAnchor:tip,climbAnchor:contact,lightAt:[-.26,.53,.08],
    update(s) {
      const shown=Math.round(s.fill*COUNT); balls.forEach((b,n)=>b.visible=n<shown);
      if(!animated())return;
      deploy=scoringEase(deploy,s.enabled && !s.climb?1:0,s.dt);
      folding=scoringEase(folding,s.climb>0?1:0,s.dt);
      // The exported side four-bars are retracted. Travel is fitted to floor roller contact [EST].
      left.rotation.x=-deploy*.82; right.rotation.x=deploy*.70;
      fold.rotation.z=folding*1.55;
      // The exported shooter exits toward -x: the flywheel (x .048) and hood roller (x .195, above it) pinch the ball
      // up and back, away from the feed at the turret axis (x .155). Turn it half a revolution so it faces the target.
      turret.rotation.y=k.turret.rotation.y+Math.PI;
      // Raising the hood pivots it clockwise about the flywheel; the exported nip sits at ~52 degrees [EST from CAD].
      pitch=scoringEase(pitch,s.aiming?-(THREE.MathUtils.clamp(s.hood,.26,1.22)-.913):0,s.dt);
      hood.rotation.z=pitch;
      flywheel.rotation.z+=(s.enabled&&(s.aiming||s.firing>0)?45:0)*s.dt;
      extension=scoringEase(extension,s.climb>.6?.97:s.climb>0?.16:0,s.dt);
      stages.forEach((o,i)=>{if(o)o.position.y=stageY[i]+extension*[1/3,2/3,1,1][i];});
    },
  };
}
