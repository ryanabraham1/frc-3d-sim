import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GamePieceSpec } from '@engine/gamepiece/pool';
import { BUBBLE_MASS, BUBBLE_RADIUS, COLORS, PANEL_MASS, PANEL_RADIUS, PANEL_THICKNESS, pieceIdentity } from './constants';

/**
 * One synchronized pool of 84 conserved pieces with fixed identities (manual pp. 9-10): red bubbles 0-29, blue
 * bubbles 30-59, red panels 60-71, blue panels 72-83. A piece keeps its index through every score, return and re-feed.
 */
const bubble = (color: number): Omit<GamePieceSpec, 'variants'> => ({
  name: 'SPEECH BUBBLE', radius: BUBBLE_RADIUS, colliderScale: 0.97, mass: BUBBLE_MASS, restitution: 0.45, friction: 0.7,
  airDamping: 0.03, groundDamping: 0.9, angularDamping: 1.0, color, count: 84,
});
/** Flat disc collider 24 in across and ½ in thick; the knob is visual only (it fits the slot notches). */
const panel = (color: number): Omit<GamePieceSpec, 'variants'> => ({
  name: 'STORY PANEL', shape: 'ring', radius: PANEL_RADIUS, innerRadius: PANEL_RADIUS - 0.04, length: PANEL_THICKNESS, mass: PANEL_MASS,
  restitution: 0.1, friction: 0.45, airDamping: 0.05, groundDamping: 1.6, angularDamping: 2.0, color, count: 84,
});
export const HERO_PIECES: GamePieceSpec = {
  ...bubble(COLORS.red),
  variants: [
    { start: 30, spec: bubble(COLORS.blue) },
    { start: 60, spec: panel(COLORS.red) },
    { start: 72, spec: panel(COLORS.blue) },
  ],
};
export const isPanel = (i: number) => pieceIdentity(i).kind === 'panel';

/**
 * STORY PANEL visual, matching the supplied CAD: an open rim with three radial spokes and a center knob on one face
 * (disc normal = local +Y, centered on the ½ in panel thickness).
 */
export function panelGeometry(): THREE.BufferGeometry {
  const rim = new THREE.TorusGeometry(PANEL_RADIUS - 0.02, 0.02, 8, 40).rotateX(Math.PI / 2);
  rim.scale(1, (PANEL_THICKNESS / 2) / 0.02, 1);
  const parts: THREE.BufferGeometry[] = [rim];
  for (let k = 0; k < 3; k++) {
    const spoke = new THREE.BoxGeometry(PANEL_RADIUS - 0.03, PANEL_THICKNESS, 0.035).translate((PANEL_RADIUS - 0.03) / 2, 0, 0).rotateY((k * 2 * Math.PI) / 3);
    parts.push(spoke);
  }
  parts.push(new THREE.CylinderGeometry(0.045, 0.045, PANEL_THICKNESS, 16));
  parts.push(new THREE.CylinderGeometry(0.022, 0.028, 0.05, 12).translate(0, PANEL_THICKNESS / 2 + 0.025, 0));
  const flat = parts.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; });
  const out = mergeGeometries(flat)!;
  out.computeVertexNormals();
  return out;
}
