import * as THREE from 'three';
import { groundHeight } from '../world/zone7';
import type { ProjectileLook, WeaponSpec } from '../../data';

export type Owner = 'player' | 'enemy';
/** Pool looks: one per weapons.json projectile look, plus the Ego Charge volley and Bile Cantor spit. */
export type ProjectileKind = ProjectileLook | 'ego' | 'bile';
export const PROJECTILE_KINDS: ProjectileKind[] = ['spore', 'needle', 'shard', 'glob', 'bolt', 'ego', 'bile'];

export interface Projectile {
  pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3;
  life: number; owner: Owner; damage: number; splashRadius: number; splashDamage: number;
  gravity: number; kind: ProjectileKind; mesh: THREE.Mesh; alive: boolean;
  /** The player weapon that fired it: damage falloff and weak-point multiplier come from here. */
  weapon?: WeaponSpec;
  /** Creatures it may still pass through (each hit spends one). */
  pierce: number;
  /** Sticks where it lands and bursts after `fuse` seconds (stuck while `stuck` is set). */
  stick?: { fuse: number };
  stuck?: boolean;
  /** Creatures already hit (a piercing round hits each once). */
  hit?: Set<number>;
  /** Where it was fired from: damage falloff uses distance travelled. */
  origin: THREE.Vector3;
  /** Seeking projectiles (Ego Charge) steer toward a target each step. */
  seek?: { radius: number; turnRate: number };
}

export interface SegmentHit { point: THREE.Vector3; t: number }

/** Closest intersection of segment a→b with a sphere, as a fraction t in [0,1], or null. */
export function segmentSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A === 0) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

const MAX = 96;
const UP = new THREE.Vector3(0, 1, 0);

/** Pooled projectiles. Spores and bile are real travelling objects (not hitscan) so you can dodge and lead. */
export class Projectiles {
  readonly list: Projectile[] = [];
  private pool = Object.fromEntries(PROJECTILE_KINDS.map((k) => [k, [] as THREE.Mesh[]])) as Record<ProjectileKind, THREE.Mesh[]>;

  constructor(private scene: THREE.Scene, private looks: Record<Projectile['kind'], () => THREE.Mesh>) {}

  fire(kind: Projectile['kind'], owner: Owner, from: THREE.Vector3, vel: THREE.Vector3, o: { damage: number; splashRadius?: number; splashDamage?: number; gravity?: number; life?: number; seek?: { radius: number; turnRate: number }; weapon?: WeaponSpec; pierce?: number; stick?: { fuse: number } }): Projectile {
    if (this.list.length >= MAX) this.kill(this.list[0]);
    const mesh = this.pool[kind].pop() ?? this.looks[kind]();
    mesh.visible = true;
    mesh.position.copy(from);
    mesh.userData.origin = ((mesh.userData.origin as THREE.Vector3 | undefined) ?? new THREE.Vector3()).copy(from); // tracer length (render/shotfx)
    this.scene.add(mesh);
    const p: Projectile = {
      pos: from.clone(), prev: from.clone(), vel: vel.clone(), life: o.life ?? 2.5, owner, damage: o.damage,
      splashRadius: o.splashRadius ?? 0, splashDamage: o.splashDamage ?? 0, gravity: o.gravity ?? 0, kind, mesh, alive: true, origin: from.clone(), seek: o.seek,
      weapon: o.weapon, pierce: o.pierce ?? 0, stick: o.stick,
    };
    this.list.push(p);
    return p;
  }

  private stickAt(p: Projectile, at: THREE.Vector3): void {
    p.stuck = true;
    p.pos.copy(at);
    p.vel.set(0, 0, 0);
    p.life = p.stick!.fuse;
    p.mesh.position.copy(at);
  }

  kill(p: Projectile): void {
    if (!p.alive) return;
    p.alive = false;
    p.mesh.visible = false;
    this.scene.remove(p.mesh);
    this.pool[p.kind].push(p.mesh);
    this.list.splice(this.list.indexOf(p), 1);
  }

  /**
   * Moves every projectile. `hit` is asked whether the swept segment struck something;
   * `land` is called for ground impacts and expiry. Both receive the projectile, which is then removed.
   */
  update(dt: number, hit: (p: Projectile, from: THREE.Vector3, to: THREE.Vector3) => SegmentHit | null, land: (p: Projectile, at: THREE.Vector3) => void,
    steer?: (p: Projectile, dt: number) => void): void {
    for (const p of [...this.list]) {
      if (p.stuck) {
        // A stuck round (tumor launcher) bursts when its fuse runs out.
        p.life -= dt;
        if (p.life <= 0) { land(p, p.pos.clone()); this.kill(p); }
        continue;
      }
      p.prev.copy(p.pos);
      if (p.seek && steer) steer(p, dt);
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      const h = hit(p, p.prev, p.pos);
      if (h) {
        if (p.stick) { this.stickAt(p, h.point); continue; }
        if (p.pierce > 0) { p.pierce--; } else { this.kill(p); continue; }
      }
      const g = groundHeight(p.pos.x, p.pos.z);
      if (p.pos.y <= g || p.life <= 0) {
        if (p.pos.y <= g) p.pos.y = g + 0.05;
        if (p.stick && p.life > 0) { this.stickAt(p, p.pos); continue; }
        land(p, p.pos.clone());
        this.kill(p);
        continue;
      }
      p.mesh.position.copy(p.pos);
      const speed = p.vel.length();
      if (speed > 0.01) p.mesh.quaternion.setFromUnitVectors(UP, p.vel.clone().divideScalar(speed));
    }
  }
}
