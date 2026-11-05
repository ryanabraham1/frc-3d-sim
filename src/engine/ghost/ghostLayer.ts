import * as THREE from 'three';
import { FieldFrame } from '../coords';
import type { SeasonDefinition } from '../core/season';
import { projectileOf } from '../gamepiece/pool';
import { PhysicsWorld, type RapierModule } from '../physics/world';
import { makeTextSprite } from '../render/text';
import { cloneConfig, type RobotConfig } from '../robot/config';
import { Robot } from '../robot/robot';
import { ghostScoreAt, POSE_STRIDE, SHOT_STRIDE, type GhostRun } from './format';

/** A run to race, with the name shown over it. */
export interface GhostRace {
  name: string;
  run: GhostRun;
}

const COLORS = [0x6fe3ff, 0xffd166, 0xc79bff];
const GRAVITY = 9.81;
/** Longest a ghost's shot stays in the air (s). */
const SHOT_LIFE = 2.5;
const MAX_SHOTS = 40;

/** The driver's robot model, posed by hand: built on a throwaway physics world so it can never touch the match. */
export function ghostModel(R: RapierModule, season: SeasonDefinition, frame: FieldFrame, config: RobotConfig, alliance: 'red' | 'blue', material: THREE.Material): THREE.Group {
  const physics = new PhysicsWorld(R);
  const robot = new Robot(physics, new THREE.Scene(), frame, cloneConfig(config), alliance, 0, 1, { x: 0, y: 0, yaw: 0 });
  robot.projectile = projectileOf(season.gamePiece);
  season.configureRobot?.(robot);
  robot.enabled = false;
  robot.optimizeVisual();
  robot.syncVisual(0.016);
  const model = robot.visual;
  model.removeFromParent();
  physics.free();
  model.traverse((o) => {
    if (o instanceof THREE.Sprite) o.visible = false;
    if (!(o instanceof THREE.Mesh)) return;
    o.material = material;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return model;
}

class GhostRobot {
  private readonly material: THREE.MeshLambertMaterial;
  private readonly model: THREE.Group;
  private readonly label: THREE.Sprite;
  private readonly balls: THREE.InstancedMesh;
  private readonly ballPos = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  /** First shot that can still be in the air. */
  private firstShot = 0;

  constructor(R: RapierModule, private readonly scene: THREE.Scene, season: SeasonDefinition, frame: FieldFrame, config: RobotConfig, readonly race: GhostRace, color: number, private readonly flip: (p: THREE.Vector3, q?: THREE.Quaternion) => void) {
    this.material = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.3, depthWrite: false });
    this.model = ghostModel(R, season, frame, config, race.run.alliance, this.material);
    this.label = makeTextSprite(race.name, 0.2, { width: 512, height: 72, color: `#${color.toString(16).padStart(6, '0')}`, font: 'bold 52px system-ui, sans-serif' });
    this.label.material.depthTest = false;
    this.label.renderOrder = 10;
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(season.gamePiece.radius, 10, 8), this.material, MAX_SHOTS);
    this.balls.frustumCulled = false;
    this.balls.count = 0;
    scene.add(this.model, this.label, this.balls);
    this.update(0);
  }

  update(t: number): void {
    const { poses, hz } = this.race.run;
    const last = poses.length / POSE_STRIDE - 1;
    if (last < 0) return;
    const f = Math.min(last, Math.max(0, t * hz));
    const i = Math.min(last, Math.floor(f)), j = Math.min(last, i + 1), k = f - i;
    const a = i * POSE_STRIDE, b = j * POSE_STRIDE;
    const pos = this.model.position.set(poses[a], poses[a + 1], poses[a + 2]).lerp(this.ballPos.set(poses[b], poses[b + 1], poses[b + 2]), k);
    this.qa.set(poses[a + 3], poses[a + 4], poses[a + 5], poses[a + 6]).normalize();
    this.qb.set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]).normalize();
    this.model.quaternion.slerpQuaternions(this.qa, this.qb, k);
    this.flip(pos, this.model.quaternion);
    this.label.position.set(pos.x, pos.y + 1.35, pos.z);
    this.updateShots(t);
  }

  /** Shots fly on their launch arc: enough to read the ghost's rhythm, without simulating anything. */
  private updateShots(t: number): void {
    const s = this.race.run.shots;
    while (this.firstShot * SHOT_STRIDE < s.length && s[this.firstShot * SHOT_STRIDE] + SHOT_LIFE < t) this.firstShot++;
    let n = 0;
    for (let i = this.firstShot; i * SHOT_STRIDE < s.length && n < MAX_SHOTS; i++) {
      const o = i * SHOT_STRIDE, dt = t - s[o];
      if (dt < 0) break;
      const y = s[o + 2] + s[o + 5] * dt - 0.5 * GRAVITY * dt * dt;
      if (y < 0) continue;
      this.ballPos.set(s[o + 1] + s[o + 4] * dt, y, s[o + 3] + s[o + 6] * dt);
      this.flip(this.ballPos);
      this.balls.setMatrixAt(n++, this.m.makeTranslation(this.ballPos));
    }
    this.balls.count = n;
    if (n) this.balls.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.model, this.label, this.balls);
    this.material.dispose();
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.balls.geometry.dispose();
    this.balls.dispose();
  }
}

