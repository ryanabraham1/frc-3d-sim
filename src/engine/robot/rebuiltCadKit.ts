import * as THREE from 'three';

/**
 * Small shared pieces for the second batch of 2026 REBUILT CAD rigs (6329, 1706, 7769, 1987, 9496). Each robot keeps
 * its own builder and measured joints; only kinematics/finish helpers live here.
 */

/** Planar four-bar in the robot's X/Y plane (rotation about robot Z, the lateral shaft axis). */
export interface FourBar {
  /** Drive-arm rotation from the exported (deployed) pose, radians about +Z. */
  solve(theta: number): { c: THREE.Vector2; d: THREE.Vector2; coupler: number };
}

/**
 * a / b: fixed pivots of the driving and driven arms; c / d: their coupler pins in the exported pose (robot meters).
 * The coupler angle is the rotation of segment c→d relative to the export, so a rigid coupler group pivoted at c0
 * moves to `c` and turns by `coupler`.
 */
export function fourBar(a: [number, number], b: [number, number], c0: [number, number], d0: [number, number]): FourBar {
  const A = new THREE.Vector2(...a), B = new THREE.Vector2(...b), C0 = new THREE.Vector2(...c0), D0 = new THREE.Vector2(...d0);
  const rCD = C0.distanceTo(D0), rBD = B.distanceTo(D0), base = Math.atan2(D0.y - C0.y, D0.x - C0.x);
  // Assembly branch: the side of line C→B that D sits on in the export. Keeping it fixed (instead of tracking the last
  // solution) makes the pose a pure function of theta, so a first call far from the export cannot flip the linkage.
  const side = (c: THREE.Vector2, d: THREE.Vector2) => Math.sign((B.x - c.x) * (d.y - c.y) - (B.y - c.y) * (d.x - c.x));
  const branch = side(C0, D0);
  return { solve(theta) {
    const c = C0.clone().rotateAround(A, theta);
    // Circle-circle intersection: D lies rCD from C and rBD from B.
    const dist = Math.max(1e-9, c.distanceTo(B));
    const along = (rCD * rCD - rBD * rBD + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, rCD * rCD - along * along));
    const u = B.clone().sub(c).divideScalar(dist), mid = c.clone().addScaledVector(u, along);
    const p1 = new THREE.Vector2(mid.x + h * u.y, mid.y - h * u.x), p2 = new THREE.Vector2(mid.x - h * u.y, mid.y + h * u.x);
    const d = side(c, p1) === branch ? p1 : p2;
    return { c, d, coupler: Math.atan2(d.y - c.y, d.x - c.x) - base };
  } };
}

/** Flat black net over an open-topped CAD hopper (fabric is never in the exports). Robot frame; hidden when a stretch net is drawn. */
export function flatNet(parent: THREE.Object3D, x0: number, x1: number, y: number, width: number, cells = 18): THREE.LineSegments {
  const pts: number[] = [];
  for (let i = 0; i <= cells; i++) {
    const t = i / cells;
    pts.push(x0 + (x1 - x0) * t, y, -width / 2, x0 + (x1 - x0) * t, y, width / 2);
    pts.push(x0, y, (t - .5) * width, x1, y, (t - .5) * width);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const net = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x15171a, transparent: true, opacity: .8 }));
  net.name = 'cad-hopper-net';
  parent.add(net);
  return net;
}

/** Clear polycarbonate finish for CAD sheets exported as opaque swatches. */
export function clearSheets(o: THREE.Object3D | undefined, opacity = .22): void {
  o?.traverse(m => {
    if (!(m instanceof THREE.Mesh)) return;
    const clear = (source: THREE.Material) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(0xdde8f0); material.transparent = true; material.opacity = opacity; material.depthWrite = false;
        material.metalness = 0; material.roughness = .18; material.side = THREE.DoubleSide;
      }
      return material;
    };
    m.material = Array.isArray(m.material) ? m.material.map(clear) : clear(m.material);
    m.castShadow = false;
  });
}
