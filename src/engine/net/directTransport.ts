import { MAX_BINARY_BACKLOG, MAX_FRAME_BYTES } from './relayProtocol';

export interface DirectSignal {
  session: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
/** Reliable, ordered: commands and anything that must arrive. */
const GAME_CHANNEL = 'frc-game';
/**
 * Unreliable, unordered: host snapshots (and a duplicate of each driver command, see `sendUnreliable`). Each snapshot supersedes the last, so a lost packet must not hold
 * back the ones behind it until it is retransmitted (head-of-line blocking showed up as stalls followed by
 * bursts on lossy Wi-Fi). Clients recover lost deltas with a keyframe.
 */
const SNAPSHOT_CHANNEL = 'frc-snap';
/** Free public STUN; TURN comes from the relay's /ice endpoint when it has a key (see `setIceServers`). */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
/** Wi-Fi roaming and brief outages show as 'disconnected' and usually recover: wait this long before giving up (ms). */
const DISCONNECT_GRACE_MS = 5000;

interface Link {
  session: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  snapshots: RTCDataChannel | null;
  timer: ReturnType<typeof setTimeout>;
  grace: ReturnType<typeof setTimeout> | null;
  advertised: boolean;
  candidates: RTCIceCandidateInit[];
}

/** Host-to-client data channels; the room relay remains available throughout negotiation/failure. */
export class DirectTransport {
  private links = new Map<string, Link>();
  private pending = new Map<string, Promise<void>>();
  private generation = 0;
  readonly available: boolean;

  constructor(
    private readonly signal: (peer: string, signal: DirectSignal) => void,
    private readonly receive: (peer: string, data: string | ArrayBuffer) => void,
    /** `wasOpen`: the link had been carrying traffic (false for an attempt that never connected). */
    private readonly changed: (peer: string, wasOpen: boolean) => void,
    private iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {
    this.available = typeof RTCPeerConnection !== 'undefined' &&
      import.meta.env.VITE_DIRECT_CONNECTIONS !== 'false' &&
      !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('relayOnly'));
  }

  get peers(): string[] { return [...this.links].filter(([, l]) => l.channel?.readyState === 'open').map(([p]) => p); }
  isOpen(peer: string): boolean { return this.links.get(peer)?.channel?.readyState === 'open'; }
  /** A link to `peer` exists (open or still negotiating). */
  has(peer: string): boolean { return this.links.has(peer); }
  /** Used by links negotiated from now on. */
  setIceServers(servers: RTCIceServer[]): void { this.iceServers = servers; }

  private make(peer: string, session: string): Link {
    this.drop(peer);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const link: Link = { session, pc, channel: null, snapshots: null, grace: null, advertised: false, candidates: [], timer: setTimeout(() => {
      if (import.meta.env.DEV) console.debug('Direct connection timed out; using relay', pc.connectionState, pc.iceConnectionState);
      this.drop(peer);
    }, 15000) };
    this.links.set(peer, link);
    pc.onicecandidate = e => {
      if (!e.candidate || this.links.get(peer) !== link) return;
      const candidate = e.candidate.toJSON();
      if (link.advertised) this.signal(peer, { session, candidate });
      else link.candidates.push(candidate);
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(peer) !== link) return;
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') this.drop(peer);
      else if (state === 'disconnected') link.grace ??= setTimeout(() => { if (this.links.get(peer) === link) this.drop(peer); }, DISCONNECT_GRACE_MS);
      else if (link.grace) { clearTimeout(link.grace); link.grace = null; }
    };
    pc.ondatachannel = e => {
      if (e.channel.label === SNAPSHOT_CHANNEL && !link.snapshots) this.attachSnapshots(peer, link, e.channel);
      else if (e.channel.label === GAME_CHANNEL && !link.channel) this.attach(peer, link, e.channel);
      else e.channel.close();
    };
    return link;
  }

