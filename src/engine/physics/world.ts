import RAPIER from '@dimforge/rapier3d-compat';

export type RapierModule = typeof RAPIER;
export { RAPIER };

let initPromise: Promise<RapierModule> | null = null;

/** Load the Rapier WASM module once. */
export function loadRapier(): Promise<RapierModule> {
  // A failed init must not stay cached, or every retry would reject instantly and the loading screen could never recover.
  if (!initPromise) initPromise = RAPIER.init().then(() => RAPIER, (e) => { initPromise = null; throw e; });
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
  /** A game piece held inside a robot's hopper: it only touches other held pieces and that hopper's walls. */
  STOWED: 1 << 5,
  STOW_WALL: 1 << 6,
  ALL: 0xffff,
} as const;

export function collisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUPS = {
  field: collisionGroups(Group.FIELD, Group.ROBOT | Group.PIECE),
  pieceOnly: collisionGroups(Group.PIECE_ONLY, Group.PIECE),
  robotOnly: collisionGroups(Group.ROBOT_ONLY, Group.ROBOT),
  stowed: collisionGroups(Group.STOWED, Group.STOWED | Group.STOW_WALL),
  /** Being pulled in by the intake rollers: passes the hopper wall, still bumps other held pieces. */
  feeding: collisionGroups(Group.STOWED, Group.STOWED),
  stowWall: collisionGroups(Group.STOW_WALL, Group.STOWED),
  robot: collisionGroups(Group.ROBOT, Group.FIELD | Group.ROBOT | Group.PIECE | Group.ROBOT_ONLY),
  // Pieces always collide with each other, including mid-air (real physics — user decision 2026-09-29).
  piece: collisionGroups(Group.PIECE, Group.FIELD | Group.ROBOT | Group.PIECE | Group.PIECE_ONLY),
};

/** Contact prediction distance (m): keep it below the tightest overhead clearance robots drive under. */
export const PREDICTION_DISTANCE = 0.01;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly dt: number;

  constructor(
    public readonly R: RapierModule,
    dt = 1 / 90,
  ) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = dt;
    // Rapier's default 2 cm contact prediction makes speculative contacts that stop a robot dead under a beam it
    // clears by less than that (a trench bot with ½ in to spare, at speed). 1 cm clears that while keeping resting
    // and placement contacts as stable as before; fast bodies (game pieces, robots) still have CCD.
    this.world.integrationParameters.normalizedPredictionDistance = PREDICTION_DISTANCE;
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
