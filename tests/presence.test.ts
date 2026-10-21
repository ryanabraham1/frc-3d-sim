import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { PresenceDirectory } from '../server/presence';
import type { RelayEvent, RelayRequest } from '../src/engine/net/relayProtocol';

afterEach(() => vi.restoreAllMocks());
function setup() {
  let open = true;
  const directory = new PresenceDirectory((room, token) => open && room === 'ABCD' && token === 'member-secret' ? 'Host' : null);
  function visitor(client: string, name: string) {
    const events: RelayEvent[] = [];
    const ws = { readyState: 1, send: (text: string) => events.push(JSON.parse(text)) } as unknown as WebSocket;
    const send = (request: RelayRequest) => directory.handle(ws, request, 'test-ip');
    const next = <T extends RelayEvent['op']>(op: T) => {
      const index = events.findIndex(e => e.op === op);
      if (index < 0) throw new Error(`Missing ${op}`);
      return events.splice(index, 1)[0] as Extract<RelayEvent, { op: T }>;
    };
    send({ op: 'presence', client, name });
    const initial = next('presence');
    return { ws, events, send, next, id: initial.self!, initial };
  }
  const host = visitor('browser-host-aaaaaaaa', 'Host');
  const guest = visitor('browser-guest-bbbbbbb', 'Guest');
  const invite = () => {
    host.send({ op: 'invite', room: 'ABCD', token: 'member-secret', to: guest.id });
    return guest.next('lobby-invite');
  };
  return { directory, visitor, host, guest, invite, closeRoom: () => { open = false; } };
}

describe('online directory and invitations', () => {
  it('returns display names and public ids, deduplicates tabs, and omits room secrets', () => {
    const { host, visitor } = setup();
    const tab = visitor('browser-host-aaaaaaaa', 'Host renamed');
    expect(tab.initial.count).toBe(2);
    expect(tab.id).toBe(host.id);
    expect(tab.initial.players).toEqual(expect.arrayContaining([{ id: host.id, name: 'Host renamed' }]));
    expect(JSON.stringify(tab.initial)).not.toContain('browser-host-aaaaaaaa');
    expect(JSON.stringify(tab.initial)).not.toContain('member-secret');
    expect(JSON.stringify(tab.initial)).not.toContain('ABCD');
  });
  it('requires live lobby membership and delivers a private invite only to its recipient', () => {
    const { host, guest, visitor, invite } = setup();
    const other = visitor('browser-other-ccccccc', 'Other');
    host.send({ op: 'invite', room: 'ABCD', token: 'wrong', to: guest.id });
    expect(host.next('invite-error').message).toContain('open casual lobby');
    expect(guest.events.some(e => e.op === 'lobby-invite')).toBe(false);
    const event = invite();
    expect(event).toMatchObject({ from: 'Host', room: 'ABCD' });
    expect(event.expires).toBeGreaterThan(Date.now());
    expect(other.events.some(e => e.op === 'lobby-invite')).toBe(false);
    expect(host.next('invite-sent').to).toBe(guest.id);
  });
  it('allows only the intended recipient to accept, then consumes the invite', () => {
    const { host, guest, invite } = setup();
    const event = invite();
    host.send({ op: 'invite-answer', id: event.id, accept: true });
    expect(host.next('invite-error').message).toContain('no longer available');
    guest.send({ op: 'invite-answer', id: event.id, accept: true });
    expect(guest.next('invite-accepted').room).toBe('ABCD');
    expect(host.next('invite-result')).toMatchObject({ to: guest.id, accepted: true });
    guest.send({ op: 'invite-answer', id: event.id, accept: true });
    expect(guest.next('invite-error').message).toContain('no longer available');
  });
  it('declines across all recipient tabs without joining', () => {
    const { host, guest, invite, visitor } = setup();
    const tab = visitor('browser-guest-bbbbbbb', 'Guest');
    const event = invite();
    expect(tab.next('lobby-invite').id).toBe(event.id);
    tab.send({ op: 'invite-answer', id: event.id, accept: false });
    expect(guest.next('invite-dismissed').id).toBe(event.id);
    expect(tab.next('invite-dismissed').id).toBe(event.id);
    expect(tab.events.some(e => e.op === 'invite-accepted')).toBe(false);
    expect(host.next('invite-result')).toMatchObject({ to: guest.id, accepted: false });
  });
  it('rejects expired invitations and lobbies that have closed or started', () => {
    const { guest, invite, closeRoom } = setup();
    const event = invite();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    guest.send({ op: 'invite-answer', id: event.id, accept: true });
    expect(guest.next('invite-error').message).toContain('expired');
    clock.mockRestore();
    const again = invite();
    closeRoom();
    guest.send({ op: 'invite-answer', id: again.id, accept: true });
    expect(guest.next('invite-error').message).toContain('no longer open');
  });
  it('removes silent visitors after the heartbeat grace period and expires notification popups', () => {
    const { directory, guest, host, invite } = setup();
    const event = invite();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 151_000);
    guest.send({ op: 'presence', client: 'browser-guest-bbbbbbb', name: 'Guest' });
    guest.events.length = 0;
    directory.sweep();
    expect(guest.next('presence').players).toEqual([{ id: guest.id, name: 'Guest' }]);
    expect(guest.next('invite-dismissed').id).toBe(event.id);
    directory.remove(host.ws);
    clock.mockRestore();
  });
  it('limits invitation spam, including repeated invalid requests', () => {
    const { host, guest } = setup();
    for (let i = 0; i < 11; i++) host.send({ op: 'invite', to: guest.id, room: 'ABCD', token: 'wrong' });
    expect(host.events).toContainEqual({ op: 'invite-error', message: 'Too many invites. Try again in a minute.' });
  });
});
