import * as THREE from 'three';
import type { TeamRobot } from '@engine/core/season';
import { approach, bar, box, climberHooks, drivebase, hoodShell, hook, mat, plate, pivot, registerRobotModel, roller, sidePlates, spin, tubeMat, underBumperIntake } from '@engine/robot/models';
import { belt, camera, fasteners, motor } from '@engine/robot/mechanicalDetail';
import { inch } from '@engine/units';
import { build, normalizeCrescendoConfig } from './config';

// Separate frame, shooter and AMP/TRAP layouts; mechanisms follow the team reveal references.
for (const [id, color, style] of [
  ['madtown-2024-1323', 0x2874db, 'arm'],
  ['twister-118', 0xd7ad42, 'turret'],
  ['tidepod-4414', 0x18a8b4, 'forks'],
] as const) registerRobotModel(id, k => {
  const c = k.config, L = c.frameLength, W = c.frameWidth, bt = c.bumperTop;
  const accent = tubeMat(color), black = mat(0x171a20), silver = mat(0xc5cbd2, { metal: 0.7 });
  const db = drivebase(k, { motorRing: color });
  const intake = underBumperIntake(k, { n: 3, width: c.intake.width });
  box(k.visual, L * 0.9, 0.012, W * 0.85, black, 0, bt, 0);
  const head = k.turret;
  head.position.set(style === 'arm' ? -L*.17 : style === 'forks' ? L*.24 : L*.08, c.launcher.height - (style === 'arm' ? .17 : .08), 0);
  if (style === 'turret') {
    const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 8, 32), silver);
    bearing.rotation.x = Math.PI / 2; head.add(bearing);
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      box(head,.012,.012,.025,accent,Math.cos(a)*.14,-.018,Math.sin(a)*.14);
    }
    motor(head,-.12,-.05,.2);
    for(const sign of [-1,1]) {
      bar(head,[-.18,-.1,sign*.21],[.1,.12,sign*.21],.018,accent);
      bar(head,[-.18,.12,sign*.21],[.1,-.1,sign*.21],.018,accent);
    }
  }
  for (const z of [-0.17, 0.17]) bar(k.visual, [-L * 0.1, bt, z], [L * 0.12, c.launcher.height - 0.08, z], 0.025, accent);
  const shooter = pivot(head, 0, 0.04);
  const gap = style === 'turret' ? .22 : style === 'arm' ? W*.4 : W*.44;
  const pts: [number,number][] = style === 'arm'
    ? [[-.24,-.13],[.13,-.13],[.22,-.02],[.07,.12],[-.22,.05]]
    : style === 'forks' ? [[-.12,-.1],[.2,-.08],[.2,.15],[-.14,.15]]
    : [[-.2,-.1],[.18,-.09],[.23,.05],[.09,.18],[-.16,.16]];
  sidePlates(shooter,pts,gap,style === 'turret' ? accent : style === 'arm' ? black : silver,
    [[-.08,.015,.033],[.015,.03,.028],[.1,.03,.023]]);
  const wheels: THREE.Group[] = [];
  const wheelZ = style === 'turret' ? [-.17,-.07,.07,.17] : [-gap*.66,gap*.66];
  for(const z of wheelZ) for(const y of [-.045,.075]) wheels.push(roller(shooter,style === 'forks' ? .057 : .051,.045,style === 'turret' ? black : mat(0x9a9fa6,{metal:.3}),.12,y,z));
  const hood = pivot(shooter,.08,.035); hoodShell(hood,.07,gap*1.7,silver);
  for(const sign of [-1,1]) {
    motor(shooter,-.09,-.06,sign*(gap+.046));
    belt(shooter,[-.09,-.06],[.12,-.045],sign*(gap+.017));
    belt(shooter,[.12,-.045],[.12,.075],sign*(gap+.017));
    fasteners(shooter,[[-.12,-.065],[-.12,.09],[.16,-.06],[.16,.085]],sign*(gap+.008));
    if(style === 'turret') {
      // Pocketed gold truss cheeks and screw-adjusted hood.
      for(const x of [-.14,-.04,.06]) bar(shooter,[x,-.07,sign*gap],[x+.09,.13,sign*gap],.012,silver);
      bar(shooter,[-.17,.13,sign*(gap+.025)],[.12,.13,sign*(gap+.025)],.008,silver);
    }
  }
  if(style === 'forks') {
    // The rebuilt TIDEPOD carries a broad roller path between tall, rearward-leaning teal side rails.
    for(const sign of [-1,1]) {
      bar(k.visual,[L*.4,bt,sign*W*.46],[-L*.25,c.height,sign*W*.46],.028,accent);
      belt(k.visual,[L*.32,bt+.07],[-L*.22,c.height-.04],sign*W*.47,.018);
    }
    for(let i=0;i<4;i++) roller(k.visual,.025,W*.84,black,-L*.08,bt+.07+i*.06);
    wheels.push(roller(shooter,.026,W*.84,black,-.12,.145),roller(shooter,.026,W*.84,black,-.12,.21));
  }
  if(style === 'arm') {
    // Long blue pocketed rails and black sponsor panels are MadTown's dominant silhouette.
    for(const sign of [-1,1]) {
      plate(k.visual,[[L*.44,bt+.03],[-L*.4,bt+.26],[-L*.4,bt+.32],[L*.44,bt+.09]],.006,accent,sign*W*.44,
        [[-.12,bt+.22,.018],[0,bt+.18,.018],[.12,bt+.14,.018]]);
      box(k.visual,L*.82,.16,.006,black,0,bt+.07,sign*W*.46);
      belt(k.visual,[L*.36,bt+.07],[-L*.35,bt+.28],sign*W*.46,.02);
      bar(k.visual,[L*.25,bt+.03,sign*W*.4],[-L*.27,bt+.28,sign*W*.4],.011,silver);
    }
    // Low, rearward shooter tray and long separate over-the-frame AMP arm.
    box(k.visual,L*.65,.012,W*.7,black,-L*.1,bt+.07,0);
    for(let i=0;i<4;i++) roller(k.visual,.022,W*.62,black,-L*.3+i*.085,bt+.1);
  }
  camera(k.visual,L*.38,bt+.1,-W*.35);
  const amp = pivot(k.visual, style === 'arm' ? L*.12 : -L*.3, bt + (style === 'forks' ? .05 : .2));
  for (const z of [-0.12,0.12]) bar(amp, [0,0,z], [style === 'arm' ? .52 : .38,0,z], 0.025, accent);
  if (style === 'arm') {
    box(amp, 0.26, 0.01, 0.35, black, 0.43, 0.02, 0);
    belt(amp,[0,0],[.43,0],.14);
    motor(amp,0,0,-.18);
    roller(amp, 0.025, 0.28, silver, 0.42, 0.06);
  } else if (style === 'forks') {
    for (const z of [-0.15,0.15]) box(amp, 0.26, 0.016, 0.025, silver, 0.42, 0, z);
  } else {
    sidePlates(amp, [[0.2,-0.04],[0.45,-0.04],[0.45,0.12],[0.2,0.05]], 0.15, silver);
    roller(amp, 0.025, 0.3, black, 0.43, 0.08);
  }
  const hooks = style === 'arm' ? { set(_climb:number) {} } : climberHooks(k.visual, { x: -L * .34, y0: bt, length: c.height - bt, spread: style === 'forks' ? W*.88 : W*.65, m: style === 'forks' ? silver : accent, hook: silver });
  if(style === 'forks') for(const sign of [-1,1]) {
    // TIDEPOD's widely separated uprights and trap forks frame the entire shooter.
    bar(k.visual,[-L*.34,bt,sign*W*.44],[-L*.34,c.height+.09,sign*W*.44],.04,silver);
    hook(k.visual,-L*.34,c.height+.08,sign*W*.44,.09,black);
    belt(k.visual,[-L*.34,bt+.07],[-L*.34,c.height-.02],sign*W*.46,.023);
    motor(k.visual,-L*.34,bt+.08,sign*(W*.44+.04));
  }
  const held = pivot(shooter, 0, 0);
  let tilt = 0, arm = 0;
  return { replaces: ['chassis','launcher','hopper','intakeRollers','climber','funnel'], heldAnchor: held,
    update(s) {
      db.update(s); intake.update(s); hooks.set(s.climb);
      tilt = approach(tilt, s.hood - 0.6, 10, s.dt); shooter.rotation.z = tilt;
      arm = approach(arm, s.passing || s.climb > 0.1 ? 1.45 : style === 'arm' ? 2.8 : 0.1, 7, s.dt); amp.rotation.z = arm;
      for (const w of wheels) spin(w, s.enabled ? 40 + 45 * s.firing : 0, s.dt);
    } };
});

