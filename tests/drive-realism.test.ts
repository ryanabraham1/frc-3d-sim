/**
 * Drive speed and acceleration come from real drivetrain hardware (motor, reduction, wheel, current limit), and
 * carried game pieces add mass, so a full hopper is slower off the line. Through the real Rapier loop on bare carpet.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { FieldFrame } from '../src/engine/coords';
import { GROUPS, PhysicsWorld } from '../src/engine/physics/world';
import { cloneConfig, DEFAULT_WHEEL_COF, RobotConfig } from '../src/engine/robot/config';
import { driveForce, driveFreeSpeed, driveTopSpeed, SDS_RATIOS } from '../src/engine/robot/drivetrainSpec';
import { IDLE_COMMAND, Robot } from '../src/engine/robot/robot';
import { SEASONS, getSeason } from '../src/seasons';
import { FUEL_MASS } from '../src/seasons/2026-rebuilt/constants';
import { HeadlessSim } from '../src/engine/testing/headless';

const FT = 0.3048;

beforeAll(async () => {
  await RAPIER.init();
});

describe('drivetrain hardware', () => {
  it('matches published free speeds', () => {
    expect(driveFreeSpeed({ motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R1, source: '' }) / FT).toBeCloseTo(14.4, 1);
    expect(driveFreeSpeed({ motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk5R3, source: '' }) / FT).toBeCloseTo(19.2, 1);
    expect(driveFreeSpeed({ motor: 'krakenX60FOC', ratio: SDS_RATIOS.mk4L2, source: '' }) / FT).toBeCloseTo(15.0, 1);
  });
  it('slower gearing trades top speed for pushing force', () => {
    const slow = { motor: 'krakenX60FOC' as const, ratio: SDS_RATIOS.mk5R1, source: '' };
    const fast = { ...slow, ratio: SDS_RATIOS.mk5R3 };
    expect(driveTopSpeed(slow)).toBeLessThan(driveTopSpeed(fast));
    expect(driveForce(slow)).toBeGreaterThan(driveForce(fast) * 1.3);
  });
  it('every stock robot drives at real FRC speeds and accelerations', () => {
    for (const s of SEASONS) {
      const all = [...(s.robotPresets ?? []).map((p) => [p.id, p.config] as const), ...(s.teamRobots ?? []).map((t) => [t.id, t.config] as const)];
      for (const [id, c] of all) {
        expect(c.drivetrain, id).toBeDefined();
        expect(c.maxSpeed / FT, id).toBeGreaterThanOrEqual(15.4 - 1e-9); // empty top speed floor
        expect(c.maxSpeed, id).toBeLessThan(5.5); // ≤ 18 ft/s
        // Launch acceleration: the motors' current-limited force, or the tread's grip when slow gearing has more.
        const launch = Math.min(c.maxAccel, (c.wheelCOF ?? DEFAULT_WHEEL_COF) * 9.81);
        expect(launch, id).toBeGreaterThan(5);
        expect(launch, id).toBeLessThan(12);
      }
    }
  });
  it('uses published gearing where a team gives it', () => {
    const reblitz = getSeason('2026-rebuilt').teamRobots!.find((t) => t.team === 2910)!.config;
    expect(reblitz.drivetrain!.source).toContain('MK5n R1');
    // Published gearing is slower than the 15.4 ft/s floor, so it is regeared to it.
    expect(reblitz.maxSpeed / FT).toBeCloseTo(15.4, 2);
  });
  it('AI fallback robots get real drivetrains too', () => {
    for (const s of SEASONS) {
      const c = s.botRobotConfig?.('normal');
      if (c) expect(c.drivetrain, s.id).toBeDefined();
    }
  });
});

class Arena {
  readonly physics = new PhysicsWorld(RAPIER, 1 / 90);
  constructor() {
    const ground = this.physics.fixedBody();
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(8, -0.5, -4).setFriction(0.9).setCollisionGroups(GROUPS.field), ground);
  }
  robot(cfg: RobotConfig, held: number, pieceMass: number): Robot {
    const r = new Robot(this.physics, new THREE.Scene(), new FieldFrame(16, 8), cloneConfig(cfg), 'blue', 0, 1, { x: 2, y: 4, yaw: 0 });
    r.enabled = true;
    r.pieceMass = pieceMass;
    for (let i = 0; i < held; i++) r.held.push(-1);
    return r;
  }
  /** Settle, then drive flat out along +x; returns the speed trace (one sample per step). */
  sprint(r: Robot, seconds: number): number[] {
    const dt = this.physics.dt;
    const trace: number[] = [];
    for (let i = 0; i < 20; i++) {
      r.drive(IDLE_COMMAND, dt);
      r.tick(dt);
      this.physics.step();
    }
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      r.drive({ ...IDLE_COMMAND, vx: 10 }, dt);
      r.tick(dt);
      this.physics.step();
      trace.push(r.speed);
    }
    return trace;
  }
}

