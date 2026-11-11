/**
 * The camera-side weapon rig (Gameplay): places whatever weapon model is held in front of the camera, sways it
 * against look, bobs it with the stride, kicks it on each shot, lowers it for sprinting, swings it up on equip and
 * slides it to the eye line when aiming down sights. It also owns the lights that travel with the held weapon
 * (one muzzle flash light and a soft key and rim) so swapping weapons never changes the scene's light count.
 *
 * Models only animate inside their own root (src/game/weapon-view.ts).
 */
import * as THREE from 'three';
import { HIVE, ORGANIC } from '../render/palette';
import { DEFAULT_KICK, type KickProfile, type WeaponFrame, type WeaponModel } from './weapon-view';

/** Rig motion. Rendering may retune any of these. */
export const RIG = {
  hip: new THREE.Vector3(0.27, -0.225, -0.47),
  /** Distance in front of the eye the sight sits at full aim. */
  adsDepth: 0.3,
  sprint: { rx: -0.28, ry: 0.55, px: -0.04, py: -0.04 },
  /** Equip: the weapon comes up from below and rolls in. */
  equipDrop: 0.32,
  /** Recoil is a spring: each shot adds velocity; it settles with a small overshoot (stiffness, damping). */
  kickImpulse: 9,
  kickMax: 1.4,
  kickSpring: { stiffness: 220, damping: 14 },
  /** Reloads dip the weapon (m) and roll it toward the host (rad). */
  reloadDip: 0.12,
  reloadRoll: 0.35,
  flash: { intensity: 3.5, life: 0.06 },
};

export interface RigMotion { yaw: number; pitch: number; speed: number; sprinting: boolean; grounded: boolean }

export class WeaponRig {
  readonly root = new THREE.Group();
  private holder = new THREE.Group();
  private model: WeaponModel | null = null;
  private kick = 0;
  private kickVel = 0;
  /** The held weapon's last kick profile (scales the spring's pitch, push-back and roll). */
  private kickShape: KickProfile = DEFAULT_KICK;
  /** A swap in progress: the old weapon goes down first, then `next` comes up. */
  private next: { model: WeaponModel; equipTime: number } | null = null;
  private holsterT = 0;
  private holsterDur = 1;
  private dip = 0;
  private sway = new THREE.Vector2();
  private lastYaw = 0;
  private lastPitch = 0;
  private time = 0;
  private equipT = 0;
  private equipDur = 1;
  private flashLight: THREE.PointLight;
  private flashLife = 0;
  private sightLocal = new THREE.Vector3();
  /** Models kept visible for their first frames so their shaders compile before the first swap. */
  private warm = new Set<WeaponModel>();

  constructor(camera: THREE.Camera) {
    this.root.add(this.holder);
    this.root.position.copy(RIG.hip);
    // A cool mist key and a warm bone rim that travel with the gun, so its form reads in dark corners of the raid
    // as lit flesh rather than a pink glow. The flash light always exists (intensity 0 at rest) so firing never
    // changes the light count and never recompiles shaders.
    const key = new THREE.PointLight(ORGANIC.mist, 0.35, 1.2, 2);
    key.position.set(-0.25, 0.25, 0.1);
    const rimLight = new THREE.PointLight(HIVE.bone, 0.45, 1.0, 2);
    rimLight.position.set(0.3, 0.05, -0.35);
    this.flashLight = new THREE.PointLight(HIVE.acid, 0, 6, 2);
    this.flashLight.position.set(0, 0, -0.45);
    this.holder.add(key, rimLight, this.flashLight);
    camera.add(this.root);
  }

  get held(): WeaponModel | null { return this.model; }
  /** True while the equip swing is still bringing the weapon up (it cannot fire yet). */
  get equipping(): boolean { return this.equipT > 0 || this.next !== null; }

  /** Adds a model to the rig without showing it (pre-warmed for a few frames so the first swap does not hitch). */
  add(model: WeaponModel): void {
    if (model.root.parent === this.holder) return;
    this.holder.add(model.root);
    model.root.visible = true;
    this.warm.add(model);
  }

  /** Holds `model`, swinging it up over `equipTime` seconds (0: instantly). */
  /**
   * Holds `model`. With a weapon already held, it is put away first (a third of `equipTime`) and the new one
   * swings up for the rest; equipTime 0 swaps instantly.
   */
  swap(model: WeaponModel, equipTime: number): void {
    if (!this.model || equipTime <= 0) { this.equip(model, equipTime); return; }
    this.add(model);
    model.root.visible = false;
    this.holsterT = this.holsterDur = equipTime / 3;
    this.model.holster?.(this.holsterDur);
    this.next = { model, equipTime: (equipTime * 2) / 3 };
  }

  equip(model: WeaponModel, equipTime: number): void {
    this.next = null; this.holsterT = 0;
    this.add(model);
    model.root.visible = true;
    this.model = model;
    this.equipT = this.equipDur = Math.max(0, equipTime);
    if (this.equipDur === 0) this.equipDur = 1;
    model.equip?.(equipTime);
    this.flashLight.color.set(model.flashColour);
    // Sight in holder space at rest, for the ADS slide.
    this.sightLocal.set(0, 0.12, 0);
    if (model.sight) {
      model.root.updateMatrixWorld(true);
      this.sightLocal.copy(model.sight.getWorldPosition(new THREE.Vector3()));
      model.root.worldToLocal(this.sightLocal); // model roots sit at the holder's origin
    }
    for (const m of this.holder.children) if (m !== model.root && !this.isWarm(m)) m.visible = this.holderIsLight(m);
  }