  private attach(peer: string, link: Link, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (this.links.get(peer) !== link) return;
      clearTimeout(link.timer);
      this.changed(peer, true);
    };
    channel.onclose = channel.onerror = () => { if (this.links.get(peer) === link) this.drop(peer); };
    channel.onmessage = e => {
      if (this.links.get(peer) !== link || channel.readyState !== 'open') return;
      if (e.data instanceof ArrayBuffer && e.data.byteLength <= MAX_FRAME_BYTES) this.receive(peer, e.data);
      else if (typeof e.data === 'string' && e.data.length <= MAX_FRAME_BYTES) this.receive(peer, e.data);
    };
  }

  /** The snapshot channel is an optimisation: losing it falls back to the game channel, not to the relay. */
  private attachSnapshots(peer: string, link: Link, channel: RTCDataChannel): void {
    link.snapshots = channel;
    channel.binaryType = 'arraybuffer';
    channel.onclose = channel.onerror = () => { if (link.snapshots === channel) link.snapshots = null; };
    channel.onmessage = e => {
      if (this.links.get(peer) !== link || link.snapshots !== channel) return;
      if (e.data instanceof ArrayBuffer ? e.data.byteLength <= MAX_FRAME_BYTES : typeof e.data === 'string' && e.data.length <= MAX_FRAME_BYTES) this.receive(peer, e.data);
    };
  }

  private advertise(peer: string, link: Link): void {
    if (this.links.get(peer) !== link || !link.pc.localDescription) return;
    this.signal(peer, { session: link.session, description: link.pc.localDescription.toJSON() });
    link.advertised = true;
    for (const candidate of link.candidates.splice(0)) this.signal(peer, { session: link.session, candidate });
  }

  async offer(peer: string): Promise<void> {
    if (!this.available) return;
    try {
      const link = this.make(peer, crypto.randomUUID());
      this.attach(peer, link, link.pc.createDataChannel(GAME_CHANNEL, { ordered: true }));
      this.attachSnapshots(peer, link, link.pc.createDataChannel(SNAPSHOT_CHANNEL, { ordered: false, maxRetransmits: 0 }));
      await link.pc.setLocalDescription(await link.pc.createOffer());
      this.advertise(peer, link);
    } catch (error) {
      if (import.meta.env.DEV) console.debug('Direct connection unavailable; using relay', error);
      this.drop(peer);
    }
  }

  /** Serialize SDP and trickled candidates so ICE cannot race setRemoteDescription. */
  handleSignal(peer: string, data: unknown, acceptOffer: boolean): void {
    if (!this.available || !data || typeof data !== 'object') return;
    const signal = data as DirectSignal;
    if (typeof signal.session !== 'string' || signal.session.length > 64) return;
    const generation = this.generation;
    const task = (this.pending.get(peer) ?? Promise.resolve()).then(async () => {
      if (generation !== this.generation) return;
      let link = this.links.get(peer);
      if (signal.description?.type === 'offer') {
        if (!acceptOffer) return;
        link = this.make(peer, signal.session);
        await link.pc.setRemoteDescription(signal.description);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        this.advertise(peer, link);
      } else if (link?.session === signal.session) {
        if (signal.description?.type === 'answer') await link.pc.setRemoteDescription(signal.description);
        else if (signal.candidate) await link.pc.addIceCandidate(signal.candidate);
      }
    }).catch(error => {
      if (import.meta.env.DEV) console.debug('Direct negotiation failed; using relay', error);
      this.drop(peer);
    }).finally(() => { if (this.pending.get(peer) === task) this.pending.delete(peer); });
    this.pending.set(peer, task);
  }

  /** False means the caller should use the relay. Snapshots skip congested direct peers. */
  send(peer: string, data: string | ArrayBuffer): boolean {
    const link = this.links.get(peer);
    if (!link?.channel || link.channel.readyState !== 'open') return false;
    const snapshots = data instanceof ArrayBuffer && link.snapshots?.readyState === 'open' ? link.snapshots : null;
    const channel = snapshots ?? link.channel;
    if (channel.bufferedAmount > MAX_BINARY_BACKLOG) return data instanceof ArrayBuffer;
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    if (size > (link.pc.sctp?.maxMessageSize || 65536)) return false;
    try {
      if (typeof data === 'string') channel.send(data); else channel.send(data);
      return true;
    } catch {
      if (channel === snapshots) link.snapshots = null; // this frame goes by relay, later ones by the game channel
      else this.drop(peer);
      return false;
    }
  }

  /**
   * Superseding text (driver commands) on the unreliable channel: a lost packet is replaced by the next one instead of
   * holding every later command back until SCTP retransmits it (hundreds of ms on lossy Wi-Fi). False = not sent.
   */
  sendUnreliable(peer: string, data: string): boolean {
    const link = this.links.get(peer);
    const channel = link?.channel?.readyState === 'open' && link.snapshots?.readyState === 'open' ? link.snapshots : null;
    if (!channel || channel.bufferedAmount > MAX_BINARY_BACKLOG) return false;
    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  drop(peer: string): void {
    const link = this.links.get(peer);
    if (!link) return;
    const wasOpen = link.channel?.readyState === 'open';
    this.links.delete(peer);
    clearTimeout(link.timer);
    if (link.grace) clearTimeout(link.grace);
    link.pc.onconnectionstatechange = null;
    for (const channel of [link.channel, link.snapshots]) {
      if (!channel) continue;
      channel.onclose = channel.onerror = null;
      channel.close();
    }
    link.pc.close();
    this.changed(peer, wasOpen);
  }

  close(): void {
    this.generation++;
    this.pending.clear();
    for (const peer of [...this.links.keys()]) this.drop(peer);
  }
}
