import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, deployableIntake, drivebase, fillBlock, hoodShell, hopperWalls, mat, pivot, registerRobotModel, roller, sidePlates, spin, tubeMat } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { inch } from '@engine/units';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

for (const [id, color, style] of [
  ['reblitz-2910', 0xbcc4cd, 'drum'],
  ['limestone-1678', 0xf2c52b, 'expanding'],
  ['mixtape-971', 0xcc3232, 'dual'],
] as const) registerRobotModel(id, k => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const black = mat(0x16191d), accent = tubeMat(color), smoke = mat(0x64707b, { opacity: 0.35 });
  const db = drivebase(k, { motorRing: color });
  hopperWalls(k.visual, { x: -L * 0.08, y0: bt, length: L * 0.8, width: W * 0.94, height: H - bt - 0.06, m: smoke });
  const fill = fillBlock(k.visual, { x: -L * 0.08, y0: bt + 0.02, length: L * 0.76, width: W * 0.88, height: (style === 'expanding' ? c.hopperExpansion!.fullHeight : H) - bt - 0.09, color: 0xf2c200 });
  const roof = new THREE.Group(); k.visual.add(roof);
  if (style === 'drum') box(roof, L * 0.75, 0.006, W * 0.93, smoke, -L * 0.1, H - 0.035, 0);
  // Mixtape has an open clear hopper, not a mesh lid.
  let net: THREE.LineSegments | undefined;
  const innerRails: THREE.Group[] = [];
  if (style === 'expanding') {
    roof.name = 'telescoping-hopper-roof';
    for (const x of [-L * 0.45,L * 0.18]) for (const sign of [-1,1]) {
      const z = sign * W * 0.46;
      // Nested 1×2 and .75×1.5 tubes, with black slider collars.
      box(k.visual,0.025,H-bt-0.07,0.05,accent,x,(H+bt-0.07)/2,z);
      box(k.visual,0.035,0.025,0.057,black,x,H-0.09,z);
      const rail = new THREE.Group(); roof.add(rail); innerRails.push(rail);
      box(rail,0.019,0.25,0.038,mat(0xc2c8ce,{metal:0.8}),x,H-0.13,z);
      motor(k.visual,x,bt+0.065,z,0xecc62d);
    }
    for (const sign of [-1,1]) bar(roof,[-L*.45,H-.025,sign*W*.46],[L*.18,H-.025,sign*W*.46],.019,accent);
    for (const x of [-L*.45,L*.18]) bar(roof,[x,H-.025,-W*.46],[x,H-.025,W*.46],.019,accent);
    const positions = new Float32Array(17*16*2*2*3*2);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    net = new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x222827}));
    net.name = 'telescoping-hopper-net'; k.visual.add(net);
    // Intake-side retaining net skirts stay tethered to the raised rim.
  }
  for (const z of [-1,1]) bar(k.visual, [-L * 0.46,bt,z * W * 0.46], [-L * 0.46,H - 0.035,z * W * 0.46], 0.024, accent);
  const wheels: THREE.Group[] = [], hoods: THREE.Group[] = [];
  const t = k.turret; t.position.set(L * 0.32,H - 0.1,0);
  const headCount = style === 'dual' ? 2 : 1;
  for (let i = 0; i < headCount; i++) {
    const head = pivot(t, 0, 0); head.position.z = headCount === 2 ? (i ? 1 : -1) * W * 0.24 : 0;
    const width = headCount === 2 ? W * 0.32 : W * 0.88;
    sidePlates(head, [[-0.12,-0.07],[0.08,-0.07],[0.13,0.05],[0.02,0.15],[-0.12,0.12]], width / 2, style === 'dual' ? mat(0xc8cdd2,{metal:0.8}) : black, [[-0.07,0.03,0.025],[0.02,0.09,0.023]]);
    for (const sign of [-1,1]) {
      motor(head,-0.075,-0.015,sign*(width/2+.046));
      belt(head,[-.075,-.015],[.01,.015],sign*(width/2+.018));
      fasteners(head,[[-.1,-.045],[-.1,.095],[.07,-.045],[.095,.045]],sign*(width/2+.008));
    }
    // Exposed hood adjustment screw and clevis.
    bar(head,[-.1,.075,width/2+.01],[.02,.13,width/2+.01],.009,mat(0xbac1c8,{metal:.8}));
    wheels.push(roller(head, 0.055, width, style === 'drum' ? mat(0x929aa5, { metal: 0.8 }) : black, 0.01,0.015));
    const hood = pivot(head,0.01,0.015); hoodShell(hood,0.065,width,black); hoods.push(hood);
    if (headCount === 2) {
      const bearing = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.5,width * 0.5,0.02,24),accent); head.add(bearing);
    }
  }
  if (style === 'drum') {
    const fly = roller(t,0.076,0.025,mat(0xb7a146, { metal: 0.8 }),-0.05,0.02,W * 0.47); wheels.push(fly);
    for (let i = 0; i < 7; i++) {
      const x = -L*.4+i*L*.095, y = bt+.035+i*.012;
      wheels.push(roller(k.visual,.016,W*.86,black,x,y));
      if (i < 6) belt(k.visual,[x,y],[x+L*.095,y+.012],W*.44,.012);
    }
    sidePlates(k.visual,[[-L*.43,bt+.03],[L*.25,bt+.03],[L*.26,H-.07],[-L*.4,H-.12]],W*.45,smoke);
    motor(k.visual,-L*.28,bt+.09,W*.42);
    camera(k.visual,L*.37,bt+.12,-W*.35);
  }
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, width: W * 0.9, frame: accent, stow: Math.PI * .95, rollerMaterial: style === 'drum' ? mat(0x37963c) : black });
  let deploy = 0, hood = 0, roofLift = 0;
  camera(k.visual,L*.4,bt+.08,W*.35);
  return { replaces: ['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    update(s) {
      db.update(s); fill.set(s.fill);
      deploy = approach(deploy, !s.enabled ? 0 : s.firing > 0 ? 0.35 : 1, 6, s.dt); intake.update(s,deploy);
      if (style === 'expanding') {
        // Automatic simulator contract sequence: count controls the same raised envelope as collision/routing.
        const e = c.hopperExpansion!;
        const load = Math.max(0,Math.min(1,(s.fill*c.hopperCapacity-e.startCount)/(c.hopperCapacity-e.startCount)));
        roofLift = (e.fullHeight-H)*load;
        roof.position.y = roofLift;
        const p = net!.geometry.getAttribute('position') as THREE.BufferAttribute;
        let n = 0;
        const point = (u:number,v:number) => {
          const x = -L*.45+u*L*.9;
          // The front section bridges down from the telescoping roof to the fixed shooter/intake frame.
          const blend = u < .7 ? 1 : (1-u)/.3;
          p.setXYZ(n++,x,H-.025+roofLift*blend-.014*Math.sin(Math.PI*u)*Math.sin(Math.PI*v),(v-.5)*W*.92);
        };
        for (let axis=0;axis<2;axis++) for(let line=0;line<=16;line++) for(let step=0;step<16;step++) {
          point(axis ? step/16 : line/16,axis ? line/16 : step/16);
          point(axis ? (step+1)/16 : line/16,axis ? line/16 : (step+1)/16);
        }
        k.visual.updateMatrixWorld(true);
        const lip = k.visual.worldToLocal(intake.tip.getWorldPosition(new THREE.Vector3()));
        const skirtPoint = (u:number,v:number) => p.setXYZ(n++, -L*.45*(1-u)+lip.x*u,
          (H-.025+roofLift)*(1-u)+(lip.y-.03)*u, (v-.5)*W*.92);
        for(let axis=0;axis<2;axis++) for(let line=0;line<=16;line++) for(let step=0;step<16;step++) {
          skirtPoint(axis ? step/16 : line/16,axis ? line/16 : step/16);
          skirtPoint(axis ? (step+1)/16 : line/16,axis ? line/16 : (step+1)/16);
        }
        p.needsUpdate=true; net!.geometry.computeBoundingSphere();
      }
      hood = approach(hood,(s.hood - 1) * 0.7,10,s.dt); for (const h of hoods) h.rotation.z = hood;
      for (const w of wheels) spin(w, s.enabled ? 40 + 60 * s.firing : 0, s.dt);
    } };
});

