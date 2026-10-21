import { cleanName, type OnlinePlayer, type RelayEvent, type RelayRequest } from '@engine/net/relayProtocol';
import { nameProblem } from '@engine/net/nameFilter';
import type { LobbyController } from './lobby';

interface PresenceOptions {
  lobby: LobbyController;
  isPlaying(): boolean;
  showLobby(): void;
  join(room: string, name: string): Promise<void>;
}
type Invite = Extract<RelayEvent, { op: 'lobby-invite' }>;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let count: number | null = null;
let unavailable = false;
let instance: SitePresence | null = null;

export function presenceMarkup(): string {
  const label = count === null ? (unavailable ? 'Online unavailable' : 'Connecting…') : `${count} ${count === 1 ? 'player' : 'players'} online`;
  return `<button class="online-count ${count === null ? '' : 'is-live'}" data-online-count data-presence="toggle" aria-haspopup="dialog" aria-expanded="${instance?.isOpen ?? false}" title="See players online and invite them to a lobby"><i aria-hidden="true"></i><span>${label}</span></button>`;
}

export function startPresence(options: PresenceOptions): void {
  if (!instance) instance = new SitePresence(options);
}

class SitePresence {
  isOpen = false;
  private client = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() as string : `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private socket: WebSocket | null = null;
  private players: OnlinePlayer[] = [];
  private self = '';
  private invites = new Map<string, Invite>();
  private sent = new Map<string, number>();
  private busy = false;
  private notice = '';
  private lastReply = 0;
  private lastSent = 0;
  private retry = 1000;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private root = document.createElement('div');
  private name = '';

  constructor(private options: PresenceOptions) {
    try {
      const stored = localStorage.getItem('frc-sim-presence-id');
      if (stored && /^[a-zA-Z0-9_-]{16,80}$/.test(stored)) this.client = stored;
      else localStorage.setItem('frc-sim-presence-id', this.client);
      this.name = localStorage.getItem('frc-sim-name') ?? '';
    } catch { /* Storage disabled: presence still works for this tab. */ }
    this.name = cleanName(this.name || `Player ${this.client.slice(0, 4)}`);
    this.root.className = 'presence-layer';
    this.root.innerHTML = `<section class="online-panel" role="dialog" aria-label="Players online" hidden>
      <header><h2>Players online</h2><button class="online-close" data-presence="close" aria-label="Close players online">×</button></header>
      <form data-presence-name><label>Your display name<input aria-label="Online display name" maxlength="24" autocomplete="nickname"/></label><button class="bbtn" type="submit">Save</button></form>
      <p class="online-help">Invite someone to your lobby, or create a lobby with your first invite.</p>
      <p class="online-notice" role="status"></p><div class="online-players"></div></section>
      <div class="invite-toasts" aria-label="Lobby invitations" aria-live="polite"></div>`;
    document.body.append(this.root);
    this.root.querySelector('form')!.onsubmit = e => {
      e.preventDefault();
      const value = this.root.querySelector('input')!.value.trim();
      const problem = nameProblem(value);
      if (problem) { this.notice = problem; return this.render(); }
      this.name = cleanName(value);
      try { localStorage.setItem('frc-sim-name', this.name); } catch { /* Optional. */ }
      this.notice = 'Display name saved.';
      this.announce();
      this.render();
    };
    document.addEventListener('click', e => {
      const button = (e.target as Element).closest<HTMLElement>('[data-presence]');
      if (!button) return;
      const action = button.dataset.presence;
      if (action === 'toggle' || action === 'close') {
        this.isOpen = action === 'toggle' ? !this.isOpen : false;
        if (this.isOpen) this.root.querySelector('input')!.value = this.displayName();
        this.render();
        if (action === 'close') document.querySelector<HTMLElement>('[data-online-count]')?.focus();
      } else if (action === 'invite') void this.invite(button.dataset.id!);
      else if (action === 'accept' || action === 'decline') {
        if (action === 'accept' && this.options.lobby.lobby?.ranked) {
          this.notice = 'Finish or leave Ranked before accepting an invite.';
          this.isOpen = true;
          return this.render();
        }
        if (this.send({ op: 'invite-answer', id: button.dataset.id!, accept: action === 'accept' })) {
          this.invites.delete(button.dataset.id!);
          this.render();
        }
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) {
        this.isOpen = false;
        this.render();
        document.querySelector<HTMLElement>('[data-online-count]')?.focus();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (this.socket?.readyState === WebSocket.OPEN) this.announce();
        else if (!this.socket) { clearTimeout(this.timer); this.connect(); }
      }
    });
    window.addEventListener('storage', e => {
      if (e.key === 'frc-sim-name' && e.newValue) { this.name = cleanName(e.newValue); this.announce(); }
    });
    window.addEventListener('pagehide', () => {
      this.paused = true;
      clearTimeout(this.timer);
      clearTimeout(this.deadline);
      this.socket?.close();
    });
    setInterval(() => this.tick(), 1000);
    this.connect();
  }

  private displayName(): string { return this.options.lobby.me?.name || this.options.lobby.playerName || this.name; }
  private setCount(next: number | null, failed = false): void {
    count = next;
    unavailable = failed;
    this.render();
  }
  private send(request: RelayRequest): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.notice = 'Connection unavailable. Reconnecting…';
      this.isOpen = true;
      this.render();
      return false;
    }
    this.socket.send(JSON.stringify(request));
    return true;
  }
  private announce(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.lastSent = Date.now();
    this.send({ op: 'presence', client: this.client, name: this.displayName() });
  }
  private connect(): void {
    if (this.paused) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.options.lobby.relayUrl); }
    catch { this.setCount(null, true); return; }
    this.socket = ws;
    this.lastReply = 0;
    // An old relay may open the socket but never understand presence. Bound the initial wait.
    this.deadline = setTimeout(() => {
      if (this.socket === ws && !this.lastReply) { this.setCount(null, true); ws.close(); }
    }, 10_000);
    ws.onopen = () => this.announce();
    ws.onmessage = e => {
      let msg: RelayEvent;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (this.socket !== ws) return;
      if (msg.op === 'presence' && Number.isSafeInteger(msg.count) && msg.count >= 0) {
        clearTimeout(this.deadline);
        this.lastReply = Date.now();
        this.retry = 1000;
        this.players = Array.isArray(msg.players) ? msg.players : [];
        this.self = msg.self ?? '';
        this.setCount(msg.count);
      } else if (msg.op === 'lobby-invite') {
        this.invites.set(msg.id, msg);
        this.render();
      } else if (msg.op === 'invite-dismissed') {
        this.invites.delete(msg.id);
        this.render();
      } else if (msg.op === 'invite-error') {
        this.notice = msg.message;
        this.isOpen = true;
        this.render();
      } else if (msg.op === 'invite-sent') {
        this.sent.set(msg.to, Date.now() + 60_000);
        this.notice = 'Invite sent. Waiting for them to accept.';
        this.render();
      } else if (msg.op === 'invite-result') {
        this.sent.delete(msg.to);
        this.notice = msg.accepted ? 'Your invite was accepted.' : 'Your invite was declined.';
        this.render();
      } else if (msg.op === 'invite-accepted') void this.join(msg.room);
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.socket !== ws) return;
      clearTimeout(this.deadline);
      this.socket = null;
      this.players = [];
      this.invites.clear();
      this.setCount(null, true);
      if (!this.paused) {
        this.timer = setTimeout(() => this.connect(), this.retry + Math.random() * 500);
        this.retry = Math.min(this.retry * 2, 30_000);
      }
    };
  }
  private tick(): void {
    const now = Date.now();
    if (this.lastReply && now - this.lastReply > 90_000 && count !== null) {
      this.setCount(null, true);
      this.socket?.close();
    }
    if (now - this.lastSent >= 25_000) this.announce();
    let changed = false;
    for (const [id, invite] of this.invites) if (invite.expires <= now) { this.invites.delete(id); changed = true; }
    for (const [id, expires] of this.sent) if (expires <= now) { this.sent.delete(id); changed = true; }
    if (changed) this.render();
  }
  private async invite(to: string): Promise<void> {
    if (this.busy) return;
    const lobby = this.options.lobby;
    this.busy = true;
    this.notice = '';
    this.render();
    try {
      if (!lobby.client.room) {
        if (this.options.isPlaying() || lobby.ranked.searching) throw new Error('Return to the menu before creating a lobby.');
        await lobby.create(this.displayName(), 'private');
        if (!lobby.client.room) throw new Error(lobby.error || 'Could not create a lobby.');
        this.options.showLobby();
      }
      if (lobby.lobby?.ranked || lobby.lobby?.inMatch || lobby.lobby?.placing) throw new Error('Invites are available in open casual lobbies.');
      const proof = lobby.client.inviteProof;
      if (!proof) throw new Error('Reconnect to your lobby before inviting someone.');
      this.send({ op: 'invite', to, ...proof });
    } catch (e) { this.notice = (e as Error).message; }
    finally { this.busy = false; this.render(); }
  }
  private async join(room: string): Promise<void> {
    if (this.options.lobby.client.room === room) {
      this.notice = 'You are already in this lobby.';
      this.isOpen = false;
      this.render();
      return;
    }
    this.notice = 'Joining lobby…';
    this.render();
    try {
      await this.options.join(room, this.displayName());
      if (!this.options.lobby.client.connected) throw new Error(this.options.lobby.error || 'Could not join the lobby.');
      this.notice = '';
      this.isOpen = false;
    } catch (e) { this.notice = (e as Error).message; this.isOpen = true; }
    this.render();
  }
  private render(): void {
    document.querySelectorAll('[data-online-count]').forEach(el => {
      // Update the existing button to preserve focus and accessible expanded state.
      el.classList.toggle('is-live', count !== null);
      el.setAttribute('aria-expanded', String(this.isOpen));
      el.querySelector('span')!.textContent = count === null ? (unavailable ? 'Online unavailable' : 'Connecting…') : `${count} ${count === 1 ? 'player' : 'players'} online`;
    });
    this.root.querySelector<HTMLElement>('.online-panel')!.hidden = !this.isOpen;
    this.root.querySelector('.online-notice')!.textContent = this.notice;
    const input = this.root.querySelector('input')!;
    input.disabled = !!this.options.lobby.client.room;
    const noInvite = this.busy || this.options.lobby.status === 'connecting' || this.options.lobby.ranked.searching || !!this.options.lobby.lobby?.ranked || !!this.options.lobby.lobby?.inMatch || !!this.options.lobby.lobby?.placing || (this.options.isPlaying() && !this.options.lobby.client.room);
    const playerHtml = count === null
      ? `<p class="online-help">${unavailable ? 'The online list is unavailable. Retrying automatically…' : 'Connecting to the online list…'}</p>`
      : this.players.map(p => `<div class="online-person"><span><i aria-hidden="true"></i><b>${esc(p.name)}</b>${p.id === this.self ? '<small>You</small>' : ''}</span>${p.id === this.self ? '' : `<button class="bbtn" data-presence="invite" data-id="${esc(p.id)}" ${noInvite || this.sent.has(p.id) ? 'disabled' : ''}>${this.sent.has(p.id) ? 'Invited' : this.options.lobby.client.room ? 'Invite' : 'Create & invite'}</button>`}</div>`).join('') || '<p class="online-help">No players to show yet.</p>';
    const playerList = this.root.querySelector('.online-players')!;
    if (playerList.innerHTML !== playerHtml) playerList.innerHTML = playerHtml;
    const ranked = !!this.options.lobby.lobby?.ranked;
    const toastHtml = [...this.invites.values()].map(i => `<section class="invite-toast" role="group" aria-label="Lobby invite from ${esc(i.from)}"><div class="invite-toast-heading">Lobby invite</div><b>${esc(i.from)}</b><p>Invited you to join lobby <strong>${esc(i.room)}</strong>.</p>${ranked ? '<p>Leave Ranked to accept this invite.</p>' : ''}<div><button class="bbtn primary" data-presence="accept" data-id="${esc(i.id)}" ${ranked ? 'disabled' : ''}>${this.options.isPlaying() ? 'Accept & leave current game' : this.options.lobby.client.room ? 'Accept & leave current lobby' : 'Accept'}</button><button class="bbtn" data-presence="decline" data-id="${esc(i.id)}">Decline</button></div><small>Expires in one minute.</small></section>`).join('');
    const toasts = this.root.querySelector('.invite-toasts')!;
    if (toasts.innerHTML !== toastHtml) toasts.innerHTML = toastHtml;
  }
}
