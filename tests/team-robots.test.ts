import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons/index';
import { HeadlessSim } from '../src/engine/testing/headless';
import { runShotTrial } from '../src/engine/testing/shotHarness';
import { cloneConfig } from '../src/engine/robot/config';
import { hasRobotModel } from '../src/engine/robot/models';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { decodeSnapshot, encodeSnapshot } from '../src/engine/net/protocol';

const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); });

/** Local transforms of every object under the robot visual (to detect animation). */
function pose(root: THREE.Object3D): number[] {
  const out: number[] = [];
  root.traverse((o) => {
    if (o === root) return;
    out.push(o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.y);
  });
  return out;
}

describe('real team robots', () => {
  it('every season with team robots offers top teams, each with a registered model and a legal, stable config', () => {
    const withTeams = SEASONS.filter((s) => s.teamRobots?.length);
    expect(withTeams.map((s) => s.id).sort()).toEqual(SEASONS.map((s) => s.id).sort());
    for (const season of withTeams) {
      const ids = new Set<string>();
      for (const t of season.teamRobots!) {
        const label = `${season.id}/${t.id}`;
        expect(ids.has(t.id), label).toBe(false);
        ids.add(t.id);
        expect(t.config.teamNumber, label).toBe(t.team);
        expect(t.config.model && hasRobotModel(t.config.model), label).toBe(true);
        expect(t.source.length, label).toBeGreaterThan(10);
        // Already normalized: re-normalizing changes nothing (so the menu shows it as selected).
        const again = season.normalizeRobotConfig!(cloneConfig(t.config));
        expect(JSON.stringify(again), label).toBe(JSON.stringify(t.config));
        expect(t.config.height, label).toBeLessThanOrEqual(season.maxRobotHeight + 1e-9);
        expect(2 * (t.config.frameLength + t.config.frameWidth), label).toBeLessThanOrEqual(season.maxRobotPerimeter + 1e-6);
        // Scoring mechanisms face front, intakes go on the back (CLAUDE.md) — except where the real robot shoots
        // from its intake end (1690 Doppler's arm takes the NOTE straight from the intake).
        expect(t.config.intake.groundSide, label).toBe(['spectre-2910','doppler-1690', 'fiddler-971', 'snoopy-6036'].includes(t.id) ? 'front' : 'back');
        // No turrets on pick-and-place robots.
        if (season.maxScoringLevel) expect(t.config.launcher.turret, label).toBe(false);
      }
    }
  });

  it('the published capabilities that the configs encode', () => {
    const team = (season: string, id: string) => SEASONS.find((s) => s.id === season)!.teamRobots!.find((t) => t.id === id)!.config;
    const y24 = SEASONS.find((s) => s.year === 2024)!.id;
    const y25 = SEASONS.find((s) => s.year === 2025)!.id;
    const y26 = SEASONS.find((s) => s.year === 2026)!.id;
    expect(team(y24, 'vortex-254').launcher.turret).toBe(true);
    expect(team(y24, 'doppler-1690').height).toBeLessThan(0.3); // 11 in
    expect(team(y24, 'doppler-1690').maxSpeed).toBeCloseTo(5.6);
    expect(team(y25, 'spectre-2910').climber.secondsToClimb).toBeCloseTo(1.5);
    expect(team(y25, 'undertow-254').intake.ground && team(y25, 'undertow-254').intake.station).toBe(true);
    const rip = team(y26, 'ripcurrent-4414');
    expect([rip.launcher.turret, rip.hopperCapacity, rip.climber.maxLevel]).toEqual([true, 85, 0]);
    expect(rip.height).toBeLessThan(0.565); // under the 22.25 in TRENCH
    expect(team(y26, 'overload-254').launcher.turret).toBe(false);
  });

  for (const season of SEASONS) {
    for (const t of season.teamRobots ?? []) {
      it(`${season.id}/${t.id}: builds, animates (intake, firing, climb) and stays finite`, () => {
        const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(t.config), alliance: 'blue', pose: season.testing!.scoringSpots('blue')[0] });
        sims.push(sim);
        sim.rules.stage();
        const r = sim.robot;
        sim.step(IDLE_COMMAND);
        r.enabled = false;
        r.advanceScoringMechanisms(0.05);
        r.syncVisual(0.05);
        const idle = pose(r.visual);
        r.enabled = true;
        r.lastCommand = { ...IDLE_COMMAND, intake: true };
        for (let k = 0; k < 20; k++) { r.advanceScoringMechanisms(0.05); r.syncVisual(0.05); }
        const moving = pose(r.visual);
        expect(moving.every(Number.isFinite), 'finite transforms').toBe(true);
        expect(moving.some((v, i) => Math.abs(v - idle[i]) > 1e-3), 'something animates when enabled + intaking').toBe(true);
        // Firing: rollers / rotor spin faster.
        const before = pose(r.visual);
        r.held.push(-1);
        r.advanceScoringMechanisms(0.05);
        r.syncVisual(0.05);
        r.held.length = 0;
        r.advanceScoringMechanisms(0.05);
        r.syncVisual(0.05);
        expect(pose(r.visual).some((v, i) => Math.abs(v - before[i]) > 1e-3)).toBe(true);
      });
    }
  }

  it('every REEFSCAPE team carries its held piece in the moving end effector at L4', () => {
    const season = SEASONS.find(s => s.year === 2025)!;
    for (const team of season.teamRobots!) {
      const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(team.config), alliance: 'blue', pose: season.testing!.scoringSpots('blue')[0] });
      sims.push(sim);
      const robot = sim.robot;
      expect(robot.modelHeldAnchor, team.id).toBeDefined();
      // Side scorers (1778's swinging arm) reach out of the robot's left (-z) instead of the front.
      // End scorers (1690's arm that rotates over the top) must also reach out of the back (side 2).
      const mode = team.config.placement!.scoreSide;
      for (const side of mode === 'sides' ? [1] : mode === 'ends' ? [0, 2] : [0]) {
        robot.placeAnim = { height: 1.75, forward: 0.7, level: 4, side };
        for (let frame = 0; frame < 120; frame++) robot.syncVisual(1 / 60);
        robot.visual.updateMatrixWorld(true);
        const center = robot.visual.worldToLocal(robot.modelHeldAnchor!.getWorldPosition(new THREE.Vector3()));
        const want = side === 1 ? new THREE.Vector3(0, 1.75, -0.7) : new THREE.Vector3(side === 2 ? -0.7 : 0.7, 1.75, 0);
        expect(center.distanceTo(want), `${team.id} side ${side}`).toBeLessThan(0.2);
      }
    }
  });

  it('team robots with a launcher still score from the season scoring spots', () => {
    for (const season of SEASONS) {
      if (season.testing?.mechanism === 'placement') continue;
      for (const t of season.teamRobots ?? []) {
        if (!t.config.launcher.enabled) continue;
        let fired = 0;
        let entered = 0;
        const spots = season.testing!.scoringSpots('blue');
        for (const spot of [spots[1], spots[5], spots[9]].filter(Boolean)) {
          const g = season.testing!.goalCenter('blue');
          const p = t.config.launcher.turret ? spot : { ...spot, yaw: Math.atan2(g.y - spot.y, g.x - spot.x) };
          const res = runShotTrial(season, RAPIER, { label: t.id, robot: cloneConfig(t.config), alliance: 'blue', pose: p, shots: 12 });
          fired += res.fired;
          entered += res.entered;
        }
        expect(fired, `${season.id}/${t.id} fired`).toBeGreaterThan(0);
        // Spots span the whole scoring area (the default 2026 robot makes ~40% of these); a playable robot must too.
        expect(entered / fired, `${season.id}/${t.id} hit rate`).toBeGreaterThanOrEqual(0.35);
      }
    }
  });

  it('mechanism animation state replicates to multiplayer clients', () => {
    const snap = encodeSnapshot({
      seq: 1, time: 0, pieceIdx: [], piecePos: [], meta: {} as never,
      robots: [{ id: 0, x: 0, y: 0, z: 0, yaw: 0, turretYaw: 0, held: 0, enabled: true, climbPhase: 0, climbLevel: 0, climbSlot: null, climbProgress: 0, cmdSeq: 0, act: 3, hood: 0.7 }],
    });
    const r = decodeSnapshot(snap)!.robots[0];
    expect(r.act).toBe(3);
    expect(r.hood).toBeCloseTo(0.7, 2);
  });
});

it('Spectre keeps scoring during endgame readiness and raises its arm only after climb starts',()=>{
  const season=SEASONS.find(s=>s.year===2025)!;
  const config=cloneConfig(season.teamRobots!.find(t=>t.id==='spectre-2910')!.config);
  const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:season.testing!.scoringSpots('blue')[0]});sims.push(sim);
  const r=sim.robot;
  r.placeAnim={height:1.75,forward:.7,level:4};r.climbReady=false;r.syncVisual(0);
  const before=pose(r.visual);
  r.climbReady=true;r.syncVisual(0);
  expect(pose(r.visual)).toEqual(before);
  r.climbPhase='align';r.syncVisual(0);
  expect(pose(r.visual)).not.toEqual(before);
});