const TURN = new THREE.Quaternion(0, 1, 0, 0);

/**
 * The ghosts in a solo match: see-through robots replaying leaderboard runs on the match clock, plus the live score gap
 * to each. Lives only in the page's scene, so ghosts never collide with anything and the sim doesn't know about them.
 */
export class GhostLayer {
  private readonly ghosts: GhostRobot[];
  private readonly panel: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private lastPanel = -1;

  constructor(R: RapierModule, scene: THREE.Scene, season: SeasonDefinition, frame: FieldFrame, config: RobotConfig, races: GhostRace[], alliance: 'red' | 'blue', hudRoot: HTMLElement) {
    const flipFor = (run: GhostRun) => {
      if (run.alliance === alliance) return () => {};
      // A run from the other alliance plays on the driver's side, through the field's own symmetry.
      if (season.mapSymmetry === 'mirror') {
        return (p: THREE.Vector3, q?: THREE.Quaternion) => {
          p.x = -p.x;
          if (q) q.set(q.x, -q.y, -q.z, q.w).multiply(TURN);
        };
      }
      return (p: THREE.Vector3, q?: THREE.Quaternion) => {
        p.x = -p.x;
        p.z = -p.z;
        q?.premultiply(TURN);
      };
    };
    this.ghosts = races.map((race, i) => new GhostRobot(R, scene, season, frame, config, race, COLORS[i % COLORS.length], flipFor(race.run)));
    this.panel = document.createElement('div');
    this.panel.className = 'ghost-race';
    races.forEach((race, i) => {
      const row = document.createElement('div');
      row.className = 'ghost-race-row';
      row.style.setProperty('--ghost', `#${COLORS[i % COLORS.length].toString(16).padStart(6, '0')}`);
      const name = document.createElement('span');
      name.textContent = race.name;
      const gap = document.createElement('b');
      row.append(name, gap);
      this.panel.append(row);
      this.rows.push(gap);
    });
    hudRoot.append(this.panel);
  }

  /** `t`: seconds on the match clock. `score`: the driver's total now. */
  update(t: number, score: number): void {
    for (const g of this.ghosts) g.update(t);
    // The gap only needs to read well, not update every frame.
    const tick = Math.floor(t * 5);
    if (tick === this.lastPanel) return;
    this.lastPanel = tick;
    this.ghosts.forEach((g, i) => {
      const gap = score - ghostScoreAt(g.race.run, t);
      this.rows[i].textContent = `${gap > 0 ? '+' : ''}${gap}`;
      this.rows[i].className = gap > 0 ? 'ahead' : gap < 0 ? 'behind' : '';
    });
  }

  dispose(): void {
    for (const g of this.ghosts) g.dispose();
    this.panel.remove();
  }
}
