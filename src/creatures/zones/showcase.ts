import * as THREE from 'three';
import { Sandwidow, type WidowPhase } from './sandwidow';
import { Nethermaw, type NethermawPhase } from './nethermaw';
import { MireRegent, type RegentPhase } from './mireRegent';

/**
 * Viewer adapters for the new-zone bosses, so the `?creatures` viewer drives every one of them through one small
 * interface (Walk, Strike, Act, Sever, Gib, and clicking the boss button again for the next phase). The real
 * driving is PvE AI's; this only shows the body off.
 */

export interface ViewerInput { dt: number; time: number; camera: THREE.Vector3; origin: THREE.Vector3; striking: number; walking: boolean; acting: number }

export interface ZoneBossShow {
  id: ZoneBossId;
  root: THREE.Object3D;
  /** Camera framing: target height above the origin and distance. */
  frame: { y: number; z: number; dist: number };
  nextPhase(phase?: string): void;
  tick(input: ViewerInput): void;
  sever(): boolean;
  gib(): void;
  card(): string;
  state(): Record<string, unknown>;
}

export type ZoneBossId = 'sandwidow' | 'nethermaw' | 'mireRegent';
export const ZONE_BOSSES: { id: ZoneBossId; label: string }[] = [{ id: 'sandwidow', label: 'Sandwidow' }, { id: 'nethermaw', label: 'Nethermaw' }, { id: 'mireRegent', label: 'Mire Regent' }];

export function showZoneBoss(id: ZoneBossId, seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, origin: THREE.Vector3): ZoneBossShow {
  if (id === 'mireRegent') return regentShow(seed, scene, ground, origin);
  return id === 'nethermaw' ? nethermawShow(seed, scene, ground, origin) : widowShow(seed, scene, ground, origin);
}

function regentShow(seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, origin: THREE.Vector3): ZoneBossShow {
  const m = new MireRegent(seed, scene);
  // The studio floor stands in for the pool's surface.
  m.root.position.set(origin.x, ground(origin.x, origin.z), origin.z);
  const order: RegentPhase[] = ['lurk', 'rise', 'drown'];
  let lastAct = 0, yaw = 0;
  const apply = () => {
    const p = m.drive.phase;
    m.drive.rise = p === 'lurk' ? 0 : p === 'rise' ? 1 : 0.45;
    m.drive.thrash = p === 'drown' ? 1 : 0;
  };
  apply();
  return {
    id: 'mireRegent', root: m.root, frame: { y: 3, z: 3, dist: 26 },
    nextPhase(phase?: string) { m.drive.phase = (phase as RegentPhase) ?? order[(order.indexOf(m.drive.phase) + 1) % order.length]; apply(); },
    tick(i) {
      const d = m.drive;
      d.look = i.camera;
      // Strike: an arm reaches for the camera's foot (lurk), or the tongue lashes out (rise and drown).
      const striking = i.striking > 0;
      d.reach = [striking && d.phase === 'lurk' ? i.camera.clone().setY(m.root.position.y + 0.5) : null, null];
      d.tongue = striking && d.phase !== 'lurk' ? Math.min(1, i.striking * 1.5) : 0;
      d.open = striking ? 1 : 0.1;
      if (i.acting > 1.45 && lastAct <= 1.45) { if (d.phase === 'lurk') m.call(); else m.slam(); m.ripple(); }
      lastAct = i.acting;
      if (i.walking) { yaw += i.dt * 0.25; m.root.rotation.y = yaw; }
      m.update(i.dt);
    },
    sever() { const k = m.weakPoints.findIndex((w) => w.alive && w.tag === 'pearl'); if (k >= 0) m.popWeakPoint(k); return k >= 0; },
    gib() { m.destroy(); },
    card: () => `<b>The Mire Regent</b><br>Phase ${m.drive.phase} · pearls ${m.pearlsAlive}/5 · eyes ${m.eyesAlive}/2. Click again for the next phase (lurk under the pool, rise rears out with the pearls bare, drown thrashes); Strike reaches an arm or lashes the tongue, Act calls the brood or slams, Walk turns it, Sever bursts a pearl, Gib kills it.`,
    state: () => ({ phase: m.drive.phase, pearls: m.pearlsAlive, eyes: m.eyesAlive, risen: Number(m.risen.toFixed(2)), alive: m.alive }),
  };
}

