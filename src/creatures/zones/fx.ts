import * as THREE from 'three';
import { FAUNA } from '../../render/palette';

/**
 * Ground effects for the new-zone creatures: sand ripples racing ahead of a buried Dunewake, dust thrown up when
 * something breaks the surface, and rings on the water where a Fenstalker waits. One small pool of meshes per
 * creature, world-locked inside the creature's root (the group cancels the root's transform), so the effects stay
 * where they were made while the creature moves on and are removed with it. Shared geometry and one material per
 * kind keep the programs and draw cost flat.
 */

const mats = new Map<string, THREE.MeshStandardMaterial>();
function fxMat(kind: 'sand' | 'dust' | 'water' | 'spray'): THREE.MeshStandardMaterial {
  let m = mats.get(kind);
  if (!m) {
    m = kind === 'sand'
      ? new THREE.MeshStandardMaterial({ color: FAUNA.sandDeep, roughness: 1 })
      : kind === 'dust'
        ? new THREE.MeshStandardMaterial({ color: FAUNA.dustPale, roughness: 1, transparent: true, opacity: 0.34, depthWrite: false })
        : kind === 'spray'
          ? new THREE.MeshStandardMaterial({ color: FAUNA.pearl, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false })
          : new THREE.MeshStandardMaterial({ color: FAUNA.water, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.4, depthWrite: false });
    mats.set(kind, m);
  }
  return m;
}
let moundGeo: THREE.BufferGeometry | null = null;
let puffGeo: THREE.BufferGeometry | null = null;
let ringGeo: THREE.BufferGeometry | null = null;

interface Bit { mesh: THREE.Mesh; age: number; life: number; v: THREE.Vector3; size: number; kind: 'mound' | 'puff' | 'ring' | 'spray' }

export class GroundFx {
  readonly group = new THREE.Group();
  private bits: Bit[] = [];
  private inv = new THREE.Matrix4();

  constructor(private owner: THREE.Object3D, kinds: { mounds?: number; puffs?: number; rings?: number; sprays?: number }) {
    this.group.name = 'zone-fx';
    this.group.matrixAutoUpdate = false;
    moundGeo ??= new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    // Soft, smooth blobs: faceted shards read as rocks, not dust or water.
    puffGeo ??= new THREE.SphereGeometry(1, 10, 7);
    ringGeo ??= new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2);
    const add = (n: number, kind: Bit['kind'], geo: THREE.BufferGeometry, mat: THREE.Material) => {
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.bits.push({ mesh, age: 1, life: 1, v: new THREE.Vector3(), size: 1, kind });
      }
    };
    add(kinds.mounds ?? 0, 'mound', moundGeo, fxMat('sand'));
    add(kinds.puffs ?? 0, 'puff', puffGeo, fxMat('dust'));
    add(kinds.rings ?? 0, 'ring', ringGeo, fxMat('water'));
    add(kinds.sprays ?? 0, 'spray', puffGeo, fxMat('spray'));
    owner.add(this.group);
  }

  private take(kind: Bit['kind']): Bit | null {
    let best: Bit | null = null;
    for (const b of this.bits) if (b.kind === kind && (!best || b.age / b.life > best.age / best.life)) best = b;
    return best;
  }

  /** A low sand swell at a world point (the ripple tell): rises fast, settles slowly. */
  mound(at: THREE.Vector3, size: number, yaw = 0, life = 1.3): void {
    const b = this.take('mound');
    if (!b) return;
    b.age = 0; b.life = life; b.size = size;
    b.mesh.position.copy(at);
    b.mesh.rotation.set(0, yaw, 0);
    b.mesh.visible = true;
  }

  /** Dust thrown up and drifting down. */
  puff(at: THREE.Vector3, size: number, up = 2, life = 1.1): void { this.throw('puff', at, size, up, life); }

  /** Water thrown up when something bursts out of a pool or slams into it. */
  spray(at: THREE.Vector3, size: number, up = 3, life = 0.9): void { this.throw('spray', at, size, up, life); }

  private throw(kind: 'puff' | 'spray', at: THREE.Vector3, size: number, up: number, life: number): void {
    const b = this.take(kind);
    if (!b) return;
    b.age = 0; b.life = life; b.size = size;
    b.mesh.position.copy(at);
    b.v.set((Math.random() - 0.5) * 1.6, up * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 1.6);
    b.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    b.mesh.visible = true;
  }

  /** An expanding ring on still water. */
  ring(at: THREE.Vector3, size: number, life = 1.6): void {
    const b = this.take('ring');
    if (!b) return;
    b.age = 0; b.life = life; b.size = size;
    b.mesh.position.copy(at);
    b.mesh.visible = true;
  }

  update(dt: number): void {
    // Cancel the owner's transform so children are placed in world space.
    this.owner.updateWorldMatrix(true, false);
    this.inv.copy(this.owner.matrixWorld).invert();
    this.group.matrix.copy(this.inv);
    this.group.matrixWorldNeedsUpdate = true;
    for (const b of this.bits) {
      if (!b.mesh.visible) continue;
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) { b.mesh.visible = false; continue; }
      if (b.kind === 'mound') {
        const rise = Math.min(1, k * 6), settle = 1 - k;
        b.mesh.scale.set(b.size * (0.7 + k * 0.6), b.size * 0.22 * rise * settle, b.size * (1.2 + k * 0.5));
      } else if (b.kind === 'puff' || b.kind === 'spray') {
        b.v.y -= (b.kind === 'spray' ? 9 : 2.5) * dt;
        b.v.multiplyScalar(1 - dt * 1.5);
        b.mesh.position.addScaledVector(b.v, dt);
        const s = b.size * (0.5 + k * 1.4) * (1 - k * k);
        b.mesh.scale.setScalar(Math.max(0.001, s));
      } else {
        b.mesh.scale.setScalar(b.size * (0.3 + k * 1.4));
      }
    }
  }

  get active(): number { return this.bits.filter((b) => b.mesh.visible).length; }
}

export const smooth = (t: number): number => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
export const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));
