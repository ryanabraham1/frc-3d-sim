import { describe, expect, it } from 'vitest';
import { MatchClock } from '../src/engine/match/clock';
import { Scoreboard } from '../src/engine/match/scoreboard';
import { decodeSnapshot, encodeSnapshot, packCommand, slotAlliance, slotId, slotStation, unpackCommand, type Snapshot } from '../src/engine/net/protocol';
import { cleanName, normalizeRoomCode } from '../src/engine/net/relayProtocol';
import { TIMELINE } from '../src/seasons/2026-rebuilt/config';

describe('protocol', () => {
  it('packs and unpacks robot commands', () => {
    const cmd = { vx: 1.23456, vy: -2, omega: 0.5, intake: true, shoot: false, pass: true, climb: 3, descend: false };
    const back = unpackCommand(JSON.parse(JSON.stringify(packCommand(cmd))));
    expect(back).toEqual({ ...cmd, vx: 1.235 });
    expect(unpackCommand(packCommand({ ...cmd, climb: null, descend: true }))).toMatchObject({ climb: null, descend: true });
    expect(unpackCommand([1, 2, 3])).toBeNull();
    expect(unpackCommand([1, 2, 3, 0, 'x'])).toBeNull();
    expect(unpackCommand([NaN, 0, 0, 0, -1])).toBeNull();
  });

  it('round-trips snapshots', () => {
    const snap: Snapshot = {
      seq: 4000000123,
      time: 12.3456789,
      robots: [
        { id: 0, x: 1.5, y: 0.002, z: -4, yaw: 3.1, rot: [0.5, 0.5, -0.5, 0.5], tipped: 3.2, turretYaw: -1, held: 7, enabled: true, climbPhase: 3, climbLevel: 2, climbSlot: 1, climbProgress: 1, cmdSeq: 99, act: 16 | 2 | 8 },
        { id: 5, x: 15, y: 0.5, z: -7.5, yaw: -0.2, turretYaw: 0.4, held: 0, enabled: false, climbPhase: 0, climbLevel: 0, climbSlot: null, climbProgress: 0, cmdSeq: 0 },
      ],
      pieceIdx: [0, 503],
      piecePos: [1.2345, 0.075, -3.0004, 16.5, 2.2, -8.05],
      meta: { st: 'running', cd: 0, clock: { i: 2, ep: 1.5, e: 24.5, s: true, f: false }, pieces: [[3, 1, 0, null], [4, 2, -1, 'chute-red']], key: true },
    };
    const back = decodeSnapshot(encodeSnapshot(snap))!;
    expect(back.seq).toBe(snap.seq);
    expect(back.time).toBe(snap.time);
    expect(back.meta).toEqual(snap.meta);
    expect(back.pieceIdx).toEqual([0, 503]);
    back.piecePos.forEach((v, i) => expect(Math.abs(v - snap.piecePos[i])).toBeLessThanOrEqual(0.0005 + 1e-9));
    expect(back.robots[1].climbSlot).toBeNull();
    expect(back.robots[0]).toMatchObject({ id: 0, held: 7, enabled: true, climbPhase: 3, climbLevel: 2, climbSlot: 1, cmdSeq: 99 });
    expect(back.robots[0].x).toBeCloseTo(1.5, 5);
    expect(back.robots[0].climbProgress).toBe(1);
    expect(back.robots[0].act).toBe(16 | 2 | 8);
    back.robots[0].rot!.forEach((v, i) => expect(v).toBeCloseTo([0.5, 0.5, -0.5, 0.5][i], 6));
    expect(back.robots[0].tipped).toBeCloseTo(3.2, 5);
    // Robots sent without a full orientation arrive level at their yaw.
    expect(back.robots[1].rot![1]).toBeCloseTo(Math.sin(-0.1), 6);
    expect(back.robots[1].tipped).toBe(0);
    expect(decodeSnapshot(new ArrayBuffer(4))).toBeNull();
  });

  it('slot helpers', () => {
    expect(slotAlliance('red2')).toBe('red');
    expect(slotStation('blue3')).toBe(3);
    expect(slotId('blue', 1)).toBe('blue1');
  });

  it('room code + name sanitising', () => {
    expect(normalizeRoomCode(' ab-cd9e ')).toBe('ABCD');
    expect(cleanName('<script>')).toBe('script');
    expect(cleanName('')).toBe('Player');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
  });
});

describe('state snapshots', () => {
  it('clock restore reproduces display state', () => {
    const a = new MatchClock(TIMELINE);
    a.start();
    a.advance(47.25);
    const b = new MatchClock(TIMELINE);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.current.id).toBe(a.current.id);
    expect(b.displayTime).toBeCloseTo(a.displayTime);
    expect(b.mode).toBe(a.mode);
  });

  it('scoreboard restore reproduces totals and fouls', () => {
    const a = new Scoreboard();
    a.add('red', 'fuel', 12);
    a.inc('blue', 'autoFuel', 3);
    a.foul({ t: 1, alliance: 'blue', kind: 'major', rule: 'G407', robotId: 2 });
    const b = new Scoreboard();
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.total('red')).toBe(27);
    expect(b.counter('blue', 'autoFuel')).toBe(3);
    expect(b.foulCount('blue', 'major')).toBe(1);
    // restore replaces, not merges
    b.restore(new Scoreboard().snapshot());
    expect(b.total('red')).toBe(0);
  });
});
