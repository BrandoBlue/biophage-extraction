import * as THREE from 'three';
import { MODS, type WeaponSpec } from '../../../data';
import { registerWeaponView, type ModSocket, type WeaponFrame, type WeaponModel } from '../../game/weapon-view';
import { GUN_SCALE } from '../../game/viewmodel';
import { createWeaponBody, WEAPON_BODIES, type ModSlot, type ReloadStyle, type WeaponBody, type WeaponId } from './bodies';

/**
 * The living weapon bodies (bodies.ts) in the player's hands: an adapter from Gameplay's WeaponModel contract
 * (src/game/weapon-view.ts) to a WeaponBody. The rig places and recoils `root`; the body animates inside it.
 *   fired()            the body's own flinch and chamber flare (the rig's camera kick stays the rig's)
 *   reload(style, d)   magazine and regrow run 0..1 over d; perShell opens the jaw, gulps each shellIn(), closes
 *                      when the weapon stops reloading
 *   equip / holster    the organism uncurls awake / curls up and dims
 *   spec.mods          each graft buds onto its socket when the gun is built
 */

/** Seconds a perShell reload takes to close the jaw once the last shell is in. */
const CLOSE = 0.18;

export class LivingWeaponView implements WeaponModel {
  readonly root = new THREE.Group();
  readonly muzzle: THREE.Object3D;
  readonly sight?: THREE.Object3D;
  readonly grip: THREE.Object3D;
  readonly scoped: boolean;
  readonly flashColour: string;
  readonly muzzleFx: string;
  readonly sockets: Partial<Record<ModSocket, THREE.Object3D>>;
  private sinceFire = 99;
  private reloadT: number | null = null;
  private reloadDur = 1;
  private style: ReloadStyle = 'regrow';
  private shells = 0;
  private equipT = 1;
  private equipDur = 0;
  private holsterT = 0;
  private holsterDur = 0;
  /** The rig has reported this reload in progress (so a stop means it finished or was cancelled). */
  private seen = false;

  constructor(readonly spec: WeaponSpec, readonly body: WeaponBody) {
    this.root.name = `weaponView:${spec.id}`;
    // Same hold as Gameplay's procedural stand-in: canted a little toward the eye, at the viewmodel scale.
    body.gun.rotation.set(-0.12, 0.16, -0.1);
    body.gun.scale.setScalar(GUN_SCALE);
    this.root.add(body.gun);
    this.muzzle = body.muzzle;
    this.sight = body.sight;
    this.grip = body.grip;
    this.scoped = !!spec.ads?.scope;
    this.flashColour = body.fxColour;
    this.muzzleFx = body.muzzleFx;
    this.sockets = body.sockets;
    for (const id of (spec as WeaponSpec & { mods?: string[] }).mods ?? []) {
      const slot = MODS[id]?.slot as ModSlot | undefined;
      if (slot) body.graft(slot, true, id);
    }
  }

  fired(): void {
    this.sinceFire = 0;
  }

  reload(style: ReloadStyle, duration: number): void {
    this.style = style;
    this.reloadDur = Math.max(0.05, duration);
    this.reloadT = 0;
    this.shells = 0;
    this.seen = false;
  }

  shellIn(): void {
    this.shells++;
  }

  equip(duration: number): void {
    this.equipDur = Math.max(0.01, duration);
    this.equipT = 0;
    this.holsterT = 0;
  }

  holster(duration: number): void {
    this.holsterDur = Math.max(0.01, duration);
    this.holsterT = 0.0001;
  }

  /** Reload progress 0..1 handed to the body, or null. */
  private progress(dt: number, reloading: boolean): number | null {
    if (this.reloadT === null) return null;
    if (reloading) this.seen = true;
    const stopped = this.seen && !reloading;
    if (this.style === 'perShell') {
      // The jaw opens over the first shell's time and holds open while shells feed; it closes once feeding stops.
      this.reloadT = stopped ? Math.max(this.reloadT, 0.85) + (dt / CLOSE) * 0.15 : Math.min(0.85, this.reloadT + dt / this.reloadDur);
    } else {
      this.reloadT += dt / this.reloadDur;
      if (stopped) this.reloadT = 1; // cancelled (weapon swapped, host died)
    }
    if (this.reloadT >= 1) { this.reloadT = null; this.seen = false; }
    return this.reloadT;
  }

  update(dt: number, f: WeaponFrame): void {
    this.sinceFire += dt;
    if (this.equipT < 1) this.equipT = Math.min(1, this.equipT + dt / this.equipDur);
    if (this.holsterT > 0) this.holsterT = Math.min(1, this.holsterT + dt / this.holsterDur);
    const reload = this.progress(dt, f.reloading);
    this.body.animate(dt, {
      reload, style: this.style, aim: f.aim, sinceFire: this.sinceFire, ammo: f.ammoFrac, shells: this.shells,
      equip: this.equipT, holster: this.holsterT,
    });
  }
}

/** Register a living body for every roster weapon that has one (the rest keep Gameplay's procedural stand-in). */
export function registerLivingWeapons(): void {
  for (const id of WEAPON_BODIES) registerWeaponView(id, (spec) => new LivingWeaponView(spec, createWeaponBody(id as WeaponId)));
}

registerLivingWeapons();
