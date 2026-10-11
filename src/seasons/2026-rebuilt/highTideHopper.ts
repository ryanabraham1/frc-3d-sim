import * as THREE from 'three';
import { bar, box, decal } from '@engine/robot/models';
import { inch } from '@engine/units';
import { pocketPlate, xTruss } from './teamShooterDetail';

/**
 * Chamfer on RIPCURRENT's two fixed-end corners, per leg. The binder's 25 × 32 in frame only fits the 110 in perimeter
 * if the two chamfers save 4 in: 2 · (2 − √2) · c ≥ 4 in, so c ≥ 3.4 in. Match photos show a wide teal truss facet
 * there, so 3.5 in. [derived]
 */
export const HIGHTIDE_CHAMFER = inch(3.5);

/** Bold sponsor text at a fixed pixel scale so it stays crisp (decal canvases are 256 px wide). */
function label(parent: THREE.Object3D, text: string, w: number, h: number, x: number, y: number, z: number, rotY: number, weight = '700', style = '') {
  const px = Math.floor(256 * h / w * .78);
  return decal(parent, text, { w, h, x, y, z, rotY, font: `${style} ${weight} ${px}px system-ui, sans-serif` });
}

/**
 * RIPCURRENT's hopper box, after TBA / Chief Delphi match photos (see the checklist above its model):
 * - fixed end (opposite the intake): clear smoked polycarbonate with a white "fabworks." print, a teal X-truss column
 *   at each side, teal rails top and bottom;
 * - the two chamfered corners: full teal X-truss facets;
 * - long sides: darker smoked sponsor panels (HAAS, Google, FRCDesign.org, DoDSTEM, Raytheon, RIPCURRENT) between
 *   black riveted edge strips and a black top rail;
 * - intake end: open into the sliding extension.
 * Panels mount straight to the frame ("bumper integrated construction with outer panels mounted directly to the
 * frame", Behind the Bumpers), so every face stands on the frame rail at `bottom`.
 */
export function highTideHopper(parent: THREE.Object3D, L: number, W: number, bottom: number, top: number, side: number, smoke: THREE.Material, teal: THREE.Material, black: THREE.Material, sponsor: THREE.Material) {
  const hx = L * .485, hz = W * .485, cut = HIGHTIDE_CHAMFER;
  const points: [number, number][] = [[-hx, -hz], [hx - cut, -hz], [hx, -hz + cut], [hx, hz - cut], [hx - cut, hz], [-hx, hz]];
  if (side > 0) for (const p of points) p[0] *= -1;
  const root = new THREE.Group(); root.name = 'hightide-chamfered-hopper'; root.userData.fuelStructure = true; parent.add(root);
  const h = top - bottom;
  // Local +z of each edge group points inward on the unmirrored outline; mirroring (intake on +x) flips the winding.
  const out = side > 0 ? 1 : -1;
  const faceRot = out > 0 ? 0 : Math.PI;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const edge = new THREE.Group(); edge.position.set((a[0] + b[0]) / 2, bottom, (a[1] + b[1]) / 2); edge.rotation.y = -Math.atan2(dz, dx); root.add(edge);
    const endFace = Math.abs(dx) < 1e-6, facet = !endFace && Math.abs(dz) > 1e-6;
    const fixedEnd = endFace && a[0] * side < 0, intakeEnd = endFace && !fixedEnd;
    if (intakeEnd) {
      // Open to the sliding extension: only the black top cross member closes the frame.
      bar(edge, [-length / 2, h, 0], [length / 2, h, 0], .016, black);
      continue;
    }
    box(edge, length, h, .005, fixedEnd || facet ? smoke : sponsor, 0, h / 2, 0);
    if (fixedEnd || facet) {
      // Teal pocketed top rail (and a bottom rail on the fixed end) carries the truss columns.
      const rw = .03, holes: [number, number][][] = [];
      const cells = Math.max(1, Math.round(length / .07)), pitch = length / cells;
      for (let j = 0; j < cells; j++) {
        const x = -length / 2 + j * pitch + .008;
        holes.push([[x, -rw * .3], [x + pitch - .016, -rw * .3], [x + pitch / 2 - .008, rw * .3]]);
      }
      const shoulder = pocketPlate(edge, [[-length / 2, -rw / 2], [length / 2, -rw / 2], [length / 2, rw / 2], [-length / 2, rw / 2]], holes, teal, 0, .004);
      shoulder.rotation.x = Math.PI / 2; shoulder.position.y = h; shoulder.name = 'hightide-pocketed-top-shoulder';
      bar(edge, [-length / 2, h - .008, out * .008], [length / 2, h - .008, out * .008], .016, teal);
      if (fixedEnd) bar(edge, [-length / 2, .012, out * .008], [length / 2, .012, out * .008], .022, teal);
    }
    if (facet) {
      const truss = xTruss(edge, length, h, 2, 4, teal, 0, out * .006);
      truss.name = 'hightide-teal-corner-truss';
    }
    if (fixedEnd) {
      const colW = .09;
      for (const s of [-1, 1]) {
        const col = xTruss(edge, colW, h, 1, 5, teal, s * (length / 2 - colW / 2), out * .006);
        col.name = 'hightide-teal-truss-column';
      }
      // White print straight on the clear panel, as in every match photo (no label background).
      const print = label(edge, 'fabworks.', Math.min(.40, length * .6), .08, 0, h * .64, out * .009, faceRot, '700');
      print.name = 'hightide-fabworks-print';
    }
    if (!fixedEnd && !facet) {
      // Long side: black riveted edge strips and top rail around the sponsor panel.
      for (const s of [-1, 1]) box(edge, .028, h, .006, black, s * (length / 2 - .014), h / 2, out * .006);
      bar(edge, [-length / 2, h - .008, out * .006], [length / 2, h - .008, out * .006], .018, black);
      bar(edge, [-length / 2, .012, out * .006], [length / 2, .012, out * .006], .022, black);
      const z = out * .009, w = length - .09;
      label(edge, 'HAAS', w * .42, .05, 0, h * .84, z, faceRot, '900', 'italic');
      label(edge, 'Google     FRCDesign.org', w * .9, .03, 0, h * .66, z, faceRot, '600');
      label(edge, 'DoDSTEM     Raytheon', w * .8, .028, 0, h * .53, z, faceRot, '600');
      label(edge, 'RIPCURRENT', w * .8, .052, 0, h * .16, z, faceRot, '800').name = 'hightide-ripcurrent-print';
    }
  }
  // Corner posts: teal on the fixed half (inside the truss columns), black at the intake end.
  for (const [x, z] of points) bar(root, [x, bottom, z], [x, top, z], .015, x * side < 0 ? teal : black);
  return { hx, hz, cut, fixedSide: -side, inside: (x: number, z: number) => -side * x + Math.abs(z) <= hx + hz - cut - .075 * Math.SQRT2 };
}
