import { MAX_BINARY_BACKLOG, MAX_FRAME_BYTES } from './relayProtocol';

export interface DirectSignal {
  session: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
interface Link {
  session: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  timer: ReturnType<typeof setTimeout>;
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
    private readonly changed: (peer: string) => void,
    private readonly iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }],
  ) {
    this.available = typeof RTCPeerConnection !== 'undefined' &&
      import.meta.env.VITE_DIRECT_CONNECTIONS !== 'false' &&
      !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('relayOnly'));
  }

  get peers(): string[] { return [...this.links].filter(([, l]) => l.channel?.readyState === 'open').map(([p]) => p); }
  isOpen(peer: string): boolean { return this.links.get(peer)?.channel?.readyState === 'open'; }

  private make(peer: string, session: string): Link {
    this.drop(peer);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const link: Link = { session, pc, channel: null, advertised: false, candidates: [], timer: setTimeout(() => {
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
      if (this.links.get(peer) === link && ['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.drop(peer);
    };
    pc.ondatachannel = e => {
      if (e.channel.label !== 'frc-game' || link.channel) { e.channel.close(); return; }
      this.attach(peer, link, e.channel);
    };
    return link;
  }

  private attach(peer: string, link: Link, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (this.links.get(peer) !== link) return;
      clearTimeout(link.timer);
      this.changed(peer);
    };
    channel.onclose = channel.onerror = () => { if (this.links.get(peer) === link) this.drop(peer); };
    channel.onmessage = e => {
      if (this.links.get(peer) !== link || channel.readyState !== 'open') return;
      if (e.data instanceof ArrayBuffer && e.data.byteLength <= MAX_FRAME_BYTES) this.receive(peer, e.data);
      else if (typeof e.data === 'string' && e.data.length <= MAX_FRAME_BYTES) this.receive(peer, e.data);
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
      this.attach(peer, link, link.pc.createDataChannel('frc-game', { ordered: true }));
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
    const channel = link?.channel;
    if (!channel || channel.readyState !== 'open') return false;
    if (channel.bufferedAmount > MAX_BINARY_BACKLOG) return data instanceof ArrayBuffer;
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    if (size > (link!.pc.sctp?.maxMessageSize || 65536)) return false;
    try {
      if (typeof data === 'string') channel.send(data); else channel.send(data);
      return true;
    } catch { this.drop(peer); return false; }
  }

  drop(peer: string): void {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    clearTimeout(link.timer);
    link.pc.onconnectionstatechange = null;
    if (link.channel) link.channel.onclose = link.channel.onerror = null;
    link.channel?.close();
    link.pc.close();
    this.changed(peer);
  }

  close(): void {
    this.generation++;
    this.pending.clear();
    for (const peer of [...this.links.keys()]) this.drop(peer);
  }
}