function nethermawShow(seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, origin: THREE.Vector3): ZoneBossShow {
  const n = new Nethermaw(seed, scene);
  n.root.position.set(origin.x, ground(origin.x, origin.z), origin.z);
  const order: NethermawPhase[] = ['breathe', 'dream', 'swallow'];
  let next = 0, timer = 2;
  return {
    id: 'nethermaw', root: n.root, frame: { y: 3, z: 0, dist: 24 },
    nextPhase(phase?: string) { n.drive.phase = (phase as NethermawPhase) ?? order[(order.indexOf(n.drive.phase) + 1) % order.length]; if (n.drive.phase === 'dream') n.dreamLight(); },
    tick(i) {
      const d = n.drive;
      // It breathes on its own; Walk runs the lobe cycle (swell, pulse, next); Strike swells them all; Act raises.
      d.breath = d.phase === 'swallow' ? 0.6 + Math.sin(i.time * 1.4) * 0.4 : Math.sin(i.time * 0.6);
      if (i.walking) {
        timer -= i.dt;
        d.swell = d.swell.map((v, k) => (k === next ? Math.min(1, v + i.dt * 0.8) : Math.max(0, v - i.dt * 2)));
        if (timer <= 0) { n.pulse(next); next = (next + 1) % d.swell.length; timer = 2; }
      } else d.swell = d.swell.map((v) => (i.striking > 0 ? Math.min(1, v + i.dt * 2) : Math.max(0, v - i.dt)));
      if (i.acting > 1.45) n.raise();
      n.update(i.dt);
    },
    sever() { const k = n.weakPoints.findIndex((w) => w.alive); if (k >= 0) n.popWeakPoint(k); return k >= 0; },
    gib() { n.destroy(); },
    card: () => `<b>The Nethermaw</b><br>Phase ${n.drive.phase} · lobes ${n.lobesAlive}/5. Click again for the next phase; Walk runs the lobe pulse cycle, Strike swells every lobe, Act raises the Hollowed, Sever bursts a lobe, Gib kills it.`,
    state: () => ({ phase: n.drive.phase, lobes: n.lobesAlive, alive: n.alive }),
  };
}

function widowShow(seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, origin: THREE.Vector3): ZoneBossShow {
  const w = new Sandwidow(seed, scene);
  w.ground = ground;
  w.root.position.set(origin.x, ground(origin.x, origin.z), origin.z + 6);
  w.plant();
  const order: WidowPhase[] = ['circle', 'erupt', 'drown'];
  let angle = 0;
  let lastStrike = 0;
  const apply = () => {
    const p = w.drive.phase;
    w.drive.surface = p === 'circle' ? 0 : p === 'erupt' ? 1 : 0.75;
    w.drive.open = p === 'erupt' ? 1 : p === 'drown' ? 0.6 : 0;
    w.drive.thrash = p === 'drown' ? 1 : 0;
  };
  apply();
  return {
    id: 'sandwidow', root: w.root, frame: { y: 3, z: 4, dist: 30 },
    nextPhase(phase?: string) { w.drive.phase = (phase as WidowPhase) ?? order[(order.indexOf(w.drive.phase) + 1) % order.length]; apply(); },
    tick(i) {
      const d = w.drive;
      d.look = i.camera;
      d.windup = i.striking > 0.6 ? Math.min(1, (1.2 - i.striking) / 0.6) : 0;
      d.strike = i.striking > 0 && i.striking <= 0.6 ? i.camera.clone().lerp(w.root.position, 0.5) : null;
      if (i.striking > 0 && lastStrike <= 0) d.open = 1;
      lastStrike = i.striking;
      if (i.acting > 0 && i.acting > 1.45) w.blast();
      if (i.walking && w.alive) {
        const R = 13, speed = d.phase === 'circle' ? 6 : 3;
        angle += (speed / R) * i.dt;
        const nx = i.origin.x + Math.cos(angle) * R, nz = i.origin.z + Math.sin(angle) * R;
        w.root.position.set(nx, ground(nx, nz), nz);
        w.root.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle));
      }
      w.update(i.dt);
    },
    sever() {
      const k = w.weakPoints.findIndex((p) => p.alive && p.tag === 'petal');
      if (k >= 0) { w.popWeakPoint(k); return true; }
      const s = w.weakPoints.findIndex((p) => p.alive);
      if (s >= 0) w.popWeakPoint(s);
      return s >= 0;
    },
    gib() { w.destroy(); },
    card: () => `<b>The Sandwidow</b><br>Phase ${w.drive.phase} · petals ${w.petalsAlive}/6 · sacs ${w.sacsAlive}/4. Click again for the next phase (circle swims under the sand, erupt rears out and opens the crown, drown thrashes); Walk sends her round, Strike lunges, Act blasts sand, Sever shears a petal, Gib kills her.`,
    state: () => ({ phase: w.drive.phase, petals: w.petalsAlive, sacs: w.sacsAlive, alive: w.alive }),
  };
}
