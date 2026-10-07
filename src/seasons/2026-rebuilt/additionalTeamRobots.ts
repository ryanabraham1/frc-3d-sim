import { scoringApproach } from '@engine/robot/scoringReadiness';
import { adaptedDumper } from '@engine/robot/adaptedCadParts';
import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, deployableIntake, drivebase, fillBlock, flowAt, hoodShell, hopperStow, hopperWalls, lattice, mat, overBumperIntake, type ModelKit, pivot, registerRobotModel, roller, sidePlates, spin, tubeMat } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { hoodFor } from '@engine/robot/turretShooter';
import { inch } from '@engine/units';
import { launcherExitOffsets } from '@engine/robot/config';
import { slidingHopper } from '@engine/robot/slidingHopper';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';

// Spectrum row 24, 1678-26c-0000 CAD Release: expanding rectangular hopper and full-width drum.
// https://1678.onshape.com/documents/acdaaf42764a293a9452326d/w/f887ef4c6a254c09c73344c3/e/a9684fa7665096e977b19c44
// Chassis aim, rear slapdown intake/front drum; black/silver frame. Capacity/rate remain simulator estimates.
registerRobotModel('limestone-1678', (k: ModelKit) => {
  const color = 0x34383b;
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const black = mat(0x16191d), accent = tubeMat(color), smoke = mat(0x64707b, { opacity: 0.35 });
  const db = drivebase(k, { motorRing: color });
  hopperWalls(k.visual, { intakeSide: k.groundSide, floorDepth: .12, x: -L * 0.08, y0: bt, length: L * 0.8, width: W * 0.94, height: H - bt - 0.06, m: smoke });
  const fill = fillBlock(k.visual, { x: -L * 0.08, y0: bt + 0.02, length: L * 0.78, width: W * 0.92, height: c.hopperExpansion!.fullHeight - bt - 0.07, color: 0xf2c200, capacity: c.hopperCapacity });
  const roof = new THREE.Group(); k.visual.add(roof);
  let net: THREE.LineSegments | undefined;
  {
    roof.name = 'telescoping-hopper-roof';
    for (const x of [-L * 0.45,L * 0.18]) for (const sign of [-1,1]) {
      const z = sign * W * 0.46;
      // Nested 1×2 and .75×1.5 tubes, with black slider collars.
      box(k.visual,0.025,H-bt-0.07,0.05,accent,x,(H+bt-0.07)/2,z);
      box(k.visual,0.035,0.025,0.057,black,x,H-0.09,z);
      const rail = new THREE.Group(); roof.add(rail);
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
  {
    const head = pivot(t, 0, 0);
    const width = W * 0.88;
    sidePlates(head, [[-0.12,-0.07],[0.08,-0.07],[0.13,0.05],[0.02,0.15],[-0.12,0.12]], width / 2, black, [[-0.07,0.03,0.025],[0.02,0.09,0.023]]);
    for (const sign of [-1,1]) {
      motor(head,-0.075,-0.015,sign*(width/2+.046));
      belt(head,[-.075,-.015],[.01,.015],sign*(width/2+.018));
      fasteners(head,[[-.1,-.045],[-.1,.095],[.07,-.045],[.095,.045]],sign*(width/2+.008));
    }
    // Exposed hood adjustment screw and clevis.
    bar(head,[-.1,.075,width/2+.01],[.02,.13,width/2+.01],.009,mat(0xbac1c8,{metal:.8}));
    wheels.push(roller(head, 0.055, width, black, 0.01,0.015));
    const hood = pivot(head,0.01,0.015); hoodShell(hood,0.065,width,black); hoods.push(hood);
  }
  // The front roof beam is the shallow triangular pocketed panel visible in the CAD.
  lattice(k.visual,[L*.2,H-.12,-W*.46],[0,0,W*.92],[0,.09,0],{cells:5,w:.013,m:accent,zig:true});
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: 2, width: W * 0.9, frame: accent, stow: Math.PI * .95, rollerMaterial: black });
  const slide = slidingHopper(k);
  let deploy = 0, hood = 0, roofLift = 0;
  camera(k.visual,L*.4,bt+.08,W*.35);
  const r = inch(5.91) / 2;
  const pile = hopperStow({ x: -L * 0.08, y0: bt + 0.02, length: L * 0.72, width: W * 0.86, height: H - bt - 0.07, r });
  return { replaces: ['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    flow: {
      intake: overBumperIntake(k, intake.tip, r),
      stow: pile.stow,
      // Along Limestone's floor to the front drum.
      feed: (shot = 0) => {
        const exits = launcherExitOffsets(c), z = -exits[shot % exits.length];
        const head = wheels[0];
        return [new THREE.Vector3(-L * 0.35, bt + 0.04 + r, z), new THREE.Vector3(L * 0.22, bt + 0.05 + r, z * 0.4), flowAt(k, head, -0.09, -0.02, z), flowAt(k, head, 0.02, 0.04, z)];
      },
    },
    update(s) {
      db.update(s); fill.set(s.fill); pile.setFill(s.fill);
      deploy = approach(deploy, !s.enabled ? 0 : s.firing > 0 ? 0.35 : 1, 6, s.dt); { const dv = deploy; intake.update(s, dv); slide.set(dv, s.fill); }
      {
        // The driver toggle controls the same raised envelope as collision/routing.
        const e = c.hopperExpansion!;
        const load = s.blocker;
        // The telescoping rails creep up (and settle back) instead of jumping a step per FUEL.
        const lift = (e.fullHeight-H)*load;
        roofLift = s.dt > 0 ? approach(roofLift,lift,6,s.dt) : lift;
        if (Math.abs(roofLift-lift) < 1e-4) roofLift = lift;
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
      // Hood folds flat when idle and swings to the solved angle while aiming (see turretShooter).
      hood = scoringApproach(hood, s.aiming || s.firing > 0 ? hoodFor(s.hood) : -0.35, 5, s.dt); for (const h of hoods) h.rotation.z = hood;
      for (const w of wheels) spin(w, s.enabled ? 40 + 60 * s.firing : 0, s.dt);
    } };
});

// Spectrum row 44, use ReBlitz (dfb391...), not the separate original Blitz assembly.
// https://2910.onshape.com/documents/dfb391aac173a4555d00a5b5/w/3dc64f602735252892b0e47b/e/6c654da4eb6b1710fb0900bd
// Chassis aim, hard roof, broad drum, rising conveyor; silver/black and green rollers; no climber.
registerRobotModel('reblitz-2910', (k: ModelKit) => {
  const c=k.config,L=c.frameLength,W=c.frameWidth,H=c.height,bt=c.bumperTop;
  const silver=tubeMat(0xbcc4cd),black=mat(0x181b20),clear=mat(0xbac5cd,{opacity:.25}),green=mat(0x37963c);
  const db=drivebase(k,{motorRing:0x37963c});
  hopperWalls(k.visual,{intakeSide:k.groundSide,floorDepth:.12,x:-L*.08,y0:bt,length:L*.82,width:W*.94,height:H-bt-.06,m:clear});
  const fill=fillBlock(k.visual,{x:-L*.08,y0:bt+.02,length:L*.78,width:W*.88,height:H-bt-.08,color:0xf2c200,capacity:c.hopperCapacity});
  box(k.visual,L*.75,.006,W*.93,clear,-L*.1,H-.035,0);
  // Full-height cheek plates follow the sloping intake roof and support the drum bearings.
  sidePlates(k.visual,[[-L*.44,bt+.02],[L*.4,bt+.02],[L*.4,H-.04],[-L*.16,H-.04],[-L*.44,H-.16]],W*.46,clear);
  for(const sign of [-1,1]) {
    bar(k.visual,[-L*.44,bt,sign*W*.46],[L*.4,H-.04,sign*W*.46],.018,silver);
    bar(k.visual,[L*.4,bt,sign*W*.46],[L*.4,H-.04,sign*W*.46],.025,silver);
  }
  const drum=pivot(k.visual,L*.31,H-.11);
  sidePlates(drum,[[-.14,-.09],[.11,-.09],[.14,.04],[.04,.12],[-.14,.12]],W*.44,black,[[0,0,.04]]);
  const fly=roller(drum,.055,W*.87,silver,.01,.015);
  const overspeed=roller(drum,.076,.025,mat(0xb7a146,{metal:.8}),-.05,.02,W*.47);
  const hood=pivot(drum,.01,.015);hoodShell(hood,.065,W*.87,black);
  for(const sign of [-1,1]) {motor(drum,-.075,-.015,sign*W*.47);belt(drum,[-.075,-.015],[.01,.015],sign*W*.455);}
  const cadShooter=adaptedDumper(k.visual,{x:L*.31+.01,y:H-.065,width:W*.90,color:0x8f969e});
  drum.visible=!cadShooter;
  const conveyor: THREE.Group[]=[];
  for(let i=0;i<7;i++) {
    const x=-L*.4+i*L*.095,y=bt+.035+i*.012;
    conveyor.push(roller(k.visual,.019,W*.86,green,x,y));
    if(i<6) belt(k.visual,[x,y],[x+L*.095,y+.012],W*.44,.012);
  }
  const intake=deployableIntake(k,{reach:c.intake.reach,rollers:2,width:W*.9,frame:silver,stow:Math.PI*.95,rollerMaterial:green});
  const slide = slidingHopper(k);
  const r=inch(5.91)/2,pile=hopperStow({x:-L*.08,y0:bt+.02,length:L*.72,width:W*.86,height:H-bt-.08,r});
  let deploy=0,angle=0;
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    flow:{intake:overBumperIntake(k,intake.tip,r),stow:pile.stow,
      feed:(shot=0)=>{const exits=launcherExitOffsets(c),z=-exits[shot%exits.length];return [new THREE.Vector3(-L*.35,bt+.04+r,z),new THREE.Vector3(L*.22,bt+.12+r,z),flowAt(k,cadShooter?.flywheel ?? fly,-.09,-.02,z),flowAt(k,cadShooter?.flywheel ?? fly,.02,.04,z)];}},
    update(s){cadShooter?.update(s);db.update(s);fill.set(s.fill);pile.setFill(s.fill);
      deploy=approach(deploy,!s.enabled?0:s.firing>0?.35:1,6,s.dt);{ const dv = deploy; intake.update(s, dv); slide.set(dv, s.fill); }
      angle=scoringApproach(angle,s.aiming||s.firing>0?hoodFor(s.hood):-.35,5,s.dt);hood.rotation.z=angle;
      for(const wheel of [fly,overspeed,...conveyor])spin(wheel,s.enabled?40+60*s.firing:0,s.dt);
    }};
});