describe('carried FUEL weighs the robot down', () => {
  const fixed = () => getSeason('2026-rebuilt').robotPresets!.find((p) => p.id === 'fixed')!.config;
  const timeTo = (trace: number[], v: number) => (trace.findIndex((s) => s >= v) + 1) / 90;

  it('a full hopper adds the real FUEL mass', () => {
    const r = new Arena().robot(fixed(), 60, FUEL_MASS);
    expect(r.payloadMass).toBeCloseTo(60 * FUEL_MASS, 5); // 12.9 kg (28 lb) of FUEL
    const a = new Arena();
    const loaded = a.robot(fixed(), 60, FUEL_MASS);
    a.sprint(loaded, 0.1);
    expect(loaded.body.mass()).toBeCloseTo(loaded.config.mass + 60 * FUEL_MASS, 2);
  });

  it('accelerates slower with a full hopper, and still reaches top speed', () => {
    const c = fixed();
    const ae = new Arena();
    const e = ae.sprint(ae.robot(c, 0, FUEL_MASS), 3);
    const af = new Arena();
    const full = af.robot(c, 60, FUEL_MASS);
    const f = af.sprint(full, 3);
    const tEmpty = timeTo(e, 0.8 * c.maxSpeed);
    const tFull = timeTo(f, 0.8 * c.maxSpeed);
    // 150 lb robot + 28 lb FUEL: about 19 % heavier for the same motor force.
    expect(tFull).toBeGreaterThan(tEmpty * 1.1);
    expect(tFull).toBeLessThan(tEmpty * 1.35);
    // 0 to 80 % of top speed in a realistic time for a swerve robot. [EST: ≈ 0.4–1.0 s]
    expect(tEmpty).toBeGreaterThan(0.3);
    expect(tEmpty).toBeLessThan(1);
    expect(e[e.length - 1]).toBeGreaterThan(0.95 * c.maxSpeed);
    expect(f[f.length - 1]).toBeGreaterThan(0.93 * c.maxSpeed);
    expect(full.tippedOver).toBe(false);
  });

  it('unloads as FUEL leaves', () => {
    const r = new Arena().robot(fixed(), 30, FUEL_MASS);
    r.held.length = 0;
    expect(r.payloadMass).toBe(0);
  });

  it('a 2026 robot with live hopper FUEL drives and stays upright', () => {
    const season = getSeason('2026-rebuilt');
    const robot = season.teamRobots!.find((t) => t.team === 254)!.config;
    const sim = new HeadlessSim(season, RAPIER, { robot, alliance: 'blue', pose: { x: 2.2, y: 2, yaw: Math.PI / 2 } });
    sim.load(40);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.robot.payloadMass).toBeGreaterThan(40 * FUEL_MASS * 0.85);
    for (let i = 0; i < 90; i++) sim.step({ ...IDLE_COMMAND, vy: 3 });
    expect(sim.robot.speed).toBeGreaterThan(2);
    expect(sim.robot.tippedOver).toBe(false);
  });
});
