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
