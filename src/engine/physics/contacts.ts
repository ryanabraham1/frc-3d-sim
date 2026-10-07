import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * True when any collider of body `a` has a real contact (a manifold with points) with any collider of body `b`.
 *
 * Testing every collider pair costs `|a| × |b|` WASM calls, which is ~10^4 for a CAD robot (100-1900 proxy boxes) against
 * another. Instead, ask Rapier which colliders are already paired with each collider of the body with fewer colliders
 * and test only the pairs that involve the other body.
 */
export function bodiesTouching(world: RAPIER.World, a: RAPIER.RigidBody, b: RAPIER.RigidBody): boolean {
  const [few, many] = a.numColliders() <= b.numColliders() ? [a, b] : [b, a];
  const handle = many.handle;
  let hit = false;
  const n = few.numColliders();
  for (let i = 0; i < n && !hit; i++) hit = colliderTouchesBody(world, few.collider(i), handle);
  return hit;
}

/** True when `collider` has a real contact with any collider of the body with handle `bodyHandle`. */
export function colliderTouchesBody(world: RAPIER.World, collider: RAPIER.Collider, bodyHandle: number): boolean {
  let hit = false;
  world.contactPairsWith(collider, (other) => {
    if (hit || other.parent()?.handle !== bodyHandle) return;
    world.contactPair(collider, other, (m) => { if (m.numContacts() > 0) hit = true; });
  });
  return hit;
}