// Spectrum row 15, 2026 971 Robot Mixtape Public Release: two black turret pods, clear rear hopper,
// full-width silver truss deck and angled side supports. One simulation aim is shared by both heads.
// https://frc971.onshape.com/documents/cabaa0c1c77517916df80783/w/48cb057db38a03cc202ff44e/e/96844befd4591dac162d657b
registerRobotModel('mixtape-971', (k: ModelKit) => {
  const c=k.config,L=c.frameLength,W=c.frameWidth,H=c.height,bt=c.bumperTop;
  const silver=tubeMat(0xbcc4cd),black=mat(0x15181c),clear=mat(0xdde5ec,{opacity:.25});
  const db=drivebase(k,{motorRing:0xbcc4cd});
  // Retaining walls behind the heads stay open at the shooter end.
  hopperWalls(k.visual,{intakeSide:k.groundSide,floorDepth:.12,x:-L*.18,y0:bt,length:L*.55,width:W*.92,height:H-bt-.035,m:clear});
  const fill=fillBlock(k.visual,{x:-L*.18,y0:bt+.02,length:L*.5,width:W*.86,height:H-bt-.06,color:0xf2c200,capacity:c.hopperCapacity});
  for(const sign of [-1,1]) {
    const z=sign*W*.46;
    lattice(k.visual,[-L*.44,bt,z],[L*.88,0,0],[0,H-bt-.08,0],{cells:4,w:.014,m:silver,zig:true});
    bar(k.visual,[-L*.44,bt,z],[-L*.44,H-.035,z],.02,silver);
  }
  lattice(k.visual,[L*.34,bt,-W*.46],[0,0,W*.92],[0,.12,0],{cells:5,w:.014,m:silver,zig:true});
  const wheels:THREE.Group[]=[],heads:THREE.Group[]=[],hoods:THREE.Group[]=[];
  for(const sign of [-1,1]) {
    const x=L*.23,z=sign*W*.24;
    // Each turret ring sits on a frame-connected deck; yaw happens about this ring.
    box(k.visual,.27,.009,W*.42,silver,x,H-.13,z);
    for(const sx of [-1,1])bar(k.visual,[x+sx*.11,bt,z],[x+sx*.11,H-.13,z],.018,silver);
    const head=pivot(k.visual,x,H-.11,z);heads.push(head);
    const ring=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.025,28),black);head.add(ring);
    sidePlates(head,[[-.14,-.005],[.13,-.005],[.15,.08],[.05,.18],[-.13,.12]],.1,black,[[-.04,.065,.026]]);
    const fly=roller(head,.055,.19,black,.03,.08);wheels.push(fly);
    motor(head,-.08,.04,sign*.145);belt(head,[-.08,.04],[.03,.08],sign*.12);
    const hood=pivot(head,.03,.08);hoodShell(hood,.067,.19,black);hoods.push(hood);
    box(head,.16,.006,.19,black,-.045,.015,0);
  }
  const intake=deployableIntake(k,{reach:c.intake.reach,rollers:2,width:W*.9,frame:silver,stow:Math.PI*.95,rollerMaterial:black});
  const slide = slidingHopper(k);
  const r=inch(5.91)/2,pile=hopperStow({x:-L*.18,y0:bt+.02,length:L*.5,width:W*.86,height:H-bt-.06,r});
  let deploy=0,angle=0;
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    flow:{intake:overBumperIntake(k,intake.tip,r),stow:pile.stow,
      feed:(shot=0)=>{const i=shot%heads.length,z=heads[i].position.z;return [new THREE.Vector3(-L*.2,bt+.04+r,z),new THREE.Vector3(L*.1,bt+.05+r,z),flowAt(k,wheels[i],-.08,-.02,0),flowAt(k,wheels[i],.02,.04,0)];}},
    update(s){db.update(s);fill.set(s.fill);pile.setFill(s.fill);
      deploy=approach(deploy,!s.enabled?0:s.firing>0?.35:1,6,s.dt);{ const dv = deploy; intake.update(s, dv); slide.set(dv, s.fill); }
      angle=scoringApproach(angle,s.aiming||s.firing>0?hoodFor(s.hood):-.35,5,s.dt);
      for(const head of heads)head.rotation.y=k.turret.rotation.y;
      for(const hood of hoods)hood.rotation.z=angle;
      for(const wheel of wheels)spin(wheel,s.enabled?40+60*s.firing:0,s.dt);
    }};
});

