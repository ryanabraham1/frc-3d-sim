import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { cleanName, type OnlinePlayer, type RelayEvent, type RelayRequest } from '../src/engine/net/relayProtocol.ts';

interface Visitor { client: string; id: string; name: string; seen: number }
interface Invite { id: string; from: string; to: string; toId: string; name: string; room: string; token: string; expires: number }
const OPEN = 1;

/** Site presence is independent of room sockets, so solo play and duplicate tabs work correctly. */
export class PresenceDirectory {
  private visitors = new Map<WebSocket, Visitor>();
  private invites = new Map<string, Invite>();
  private attempts = new Map<string, number[]>();
  constructor(private memberName: (room: string, token: string) => string | null) {}

  private send(ws: WebSocket, event: RelayEvent): void {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(event));
  }
  private toClient(client: string, event: RelayEvent): void {
    for (const [ws, v] of this.visitors) if (v.client === client) this.send(ws, event);
  }
  private players(): OnlinePlayer[] {
    return [...new Map([...this.visitors.values()].map(v => [v.client, { id: v.id, name: v.name }])).values()];
  }
  private reply(ws: WebSocket): void {
    const players = this.players();
    this.send(ws, { op: 'presence', count: players.length, players, self: this.visitors.get(ws)?.id });
  }
  private broadcast(): void { for (const ws of this.visitors.keys()) this.reply(ws); }

  handle(ws: WebSocket, req: RelayRequest, ip: string): boolean {
    if (req.op === 'presence') {
      if (typeof req.client !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(req.client)) return true;
      const before = JSON.stringify(this.players());
      const other = [...this.visitors.values()].find(v => v.client === req.client);
      const name = cleanName(req.name ?? other?.name ?? 'Player');
      for (const v of this.visitors.values()) if (v.client === req.client) v.name = name;
      this.visitors.set(ws, { client: req.client, id: other?.id ?? randomUUID(), name, seen: Date.now() });
      if (before !== JSON.stringify(this.players())) this.broadcast();
      else this.reply(ws);
      return true;
    }
    if (req.op !== 'invite' && req.op !== 'invite-answer') return false;
    const sender = this.visitors.get(ws);
    const error = (message: string) => this.send(ws, { op: 'invite-error', message });
    if (!sender) { error('Reconnect to the online list first.'); return true; }
    if (req.op === 'invite') {
      const now = Date.now();
      const recent = (this.attempts.get(ip) ?? []).filter(t => now - t < 60_000);
      if (recent.length >= 10) { error('Too many invites. Try again in a minute.'); return true; }
      recent.push(now);
      this.attempts.set(ip, recent);
      const name = this.memberName(req.room, req.token);
      if (!name) { error('Join an open casual lobby before inviting someone.'); return true; }
      const target = [...this.visitors.values()].find(v => v.id === req.to);
      if (!target || target.client === sender.client) { error('That player is no longer available.'); return true; }
      this.sweepInvites(now);
      if ([...this.invites.values()].some(i => i.from === sender.client && i.to === target.client)) {
        error('You already have a pending invite to this player.'); return true;
      }
      const invite: Invite = { id: randomUUID(), from: sender.client, to: target.client, toId: target.id, name, room: req.room, token: req.token, expires: now + 60_000 };
      this.invites.set(invite.id, invite);
      this.toClient(target.client, { op: 'lobby-invite', id: invite.id, from: name, room: invite.room, expires: invite.expires });
      this.send(ws, { op: 'invite-sent', to: target.id });
    } else {
      const invite = this.invites.get(req.id);
      if (!invite || invite.to !== sender.client) { error('This invite is no longer available.'); return true; }
      this.invites.delete(invite.id);
      this.toClient(sender.client, { op: 'invite-dismissed', id: invite.id });
      if (req.accept !== true) {
        this.toClient(invite.from, { op: 'invite-result', to: invite.toId, accepted: false });
        return true;
      }
      if (invite.expires <= Date.now() || !this.memberName(invite.room, invite.token)) {
        error('This invite expired or the lobby is no longer open.'); return true;
      }
      this.toClient(invite.from, { op: 'invite-result', to: invite.toId, accepted: true });
      this.send(ws, { op: 'invite-accepted', room: invite.room });
    }
    return true;
  }
  remove(ws: WebSocket): void {
    const before = this.players().length;
    this.visitors.delete(ws);
    if (before !== this.players().length) this.broadcast();
  }
  private sweepInvites(now: number): void {
    for (const [id, invite] of this.invites) if (invite.expires <= now) {
      this.invites.delete(id);
      this.toClient(invite.to, { op: 'invite-dismissed', id });
    }
  }
  sweep(): void {
    const now = Date.now();
    const before = this.players().length;
    for (const [ws, v] of this.visitors) if (ws.readyState !== OPEN || now - v.seen > 150_000) this.visitors.delete(ws);
    if (before !== this.players().length) this.broadcast();
    this.sweepInvites(now);
    for (const [ip, times] of this.attempts) if (!times.some(t => now - t < 60_000)) this.attempts.delete(ip);
  }
}
