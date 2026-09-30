import type { GameSettings } from '@engine/core/season';
import { NetClient } from '@engine/net/netClient';
import {
  SLOTS,
  slotAlliance,
  slotId,
  slotLabel,
  slotStation,
  type ClientMsg,
  type HostMsg,
  type LobbyPlayer,
  type LobbyState,
  type MatchSetup,
  type RobotSetup,
  type SlotId,
} from '@engine/net/protocol';
import { cleanName } from '@engine/net/relayProtocol';
import type { RobotConfig } from '@engine/robot/config';

export type LobbyStatus = 'idle' | 'connecting' | 'lobby';

interface PlayerChoice {
  /** undefined = keep the current station. */
  slot?: SlotId | null;
  robot: RobotConfig | null;
  autoRoutine: string;
  manualAuto: boolean;
}

/**
 * Multiplayer lobby: owns the NetClient across menu ↔ match. The host is authoritative for the lobby
 * (slots, robot configs, options) and builds the MatchSetup; clients request changes with `lobby-set`.
 */
export class LobbyController {
  readonly client = new NetClient();
  status: LobbyStatus = 'idle';
  lobby: LobbyState | null = null;
  error = '';
  /** Latest menu settings (robot config, AUTO choice, camera…) for this player. */
  settings: GameSettings | null = null;
  relayUrl = NetClient.defaultUrl();

  onChange: () => void = () => {};
  onStart: (setup: MatchSetup, role: 'host' | 'client') => void = () => {};
  onToLobby: () => void = () => {};
  onClosed: (reason: string) => void = () => {};

  // host-only state
  private readonly choices = new Map<string, PlayerChoice>();
  private lastSent = '';

  constructor() {
    this.client.on('msg', ({ from, data }) => (this.client.isHost ? this.onClientMsg(from, data as ClientMsg) : this.onHostMsg(data as HostMsg)));
    this.client.on('peer-joined', ({ peerId, name }) => this.hostAddPlayer(peerId, name));
    this.client.on('peer-left', ({ peerId }) => this.hostRemovePlayer(peerId));
    this.client.on('closed', ({ reason }) => {
      const was = this.status;
      this.status = 'idle';
      this.lobby = null;
      this.choices.clear();
      this.lastSent = '';
      if (was !== 'idle') this.error = reason === 'Left the room' ? '' : reason;
      this.onClosed(reason);
      this.onChange();
    });
  }

  get isHost(): boolean {
    return this.client.isHost;
  }

  get me(): LobbyPlayer | null {
    return this.lobby?.players.find((p) => p.peerId === this.client.peerId) ?? null;
  }

  async create(name: string): Promise<void> {
    await this.connectThen(async () => {
      await this.client.create(name);
      const s = this.settings;
      this.lobby = {
        room: this.client.room,
        hostId: this.client.peerId,
        seasonId: s?.seasonId ?? '',
        players: [{ peerId: this.client.peerId, name: cleanName(name), slot: null, team: s?.robot.teamNumber ?? 0, host: true }],
        autoHumanPlayer: true,
        inMatch: false,
      };
      if (s) this.applyChoice(this.client.peerId, { slot: slotId(s.alliance, s.station), robot: s.robot, autoRoutine: s.autoRoutine, manualAuto: s.manualAuto });
    });
  }

  async join(code: string, name: string): Promise<void> {
    await this.connectThen(async () => {
      await this.client.join(code, name);
      const s = this.settings;
      this.syncMine(true, s ? slotId(s.alliance, s.station) : null);
    });
  }

  private async connectThen(fn: () => Promise<void>): Promise<void> {
    this.error = '';
    this.status = 'connecting';
    this.onChange();
    try {
      await this.client.connect(this.relayUrl);
      await fn();
      this.status = 'lobby';
    } catch (e) {
      this.client.close('Left the room');
      this.status = 'idle';
      this.error = (e as Error).message;
    }
    this.onChange();
  }

  leave(): void {
    this.client.close('Left the room');
  }

  /** Request a driver station (null = spectate). */
  pickSlot(slot: SlotId | null): void {
    this.error = '';
    this.syncMine(true, slot);
  }

  /**
   * Push this player's robot/AUTO choices to the host if they changed (called whenever the menu renders).
   * `slot` undefined = keep the current station (routine syncs must never move a player — the lobby they
   * see may predate their own pending request).
   */
  syncMine(force = false, slot?: SlotId | null): void {
    const s = this.settings;
    if (!s || !this.client.connected) return;
    const choice: PlayerChoice = { robot: s.robot, autoRoutine: s.autoRoutine, manualAuto: s.manualAuto };
    const key = JSON.stringify(choice);
    if (!force && slot === undefined && key === this.lastSent) return;
    this.lastSent = key;
    if (slot !== undefined) choice.slot = slot;
    if (this.isHost) this.applyChoice(this.client.peerId, choice);
    else {
      const msg: ClientMsg = { t: 'lobby-set', slot, robot: s.robot, autoRoutine: s.autoRoutine, manualAuto: s.manualAuto };
      this.client.send(msg);
    }
  }

