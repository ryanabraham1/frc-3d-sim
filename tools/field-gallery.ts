import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FieldFrame } from '../src/engine/coords';
import { FieldBuilder } from '../src/engine/field/builder';
import { loadRapier, PhysicsWorld } from '../src/engine/physics/world';
import { Renderer } from '../src/engine/render/renderer';
import { buildRebuiltField } from '../src/seasons/2026-rebuilt/field';
import { prepareHubCad } from '../src/seasons/2026-rebuilt/hubCad';
import * as C from '../src/seasons/2026-rebuilt/constants';

const renderer = new Renderer(document.querySelector<HTMLElement>('#scene')!, C.FIELD_LENGTH, C.FIELD_WIDTH);
const physics = new PhysicsWorld(await loadRapier());
const frame = new FieldFrame(C.FIELD_LENGTH, C.FIELD_WIDTH);
await prepareHubCad();
buildRebuiltField(new FieldBuilder(physics, renderer.scene, frame));
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
const select = document.querySelector<HTMLSelectElement>('#view')!;
let other = false;
function view(): void {
  const L = C.FIELD_LENGTH, W = C.FIELD_WIDTH;
  let eye = [L*.65, W*.6, 6], target = [L*.5, W*.5, .5];
  switch (select.value) {
    case 'red-tower': eye = [L-2.7, W-C.TOWER_CENTER_Y+(other ? -1.1 : .6), 1.7]; target = [L-.35, W-C.TOWER_CENTER_Y, 1.4]; break;
    case 'blue-tower': eye = [2.7, C.TOWER_CENTER_Y+(other ? -1.1 : .6), 1.7]; target = [.35, C.TOWER_CENTER_Y, 1.4]; break;
    case 'blue-stations': eye = [other ? 2 : -1.6, W*.25, 1.4]; target = [0, W*.25, .9]; break;
    case 'red-stations': eye = [L+(other ? -2 : 1.6), W*.75, 1.4]; target = [L, W*.75, .9]; break;
    case 'guardrail': eye = [L*.42, other ? 1.8 : -1.8, 1.2]; target = [L*.42, 0, .45]; break;
    case 'hub': eye = [C.HUB_CENTER.x+2, C.HUB_CENTER.y+(other ? -1.8 : 1.8), 2]; target = [C.HUB_CENTER.x, C.HUB_CENTER.y, 1.2]; break;
  }
  renderer.camera.position.copy(frame.toWorld(eye[0], eye[1], eye[2]));
  controls.target.copy(frame.toWorld(target[0], target[1], target[2])); controls.update();
}
select.onchange = () => { other = false; view(); };
document.querySelector<HTMLButtonElement>('#angle')!.onclick = () => { other = !other; view(); };
view(); await renderer.prewarm();
document.querySelector('#status')!.textContent = 'Drag to orbit · scroll to zoom · no camera fading';
function draw(): void { controls.update(); renderer.render(); requestAnimationFrame(draw); }
requestAnimationFrame(draw);
