import * as THREE from 'three';
import { bioTime } from '../render/materials';
import type { Collider, CollisionWorld } from './collision';

/**
 * Living props (World & Level): the physical life inside buildings. Brandon, 2026-11-12: "actual buildings, organic,
 * with physics and things inside, not basic".
 *
 *  - sway:  something hanging from a ceiling or beam (a sac, a membrane, a cocoon). Damped pendulum: drifts in the
 *           air, swings away when a host brushes it, jerks when shot or caught in a blast.
 *  - flap:  a membrane curtain in a doorway, two halves on side hinges. Parts as a host walks up, sags shut after.
 *  - tip:   a free-standing urn or egg on the floor. Topples away from a host who walks into it; breaks when shot.
 *  - break: something fragile (a growth tank, a cluster of eggs). Shot or blasted, it bursts into falling shards.
 *
 * Pure presentation: none of these collide (walls do), so they never trap a body or block a doorway. The zone ticks
 * them once per frame from the camera (`tick`), and Gameplay's shot and explosion events feed `shot` and `blast`
 * (main.ts wires the raid bus). Only props within ACTIVE_RANGE of the camera are simulated.
 */

export type LifeKind = 'sway' | 'flap' | 'tip' | 'break';

export const ACTIVE_RANGE = 45;

/** Every LivingProps built since the last `clearLife()` (zones clear it when they reset SOLIDS). */
const ALL = new Set<LivingProps>();
export function clearLife(): void { ALL.clear(); }
/** A shot fired from `origin` along `dir` (unit): the nearest prop it reaches takes the hit. */
export function lifeShot(origin: THREE.Vector3, dir: THREE.Vector3, range = 120): boolean {
  let hit = false;
  for (const l of ALL) if (l.shot(origin, dir, range)) hit = true;
  return hit;
}
/** An explosion at `at`: props within `radius` are thrown or broken. */
export function lifeBlast(at: THREE.Vector3, radius: number): void { for (const l of ALL) l.blast(at, radius); }
const GRAVITY = 9.8;

interface Base {
  kind: LifeKind;
  /** Pivot (sway: the hanging point; flap: doorway centre at the floor; tip/break: base centre). */
  at: THREE.Vector3;
  /** Body radius for touches and shots (m). */
  r: number;
  /** Height of the body (m): hanging length for sway, doorway height for flap. */
  h: number;
  root: THREE.Object3D;
}
interface Sway extends Base { kind: 'sway'; ax: number; az: number; vx: number; vz: number; seed: number }
interface Flap extends Base { kind: 'flap'; left: THREE.Object3D; right: THREE.Object3D; open: number; yaw: number; width: number }
interface Tip extends Base { kind: 'tip'; fallen: number; dirX: number; dirZ: number; broken: boolean; shards?: Shards }
interface Break extends Base { kind: 'break'; broken: boolean; shards?: Shards; collider?: Collider }
type Prop = Sway | Flap | Tip | Break;

interface Shards { mesh: THREE.InstancedMesh; pos: Float32Array; vel: Float32Array; rot: Float32Array; floor: number; t: number }

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

export class LivingProps {
  readonly group = new THREE.Group();
  private props: Prop[] = [];
  private last = -1;
  private camera = new THREE.Vector3(1e6, 0, 1e6);
  private camPrev = new THREE.Vector3(1e6, 0, 1e6);
  private shardGeo = new THREE.TetrahedronGeometry(0.12, 0);

  constructor(private readonly solids?: CollisionWorld) {
    this.group.name = 'living-props';
    ALL.add(this);
    // A one-triangle mesh that is never culled ticks the props once per rendered frame with the real camera.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1e4, 0, 0, -1e4, 0, 0, -1e4, 0], 3));
    const ticker = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    ticker.frustumCulled = false;
    ticker.name = 'living-props-ticker';
    ticker.onBeforeRender = (_r, _s, cam) => this.tick(cam.position);
    this.group.add(ticker);
  }

  private adopt(o: THREE.Object3D): void {
    o.traverse((c) => { c.userData.noOrganic = true; });
    this.group.add(o);
  }

  get count(): number { return this.props.length; }
  list(kind?: LifeKind): readonly Prop[] { return kind ? this.props.filter((p) => p.kind === kind) : this.props; }

  /** A body hanging from `at` (its mesh hangs down from its origin). */
  sway(mesh: THREE.Object3D, at: THREE.Vector3, length: number, r: number): void {
    mesh.position.copy(at);
    this.adopt(mesh);
    this.props.push({ kind: 'sway', at: at.clone(), r, h: length, root: mesh, ax: 0, az: 0, vx: 0, vz: 0, seed: this.props.length * 1.37 });
  }

