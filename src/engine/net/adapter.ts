import type { RobotCommand } from '../robot/robot';

/**
 * Multiplayer seam. Today everything runs locally through LocalAdapter. A future networked adapter
 * (PartyKit / Cloudflare Durable Objects / Colyseus / Supabase Realtime) implements the same
 * interface: clients send their RobotCommand each tick; an authoritative host runs the simulation
 * (the Game class, headless) and broadcasts snapshots.
 */
export interface Snapshot {
  tick: number;
  robots: { id: number; x: number; y: number; z: number; yaw: number; held: number }[];
  /** Packed piece positions [x,y,z, ...] for pieces on field (index-aligned with `pieceIds`). */
  pieces: Float32Array;
  pieceIds: Uint16Array;
  score: { red: number; blue: number };
  clock: { period: string; display: number };
}

export interface NetworkAdapter {
  readonly kind: 'local' | 'client' | 'host';
  /** Robots this client controls. */
  localRobotIds(): number[];
  sendCommand(robotId: number, tick: number, cmd: RobotCommand): void;
  /** Commands received for remote robots this tick (host side). */
  pollCommands(tick: number): Map<number, RobotCommand>;
  /** Host → clients. */
  broadcast?(s: Snapshot): void;
  onSnapshot?(fn: (s: Snapshot) => void): void;
  dispose(): void;
}

export class LocalAdapter implements NetworkAdapter {
  readonly kind = 'local' as const;
  private pending = new Map<number, RobotCommand>();
  constructor(private readonly ids: number[]) {}
  localRobotIds(): number[] {
    return this.ids;
  }
  sendCommand(robotId: number, _tick: number, cmd: RobotCommand): void {
    this.pending.set(robotId, cmd);
  }
  pollCommands(): Map<number, RobotCommand> {
    const out = this.pending;
    this.pending = new Map();
    return out;
  }
  dispose(): void {
    this.pending.clear();
  }
}
