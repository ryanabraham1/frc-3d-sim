/**
 * Robot-on-robot contact (defense): pushing matches are decided by mass, tread grip and motor limits; hits off a
 * robot's center spin it; disabled robots can be shoved. Two robots on a bare carpet, through the real Rapier loop.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { FieldFrame } from '../src/engine/coords';
import { GROUPS, PhysicsWorld } from '../src/engine/physics/world';
import { cloneConfig, DEFAULT_ROBOT, RobotConfig } from '../src/engine/robot/config';
import { HOLD_FORCE_RATIO, KINETIC_RATIO, limitWheelForce, motorForce, pushingForce, WheelModel } from '../src/engine/robot/drivetrain';
import { IDLE_COMMAND, Robot, RobotCommand } from '../src/engine/robot/robot';
import { lb } from '../src/engine/units';

beforeAll(async () => {
  await RAPIER.init();
});

class Arena {
  readonly physics = new PhysicsWorld(RAPIER, 1 / 90);
  readonly frame = new FieldFrame(16, 8);
  readonly scene = new THREE.Scene();
  readonly robots: Robot[] = [];
  constructor() {
    const R = RAPIER;
    const ground = this.physics.fixedBody();
    this.physics.world.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(8, -0.5, -4).setFriction(0.9).setCollisionGroups(GROUPS.field), ground);
  }
  add(cfg: RobotConfig, x: number, y: number, yaw: number, enabled = true): Robot {
    const r = new Robot(this.physics, this.scene, this.frame, cfg, this.robots.length ? 'red' : 'blue', this.robots.length, 1, { x, y, yaw });
    r.enabled = enabled;
    this.robots.push(r);
    return r;
  }
  run(seconds: number, cmds: RobotCommand[]): void {
    for (let i = 0; i < Math.round(seconds / this.physics.dt); i++) {
      this.robots.forEach((r, k) => r.drive(cmds[k] ?? IDLE_COMMAND, this.physics.dt));
      this.robots.forEach((r) => r.tick(this.physics.dt));
      this.physics.step();
    }
  }
}

const cfg = (mod: (c: RobotConfig) => void = () => {}): RobotConfig => {
  const c = cloneConfig(DEFAULT_ROBOT);
  mod(c);
  return c;
};
const forward = (v = 4.5): RobotCommand => ({ ...IDLE_COMMAND, vx: v });

/**
 * Pusher (blue, facing +x) starts bumper to bumper behind a defender (red) that holds its spot, and drives at it
 * flat out from rest (no run-up: a ram adds momentum on top). Returns how far the defender is moved (and turned) in 3 s.
 */
function pushMatch(pusher: RobotConfig, defender: RobotConfig, opts: { offset?: number; defenderYaw?: number; defenderEnabled?: boolean } = {}) {
  const a = new Arena();
  const p = a.add(pusher, 4, 4, 0);
  const d = a.add(defender, 0, 0, opts.defenderYaw ?? 0, opts.defenderEnabled ?? true);
  const along = Math.abs(Math.cos(opts.defenderYaw ?? 0)) > 0.5 ? d.footprint.length : d.footprint.width;
  d.body.setTranslation(a.frame.toWorld(4 + (p.footprint.length + along) / 2 + 0.003, 4 + (opts.offset ?? 0), 0.002), true);
  a.run(0.2, []);
  const start = { ...d.pose };
  a.run(3, [forward()]);
  const end = d.pose;
  return { moved: end.x - start.x, yaw: end.yaw - start.yaw, pusher: p, defender: d };
}

