import * as THREE from 'three';
import type { GamePiecePool } from '../gamepiece/pool';
import type { Rng } from '../random';
import type { Robot } from './robot';

/**
 * FUEL falling out of an open hopper. A multi-ball launcher robot carries its pieces loose in a bin with no lid, so:
 *  - a hard hit (the chassis velocity changing by more than IMPACT_DV within ~0.05 s: wall, robot, or a full-speed stop)
 *    bounces a share of the load over the rim, harder hits throw more, in the direction the load was travelling;
 *  - tilting the chassis spills it like a tipped cup: a trickle once it leans past TILT_START, a stream when it is on
 *    its side or upside down, rolling out toward the low side.
 * Spilled balls are real field pieces again (they ignore the robot for a moment so they can leave the bin). Host only:
 * call it from the same place the robot's own shots are launched, once per physics tick.
 */
const IMPACT_DV = 3.2; // m/s of horizontal velocity change inside the sample window
const IMPACT_COOLDOWN = 0.35; // s between impact spills
const TILT_START = 0.85; // chassis up-axis y below this (~32°) starts spilling
const TILT_RATE = 22; // balls/s when fully on its side or upside down
const HISTORY = 5; // velocity samples compared for impact detection
const PASS_THROUGH = 0.45; // s a spilled ball ignores robot colliders so it can clear the bin

interface SpillState { vx: number[]; vz: number[]; cooldown: number; carry: number; ignore: Map<number, number> }
const states = new WeakMap<Robot, SpillState>();

/** True for robots that carry several loose pieces in an open bin (REBUILT-style FUEL hoppers). */
export function hasOpenHopper(robot: Robot): boolean {
  const c = robot.config;
  return c.launcher.enabled && c.hopperCapacity > 1;
}

export function spillHeld(robot: Robot, pool: GamePiecePool, dt: number, rng: Rng): number {
  if (!hasOpenHopper(robot)) return 0;
  let st = states.get(robot);
  if (!st) states.set(robot, st = { vx: [], vz: [], cooldown: 0, carry: 0, ignore: new Map() });
  for (const [i, t] of st.ignore) {
    if (t <= dt) { pool.setIgnoreRobots(i, false); st.ignore.delete(i); } else st.ignore.set(i, t - dt);
  }
  const v = robot.body.linvel();
  st.vx.push(v.x); st.vz.push(v.z);
  if (st.vx.length > HISTORY) { st.vx.shift(); st.vz.shift(); }
  st.cooldown = Math.max(0, st.cooldown - dt);
  if (!robot.enabled || robot.isClimbing || robot.held.length === 0) { st.carry = 0; return 0; }

  let out = 0;
  const release = (dir: THREE.Vector3, speed: number, lift: number): void => {
    const idx = robot.held.pop();
    if (idx === undefined) return;
    const c = robot.config;
    const p = robot.localToWorld((rng.next() - 0.5) * c.frameLength * 0.6, c.height - 0.04, (rng.next() - 0.5) * c.frameWidth * 0.7);
    p.y = Math.max(p.y, pool.radius + 0.03);
    const vel = new THREE.Vector3(v.x + dir.x * speed, lift + rng.next() * 1.2, v.z + dir.z * speed);
    vel.x += (rng.next() - 0.5) * 1.2; vel.z += (rng.next() - 0.5) * 1.2;
    pool.placeWorld(idx, p, vel);
    pool.setIgnoreRobots(idx, true);
    st!.ignore.set(idx, PASS_THROUGH);
    robot.noteLaunch(idx); // not straight back into the intake
    out++;
  };

  // Hard hit: compare against the oldest sample in the window.
  if (st.cooldown <= 0 && st.vx.length === HISTORY) {
    const dx = st.vx[0] - v.x, dz = st.vz[0] - v.z, dv = Math.hypot(dx, dz);
    if (dv > IMPACT_DV) {
      const share = Math.min(0.6, 0.1 + (dv - IMPACT_DV) * 0.08);
      const n = Math.max(1, Math.round(robot.held.length * share));
      const dir = new THREE.Vector3(dx / dv, 0, dz / dv); // the load keeps going the way the robot was moving
      for (let k = 0; k < n; k++) release(dir, Math.min(4, dv * 0.35), 1.2 + dv * 0.15);
      st.cooldown = IMPACT_COOLDOWN;
    }
  }

  // Tilt: pour toward the low side (the horizontal lean of the chassis up axis).
  const up = robot.uprightness;
  if (up < TILT_START) {
    const q = robot.body.rotation();
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const lean = Math.hypot(axis.x, axis.z);
    const dir = lean > 1e-3 ? new THREE.Vector3(axis.x / lean, 0, axis.z / lean) : new THREE.Vector3(rng.next() - 0.5, 0, rng.next() - 0.5).normalize();
    const severity = Math.min(1, (TILT_START - up) / (TILT_START + 0.5));
    st.carry += TILT_RATE * severity * dt;
    while (st.carry >= 1 && robot.held.length > 0) { st.carry -= 1; release(dir, 0.6 + severity * 0.8, 0.3); }
  } else st.carry = 0;
  return out;
}
