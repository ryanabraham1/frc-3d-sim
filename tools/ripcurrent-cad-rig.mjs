/** NOMAD 6995 Tide Dye: component boundaries from its public RobotVisualizer + supplied CAD.
 * https://github.com/frc6995/Offseasonbot-2026-public/tree/main/src/main/java/frc/robot
 * Measurements are source metres (Z up); game maps (Y,Z+.0127,X).
 */
import {getBounds} from '@gltf-transform/functions';
import {Color} from 'three';
export function createRipcurrentRig(doc) {
 const materials=new Map(),groups=new Map();
 // Cache source-space bounds before any occurrence is moved into game coordinates.
 const sourceBounds=new Map(doc.getRoot().listNodes().filter(n=>n.getMesh()||/^GoBuilda, Omni, 32mm </.test(n.getName())).map(n=>[n,getBounds(n)]));
 const bounds=n=>sourceBounds.get(n)??getBounds(n);
 const makeMaterial=(role,hex,metal=.1,rough=.65,alpha=1)=>{
  if(!materials.has(role)) materials.set(role,doc.createMaterial(`4414-${role}`).setBaseColorFactor([...new Color(hex).toArray(),alpha]).setMetallicFactor(metal).setRoughnessFactor(rough).setAlphaMode(alpha<1?'BLEND':'OPAQUE').setDoubleSided(alpha<1));
  return materials.get(role);
 };
 const group=(name,rig)=>{if(!groups.has(name))groups.set(name,doc.createNode(name).setExtras(rig?{rig}:{}));return name;};
 const map=([x,y,z])=>[y,z+.0127,x];
 const center=b=>b.min.map((v,i)=>(v+b.max[i])/2);
 const wheelRig=(name,b,parent='frame',kind='roller')=>{
  const size=b.min.map((v,i)=>b.max[i]-v),axis=size.indexOf(Math.min(...size));
  return group(name,{pivot:map(center(b)),axis:axis===0?[0,0,1]:axis===1?[1,0,0]:[0,1,0],parent,kind});
 };
 group('frame');group('fixed-cameras');group('turret',{pivot:[0,0,0],axis:[0,1,0],parent:'frame',kind:'turret'});
 group('shooter-frame',{pivot:[0,0,0],axis:[0,1,0],parent:'turret',kind:'mount'});
 group('hood',{pivot:[-.018275,.5207,.066485],axis:[.9316,0,.3635],parent:'shooter-frame',kind:'hood'});
 group('hood-supports',{pivot:[-.018275,.5207,.066485],axis:[.9316,0,.3635],parent:'hood',kind:'hoodSupport'});
 group('flywheel',{pivot:[-.018275,.5207,.066485],axis:[.9316,0,.3635],parent:'shooter-frame',kind:'flywheel'});
 group('hood-drive',{pivot:[-.024935,.55245,.06389],axis:[.9316,0,.3635],parent:'hood',kind:'index'});
 group('hood-feeder',{pivot:[.01594008,.65547754,-.04084865],axis:[.9316,0,.3635],parent:'hood',kind:'index'});
 group('dye-rotor',{pivot:[0,.123825,0],axis:[0,1,0],parent:'frame',kind:'rotor'});
 group('intake-slide',{pivot:[0,0,0],axis:[1,0,0],parent:'frame',kind:'slide'});
 const omniGroups=new Map(),driveGroups=new Map(),rollerGroups=new Map();
 return {groups,classify(n){
  const name=n.getName(),anc=[];for(let a=n.getParentNode();a;a=a.getParentNode())anc.push(a);
  const names=anc.map(a=>a.getName()),b=bounds(n),c=center(b);
  const shooter=names.includes('Shooter AS <1>'),intake=names.includes('Intake AS <1>'),dye=names.includes('Dye rotor AS <1>'),top=names.includes('Turret AS <1>');
  let destination='frame';
  if(shooter){
   destination='shooter-frame';
   // The hood carries its top feeder, cheek plates, belts and fasteners. The flywheel shaft remains on the turret.
   if(b.min[2]>.55 || /hood (?:left|right)$|Hood ballpath|Hood(?:Left|Right) Echain|bird plate/i.test(name))destination='hood';
   else if(/^(?:3" Steel Flywheel|Flywheel \(For 3"|3" Stealth Wheel|7\.938 in\. Rounded Hex Shaft)/.test(name))destination='flywheel';
   if(/bird plate/i.test(name))destination='hood-supports';
   // Both 77T feeder belts and their powertrain supports rotate with the hood.
   // Their lower ends are below the old height cutoff, so a height-only split left them standing upright.
   if(/^77T 5M 6mm Wide Belt|hood powertrain/i.test(name))destination='hood';
   if(Math.abs(c[2]-.53975)<.002&&/Rounded Hex Shaft|Pulley|Spur Gear|Hub|Bearing/i.test(name))destination='hood-drive';
   // The complete upper shaft (rollers, axle, hubs) rides on the hood, not the fixed turret.
   if(b.min[2]>.625&&b.max[2]<.66&&!/bird plate/i.test(name))destination='hood-feeder';
   // Three fixed feeder shafts below the flywheel spin independently of the hood.
   if(b.max[2]<.43&&/Sushi Roller|Rounded Hex Shaft|Pulley|Spur Gear|Hub/i.test(name)){
    const height=[.32385,.352425,.381].find(z=>Math.abs(c[2]-z)<.002);
    if(height!==undefined){
      const key=`shooter-feed-${height.toFixed(3)}`;
      destination=group(key,{pivot:map([c[0],c[1],height]),axis:[.9316,0,.3635],parent:'shooter-frame',kind:'index'});
    }
   }
  } else if(top){
   // Top/bottom mounting plates, ELP side cameras and net rails are chassis-fixed.
   // Only the central spur rings and the central Limelight ride with the shooter.
   if(/Upper Spur Gear|Lower Spur Gear|Wing Limelight|lower LL4 mount|Limelight heatsink/i.test(name)||b.min[0]>.07&&b.max[0]<.17&&b.min[1]>-.12&&b.max[1]<.03&&b.min[2]>.49&&b.max[2]<.57)destination='turret';
   if(/ELP USB Camera|camera mount(?: cover)?$/i.test(name))destination='fixed-cameras';
  } else if(dye){
   if(/Shark fin|dye rotor (?:upper|bottom) hook|bottom spinning plate/i.test(name))destination='dye-rotor';
   const omni=anc.find(a=>/^GoBuilda, Omni, 32mm </.test(a.getName()));
   if(omni){if(!omniGroups.has(omni))omniGroups.set(omni,wheelRig(`index-wheel-${omniGroups.size}`,bounds(omni),'frame','index'));destination=omniGroups.get(omni);}
  } else if(intake){
   const moving=b.min[1]<-.45 && !/Rack Outer|Hardstop Main/.test(name);
   destination=moving?'intake-slide':'frame';
   if(/Tube, Polycarb, (?:3''|1''|1\.5'') OD|Roller Cap, Intake Idler|Idler Roller Intake/.test(name)){
    const key=`${c[1].toFixed(2)}:${c[2].toFixed(2)}`;
    if(!rollerGroups.has(key))rollerGroups.set(key,group(`intake-roller-${rollerGroups.size}`,{pivot:map([0,c[1],c[2]]),axis:[0,0,1],parent:moving?'intake-slide':'frame',kind:'intakeRoller'}));
    destination=rollerGroups.get(key);
   }
  } else if(names.includes('Drivebase Assembly <1>') && /^(?:Wheel, SDS|Tread, Black Nitrile|Wheel Mount [AB]|MK4 Wheel Spacer)/.test(name)){
   const key=`${Math.sign(c[0])}:${Math.sign(c[1])}`;
   if(!driveGroups.has(key)){
    const tread=doc.getRoot().listNodes().find(q=>q.getMesh()&&q.getName().startsWith('Tread, Black Nitrile')&&Math.sign(center(bounds(q))[0])===Math.sign(c[0])&&Math.sign(center(bounds(q))[1])===Math.sign(c[1]));
    driveGroups.set(key,wheelRig(`drive-wheel-${driveGroups.size}`,bounds(tread??n),'frame','drive'));
   }
   destination=driveGroups.get(key);
  }
  for(const p of n.getMesh().listPrimitives()){
   let m;
   const old=p.getMaterial(),rgb=old?.getBaseColorFactor().slice(0,3)??[1,1,1];
   if(/^(?:Bumper foam|Rear Foam)$/.test(name))m=makeMaterial('bumper-fabric',0x245cce,0,.96);
   else if(names.includes('Bumper AS <1>')&&/Top Plate|corner piece/.test(name))m=makeMaterial('teal-structure',0x16899f,.45,.42);
   else if(/Plate, PC, (?:front panel|Left PC|Right PC)/i.test(name))m=makeMaterial('smoked-hopper',0x17292d,0,.42,.40);
   else if(/Lintake Side Panel/.test(name))m=makeMaterial('dark-hopper-sides',0x162125,0,.65,.72);
   else if(top&&/Top Turret Plate|zipTIDE/.test(name))m=makeMaterial('teal-structure',0x16899f,.45,.42);
   else if(shooter&&/hood (?:left|right)$/i.test(name))m=makeMaterial('teal-structure',0x16899f,.45,.42);
   else if(/(?:3dp|3d print|belt|tread|rubber|stealth wheel|flex wheel|sushi roller)/i.test(name))m=makeMaterial('rubber-and-prints',0x16191c,.02,.85);
   else if((shooter||top)&&/Plate, Alu/i.test(name))m=makeMaterial('black-mechanism',0x1a2025,.45,.45);
   else if(/main sheet metal/i.test(name))m=makeMaterial('black-frame',0x252c30,.45,.5);
   else if(Math.max(...rgb)-Math.min(...rgb)<.12){
    if(rgb[0]>.6)m=makeMaterial('aluminum',0xa4adb5,.65,.42);
    else if(rgb[0]<.36)m=makeMaterial('dark-hardware',0x23272c,.35,.6);
   }
   if(m)p.setMaterial(m);
  }
  if(/^77T 5M 6mm Wide Belt/.test(name)){const h=groups.get('hood');h.setExtras({...h.getExtras(),hoodBeltCount:(h.getExtras().hoodBeltCount??0)+1});}
  return destination;
 }};
}
