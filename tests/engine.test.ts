import { describe, expect, it } from 'vitest';
import { FieldFrame, yawFromQuat, quatFromYaw } from '../src/engine/coords';
import { routeThroughBands } from '../src/engine/ai/steering';
import { formatClock, wrapAngle } from '../src/engine/units';
import { tagPoses } from '../src/engine/field/apriltags';
import layout from '../src/seasons/2026-rebuilt/apriltags-welded.json';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { BANDS } from '../src/seasons/2026-rebuilt/autopilot';

describe('coordinate frames', () => {
  const f = new FieldFrame(16.541, 8.069);
  it('field ↔ world round-trips', () => {
    const w = f.toWorld(1, 2, 3);
    expect(f.toField(w)).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('field +y maps to world -z; yaw is preserved', () => {
    const a = f.toWorld(0, 0);
    const b = f.toWorld(0, 1);
    expect(b.z - a.z).toBeCloseTo(-1);
    expect(yawFromQuat(quatFromYaw(1.2))).toBeCloseTo(1.2);
  });
});

describe('units', () => {
  it('formatClock matches the field timer', () => {
    expect(formatClock(140)).toBe('2:20');
    expect(formatClock(0.2)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });
  it('wrapAngle', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
});

describe('official AprilTag layout anchors the field', () => {
  const tags = tagPoses(layout);
  it('32 tags', () => expect(tags).toHaveLength(32));
  it('blue HUB center matches the midpoint of its tags', () => {
    const hub = tags.filter((t) => [18, 19, 20, 21, 24, 25, 26, 27].includes(t.id));
    const xs = hub.map((t) => t.x);
    const ys = hub.map((t) => t.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(C.HUB_CENTER.x, 3);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(C.HUB_CENTER.y, 3);
  });
  it('field is rotationally symmetric (tag 26 ↔ tag 10)', () => {
    const t26 = tags.find((t) => t.id === 26)!;
    const t10 = tags.find((t) => t.id === 10)!;
    expect(t10.x).toBeCloseTo(C.FIELD_LENGTH - t26.x, 2);
    expect(t10.y).toBeCloseTo(C.FIELD_WIDTH - t26.y, 2);
  });
});

describe('band routing (bumps / trenches)', () => {
  it('routes around the hub through a gap', () => {
    const from = { x: 2, y: C.HUB_CENTER.y };
    const to = { x: 8, y: C.HUB_CENTER.y };
    const wp = routeThroughBands(from, to, BANDS, 0.43, 0.5);
    expect(wp).not.toBe(to);
    expect(Math.abs(wp.y - C.HUB_CENTER.y)).toBeGreaterThan(C.HUB_SIZE / 2);
  });
  it('tall robots are not routed under the trench', () => {
    const from = { x: 2, y: 0.6 };
    const to = { x: 8, y: 0.6 };
    const wp = routeThroughBands(from, to, BANDS, 0.43, 0.7);
    expect(wp.y).toBeGreaterThan(C.TRENCH_OPENING_CENTER_Y * 2);
  });
  it('no detour when no band is in the way', () => {
    const to = { x: 3, y: 2 };
    expect(routeThroughBands({ x: 1, y: 1 }, to, BANDS, 0.4, 0.5)).toBe(to);
  });
});