export function additionalRebuiltTeamRobots(): TeamRobot[] {
  return [
    { id: 'reblitz-2910', team: 2910, name: 'Re•Blitz',
      description: '2910 Jack in the Bot (Einstein finalists). Champs rebuild: hard-roof hopper, roller floor, wide drum shooter with an overspeed flywheel and pivoting intake that compresses the hopper. No climber. Simulator tuning: 33 FUEL/s and 40 capacity (user estimates of 30–35 FUEL/s and ~40 balls), 5.3 m/s drive.',
      source: 'https://www.chiefdelphi.com/t/2910-robot-reveal-2026-blitz/516325?page=5 — Champs rebuild team Q&A; frcteam2910.org 2026 recap',
      config: config(2910,'reblitz-2910',false,40,33,5.3,90) },
    { id: 'limestone-1678', team: 1678, name: 'Limestone',
      description: '1678 Citrus Circuits. Wide chassis-aimed drum shooter, slapdown intake and vertically expanding net hopper. 27 × 27 in frame. 60 FUEL with the hopper raised. Simulator estimates: 24 FUEL/s, 4.7 m/s drive; F toggles hopper capacity between 40 and 60 FUEL.',
      source: 'https://www.chiefdelphi.com/t/1678-2026-robot-limestone/515709 — reveal and team hopper/CAD discussion',
      config: config(1678,'limestone-1678',false,60,24,4.7,88) },
    { id: 'mixtape-971', team: 971, name: 'Mixtape',
      description: '971 Spartan Robotics. Twin turret flywheel shooter; compact precision-cycling alternative to wide drum dumpers. 33 FUEL capacity (user tuning). Simulator estimates: 16 FUEL/s combined, 5.0 m/s drive. Both heads share simulated aim and alternate shots from their own turret throats.',
      source: 'https://www.chiefdelphi.com/t/frc-971-spartan-robotics-2026-robot-reveal-mixtape/515582; https://github.com/frc971/971-second-robot-2026',
      config: config(971,'mixtape-971',true,33,16,5.0,92) },
  ];
}

