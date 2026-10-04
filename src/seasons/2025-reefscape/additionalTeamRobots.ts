import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, battery, box, controller, decal, climberHooks, deployableIntake, drivebase, mat, pivot, registerRobotModel, roller, sidePlates, spin, tubeMat } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { inch } from '@engine/units';
import { build, normalizeReefscapeConfig } from './config';

// Three different end-effector layouts, with rules-driven placement anchors.
for (const [id, color, style] of [
  ['whisper-1690', 0x30343b, 'vacuum'],
  ['lightning-2056', 0xc4cbd3, 'gripper'],
  ['firefly-118', 0xd9b549, 'dual'],
] as const) registerRobotModel(id, k => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, H = c.height, bt = c.bumperTop;
  const metal = tubeMat(color), black = mat(0x15181c), silver = mat(0xc4cbd3, { metal: 0.7 });
  const db = drivebase(k, { motorRing: color });
  box(k.visual, L * 0.92, 0.01, W * 0.88, black, 0, bt, 0);
  const ex = style === 'vacuum' ? -0.12 : 0.03, ez = style === 'dual' ? 0.2 : 0.14;
  const stages: THREE.Group[] = [];
  for (let i = 0; i < (style === 'gripper' ? 2 : 3); i++) {
    const g = new THREE.Group(); k.visual.add(g); stages.push(g);
    for (const z of [-1,1]) bar(g, [ex + i * 0.025, bt + 0.025, z * (ez - i * 0.025)], [ex + i * 0.025, H - 0.03, z * (ez - i * 0.025)], 0.03 - i * 0.003, metal);
    bar(g, [ex + i * 0.025, H - 0.03, -ez + i * 0.025], [ex + i * 0.025, H - 0.03, ez - i * 0.025], 0.02, metal);
    for(const sign of [-1,1]) {
      const z=sign*(ez-i*.025);
      belt(g,[ex+i*.025,bt+.06],[ex+i*.025,H-.06],z+sign*.022,.016);
      for(const y of [bt+.06,H-.06]) {
        box(g,.07,.05,.009,black,ex+i*.025,y,z+sign*.035);
        fasteners(g,[[ex+i*.025-.023,y-.015],[ex+i*.025+.023,y+.015]],z+sign*.043);
      }
    }
  }
  for (const z of [-1,1]) bar(k.visual, [-L * 0.36, bt, z * W * 0.35], [ex, H * 0.7, z * ez], 0.02, metal);
  battery(k.visual,-L*.3,bt+.025,-W*.22);
  for(let i=0;i<3;i++) controller(k.visual,-L*.15+i*.065,bt+.025,W*.28,0x46ca79);
  camera(k.visual,L*.36,bt+.09,-W*.3);
  for(const sign of [-1,1]) motor(k.visual,ex,bt+.09,sign*(ez+.055));
  if(style === 'vacuum') {
    for(const sign of [-1,1]) {
      box(k.visual,.27,.2,.007,black,-L*.2,bt+.14,sign*W*.43);
      decal(k.visual,'ORBIT',{w:.22,h:.08,x:-L*.2,y:bt+.17,z:sign*(W*.43+.004),rotY:sign===1?0:Math.PI});
    }
  } else if(style === 'dual') {
    // Broad gold bracing and a separate black funnel around the CORAL channel.
    for(const sign of [-1,1]) {
      bar(k.visual,[-L*.35,bt,sign*W*.4],[ex,H-.08,sign*ez],.027,metal);

    }
  }
  if(style === 'dual') sidePlates(k.visual,[[ex-.18,bt+.08],[ex+.16,bt+.08],[ex+.07,bt+.3],[ex-.12,bt+.3]],W*.31,black,[[ex,bt+.18,.055]]);
  const carriage = pivot(k.visual, ex, 0.45);
  const arm = box(carriage, 1, 0.03, style === 'vacuum' ? 0.04 : 0.12, style === 'vacuum' ? black : metal);
  const tip = pivot(carriage, 0.3, 0);
  const wrist = pivot(tip, 0, 0);
  const rollers: THREE.Group[] = [];
  if (style === 'vacuum') {
    const cup = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.045, 24, 1, true), mat(0x285ac6));
    cup.rotation.z = -Math.PI / 2; cup.position.x = 0.025; wrist.add(cup);
    bar(wrist, [-0.09,0,0], [0,0,0], 0.028, black);
    // Pneumatic hose runs along the carbon arm to the bellows cup.
    bar(carriage,[0,.027,.025],[.28,.027,.025],.007,mat(0x386fc7));
    for(let i=0;i<4;i++) {
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.045+i*.007,.004,6,20),mat(0x315eb1));
      ring.rotation.y=Math.PI/2; ring.position.x=.008+i*.009; wrist.add(ring);
    }
    // Vacuum pump's alternating cylinders on the bellypan.
    for (const z of [-0.12,0.12]) box(k.visual, 0.22, 0.05, 0.045, silver, -L * 0.2, bt + 0.045, z);
  } else {
    sidePlates(wrist, [[-0.09,-0.07],[0.06,-0.07],[0.1,0.02],[0.06,0.09],[-0.09,0.09]], 0.13, silver, [[-0.02,0,0.025]]);
    rollers.push(roller(wrist, 0.035, 0.23, black, 0.025, 0.06), roller(wrist, 0.035, 0.23, black, 0.025, -0.05));
    if (style === 'dual') {
      // Separate ALGAE rollers below the CORAL channel.
      for (const z of [-0.12,0.12]) rollers.push(roller(wrist, 0.05, 0.045, mat(0x188a53), -0.02, -0.13, z));
    }
  }
  if(style !== 'vacuum') for(const sign of [-1,1]) {
    motor(wrist,-.055,.015,sign*.17,style==='dual'?0xe9bf38:0x3aba70);
    belt(wrist,[-.055,.015],[.025,.06],sign*.145,.02);
    fasteners(wrist,[[-.065,-.045],[-.065,.07],[.065,.025]],sign*.137);
  }
  const held = pivot(wrist, 0, 0);
  const intake = deployableIntake(k, { reach: c.intake.reach, rollers: style === 'dual' ? 3 : 2, frame: metal, rollerMaterial: style === 'vacuum' ? mat(0x309f50) : black });
  const hooks = climberHooks(k.visual, { x: -L * 0.3, y0: bt, length: H - bt - 0.1, spread: W * 0.6, m: metal, hook: black });
  let y = 0.45, forward = 0.3, pitch = 0, deploy = 0;
  return { replaces: ['chassis','mast','launcher','hopper','intakeRollers','climber','funnel'], heldAnchor: held,
    update(s) {
      const p = s.place ?? { height: 0.45, forward: 0.3, level: 1 };
      y = approach(y, p.height, 14, s.dt); forward = approach(forward, p.forward, 14, s.dt);
      const extension = Math.max(0, y - H + 0.15);
      stages[1].position.y = extension * (stages.length === 2 ? 1 : .5); if(stages[2]) stages[2].position.y = extension;
      carriage.position.y = y;
      const reach = Math.max(0.06, forward - ex);
      arm.scale.x = reach; arm.position.x = reach / 2; tip.position.x = reach;
      pitch = approach(pitch, p.level === 4 ? -1.25 : p.level === 1 ? 0 : -0.55, 10, s.dt); wrist.rotation.z = pitch;
      deploy = approach(deploy, s.enabled && s.intaking ? 1 : 0, 7, s.dt);
      intake.update(s, deploy); hooks.set(s.climb); db.update(s);
      for (const r of rollers) spin(r, s.intaking ? 25 : s.firing > 0 ? -30 : 0, s.dt);
    } };
});

