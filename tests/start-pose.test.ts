import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig, footprint } from '../src/engine/robot/config';
import {
  checkStartSpot,
  clampToArea,
  fieldToSpot,
  fitStartSpot,
  footprintPoly,
  polysOverlap,
  resolveStartPose,
  spotToField,
  type StartSpot,
} from '../src/engine/startPose';
import { SEASONS } from '../src/seasons';
import { fieldDims, placementProblems, presetSpot } from '../src/app/placement';
import { slotId, type LobbyPlayer } from '../src/engine/net/protocol';

beforeAll(async () => {
  await RAPIER.init();
});
const sims: HeadlessSim[] = [];
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

describe('polygon overlap', () => {
  const sq = (x: number, y: number, s = 1): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  it('detects overlap, ignores touching edges and gaps', () => {
    expect(polysOverlap(sq(0, 0), sq(0.5, 0.5))).toBe(true);
    expect(polysOverlap(sq(0, 0), sq(1, 0))).toBe(false);
    expect(polysOverlap(sq(0, 0), sq(2, 0))).toBe(false);
  });
  it('handles a rotated footprint against a corner', () => {
    const robot = footprintPoly({ x: 1.45, y: 0.5, yaw: Math.PI / 4 }, 1, 1);
    expect(polysOverlap(robot, sq(0, 0))).toBe(true); // rotated corner pokes in
    expect(polysOverlap(footprintPoly({ x: 1.6, y: 0.5, yaw: 0 }, 1, 1), sq(0, 0))).toBe(false);
  });
});

for (const season of SEASONS) {
  describe(`${season.id} start zone`, () => {
    const area = season.startArea!;
    const robot = season.robotDefaults;
    const fp = footprint(robot);
    /** Headings at which the footprint fits the zone at all (a 40 in Hero Heist TOWER ZONE only fits a square-on robot). */
    const fits = (yaw: number) => {
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
      return fp.length * c + fp.width * s <= area.rect.x1 - area.rect.x0 + 1e-9 && fp.length * s + fp.width * c <= area.rect.y1 - area.rect.y0 + 1e-9;
    };

    it('declares a start area', () => expect(area).toBeDefined());

    it('every driver-station preset is a legal start', () => {
      for (const a of ['blue', 'red'] as const)
        for (const n of [1, 2, 3]) {
          const spot = presetSpot(season, a, n);
          expect(checkStartSpot(area, spot, fp.length, fp.width), `${a} ${n}`).toEqual({ ok: true });
        }
    });

    it('presets on one alliance never overlap each other', () => {
      const polys = [1, 2, 3].map((n) => footprintPoly(presetSpot(season, 'blue', n), fp.length, fp.width));
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(polysOverlap(polys[i], polys[j])).toBe(false);
    });

    it('rejects spots outside the zone, on field elements, and rotated ones that poke out', () => {
      const r = area.rect;
      expect(checkStartSpot(area, { x: r.x1 + 0.5, y: (r.y0 + r.y1) / 2, yaw: 0 }, fp.length, fp.width).ok).toBe(false);
      for (const k of area.keepOut?.slice(0, 1) ?? []) {
        const cx = k.reduce((a, p) => a + p[0], 0) / k.length;
        const cy = k.reduce((a, p) => a + p[1], 0) / k.length;
        expect(checkStartSpot(area, { x: cx, y: cy, yaw: 0 }, fp.length, fp.width).ok).toBe(false);
      }
      // Flush against the wall facing the field is legal; turned 45° the corners cross the wall.
      const mid = (r.y0 + r.y1) / 2;
      const flush = { x: r.x0 + fp.length / 2, y: mid, yaw: 0 };
      if (checkStartSpot(area, flush, fp.length, fp.width).ok) expect(checkStartSpot(area, { ...flush, yaw: Math.PI / 4 }, fp.length, fp.width).ok).toBe(false);
    });

    it('clamping keeps any heading inside the rectangle', () => {
      for (const yaw of [0, 0.7, Math.PI / 2, 2.4].filter(fits)) {
        const c = clampToArea(area, { x: -5, y: -5, yaw }, fp.length, fp.width);
        const poly = footprintPoly(c, fp.length, fp.width);
        for (const [x, y] of poly) {
          expect(x).toBeGreaterThanOrEqual(area.rect.x0 - 1e-9);
          expect(y).toBeGreaterThanOrEqual(area.rect.y0 - 1e-9);
        }
      }
    });

    it('dragging across an obstacle never ends on an illegal spot', () => {
      let cur: StartSpot = presetSpot(season, 'blue', 2);
      const r = area.rect;
      for (let i = 0; i <= 60; i++) {
        const want = { x: r.x0 + ((r.x1 - r.x0) * i) / 60, y: r.y0 + ((r.y1 - r.y0) * ((i * 7) % 61)) / 60, yaw: i * 0.3 };
        cur = fitStartSpot(area, cur, want, fp.length, fp.width);
        expect(checkStartSpot(area, cur, fp.length, fp.width).ok).toBe(true);
      }
    });

    it('red mirrors the blue spot the way the field does, and round-trips', () => {
      const f = fieldDims(season);
      const spot = { x: area.rect.x0 + 1.2, y: (area.rect.y0 + area.rect.y1) / 2 + 0.3, yaw: 0.4 };
      const red = spotToField(f, 'red', spot);
      expect(red.x).toBeCloseTo(season.fieldLength - spot.x);
      expect(red.y).toBeCloseTo(season.mapSymmetry === 'mirror' ? spot.y : season.fieldWidth - spot.y);
      const back = fieldToSpot(f, 'red', red);
      expect(back.x).toBeCloseTo(spot.x);
      expect(back.y).toBeCloseTo(spot.y);
      expect(Math.cos(back.yaw)).toBeCloseTo(Math.cos(spot.yaw));
      expect(Math.sin(back.yaw)).toBeCloseTo(Math.sin(spot.yaw));
    });

    it('a legal custom spot becomes the start pose, an illegal one falls back to the preset', () => {
      const f = fieldDims(season);
      const preset = season.startPose('blue', 2);
      const heading = fits(1.1) ? 1.1 : Math.PI;
      let legal: StartSpot | null = null;
      for (let x = area.rect.x0; x <= area.rect.x1 && !legal; x += 0.02)
        for (let y = area.rect.y0; y <= area.rect.y1 && !legal; y += 0.1) if (checkStartSpot(area, { x, y, yaw: heading }, fp.length, fp.width).ok) legal = { x, y, yaw: heading };
      expect(legal).not.toBeNull();
      const pose = resolveStartPose(f, area, 'blue', legal, preset, fp.length, fp.width);
      expect(pose).toMatchObject({ x: legal!.x, y: legal!.y });
      expect(Math.cos(pose.yaw)).toBeCloseTo(Math.cos(heading));
      const illegal = { x: area.rect.x1 + 3, y: preset.y, yaw: 0 };
      expect(resolveStartPose(f, area, 'blue', illegal, preset, fp.length, fp.width)).toEqual(preset);
      expect(resolveStartPose(f, area, 'blue', { x: NaN, y: 0, yaw: 0 }, preset, fp.length, fp.width)).toEqual(preset);
    });

    it('spawns the real robot at the chosen position and heading', () => {
      const f = fieldDims(season);
      const preset = season.startPose('red', 2);
      const spot = fieldToSpot(f, 'red', preset);
      const custom: StartSpot = { ...spot, yaw: Math.PI / 3 };
      const pose = resolveStartPose(f, area, 'red', custom, preset, fp.length, fp.width);
      const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(robot), alliance: 'red', pose });
      sims.push(sim);
      for (let i = 0; i < 45; i++) sim.step({ vx: 0, vy: 0, omega: 0, intake: false, shoot: false, pass: false, descend: false, climb: null });
      const p = sim.robot.pose;
      expect(Math.hypot(p.x - pose.x, p.y - pose.y)).toBeLessThan(0.05);
      expect(Math.cos(p.yaw - pose.yaw)).toBeGreaterThan(0.99);
    });
  });
}

