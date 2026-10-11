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
  return { robot: { body, resetDriveState() {}, shiftPreviousPose() {} } as unknown as Robot, pos };
}

const net = (x: number, z: number, seq = 0): RobotNetState => ({
  id: 0, x, y: 0, z, yaw: 0, turretYaw: 0, held: 0, enabled: true, climbPhase: 0, climbLevel: 0, climbSlot: null, climbProgress: 0, cmdSeq: seq,
});

describe('Predictor', () => {
  it('reconciles only the newest pose when a connection releases a burst of queued snapshots', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true);
    pos.x = 2;
    p.record(1000);
    // Old frames would snap the driver backwards even though the newest frame agrees with prediction.
    for (let i = 0; i < 20; i++) p.queueSnapshot(net(i / 10, 0), 1000, true);
    p.queueSnapshot(net(2, 0), 1000, true);
    p.flush();
    expect(pos.x).toBe(2);
    expect(p.snaps).toBe(1);
    expect(p.corrections).toBe(0);
    p.flush();
    expect(p.corrections).toBe(0);
    p.queueSnapshot({ ...net(2, 0), enabled: false }, 1100, true);
    p.flush();
    expect(p.active).toBe(false);
  });
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

  it('corrects a position error progressively and shifts history so it is not double-counted', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true);
    for (let t = 0; t <= 1000; t += 100) p.record(t);
    // RTT is zero: the host is 0.5 m ahead of the newest predicted sample.
    p.onSnapshot(net(0.5, 0), 1000, true);
    expect(pos.x).toBeCloseTo(0.3, 5);
    // Repeating the report removes part of the remaining error, not the original error again.
    p.onSnapshot(net(0.5, 0), 1000, true);
    expect(pos.x).toBeCloseTo(0.41, 5);
  });

  it('uses simulation timestamps instead of packet arrival time after a network delay', () => {
    const { robot, pos } = fakeRobot();
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true, 4);
    for (let t = 0; t <= 2000; t += 100) { pos.x = t / 1000; p.record(t); }
    p.onSent(1, 1000);
    p.onSnapshot(net(1, 0, 1), 1200, true, 5);
    // The next host pose is accurate at local t=1300, but the packet arrives 300 ms late.
    p.onSnapshot(net(1.3, 0, 1), 1800, true, 5.3);
    expect(pos.x).toBeCloseTo(2, 5);
    expect(p.corrections).toBe(0);
    expect(p.offX).toBe(0);
  });

  it('does not reset an accurately predicted moving robot because a delayed snapshot has different tilt', () => {
    const { robot, pos } = fakeRobot();
    let resets = 0;
    robot.resetDriveState = () => { resets++; };
    const p = new Predictor(robot);
    p.onSnapshot(net(0, 0), 0, true);
    for (let t = 0; t <= 1000; t += 100) { pos.x = t / 1000; p.record(t); }
    robot.body.setRotation({ x: Math.sin(0.3 / 2), y: 0, z: 0, w: Math.cos(0.3 / 2) }, true);
    p.onSent(1, 800);
    p.onSnapshot({ ...net(0.8, 0, 1), rot: [0, 0, 0, 1] }, 1000, true);
    expect(p.active).toBe(true);
    expect(pos.x).toBeCloseTo(1, 5);
    expect(p.snaps).toBe(1);
    expect(resets).toBe(1);
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
