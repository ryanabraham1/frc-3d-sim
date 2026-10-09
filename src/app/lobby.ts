import { compressCheckpoint, decompressCheckpoint } from '@engine/net/recovery';
import type { GameRecovery } from '@engine/core/game';
import { cleanAutoPlan, type AutoPlan } from '@engine/ai/autoPlan';
import { fillBotStations } from '@engine/ai/matchSetup';
import { seasonLabel, type AiSkill, type GameSettings } from '@engine/core/season';
import { NetClient } from '@engine/net/netClient';
import {
  CHAT_HISTORY,
  MAX_CHAT_LENGTH,
  SLOTS,
  slotAlliance,
  slotId,
  slotLabel,
  slotStation,
  type ChatLine,
  type ClientMsg,
  type HostMsg,
  type LobbyPlayer,
  type LobbyState,
  type MatchSetup,
  type RobotSetup,
  type SlotId,
} from '@engine/net/protocol';
import {
  createDraft,
  draftAct,
  draftAuto,
  draftDone,
  draftPicks,
  isRankedMode,
  visibleRank,
  type RankInfo,
  RANKED_SEASON_ID,
  turnSeconds,
  type Outcome,
  type RankedMode,
} from '@engine/net/ranked';
import type { LeaderEntry, RatingSummary } from '@engine/net/relayProtocol';
import { prefetchDraftThumbs } from './ranked';
import { rankedPool, rankedPoolIds } from './rankedPool';
import { censorText, nameProblem } from '@engine/net/nameFilter';
import { cleanName, cleanTitle, normalizeRoomCode, type RoomListing, type RoomMeta, type RoomVisibility } from '@engine/net/relayProtocol';
import type { RobotConfig } from '@engine/robot/config';
import { getSeason } from '@seasons/index';
import { cloneConfig, footprint } from '@engine/robot/config';
import { fieldToSpot, footprintPoly, resolveStartPose, wrapAngle, type Poly, type StartSpot } from '@engine/startPose';
import type { Alliance } from '@engine/coords';
import { fieldDims, placementDragging, placementProblems } from './placement';

interface RoomRecovery {
  version: 1;
  lobby: LobbyState;
  choices: [string, PlayerChoice][];
  setup: MatchSetup | null;
  game: GameRecovery | null;
}

export type LobbyStatus = 'idle' | 'connecting' | 'lobby';
/** Free hosts (Render/Koyeb) sleep when idle; the site pings the relay early so it's awake by the time you click. */
export type ServerState = 'unknown' | 'waking' | 'online' | 'offline';

/** Give a sleeping free-tier relay this long to boot (Render takes ~1 min). */
const WAKE_TIMEOUT_MS = 120_000;
/** Placement phase: once every driver is locked in, wait this long (so a mis-click can be undone) and start. */
const AUTO_START_MS = 1500;

interface PlayerChoice {
  seasonId?: string;
  /** undefined = keep the current station. */
  slot?: SlotId | null;
  robot: RobotConfig | null;
  autoRoutine: string;
  autoPlan?: AutoPlan;
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
  serverState: ServerState = 'unknown';
  /** Seconds spent waking the relay so far (for the UI). */
  wakeSeconds = 0;
  private waking: Promise<boolean> | null = null;

  /** Public rooms from the relay (null until the first answer). */
  rooms: RoomListing[] | null = null;
  /** Visibility and name used for the next room this player creates. */
  createVisibility: RoomVisibility = 'private';
  createTitle = '';
  /** Room code from an invite link (`?join=CODE`) that has not been used yet. */
  invite: string | null = null;
  /** Our connection dropped and is being resumed. */
  reconnecting = false;
  /** (Client) the host's connection dropped; waiting for them to return. */
  hostAway = false;
  /** Ranked play: search state, my ratings, the leaderboard and the last match's rating change. */
  ranked: {
    mode: RankedMode;
    searching: boolean;
    searchStartedAt: number;
    waiting: number;
    /** My season rating (shared by every mode), record per mode, and place on the leaderboard. */
    profile: { persistent: boolean; name: string; season: string; rating: RatingSummary; standing: { rank: number; total: number } | null } | null;
    leaderboard: LeaderEntry[] | null;
    /** My place on the board (null until I've played). */
    standing: { rank: number; total: number; rating: number; games: number } | null;
    lastResult: { mode: RankedMode; status: 'final' | 'abandoned' | 'void'; before: number; after: number; delta: number; result: string; reason?: string; rankBefore: RankInfo | null; rankAfter: RankInfo | null } | null;
  } = { mode: '2v2', searching: false, searchStartedAt: 0, waiting: 0, profile: null, leaderboard: null, standing: null, lastResult: null };
  /** Name used for ranked (kept in step with the page's name field). */
  playerName = '';
  /** Host: the running match's setup (sent to anyone who joins mid-match so they can spectate). */
  private liveSetup: MatchSetup | null = null;
  private recoveryGame: GameRecovery | null = null;
  private publishingRecovery = false;
  private pendingRecovery: { room: string; json: string } | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline = 0;
  private placeTimer: ReturnType<typeof setTimeout> | null = null;
  private browseTimer: ReturnType<typeof setInterval> | null = null;
  private browseMisses = 0;
  private lastMeta = '';
  private lastChatAt = new Map<string, number>();

  onChange: () => void = () => {};
  /** Public room list changed (so the page can refresh just that list). */
  onRooms: (rooms: RoomListing[]) => void = () => {};
  onStart: (setup: MatchSetup, role: 'host' | 'client') => void = () => {};
  onToLobby: () => void = () => {};
  onRecover: (setup: MatchSetup, role: 'host' | 'client', recovery?: GameRecovery) => void = () => {};
  onClosed: (reason: string) => void = () => {};