  fired(kick?: KickProfile | void): void {
    if (kick) this.kickShape = kick;
    this.kickVel += RIG.kickImpulse * (1 - Math.min(1, this.kick / RIG.kickMax));
    this.flashLife = RIG.flash.life;
  }

  private isWarm(o: THREE.Object3D): boolean { for (const m of this.warm) if (m.root === o) return true; return false; }
  private holderIsLight(o: THREE.Object3D): boolean { return (o as THREE.Light).isLight === true; }

  update(dt: number, cam: RigMotion, f: WeaponFrame): void {
    this.time += dt;
    const t = this.time;
    // Pre-warmed models go hidden after two frames on screen.
    if (this.warm.size) {
      for (const m of this.warm) {
        const age = ((m.root.userData.warmFrames as number | undefined) ?? 0) + 1;
        m.root.userData.warmFrames = age;
        if (age > 2) { this.warm.delete(m); if (m !== this.model) m.root.visible = false; }
      }
    }
    const dYaw = cam.yaw - this.lastYaw, dPitch = cam.pitch - this.lastPitch;
    this.lastYaw = cam.yaw; this.lastPitch = cam.pitch;
    const steady = 1 - f.aim * 0.8;
    this.sway.x = THREE.MathUtils.damp(this.sway.x + THREE.MathUtils.clamp(dYaw, -0.1, 0.1) * 0.6 * steady, 0, 8, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y + THREE.MathUtils.clamp(dPitch, -0.1, 0.1) * 0.6 * steady, 0, 8, dt);
    // Spring recoil: back and up, then settle past rest and home.
    const { stiffness, damping } = RIG.kickSpring;
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.kickVel += (-stiffness * this.kick - damping * this.kickVel) * h;
      this.kick += this.kickVel * h;
    }
    this.dip = THREE.MathUtils.damp(this.dip, f.reloading ? 1 : 0, 9, dt);

    const bob = (cam.grounded ? Math.min(1, cam.speed / 6) : 0) * (1 - f.aim * 0.85);
    const bt = t * (cam.sprinting ? 13 : 9);
    const ks = this.kickShape;
    let rx = this.sway.y * 0.6 + this.kick * ks.pitch * (1 - f.aim * 0.5) + Math.sin(t * 1.3) * 0.006 * steady;
    let ry = this.sway.x * 0.8;
    let rz = this.kick * ks.roll;
    let px = RIG.hip.x + this.sway.x * 0.05 + Math.cos(bt * 0.5) * 0.012 * bob;
    let py = RIG.hip.y - this.sway.y * 0.05 + Math.abs(Math.sin(bt * 0.5)) * 0.014 * bob + Math.sin(t * 1.3) * 0.004 * steady;
    let pz = RIG.hip.z + this.kick * ks.back;
    py -= this.dip * RIG.reloadDip; rz += this.dip * RIG.reloadRoll; rx += this.dip * 0.12;
    if (cam.sprinting) { rx += RIG.sprint.rx; ry += RIG.sprint.ry; px += RIG.sprint.px; py += RIG.sprint.py; }

    // ADS: square the weapon up (undo the hip cant the bodies are modelled with) and slide it so the sight sits on
    // the view axis, the barrel straight ahead.
    if (f.aim > 0) {
      const a = THREE.MathUtils.smoothstep(f.aim, 0, 1);
      this.holder.rotation.set(0.12 * a, -0.16 * a, 0.1 * a);
      const sight = this.sightLocal.clone().applyEuler(this.holder.rotation);
      px = THREE.MathUtils.lerp(px, -sight.x, a);
      py = THREE.MathUtils.lerp(py, -sight.y, a);
      pz = THREE.MathUtils.lerp(pz, -RIG.adsDepth - sight.z, a);
      rx *= 1 - a * 0.7; ry *= 1 - a;
    } else this.holder.rotation.set(0, 0, 0);

    // Swap: the old weapon drops away, then the new one is drawn.
    if (this.next) {
      this.holsterT = Math.max(0, this.holsterT - dt);
      const k = THREE.MathUtils.smoothstep(1 - this.holsterT / this.holsterDur, 0, 1);
      py -= k * RIG.equipDrop; rx -= k * 0.6; rz += k * 0.5;
      if (this.holsterT === 0) { const n = this.next; this.equip(n.model, n.equipTime); }
    }
    // Equip: rises from below the screen with a roll.
    if (this.equipT > 0) {
      this.equipT = Math.max(0, this.equipT - dt);
      const k = 1 - THREE.MathUtils.smoothstep(1 - this.equipT / this.equipDur, 0, 1);
      py -= k * RIG.equipDrop; rx -= k * 0.6; rz += k * 0.5;
    }
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);

    if (this.model) {
      this.model.update(dt, f);
      // Scoped weapons hand over to the HUD's scope at full aim.
      this.model.root.visible = !(this.model.scoped && f.aim > 0.95);
    }
    for (const m of this.warm) if (m !== this.model) m.update(dt, { ...f, aim: 0 });

    this.flashLife = Math.max(0, this.flashLife - dt);
    this.flashLight.intensity = this.flashLife > 0 ? RIG.flash.intensity * (this.flashLife / RIG.flash.life) : 0;
  }
}
