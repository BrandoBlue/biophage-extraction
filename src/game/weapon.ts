import * as THREE from 'three';
import { HIVE, ORGANIC, ZONE7 } from '../render/palette';
import { WEAPON_FEEL, type FireFeel, type ProjectileLook, type WeaponSpec } from '../../data';
import { mulberry32 } from '../world/zone7';
import { getSettings } from '../ui/settings';

/** Settings eyeScope (UI adds it; on unless turned off), cached and refreshed when Settings change. */
let eyeScopeOn = (getSettings() as { eyeScope?: boolean }).eyeScope !== false;
if (typeof addEventListener === 'function') addEventListener('biophage:settings', () => { eyeScopeOn = (getSettings() as { eyeScope?: boolean }).eyeScope !== false; });
/** Test hook: force the eyeScope setting. */
export const setEyeScopeForTest = (on: boolean): void => { eyeScopeOn = on; };
import { AutoWeaponState, type AmmoFeed } from './weapon-state';
import type { Projectiles, ProjectileKind } from './projectiles';
import type { KickProfile, WeaponModel } from './weapon-view';
import { boltLook } from '../render/shotfx';
import { registerWeaponView } from './weapon-view';
import { SynapseBursterView } from './viewmodel';

import { STARTER_WEAPON } from './arsenal';
export { STARTER_WEAPON };
registerWeaponView(STARTER_WEAPON, () => new SynapseBursterView());

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** Glowing projectile looks, shared by the Projectiles pool. One per weapons.json `projectile.look`. */
export function projectileLooks(): Record<ProjectileKind, () => THREE.Mesh> {
  const bile = new THREE.MeshBasicMaterial({ color: ZONE7.lime, toneMapped: false });
  const bileGeo = new THREE.IcosahedronGeometry(0.28, 1);
  return {
    // Bolt cores, tracer tails and halos come from Rendering (src/render/shotfx.ts).
    spore: boltLook(HIVE.acid),
    needle: boltLook(ORGANIC.amber, { core: 0.03, tail: 12, width: 0.03, halo: 0.35 }),
    shard: boltLook(HIVE.bone, { core: 0.035, tail: 4, width: 0.04, halo: 0.3 }),
    glob: boltLook(ZONE7.lime, { core: 0.12, tail: 3, width: 0.1, halo: 0.9 }),
    bolt: boltLook(ZONE7.cyan, { core: 0.07, tail: 14, width: 0.08, halo: 0.8 }),
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

export interface WeaponStep {
  /** Trigger pulls that fired this step (each sends `pellets` projectiles). */
  shots: number;
  reloaded: boolean;
  startedReload: boolean;
  shellsIn: number;
  /** Charge weapons: 0..1 held charge. */
  charge: number;
  /** The model's kick for these shots, if it gives one. */
  kick: KickProfile | void;
}

/**
 * One living weapon from weapons.json (docs/gdd/03-combat.md): travelling projectiles, the weapon's fire mode,
 * pellets, reload style and ADS (or none), and the Ego Charge alt fire when the weapon has one.
 * The model is the body on screen (src/game/weapon-view.ts); the camera rig places it.
 */
export class LivingWeapon {
  readonly state: AutoWeaponState;
  ego = 0;
  /** 0..1 aim-down-sights blend. Stays 0 on weapons without ADS. */
  aim = 0;
  private rand: () => number;
  private muzzle = new THREE.Vector3();
  lastKick: KickProfile | void = undefined;

  /** Homing from a Seeker graft (mods special 'seek'). */
  private readonly seek: { radius: number; turnRate: number } | undefined;
  constructor(readonly spec: WeaponSpec, readonly model: WeaponModel, private projectiles: Projectiles, feed: AmmoFeed | null = null) {
    const sk = spec.specials.find((x) => x.id === 'seek');
    this.seek = sk ? { radius: Number(sk.radius ?? 6), turnRate: Number(sk.turnRate ?? 1.5) } : undefined;
    const s = spec;
    this.state = new AutoWeaponState({
      fireRate: s.fireRate, magazine: s.magazine, reloadTime: s.reload.time, fireMode: s.fireMode, burstCount: s.burstCount, burstDelay: s.burstDelay,
      chargeTime: s.chargeTime, minCharge: s.minCharge, reloadStyle: s.reload.style, perShellTime: s.reload.perShellTime, emptyExtra: s.reload.emptyExtra,
    }, s.ammo ? feed : null);
    this.rand = mulberry32([...s.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
  }

  get id(): string { return this.spec.id; }
  get canAim(): boolean { return this.spec.ads !== null; }
  get egoReady(): boolean { return !!this.spec.egoCharge && this.ego >= this.spec.egoCharge.chargeToFire; }
  get egoFraction(): number { return this.spec.egoCharge ? Math.min(1, this.ego / this.spec.egoCharge.chargeToFire) : 0; }

  /** Credit Ego Charge for a landed round. */
  credit(weakPoint: boolean): void {
    const e = this.spec.egoCharge;
    if (e) this.ego = Math.min(e.chargeToFire, this.ego + (weakPoint ? e.chargePerWeakPointHit : e.chargePerHit));
  }

  /**
   * The living-eye scope: only scoped marksman and sniper guns (weapon-feel.json scope.classes), and only while the
   * eyeScope setting is on. Everything else aims with a slight zoom (capped at scope.noScopeZoom) and the crosshair.
   */
  get eyeScope(): boolean {
    const sc = WEAPON_FEEL.scope;
    return !!this.spec.ads?.scope && (sc?.classes ?? ['marksman', 'sniper']).includes(this.spec.class)
      && eyeScopeOn;
  }

  /** The FOV divisor at full aim. */
  get adsZoom(): number {
    const z = this.spec.ads?.zoom ?? 1;
    return this.eyeScope ? z : Math.min(z, WEAPON_FEEL.scope?.noScopeZoom ?? 1.6);
  }

  /** Spread bloom in degrees: grows per shot (weapon-feel.json), recovers when the trigger rests. */
  bloom = 0;
  /** True while the host is moving (the crosshair opens up with the movement penalty). */
  moving = false;
  get feel(): FireFeel | undefined { return WEAPON_FEEL.fire[this.spec.class]; }

  spreadRadians(moving: boolean = this.moving): number {
    const s = this.spec.spread;
    const base = THREE.MathUtils.lerp(s.hip, s.ads, this.aim);
    return (base * (moving ? s.movingPenalty : 1) + this.bloom) * DEG;
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

  /** Steps the weapon. `ready` is false while the rig is still swinging it up after a swap. */
  update(dt: number, trigger: boolean, aimHeld: boolean, ctx: FireContext, ready = true): WeaponStep {
    const s = this.spec;
    const adsTime = s.ads?.time ?? 0.2;
    this.aim = THREE.MathUtils.clamp(this.aim + (aimHeld && this.canAim && ready && !ctx.sprinting ? 1 : -1) * (dt / adsTime), 0, 1);
    const canFire = ready && !(s.spread.sprintBlocksFire && ctx.sprinting);
    const wasReloading = this.state.isReloading;
    const r = this.state.update(dt, trigger && canFire);
    this.moving = ctx.moving;
    const f = this.feel;
    this.bloom = Math.max(0, this.bloom - (f?.bloomRecover ?? 5) * dt);
    this.model.muzzle.getWorldPosition(this.muzzle);
    const look: ProjectileLook = s.projectile.look;
    // Charge weapons scale damage with the charge reached; everything else fires at full power.
    const power = s.fireMode === 'charge' ? Math.max(r.charge, s.minCharge) : 1;
    for (let i = 0; i < r.shots; i++) {
      for (let k = 0; k < s.pellets; k++) {
        const dir = this.dirTo(ctx.aimPoint, this.spreadRadians(ctx.moving));
        // Fanned weapons (Reliquary Hymn) spread their pellets evenly across the fan, left to right.
        if (s.fanDegrees > 0 && s.pellets > 1) dir.applyAxisAngle(UP, (0.5 - k / (s.pellets - 1)) * s.fanDegrees * DEG);
        const p = s.projectile;
        this.projectiles.fire(look, 'player', this.muzzle, dir.multiplyScalar(p.speed), {
          damage: s.damage * power, splashRadius: p.splash?.radius ?? 0, splashDamage: (p.splash?.damage ?? 0) * power,
          gravity: p.gravity, life: s.range.maxDistance / p.speed, weapon: s, pierce: p.pierce,
          stick: p.stick ? { fuse: p.fuse } : undefined, seek: this.seek,
        });
      }
      this.lastKick = this.model.fired();
      // Each round opens the cone a little (less while aiming); the crosshair shows it.
      this.bloom = Math.min(f?.bloomMax ?? 2, this.bloom + (f?.bloom ?? 0.3) * (1 - this.aim * 0.6));
    }
    for (let i = 0; i < r.shellsIn; i++) this.model.shellIn?.();
    const startedReload = !wasReloading && this.state.isReloading;
    if (startedReload) this.model.reload(this.state.reloadStyle, this.reloadDuration());
    return { shots: r.shots, reloaded: r.reloaded, startedReload, shellsIn: r.shellsIn, charge: r.charge, kick: r.shots ? this.lastKick : undefined };
  }

  /** Whole reload length the view animates (perShell: one shell). */
  private reloadDuration(): number { return this.state.reloadTotal; }

  reload(): boolean {
    const ok = this.state.reload();
    if (ok) this.model.reload(this.state.reloadStyle, this.reloadDuration());
    return ok;
  }

  /** Releases the Ego Charge volley if ready. Caller checks and pays Overload. */
  fireEgo(aimPoint: THREE.Vector3): boolean {
    const e = this.spec.egoCharge;
    if (!e || !this.egoReady) return false;
    this.ego = 0;
    this.model.muzzle.getWorldPosition(this.muzzle);
    for (let i = 0; i < e.projectiles; i++) {
      const dir = this.dirTo(aimPoint, 9 * DEG);
      dir.y += 0.08 + this.rand() * 0.1;
      this.projectiles.fire('ego', 'player', this.muzzle, dir.normalize().multiplyScalar(e.projectileSpeed), {
        damage: e.damage, splashRadius: e.burstRadius, splashDamage: e.damage * 0.5, gravity: 0, life: 3,
        seek: { radius: e.seekRadius, turnRate: e.seekTurnRate },
      });
    }
    this.lastKick = this.model.fired();
    return true;
  }
}
