/** Convert supplied Onshape GLBs into articulated, browser-sized robot assets. No Blender required. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, join, meshopt, reorder, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';

const specs = {
  'snoopy-6036': {file:'6036.glb',year:2024,axes:'negative-y',groups:[
    ['intake',/INTAKE ASSEMBLY/], ['shooter',/ARM ASSEMBLY/],
    ['pivot-frame',/A FRAME ASSEMBLY/], ['turret',/TURRET ASSEMBLY/],
  ]},
  'presto-6328': {file:'presto-6328-complete-source.glb',year:2024,axes:'zy-x',groups:[
    ['intake',/6328-24b-5000 Intake/],
    ['climber',/6328-24b-700[347]|6328-24b-7026|Part 25\/6328-24b-7000/],
    ['backpack-slide',/6328-24b-80(?:12|13|15|17|18|2[2-9]|3[0-5])/],
    ['backpack',/6328-24b-8000 Backpack/],
    ['shooter',/6328-24b-3000 Shooter/], ['feeder',/6328-24b-4000 Indexer/],
    ['arm',/6328-24b-6000 Arm|6328-24b-7000 Climber/],
  ]},
  'roti-5940': {file:'2024 5940.glb',year:2024,axes:'yzx',offsetY:.047632,groups:[
    ['shooter',/3\. Pod Shooter/], ['intake',/2\. Intake/],
    ['carriage',/1\.3 Stage 2/], ['elevator-stage',/1\.2 Stage 1/],
  ]},
  'spectre-2910': {file:'2025 2910glb',year:2025,axes:'negative-y',groups:[
    ['effector',/53 - 2025 Intake & Wrist V3/], ['climber',/41 - 2025 Climber/],
    ['carriage',/Phantom Arm V2, Stage 2/], ['elevator-stage',/Phantom Arm V2, Stage 1/],
    ['arm',/Phantom Arm V2, Stage 0/],
  ]},
  'domotron-604': {file:'2024 FRC604.glb',year:2024,axes:'negative-y',groups:[
    ['intake',/Intake Assembly/], ['shooter',/Arm Assembly/], ['carriage',/Carriage/], ['climber',/Climber </],
  ]},
  'reblitz-2910': {file:'12 - Robot 2 Top Level Assembly.glb',year:2026,axes:'yzx',groups:[
    ['hood',/32-17 Hood Assembly/], ['flywheel',/Brass Flywheel/],
    ['intake',/Pivoting Intake Assembly/], ['hopper',/62 - R2 Hopper/],
    ['feeder',/32-03 Single Sprocket Hub Roller|32-07 Thin Aluminum Roller/],
  ]},
  'gold-rush-27': {file:'rush-27-source.glb',year:2024,axes:'negative-z',groups:[
    ['shooter',/ShooterV6ASM_inverted/], ['intake',/04_0000_Intake/],
    ['amp-base',/^(?:Amp Mech Pivot Bracket|Amp Mech Motor Bracket|REV-21-1651|REV-41-1660|10DP10TGear|85T_375hex_print|Hex Shaft With Snap Rings).*AndrewConcept2/],
    ['amp',/AndrewConcept2/], ['climber',/^(?:D1118|D1124|D117[46789]|D1180)/],
  ]},
  'twister-118': {file:'twister-118-source.glb',year:2024,axes:'negative-z',groups:[
    ['shooter',/05_6000_NEW_SHOOTER_HEAD|05_7777_EMR_PITCH/],
    ['pitch-drive',/05_6500_PITCH_V2/], ['turret',/05_0000_SHOOTER_TOP/],
    ['climber-left',/03_CHAINARM_AF0/], ['climber-right',/03_CHAINARM_AF1/],
    ['ski-left',/03_1000_SKI_ARM_ASM/], ['ski-right',/03_1000_SKI_ARM_MIR/],
    ['diverter',/06_0000_DIVERTER/], ['intake',/02_INTAKE_TOP/],
  ]},
  'typhoon-2910': {file:'11 - 2024 Robot.glb',year:2024,axes:'yzx',groups:[
    ['shooter',/52-04 V2 Shooter/], ['feeder',/52-05 V2 Feeder/], ['turret',/41 - 2024 Turret/],
    ['intake',/31 - 2024 Intake/], ['climber',/62 - 2024 Climber/],
  ]},
  'doppler-1690': {file:'1690-24-0000-manufacture v1 closed.SLDASM.glb',year:2024,axes:'yzx',groups:[
    ['shooter',/1690-24-3100-1/], ['amp',/1690-2024-5000/],
    ['climber-left',/Mirror1690-24-4400-1/], ['climber-right',/1690-24-4400-1/],
  ]},
  'whisper-1690': {file:'1690-25-0000 Post.glb',year:2025,axes:'identity',groups:[
    ['effector',/1690-25-5100/],['arm',/1690-2025-4140/],
    ['carriage',/1690-2025-4100|1690-25-1230/],['elevator-stage',/1690-25-1220/],
    ['intake',/1690-25-2600/],['climber',/1690-25-6140/],
  ]},
  'quixilver-604-2025': {file:'2025 FRC604 Robot.glb',year:2025,axes:'negative-y',groups:[
    ['climber',/Pinnacles Climber Arm Assembly/],['effector',/Gripper Assembly/],['arm',/\/Arm Assembly </],['carriage',/Arm Gearbox Assembly/],['elevator-stage',/1st Stage/],
  ]},
  'subzero-1778': {file:'1778.gltf',year:2025,axes:'yzx',groups:[
    ['carriage',/Carriage </],['elevator-stage',/FirstStage </],['arm',/Arm Assembly/],['intake',/Intake Assembly/],
  ]},
  'firefly-118': { file: 'firefly-118-source.glb', year: 2025, axes: 'zy-x', groups: [
    ['arm', /^(?:LEFT_ARM|RIGHT_ARM|FACE_PLATE)/], ['effector', /06_0000_END_EFFECTOR/], ['intake', /02_INTAKE_MOVING/],
    ['climber-latch', /03_3000_CAGELATCH/], ['climber', /03_2000_ARM/], ['algae-intake', /05_ALGAE/],
    ['elevator-stage', /04_1000_SLIDE/],
  ] },
  'zuma-581': { file: 'BB581 2025 TLA.glb', year: 2025, axes: 'negative-y', groups: [
    ['effector', /CMP Claw V2/], ['arm', /581-25L0000/],
    ['carriage', /581-25K0000|RENAME Champs Carriage/],
    ['intake', /581-25I0500/], ['climber', /Assembly 2/],
  ] },
  'sublime-1678': { file: '1678-2025-O-0000.glb', year: 2025, axes: 'yzx', groups: [
    ['effector', /1200 End Effector/], ['intake', /1400 Orbit Intake/],
    ['algae-intake', /0200 Algae Intake/],
    ['climber', /1800 Poof Climber/],
    ['arm', /^(?:1678-25-P-072[789]|1678-25-P-073[01]|Part 65)\//],
    ['carriage', /^(?:1678-25-P-0703|1678-25-P-0750|1678-25-P-0733|Part 9|Part 11)\//],
    ['elevator-stage', /^(?:1678-25-P-075[2346]|1678-25-P-0702)\//],
  ] },
  'wildstang-111': { file: '25W - WildStang 2025.glb', year: 2025, axes: 'xzy', groups: [
    ['coral-head', /25W3100 - Coral Intake/], ['algae-head', /25W3200 - Algae Intake/],
    ['arm', /25W3000 - Arm/], ['climber', /25W5100 - Climb Arm/],
    ['intake', /25W4100 - OTB Moving/], ['carriage', /25W2300 - Carriage/],
    ['elevator-stage', /25W2200 - Extension Stage/],
  ] },
  'simbot-tim-1114': { file: 'S26-A000.glb', axes: 'yzx', offsetX: .3048, groups: [
    ['intake', /^(?:S26-IN-P(?:303|311|326)|Part (?:42|43|44|46|52))\//],
  ] },
  'rotor-604-donor': { file:'Toploader Assembly.glb', axes:'yzx', groups:[
    ['rotor',/Chefs Hat/], ['infeed',/Infeed Roller Assembly/], ['upfeed',/Upfeed Roller Assembly/],
  ] },
  'shooter-581-donor': { file:'2026 Dumper Champs Bot581.glb',axes:'xzy',groups:[
    ['hood',/Hood Assem/], ['flywheel',/#1: 4.*Roller Shaft/], ['frame',/Shooter Assem/],
  ] },
  'intake-581-donor': { file:'2026 Dumper Champs Bot581.glb',axes:'xzy',groups:[['intake',/Champs Intake Assembly/]] },
  'ctrl-alt-defeat-9470': { file: '9470-2026-MAIN.glb', axes:'yzx', groups:[
    ['flywheel', /9470-2026-DRUMROLLER/], ['hood', /9470-2026-HOODROLLER|SHO-ALU25-HOOD/],
  ] },
  'downpour-6800': { file: 'VR26A-0000 Main.glb', axes:'yzx', groups:[
    ['hopper-slide', /7200F Horizontal/], ['intake', /5000M Intake/],
    ['hood', /Hood Plate|Hood Backing|Hood Reverser|100T HTD Belt/], ['flywheel', /(?:^|\/)Flywheel\//],
  ] },
  'mixtape-971': { file: '971 Final Championship Robot.glb', axes:'negative-y', offsetY:.04445, groups:[
    ['hood-left', /(?:hood plate|hood backing print|hood standoff).*shooter assembly <1>/i], ['hood-right', /(?:hood plate|hood backing print|hood standoff).*shooter assembly <2>/i],
    ['flywheel-left', /(?:flywheel shaft|fairlane wheels(?: hub)?).*shooter assembly <1>/i],
    ['flywheel-right', /(?:flywheel shaft|fairlane wheels(?: hub)?).*shooter assembly <2>/i],
    ['turret-left', /shooter assembly <1>/], ['turret-right', /shooter assembly <2>/],
    ['intake', /Ground Intake/],
  ] },
  'toploader-604': { file: 'Toploader Assembly.glb', axes: 'yzx', groups: [
    ['flywheel', /Main Roller Assembly/], ['hood', /Turret Hood Assembly/],
    ['turret', /Turret Assembly/], ['intake', /Intake Arm Assembly/],
    ['hopper-slide', /Hopper Slider Assembly/], ['serializer', /DPC Rotor Assembly/],
  ] },
  'limestone-1678': { file: '1678-26c-0000.glb', axes: 'yzx', groups: [
    ['intake', /1500 Single Roller Intake/], ['climber', /1900 Climber/],
    ['flywheel', /Drum silicone/], ['hood', /Hood silicone|1678-26c-16(?:06|09|10|11|12|13|14|15|17|74|75|85)(?:\/|$)/],
  ] },
  'rubble-581': { file: '2026 Dumper Champs Bot581.glb', axes: 'xzy', groups: [
    ['hood', /Hood Assem/], ['flywheel', /#1: 4.*Roller Shaft/],
    ['intake', /Champs Intake Assembly/],
  ] },
};
const inputDir = process.argv[2];
if (!inputDir) throw new Error('Usage: node tools/prepare-robot-cad.mjs <directory containing original GLBs> [model-id]');
const ids = process.argv[3] ? [process.argv[3]] : Object.keys(specs);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
// CAD face boundaries duplicate normals. Permit seam collapses while keeping geometry error bounded.
const cadSimplifier = { ...MeshoptSimplifier, simplify: (indices, positions, stride, target, error, flags = []) =>
  MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']) };
for (const id of ids) {
  const spec = specs[id];
  if (!spec) throw new Error(`Unknown model: ${id}`);
  const outDir = `public/models/robots/${spec.year ?? 2026}`;
  await fs.mkdir(outDir, { recursive: true });
  const source = path.join(inputDir, spec.file);
  const doc = await io.read(source);
  const root = doc.getRoot(), scene = root.listScenes()[0];
  const triangleCount = () => {
    let count = 0;
    scene.traverse(n => { for (const p of n.getMesh()?.listPrimitives() ?? []) count += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; });
    return count;
  };
  const inputTriangles = triangleCount();
  // CAD exports use Z up. Preserve meters; turn the real intake toward robot -X.
  const axes = spec.axes === 'negative-z' ? new Matrix4().set(0,0,-1,0, 0,1,0,0, 1,0,0,0, 0,0,0,1) : spec.axes === 'identity' ? new Matrix4() : spec.axes === 'zy-x' ? new Matrix4().set(0,0,1,0, 0,1,0,0, -1,0,0,0, 0,0,0,1) : spec.axes === 'negative-y' ? new Matrix4().set(0,-1,0,0, 0,0,1,spec.offsetY??0, -1,0,0,0, 0,0,0,1) : spec.axes === 'yzx' ? new Matrix4().set(0,1,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,1)
    : new Matrix4().set(1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1);
  const nodes = root.listNodes();
  axes.elements[12] = spec.offsetX ?? 0;
  axes.elements[13] = spec.offsetY ?? 0;
  const retained = [];
  let omitted = 0;
  const surfaces = new Set();
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    const names = [n.getName()];
    for (let p = n.getParentNode(); p; p = p.getParentNode()) names.push(p.getName());
    const full = names.join('/');
    if(id==='domotron-604' && /(?:^|\/)\s*(?:occurrence of )?Note(?:\/|$)/i.test(full)){n.setMesh(null);omitted++;continue;}
    if(id==='roti-5940' && /clothed noodle|noodle|bumper/i.test(full)){n.setMesh(null);omitted++;continue;}
    if(id==='spectre-2910' && /Bumper|Origin Cube|Battery|RoboRIO|Power Distribution|Radio Power|Reference/i.test(full)){n.setMesh(null);omitted++;continue;}
    if (id === 'reblitz-2910' && /Bumper Assembly|Battery|RoboRIO|Radio|Power Distribution|PDH|PDP|(?:^|\/)Fuel(?:\/|$)/i.test(full)) {n.setMesh(null);omitted++;continue;}
    if (spec.year===2024 && /Bumper|Battery|RoboRIO|Power Distribution|Radio Power|Brain Box/i.test(full)) {n.setMesh(null);omitted++;continue;}
    if(id==='whisper-1690' && /1690-25-1000-BasePart/.test(full)){n.setMesh(null);omitted++;continue;}
    if (['quixilver-604-2025','subzero-1778'].includes(id) && /Bumper|Battery|RoboRIO|PDH|Radio|Origin Cat|Reference Cube/i.test(full)) { n.setMesh(null); omitted++; continue; }
    if (id === 'zuma-581' && /581-25B0000|Battery|RoboRIO|PDH|Radio|Origin Cube/i.test(full)) { n.setMesh(null); omitted++; continue; }
    if (id === 'sublime-1678' && (/Reference Cube/.test(full) || (n.getName() === 'Part 1' && getBounds(n).max[2] < .026 && getBounds(n).min[2] < 0) || (!n.getName() && Math.max(...getBounds(n).max.map((v,i)=>v-getBounds(n).min[i])) > .65))) { n.setMesh(null); omitted++; continue; }
    if (id === 'wildstang-111' && /Origin Cube|Bumper|Battery|RoboRIO|PDH|PDP|Radio|Ethernet|CANivore|Power Distribution/i.test(full)) { n.setMesh(null); omitted++; continue; }
    // The 1114 attachment is an intake/hopper subassembly. Unnamed tiny parts
    // are repeated rivet interiors, not structural sheets or rollers.
    if (id === 'simbot-tim-1114' && !n.getName()) { n.setMesh(null); omitted++; continue; }
    // Keep structure and mechanism geometry; remove fasteners and electrical interiors.
    const bounds = getBounds(n);
    // Limestone's export includes an unnamed six-triangle reference sheet outside the robot.
    const looseReference = id === 'limestone-1678' && !n.getName() && bounds.max[1] > .8;
    const hardware = /screw|washer|blind rivet|locknut|hex nut|nutstrip|nut strip|spacer|bearing|bushing|crush block/i.test(n.getName())
      && !/plate|mount|support|arm|shaft|tube/i.test(n.getName());
    if ((id === 'rotor-604-donor' && !/DPC Rotor Assembly/.test(full)) || (id === 'shooter-581-donor' && (!/Shooter Assem/.test(full) || /(?:^|\/)Hopper <|^Triad\//.test(full))) || (id === 'intake-581-donor' && (!/Champs Intake Assembly/.test(full) || bounds.max[2] > .4 || /Front Intake Hopper|Side Panels|Stowed Energy Chain/.test(full))) || looseReference || hardware || /PDP 2\.0|Import for Mass/i.test(full)
      || /bumper foam|bumper long side|bumper battery side|bumper GI side|bumper gusset|9470-2026-DRI-FOAM|bumper assembly|26B0000 Bumpers|^Bumpers\/|1200A Bumper|(?:^|\/)thin (?:Gi|side|back) foam|(?:^|\/)9470.*BUMP/i.test(full)) { n.setMesh(null); omitted++; continue; }
    let group = spec.groups.find(([, re]) => re.test(full))?.[0] ?? 'frame';
    if(id==='whisper-1690' && group==='intake' && /1690-25-268[01]/.test(full)) group='frame';
    if (id === 'sublime-1678' && group === 'carriage' && bounds.min[2] < .2) group = 'frame';
    if (id === 'wildstang-111' && group === 'carriage' && bounds.min[2] < .45) group = 'frame';
    if (id === 'firefly-118' && group === 'elevator-stage' && /CYCLOIDAL/.test(full) && bounds.min[1] > .8) group = 'carriage';
    if (id === 'sublime-1678' && group === 'climber' && /1678-25-P-09/.test(n.getName())) group = 'frame';
    if (id === 'subzero-1778' && group === 'arm' && /Manipulator|Manipultor/.test(n.getName())) group='effector';
    if (id === 'subzero-1778' && group === 'intake' && bounds.max[1]>-.2) group='frame';
    if (id === 'zuma-581' && group === 'effector' && bounds.min[2]>1.5) group='arm';
    if (id === 'zuma-581' && /581-25J0000/.test(full) && (bounds.min[2] > .77 || /midstage|J0002|J0003/i.test(n.getName()))) group = 'elevator-stage';
    if (id === 'mixtape-971' && group === 'intake' && bounds.max[1] < .31 && !/SplineXL|Torque Converter/i.test(n.getName())) group = 'frame';
    if (id === 'downpour-6800' && group === 'intake' && bounds.max[1] > -.34 && bounds.max[2] < .18) group = 'frame';
    // Downpour's upper hood rollers and shafts are flat children of the shooter assembly.
    if (id === 'downpour-6800' && /2000E Shooter/.test(full) && bounds.min[2] > .535 && bounds.max[1] < .15 && !/belt|motor/i.test(n.getName())) group = 'hood';
    if (id === 'limestone-1678' && group === 'intake') {
      // Fixed gearbox, side containment sheets and rear posts belong to the chassis, not the slapdown arm.
      const centerZ = (bounds.min[2] + bounds.max[2])/2;
      if (centerZ < .20 || /1529|^part 26$|^part 73$|^Part 41$/i.test(n.getName())) group = 'frame';
    }
    if (id === 'limestone-1678') {
      if (/1900 Climber/.test(full)) {
        if (/1924|^Part 58(?:-Mirrored)?$|^Part 60$/.test(n.getName())) group='hopper-lift';
        else if (/1902|1943|1928|1915|1935/.test(n.getName())) group='hopper-lift';
      }
      if (/1500 Single Roller Intake/.test(full) && /^part 26$|^Part 41$|^Part 73$|1519/i.test(n.getName())) group='hopper-front';
    }
    // Some exported configurations repeat the same wall in exactly the same place.
    const signature = n.getName() + '/' + [...bounds.min, ...bounds.max].map(v => v.toFixed(6)).join(',');
    if (/wall|coroplast|panel/i.test(n.getName()) && surfaces.has(signature)) { n.setMesh(null); omitted++; continue; }
    surfaces.add(signature);
    const dims = bounds.max.map((v,i) => v-bounds.min[i]);
    const simbotSheet = id === 'simbot-tim-1114' && /^S26-IN-P(?:301|315|318|321|322|330)$/.test(n.getName());
    const sheet = simbotSheet || /wall|coroplast|panel|plate|bellypan|polycarb/i.test(n.getName()) || (Math.min(...dims)<.012 && dims.filter(v=>v>.15).length>=2) || (id === 'limestone-1678' && /^Part 60$/.test(n.getName()));
    const themed = spec.year !== 2025 && spec.year !== 2024 && (/arm plate|hood plate|slider mount|slot reinforcement|sponsor panel|printed|wire guide/i.test(n.getName()) || (id === 'limestone-1678' && /1678-26c-16(?:14|85)/.test(n.getName())));
    // Retain CAD colors, with rubber and clear-sheet finishes identified by part names.
    for (const p of n.getMesh().listPrimitives()) {
      if (!p.getMaterial()) continue;
      if (id === 'ctrl-alt-defeat-9470') {
        const m=p.getMaterial().clone();const c=m.getBaseColorFactor();
        if(c[0]>c[1]*1.15 && c[2]>c[1]*1.15) m.setBaseColorFactor([.68,.7,.73,1]).setMetallicFactor(.45);
        p.setMaterial(m);
      }
      if (sheet || themed) {
        const m = p.getMaterial().clone().setExtras({ cadSheet: sheet, cadSmoothSheet: simbotSheet });
        if (themed) {
          const c = id === 'downpour-6800' ? [.91,.68,.04,1] : id === 'ctrl-alt-defeat-9470' || id === 'mixtape-971' ? [.7,.72,.74,1] : id === 'toploader-604' ? [.91,.68,.04,1] : id === 'limestone-1678' ? [.22,.55,.13,1] : [.88,.25,.035,1];
          m.setBaseColorFactor(c).setMetallicFactor(.18).setName('team-accent');
        } else if (id === 'toploader-604' && /superstructure frame/i.test(full)) m.setBaseColorFactor([.12,.13,.14,1]);
        p.setMaterial(m);
      }
      if ((id === 'downpour-6800' && group === 'flywheel') || (id === 'mixtape-971' && /fairlane wheels </.test(full) && !/shaft|hub/i.test(n.getName())) || (id === 'ctrl-alt-defeat-9470' && /SHO-POLY125-(?:HOODROLLER|DRUMROLLER)/.test(n.getName())) || /silicone|rubber|belt/i.test(n.getName()) || (id === 'downpour-6800' && /^(Flywheel|Back Roller|Roller 2|1\" Roller)$/.test(n.getName()))) {
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.028,.032,.036,1]).setMetallicFactor(0).setRoughnessFactor(.85).setName('rubber'));
      } else if (id === 'downpour-6800' && /Side Plate|Back Plate|Crossbar|Hood Backing/.test(n.getName()) && !/Motor|Battery/.test(n.getName())) {
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.09,.10,.12,1]).setMetallicFactor(.2).setRoughnessFactor(.7));
      } else if ((id === 'downpour-6800' && /7200F Horizontal|7100F Stationary/.test(full) && /polycarb|wall|panel/i.test(n.getName())) || (id === 'mixtape-971' && /Hooper Walls/.test(full))) {
        const m = p.getMaterial().clone().setName('clear-hopper-sheet').setBaseColorFactor([.8,.86,.91,.25]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.3);
        if (sheet) m.setExtras({cadSheet:true});
        p.setMaterial(m);
      } else if (id === 'limestone-1678' && /^(?:Part 60|Part 58(?:-Mirrored)?|1678-26c-1529|part 26|1678-26c-1118)$/i.test(n.getName())) {
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.64,.72,.76,.20]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.38).setName('clear-hopper-sheet'));
      } else if (/polycarb|coroplast/i.test(n.getName()) && !/roller|plug|shaft/i.test(n.getName())) {
        const m = p.getMaterial().clone();
        if (/polycarb/i.test(n.getName())) m.setBaseColorFactor([.65,.72,.78,.24]).setAlphaMode('BLEND').setDoubleSided(true);
        m.setMetallicFactor(0).setRoughnessFactor(.55); p.setMaterial(m);
      }
    }
    // Team 27's STEP carries a uniform pale CAD swatch, not its competition finish.
    // Photo fit: gold cut structure, black rubber/motors, brass flywheels, silver shafts.
    if (id === 'gold-rush-27') for (const p of n.getMesh().listPrimitives()) {
      const name=n.getName(), brass=/Brass Flywheel/i.test(name);
      const rubber=/Grip_Wheel|belt|roller|Printed Insert|Print$|ShooterFloor|ShooterSideSkin/i.test(name);
      const motor=/NEO-Vortex|SPARK|WCP-0940|MAXPlanetary|REV-11-1271/i.test(full);
      const gold=!rubber&&!motor&&!/shaft|axle|spacer|collar|hub|pulley|gear(?!arm)/i.test(name)
        && /D11|plate|tube|bar|brace|bracket|support|frame|stiffener|Crash|GearArm|Hanger/i.test(name);
      const color=brass?[.66,.48,.16,1]:rubber||motor?[.045,.048,.052,1]:gold?[.74,.50,.045,1]:[.5,.52,.54,1];
      const material=p.getMaterial().clone().setName(brass?'rush-brass':rubber?'rubber':motor?'rush-motor':gold?'rush-gold':'rush-aluminum')
        .setBaseColorFactor(color).setMetallicFactor(brass?.75:rubber||motor?.05:gold?.4:.65).setRoughnessFactor(brass?.34:rubber||motor?.8:gold?.48:.42);
      p.setMaterial(material);
    }
    const matrix = axes.clone().multiply(new Matrix4().fromArray(n.getWorldMatrix())).toArray();
    retained.push({ n, group, matrix });
  }
  // Detach leaves before deleting old CAD hierarchy. Each rigid group merges independently.
  const groups = new Map();
  for (const { n, group, matrix } of retained) {
    n.getParentNode()?.removeChild(n);
    n.setMatrix(matrix).setName('');
    n.getMesh().setName('');
    if (!groups.has(group)) groups.set(group, doc.createNode(group));
    groups.get(group).addChild(n);
  }
  for (const n of scene.listChildren()) scene.removeChild(n);
  for (const n of nodes) if (!retained.some(r => r.n === n)) n.dispose();
  for (const n of groups.values()) scene.addChild(n);
  // Onshape exports flat CAD colors. Set a useful PBR finish and retain color distinctions.
  for (const m of root.listMaterials()) {
    const c = m.getBaseColorFactor();
    m.setMetallicFactor(Math.max(...c.slice(0,3)) - Math.min(...c.slice(0,3)) < .1 && c[0] > .45 ? .55 : .12);
    if (m.getName() !== 'rubber') m.setRoughnessFactor(.55);
  }
  const reduce = (simplifier, ratio, error) => document => {
    for (const mesh of document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      // Thin walls and cut plates keep their original CAD face normals and boundaries.
      if (!p.getMaterial()?.getExtras().cadSheet) simplifyPrimitive(p, { simplifier, ratio, error });
      else if (simplifier === MeshoptSimplifier) simplifyPrimitive(p, { simplifier, ratio: .15, error: .0001, lockBorder: true });
      if (!p.getAttribute('POSITION')?.getCount() || p.getIndices()?.getCount() === 0) { mesh.removePrimitive(p); p.dispose(); }
    }
  };
  await doc.transform(prune(), dedup(), weld(), reduce(MeshoptSimplifier,.10,.003), join(), weld(), reduce(cadSimplifier,.04,.002), prune());
  // Robot 2's many pocketed CAD faces retain excess coplanar tessellation after joining.
  // A final bounded 0.5 mm pass reduces those faces without quantizing positions.
  if (id === 'reblitz-2910') {
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      simplifyPrimitive(p, { simplifier: cadSimplifier, ratio: .40, error: .0005 });
    }
    await doc.transform(prune());
  }
  const outputTriangles = triangleCount();
  const bounds = getBounds(scene);
  if (spec.year === 2025 || spec.year === 2024 || id === 'reblitz-2910') {
    // Keep occurrence transforms lossless: these assemblies reuse curved parts
    // across differently transformed meshes, making per-mesh quantization unsafe.
    await io.write(`/tmp/${id}-reduced.glb`, doc);
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  } else await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16 }));
  const destination = `${outDir}/${id}.glb`;
  await io.write(destination, doc);
  const report = { id, sourceFile: spec.file, inputBytes: (await fs.stat(source)).size, outputBytes: (await fs.stat(destination)).size,
    inputTriangles, outputTriangles, omittedOccurrences: omitted, bounds, groups: [...groups.keys()] };
  await fs.writeFile(`${outDir}/${id}.report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
