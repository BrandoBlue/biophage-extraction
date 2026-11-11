import * as THREE from 'three';
import { climbBlocked, groundHeight, ISLAND_RADIUS, SOLIDS } from '../world/zone7';
import { footstepRadius } from './perception';
import type { HostClass, HostRules } from '../../data';

const EYE = 1.7;
const EYE_CROUCH = 1.05;
const GRAVITY = 22;
/** Body radius against World structure walls. */
const BODY_RADIUS = 0.4;
const BASE_FOV = 75;

/**
 * Movement feel constants (not balance): proposed to Game Design for data/host.json in Larva.
 * Class speeds, sprint multiplier and noise come from data.
 */
export const FEEL = { crouchMultiplier: 0.5, slideSpeed: 11, slideTime: 0.7, jumpSpeed: 7.5 };

/**
 * First-person host controller: walk, sprint, crouch, slide, jump, head bob, camera shake and knockback.
 * Collides with the island heightfield and its rim. Static props get Rapier colliders in Larva.
 */
/** Pixels; a single mousemove larger than this is a pointer-lock artefact, not a flick. */
const MAX_MOUSE_DELTA = 400;

export class Player {
  readonly velocity = new THREE.Vector3();
  /** Feet position. The camera sits on top at eye height. */
  readonly position = new THREE.Vector3();
  readonly keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  grounded = true;
  crouched = false;
  /** Set by the raid each frame (abilities, overload). */
  speedMultiplier = 1;
  /** Set by the raid each frame from the World layout (Gravity Bloom anomaly); 1 = normal gravity. */
  gravityScale = 1;
  /** Virus modifiers: sprint speed and how far footsteps carry. */
  sprintBoost = 1;
  footstepScale = 1;
  canSprint = true;
  /** Seconds since the weapon last fired; drives noise. */
  sinceFired = 99;
  enabled = true;

  private eye = EYE;
  private slideLeft = 0;
  private slideDir = new THREE.Vector3();
  private bobPhase = 0;
  private trauma = 0;
  private landDip = 0;
  private recoilPitch = 0;
  private roll = 0;
  private wasCrouchKey = false;
  private peakY = 0;
  /** Extra movement multiplier that only applies while true (e.g. applying Clot Gel). */
  slowed = 1;
  onJump: () => void = () => {};
  onLand: (fallHeight: number) => void = () => {};

  constructor(readonly camera: THREE.PerspectiveCamera, private stats: HostClass, private host: HostRules, dom: HTMLElement) {
    this.position.set(0, groundHeight(0, 0), 0);
    camera.position.set(0, this.position.y + EYE, 0);
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => dom.requestPointerLock?.());
    // Chrome's first mousemove after pointer lock engages carries minus the cursor position (issue #42), which
    // swung the camera to the sky on every click-to-play. Skip that event and drop absurd single-event jumps.
    let freshLock = false;
    document.addEventListener('pointerlockchange', () => { freshLock = document.pointerLockElement === dom; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom || !this.enabled) return;
      if (freshLock) { freshLock = false; return; }
      if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
  }