describe('drive wheel limits', () => {
  const w: WheelModel = { motorLimit: 120, stall: 840, freeSpeed: 5, traction: 150 };
  const out = { x: 0, z: 0 };
  it('caps a wheel at its current limit, and back-EMF takes force away near free speed', () => {
    limitWheelForce(w, 1000, 0, 0, 0, out);
    expect(out.x).toBeCloseTo(120);
    expect(motorForce(w, 4.9)).toBeLessThan(20);
    expect(motorForce(w, -3)).toBe(120 * HOLD_FORCE_RATIO); // braking / holding: boosted limit
  });
  it('a wheel asked for more than the tread holds breaks loose and slides at kinetic friction', () => {
    const strong = { ...w, motorLimit: 400, stall: 2800 };
    expect(limitWheelForce(strong, 140, 0, 0, 0, out)).toBe(false);
    expect(out.x).toBeCloseTo(140);
    expect(limitWheelForce(strong, 1000, 0, 0, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(150 * KINETIC_RATIO);
  });
  it('a tank wheel cannot drive sideways: only tread friction resists a side push', () => {
    const tank = { ...w, axis: { x: 1, z: 0 } };
    limitWheelForce(tank, 0, 1000, 0, 0, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(150 * KINETIC_RATIO);
  });
  it('pushing force is the lesser of motor force and tread grip', () => {
    expect(pushingForce(cfg((c) => (c.maxAccel = 5)))).toBeCloseTo(lb(125) * 5 * HOLD_FORCE_RATIO); // motor-limited
    expect(pushingForce(cfg((c) => ((c.maxAccel = 20), (c.wheelCOF = 1.0))))).toBeCloseTo(lb(125) * 9.81); // traction-limited
  });
  it('a disabled robot brakes in proportion to how fast it is pushed', () => {
    const off = { ...w, disabled: true };
    expect(motorForce(off, 0)).toBe(0);
    expect(motorForce(off, -0.25)).toBeCloseTo(42);
    expect(motorForce(off, 2)).toBe(0); // no drive command
  });
});

describe('robot-on-robot defense', () => {
  it('equal robots stalemate: a defender holding its spot is not driven off it', () => {
    const r = pushMatch(cfg(), cfg());
    expect(Math.abs(r.moved)).toBeLessThan(0.15);
  });
  it('a heavier robot pushes a lighter one off its spot', () => {
    const r = pushMatch(cfg((c) => (c.mass = lb(150))), cfg((c) => (c.mass = lb(100))));
    expect(r.moved).toBeGreaterThan(0.6);
  });
  it('flooring it past the tread limit only spins the wheels: no extra push (traction caps it)', () => {
    const r = pushMatch(cfg((c) => (c.maxAccel = 16)), cfg((c) => (c.maxAccel = 11)));
    expect(r.pusher.wheelsSlipping).toBeGreaterThan(0);
    expect(r.moved).toBeLessThan(0.15);
  });
  it('grippier tread wins a pushing match between traction-limited robots', () => {
    const r = pushMatch(cfg((c) => ((c.maxAccel = 14), (c.wheelCOF = 1.3))), cfg((c) => ((c.maxAccel = 14), (c.wheelCOF = 0.8))));
    expect(r.moved).toBeGreaterThan(0.6);
  });
  it('a hit off the defender’s center spins it; a centered hit does not', () => {
    const centered = pushMatch(cfg((c) => (c.mass = lb(150))), cfg());
    const corner = pushMatch(cfg((c) => (c.mass = lb(150))), cfg(), { offset: 0.45 });
    expect(Math.abs(centered.yaw)).toBeLessThan(0.1);
    expect(Math.abs(corner.yaw)).toBeGreaterThan(0.35);
  });
  it('a disabled robot (motors in brake mode) gets shoved', () => {
    const r = pushMatch(cfg(), cfg(), { defenderEnabled: false });
    expect(r.moved).toBeGreaterThan(1);
  });
  it('a tank drive is hard to push sideways (tread friction); a swerve with the same weak motors gives way', () => {
    // Pusher: strong motors, traction-limited (μ 1.0, ≈ 560 N). Defenders: 125 lb with weak drive motors (≈ 270 N).
    const pusher = cfg((c) => ((c.maxAccel = 12), (c.wheelCOF = 1.0)));
    const weak = (c: RobotConfig) => (c.maxAccel = 3);
    const tank = pushMatch(pusher, cfg((c) => (weak(c), (c.drive = 'tank'))), { defenderYaw: Math.PI / 2 });
    const swerve = pushMatch(pusher, cfg(weak), { defenderYaw: Math.PI / 2 });
    expect(Math.abs(tank.moved)).toBeLessThan(0.15);
    expect(swerve.moved).toBeGreaterThan(0.6);
  });
});

describe('low overhead clearance', () => {
  it('a robot with ½ in to spare drives under a beam at full speed without a ghost collision', () => {
    // Rapier's speculative contacts once stopped trench bots dead under the TRENCH arm (edge-to-edge contact
    // predicted inside the 2 cm default margin). Try many step phases: none may snag.
    const robot = cfg((c) => (c.height = 0.55));
    for (let k = 0; k < 25; k++) {
      const a = new Arena();
      const beam = a.physics.fixedBody();
      const at = a.frame.toWorld(7.5, 4, 0.55 + 0.0127 + 0.08);
      a.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.08, 1).setTranslation(at.x, at.y, at.z).setCollisionGroups(GROUPS.field), beam);
      const r = a.add(robot, 4 + k * 0.002, 4, 0);
      a.run(2.2, [forward()]);
      expect(r.pose.x, `phase ${k}`).toBeGreaterThan(9.5);
    }
  });
});

describe('righting a tipped robot', () => {
  it('stands it up clear of a field element it fell against instead of inside it', () => {
    const a = new Arena();
    const R = RAPIER;
    // a fixed post the upright chassis would overlap if it were stood up where the tipped robot lies
    a.physics.world.createCollider(R.ColliderDesc.cuboid(0.4, 0.6, 0.4).setTranslation(8, 0.6, -4).setCollisionGroups(GROUPS.field), a.physics.fixedBody());
    const r = a.add(cfg(), 8, 4, 0);
    r.body.setTranslation({ x: 8 + 0.4 + r.footprint.width / 2 - 0.05, y: 0.35, z: -4 }, true);
    r.body.setRotation({ x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) }, true); // on its side
    a.run(0.05, []);
    r.setUpright();
    expect(r.tippedOver).toBe(false);
    a.run(1, []);
    const p = r.body.translation();
    const ox = Math.max(0, Math.abs(p.x - 8) - 0.4 - r.footprint.length / 2);
    const oz = Math.max(0, Math.abs(p.z + 4) - 0.4 - r.footprint.width / 2);
    expect(Math.max(ox, oz), 'robot overlaps the post').toBeGreaterThan(-0.001);
    expect(r.uprightness).toBeGreaterThan(0.95);
    expect(p.y).toBeLessThan(0.1);
  });
});