  /** A doorway curtain: two halves (each modelled hinged at its own origin, hanging into +X / -X) across `width`. */
  flap(left: THREE.Object3D, right: THREE.Object3D, at: THREE.Vector3, yaw: number, width: number, height: number): void {
    const root = new THREE.Group();
    root.position.copy(at);
    root.rotation.y = yaw;
    left.position.set(-width / 2, 0, 0);
    right.position.set(width / 2, 0, 0);
    root.add(left, right);
    this.adopt(root);
    this.props.push({ kind: 'flap', at: at.clone(), r: width / 2, h: height, root, left, right, open: 0, yaw, width });
  }

  /** A free-standing pot or egg (origin at its base). */
  tip(mesh: THREE.Object3D, at: THREE.Vector3, r: number, h: number): void {
    mesh.position.copy(at);
    this.adopt(mesh);
    this.props.push({ kind: 'tip', at: at.clone(), r, h, root: mesh, fallen: 0, dirX: 1, dirZ: 0, broken: false });
  }

  /** Something fragile (origin at its base) that bursts when shot; its collider, if any, drops when it does. */
  fragile(mesh: THREE.Object3D, at: THREE.Vector3, r: number, h: number, collider?: Collider): void {
    mesh.position.copy(at);
    this.adopt(mesh);
    this.props.push({ kind: 'break', at: at.clone(), r, h, root: mesh, broken: false, collider });
  }

  /** A shot along a ray: the first prop it passes through (and that no wall hides) takes the hit. Returns it. */
  shot(origin: THREE.Vector3, dir: THREE.Vector3, range = 120, force = 1): Prop | null {
    let best: Prop | null = null, bt = range;
    const c = new THREE.Vector3();
    for (const p of this.props) {
      if ((p.kind === 'break' || p.kind === 'tip') && p.broken) continue;
      centre(p, c);
      const t = c.clone().sub(origin).dot(dir);
      if (t < 0 || t > bt) continue;
      const d = c.clone().sub(origin).addScaledVector(dir, -t).length();
      if (d > p.r + (p.kind === 'flap' ? 0 : 0.1)) continue;
      if (this.solids && this.solids.blocked(origin, origin.clone().addScaledVector(dir, t - p.r)) !== null) continue;
      best = p; bt = t;
    }
    if (best) this.hit(best, dir, force);
    return best;
  }

  /** An explosion: everything within `radius` is thrown or broken. */
  blast(at: THREE.Vector3, radius: number): void {
    const c = new THREE.Vector3();
    for (const p of this.props) {
      centre(p, c);
      const d = c.distanceTo(at);
      if (d > radius) continue;
      const dir = c.clone().sub(at).setY(0.2).normalize();
      this.hit(p, dir, 2.5 * (1 - d / radius) + 0.5);
    }
  }

  private hit(p: Prop, dir: THREE.Vector3, force: number): void {
    if (p.kind === 'sway') { p.vx += dir.x * 2.2 * force; p.vz += dir.z * 2.2 * force; }
    else if (p.kind === 'flap') p.open = Math.min(1, p.open + 0.6 * force);
    else if (p.kind === 'tip' || p.kind === 'break') this.shatter(p, dir);
  }