  spawn(x: number, z: number, yaw = 0): void {
    this.position.set(x, groundHeight(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  get moving(): boolean { return Math.hypot(this.velocity.x, this.velocity.z) > 0.6; }
  get sprinting(): boolean { return this.canSprint && this.keys.has('ShiftLeft') && !this.crouched && this.moving; }
  get sliding(): boolean { return this.slideLeft > 0; }

  /** Footstep audible radius this frame in metres (0 when still). */
  get footstepNoise(): number {
    if (!this.grounded) return 0;
    return this.footstepScale * footstepRadius({
      moving: this.moving, sprinting: this.sprinting, crouched: this.crouched, classNoise: this.stats.noise,
      walk: this.host.noiseRadius.footstepWalk, sprint: this.host.noiseRadius.footstepSprint,
    });
  }

  /** Eye position in world space. */
  get eyePosition(): THREE.Vector3 { return this.camera.position; }

  forward(out = new THREE.Vector3()): THREE.Vector3 { return this.camera.getWorldDirection(out); }

  addTrauma(t: number): void { this.trauma = Math.min(1, this.trauma + t); }
  kick(pitch: number): void { this.recoilPitch += pitch; }
  push(dir: THREE.Vector3, strength: number): void {
    this.velocity.addScaledVector(dir, strength);
    this.velocity.y = Math.max(this.velocity.y, strength * 0.25);
    this.grounded = false;
  }

  update(dt: number): void {
    const k = this.keys;
    const active = this.enabled;
    const f = active ? Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown')) : 0;
    const s = active ? Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft')) : 0;
    const crouchKey = active && (k.has('KeyC') || k.has('ControlLeft'));

    // Slide: crouch while sprinting on the ground.
    if (crouchKey && !this.wasCrouchKey && this.sprinting && this.grounded) {
      this.slideLeft = FEEL.slideTime;
      this.slideDir.set(this.velocity.x, 0, this.velocity.z).normalize();
      this.addTrauma(0.15);
    }
    this.wasCrouchKey = crouchKey;
    this.crouched = crouchKey;

    const sprint = active && this.canSprint && k.has('ShiftLeft') && !this.crouched && f > 0;
    let speed = this.stats.moveSpeed * this.speedMultiplier * this.slowed;
    if (sprint) speed *= this.stats.sprintMultiplier * this.sprintBoost;
    if (this.crouched) speed *= FEEL.crouchMultiplier;

    const wish = new THREE.Vector3(s, 0, -f);
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).multiplyScalar(speed);

    if (this.slideLeft > 0) {
      this.slideLeft = Math.max(0, this.slideLeft - dt);
      const t = this.slideLeft / FEEL.slideTime;
      const v = FEEL.slideSpeed * t + speed * (1 - t);
      wish.copy(this.slideDir).multiplyScalar(v);
    }

    const accel = this.grounded ? 12 : 2.5;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wish.x, accel, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wish.z, accel, dt);
    if (active && this.grounded && k.has('Space')) {
      this.velocity.y = FEEL.jumpSpeed;
      this.grounded = false;
      this.slideLeft = 0;
      this.peakY = this.position.y;
      this.onJump();
    }
    this.velocity.y -= GRAVITY * this.gravityScale * dt;

    const p = this.position;
    const prevY = p.y, prevX = p.x, prevZ = p.z;
    p.addScaledVector(this.velocity, dt);
    // Terrain cliffs (maps that set a max slope, e.g. the Marrow Pit's walls): slide along them, never up them.
    if (climbBlocked(prevY, prevX, prevZ, p.x, p.z)) {
      if (!climbBlocked(prevY, prevX, prevZ, p.x, prevZ)) { p.z = prevZ; this.velocity.z = 0; }
      else if (!climbBlocked(prevY, prevX, prevZ, prevX, p.z)) { p.x = prevX; this.velocity.x = 0; }
      else { p.x = prevX; p.z = prevZ; this.velocity.x = this.velocity.z = 0; }
    }
    // World structures: walls push the body out, decks and ramps are floors, ceilings stop a jump.
    SOLIDS.collide(p, BODY_RADIUS, this.crouched ? 1.2 : 1.8);
    const ceiling = SOLIDS.ceilingAt(p.x, p.z, prevY);
    if (p.y + 1.8 > ceiling && this.velocity.y > 0) { p.y = Math.max(prevY, ceiling - 1.8); this.velocity.y = 0; }
    const edge = ISLAND_RADIUS * 0.84;
    const r = Math.hypot(p.x, p.z);
    if (r > edge) { p.x *= edge / r; p.z *= edge / r; }
    const floor = SOLIDS.floorAt(p.x, p.z, Math.max(prevY, p.y));
    if (!this.grounded) this.peakY = Math.max(this.peakY, p.y);
    if (p.y <= floor) {
      if (!this.grounded) {
        if (this.velocity.y < -6) { this.landDip = Math.min(0.35, -this.velocity.y * 0.03); this.addTrauma(0.1); }
        this.onLand(this.peakY - floor);
      }
      p.y = floor; this.velocity.y = 0; this.grounded = true; this.peakY = floor;
    } else if (p.y > floor + 0.05 && this.velocity.y <= 0 && p.y - floor < 0.3 && this.grounded) {
      p.y = floor; // stick to slopes when walking downhill
    } else if (p.y > floor + 0.3 && this.grounded) {
      this.grounded = false;
      this.peakY = p.y;
    }

    this.sinceFired += dt;
    this.applyCamera(dt, s, sprint);
  }

  private applyCamera(dt: number, strafe: number, sprint: boolean): void {
    const targetEye = this.crouched || this.sliding ? EYE_CROUCH : EYE;
    this.eye = THREE.MathUtils.damp(this.eye, targetEye, 14, dt);
    this.landDip = THREE.MathUtils.damp(this.landDip, 0, 8, dt);

    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && !this.sliding) this.bobPhase += dt * horiz * 1.55;
    const bobAmp = this.grounded && !this.sliding ? Math.min(1, horiz / 6) : 0;
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.03 * bobAmp;

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const sx = Math.sin(t * 43.1) * shake * 0.05, sy = Math.sin(t * 37.7 + 1) * shake * 0.05, sr = Math.sin(t * 29.3 + 2) * shake * 0.04;

    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 9, dt);
    this.roll = THREE.MathUtils.damp(this.roll, -strafe * 0.018 + (this.sliding ? 0.06 : 0), 8, dt);

    const c = this.camera;
    c.position.set(this.position.x, this.position.y + this.eye + bobY - this.landDip, this.position.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    c.position.addScaledVector(right, bobX);
    c.rotation.set(THREE.MathUtils.clamp(this.pitch + this.recoilPitch, -1.55, 1.55) + sy, this.yaw + sx, this.roll + sr, 'YXZ');

    const fov = BASE_FOV + (sprint ? 6 : 0) + (this.sliding ? 9 : 0);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = THREE.MathUtils.damp(c.fov, fov, 6, dt); c.updateProjectionMatrix(); }
  }
}
