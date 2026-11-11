import * as THREE from 'three';
import { groundHeight, ISLAND_RADIUS } from '../world/zone7';

export interface HostStats { moveSpeed: number; sprintMultiplier: number }

const EYE = 1.7;
const GRAVITY = 22;

/** Minimal first-person host controller. Gameplay Engineering replaces this with the Rapier controller. */
export class Player {
  readonly velocity = new THREE.Vector3();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private grounded = true;

  constructor(readonly camera: THREE.PerspectiveCamera, private stats: HostStats, dom: HTMLElement) {
    camera.position.set(0, groundHeight(0, 0) + EYE, 0);
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('click', () => dom.requestPointerLock?.());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.5, 1.5);
    });
  }

  get sprinting(): boolean { return this.keys.has('ShiftLeft') && this.velocity.lengthSq() > 1; }

  update(dt: number): void {
    const f = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const s = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const speed = this.stats.moveSpeed * (this.keys.has('ShiftLeft') ? this.stats.sprintMultiplier : 1);
    const dir = new THREE.Vector3(s, 0, -f);
    if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw).multiplyScalar(speed);
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, dir.x, 12, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, dir.z, 12, dt);
    if (this.grounded && this.keys.has('Space')) { this.velocity.y = 7.5; this.grounded = false; }
    this.velocity.y -= GRAVITY * dt;

    const p = this.camera.position;
    p.addScaledVector(this.velocity, dt);
    const edge = ISLAND_RADIUS * 0.84;
    const r = Math.hypot(p.x, p.z);
    if (r > edge) { p.x *= edge / r; p.z *= edge / r; }
    const floor = groundHeight(p.x, p.z) + EYE;
    if (p.y <= floor) { p.y = floor; this.velocity.y = 0; this.grounded = true; }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
