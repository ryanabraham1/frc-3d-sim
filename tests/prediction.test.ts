import { describe, expect, it } from 'vitest';
import { Predictor } from '../src/engine/net/prediction';
import type { RobotNetState } from '../src/engine/net/protocol';
import type { Robot } from '../src/engine/robot/robot';

/** Minimal stand-in for a Rapier body: pose only. */
function fakeRobot() {
  const pos = { x: 0, y: 0, z: 0 };
  let rot = { x: 0, y: 0, z: 0, w: 1 };
  const body = {
    translation: () => ({ ...pos }),
    rotation: () => ({ ...rot }),
    setTranslation: (p: typeof pos) => Object.assign(pos, p),
    setRotation: (q: typeof rot) => (rot = { ...q }),
    setLinvel: () => {},
    setAngvel: () => {},
  };
  return { robot: { body } as unknown as Robot, pos };
}

const net = (x: number, z: number, seq = 0): RobotNetState => ({
  id: 0, x, y: 0, z, yaw: 0, turretYaw: 0, held: 0, enabled: true, climbPhase: 0, climbLevel: 0, climbSlot: null, climbProgress: 0, cmdSeq: seq,
});

describe('Predictor', () => {
  it('snaps on activation, then blends out the error measured one RTT ago', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(1, 0), 0, true);
    expect(p.active).toBe(true);
    expect(pos.x).toBe(1);

    // RTT = 200 ms (command 1 sent at t=800, acknowledged at t=1000).
    // Predict: move +1 m/s in x for 1 s, recording every 100 ms.
    for (let t = 0; t <= 1000; t += 100) {
      pos.x = 1 + t / 1000;
      p.record(t);
    }
    p.onSent(1, 800);
    // Host agrees with where we were at t=800 (1.8) → no correction.
    p.onSnapshot(net(1.8, 0, 1), 1000, true);
    expect(p.rtt).toBeCloseTo(0.2, 5);
    expect(pos.x).toBeCloseTo(2.0, 5);
  });

  it('recovers quickly from one stalled round trip (host still loading the match)', () => {
    const { robot } = fakeRobot();
    const p = new Predictor(robot);
    // First command acknowledged 4 s late, then the link is 30 ms.
    p.onSent(1, 0);
    p.onSnapshot(net(0, 0, 1), 4000, true);
    expect(p.rtt).toBeLessThanOrEqual(1);
    for (let k = 2; k < 8; k++) {
      p.onSent(k, 4000 + k * 250);
      p.onSnapshot(net(0, 0, k), 4000 + k * 250 + 30, true);
    }
    expect(p.rtt).toBeLessThan(0.05);
  });

  it('corrects 30% of a small error and shifts history so it is not double-counted', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true);
    for (let t = 0; t <= 1000; t += 100) p.record(t);
    // rtt still 0 → compares against the newest sample (x=0); host says 0.5 → move 0.15.
    p.onSnapshot(net(0.5, 0), 1000, true);
    expect(pos.x).toBeCloseTo(0.15, 5);
    // Same host report again: remaining error 0.35 → +0.105.
    p.onSnapshot(net(0.5, 0), 1000, true);
    expect(pos.x).toBeCloseTo(0.255, 5);
  });

  it('snaps on large errors and stops predicting while climbing or disabled', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true);
    p.record(0);
    p.onSnapshot(net(5, 0), 10, true);
    expect(pos.x).toBe(5);
    expect(p.snaps).toBe(2);
    p.onSnapshot({ ...net(5, 0), climbPhase: 2 }, 20, true);
    expect(p.active).toBe(false);
    p.onSnapshot(net(5, 0), 30, false);
    expect(p.active).toBe(false);
  });
});