export function additionalReefscapeTeamRobots(): TeamRobot[] {
  return [
    { id: 'whisper-1690', team: 1690, name: 'WHISPER',
      description: '1690 Orbit. Elevator and carbon arm with a vacuum end effector for CORAL and ALGAE, floor pickup and deep climb. Simulator estimates: 2.2 m/s lift, 0.30 s release, 0.35 s harvest and 5.4 m/s drive.',
      source: 'https://www.chiefdelphi.com/t/orbit-1690-2025-robot-reveal-whisper/492064 — reveal and team vacuum-system Q&A',
      config: config(1690, 'whisper-1690', 2.2, 0.30, 0.35, 5.4, 2.5, 36) },
    { id: 'lightning-2056', team: 2056, name: 'LIGHTNING',
      description: '2056 OP Robotics. Two-stage continuous-belt elevator, pivoting CORAL/ALGAE gripper and retracting floor intake; all REEF levels, NET, PROCESSOR and deep climb. 15 ft/s drive; full elevator travel in about 0.6 s. Simulator tuning: 2.5 m/s lift, 0.40 s release, 0.45 s harvest.',
      source: 'https://2056.ca/wp-content/uploads/2025/05/OPR25-2056-Technical-Binder.pdf',
      config: config(2056, 'lightning-2056', 2.5, 0.40, 0.45, 4.572, 3.0, 40) },
    { id: 'firefly-118', team: 118, name: 'Firefly',
      description: '118 Robonauts. Rigid elevator with separate CORAL and ALGAE roller channels, floor pickup, L1–L4, NET, PROCESSOR and deep cage climb. Simulator estimates: 1.9 m/s lift, 0.25 s release, 0.30 s harvest, 4.9 m/s drive and 2.0 s climb.',
      source: 'https://www.chiefdelphi.com/t/2025-robonauts-cad-and-code-release/502317 — Firefly technical binder and mechanism discussion',
      config: config(118, 'firefly-118', 1.9, 0.25, 0.30, 4.9, 2.0, 40) },
  ];
}

// Unpublished timings/dimensions are [EST]; 2056 drive speed is from its binder.
function config(team: number, model: string, lift: number, release: number, harvest: number, speed: number, climb: number, height: number) {
  const c = build({ coral: 'l4', intake: 'ground', algae: 'reefGround', algaeScore: 'both', climb: 2, align: true });
  c.teamNumber = team; c.model = model; c.height = inch(height); c.maxSpeed = speed;
  c.placement!.liftSpeed = lift; c.placement!.cycleSeconds = release; c.placement!.harvestSeconds = harvest;
  c.climber.secondsToClimb = climb;
  return normalizeReefscapeConfig(c);
}
