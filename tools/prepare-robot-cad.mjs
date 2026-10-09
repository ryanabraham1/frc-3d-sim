/** Convert supplied Onshape GLBs into articulated, browser-sized robot assets. No Blender required. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, join, meshopt, reorder, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';

const specs = {
  // Hero Heist Mantis is distinct from Valor's 2026 Downpour. Keep source
  // assemblies separate for the measured articulated runtime rig.
  'hero-mantis-6800': {file:'hero-mantis-6800-source.glb',year:'wcp-hero-heist',axes:'negative-y',lossless:true,preserveColors:true,omit:/\[1120\] Bumper|\[1130\] Electrical|Robot Battery|120A Main Breaker|Anderson SB120/,groups:[
    ['hood',/Assembly 2 <1>.*Assembly 1 <5>/], ['flywheel',/4" Solid Urethane Wheel.*Assembly 1 <5>/], ['turret',/Assembly 3 <1>.*Assembly 1 <5>/],
    ['climb-mid1',/3 Stage Mid1.*Assembly 1 <4>/], ['climb-mid2',/3 Stage Mid2.*Assembly 1 <4>/], ['climb-end',/3 Stage End.*Assembly 1 <4>/],
    ['intake-left',/Assembly 1 <2>/], ['intake-right',/Assembly 1 <3>/],
    ['climber',/Assembly 1 <4>/], ['shooter',/Assembly 1 <5>/],
    ['magazine',/Cartidge/], ['magazine-mount',/Turret Mount|Latch Arms/],
    ['spindexer',/Assembly 1 <6>/],
  ]},
  // Team 1540 Fireweed (Hero Heist Gadgeteer). Onshape Z-up export: source +Y is the shooter side, so (Y,Z,X) puts the intake on robot -X.
  'hero-fireweed-1540': {file:'hero-1540-source.gltf',year:'wcp-hero-heist',axes:'yzx',lossless:true,preserveColors:true,omit:/Story Panel|Speech Bubble|Origin Cube|Bumper Foam/,groups:[
    ['climb-tube',/bi-stable reeled composite tube/], ['climb-cup',/Vacuum Cup|Billet Vacuum Mount/],
    ['hood',/shooter hood/],
    ['elevator-carriage',/Elevator Carriage AS/],
    ['intake',/2\. Intake/],
  ]},
  // 1318 "Constantine" (Mystic). Intake and shooter exit are both at CAD -Y, which becomes sim +X (front).
  'hero-constantine-1318': {file:'hero-constantine-1318-source.gltf',year:'wcp-hero-heist',axes:'negative-y',lossless:true,preserveColors:true,
    omit:/Bumper Assembly|Power Distribution Hub|Origin Cube|Battery|RoboRIO|Radio/,groups:[
    ['hood',/Shooter Hood|180t 10DP External|Stealth Wheel/],
    ['flywheel',/Brass Flywheel|4" Solid Roller Wheel/],
    ['intake-fixed',/Gear Box|Plate No Gearboxx|Motor Plate|Kraken X44.*Intake|MAXPlanetary Kraken X44|REV-21-2103|Rounded Hex Gear|Pocketed Gear|Hex Bore Gear|Rounded Hex Bore Hub 25 Chain|#25 chain|Rounded Hex Shaft - 2\.0in/],
    ['intake-links',/4 Bar (?:Front|Back)|Part 11(?!\d)|36t Aluminum Plate Sprocket/],
    ['intake',/Intake Assembly|WCP-1755/],
    ['climb-top',/(?:Vacuum Cup|Constant Force Spring|WCP-041[89]|Nutstrip).*Suction Climber/],
    ['climb-mid',/Tube 2"x2"x24".*Suction Climber/],
  ]},
  // 5800 Wolverine Multiclass: elevator + wrist on the +Y (front) side, 4-bar floor intake on -Y (back), turret with three
  // 4" drive wheels on top. Axes 'yzx': source (x,y,z) -> robot (forward = source +Y, up = Z, right = source +X).
  'hero-multiclass-5800': {file:'hero-multiclass-5800-source.glb',year:'wcp-hero-heist',axes:'yzx',lossless:true,preserveColors:true,
    omit:/Bumper <1>|Robot Battery|Origin Cube|Robot Radio|Energy Chain|PDP 2\.0|Main Breaker|roboRIO|RoboRIO|Anderson/,groups:[
    ['flywheel',/4" Solid Roller Wheel.*Rotation \+ Hood/], ['turret',/Rotation \+ Hood/],
    ['intake-inner',/Inner Linkage/], ['intake-middle',/Middle Linkage/], ['intake-outer',/Outer Linkage/],
    ['wrist-roller',/Compliant Intake Wheel.*Manipulator <1>/], ['wrist',/Manipulator <1>/],
    ['carriage',/Carriage <1>/], ['spindexer-star',/^(?:Part 18|SplineXL \(7" L\)|84t Aluminum MotionX).*Spindexer <1>/],
    ['elevator-stage',/^(?:Tube 2"x1"x25\.75"|Tube 2"x1"x4\.5"|Tube 2"x1"x9"|Top Crossbar|Side Top Plate)/],
  ]},
  // 6995 NOMAD: source is the Onshape glTF export (Z up, +Y = shooter side, -Y = intake side). The elevator/end effector
  // is turned 180° about the vertical axis so the panel lift stands on the shooter (front) side, where the rules place panels.
  'hero-nomad-6995': {file:'hero-nomad-6995-source.gltf',year:'wcp-hero-heist',axes:'yzx',lossless:true,preserveColors:true,
    omit:/Bumpers|Origin Cube|Power Distribution Hub|Robot Battery|120A Main Breaker|Anderson SB120|RoboRIO|Radio|CANivore/i,groups:[
    ['hood',/hood/i], ['flywheel',/3" Stealth Wheel/], ['backroller',/2" Stealth Wheel.*Shooter V4/],
    ['elevator-stage',/Stage 1 <1>/],
    // The carriage plates, bearing blocks, belt clamps and pivot gearbox hang directly off the elevator and ride with the end effector.
    ['effector',/^(?!.*(?:Static Stage <1>|Stage 1 <1>)).*Elevator <1>/],
  ]},
  // Team 254's CADathon Gadgeteer (Bellarmine/Cheesy Poofs): back floor intake, 3-ball serializer/feeder, turret, three-stage elevator
  // carrying a disk (STORY PANEL) claw and a suction pad. Source axes are Z up, intake toward -Y, so 'yzx' puts the intake at robot -X.
  'hero-poofs-254': {file:'hero-poofs-254-source.glb',year:'wcp-hero-heist',axes:'yzx',offsetX:-.0115,lossless:true,preserveColors:true,omit:/Bumper Assembly|(?:^|\/)Belt\/|PDP 2\.0|Battery|RoboRIO/,groups:[
    ['intake',/Intake Rollers Assembly/], ['claw',/Disk Manipulator Claw Assembly/], ['claw-base',/Disk Manipulator Pivot Assembly/],
    ['pad',/Sunction Pad Assembly/], ['hood',/^(?:Hood|Hood Plate)\/.*Turret Assembly <\d+>/], ['turret',/(?:^|\/)(?:occurrence of )?Turret Assembly <\d+>/],
  ]},
  // 1923 Sentinel (Gadgeteer): swerve, front-over-bumper roller intake, side panel arm, fixed ball tunnel shooter.
  'hero-sentinel-1923': {file:'hero-sentinel-1923-source.gltf',year:'wcp-hero-heist',axes:'negative-y',lossless:true,preserveColors:true,omit:/Robot Battery|Power Distribution Hub|RSL|Robot Signal Light|Main Breaker|Anderson/,groups:[
    ['flywheel',/4" Stealth Wheel/], ['hood',/(?:^|\/)(?:occurrence of )?(?:Hood|80t Pocketed Steel Spur Gear)(?:\/|$)/], ['intake-arm',/Ground Intake Assy/], ['arm',/Pink Arm Assy/], ['tunnel',/Ball tunnel Assy/],
  ]},
  // 9408 Gadgeteer (Hero Heist). Onshape export is Z-up; source +Y is the floor intake, so sim -X.
  'hero-gadgeteer-9408': {file:'hero-gadgeteer-9408-source.glb',year:'wcp-hero-heist',axes:'negative-y',lossless:true,preserveColors:true,
    omit:/Bumper Assembly|Power Distribution Hub|Battery|RoboRIO|Origin Cube|Starting Configuration|Main Breaker/,groups:[
    ['flywheel',/^(?:2" OD 1\/2" Hex ID Stealth Wheel 60A|1\/2" Thunderhex Shaft \(10\.51"\)).*Shooter Assembly <1>/],
    ['climb-pad',/^Part 1\/occurrence of Part 1\/Assembly 1 <1>/], ['climb-end',/3 Stage End/],
    ['climb-mid2',/3 Stage Mid2|WCP-0418/], ['climb-mid1',/3 Stage Mid1|WCP-0419/],
    ['hood',/^(?:Part 9|Part 18|Part 16|Spur gear \(190 teeth\))\/occurrence of .*Shooter Assembly <1>/],
    ['elevator-stage',/^Tube 2"x1"x27"\/occurrence of .*4\. Elevator/],
    ['intake',/Intake Assembly <1>/], ['shooter',/Shooter Assembly <1>/], ['elevator',/4\. Elevator/],
    ['arm',/5A\. Arm/], ['manip',/5B\. Manipulator/], ['climber',/Assembly 1 <1>/],
  ]},
  // 6731 Multiclass (CADathon 2025): fixed rear over-bumper intake, fixed front shooter with a pivoting hood. The CAD carries its six
  // SPEECH BUBBLEs inside the robot; they become the held-piece display (bubble-0..5). Bumpers are the sim's own.
  'hero-multiclass-6731': {file:'hero-multiclass-6731-source.gltf',year:'wcp-hero-heist',axes:'negative-y',offsetY:.048,lossless:true,preserveColors:true,omit:/^bumper(?:\/|$)|Origin Cube/,groups:[
    ['roller-main',/(?:Compliant Wheel|Hex \(24\.407 in\)).*speech bubble intake/], ['roller-stub1',/stub roller assembly <1>.*speech bubble intake/],
    ['roller-stub2',/stub roller assembly <2>.*speech bubble intake/],
    ['flywheel',/4" SDS Flywheel|\(am-2647\)|Hex \(11\.059 in\)/], ['hood',/hood assembly <1>/],
    ['feeder',/\(am-4716\)/], ['intake',/full intake <1>/],
  ]},
  // Team 498's CADathon Mystic: one over-the-bumper intake on the back, turret + hood shooter, telescoping winch climber.
  'hero-mystic-498': {file:'hero-498-source.gltf',year:'wcp-hero-heist',axes:'yzx',lossless:true,preserveColors:true,
    omit:/SWYFT Bumper|Robot Battery|120A Main Breaker|Origin Sphere|Power Distribution Hub|Simplified PDH|Climber Rope/,groups:[
    ['intake-rollers',/Rollers <1>.*Intake <1>/], ['intake-gearbox',/Gearbox <1>.*Intake <1>/], ['intake-indexer',/Indexer <1>.*Intake <1>/],
    ['flywheel',/4" Solid Roller Wheel.*Active Turret/], ['turret-static',/Static Turret <1>.*Shooter <1>/], ['turret',/Active Turret <1>.*Shooter <1>/], ['hood',/Active Hood <1>.*Shooter <1>/],
    ['climb-stage1',/Stage 1 <1>.*Climber <2>/], ['climb-carriage',/Carriage <1>.*Climber <2>/], ['climb-wrench',/Wrench <1>.*Climber <2>/],
    ['climb-base',/Base Stage <1>.*Climber <2>/], ['hopper',/Hopper <1>/],
  ]},
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
  // Public Onshape "1678-2024-E-0000 CAD Release" / Epsilon. Joints come from the document's mates.
  'nik-1678': {file:'2024-1678.glb',year:2024,finalPass:true,axes:'yzx',offsetY:.0254,
    omit:/Reference [Cc]ube|sw-005|VH-109|6455K43|CANdle|(?:^|\/)(?:occurrence of )?Part 1[45]\/1678-2024-E-0700 Drivetrain/,
    groups:[['intake',/1678-2024-E-0800 Intake/], ['amp',/1678-2024-E-0900 AMP/],
      ['climber',/1678-2024-E-1100 Climber/], ['shooter',/1678-2024-E-1000 </]],
    classify:({full,name,bounds,group})=>{
      // Fixed pivot/motor plates and the deploy chain stay on the chassis; the arm starts at the 0.2969 m hinge.
      if (group==='intake') return bounds.max[1] < -.26 ? 'intake' : 'frame';
      // Single-stage AMP elevator: the inner P-0909 stage and its roller head slide on the fixed 20 degree rails.
      if (group==='amp') return bounds.max[2] < .3 ? 'frame' : bounds.min[2] > .69 || /P-09(?:09|01|11|15|17|19|21|24|25|26|36|37|40|44)|^COPY$/.test(name)
        || (/WCP-0199-|WCP-0212|WCP-0474|WCP-0039/.test(name) && bounds.min[2] > .49 && bounds.min[2] < .6) ? 'amp' : 'frame';
      // Hook arms, their top carriage and the upper gas-spring bodies ride on the gas springs.
      if (group==='climber') return /P-11(?:08|09|10|11|14|15|18|20|21)|^Bushing$/.test(name) ? 'climber' : /Gas Spring/.test(full) ? ((bounds.min[2]+bounds.max[2])/2 > .30 ? 'climber-rod' : 'climber-strut') : 'frame';
      return group;
    }},
  // Public Onshape "Riot-PUBLIC" / 1706-RIOT. Shooter and elevator joints come from the document's mates.
  'riot-1706': {file:'2024-1706.glb',year:2024,finalPass:true,axes:'negative-y',offsetX:-.1555,offsetY:.0025,offsetZ:-.2735,
    omit:/CR-900|Limelight Ass|LL3GSIMPLIFIED/,
    groups:[['shooter',/CR200-Shooter/], ['carriage',/CR800-CarraigeOnly/], ['elevator-stage',/CR600-Elevator/], ['climber',/CR-400-Climber/]],
    classify:({full,name,bounds,group})=>{
      if (group==='elevator-stage') return /Inner Stage|^CR-600-00[1256]$|Top Bearing Block|Top Block|^Dowel$|^Part 7$|60355K246|^1\/4-20 x 0\.875$/.test(name) ? 'elevator-stage' : 'frame';
      if (group==='climber') {
        // TTB 2-stage telescopes: 2 in outer tube stays, 1.5 in middle and 1 in inner stages carry the hook.
        if (name==='Telescope Tube') { const w = bounds.max[0]-bounds.min[0]; return w > .045 ? 'frame' : w > .03 ? 'climber-mid' : 'climber'; }
        if (/1\.5" Top Cap|1\.5" End Block/.test(full)) return 'climber-mid';
        if (/1" End Block|^CR-400-0(?:06|10)$|^Part 2$/.test(name) || /1" End Block/.test(full)) return 'climber';
        return 'frame';
      }
      return group;
    }},
  // Public Onshape "3005 2024: FULL ROBOT (PUBLIC)" / Surge. Launcher and diverter joints come from the document's mates.
  'surge-3005': {file:'2024-3005.glb',year:2024,finalPass:true,axes:'yzx',omit:/9: Bumpers|LL3GSIMPLIFIED/,
    groups:[['shooter',/3: Launcher/], ['diverter',/5: Diverter/], ['climber',/7: Telescoping Climber/]],
    classify:({full,name,group})=>{
      // The diverter's long side links ride on the launcher pivot shaft; the roller head pivots at the launcher nose.
      if (group==='diverter' && /^5C0[123]$|REV-29-1016|REV-21-2597/.test(name)) return 'shooter';
      if (group==='climber') return /^7A02|^7B01|2x2StageInternalEndBlock/.test(name) || /1\.5x1\.5 Slider/.test(full) ? 'climber-mid'
        : /^7A03|^7A20|^7B02|^92395A515$/.test(name) ? 'climber' : 'frame';
      return group;
    }},
  // Public Onshape "0. 2024 Ultraviolet". Launcher, AMP/TRAP elevator and climber slides come from the document's mates.
  'ultraviolet-3847': {file:'2024-3847.glb',year:2024,axes:'negative-y',offsetZ:.006,omit:/Reference Cube|LL3GSIMPLIFIED|LimelightV2/,
    groups:[['shooter',/\/Launcher <1>\/3\. Launcher/], ['amp',/(?:Elevator|Tower) <1>\/4\. AmpTrap/], ['climber',/5\. Climber/]],
    classify:({full,name,bounds,group})=>{
      // Stray electronics occurrences exported outside the frame.
      if (/Electronics <1>/.test(full) && (bounds.max[0] > .45 || bounds.min[2] < -.01)) return null;
      // Inner rail, its lower bearing blocks and the roller tower ride the 15 degree elevator; outer rails stay.
      if (group==='amp') return /Tower <1>/.test(full) || /4-06-Elevator Inner Rail|4-07-Elevator Cross Bar|^Part [12]$|LaserCAN|TTB Chain Attachment/.test(name) || /Inline Clamping Block <[34]>/.test(full) ? 'amp' : 'frame';
      if (group==='climber') return /5-01-Slide/.test(name) ? 'climber' : 'frame';
      return group;
    }},
  // Public Onshape "Nocturne - 2024" / NOCTURNE. The document also carries field elements and spare swerve modules.
  'nocturne-3467': {file:'2024-3467.glb',year:2024,finalPass:true,axes:'yzx',offsetX:-.128,offsetY:.003,
    omit:/Assembly 2 <|Source \(GE-24000\)|Simple Amp|simpstage_sideless|bumper chassy/,
    groups:[['shooter',/Current <1>|Blower|HARMONY HOOKS/], ['arm',/arm <1>/]],
    classify:({full,name,bounds,group})=>{
      if (group==='arm') return /Tube 2"x1"x16\.5"|betahooks/.test(name) || bounds.min[2] > .56 ? 'arm' : 'frame';
      // Loose top-level parts above the pivot (head side plates "Part 11", cross tube, brackets) ride the arm.
      if (group==='frame' && /^[^/]+\/occurrence of [^/]+\/NOCTURNE(?:\/[^/]*)?$/.test(full) && bounds.min[2] > .55) return 'shooter';
      return group;
    }},
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
  // 2025 public Onshape releases (Spectrum CAD Collection), next five by EPA. Each spec owns its
  // omissions and regrouping so robots stay independent; bounds are source meters (Z up).
  'taiyaki-5940': { file: '2025-5940.glb', year: 2025, axes: 'yzx', finePass: true,
    omit: /Bumpers <|Pi-Motel|Power Distribution Hub|Rio Shroud|Battery|Cams Assembly|CAN ?[Rr]ange|PCB|(?:^|\/)Connector(?:\/|$)|(?:^|\/)cable chain(?:\/|$)|(?:^|\/)occurrence of Coral(?:\/|$)/,
    groups: [
      ['effector', /A-0500 End Effector/], ['carriage', /Stage 2 \(carriage\)/], ['elevator-stage', /Stage 1 </],
      ['intake', /A-0300 Intake/], ['climber', /A-0600 Climber/],
    ],
    regroup(group, name, full, b) {
      const c = b.min.map((v, i) => (v + b.max[i]) / 2);
      // Pivot hub on the carriage turns with the cantilevered end effector (X-contact bearing axis).
      if (group === 'carriage' && Math.hypot(c[1] - .1905, c[2] - .2476) < .004 && c[0] > -.12 && !/Bushing|X-Contact|Kraken/.test(name)) return 'effector';
      // The deploy gearbox, side mounts and drive chain stay on the chassis; the hinge is the 48T sprocket shaft.
      if (group === 'intake' && c[1] > -.29) return 'frame';
      // Coral Protector Plate is a fixed chassis cover beside the climber.
      // Only the spear/fly-swatter arm above the bushings at (x .3429, z .437) swings; post, winch and spring stay put.
      if (group === 'climber' && !/^(?:P-060[25789]|P-061[134]|Bushing|Tube Connecting Nut)/.test(name)) return 'frame';
    } },
  'wisp-422': { file: '2025-422.glb', year: 2025, axes: 'yzx', finePass: true,
    omit: /Bumpers Mk2|Battery Lead|Arducam|Radio Case|Energy Chain|Retracted Belt Run|Photo Mount|ASSEMBLY_55816|139700_EP01/,
    groups: [
      ['effector', /Manipulator Assembly/], ['intake', /Ground Coral Mk2/], ['climber', /Climber Mk2/], ['elevator-stage', /Elevator Assembly/],
    ],
    regroup(group, name, full, b) {
      const c = b.min.map((v, i) => (v + b.max[i]) / 2), x = Math.abs(c[0]);
      // The elevator assembly is flat: sort continuous-belt stages by their nested side-tube spacing (1st .197, 2nd .165, 3rd .133, carriage .10).
      if (group === 'elevator-stage') {
        if (/2nd Stage/.test(name)) return 'elevator-stage';
        if (/3rd Stage/.test(name)) return 'elevator-stage-2';
        if (/^Carriage|Tension/.test(name)) return 'carriage';
        if (c[1] < .06 || c[2] < .07 || b.max[0] - b.min[0] > .3) return 'frame';
        return x < .12 ? (c[2] < .5 ? 'carriage' : 'elevator-stage-2') : x < .148 ? 'elevator-stage-2' : x < .18 ? 'elevator-stage' : 'frame';
      }
      // Ground CORAL arm turns on the 36T sprocket shaft (y -.1956, z .3023); side plates, motor and chain stay fixed.
      if (group === 'intake' && c[2] < .29) return 'frame';
      // Climber: post, gearbox and winch are fixed; L plates and hooks pivot on the bushings at (x .337, z .4056).
      if (group === 'climber' && !/Climber L Plate|Hook Piece|Not Hook|Reaction Bar|Climber Cross|Bushing|tap both end|1" x 1" Tube Plug|Tap 0.4375|Oil-Embedded/.test(name)) return 'frame';
    } },
  'singularity-1706': { file: '2025-1706.glb', year: 2025, axes: 'negative-x', finePass: true, offsetX: .3555, offsetY: .026,
    omit: /RS-900-Bumpers|(?:^|\/)Algae(?:\/|$)|Battery|Robot Radio|radio mount|Robot Signal Light|USB4125|SxB-PH|12AWG Wire|C_0805/,
    // The elevator assembly carries an unnamed 1 m reference body around the robot.
    drop: (name, full, b) => !name && Math.max(...b.max.map((v, i) => v - b.min[i])) > .6,
    groups: [
      ['effector', /RS400-000/], ['carriage', /RS-300-000/], ['intake', /RS-500/], ['climber', /RS-600/], ['elevator-stage', /RS-200-Elevator/],
    ],
    regroup(group, name, full, b) {
      if (group !== 'elevator-stage') return;
      const c = b.min.map((v, i) => (v + b.max[i]) / 2), d = b.max.map((v, i) => v - b.min[i]), y = Math.abs(c[1]);
      // Flat elevator: three nested tube pairs (fixed 1st stage at |y| .2413, 2nd .2032, 3rd .1651) between x .254-.305.
      if (c[2] < .085 || c[0] < .235 || c[0] > .335 || /Side-Side|gearbox|Stiff|Wire Passthru|Mount Cable Chain|Stage 1 Top/i.test(name)) return 'frame';
      if (d[1] > .3) return Math.abs(d[1] - .4318) < .01 ? 'elevator-stage' : d[1] < .4 ? 'elevator-stage-2' : 'frame';
      return y > .145 && y < .1855 ? 'elevator-stage-2' : y >= .1855 && y < .222 ? 'elevator-stage' : 'frame';
    } },
  // The largest source (38 M triangles): a 1 mm final pass keeps it near the other assets. Pure-blue CAD swatches are
  // the team's black printed parts and plates in the match photos.
  'relay-3005': { file: '2025-3005.glb', year: 2025, axes: 'negative-y', finePass: .001,
    recolor: c => c[0] < .05 && c[1] < .05 && c[2] > .95 ? [.11, .115, .125, c[3]] : null,
    // Block-CAD wiring harnesses (pink multi-body routing), the bumpers and the reference CORAL are not robot structure.
    // NOTE: the shipped GLB also had a loose white CORAL tube (3 unnamed components in the frame's white mesh, around
    // x -.19..+.09, y .28..+.5, z -.15..+.07) stripped by hand after this pass; strip it again if the asset is regenerated.
    omit: /1-02: Bumpers|BLOCK CAD - ELECTRONICS|(?:^|\/)Wiring(?:\/|$)|Coral \(Deployed\)/,
    groups: [
      ['algae', /7: Algae Gripper/], ['climber', /8-03: Climber Arm/], ['effector', /3-01\.2: Carriage|4: Coral Ejector/],
      ['carriage', /2-04: Stage 3|3-02: Laterator Base/], ['elevator-stage-2', /2-03: Stage 2/], ['elevator-stage', /2-02: Stage 1/],
    ] },
  'redundancy-190': { file: '2025-190.glb', year: 2025, axes: 'yzx', finePass: true,
    // Origin cubes, the battery and the one-piece bumper (Part 22 of the drivetrain) are not mechanism geometry.
    omit: /Origin Cube|Robot Battery|^Part 22\/[^/]*\/A-25B-1000/,
    groups: [
      ['algae', /A-25B-4002/], ['effector', /A-25B-4001/], ['carriage', /A-25B-2003/], ['elevator-stage', /A-25B-2002/],
      ['climber', /A-25A-5000/], ['intake', /A-25B-6000/],
    ],
    regroup(group, name, full, b) {
      const c = b.min.map((v, i) => (v + b.max[i]) / 2);
      // Climber: the gearbox and side plates stay on the chassis; the gas-spring arm and grappling hook swing.
      if (group === 'climber' && c[2] < .3 && !/P-25A-0216/.test(name)) return 'frame';
      // Over-the-bumper roller: the side racks slide out with the roller carriage; the camera mounts stay on the chassis.
      if (group === 'intake' && /Limelight|Limlighty|^Minimal$/.test(name)) return 'frame';
    } },
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
    ['hopper-roof-slide', /^extension ceiling\//], ['hopper-roof', /^hopper ceiling flat\//],
    ['hopper-slide', /^(?:horiz extension(?: front)?|extension spacer)\//],
    ['hopper-walls', /^main bent [lr]\//], ['intake', /INTAKE <|roller yoink/], ['indexer', /hopprerdcmp/],
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
  // 6329 Roman II public release (Onshape GLB, Z up, meters). Source +Y is the drum (front), -Y the four-bar intake.
  // Rollers are grouped per measured axis (source Y/Z centre) so each spins about its own shaft.
  'roman-6329': { file: '2026-6329.glb', axes: 'yzx', lossless: true, preserveColors: true,
    omit: /Back Bumper|Origin Cube|Robot Battery|RoboRIO|Power Distribution|PDH|Robot Radio|120A Main Breaker|CANStar/,
    groups: [], classify: ({ full, name, bounds }) => {
      const cy = (bounds.min[1]+bounds.max[1])/2, cz = (bounds.min[2]+bounds.max[2])/2, near = (y, z, t = .02) => Math.hypot(cy-y, cz-z) < t;
      const wide = bounds.max[0]-bounds.min[0] > .3;
      if (/Shooter \(6329/.test(full)) {
        if (/Drum Tube|Drum Print|Shooter Drum Cat Tongue|Drum Washer|Drum Bushing|Drum Inner Bushing/.test(name) || (wide && near(.2285,.4825,.01))) return 'flywheel';
        if (/Hood Roller|Cat Tongue Tape|Feed Roller/.test(name) || wide) {
          const rollers = [[.0335,.527],[.0285,.487],[.0565,.375],[.0695,.2985]];
          const i = rollers.findIndex(([y,z]) => near(y,z,.012));
          if (i >= 0) return `shooter-roller-${i}`;
        }
        return 'frame';
      }
      if (/Roller Floor/.test(full) && /Poly Tube|Cat Tongue|Flex Wheel|Front Roller|Stub Roller Hub/.test(name)) {
        const rollers = [[.0015,.133],[-.0515,.148],[-.104,.163],[-.156,.178],[-.209,.193],[-.2665,.2095]];
        const i = rollers.findIndex(([y,z]) => near(y,z,.015));
        if (i >= 0) return `floor-roller-${i}`;
      }
      if (/Intake \(6329/.test(full)) {
        if (/Dropdown/.test(name)) return 'intake-dropdown';
        if (/Driving 4B Arm|SplineXL Driving Plate/.test(name)) return 'intake-drive-arm';
        if (/Driven CC 4B Arm|Driven 4B Arm Rib/.test(name)) return 'intake-driven-arm';
        if (/Versaroller Tube|30A Wheel|Double Channel 30T/.test(name) || (wide && bounds.min[1] < -.45)) {
          if (near(-.5335,.165,.03)) return 'intake-roller-0';
          if (near(-.489,.2685,.03)) return 'intake-roller-1';
        }
        if (bounds.min[1] < -.33 && !/Hopper Side Panels|Left Intake Mount Plate/.test(name)) return 'intake';
        return 'frame';
      }
      return 'frame';
    },
    // TBA photos: clear polycarbonate side, drum-end and intake-deflector panels (exported as opaque grey).
    finish: ({ name }) => /Hopper Side Panels|^Front Plate$|Front Deflector Plate/.test(name) ? { name: 'clear-hopper-sheet', color: [.8,.86,.91,.22], metal: 0, rough: .3 } : undefined },
  // 1706 Mirage (Champs) public release. Source +X front (twin turrets), -X intake; Z up, meters. Bumpers omitted.
  'mirage-1706': { file: '2026-1706.glb', axes: 'xzy', lossless: true, preserveColors: true,
    omit: /Robot Battery|RoboRIO|PDP 2\.0|Power Distribution|PDH|Robot Radio|Main Breaker|Origin Cube/,
    groups: [], classify: ({ full, name, bounds }) => {
      if (/A-RB-90-1XX/.test(full) && (/Bumper|Corner Bracket/.test(name) || bounds.max[2] < .16)) return 'omit';
      const side = (bounds.min[1]+bounds.max[1]) > 0 ? 'left' : 'right';
      const cx = (bounds.min[0]+bounds.max[0])/2, cy = (bounds.min[1]+bounds.max[1])/2;
      if (/A-RB-50-SHOOTER/.test(full)) return /Aluminum Flywheel/.test(name) ? `flywheel-${side}` : /3" Solid Urethane Wheel/.test(name) ? `wheels-${side}` : `turret-${side}`;
      if (/A-RB-80-TURRET/.test(full)) return `turret-${side}`;
      // Twin spindexer floors: FOREHEAD disc, cone, hub adapter and driven plate share each measured vertical axis.
      if (/A-RB-70-Spindexer/.test(full) && /RB-70-FOREHEAD|^Part 1(?:-Mirrored)?$|3D-Print Adapter|WCP-0972|^Part 7$/.test(name) && Math.hypot(cx+.0885, Math.abs(cy)-.1775) < .03) return `rotor-${side}`;
      if (/C-RB-20-INTAKE/.test(full)) {
        if (/TUBE_ROLLER_BOTTOM/.test(name)) return 'intake-roller-0';
        if (/TUBE_ROLLER_TOP/.test(name)) return 'intake-roller-1';
        // Slide mounts, pivot plates and the drive motor stay on the chassis; the head and extension box move.
        return cx < -.30 ? 'intake' : 'frame';
      }
      return 'frame';
    } },
  // 7769 CHUNK public "Full Robot" (assembly "Chunk"). Source +Y shooter (front), -Y racked intake; Z up, meters.
  // The "Limits" assembly is the team's trench/height envelope reference, not robot geometry.
  'chunk-7769': { file: '2026-7769.glb', axes: 'yzx', lossless: true, preserveColors: true,
    omit: /^(?:Max Height|Max Height Extensions|Trench Extensions|Trench Height)\/|Bumpers <1>|Bumper Bracket|Origin Cube|Rio w\/ Canivore|PDH\+ Pigeon|Power Distribution|Robot Radio|Breaker Mount|SB50 Mount|Battery/,
    groups: [], classify: ({ full, name, bounds }) => {
      const cy = (bounds.min[1]+bounds.max[1])/2, cz = (bounds.min[2]+bounds.max[2])/2, near = (y, z, t = .02) => Math.hypot(cy-y, cz-z) < t;
      const wide = bounds.max[0]-bounds.min[0] > .3;
      if (/L1 Climb Arm/.test(full)) return 'climber';
      if (/Kick Bar <1>/.test(full)) return 'kick-bar';
      if (/Intake <1>/.test(full) && /Moving <1>/.test(full)) {
        if (/Intake Roller|Cat Tongue|Driven Hub|ThunderHex \(25\.5 in\)/.test(name) || (wide && near(-.578,.175,.03))) return 'intake-roller';
        return 'intake';
      }
      if (/Shooter <1>/.test(full)) {
        if (/Stealth Wheel/.test(name) || (wide && near(.2285,.4955,.012))) return 'flywheel';
        if (/Adjust Hood|^Hood Plate|^Hood Tube|32t Aluminum Plate Sprocket/.test(name)) return 'hood';
        if (/Compliant Wheel/.test(name) || (wide && near(.106,.3175,.012))) return 'feeder';
      }
      return 'frame';
    },
    // Hopper side walls are smoked polycarbonate carrying the sponsor decals (TBA photo); the CAD swatch is mid grey.
    finish: ({ name }) => /^Hopper (?:Stationary|Moving) Side(?: Opp)?$/.test(name) ? { name: 'smoked-hopper-sheet', color: [.06,.065,.075,.82], metal: 0, rough: .25 } : undefined },
  // 1987 Cyclone public release "2026_1987_Main": turret over a dye rotor, floating hood, sliding intake.
  'cyclone-1987': { file: '2026-1987.glb', axes: 'yzx', lossless: true, preserveColors: true,
    omit: /Comp Bumpers|Origin Cube|Electrical Assembly|Robot Battery|RoboRIO|Robot Radio|Main Breaker/,
    // "v2 turret structure" is the fixed cell-tower column, turret motor and chain: it stays with the frame.
    groups: [], classify: ({ full, name }) => {
      if (/V3 shooter hood/.test(full)) return 'hood';
      if (/V3 shooter structure/.test(full)) return /4" Urethane Wheel|Flywheel Pulley Hub/.test(name) ? 'flywheel' : 'turret';
      if (/V5 intake slip & slide/.test(full)) return 'intake';
      if (/Hopper <1>/.test(full) && !/Hopper Assembly/.test(full)) return 'rotor';
      return 'frame';
    },
    // The intake-end hopper wall and its side wings are clear polycarbonate on the robot (TBA photos), grey in the CAD.
    finish: ({ full, name }) => /V5 intake slip & slide/.test(full) && /^Front Hopper Wall$|^Part 14$/.test(name) ? { name: 'clear-hopper-sheet', color: [.8,.86,.91,.22], metal: 0, rough: .3 } : undefined },
  // 9496 LYNK Matterhorn public release.
  'matterhorn-9496': { file: '2026-9496.glb', axes: 'yzx', lossless: true, preserveColors: true,
    omit: /Bumper <1>|Origin Cube|PDP 2\.0|Robot Battery|RoboRIO|Robot Radio|Main Breaker/,
    groups: [], classify: ({ full, name, bounds }) => {
      const cy = (bounds.min[1]+bounds.max[1])/2, cz = (bounds.min[2]+bounds.max[2])/2, wide = bounds.max[0]-bounds.min[0] > .3;
      const nearest = (pts, t) => { let best = -1, d = t; pts.forEach(([y, z], i) => { const e = Math.hypot(cy-y, cz-z); if (e < d) { d = e; best = i; } }); return best; };
      if (/Comp Shooter V2/.test(full)) {
        if (/^Drum$|Brass Flywheel/.test(name) || (wide && nearest([[.127,.454]], .012) === 0)) return 'flywheel';
        return 'frame';
      }
      if (/Feeder V3/.test(full)) { const i = /Plate/.test(name) ? -1 : nearest([[.158,.28],[.158,.334],[.158,.388]], .014); return i >= 0 ? `feeder-roller-${i}` : 'frame'; }
      if (/Intake V2/.test(full)) { const i = wide ? nearest([[-.511,.256],[-.576,.161]], .02) : -1; return i >= 0 ? `intake-roller-${i}` : 'intake'; }
      // Slotted side panels and the end panel telescope out with the intake; the fixed panels stay.
      if (/Comp Hopper V5/.test(full) && !/Fixed Panel/.test(name)) return 'hopper-ext';
      return 'frame';
    },
    // The drum is black (grip tape) between its brass flywheels on the robot (TBA photo); the CAD swatch is pale grey.
    finish: ({ name }) => /^Drum$/.test(name) ? { name: 'drum-grip', color: [.07,.07,.08,1], metal: 0, rough: .85 } : undefined },
  'rubble-581': { file: '2026 Dumper Champs Bot581.glb', axes: 'xzy', groups: [
    ['hopper-roof', /^Part 22\/.*Hopper </],
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
    : spec.axes === 'negative-x' ? new Matrix4().set(-1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1)
    : new Matrix4().set(1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1);
  const nodes = root.listNodes();
  axes.elements[12] = spec.offsetX ?? 0;
  axes.elements[13] = spec.offsetY ?? 0;
  axes.elements[14] = spec.offsetZ ?? 0;
  const retained = [];
  let omitted = 0, wheelCount = 0;
  const surfaces = new Set();
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    const names = [n.getName()];
    for (let p = n.getParentNode(); p; p = p.getParentNode()) names.push(p.getName());
    const full = names.join('/');
    if (spec.omit?.test(full)) { n.setMesh(null); omitted++; continue; }
    if (spec.drop?.(n.getName(), full, getBounds(n))) { n.setMesh(null); omitted++; continue; }
    // An unnamed 0.2 m block hangs past the 1318 back bumper (not part of the robot structure).
    if(id==='hero-constantine-1318' && !n.getName() && getBounds(n).min[1]>.31){n.setMesh(null);omitted++;continue;}
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
    // 9408's export carries every fastener and spacer: drop parts under 25 mm, which are invisible at robot scale.
    if (id === 'hero-gadgeteer-9408' && Math.max(...bounds.max.map((v,i)=>v-bounds.min[i])) < .025) { n.setMesh(null); omitted++; continue; }
    // Limestone's export includes an unnamed six-triangle reference sheet outside the robot.
    const looseReference = id === 'limestone-1678' && !n.getName() && bounds.max[1] > .8;
    const hardware = /screw|washer|blind rivet|locknut|hex nut|nutstrip|nut strip|spacer|bearing|bushing|crush block/i.test(n.getName())
      && !/plate|mount|support|arm|shaft|tube/i.test(n.getName());
    if ((id === 'rotor-604-donor' && !/DPC Rotor Assembly/.test(full)) || (id === 'shooter-581-donor' && (!/Shooter Assem/.test(full) || /(?:^|\/)Hopper <|^Triad\//.test(full))) || (id === 'intake-581-donor' && (!/Champs Intake Assembly/.test(full) || bounds.max[2] > .4 || /Front Intake Hopper|Side Panels|Stowed Energy Chain/.test(full))) || looseReference || hardware || /PDP 2\.0|Import for Mass/i.test(full)
      || /bumper foam|bumper long side|bumper battery side|bumper GI side|bumper gusset|9470-2026-DRI-FOAM|bumper assembly|26B0000 Bumpers|^Bumpers\/|1200A Bumper|(?:^|\/)thin (?:Gi|side|back) foam|(?:^|\/)9470.*BUMP/i.test(full)) { n.setMesh(null); omitted++; continue; }
    let group = spec.groups.find(([, re]) => re.test(full))?.[0] ?? 'frame';
    // Per-robot hooks for flat Onshape exports: return a group name, null/'omit' to drop the mesh, or nothing to keep it.
    if (spec.classify) {
      const c = spec.classify({ full, name: n.getName(), bounds, group });
      if (c === null || c === 'omit') { n.setMesh(null); omitted++; continue; }
      if (c) group = c;
    }
    if (spec.regroup) group = spec.regroup(group, n.getName(), full, getBounds(n)) ?? group;
    if (id === 'hero-poofs-254') {
      if (/Elevator Assy/.test(full) && group === 'frame') group = bounds.min[2] >= .95 ? 'stage3' : bounds.min[2] >= .58 ? 'stage2' : 'frame';
      if (group === 'turret' && /^(?:Lower Roller Tube|Shaft)\//.test(full) && bounds.min[0] > .0 && bounds.min[2] > .70) group = 'flywheel';
    }
    if (id === 'hero-mantis-6800') {
      if (group === 'climber' && /GreyT Telescope/.test(full)) {
        group = /WCP-0418/.test(full) || bounds.min[2] > .61 ? 'climb-end'
          : /WCP-0419/.test(full) || bounds.min[2] > .565 ? 'climb-mid2'
          : /WCP-0420/.test(full) && bounds.min[2] < .10 ? 'climb-mid1' : 'climber';
      } else if (group === 'climber' && bounds.min[2] > .60) group = 'climb-pad';
      if (/^intake-/.test(group) && (bounds.max[2] < .30 && Math.max(Math.abs(bounds.min[0]),Math.abs(bounds.max[0])) < .24)) group='frame';
    }
    if (id === 'hero-fireweed-1540' && /Stealth Wheel/.test(n.getName()) && /Indexshooteer/.test(full)) group = `wheel-${wheelCount++}`;
    // 1540's intake is a double-jointed arm: the panel end effector is the second link (joint axle at source y -0.608, z 0.15).
    if (id === 'hero-fireweed-1540' && group === 'intake' && (/^(?:panel intake|panel inner intake plate|polycarb panel|3\/4 axle panel intake|36t Aluminum Plate Sprocket)/.test(n.getName()) || (/^cf tube/.test(n.getName()) && bounds.max[1] < -.65))) group = 'intake-ee';
    if (id === 'hero-multiclass-5800' && group === 'flywheel') group = `flywheel-${Math.round(((bounds.min[0]+bounds.max[0])/2-.06)/.03)}`;
    if (id === 'hero-sentinel-1923') {
      const nm = n.getName();
      // Molded bumper shell: the simulator draws alliance bumpers.
      if (nm === 'Part 2' && bounds.max[0]-bounds.min[0] > .8) { n.setMesh(null); omitted++; continue; }
      if (group === 'intake-arm' && /GIMount|GITubeMt|Antilever|LLMount|Minimal|Kraken|MAXPlanetary|SprocketSpacer|^0\.196|66L #25|24t Aluminum Sprocket|8mm SplineXS|88T|15t Aluminum Pulley \(HTD 5mm, 9mm|Rounded Hex \(2\.438/.test(nm)) group = 'frame';
      else if (group === 'arm') {
        if (/PAMount|PASideMount|GBMount|^Tube 2"x1"x(?:9|12)"|Kraken|MAXPlanetary|MAXSpline|12t Steel Sprocket|54L #25|REV-21-2581/.test(nm)) group = 'frame';
        else if (/Claw|Compliant Intake Wheel|NEO 550|550Spacer|8t Steel Spur|30t Steel Spur|^Tube 2"x2"x16|^0\.196/.test(nm) || (bounds.min[1] > .17 && !/^Tube 2"x1"x17/.test(nm))) group = 'arm-slide';
      }
    }
    if (id === 'hero-sentinel-1923' && /Ground Intake Assy/.test(full) && /Compliant Wheel|Flex Wheel/.test(n.getName())) {
      // Every intake roller is orange so the intake face reads at a glance.
      for (const p of n.getMesh().listPrimitives()) if (p.getMaterial()) p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.96,.4,.04,1]).setName('intake-orange'));
    }
    if (id === 'hero-multiclass-6731') {
      if (/^Speech Bubble\//.test(full)) { let top = n; while (top.getParentNode()?.getParentNode()) top = top.getParentNode(); group = `bubble-${top.getParentNode().listChildren().filter(c => /Speech Bubble/.test(c.getName())).indexOf(top)}`; }
      else if (group === 'frame' && /Hex \(9\.718 in\)/.test(full) && bounds.max[2] < .40) group = 'feeder';
    }
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
    const sheet = simbotSheet || /wall|coroplast|panel|plate|bellypan|polycarb/i.test(n.getName()) || (Math.min(...dims)<.012 && dims.filter(v=>v>.15).length>=2) || (id === 'limestone-1678' && /^Part 60$/.test(n.getName())) || (id === 'hero-mystic-498' && /Wrench Tube|Wrench Gusset/.test(n.getName()));
    const themed = !spec.preserveColors && spec.year !== 2025 && spec.year !== 2024 && (/arm plate|hood plate|slider mount|slot reinforcement|sponsor panel|printed|wire guide/i.test(n.getName()) || (id === 'limestone-1678' && /1678-26c-16(?:14|85)/.test(n.getName())));
    // Retain CAD colors, with rubber and clear-sheet finishes identified by part names.
    for (const p of n.getMesh().listPrimitives()) {
      if (!p.getMaterial()) continue;
      if (id === 'ctrl-alt-defeat-9470') {
        const m=p.getMaterial().clone();const c=m.getBaseColorFactor();
        if(c[0]>c[1]*1.15 && c[2]>c[1]*1.15) m.setBaseColorFactor([.68,.7,.73,1]).setMetallicFactor(.45);
        p.setMaterial(m);
      }
      if (spec.recolor) {
        const next = spec.recolor(p.getMaterial().getBaseColorFactor());
        if (next) p.setMaterial(p.getMaterial().clone().setBaseColorFactor(next));
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
      } else if ((id === 'ctrl-alt-defeat-9470' && /^(?:hopper-walls|hopper-slide|hopper-roof)/.test(group)) || (id === 'downpour-6800' && /7200F Horizontal|7100F Stationary/.test(full) && /polycarb|wall|panel/i.test(n.getName())) || (id === 'mixtape-971' && /Hooper Walls/.test(full))) {
        const m = p.getMaterial().clone().setName('clear-hopper-sheet').setBaseColorFactor([.8,.86,.91,.25]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.3);
        if (sheet) m.setExtras({cadSheet:true});
        p.setMaterial(m);
      } else if (id === 'hero-fireweed-1540' && /^Indexer (?:Left|Right) Plate$/.test(n.getName())) {
        // Clear side plates so the held bubbles in the indexer stay visible from both sides.
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.72,.84,.92,.26]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.3).setName('clear-indexer-plate'));
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
    // Per-robot finishes for CAD manufacturing swatches (photo-fitted, see docs/ROBOT-CAD-IMPORTS.md).
    if (spec.finish) for (const p of n.getMesh().listPrimitives()) {
      const f = p.getMaterial() && spec.finish({ full, name: n.getName(), group, color: p.getMaterial().getBaseColorFactor() });
      if (!f) continue;
      const m = p.getMaterial().clone().setName(f.name ?? 'cad-finish').setBaseColorFactor(f.color);
      if (f.metal !== undefined) m.setMetallicFactor(f.metal);
      if (f.rough !== undefined) m.setRoughnessFactor(f.rough);
      if (f.color[3] < 1) m.setAlphaMode('BLEND').setDoubleSided(true);
      m.setExtras({ ...m.getExtras(), cadFinish: true, ...(sheet ? { cadSheet: true } : {}) });
      p.setMaterial(m);
    }
    if (id === 'hero-nomad-6995' && group === 'frame' && /Intake <1>/.test(full) && bounds.min[2] >= .33) group = 'slapdown';
    const turned = id === 'hero-nomad-6995' && /Elevator <1>/.test(full) ? new Matrix4().makeRotationZ(Math.PI) : new Matrix4();
    const matrix = axes.clone().multiply(turned).multiply(new Matrix4().fromArray(n.getWorldMatrix())).toArray();
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
    if (m.getExtras().cadFinish) continue;
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
  // A final bounded pass reduces those faces without quantizing positions (0.5 mm unless the robot or a spec's `finePass` sets it).
  // Specs opt in with `finalPass: true` or `finePass` when the joined asset still exceeds the size budget.
  if (id === 'reblitz-2910' || id === 'hero-gadgeteer-9408' || spec.finalPass || spec.finePass) {
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      simplifyPrimitive(p, { simplifier: cadSimplifier, ratio: id === 'hero-gadgeteer-9408' ? .45 : .40, error: id === 'hero-gadgeteer-9408' ? .001 : typeof spec.finePass === 'number' ? spec.finePass : .0005 });
    }
    await doc.transform(prune());
  }
  const outputTriangles = triangleCount();
  const bounds = getBounds(scene);
  if (spec.lossless || spec.year === 2025 || spec.year === 2024 || id === 'reblitz-2910') {
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