export function additionalCrescendoTeamRobots(): TeamRobot[] {
  return [
    { id: 'madtown-2024-1323', team: 1323, name: 'MadTown 2024',
      description: '1323 MadTown Robotics. Fast ground-intake SPEAKER cycler with a separate AMP/TRAP arm and chain climb. Simulator estimates: 5.2 m/s drive, 10 m/s² acceleration, 1.5 s per climb level.',
      source: 'https://team1323.com/; https://www.thebluealliance.com/team/1323/2024 — team season overview and 2024 pit photos; performance [EST]',
      config: config(1323, 'madtown-2024-1323', false, 5.2, 10, 1.5, 24, 24) },
    { id: 'twister-118', team: 118, name: 'Twister',
      description: '118 Robonauts. Turret shooter with eight flywheels, AMP diverter and chain-arm / ski climb. Simulator estimates: 4.8 m/s drive and 2.1 s per climb level; trades sprint speed for aiming freedom.',
      source: 'https://www.chiefdelphi.com/t/2024-robonauts-cad-and-code-release/478131 — Twister technical binder',
      config: config(118, 'twister-118', true, 4.8, 8.8, 2.1, 25, 25) },
    { id: 'tidepod-4414', team: 4414, name: 'TIDEPOD',
      description: '4414 HighTide. Chassis-aimed pivot shooter, AMP/TRAP forks and twin climb uprights. Simulator estimates: compact 22 in profile, 5.0 m/s drive, 11 m/s² acceleration and 1.8 s per climb level.',
      source: 'https://www.chiefdelphi.com/t/team-4414-hightide-2024-robot-tidepod/460154 — reveal and mechanism photos',
      config: config(4414, 'tidepod-4414', false, 5.0, 11, 1.8, 22, 25) },
  ];
}

// Dimensions / timing / drive tuning [EST]; capabilities follow the team resources.
function config(team: number, model: string, turret: boolean, speed: number, accel: number, climb: number, height: number, intake: number) {
  const c = build({ ground: true, source: true, shooter: 'pivot', aim: turret ? 'turret' : 'align', amp: true, climb: 2 });
  c.teamNumber = team; c.model = model; c.maxSpeed = speed; c.maxAccel = accel;
  c.height = inch(height); c.launcher.height = inch(height - 2); c.intake.width = inch(intake);
  c.climber.secondsPerLevel = climb;
  return normalizeCrescendoConfig(c);
}