export function additionalRebuiltTeamRobots(): TeamRobot[] {
  return [
    { id: 'reblitz-2910', team: 2910, name: 'Re•Blitz',
      description: '2910 Jack in the Bot (Einstein finalists). Champs rebuild: hard-roof hopper, roller floor, wide drum shooter with an overspeed flywheel and pivoting intake that compresses the hopper. No climber. Simulator estimates: 28 FUEL/s, 55 capacity, 5.3 m/s drive.',
      source: 'https://www.chiefdelphi.com/t/2910-robot-reveal-2026-blitz/516325?page=5 — Champs rebuild team Q&A; frcteam2910.org 2026 recap',
      config: config(2910,'reblitz-2910',false,55,28,5.3,90) },
    { id: 'limestone-1678', team: 1678, name: 'Limestone',
      description: '1678 Citrus Circuits. Wide chassis-aimed drum shooter, slapdown intake and vertically expanding net hopper. 27 × 27 in frame. Simulator estimates: 100 FUEL, 24 FUEL/s, 4.7 m/s drive; loaded hopper loses trench clearance above 65 FUEL.',
      source: 'https://www.chiefdelphi.com/t/1678-2026-robot-limestone/515709 — reveal and team hopper/CAD discussion',
      config: config(1678,'limestone-1678',false,100,24,4.7,88) },
    { id: 'mixtape-971', team: 971, name: 'Mixtape',
      description: '971 Spartan Robotics. Twin turret flywheel shooter; compact precision-cycling alternative to wide drum dumpers. Simulator estimates: 45 FUEL, 16 FUEL/s combined, 5.0 m/s drive. Both heads share one simulated aim and launch point.',
      source: 'https://www.chiefdelphi.com/t/frc-971-spartan-robotics-2026-robot-reveal-mixtape/515582; https://github.com/frc971/971-second-robot-2026',
      config: config(971,'mixtape-971',true,45,16,5.0,92) },
  ];
}

// [EST] performance tuning; chassis dimensions for 1678 are published.
function config(team: number, model: string, turret: boolean, capacity: number, rate: number, speed: number, accuracy: number) {
  const c = build({ intake: 'both', aim: turret ? 'turret' : 'align', dumper: !turret, hopper: capacity, tall: false, rate, climb: 0 });
  c.teamNumber = team; c.model = model; c.maxSpeed = speed; c.maxAccel = team === 2910 ? 11 : team === 1678 ? 9 : 10;
  if (team === 1678) { c.frameLength = c.frameWidth = inch(27); c.hopperExpansion = { startCount: 65, fullHeight: inch(29), mechanism: 'telescoping' }; }
  setRebuiltAccuracy(c,accuracy);
  return normalizeRebuiltConfig(c);
}
