import { afterEach, describe, expect, it, vi } from 'vitest';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import { multiplayerPage } from '../src/app/multiplayer';
import { SEASONS } from '../src/seasons';
import type { HostMsg, MatchSetup } from '../src/engine/net/protocol';
import { footprint } from '../src/engine/robot/config';
import { footprintPoly, polysOverlap } from '../src/engine/startPose';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe.each(SEASONS)('$name multiplayer bots', season => {
  function room() {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    const lobby = new LobbyController();
    vi.spyOn(lobby, 'isHost', 'get').mockReturnValue(true);
    vi.spyOn(lobby.client, 'send').mockImplementation(() => {});
    lobby.client.peerId = 'host';
    lobby.status = 'lobby';
    lobby.settings = defaultSettings(season);
    lobby.lobby = { room: 'TEST', hostId: 'host', seasonId: season.id, autoHumanPlayer: false, fillBots: true, botDifficulty: 'hard', inMatch: false, players: [
      { peerId: 'host', name: 'Host', host: true, team: 1, slot: 'blue1' },
      { peerId: 'friend', name: 'Friend', host: false, team: 2, slot: 'blue2' },
      { peerId: 'viewer', name: 'Viewer', host: false, team: 0, slot: null },
    ] };
    for (const peer of ['host', 'friend']) {
      (lobby as unknown as { applyChoice(peer: string, choice: unknown): void }).applyChoice(peer, {
        seasonId: season.id, robot: { ...lobby.settings.robot, teamNumber: peer === 'host' ? 1 : 2 }, autoRoutine: season.autoRoutines[0].id, manualAuto: false,
      });
    }
    return lobby;
  }
  it('starts two friends on one alliance against three bots, with one bot teammate', () => {
    const lobby = room();
    let setup!: MatchSetup;
    lobby.onStart = s => { setup = s; };
    lobby.startMatch();
    expect(setup.robots).toHaveLength(6);
    expect(new Set(setup.robots.map(r => r.slot)).size).toBe(6);
    expect(setup.robots.filter(r => !r.bot).map(r => r.peerId)).toEqual(['host', 'friend']);
    expect(setup.robots.filter(r => r.bot && r.alliance === 'blue')).toHaveLength(1);
    expect(setup.robots.filter(r => r.bot && r.alliance === 'red')).toHaveLength(3);
    expect(setup.robots.filter(r => r.bot).every(r => r.peerId === '' && !r.manualAuto)).toBe(true);
    expect(setup.peers).toEqual(['host', 'friend', 'viewer']);
    expect(setup.botDifficulty).toBe('hard');
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const a = footprint(setup.robots[i].config), b = footprint(setup.robots[j].config);
      expect(polysOverlap(footprintPoly(setup.robots[i].start!, a.length, a.width), footprintPoly(setup.robots[j].start!, b.length, b.width))).toBe(false);
    }
  });
  it('allows human-only matches and restricts bot controls to the host', () => {
    const lobby = room();
    lobby.setBots(false);
    let setup!: MatchSetup;
    lobby.onStart = s => { setup = s; };
    lobby.startMatch();
    expect(setup.robots).toHaveLength(2);
    expect(setup.botDifficulty).toBeUndefined();
    lobby.backToLobby();
    vi.spyOn(lobby, 'isHost', 'get').mockReturnValue(false);
    lobby.setBots(true, 'einstein');
    expect(lobby.lobby!.fillBots).toBe(false);
  });
  it.each([true, false])('applies the host AUTO mode (%s) to every human and broadcasts it', manual => {
    const lobby = room();
    const send = vi.mocked(lobby.client.send);
    lobby.setManualAuto(manual);
    expect(send.mock.calls.map(([msg]) => msg as HostMsg).some(msg => msg.t === 'lobby' && msg.lobby.manualAuto === manual)).toBe(true);
    let setup!: MatchSetup;
    lobby.onStart = s => { setup = s; };
    lobby.startMatch();
    expect(setup.robots.filter(r => !r.bot).every(r => r.manualAuto === manual)).toBe(true);
    expect(setup.robots.filter(r => r.bot).every(r => !r.manualAuto)).toBe(true);
    const start = send.mock.calls.map(([msg]) => msg as HostMsg).find(msg => msg.t === 'start');
    expect(start && start.setup.robots.filter(r => !r.bot).every(r => r.manualAuto === manual)).toBe(true);
    lobby.setManualAuto(!manual);
    expect(lobby.lobby!.manualAuto).toBe(manual);
  });
  it('restricts AUTO control to the host before placement and hides the planner in manual mode', () => {
    const lobby = room();
    lobby.setManualAuto(true);
    vi.spyOn(lobby, 'isHost', 'get').mockReturnValue(false);
    lobby.setManualAuto(false);
    expect(lobby.lobby!.manualAuto).toBe(true);
    const ctx = { s: lobby.settings!, season, rerender() {}, goto() {} };
    expect(multiplayerPage(lobby, ctx).body).toContain('data-auto-control="manual" disabled');
    vi.spyOn(lobby, 'isHost', 'get').mockReturnValue(true);
    lobby.lobby!.placing = true;
    lobby.setManualAuto(false);
    expect(lobby.lobby!.manualAuto).toBe(true);
    const page = multiplayerPage(lobby, ctx);
    expect(page.body).toContain('Drivers control their robots during AUTO');
    expect(page.body).not.toContain('AUTO runs without driver control');
    expect(page.body).not.toContain('data-auto=');
    lobby.lobby!.placing = false;
    lobby.setManualAuto(false);
    lobby.lobby!.placing = true;
    expect(multiplayerPage(lobby, ctx).body).toContain('AUTO runs without driver control');
  });
  it('shows bot stations as available for friends to take over', () => {
    const lobby = room();
    const page = multiplayerPage(lobby, { s: lobby.settings!, season, rerender() {}, goto() {} });
    expect(page.body).toContain('Fill with bots');
    expect(page.body).toContain('Take over Red 1');
    expect(page.body).toContain('Host');
    expect(page.body).toContain('Friend');
  });
});
