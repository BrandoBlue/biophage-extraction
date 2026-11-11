import * as THREE from 'three';
import { HIVE, ZONE7 } from '../render/palette';
import type { Weapon } from '../../data';
import { mulberry32 } from '../world/zone7';
import { AutoWeaponState } from './weapon-state';
import { SynapseBursterView } from './viewmodel';
import type { Projectiles } from './projectiles';
import { boltLook } from '../render/shotfx';

const DEG = Math.PI / 180;

/** Glowing projectile looks, shared by the Projectiles pool. */
export function projectileLooks(): Record<'spore' | 'ego' | 'bile', () => THREE.Mesh> {
  const bile = new THREE.MeshBasicMaterial({ color: ZONE7.lime, toneMapped: false });
  const bileGeo = new THREE.IcosahedronGeometry(0.28, 1);
  return {
    // Bolt cores, tracer tails and halos come from Rendering (src/render/shotfx.ts).
    spore: boltLook(HIVE.acid),
    ego: boltLook(ZONE7.cyan, { core: 0.1, tail: 10, width: 0.13, halo: 1.2 }),
    bile: () => new THREE.Mesh(bileGeo, bile),
  };
}

export interface FireContext {
  /** World point under the crosshair (first creature hit or a far point). */
  aimPoint: THREE.Vector3;
  moving: boolean;
  sprinting: boolean;
}

/**
 * The Synapse Burster (docs/gdd/03-combat.md): automatic spore projectiles, regrow reload, ADS, recoil,
 * and the Ego Charge alt fire that releases seeking spores once enough hits have landed.
 */
export class SynapseBurster {
  readonly id = 'synapseBurster';
  readonly state: AutoWeaponState;
  readonly view: SynapseBursterView;
  ego = 0;
  aim = 0;
  private rand = mulberry32(5);
  private muzzle = new THREE.Vector3();

  constructor(readonly w: Weapon, camera: THREE.Camera, private projectiles: Projectiles) {
    this.state = new AutoWeaponState({ fireRate: w.fireRate, magazine: w.magazine, reloadTime: w.reloadTime });
    this.view = new SynapseBursterView(camera);
  }

  get egoReady(): boolean { return this.ego >= this.w.egoCharge.chargeToFire; }
  get egoFraction(): number { return Math.min(1, this.ego / this.w.egoCharge.chargeToFire); }

  /** Credit Ego Charge for a landed spore. */
  credit(weakPoint: boolean): void {
    const e = this.w.egoCharge;
    this.ego = Math.min(e.chargeToFire, this.ego + (weakPoint ? e.chargePerWeakPointHit : e.chargePerHit));
  }

  spreadRadians(moving: boolean): number {
    const s = this.w.spread;
    const base = THREE.MathUtils.lerp(s.hip, s.ads, this.aim);
    return base * (moving ? s.movingPenalty : 1) * DEG;
  }

  private dirTo(target: THREE.Vector3, spread: number): THREE.Vector3 {
    const dir = target.clone().sub(this.muzzle).normalize();
    // Uniform cone jitter.
    const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * spread;
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, up).normalize();
    const v = new THREE.Vector3().crossVectors(u, dir);
    return dir.addScaledVector(u, Math.cos(a) * Math.tan(r)).addScaledVector(v, Math.sin(a) * Math.tan(r)).normalize();
  }

  /** Steps the weapon. Returns the number of spores fired (for recoil, noise and events). */
  update(dt: number, trigger: boolean, aimHeld: boolean, ctx: FireContext): { shots: number; reloaded: boolean; startedReload: boolean } {
    this.aim = THREE.MathUtils.clamp(this.aim + (aimHeld && !ctx.sprinting ? 1 : -1) * (dt / this.w.adsTime), 0, 1);
    const canFire = !(this.w.spread.sprintBlocksFire && ctx.sprinting);
    const wasReloading = this.state.isReloading;
    const r = this.state.update(dt, trigger && canFire);
    this.view.muzzle.getWorldPosition(this.muzzle);
    for (let i = 0; i < r.shots; i++) {
      const dir = this.dirTo(ctx.aimPoint, this.spreadRadians(ctx.moving));
      this.projectiles.fire('spore', 'player', this.muzzle, dir.multiplyScalar(this.w.projectileSpeed), {
        damage: this.w.damage, splashRadius: this.w.burst.radius, splashDamage: this.w.burst.damage,
        gravity: this.w.projectileGravity, life: this.w.range.maxDistance / this.w.projectileSpeed,
      });
      this.view.fired();
    }
    const startedReload = !wasReloading && this.state.isReloading;
    if (startedReload) this.view.reload(this.w.reloadTime);
    return { shots: r.shots, reloaded: r.reloaded, startedReload };
  }

  reload(): boolean {
    const ok = this.state.reload();
    if (ok) this.view.reload(this.w.reloadTime);
    return ok;
  }

  /** Releases the Ego Charge volley if ready. Caller checks and pays Overload. */
  fireEgo(aimPoint: THREE.Vector3): boolean {
    if (!this.egoReady) return false;
    const e = this.w.egoCharge;
    this.ego = 0;
    this.view.muzzle.getWorldPosition(this.muzzle);
    for (let i = 0; i < e.projectiles; i++) {
      const dir = this.dirTo(aimPoint, 9 * DEG);
      dir.y += 0.08 + this.rand() * 0.1;
      this.projectiles.fire('ego', 'player', this.muzzle, dir.normalize().multiplyScalar(e.projectileSpeed), {
        damage: e.damage, splashRadius: e.burstRadius, splashDamage: e.damage * 0.5, gravity: 0, life: 3,
        seek: { radius: e.seekRadius, turnRate: e.seekTurnRate },
      });
    }
    this.view.fired();
    return true;
  }
}