// [EST] performance tuning; chassis dimensions for 1678 are published.
function config(team: number, model: string, turret: boolean, capacity: number, rate: number, speed: number, accuracy: number) {
  const c = build({ intake: 'both', aim: turret ? 'turret' : 'align', dumper: !turret, hopper: capacity, tall: false, rate, climb: 0 });
  if (team === 2910) { c.frameLength = .6985; c.height = .55; } // Supplied Robot 2 frame and roof envelope.
  if (team === 971) { c.frameLength = .6223; c.frameWidth = .762; c.height = .55; /* CAD compact envelope: 0.54465 m; raised shooting hood is not travel height. */ }
  c.teamNumber = team; c.model = model; c.maxSpeed = speed; c.maxAccel = team === 2910 ? 11 : team === 1678 ? 9 : 10;
  if (team === 1678) { c.frameLength = c.frameWidth = inch(27); c.hopperExpansion = { startCount: 40, fullHeight: inch(29), mechanism: 'telescoping' }; }
  if (team === 971) {
    c.launcher.mounts = [1,-1].map(sign => ({ forward: c.frameLength * .23, side: sign * c.frameWidth * .24 }));
    c.launcher.muzzleForward = .05;
  }
  if (!turret) c.launcher.exitSpan = .6; // FUEL centers clear the drum cheek plates.
  setRebuiltAccuracy(c,accuracy);
  return normalizeRebuiltConfig(c);
}