  // host-only state
  private readonly choices = new Map<string, PlayerChoice>();
  private lastSent = '';
  private autoStart: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    try {
      const code = normalizeRoomCode(new URLSearchParams(location.search).get('join') ?? '');
      if (code.length === 4) this.invite = code;
    } catch {
      /* no location (tests) */
    }
    this.client.on('rooms', ({ rooms }) => {
      this.rooms = rooms;
      this.onRooms(rooms);
    });
    this.client.on('transport', () => this.onChange());
    this.client.on('reconnecting', () => {
      this.reconnecting = true;
      this.onChange();
    });
    this.client.on('reconnected', () => {
      this.reconnecting = false;
      this.hostAway = false;
      if (this.isHost) {
        this.lastMeta = '';
        this.broadcastLobby();
      } else this.onChange();
    });
    this.client.on('peer-back', ({ peerId }) => {
      this.broadcastLobby();
      if (this.isHost && this.liveSetup && this.lobby?.inMatch) this.sendResume(peerId);
    });
    this.client.on('host-changed', ev => void this.recoverHost(ev));
    this.client.on('queued', ({ waiting }) => {
      this.ranked.waiting = waiting;
      this.onChange();
    });
    this.client.on('queue-status', ({ waiting }) => {
      this.ranked.waiting = waiting;
      const el = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('[data-mp="queue-count"]') : null;
      if (el) el.textContent = String(waiting);
    });
    this.client.on('unqueued', ({ reason }) => {
      this.ranked.searching = false;
      if (reason !== 'Search cancelled') this.error = reason;
      this.onChange();
    });
    this.client.on('relay-error', ({ message }) => {
      // A throttled background refresh isn't a reason to abandon a search.
      if (message.startsWith('Too many ranked requests')) return;
      this.ranked.searching = false;
      this.error = message;
      this.onChange();
    });
    this.client.on('profile', (p) => {
      // Polled every few seconds: only redraw (and replay animations) when something changed.
      const same = JSON.stringify(this.ranked.profile) === JSON.stringify(p);
      this.ranked.profile = p;
      if (!same) this.onChange();
    });
    this.client.on('leaderboard', ({ rows, you }) => {
      const same = JSON.stringify([this.ranked.leaderboard, this.ranked.standing]) === JSON.stringify([rows, you ?? null]);
      this.ranked.leaderboard = rows;
      this.ranked.standing = you ?? null;
      if (!same) this.onChange();
    });
    this.client.on('rating', (r) => {
      const prior = this.ranked.profile?.rating;
      const counted = r.status !== 'void' && r.result !== 'none';
      const games = prior?.games ?? 0;
      // Refresh my standing (leaderboard position) once the result is in.
      setTimeout(() => this.pollRanked(true), 500);
      this.ranked.lastResult = { ...r, rankBefore: visibleRank(r.before, games), rankAfter: visibleRank(r.after, games + (counted ? 1 : 0)) };
      if (this.ranked.profile && counted) {
        const row = this.ranked.profile.rating;
        const m = row.modes[r.mode];
        row.rating = r.after;
        row.games++;
        m.games++;
        row.peak = Math.max(row.peak, r.after);
        const key = r.result === 'win' ? 'wins' : r.result === 'draw' ? 'draws' : 'losses';
        row[key]++;
        m[key]++;
      }
      this.onChange();
    });
    this.client.on('matched', (ev) => this.onMatched(ev));
    this.client.on('host-lost', () => {
      this.hostAway = true;
      this.onChange();
    });
    this.client.on('host-back', () => {
      this.hostAway = false;
      this.onChange();
    });
    this.client.on('msg', ({ from, data }) => (this.client.isHost ? this.onClientMsg(from, data as ClientMsg) : this.onHostMsg(data as HostMsg)));
    this.client.on('peer-joined', ({ peerId, name }) => this.hostAddPlayer(peerId, name));
    this.client.on('peer-left', ({ peerId }) => this.hostRemovePlayer(peerId));
    this.client.on('closed', ({ reason }) => {
      const was = this.status;
      this.status = 'idle';
      this.lobby = null;
      this.reconnecting = false;
      this.hostAway = false;
      this.lastMeta = '';
      this.ranked.searching = false;
      this.clearRankedTimers();
      this.lastChatAt.clear();
      this.liveSetup = null;
      this.recoveryGame = null;
      this.pendingRecovery = null;
      this.choices.clear();
      this.lastSent = '';
      this.clearAutoStart();
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

  /** Create a room (private unless `visibility` says otherwise). */
  /** Refuse a name the filter rejects (the relay enforces this too, so a bypass just becomes "Player"). */
  private badName(name: string): boolean {
    const problem = nameProblem(name);
    if (!problem) return false;
    this.error = problem;
    this.onChange();
    return true;
  }

  async create(name: string, visibility: RoomVisibility = this.createVisibility, title: string = this.createTitle): Promise<void> {
    if (this.badName(name)) return;
    this.createVisibility = visibility;
    this.createTitle = cleanTitle(title);
    await this.connectThen(() => this.doCreate(name, visibility, this.createTitle));
  }

  async join(code: string, name: string): Promise<void> {
    if (this.badName(name)) return;
    await this.connectThen(() => this.doJoin(code, name));
  }

  /**
   * One click into a game: join the fullest open public lobby, or host a new public one if there is none.
   */
  async quickPlay(name: string): Promise<void> {
    if (this.badName(name)) return;
    await this.connectThen(async () => {
      const open = (await this.fetchRooms()).filter((r) => r.state === 'lobby' && r.players < r.max && r.drivers < r.seats);
      // Prefer rooms that already have people in them.
      open.sort((a, b) => b.players - a.players);
      for (const r of open) {
        try {
          await this.doJoin(r.code, name);
          return;
        } catch {
          /* filled up or closed since the list — try the next one */
        }
      }
      await this.doCreate(name, 'public', this.createTitle);
    });
  }

  private async doCreate(name: string, visibility: RoomVisibility, title: string): Promise<void> {
    const s = this.settings;
    const season = s ? getSeason(s.seasonId) : null;
    await this.client.create(name, { visibility, title, season: season ? seasonLabel(season) : '', drivers: 1, seats: SLOTS.length, state: 'lobby', bots: true });
    this.rooms = null;
    this.lastMeta = '';
    this.lobby = {
      room: this.client.room,
      hostId: this.client.peerId,
      visibility,
      title,
      chat: [],
      seasonId: s?.seasonId ?? '',
      players: [{ peerId: this.client.peerId, name: cleanName(name), slot: null, team: s?.robot.teamNumber ?? 0, host: true }],
      autoHumanPlayer: true,
      manualAuto: true,
      fillBots: true,
      botDifficulty: 'normal',
      inMatch: false,
    };
    if (s) this.applyChoice(this.client.peerId, { seasonId: s.seasonId, slot: slotId(s.alliance, s.station), robot: s.robot, autoRoutine: s.autoRoutine, autoPlan: s.autoPlan, manualAuto: s.manualAuto });
  }

  private async doJoin(code: string, name: string): Promise<void> {
    await this.client.join(code, name);
    this.rooms = null;
    const s = this.settings;
    this.syncMine(true, s ? slotId(s.alliance, s.station) : null);
  }

  // ─────────────────────────── ranked ───────────────────────────

  /** Private device key: the relay stores only its hash, so a rating follows this browser. */
  rankedSecret(): string {
    const KEY = 'frc-sim-ranked-secret';
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && /^[0-9a-f]{32,128}$/.test(saved)) return saved;
      const fresh = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, fresh);
      return fresh;
    } catch {
      return (this.memorySecret ??= Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));
    }
  }
  private memorySecret: string | null = null;

  setRankedMode(mode: RankedMode): void {
    if (!isRankedMode(mode) || this.ranked.searching || this.ranked.mode === mode) return;
    this.ranked.mode = mode; // only picks the queue: the rating and leaderboard are shared by every mode
    this.onChange();
  }

  /** Ask the relay for my ratings and the current leaderboard. */
  pollRanked(force = false): void {
    // Searching needs no polling (and the relay's queue request should be the only traffic that matters).
    if (!this.client.open || this.ranked.searching) return;
    // Ratings only change after a match, so they are fetched once per visit (and after each match), not on every poll.
    if (force || !this.ranked.profile) this.client.profile(this.playerName || 'Player', this.rankedSecret());
    this.client.leaderboard(this.rankedSecret());
  }

  async findMatch(name: string): Promise<void> {
    if (this.ranked.searching || this.status !== 'idle' || this.badName(name)) return;
    this.error = '';
    this.ranked.lastResult = null;
    this.playerName = cleanName(name);
    try {
      if (this.serverState !== 'online' && !(await this.wake())) throw new Error('The multiplayer server did not respond. Try again in a moment.');
      await this.client.ensureConnected(this.relayUrl);
    } catch (e) {
      this.error = (e as Error).message;
      this.onChange();
      return;
    }
    this.ranked.searching = true;
    prefetchDraftThumbs(); // render the draft's 3D thumbnails while we wait for a match
    this.ranked.searchStartedAt = Date.now();
    this.ranked.waiting = 1;
    this.client.queue(this.ranked.mode, this.playerName, this.rankedSecret());
    this.onChange();
  }

  cancelSearch(): void {
    if (!this.ranked.searching) return;
    this.ranked.searching = false;
    this.client.unqueue();
    this.onChange();
  }

  /** Both the host and clients report what they saw; the relay applies the rating only if they agree. */
  reportResult(winner: Outcome, red: number, blue: number): void {
    if (this.lobby?.ranked) this.client.reportResult(winner, red, blue);
  }

  private clearRankedTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.placeTimer) clearTimeout(this.placeTimer);
    this.turnTimer = this.placeTimer = null;
  }

  private onMatched(ev: { room: string; peerId: string; hostId: string; mode: RankedMode; roster: { peerId: string; name: string; team: 'red' | 'blue'; rating: number; games: number }[] }): void {
    this.ranked.searching = false;
    this.ranked.mode = ev.mode;
    this.ranked.lastResult = null;
    this.status = 'lobby';
    this.rooms = null;
    this.lobby = null;
    this.error = '';
    if (ev.peerId === ev.hostId) this.hostRankedRoom(ev);
    // Everyone else waits for the host's first lobby message.
    this.onChange();
  }

  /** Host: seat the matched drivers and open the ban/pick draft. */
  private hostRankedRoom(ev: { room: string; peerId: string; mode: RankedMode; roster: { peerId: string; name: string; team: 'red' | 'blue'; rating: number; games: number }[] }): void {
    const season = getSeason(RANKED_SEASON_ID);
    const used = { red: 0, blue: 0 };
    const players: LobbyPlayer[] = ev.roster.map((r) => ({
      peerId: r.peerId,
      name: r.name,
      slot: slotId(r.team, ++used[r.team]),
      team: 0,
      host: r.peerId === ev.peerId,
      rating: r.rating,
      games: r.games,
    }));
    this.choices.clear();
    this.lastMeta = '';
    this.lobby = {
      room: ev.room,
      hostId: ev.peerId,
      visibility: 'private',
      title: `Ranked ${ev.mode}`,
      chat: [],
      seasonId: season.id,
      players,
      autoHumanPlayer: true,
      manualAuto: true,
      fillBots: false,
      inMatch: false,
      ranked: { mode: ev.mode, phase: 'draft', draft: createDraft(ev.mode, rankedPoolIds(season)), turnMs: 0 },
    };
    this.systemChat(`${ev.mode} ranked match — ban and pick your robots`);
    this.startTurn();
    this.broadcastLobby();
  }

  private startTurn(): void {
    const r = this.lobby?.ranked;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (!r || r.phase !== 'draft') return;
    if (draftDone(r.draft)) return this.finishDraft();
    const ms = turnSeconds(r.draft) * 1000;
    this.turnDeadline = Date.now() + ms;
    r.turnMs = ms;
    // A little slack so a pick sent right at the buzzer still counts.
    this.turnTimer = setTimeout(() => {
      draftAuto(r.draft);
      this.startTurn();
      this.broadcastLobby();
    }, ms + 300);
  }

  private hostDraft(peerId: string, id: unknown): void {
    const r = this.lobby?.ranked;
    const p = this.lobby?.players.find((x) => x.peerId === peerId);
    if (!r || r.phase !== 'draft' || !p?.slot || typeof id !== 'string') return;
    const err = draftAct(r.draft, p.slot, id);
    if (err) {
      if (peerId === this.client.peerId) this.error = err;
      else this.client.send({ t: 'notice', message: err } satisfies HostMsg, peerId);
      return this.onChange();
    }
    this.startTurn();
    this.broadcastLobby();
  }

  /** Draft over: everyone gets their pick, then the placement phase (with a deadline) starts. */
  private finishDraft(): void {
    const lobby = this.lobby;
    const r = lobby?.ranked;
    if (!lobby || !r) return;
    const season = getSeason(lobby.seasonId);
    const pool = new Map(rankedPool(season).map((e) => [e.id, e]));
    const picks = draftPicks(r.draft);
    for (const p of lobby.players) {
      const entry = p.slot && pool.get(picks.get(p.slot) ?? '');
      if (!entry) continue;
      this.choices.set(p.peerId, { seasonId: lobby.seasonId, slot: p.slot, robot: cloneConfig(entry.config), autoRoutine: season.autoRoutines[0].id, manualAuto: true });
      p.team = entry.config.teamNumber;
      this.refreshDims(p.peerId);
    }
    r.phase = 'placing';
    this.systemChat('Draft complete — choose your starting positions');
    this.beginPlacement();
    if (this.lobby?.ranked?.phase === 'placing') {
      // Anyone still undecided when time runs out is locked in where they stand.
      this.placeTimer = setTimeout(() => {
        const l = this.lobby;
        if (!l?.placing) return;
        for (const p of l.players) if (p.slot && !p.ready) this.hostPlace(p.peerId, p.spot ?? null, true);
      }, 75_000);
    }
    this.broadcastLobby();
  }

  /** Ask the relay for the public list and wait for the answer (empty if it doesn't come). */
  private fetchRooms(): Promise<RoomListing[]> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve([]);
      }, 3000);
      const off = this.client.on('rooms', ({ rooms }) => {
        clearTimeout(timer);
        off();
        resolve(rooms);
      });
      this.client.list();
    });
  }

  /**
   * Keep the public room list fresh while the Multiplayer page shows it. Opens an idle relay connection (reused
   * by Create/Join, so they start instantly) and stops by itself once the list leaves the page.
   */
  browse(): void {
    if (this.browseTimer || this.status !== 'idle') return;
    const poll = async () => {
      if (this.status === 'connecting') return;
      if (this.status === 'lobby') return this.stopBrowse(false);
      const onRanked = !!document.querySelector('[data-mp="ranked-page"]');
      if (!onRanked && !document.querySelector('[data-mp="rooms"]')) {
        if (++this.browseMisses >= 2) this.stopBrowse(true);
        return;
      }
      this.browseMisses = 0;
      try {
        await this.client.ensureConnected(this.relayUrl);
        if (onRanked) {
          this.pollRanked();
          this.client.list(); // live ranked matches to watch
        } else this.client.list();
      } catch {
        if (this.rooms === null) this.onRooms([]);
      }
    };
    this.browseTimer = setInterval(() => void poll(), 5000);
    setTimeout(() => void poll(), 60); // after the page that called us is in the DOM
  }

  private stopBrowse(closeIdle: boolean): void {
    if (this.browseTimer) clearInterval(this.browseTimer);
    this.browseTimer = null;
    this.browseMisses = 0;
    if (closeIdle && this.ranked.searching) this.cancelSearch();
    if (closeIdle && this.status === 'idle' && !this.client.room) this.client.close();
  }

  /** The invite code to join automatically (clears it and tidies the address bar). */
  takeInvite(): string | null {
    const code = this.invite;
    this.invite = null;
    if (code) {
      try {
        const url = new URL(location.href);
        url.searchParams.delete('join');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
    }
    return code;
  }

  /** Shareable link that opens the site and joins this room. */
  inviteLink(): string {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('join', this.lobby?.room ?? '');
      return url.toString();
    } catch {
      return this.lobby?.room ?? '';
    }
  }

  /**
   * Probe the relay's WebSocket until it opens (or WAKE_TIMEOUT_MS passes). Called when the Multiplayer page
   * opens, so a sleeping free-tier server starts booting while the player types their name.
   */
  wake(force = false): Promise<boolean> {
    if (this.serverState === 'online') return Promise.resolve(true);
    if (this.waking && !force) return this.waking;
    if (!/^wss?:\/\//.test(this.relayUrl)) {
      this.serverState = 'offline';
      this.onChange();
      return Promise.resolve(false);
    }
    const started = performance.now();
    this.serverState = 'waking';
    this.wakeSeconds = 0;
    this.onChange();
    const tick = setInterval(() => {
      this.wakeSeconds = Math.round((performance.now() - started) / 1000);
      // Update the timer without replacing the form while someone is typing a name or room code.
      const timer = document.querySelector<HTMLElement>('[data-mp="wake-seconds"]');
      if (timer) timer.textContent = `${this.wakeSeconds}s`;
    }, 1000);
    const attempt = async (): Promise<boolean> => {
      while (performance.now() - started < WAKE_TIMEOUT_MS) {
        if (await NetClient.probe(this.relayUrl)) return true;
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    };
    this.waking = attempt().then((ok) => {
      clearInterval(tick);
      this.serverState = ok ? 'online' : 'offline';
      this.waking = null;
      this.onChange();
      return ok;
    });
    return this.waking;
  }

  private async connectThen(fn: () => Promise<void>): Promise<void> {
    this.error = '';
    this.invite = null; // any explicit action replaces a pending invite
    this.status = 'connecting';
    this.onChange();
    try {
      if (this.serverState !== 'online' && !(await this.wake())) throw new Error('The multiplayer server did not respond. Try again in a moment.');
      await this.client.ensureConnected(this.relayUrl);
      await fn();
      this.status = 'lobby';
    } catch (e) {
      if (this.client.room) this.client.close('Left the room');
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
    if (!s || !this.client.connected || this.lobby?.ranked) return;
    const choice: PlayerChoice = { seasonId: s.seasonId, robot: s.robot, autoRoutine: s.autoRoutine, autoPlan: s.autoPlan, manualAuto: s.manualAuto };
    const key = JSON.stringify(choice);
    if (!force && slot === undefined && key === this.lastSent) return;
    this.lastSent = key;
    if (slot !== undefined) choice.slot = slot;
    if (this.isHost) this.applyChoice(this.client.peerId, choice);
    else {
      const msg: ClientMsg = { t: 'lobby-set', seasonId: s.seasonId, slot, robot: s.robot, autoRoutine: s.autoRoutine, autoPlan: s.autoPlan, manualAuto: s.manualAuto };
      this.client.send(msg);
    }
  }

  /** Host: list the room in the public browser, or hide it behind its code. */
  setVisibility(v: RoomVisibility): void {
    if (!this.isHost || !this.lobby || this.lobby.visibility === v) return;
    this.lobby.visibility = v;
    this.createVisibility = v;
    this.systemChat(v === 'public' ? 'Room is now public' : 'Room is now private');
    this.broadcastLobby();
  }

  setTitle(title: string): void {
    if (!this.isHost || !this.lobby) return;
    const t = cleanTitle(title);
    if (t === (this.lobby.title ?? '')) return;
    this.lobby.title = t;
    this.createTitle = t;
    this.broadcastLobby();
  }

  /** Host: remove a player from the room (they can't rejoin while it exists). */
  kick(peerId: string): void {
    if (!this.isHost || !this.lobby || peerId === this.client.peerId) return;
    const p = this.lobby.players.find((x) => x.peerId === peerId);
    if (!p) return;
    this.client.kick(peerId);
    this.systemChat(`${p.name} was removed`);
    // The relay confirms with peer-left, which drops them from the lobby; do it now so the UI doesn't lag.
    this.hostRemovePlayer(peerId, false);
  }

  /** Say something in the lobby chat. */
  sendChat(text: string): void {
    const t = cleanChat(text);
    if (!t || !this.lobby) return;
    if (this.isHost) this.hostChat(this.client.peerId, t);
    else this.client.send({ t: 'chat', text: t } satisfies ClientMsg);
  }

  /** Ranked draft: ban or pick a robot on my turn. */
  draft(id: string): void {
    if (!this.lobby?.ranked) return;
    if (this.isHost) this.hostDraft(this.client.peerId, id);
    else this.client.send({ t: 'draft', id } satisfies ClientMsg);
  }

  setAutoHumanPlayer(v: boolean): void {
    if (!this.isHost || !this.lobby) return;
    this.lobby.autoHumanPlayer = v;
    this.broadcastLobby();
  }

  setManualAuto(v: boolean): void {
    if (!this.isHost || !this.lobby || this.lobby.inMatch || this.lobby.placing) return;
    this.lobby.manualAuto = v;
    this.broadcastLobby();
  }

  setBots(fill: boolean, difficulty: AiSkill = this.lobby?.botDifficulty ?? 'normal'): void {
    if (!this.isHost || !this.lobby || this.lobby.inMatch || this.lobby.placing) return;
    if (!['normal', 'hard', 'einstein'].includes(difficulty)) return;
    this.lobby.fillBots = fill;
    this.lobby.botDifficulty = difficulty;
    this.broadcastLobby();
  }

  canStart(): boolean {
    return !!this.lobby && this.isHost && this.lobby.players.some((p) => p.slot !== null && this.choices.get(p.peerId)?.robot);
  }

  setSeason(id: string): void {
    if (!this.isHost || !this.lobby || this.lobby.ranked || this.lobby.inMatch || this.lobby.seasonId === id) return;
    if (getSeason(id).id !== id) return;
    this.lobby.seasonId = id;
    // A start spot belongs to one season's field.
    for (const p of this.lobby.players) {
      p.autoPlan = undefined;
      p.spot = null;
      p.ready = false;
      this.refreshDims(p.peerId);
    }
    this.broadcastLobby();
  }

  // ─────────────────────────── placement phase ───────────────────────────

  /** Host: open the placement phase (drivers pick their starting positions); seasons without a start zone start at once. */
  beginPlacement(): void {
    const lobby = this.lobby;
    if (!lobby || !this.isHost || !this.canStart()) return;
    if (!getSeason(lobby.seasonId).startArea) return this.startMatch();
    for (const p of lobby.players) {
      p.ready = false;
      this.refreshDims(p.peerId);
    }
    lobby.placing = true;
    this.broadcastLobby();
  }

  /** Host: leave the placement phase without starting. */
  cancelPlacement(): void {
    if (!this.lobby || !this.isHost || !this.lobby.placing) return;
    this.lobby.placing = false;
    this.clearAutoStart();
    this.broadcastLobby();
  }

  /** Drag preview of my own spot: local only (sent on release via `place`). */
  previewSpot(spot: StartSpot): void {
    const me = this.me;
    if (me) me.spot = spot;
  }

  /** Send my starting spot (blue frame; null = my station's preset) and whether I'm locked in. */
  place(spot: StartSpot | null, ready: boolean): void {
    const me = this.me;
    if (!me || !this.lobby?.placing) return;
    if (this.isHost) return this.hostPlace(this.client.peerId, spot, ready);
    me.spot = spot;
    me.ready = ready;
    this.client.send({ t: 'place', spot, ready } satisfies ClientMsg);
    this.onChange();
  }

  private clearAutoStart(): void {
    if (this.autoStart) clearTimeout(this.autoStart);
    this.autoStart = null;
  }

  private allReady(): boolean {
    const seated = this.lobby?.players.filter((p) => p.slot) ?? [];
    return seated.length > 0 && seated.every((p) => p.ready);
  }

  private hostPlace(peerId: string, spot: StartSpot | null, ready: boolean): void {
    const lobby = this.lobby;
    const p = lobby?.players.find((x) => x.peerId === peerId);
    if (!lobby?.placing || !p?.slot) return;
    const season = getSeason(lobby.seasonId);
    const prev = p.spot ?? null;
    let notice = '';
    if (spot && ![spot.x, spot.y, spot.yaw].every((v) => typeof v === 'number' && Number.isFinite(v))) spot = prev;
    p.spot = spot ? { x: spot.x, y: spot.y, yaw: wrapAngle(spot.yaw) } : null;
    // Never trust a client's pose: an illegal one (outside the zone, on a field element or teammate) is refused.
    if (p.spot && placementProblems(season, lobby.players).has(peerId)) {
      notice = placementProblems(season, lobby.players).get(peerId)!;
      p.spot = prev;
    }
    p.ready = ready && !placementProblems(season, lobby.players).has(peerId);
    // Moving next to a teammate can invalidate theirs.
    const problems = placementProblems(season, lobby.players);
    for (const o of lobby.players) if (problems.has(o.peerId)) o.ready = false;
    if (notice) {
      if (peerId === this.client.peerId) this.error = notice;
      else this.client.send({ t: 'notice', message: notice } satisfies HostMsg, peerId);
    }
    this.broadcastLobby();
    this.scheduleAutoStart();
  }

  private scheduleAutoStart(): void {
    this.clearAutoStart();
    if (this.lobby?.placing && this.allReady()) this.autoStart = setTimeout(() => this.lobby?.placing && this.allReady() && this.startMatch(), AUTO_START_MS);
  }

  private robotFor(peerId: string): RobotConfig | null {
    const lobby = this.lobby;
    const c = this.choices.get(peerId);
    if (!lobby || !c?.robot) return null;
    return c.seasonId === lobby.seasonId ? c.robot : { ...cloneConfig(getSeason(lobby.seasonId).robotDefaults), teamNumber: c.robot.teamNumber };
  }

  /** Keep each player's published footprint in step with their robot (for the placement map). */
  private refreshDims(peerId: string): void {
    const p = this.lobby?.players.find((x) => x.peerId === peerId);
    const cfg = this.robotFor(peerId);
    if (p && cfg) {
      const fp = footprint(cfg);
      p.dims = { length: fp.length, width: fp.width };
    }
  }

  /** Host: build the MatchSetup from the lobby and start everyone. */
  startMatch(): void {
    const lobby = this.lobby;
    if (!lobby || !this.isHost || !this.canStart()) return;
    if (lobby.placing && !this.allReady()) return;
    const season = getSeason(lobby.seasonId);
    const dims = fieldDims(season);
    const placed = new Map<Alliance, Poly[]>();
    const robots: RobotSetup[] = [];
    for (const slot of SLOTS) {
      const p = lobby.players.find((x) => x.slot === slot);
      const c = p && this.choices.get(p.peerId);
      if (!p || !c?.robot) continue;
      const config = this.robotFor(p.peerId)!;
      const alliance = slotAlliance(slot);
      const fp = footprint(config);
      const blockers = placed.get(alliance) ?? [];
      const start = resolveStartPose(dims, season.startArea, alliance, p.spot, season.startPose(alliance, slotStation(slot)), fp.length, fp.width, blockers);
      placed.set(alliance, [...blockers, footprintPoly(fieldToSpot(dims, alliance, start), fp.length, fp.width)]);
      robots.push({
        id: robots.length,
        slot,
        alliance,
        station: slotStation(slot),
        config,
        start,
        autoRoutine: c.seasonId === lobby.seasonId ? c.autoRoutine : getSeason(lobby.seasonId).autoRoutines[0].id,
        autoPlan: c.seasonId === lobby.seasonId && c.autoRoutine === 'custom' ? cleanAutoPlan(c.autoPlan, season) : undefined,
        manualAuto: lobby.manualAuto ?? false,
        peerId: p.peerId,
        name: p.name,
      });
    }
    const setup: MatchSetup = {
      seasonId: lobby.seasonId,
      seed: Math.floor(Math.random() * 1e9),
      autoHumanPlayer: lobby.autoHumanPlayer,
      robots,
      peers: lobby.players.map((p) => p.peerId),
    };
    if (lobby.fillBots && this.settings) {
      const skill = lobby.botDifficulty ?? 'normal';
      setup.botDifficulty = skill;
      fillBotStations(setup, { ...this.settings, aiOpponents: true, aiDifficulty: skill, aiAlly: { skill }, aiOpponent: { skill } }, season);
    }
    lobby.inMatch = true;
    lobby.placing = false;
    if (lobby.ranked) lobby.ranked.phase = 'playing';
    this.clearRankedTimers();
    this.clearAutoStart();
    for (const p of lobby.players) p.ready = false;
    this.broadcastLobby();
    const wire: MatchSetup = { ...setup, robots: setup.robots.map(({ autoPlan: _plan, ...r }) => r) };
    this.liveSetup = setup;
    this.recoveryGame = null;
    this.publishRecovery();
    this.client.send({ t: 'start', setup: wire } satisfies HostMsg);
    this.onStart(setup, 'host');
  }

  /** Host: end the match for everyone and return to the lobby. */
  backToLobby(): void {
    if (!this.lobby || !this.isHost) return;
    this.lobby.inMatch = false;
    this.liveSetup = null;
    this.recoveryGame = null;
    this.client.send({ t: 'to-lobby' } satisfies HostMsg);
    this.broadcastLobby();
    this.onToLobby();
  }

  updateRecovery(state: GameRecovery): void {
    this.recoveryGame = state;
    this.publishRecovery();
  }

  private publishRecovery(): void {
    // Ranked departure adjudication stays with the ranked service; it never elects a new authority.
    if (!this.isHost || !this.lobby || this.lobby.ranked) return;
    // During construction, keep the last complete lobby checkpoint until the game is ready.
    if (this.lobby.inMatch && !this.recoveryGame) return;
    const data: RoomRecovery = { version: 1, lobby: this.lobby, choices: [...this.choices], setup: this.liveSetup, game: this.recoveryGame };
    // Capture now; lobby and pool state keep changing while native compression is in progress.
    this.pendingRecovery = { room: this.client.room, json: JSON.stringify(data) };
    if (!this.publishingRecovery) void this.flushRecovery();
  }

  private async flushRecovery(): Promise<void> {
    this.publishingRecovery = true;
    try {
      while (this.pendingRecovery) {
        const pending = this.pendingRecovery;
        this.pendingRecovery = null;
        const data = await compressCheckpoint(pending.json);
        // A newer checkpoint supersedes one still compressing; leaving a room cancels the upload.
        if (this.pendingRecovery || !this.isHost || this.client.room !== pending.room) continue;
        this.client.checkpoint(data);
      }
    } catch {
      this.error = 'Unable to save a host recovery checkpoint';
      this.onChange();
    } finally { this.publishingRecovery = false; }
  }

  private sendResume(to?: string): void {
    if (!this.liveSetup) return;
    const wire: MatchSetup = { ...this.liveSetup, robots: this.liveSetup.robots.map(({ autoPlan: _plan, ...r }) => r) };
    this.client.send({ t: 'resume', setup: wire } satisfies HostMsg, to);
  }

  private async recoverHost(ev: { hostId: string; previousHostId: string; peers: { peerId: string; name: string }[]; checkpoint?: unknown }): Promise<void> {
    this.hostAway = false;
    const room = this.client.room;
    let saved: RoomRecovery | undefined;
    if (this.isHost) {
      try { saved = await decompressCheckpoint(ev.checkpoint) as RoomRecovery; }
      catch { this.error = 'Unable to read the host recovery checkpoint'; this.leave(); return; }
      // Another handoff or a deliberate leave can supersede the asynchronous decompression.
      if (!this.client.connected || this.client.room !== room || !this.isHost || this.client.hostId !== ev.hostId) return;
      if (!saved || saved.version !== 1) { this.error = 'Unable to recover the host'; this.leave(); return; }
      this.lobby = saved.lobby;
      this.choices.clear();
      for (const [id, choice] of saved.choices) this.choices.set(id, choice);
      this.liveSetup = saved.setup;
      this.recoveryGame = saved.game;
      this.lastMeta = '';
    }
    if (!this.lobby) return;
    const ids = new Set(ev.peers.map(p => p.peerId));
    this.lobby.players = this.lobby.players.filter(p => ids.has(p.peerId));
    for (const p of this.lobby.players) p.host = p.peerId === ev.hostId;
    // Membership changes since the checkpoint (including late spectators) must survive the handoff.
    for (const peer of ev.peers) {
      if (!this.lobby.players.some(p => p.peerId === peer.peerId)) this.lobby.players.push({ ...peer, slot: null, team: 0, host: peer.peerId === ev.hostId });
    }
    for (const id of this.choices.keys()) if (!ids.has(id)) this.choices.delete(id);
    if (this.liveSetup) this.liveSetup.peers = [...ids];
    this.status = 'lobby';
    this.clearAutoStart();
    if (this.isHost) {
      this.systemChat('Host changed — room recovered');
      this.broadcastLobby();
      this.scheduleAutoStart();
    } else this.onChange();
    if (this.isHost) {
      if (this.lobby.inMatch && this.liveSetup) {
        this.onRecover(this.liveSetup, 'host', this.recoveryGame ?? undefined);
        this.sendResume();
      } else {
        this.client.send({ t: 'to-lobby' } satisfies HostMsg);
        this.onToLobby();
      }
    }
  }

  // ─────────────────────────── host side ───────────────────────────

  private systemChat(text: string): void {
    this.pushChat({ from: '', text });
  }

  private pushChat(line: ChatLine): void {
    const lobby = this.lobby;
    if (!lobby) return;
    lobby.chat = [...(lobby.chat ?? []), line].slice(-CHAT_HISTORY);
  }

  private hostChat(from: string, raw: unknown): void {
    const p = this.lobby?.players.find((x) => x.peerId === from);
    const text = cleanChat(raw);
    const now = Date.now();
    if (!p || !text || now - (this.lastChatAt.get(from) ?? 0) < 400) return;
    this.lastChatAt.set(from, now);
    this.pushChat({ from: p.name, text, alliance: p.slot ? slotAlliance(p.slot) : undefined });
    this.broadcastLobby();
  }

  /** Tell the relay what the public list should show (only when it changed). */
  private pushMeta(): void {
    const l = this.lobby;
    if (!l || !this.isHost) return;
    let season = '';
    try {
      const d = getSeason(l.seasonId);
      season = seasonLabel(d);
    } catch {
      /* unknown season */
    }
    const meta: RoomMeta = {
      visibility: l.visibility ?? 'private',
      title: l.title ?? '',
      season,
      drivers: l.players.filter((p) => p.slot).length,
      seats: SLOTS.length,
      state: l.inMatch ? 'match' : l.placing ? 'placing' : 'lobby',
      bots: !!l.fillBots,
    };
    const key = JSON.stringify(meta);
    if (key === this.lastMeta) return;
    this.lastMeta = key;
    this.client.setMeta(meta);
  }

  private onClientMsg(from: string, m: ClientMsg): void {
    if (!this.lobby) return;
    if (m?.t === 'chat') {
      this.hostChat(from, m.text);
      return;
    }
    if (m?.t === 'draft') {
      this.hostDraft(from, m.id);
      return;
    }
    if (this.lobby.ranked && m?.t === 'lobby-set') return; // ranked robots and seats come from the draft
    if (m?.t === 'place') {
      this.hostPlace(from, m.spot ?? null, !!m.ready);
      return;
    }
    if (m?.t !== 'lobby-set') return;
    const slot = m.slot === undefined ? undefined : m.slot && SLOTS.includes(m.slot) ? m.slot : null;
    this.applyChoice(from, { seasonId: m.seasonId, slot, robot: m.robot ?? null, autoPlan: m.autoPlan, autoRoutine: String(m.autoRoutine ?? 'none'), manualAuto: !!m.manualAuto });
  }

  private applyChoice(peerId: string, c: PlayerChoice): void {
    const lobby = this.lobby;
    const p = lobby?.players.find((x) => x.peerId === peerId);
    if (!lobby || !p) return;
    // Nobody changes seats while a match is running (late joiners spectate).
    let slot = c.slot === undefined || lobby.inMatch ? p.slot : c.slot;
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
    const moved = p.slot !== slot;
    p.slot = slot;
    if (c.robot) p.team = c.robot.teamNumber;
    const previous = this.choices.get(peerId);
    c.autoPlan = c.seasonId === lobby.seasonId ? cleanAutoPlan(c.autoPlan, getSeason(lobby.seasonId)) : undefined;
    this.choices.set(peerId, { ...c, slot, robot: c.robot ? cloneConfig(c.robot) : null });
    p.autoPlan = c.autoRoutine === 'custom' ? c.autoPlan : undefined;
    if (JSON.stringify(previous) !== JSON.stringify({ ...c, slot })) { p.ready = false; this.clearAutoStart(); }
    this.refreshDims(peerId);
    // Station or robot/AUTO changes require locking in again.
    if (moved) p.ready = false;
    this.scheduleAutoStart();
    this.broadcastLobby();
  }

  private hostAddPlayer(peerId: string, name: string): void {
    if (!this.isHost || !this.lobby) return;
    if (!this.lobby.players.some((p) => p.peerId === peerId)) {
      this.lobby.players.push({ peerId, name, slot: null, team: 0, host: false });
      this.systemChat(`${name} joined`);
    }
    this.broadcastLobby();
    // Joining while a match is running: drop them straight in as a spectator (ranked matches too).
    const live = this.liveSetup;
    if (live && this.lobby.inMatch && !live.peers.includes(peerId)) {
      live.peers = [...live.peers, peerId];
      this.client.send({ t: 'start', setup: { ...live, robots: live.robots.map(({ autoPlan: _plan, ...r }) => r) } } satisfies HostMsg, peerId);
    }
  }

  private hostRemovePlayer(peerId: string, announce = true): void {
    if (!this.isHost || !this.lobby) return;
    const gone = this.lobby.players.find((p) => p.peerId === peerId);
    if (!gone) return;
    if (announce) this.systemChat(`${gone.name} left`);
    this.lobby.players = this.lobby.players.filter((p) => p.peerId !== peerId);
    this.choices.delete(peerId);
    this.lastChatAt.delete(peerId);
    this.broadcastLobby();
    this.scheduleAutoStart();
  }

  private broadcastLobby(): void {
    if (!this.lobby) return;
    if (this.lobby.ranked?.phase === 'draft') this.lobby.ranked.turnMs = Math.max(0, this.turnDeadline - Date.now());
    for (const viewer of this.lobby.players) {
      if (viewer.peerId === this.client.peerId) continue;
      const alliance = viewer.slot ? slotAlliance(viewer.slot) : null;
      const players = this.lobby.players.map(({ autoPlan, ...p }) => ({ ...p, ...(alliance && p.slot && slotAlliance(p.slot) === alliance ? { autoPlan } : {}) }));
      this.client.send({ t: 'lobby', lobby: { ...this.lobby, players } } satisfies HostMsg, viewer.peerId);
    }
    this.pushMeta();
    this.publishRecovery();
    this.onChange();
  }

  // ─────────────────────────── client side ───────────────────────────

  private onHostMsg(m: HostMsg): void {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'lobby': {
        // A host broadcast must not yank the robot out of my hand mid-drag.
        const dragged = placementDragging() ? this.me?.spot : undefined;
        this.lobby = m.lobby;
        if (dragged && this.me) this.me.spot = dragged;
        this.onChange();
        break;
      }
      case 'resume':
        this.liveSetup = m.setup;
        if (m.setup.peers.includes(this.client.peerId)) this.onRecover(m.setup, 'client');
        break;
      case 'start':
        this.liveSetup = m.setup;
        if (m.setup.peers.includes(this.client.peerId)) this.onStart(m.setup, 'client');
        break;
      case 'to-lobby':
        this.liveSetup = null;
        this.recoveryGame = null;
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

/** Chat text with control characters and markup stripped, capped at MAX_CHAT_LENGTH. */
function cleanChat(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return censorText((typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH));
}
