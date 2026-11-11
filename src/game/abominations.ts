import * as THREE from 'three';
import { HIVE, ZONE7 } from '../render/palette';
import { groundHeight, mulberry32 } from '../world/zone7';
import type { Abomination as AbominationData } from '../../data';
import { hears, sees, type Noise } from './perception';
import { organic } from './viewmodel';

/**
 * Spore's two Abominations (docs/gdd/04-abominations.md), built procedurally until Creature & Mutation ships the
 * body-plan generator (src/creatures) and PvE AI takes over behaviour (src/ai). Gameplay talks to them only through
 * this class: update(), damage(), hit spheres and callbacks in AbominationContext.
 */

export type AbominationKind = 'needlemaw' | 'bilecantor';

const COL = {
  chitin: new THREE.Color(ZONE7.violet).multiplyScalar(0.16).lerp(new THREE.Color(ZONE7.void), 0.4),
  sheen: new THREE.Color(ZONE7.magenta).multiplyScalar(0.35),
  bone: new THREE.Color(HIVE.bone),
  muscle: new THREE.Color(ZONE7.magenta).multiplyScalar(0.4).lerp(new THREE.Color(HIVE.danger), 0.3),
  cyan: new THREE.Color(ZONE7.cyan),
  magenta: new THREE.Color(ZONE7.magenta),
  lime: new THREE.Color(ZONE7.lime),
  violet: new THREE.Color(ZONE7.violet),
  void: new THREE.Color(ZONE7.void),
};

export interface HitSphere { local: THREE.Vector3; r: number; weak: boolean; world: THREE.Vector3; bone: THREE.Object3D; pustule?: number }

export interface AbominationContext {
  player: THREE.Vector3;
  playerVelocity: THREE.Vector3;
  playerAlive: boolean;
  /** Host is protected (spawn safety): creatures cannot notice it. */
  playerHidden: boolean;
  noises: Noise[];
  others: Abomination[];
  playableRadius: number;
  onAlert(a: Abomination): void;
  onMelee(a: Abomination, damage: number): void;
  onSpit(a: Abomination, from: THREE.Vector3, vel: THREE.Vector3): void;
}

type State = 'idle' | 'alert' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stagger' | 'dead';

const wet = (color: THREE.Color, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.6, sheenColor: COL.sheen, ...o });
const glowMat = (c: THREE.Color, i = 2.4) => new THREE.MeshStandardMaterial({ color: COL.void, emissive: c, emissiveIntensity: i, roughness: 0.25 });
const glass = (c: THREE.Color, opacity = 0.5) => new THREE.MeshPhysicalMaterial({
  color: c, transparent: true, opacity, roughness: 0.05, clearcoat: 1, emissive: c, emissiveIntensity: 0.35, depthWrite: false,
});

let nextId = 1;

interface Leg { hip: THREE.Group; knee: THREE.Group; phase: number }
interface Pustule { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; hp: number; popped: boolean }

export class Abomination {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hitSpheres: HitSphere[] = [];
  biomass: number;
  state: State = 'idle';
  yaw = 0;
  readonly velocity = new THREE.Vector3();
  /** Seconds left of Psych-Wave reveal (outlined and pinned on the scanner). */
  revealed = 0;
  readonly pustules: Pustule[] = [];
  private glows: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private legs: Leg[] = [];
  private needles: THREE.Group[] = [];
  private bell: THREE.Group | null = null;
  private throatMat: THREE.MeshStandardMaterial | null = null;
  private throat: THREE.Mesh | null = null;
  private tendrils: THREE.Group[] = [];
  private vocal: THREE.Mesh[] = [];
  private stateTime = 0;
  private cooldown = 0;
  private gait = 0;
  private flinch = 0;
  private recentDamage = 0;
  private wander = new THREE.Vector3();
  private lostFor = 0;
  private deadFor = 0;
  private fallV = 0;
  private hover = 0;
  private strafe = 1;
  private rand: () => number;
  readonly home: THREE.Vector3;

