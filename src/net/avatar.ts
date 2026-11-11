/**
 * Another player's host as you see it in an online raid: Creature & Mutation's host body (src/creatures/hosts.ts)
 * moved from that player's snapshots, with a light procedural walk (bob, lean into speed, crouch), a name tag
 * and a fall when it dies. Hit spheres (head, chest, legs) are what your shots test against (PvP).
 */
import * as THREE from 'three';
import type { ClassId } from '../../data';
import { createHostBody, type HostBody } from '../creatures/hosts';
import { HIVE, ORGANIC } from '../render/palette';
import { Interp, type HostSnap, type Squad } from './protocol';
import { ONLINE_TUNING } from './tuning';

export const FLAG = { crouched: 1, sprinting: 2, alive: 4, grounded: 8, extracted: 16 } as const;

/** Body hit spheres above the feet: [height, radius, zone]. */
const SPHERES: [number, number, 'head' | 'torso' | 'limb'][] = [[1.72, 0.2, 'head'], [1.3, 0.34, 'torso'], [0.95, 0.3, 'torso'], [0.45, 0.28, 'limb']];

type Snap = HostSnap & Record<string, number>;

export class RemoteHost {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = { x: 0, z: -1 };
  yaw = 0;
  flags: number = FLAG.alive;
  visibility = 1;
  biomass = 0;
  /** Footstep noise radius in its last snapshot (creatures on the leader's machine hear it). */
  footsteps = 0;
  private body: HostBody | null = null;
  private tag: THREE.Sprite;
  private snaps = new Interp<Snap>(['yaw', 'pitch'], ['f']);
  private phase = 0;
  private fallen = 0;
  private spheres = SPHERES.map(([h, r, zone]) => ({ h, r, zone, world: new THREE.Vector3() }));

  constructor(readonly id: string, public name: string, public cls: string, public squad: Squad, friendly: boolean) {
    this.root.name = `remote-host:${id}`;
    this.setBody(cls);
    this.tag = nameTag(name, friendly);
    this.tag.position.y = 2.35;
    this.root.add(this.tag);
    this.root.visible = false; // until its first snapshot
  }

  get alive(): boolean { return (this.flags & FLAG.alive) !== 0 && (this.flags & FLAG.extracted) === 0; }
  get present(): boolean { return this.root.visible && (this.flags & FLAG.extracted) === 0; }

  setBody(cls: string): void {
    if (this.body && this.cls === cls) return;
    if (this.body) this.root.remove(this.body.root);
    this.cls = cls;
    const ok = cls === 'venomWraith' || cls === 'neuroInfiltrator' || cls === 'goreBehemoth';
    this.body = createHostBody((ok ? cls : 'neuroInfiltrator') as ClassId);
    this.root.add(this.body.root);
  }

  retag(name: string, friendly: boolean): void {
    this.name = name;
    this.root.remove(this.tag);
    disposeTag(this.tag);
    this.tag = nameTag(name, friendly);
    this.tag.position.y = 2.35;
    this.root.add(this.tag);
  }

  push(now: number, s: HostSnap): void { this.snaps.push(now, s as Snap); }

  /** Plays back the snapshot from the interpolation delay ago and animates the body. */
  update(now: number, dt: number): void {
    const s = this.snaps.at(now - ONLINE_TUNING.interpDelay);
    if (!s) return;
    this.root.visible = (s.f & FLAG.extracted) === 0;
    this.flags = s.f;
    this.visibility = s.vis;
    this.biomass = s.hp;
    this.footsteps = s.ns;
    this.position.set(s.x, s.y, s.z);
    this.velocity.set(s.vx, 0, s.vz);
    this.yaw = s.yaw;
    this.forward.x = -Math.sin(s.yaw); this.forward.z = -Math.cos(s.yaw);
    this.root.position.copy(this.position);
    // Hosts face -Z in first person; the body model faces +Z.
    this.root.rotation.y = s.yaw + Math.PI;
    const body = this.body!.root;
    const speed = Math.hypot(s.vx, s.vz);
    if (this.alive) {
      this.fallen = Math.max(0, this.fallen - dt * 2);
      this.phase += dt * (2 + speed * 1.6);
      const crouch = s.f & FLAG.crouched ? 0.78 : 1;
      body.scale.set(1, crouch, 1);
      body.position.y = Math.abs(Math.sin(this.phase)) * Math.min(0.08, speed * 0.012);
      body.rotation.x = Math.min(0.28, speed * 0.03) + (s.f & FLAG.sprinting ? 0.08 : 0);
      body.rotation.z = Math.sin(this.phase) * Math.min(0.06, speed * 0.008);
    } else {
      // Down: the body folds over onto its side and settles.
      this.fallen = Math.min(1, this.fallen + dt * 1.5);
      const k = 1 - Math.pow(1 - this.fallen, 3);
      body.rotation.set(0, 0, k * (Math.PI / 2) * 0.96);
      body.position.y = k * 0.25;
      body.scale.set(1, 1, 1);
    }
    this.tag.visible = this.alive;
    this.body!.update(dt);
    const crouch = s.f & FLAG.crouched ? 0.78 : 1;
    for (const sp of this.spheres) sp.world.set(s.x, s.y + sp.h * crouch, s.z);
  }

  /** The nearest of this body's spheres a swept segment strikes, as a fraction along it. */
  hit(a: THREE.Vector3, b: THREE.Vector3, test: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) => number | null): { t: number; zone: 'head' | 'torso' | 'limb' } | null {
    if (!this.alive || !this.root.visible) return null;
    let best: { t: number; zone: 'head' | 'torso' | 'limb' } | null = null;
    for (const sp of this.spheres) {
      const t = test(a, b, sp.world, sp.r);
      if (t !== null && (!best || t < best.t)) best = { t, zone: sp.zone };
    }
    return best;
  }

  dispose(): void { this.root.removeFromParent(); disposeTag(this.tag); }
}

function nameTag(text: string, friendly: boolean): THREE.Sprite {
  const c = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (!c) return new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.font = '600 46px Manrope, "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = HIVE.background;
    g.shadowBlur = 10;
    g.fillStyle = friendly ? HIVE.bone : HIVE.danger;
    g.fillText(text.slice(0, 18), 256, 40);
    g.fillStyle = friendly ? ORGANIC.amber : HIVE.danger;
    g.fillRect(256 - 60, 78, 120, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 10;
  return s;
}

function disposeTag(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}