  setAutoHumanPlayer(v: boolean): void {
    if (!this.isHost || !this.lobby) return;
    this.lobby.autoHumanPlayer = v;
    this.broadcastLobby();
  }

  canStart(): boolean {
    return !!this.lobby && this.isHost && this.lobby.players.some((p) => p.slot !== null && this.choices.get(p.peerId)?.robot);
  }

  /** Host: build the MatchSetup from the lobby and start everyone. */
  startMatch(): void {
    const lobby = this.lobby;
    if (!lobby || !this.isHost || !this.canStart()) return;
    const robots: RobotSetup[] = [];
    for (const slot of SLOTS) {
      const p = lobby.players.find((x) => x.slot === slot);
      const c = p && this.choices.get(p.peerId);
      if (!p || !c?.robot) continue;
      robots.push({
        id: robots.length,
        slot,
        alliance: slotAlliance(slot),
        station: slotStation(slot),
        config: c.robot,
        autoRoutine: c.autoRoutine,
        manualAuto: c.manualAuto,
        peerId: p.peerId,
        name: p.name,
      });
    }
    const setup: MatchSetup = {
      seasonId: this.settings?.seasonId ?? lobby.seasonId,
      seed: Math.floor(Math.random() * 1e9),
      autoHumanPlayer: lobby.autoHumanPlayer,
      robots,
      peers: lobby.players.map((p) => p.peerId),
    };
    lobby.inMatch = true;
    this.broadcastLobby();
    this.client.send({ t: 'start', setup } satisfies HostMsg);
    this.onStart(setup, 'host');
  }

  /** Host: end the match for everyone and return to the lobby. */
  backToLobby(): void {
    if (!this.lobby || !this.isHost) return;
    this.lobby.inMatch = false;
    this.client.send({ t: 'to-lobby' } satisfies HostMsg);
    this.broadcastLobby();
    this.onToLobby();
  }

  // ─────────────────────────── host side ───────────────────────────

  private onClientMsg(from: string, m: ClientMsg): void {
    if (m?.t !== 'lobby-set' || !this.lobby) return;
    const slot = m.slot === undefined ? undefined : m.slot && SLOTS.includes(m.slot) ? m.slot : null;
    this.applyChoice(from, { slot, robot: m.robot ?? null, autoRoutine: String(m.autoRoutine ?? 'none'), manualAuto: !!m.manualAuto });
  }

  private applyChoice(peerId: string, c: PlayerChoice): void {
    const lobby = this.lobby;
    const p = lobby?.players.find((x) => x.peerId === peerId);
    if (!lobby || !p) return;
    let slot = c.slot === undefined ? p.slot : c.slot;
    const taken = (x: SlotId) => lobby.players.some((o) => o !== p && o.slot === x);
    if (slot && taken(slot)) {
      // Taken (e.g. two players both saved "Blue 2"): new arrivals get the nearest free station on the
      // same alliance, then any; players who already have a station keep it.
      const want = slot;
      const free = [...SLOTS.filter((x) => slotAlliance(x) === slotAlliance(want)), ...SLOTS].find((x) => !taken(x)) ?? null;
      slot = p.slot ?? free;
      const msg = `${slotLabel(want)} is taken${slot ? ` — you're ${slotLabel(slot)}` : ' — spectating'}`;
      if (peerId === this.client.peerId) this.error = msg;
      else this.client.send({ t: 'notice', message: msg } satisfies HostMsg, peerId);
    } else if (peerId === this.client.peerId && c.slot !== undefined) this.error = '';
    p.slot = slot;
    if (c.robot) p.team = c.robot.teamNumber;
    this.choices.set(peerId, { ...c, slot });
    this.broadcastLobby();
  }

  private hostAddPlayer(peerId: string, name: string): void {
    if (!this.isHost || !this.lobby) return;
    if (!this.lobby.players.some((p) => p.peerId === peerId)) this.lobby.players.push({ peerId, name, slot: null, team: 0, host: false });
    this.broadcastLobby();
  }

  private hostRemovePlayer(peerId: string): void {
    if (!this.isHost || !this.lobby) return;
    this.lobby.players = this.lobby.players.filter((p) => p.peerId !== peerId);
    this.choices.delete(peerId);
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    if (!this.lobby) return;
    this.client.send({ t: 'lobby', lobby: this.lobby } satisfies HostMsg);
    this.onChange();
  }

  // ─────────────────────────── client side ───────────────────────────

  private onHostMsg(m: HostMsg): void {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'lobby':
        this.lobby = m.lobby;
        this.onChange();
        break;
      case 'start':
        if (m.setup.peers.includes(this.client.peerId)) this.onStart(m.setup, 'client');
        break;
      case 'to-lobby':
        if (this.lobby) this.lobby.inMatch = false;
        this.onToLobby();
        break;
      case 'notice':
        this.error = m.message;
        this.onChange();
        break;
    }
  }
}
