/** Collect the actual error remaining in scoring actuators during a model's simulation update. */
let ready = true;
let collecting = false;
export function collectScoringReadiness(update: () => void): boolean {
  const previous = { ready, collecting };
  ready = true; collecting = true;
  try { update(); return ready; }
  finally { ready = previous.ready; collecting = previous.collecting; }
}
export function scoringPosition(current: number, target: number, tolerance = .02): number {
  if (collecting && (!Number.isFinite(current) || Math.abs(current-target) > tolerance)) ready = false;
  return current;
}
/** Scoring joints settle promptly while retaining continuous actuator motion. */
export function scoringApproach(from: number, to: number, rate: number, dt: number): number {
  return scoringPosition(dt > 0 ? to+(from-to)*Math.exp(-Math.max(10,rate)*dt) : to, to);
}
export function scoringEase(from: number, to: number, dt: number): number {
  return scoringApproach(from,to,10,dt);
}
export function scoringActuator(from: number, to: number, rate: number, dt: number): number {
  const step = rate * dt;
  return scoringPosition(dt > 0 ? from+Math.max(-step,Math.min(step,to-from)) : to, to);
}

/**
 * Dye-rotor floor speed (rad/s), shared by every rotor robot: spins up hard while shooting, creeps backwards at idle
 * to keep FUEL moving, stops when disabled. `dir` flips the rotor for a robot whose floor turns the other way.
 */
export function dyeRotorRate(cur: number, s: { enabled: boolean; firing: number; dt: number }, fire = 8, dir: 1 | -1 = 1): number {
  const target = !s.enabled ? 0 : s.firing > 0 ? fire : -1.2;
  return (target + (cur - target) * Math.exp(-6 * s.dt)) * dir;
}

/**
 * `scoringEase` with a top speed (units/s): a joint whose target jumps (an arm leaving the handoff for its stowed
 * pose, a wrist flipping for the next level) starts at a real actuator's speed instead of covering a tenth of the
 * way in one frame, then settles exponentially as before.
 */
export function scoringSlew(from: number, to: number, maxRate: number, dt: number, rate = 10): number {
  if (dt <= 0) return scoringPosition(to, to);
  const eased = to + (from - to) * Math.exp(-Math.max(10, rate) * dt), limit = maxRate * dt;
  return scoringPosition(from + Math.max(-limit, Math.min(limit, eased - from)), to);
}

/** The angle equal to `target` (mod 2π) nearest `current`, so a joint turns the short way round. */
export function nearestTurn(target: number, current: number): number {
  return target + 2 * Math.PI * Math.round((current - target) / (2 * Math.PI));
}
/** Top swing speed of a 2025 scoring arm or wrist, rad/s (about 340°/s; a half-turn flip in ~0.5 s). [EST] */
export const ARM_SWING_RATE = 6;