describe('multiplayer placement checks', () => {
  const season = SEASONS[0];
  const fp = footprint(season.robotDefaults);
  const player = (id: string, slot: ReturnType<typeof slotId>, spot?: StartSpot): LobbyPlayer => ({ peerId: id, name: id, slot, team: 1, host: false, dims: { length: fp.length, width: fp.width }, spot });

  it('presets are fine; two teammates on the same spot are both flagged', () => {
    expect(placementProblems(season, [player('a', slotId('blue', 1)), player('b', slotId('blue', 2))]).size).toBe(0);
    const spot = presetSpot(season, 'blue', 2);
    const bad = placementProblems(season, [player('a', slotId('blue', 1), spot), player('b', slotId('blue', 2), spot)]);
    expect([...bad.keys()].sort()).toEqual(['a', 'b']);
  });

  it('opponents never conflict, even at the same blue-frame spot', () => {
    const spot = presetSpot(season, 'blue', 2);
    expect(placementProblems(season, [player('a', slotId('blue', 2), spot), player('b', slotId('red', 2), spot)]).size).toBe(0);
  });

  it('spectators are ignored', () => {
    expect(placementProblems(season, [{ ...player('s', slotId('blue', 1)), slot: null }]).size).toBe(0);
  });
});

describe('2025 starting line', () => {
  const season = SEASONS.find((x) => x.id === '2025-reefscape')!;
  const area = season.startArea!;
  const fp = footprint(season.robotDefaults);

  it('bumpers must touch the line: fully behind it would score LEAVE without moving', () => {
    const y = 1.5;
    expect(checkStartSpot(area, { x: area.line! - fp.length, y, yaw: 0 }, fp.length, fp.width).ok).toBe(false);
    expect(checkStartSpot(area, { x: area.line! - fp.length / 2 + 0.01, y, yaw: 0 }, fp.length, fp.width).ok).toBe(true);
    expect(checkStartSpot(area, { x: area.line! + fp.length, y, yaw: 0 }, fp.length, fp.width).ok).toBe(false);
  });

  it('dragging keeps the robot on the line', () => {
    const cur = fitStartSpot(area, presetSpot(season, 'blue', 2), { x: 2, y: 1.5, yaw: 0 }, fp.length, fp.width);
    expect(checkStartSpot(area, cur, fp.length, fp.width).ok).toBe(true);
    expect(cur.x).toBeGreaterThan(area.line! - fp.length);
  });
});
