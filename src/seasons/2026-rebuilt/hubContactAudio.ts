import type { GamePiecePool } from '../../engine/gamepiece/pool';
import type { HubImpact } from '../../engine/audio/gameplayAudio';
import type { HubRefs } from './field';

/** Listen to existing solved CAD contacts; never add colliders or change the ball simulation. */
export class HubContactAudio {
  private touching = new Uint8Array(0);
  private speed = new Float32Array(0);
  private lastAt = [-Infinity, -Infinity];

  reset(): void {
    this.touching.fill(0);
    this.speed.fill(0);
    this.lastAt.fill(-Infinity);
  }

  update(pool: GamePiecePool, hubs: readonly HubRefs[], time: number, emit: (hit: HubImpact) => void): void {
    if (this.touching.length !== pool.count) {
      this.touching = new Uint8Array(pool.count);
      this.speed = new Float32Array(pool.count);
    }
    const world = pool.physics.world;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') { this.touching[i] = 0; this.speed[i] = 0; continue; }
      const p = pool.position(i);
      // Reject carpet balls and anything away from the hubs before asking Rapier for contacts.
      const fx = p.x + pool.frame.length / 2, fy = pool.frame.width / 2 - p.z;
      const h = p.y > 0.3 && p.y < 3.2 ? hubs.findIndex(hub => Math.abs(fx - hub.center.x) < 1 && Math.abs(fy - hub.center.y) < 1) : -1;
      if (h < 0) { this.touching[i] = 0; this.speed[i] = 0; continue; }
      const v = pool.velocity(i);
      const speed = Math.hypot(v.x, v.y, v.z);
      const before = this.speed[i];
      this.speed[i] = speed;
      let contact = false;
      const collider = pool.bodies[i].collider(0);
      world.contactPairsWith(collider, other => {
        if (contact || !hubs[h].impactColliders?.has(other.handle)) return;
        world.contactPair(collider, other, m => { if (m.numContacts() > 0) contact = true; });
      });
      // A resting ball does not repeat the transient on every physics step. Bound event traffic per hub.
      if (contact && !this.touching[i] && before > 0.8 && time - this.lastAt[h] > 0.035) {
        this.lastAt[h] = time;
        emit({ x: p.x, y: p.y, z: p.z, speed: before });
      }
      this.touching[i] = Number(contact);
    }
  }
}