  private shatter(p: Tip | Break, dir: THREE.Vector3): void {
    p.broken = true;
    p.root.visible = false;
    // A zero-height collider never blocks or holds anything up.
    if (p.kind === 'break' && p.collider) p.collider.y1 = p.collider.y0;
    const n = 14;
    const mat = firstMaterial(p.root);
    const mesh = new THREE.InstancedMesh(this.shardGeo, mat, n);
    mesh.name = 'living-shards';
    mesh.frustumCulled = false;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), rot = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, up = 0.3 + (i % 5) * 0.15;
      pos.set([p.at.x + Math.cos(a) * p.r * 0.5, p.at.y + p.h * (0.2 + (i % 4) * 0.2), p.at.z + Math.sin(a) * p.r * 0.5], i * 3);
      vel.set([Math.cos(a) * 1.6 + dir.x * 2.5, 2 + up * 3, Math.sin(a) * 1.6 + dir.z * 2.5], i * 3);
      rot.set([a, a * 1.7, a * 0.3], i * 3);
    }
    p.shards = { mesh, pos, vel, rot, floor: p.at.y, t: 0 };
    this.group.add(mesh);
    this.stepShards(p.shards, 0);
  }

  private stepShards(s: Shards, dt: number): void {
    s.t += dt;
    const n = s.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (s.pos[o + 1] > s.floor + 0.04 || s.vel[o + 1] > 0) {
        s.vel[o + 1] -= GRAVITY * dt;
        s.pos[o] += s.vel[o] * dt; s.pos[o + 1] += s.vel[o + 1] * dt; s.pos[o + 2] += s.vel[o + 2] * dt;
        s.rot[o] += dt * 6; s.rot[o + 2] += dt * 4;
        if (s.pos[o + 1] < s.floor + 0.04) { s.pos[o + 1] = s.floor + 0.04; s.vel[o] *= 0.3; s.vel[o + 2] *= 0.3; s.vel[o + 1] = 0; }
      }
      const k = 0.6 + (i % 3) * 0.5;
      s.mesh.setMatrixAt(i, tmpM.compose(tmpP.set(s.pos[o], s.pos[o + 1], s.pos[o + 2]), tmpQ.setFromEuler(tmpE.set(s.rot[o], s.rot[o + 1], s.rot[o + 2])), tmpS.set(k, k * 0.6, k)));
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Advance every nearby prop to the current time (called once per rendered frame; extra calls do nothing). */
  tick(camera: THREE.Vector3): void {
    const now = bioTime.value;
    if (now === this.last) return;
    const dt = this.last < 0 ? 0 : Math.min(0.05, Math.max(0, now - this.last));
    this.last = now;
    this.camPrev.copy(this.camera);
    this.camera.copy(camera);
    this.step(dt, camera);
  }

  /** One simulation step with the host's eye at `eye` (tests call this directly). */
  step(dt: number, eye: THREE.Vector3): void {
    const feet = eye.y - 1.7;
    for (const p of this.props) {
      const dx = p.at.x - eye.x, dz = p.at.z - eye.z, d = Math.hypot(dx, dz);
      if (d > ACTIVE_RANGE) continue;
      if (p.kind === 'sway') {
        // Brushed: a host's body (feet to head) overlapping the hanging body pushes it away.
        const bottom = p.at.y - p.h, touch = d < p.r + 0.45 && eye.y + 0.2 > bottom && feet < p.at.y;
        if (touch && d > 1e-3) { p.vx += (dx / d) * 3 * dt * 10; p.vz += (dz / d) * 3 * dt * 10; }
        // Drift in the air, spring back, damp.
        const wind = Math.sin(bioTime.value * 0.7 + p.seed) * 0.02;
        p.vx += (-p.ax * 9 + wind) * dt; p.vz += (-p.az * 9 + wind * 0.6) * dt;
        p.vx *= Math.exp(-1.6 * dt); p.vz *= Math.exp(-1.6 * dt);
        p.ax = clamp(p.ax + p.vx * dt, -0.9, 0.9); p.az = clamp(p.az + p.vz * dt, -0.9, 0.9);
        p.root.rotation.set(p.az, 0, -p.ax);
      } else if (p.kind === 'flap') {
        // Parts while a host stands within 2.2 m of the doorway, sags shut after.
        const want = d < 2.2 && Math.abs(feet - p.at.y) < 2 ? 1 : 0;
        p.open += (want - p.open) * Math.min(1, dt * (want ? 6 : 1.2));
        const a = p.open * 1.35 + Math.sin(bioTime.value * 1.3 + p.at.x) * 0.03;
        p.left.rotation.y = a; p.right.rotation.y = -a;
      } else if (p.kind === 'tip') {
        if (p.broken) { if (p.shards && p.shards.t < 3) this.stepShards(p.shards, dt); continue; }
        if (p.fallen === 0 && d < p.r + 0.45 && feet < p.at.y + p.h && d > 1e-3) { p.fallen = 1e-3; p.dirX = dx / d; p.dirZ = dz / d; }
        if (p.fallen > 0 && p.fallen < 1) {
          p.fallen = Math.min(1, p.fallen + dt * (0.6 + p.fallen * 4));
          const ang = easeOutBounce(p.fallen) * 1.45;
          // Topple about the edge of its base, away from the host.
          tmpQ.setFromAxisAngle(tmpP.set(p.dirZ, 0, -p.dirX), ang);
          p.root.quaternion.copy(tmpQ);
          p.root.position.set(p.at.x + p.dirX * p.r * Math.sin(ang) * 0.9, p.at.y + p.r * 0.3 * Math.sin(ang), p.at.z + p.dirZ * p.r * Math.sin(ang) * 0.9);
        }
      } else if (p.kind === 'break') {
        if (p.broken && p.shards && p.shards.t < 3) this.stepShards(p.shards, dt);
      }
    }
  }
}

function centre(p: Prop, out: THREE.Vector3): THREE.Vector3 {
  if (p.kind === 'sway') return out.set(p.at.x + Math.sin(p.ax) * p.h * 0.5, p.at.y - p.h * 0.6, p.at.z + Math.sin(p.az) * p.h * 0.5);
  return out.set(p.at.x, p.at.y + p.h * 0.5, p.at.z);
}

function firstMaterial(o: THREE.Object3D): THREE.Material {
  let m: THREE.Material | null = null;
  o.traverse((c) => { if (!m && (c as THREE.Mesh).isMesh) { const mm = (c as THREE.Mesh).material; m = Array.isArray(mm) ? mm[0] : mm; } });
  return m ?? new THREE.MeshStandardMaterial();
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function easeOutBounce(t: number): number {
  if (t < 0.7) return (t / 0.7) ** 2;
  const u = (t - 0.85) / 0.15;
  return 1 - 0.06 * (1 - u * u);
}