  constructor(readonly kind: AbominationKind, readonly t: AbominationData, x: number, z: number, seed: number) {
    this.biomass = t.biomass;
    this.rand = mulberry32(seed);
    this.home = new THREE.Vector3(x, 0, z);
    this.root.position.set(x, groundHeight(x, z), z);
    this.yaw = this.rand() * Math.PI * 2;
    this.root.add(this.body);
    if (kind === 'needlemaw') this.buildNeedlemaw(); else this.buildCantor();
    this.pickWander();
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get position(): THREE.Vector3 { return this.root.position; }
  get centre(): THREE.Vector3 { return this.hitSpheres[0].world; }
  get removable(): boolean { return this.state === 'dead' && this.deadFor > 40; }
  get engaged(): boolean { return this.state !== 'idle' && this.state !== 'dead'; }
  get radius(): number { return this.kind === 'needlemaw' ? 0.7 : 1.5; }
  get fluid(): THREE.Color { return this.kind === 'needlemaw' ? COL.cyan.clone() : COL.violet.clone().lerp(COL.magenta, 0.2); }

  private glow(c: THREE.Color, i: number): THREE.MeshStandardMaterial {
    const m = glowMat(c, i);
    this.glows.push({ mat: m, base: i });
    return m;
  }

  private sphere(bone: THREE.Object3D, local: THREE.Vector3, r: number, weak: boolean, pustule?: number): void {
    this.hitSpheres.push({ bone, local, r, weak, world: new THREE.Vector3(), pustule });
  }

  // ---------------------------------------------------------------- Needlemaw: lamprey x harvestman x comb jelly
  private buildNeedlemaw(): void {
    const r = this.rand;
    const chitin = wet(COL.chitin);
    const bone = wet(COL.bone, { roughness: 0.45, clearcoat: 0.6, sheen: 0 });
    const muscle = wet(COL.muscle, { roughness: 0.35 });
    const s = 0.9 + r() * 0.2;
    this.body.scale.setScalar(s);
    this.body.position.y = 0.75;

    // Muscular core.
    const core = new THREE.Mesh(organic(new THREE.SphereGeometry(0.28, 24, 16), 0.02, 12, r() * 10), chitin);
    core.scale.set(0.9, 0.75, 1.3);
    this.body.add(core);

    // Front: radial lamprey mouth, a fleshy funnel ringed with glassy needles.
    const head = new THREE.Group();
    head.position.set(0, 0, 0.38);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.16, 0.26, 20, 1, true), muscle);
    funnel.rotation.x = Math.PI / 2;
    funnel.position.z = 0.08;
    (funnel.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
    head.add(funnel);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.04, 10, 28), muscle);
    lip.position.z = 0.21;
    head.add(lip);
    const throatGlow = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), this.glow(COL.magenta, 3));
    throatGlow.position.z = 0.0;
    head.add(throatGlow);
    const needleMat = glass(COL.cyan, 0.75);
    for (let ring = 0; ring < 2; ring++) {
      const n = ring === 0 ? 14 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.2;
        const piv = new THREE.Group();
        const rad = ring === 0 ? 0.21 : 0.13;
        piv.position.set(Math.cos(a) * rad, Math.sin(a) * rad, 0.2 - ring * 0.07);
        piv.rotation.z = a - Math.PI / 2;
        const needle = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.2 + r() * 0.1, 5), needleMat);
        needle.rotation.x = Math.PI / 2;
        needle.position.z = 0.09;
        piv.add(needle);
        head.add(piv);
        this.needles.push(piv);
      }
    }
    // Throat sac under the mouth: the weak point, flares on wind-up.
    this.throatMat = this.glow(COL.magenta, 2.2);
    this.throat = new THREE.Mesh(organic(new THREE.SphereGeometry(0.13, 16, 12), 0.01, 20, 2), this.throatMat);
    this.throat.position.set(0, -0.2, 0.05);
    head.add(this.throat);
    this.body.add(head);

    // Back: ribbed comb-jelly bell, translucent, pulsing cyan.
    const bell = new THREE.Group();
    bell.position.set(0, 0.05, -0.32);
    const dome = new THREE.Mesh(organic(new THREE.SphereGeometry(0.42, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.015, 9, 4), glass(COL.cyan, 0.38));
    dome.rotation.x = -Math.PI / 2 - 0.25;
    dome.material.side = THREE.DoubleSide;
    bell.add(dome);
    const combMat = this.glow(COL.cyan, 2.6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const phi = (k / 10) * Math.PI * 0.6;
        pts.push(new THREE.Vector3(Math.sin(phi) * Math.cos(a), Math.cos(phi), Math.sin(phi) * Math.sin(a)).multiplyScalar(0.425));
      }
      const comb = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.012, 4), combMat);
      comb.rotation.x = -Math.PI / 2 - 0.25;
      bell.add(comb);
    }
    // Trailing frills from the bell rim.
    for (let i = 0; i < 6; i++) {
      const tg = new THREE.Group();
      const a = (i / 6) * Math.PI * 2;
      tg.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3 - 0.05, -0.32);
      const ten = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.018, 0.5, 4), glass(COL.violet, 0.6));
      ten.rotation.x = Math.PI / 2;
      ten.position.z = -0.25;
      tg.add(ten);
      bell.add(tg);
      this.tendrils.push(tg);
    }
    this.body.add(bell);
    this.bell = bell;

    // Dorsal bone spurs.
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18 + r() * 0.1, 6), bone);
      sp.position.set(0, 0.2, 0.15 - i * 0.14);
      sp.rotation.x = -0.6;
      this.body.add(sp);
    }

    // Six long harvestman legs: knees high above the body, feet far out.
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const row = i % 3;
      const hip = new THREE.Group();
      hip.position.set(side * 0.18, 0.02, 0.18 - row * 0.2);
      hip.rotation.set(0, side * (0.55 - row * 0.55), side * -0.55);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.035, 0.8, 6), chitin);
      thigh.position.y = 0.4;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = 0.8;
      knee.rotation.z = side * 2.35;
      const kj = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bone);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.022, 1.25, 5), bone);
      shin.position.y = 0.62;
      knee.add(kj, shin);
      hip.add(knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, phase: (i + row) % 2 === 0 ? 0 : Math.PI });
    }

    this.sphere(this.body, new THREE.Vector3(0, 0, 0), 0.42 * s, false);
    this.sphere(head, new THREE.Vector3(0, 0, 0.1), 0.28 * s, false);
    this.sphere(bell, new THREE.Vector3(0, 0, -0.1), 0.38 * s, false);
    this.sphere(head, new THREE.Vector3(0, -0.2, 0.05), 0.16 * s, true);
  }

  // ---------------------------------------------------------------- Bile Cantor: siphonophore x vocal sac x pitcher plant
  private buildCantor(): void {
    const r = this.rand;
    const muscle = wet(COL.muscle, { roughness: 0.35 });
    const chitin = wet(COL.chitin);
    const [lo, hi] = (this.t.hoverHeight as [number, number]) ?? [3, 6];
    this.hover = lo + r() * (hi - lo);
    this.body.position.y = this.hover;
    this.strafe = r() < 0.5 ? -1 : 1;

    // The 3 m gas bladder, veined violet, light coming through.
    const bladder = new THREE.Group();
    const skin = new THREE.Mesh(organic(new THREE.SphereGeometry(1.5, 40, 28), 0.08, 3.5, r() * 9), new THREE.MeshPhysicalMaterial({
      color: COL.violet, transparent: true, opacity: 0.4, roughness: 0.06, clearcoat: 1, emissive: COL.violet, emissiveIntensity: 0.35, side: THREE.DoubleSide, depthWrite: false,
    }));
    skin.scale.set(1, 0.82, 1.05);
    bladder.add(skin);
    const inner = new THREE.Mesh(organic(new THREE.IcosahedronGeometry(0.75, 3), 0.08, 5, 3), this.glow(COL.magenta, 0.9));
    inner.position.y = 0.15;
    bladder.add(inner);
    const veinMat = this.glow(COL.violet, 2);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const phi = 0.15 + (k / 10) * Math.PI * 0.8;
        const w = a + Math.sin(k * 1.1 + i * 2) * 0.16;
        pts.push(new THREE.Vector3(Math.sin(phi) * Math.cos(w), Math.cos(phi) * 0.82, Math.sin(phi) * Math.sin(w)).multiplyScalar(1.52));
      }
      bladder.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.022, 4), veinMat));
    }
    this.body.add(bladder);
    this.bell = bladder;

    // Three song pustules on the flanks: the weak points.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const mat = glowMat(COL.lime, 3);
      const p = new THREE.Mesh(organic(new THREE.SphereGeometry(0.26, 18, 12), 0.02, 18, i), mat);
      p.position.set(Math.cos(a) * 1.35, -0.25, Math.sin(a) * 1.35);
      p.scale.set(1, 1.2, 1);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 8, 18), muscle);
      collar.position.copy(p.position);
      collar.lookAt(0, -0.25, 0);
      bladder.add(p, collar);
      this.pustules.push({ mesh: p, mat, hp: Number((this.t.weakPoint as { biomassEach?: number }).biomassEach ?? 45), popped: false });
      this.sphere(bladder, p.position.clone(), 0.34, true, i);
    }

    // Throat cluster: vocal sacs and pitcher mouths beneath the bladder.
    const throat = new THREE.Group();
    throat.position.y = -1.2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sac = new THREE.Mesh(organic(new THREE.SphereGeometry(0.2, 14, 10), 0.015, 16, i), wet(COL.muscle.clone().lerp(COL.magenta, 0.3), { roughness: 0.25 }));
      sac.position.set(Math.cos(a) * 0.32, -0.1, Math.sin(a) * 0.32);
      sac.scale.set(1, 1.3, 1);
      throat.add(sac);
      this.vocal.push(sac);
      const pitcher = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.04, 0.45, 10, 1, true), chitin);
      pitcher.material.side = THREE.DoubleSide;
      pitcher.position.set(Math.cos(a + 0.6) * 0.2, -0.35, Math.sin(a + 0.6) * 0.2);
      pitcher.rotation.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
      throat.add(pitcher);
      const lining = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), this.glow(COL.lime, 2.5));
      lining.position.copy(pitcher.position).add(new THREE.Vector3(0, -0.22, 0));
      lining.rotation.x = Math.PI / 2;
      throat.add(lining);
    }
    this.throat = new THREE.Mesh(organic(new THREE.SphereGeometry(0.28, 16, 12), 0.02, 14, 1), (this.throatMat = this.glow(COL.lime, 2)));
    this.throat.position.y = -0.15;
    throat.add(this.throat);
    this.body.add(throat);

    // Siphonophore fringe: long tendrils with glowing beads.
    const beadMat = this.glow(COL.cyan, 2.2);
    const tenMat = glass(COL.magenta, 0.55);
    for (let i = 0; i < 14; i++) {
      const tg = new THREE.Group();
      const a = (i / 14) * Math.PI * 2 + r() * 0.2;
      const rr = 0.6 + r() * 0.6;
      tg.position.set(Math.cos(a) * rr, -1.0, Math.sin(a) * rr);
      const len = 1.6 + r() * 1.8;
      const ten = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.03, len, 5), tenMat);
      ten.position.y = -len / 2;
      tg.add(ten);
      for (let b = 1; b <= 3; b++) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), beadMat);
        bead.position.y = -len * (b / 3.2);
        tg.add(bead);
      }
      this.body.add(tg);
      this.tendrils.push(tg);
    }

    this.sphere(bladder, new THREE.Vector3(0, 0, 0), 1.35, false);
    this.sphere(throat, new THREE.Vector3(0, -0.1, 0), 0.5, false);
  }

  // ---------------------------------------------------------------- Behaviour
  private pickWander(): void {
    const a = this.rand() * Math.PI * 2, d = this.rand() * 8;
    this.wander.set(this.home.x + Math.cos(a) * d, 0, this.home.z + Math.sin(a) * d);
  }

  private setState(s: State): void { this.state = s; this.stateTime = 0; }

  /** Updates world-space hit spheres; call after moving. */
  refreshHitSpheres(): void {
    this.root.updateMatrixWorld(true);
    for (const h of this.hitSpheres) h.world.copy(h.local).applyMatrix4(h.bone.matrixWorld);
  }

  /** Called by nearby creatures (alertShare) or damage. */
  alert(): void { if (this.state === 'idle') this.setState('alert'); }

  stagger(seconds: number): void {
    if (!this.alive) return;
    this.setState('stagger');
    this.cooldown = Math.max(this.cooldown, 0.3);
    this.stateTime = -seconds + 0.6; // stagger state lasts `seconds`
  }

  /** Applies damage. `sphere` is the hit sphere struck, if any. Returns true if this killed the creature. */
  damage(amount: number, dir: THREE.Vector3 | null, sphere?: HitSphere): boolean {
    if (!this.alive) return false;
    this.biomass -= amount;
    this.flinch = Math.min(1, this.flinch + amount / 40);
    this.recentDamage += amount;
    if (dir && this.kind === 'needlemaw') this.velocity.addScaledVector(dir, Math.min(4, amount / 10));
    this.alert();
    if (sphere?.pustule !== undefined) {
      const p = this.pustules[sphere.pustule];
      if (!p.popped) {
        p.hp -= amount;
        if (p.hp <= 0) { p.popped = true; p.mesh.scale.setScalar(0.35); p.mat.emissive.copy(COL.violet); p.mat.emissiveIntensity = 0.3; }
      }
      const all = (this.t.weakPoint as { allPoppedKills?: boolean }).allPoppedKills;
      if (all && this.pustules.every((x) => x.popped)) this.biomass = 0;
    }
    if (this.recentDamage >= this.t.staggerThreshold && this.state !== 'stagger') { this.recentDamage = 0; this.stagger(0.6); }
    if (this.biomass <= 0) { this.die(); return true; }
    return false;
  }

  /** The pustule a weak-point sphere belongs to has already burst: hits there count as body hits. */
  isLiveWeakPoint(h: HitSphere): boolean { return h.weak && (h.pustule === undefined || !this.pustules[h.pustule].popped); }

  private die(): void {
    this.setState('dead');
    this.deadFor = 0;
    this.fallV = 0;
  }

  update(dt: number, ctx: AbominationContext): void {
    this.stateTime += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.recentDamage = Math.max(0, this.recentDamage - dt * this.t.staggerThreshold * 0.5);
    this.revealed = Math.max(0, this.revealed - dt);
    const t = this.t;
    const pos = this.root.position;
    const toPlayer = new THREE.Vector3(ctx.player.x - pos.x, 0, ctx.player.z - pos.z);
    const dist = toPlayer.length();
    if (dist > 0.001) toPlayer.divideScalar(dist);

    if (this.state === 'dead') { this.animateDeath(dt); return; }

    const contact = ctx.playerAlive && !ctx.playerHidden && (
      sees(t.perception, pos.x, pos.z, this.yaw, ctx.player.x, ctx.player.z) ||
      ctx.noises.some((n) => hears(t.perception, pos.x, pos.z, n)));

    let wantSpeed = 0;
    let face: THREE.Vector3 | null = null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const windup = t.windup;

    switch (this.state) {
      case 'idle': {
        const w = new THREE.Vector3(this.wander.x - pos.x, 0, this.wander.z - pos.z);
        if (w.length() < 0.8 || this.stateTime > 10) { this.pickWander(); this.stateTime = 0; }
        else { wantSpeed = t.speed * 0.22; face = w.normalize(); }
        if (contact) this.setState('alert');
        break;
      }
      case 'alert':
        face = toPlayer;
        if (this.stateTime <= dt + 1e-6) ctx.onAlert(this);
        if (this.stateTime > (this.kind === 'needlemaw' ? 0.3 : 0.5)) this.setState('chase');
        break;
      case 'chase': {
        face = toPlayer;
        if (!ctx.playerAlive || ctx.playerHidden) { this.setState('idle'); break; }
        if (contact) this.lostFor = 0; else if ((this.lostFor += dt) > t.perception.loseInterest) { this.lostFor = 0; this.home.copy(pos); this.setState('idle'); break; }
        if (this.kind === 'needlemaw') {
          wantSpeed = t.speed;
          // Zig-zag approach.
          const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(Math.sin(this.stateTime * 4 + this.id) * 0.55 * Math.min(1, dist / 8));
          face = toPlayer.clone().add(side).normalize();
          if (dist < t.attackRange * 1.8 && this.cooldown === 0) this.setState('windup');
        } else {
          const [near, far] = (t.preferredRange as [number, number]) ?? [18, 35];
          let move = new THREE.Vector3();
          if (dist > far) move.copy(toPlayer);
          else if (dist < near) move.copy(toPlayer).negate();
          // Drift sideways around the host.
          move.add(new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(0.6 * this.strafe));
          if (this.rand() < dt * 0.15) this.strafe *= -1;
          if (move.lengthSq() > 0) { move.normalize(); this.velocity.x = THREE.MathUtils.damp(this.velocity.x, move.x * t.speed, 2, dt); this.velocity.z = THREE.MathUtils.damp(this.velocity.z, move.z * t.speed, 2, dt); }
          if (dist < t.attackRange && this.cooldown === 0) this.setState('windup');
        }
        break;
      }
      case 'windup':
        face = toPlayer;
        if (this.stateTime >= windup) {
          if (this.kind === 'needlemaw') {
            this.velocity.copy(toPlayer).multiplyScalar(Number(t.lungeSpeed ?? 14));
            this.velocity.y = 0;
            this.setState('lunge');
          } else {
            this.spit(ctx);
            this.cooldown = t.cooldown;
            this.setState('recover');
          }
        }
        break;
      case 'lunge':
        face = toPlayer;
        if (dist < t.attackRange * 0.75 && this.stateTime < 0.35 && this.cooldown === 0) {
          ctx.onMelee(this, t.damage);
          this.cooldown = t.cooldown;
        }
        if (this.stateTime > 0.35) { this.cooldown = Math.max(this.cooldown, t.cooldown * 0.7); this.setState('recover'); }
        break;
      case 'recover':
        face = toPlayer;
        if (this.stateTime > 0.45) this.setState('chase');
        break;
      case 'stagger':
        if (this.stateTime > 0.6) this.setState('chase');
        break;
    }

    // Steering.
    if (face) {
      const target = Math.atan2(face.x, face.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = this.kind === 'needlemaw' ? 8 : 2;
      this.yaw += THREE.MathUtils.clamp(d, -turn * dt, turn * dt);
    }
    if (this.kind === 'needlemaw' && this.state !== 'lunge') {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const desired = fwd.multiplyScalar(wantSpeed * (1 - this.flinch * 0.7) * (this.state === 'stagger' ? 0 : 1));
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 7, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 7, dt);
    } else if (this.kind === 'bilecantor' && this.state === 'idle') {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(wantSpeed);
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, fwd.x, 2, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, fwd.z, 2, dt);
    } else if (this.kind === 'bilecantor' && this.state !== 'chase') {
      this.velocity.multiplyScalar(Math.exp(-2 * dt));
    }

    // Separation from other creatures; needlemaws cannot overlap the host.
    for (const o of ctx.others) {
      if (o === this || !o.alive || o.kind !== this.kind) continue;
      const dx = pos.x - o.position.x, dz = pos.z - o.position.z;
      const d = Math.hypot(dx, dz), min = this.radius + o.radius;
      if (d > 0.001 && d < min) { pos.x += (dx / d) * (min - d) * 0.5; pos.z += (dz / d) * (min - d) * 0.5; }
    }
    if (this.kind === 'needlemaw') {
      const min = this.radius + 0.35;
      if (dist < min && dist > 0.001) { pos.x -= toPlayer.x * (min - dist); pos.z -= toPlayer.z * (min - dist); }
    }

    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;
    const r = Math.hypot(pos.x, pos.z), edge = ctx.playableRadius * 0.98;
    if (r > edge) { pos.x *= edge / r; pos.z *= edge / r; }
    pos.y = groundHeight(pos.x, pos.z);
    this.root.rotation.y = this.yaw;
    this.animate(dt, Math.hypot(this.velocity.x, this.velocity.z));
  }

  private spit(ctx: AbominationContext): void {
    const from = this.throat!.getWorldPosition(new THREE.Vector3());
    from.y -= 0.3;
    const proj = (this.t.projectile as { speed: number; gravity: number; leadTarget: number }) ?? { speed: 22, gravity: 9.8, leadTarget: 0.5 };
    const g = proj.gravity;
    const flat0 = new THREE.Vector3(ctx.player.x - from.x, 0, ctx.player.z - from.z);
    const vh = proj.speed * 0.8;
    const T = Math.max(0.4, flat0.length() / vh);
    // Lead the moving host by `leadTarget` of its travel during the flight.
    const target = ctx.player.clone().addScaledVector(ctx.playerVelocity, T * proj.leadTarget);
    target.y += 0.9;
    const flat = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
    const T2 = Math.max(0.4, flat.length() / vh);
    const vel = flat.normalize().multiplyScalar(vh);
    vel.y = (target.y - from.y + 0.5 * g * T2 * T2) / T2;
    ctx.onSpit(this, from, vel);
  }

  private animate(dt: number, speed: number): void {
    const time = performance.now() * 0.001 + this.id * 1.7;
    const revealBoost = this.revealed > 0 ? 1.8 : 1;
    if (this.kind === 'needlemaw') {
      this.gait += dt * (speed * 2.4 + 0.4);
      const stride = Math.min(1, speed / 4);
      for (const l of this.legs) {
        const ph = this.gait + l.phase;
        l.hip.rotation.x = Math.sin(ph) * 0.4 * stride;
        l.knee.rotation.x = Math.max(0, Math.cos(ph)) * 0.35 * stride;
      }
      const wind = this.state === 'windup' ? Math.min(1, this.stateTime / this.t.windup) : this.state === 'lunge' ? 1 : 0;
      const b = this.body;
      b.rotation.x = -wind * 0.45 + Math.sin(this.gait * 2) * 0.05 * stride - this.flinch * 0.4;
      b.position.y = 0.75 + wind * 0.15 + Math.abs(Math.sin(this.gait * 2)) * 0.06 * stride;
      b.rotation.z = this.state === 'stagger' ? Math.sin(time * 30) * 0.15 : 0;
      const open = wind > 0 ? 1 : this.state === 'alert' ? 0.7 : 0.15 + Math.sin(time * 2.4) * 0.1;
      for (const n of this.needles) n.rotation.x = 0.35 - open * 0.9;
      // Bell contracts on wind-up, pulses faster when hunting.
      const rate = this.engaged ? 7 : 2.5;
      if (this.bell) this.bell.scale.set(1 + Math.sin(time * rate) * 0.07 - wind * 0.15, 1 + Math.sin(time * rate) * 0.07 - wind * 0.15, 1 - Math.sin(time * rate) * 0.05);
      if (this.throat && this.throatMat) { this.throat.scale.setScalar(1 + wind * 0.6); this.throatMat.emissiveIntensity = (2.2 + wind * 6) * revealBoost; }
      this.tendrils.forEach((tg, i) => { tg.rotation.y = Math.sin(time * 3 + i) * 0.3; });
      for (const g of this.glows) if (g.mat !== this.throatMat) g.mat.emissiveIntensity = g.base * (this.engaged ? 1.3 : 0.75) * revealBoost;
    } else {
      const wind = this.state === 'windup' ? Math.min(1, this.stateTime / this.t.windup) : 0;
      const b = this.body;
      b.position.y = this.hover + Math.sin(time * 0.9) * 0.25 - this.flinch * 0.4;
      b.rotation.z = Math.sin(time * 0.7) * 0.06 + (this.state === 'stagger' ? Math.sin(time * 25) * 0.08 : 0);
      b.rotation.x = Math.cos(time * 0.6) * 0.05;
      if (this.bell) this.bell.scale.setScalar(1 + Math.sin(time * 1.6) * 0.025 + wind * 0.05);
      this.vocal.forEach((v, i) => v.scale.set(1 + Math.sin(time * 6 + i) * 0.15 * (0.4 + wind), 1.3 + Math.sin(time * 6 + i) * 0.25 * (0.4 + wind), 1));
      for (const p of this.pustules) if (!p.popped) { p.mat.emissiveIntensity = (3 + wind * 7 + Math.sin(time * 4) * 0.5) * revealBoost; p.mesh.scale.set(1 + wind * 0.3, 1.2 + wind * 0.4, 1 + wind * 0.3); }
      if (this.throat && this.throatMat) { this.throat.scale.setScalar(1 + wind * 0.8); this.throatMat.emissiveIntensity = (2 + wind * 6) * revealBoost; }
      this.tendrils.forEach((tg, i) => { tg.rotation.x = Math.sin(time * 1.2 + i * 0.7) * 0.18 - this.velocity.z * 0.04; tg.rotation.z = Math.cos(time * 1.0 + i) * 0.18 + this.velocity.x * 0.04; });
    }
  }

  private animateDeath(dt: number): void {
    this.deadFor += dt;
    const k = Math.min(1, this.deadFor / 0.7);
    const b = this.body;
    if (this.kind === 'needlemaw') {
      b.rotation.z = THREE.MathUtils.lerp(0, 2.7, k * k);
      b.position.y = THREE.MathUtils.lerp(0.75, 0.25, k);
      for (const l of this.legs) { l.hip.rotation.x = Math.sin(this.deadFor * 28) * 0.3 * (1 - k); l.knee.rotation.x = 1.1 * k; }
      if (this.bell) this.bell.scale.setScalar(Math.max(0.25, 1 - k * 0.75));
    } else {
      // The bladder tears and the body drops.
      if (b.position.y > 0.6) { this.fallV += 12 * dt; b.position.y = Math.max(0.6, b.position.y - this.fallV * dt); }
      b.rotation.x = THREE.MathUtils.lerp(0, 0.5, k);
      if (this.bell) this.bell.scale.set(1 - k * 0.55, Math.max(0.2, 1 - k * 0.75), 1 - k * 0.4);
      this.tendrils.forEach((tg) => { tg.rotation.x = THREE.MathUtils.lerp(tg.rotation.x, 1.2, k * 0.1); });
    }
    for (const g of this.glows) g.mat.emissiveIntensity = Math.max(0.05, g.mat.emissiveIntensity - dt * 1.2);
    for (const p of this.pustules) p.mat.emissiveIntensity = Math.max(0.05, p.mat.emissiveIntensity - dt * 2);
    if (this.deadFor > 30) this.root.position.y -= dt * 0.12;
  }
}
