import RAPIER from '@dimforge/rapier3d-compat';

export type RapierModule = typeof RAPIER;
export { RAPIER };

let initPromise: Promise<RapierModule> | null = null;

/** Load the Rapier WASM module once. */
export function loadRapier(): Promise<RapierModule> {
  if (!initPromise) initPromise = RAPIER.init().then(() => RAPIER);
  return initPromise;
}

/** Collision group bits. Rapier packs (membership << 16) | filter into one u32. */
export const Group = {
  FIELD: 1 << 0,
  ROBOT: 1 << 1,
  PIECE: 1 << 2,
  /** Field elements that only stop game pieces (e.g. nets, hub cups) — robots pass through. */
  PIECE_ONLY: 1 << 3,
  /** Field elements that only stop robots (e.g. invisible no-drive walls). */
  ROBOT_ONLY: 1 << 4,
  ALL: 0xffff,
} as const;

export function collisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUPS = {
  field: collisionGroups(Group.FIELD, Group.ROBOT | Group.PIECE),
  pieceOnly: collisionGroups(Group.PIECE_ONLY, Group.PIECE),
  robotOnly: collisionGroups(Group.ROBOT_ONLY, Group.ROBOT),
  robot: collisionGroups(Group.ROBOT, Group.FIELD | Group.ROBOT | Group.PIECE | Group.ROBOT_ONLY),
  // Pieces always collide with each other, including mid-air (real physics — user decision 2026-09-29).
  piece: collisionGroups(Group.PIECE, Group.FIELD | Group.ROBOT | Group.PIECE | Group.PIECE_ONLY),
};

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly dt: number;

  constructor(
    public readonly R: RapierModule,
    dt = 1 / 90,
  ) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = dt;
    this.dt = dt;
  }

  step(): void {
    this.world.step();
  }

  fixedBody(): RAPIER.RigidBody {
    return this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
  }

  free(): void {
    this.world.free();
  }
}
