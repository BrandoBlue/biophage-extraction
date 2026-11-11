import * as THREE from 'three';
import { Sandwidow, type WidowPhase } from './sandwidow';
import { Nethermaw, type NethermawPhase } from './nethermaw';

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

export type ZoneBossId = 'sandwidow' | 'nethermaw';
export const ZONE_BOSSES: { id: ZoneBossId; label: string }[] = [{ id: 'sandwidow', label: 'Sandwidow' }, { id: 'nethermaw', label: 'Nethermaw' }];

export function showZoneBoss(id: ZoneBossId, seed: number, scene: THREE.Scene, ground: (x: number, z: number) => number, origin: THREE.Vector3): ZoneBossShow {
  return id === 'nethermaw' ? nethermawShow(seed, scene, ground, origin) : widowShow(seed, scene, ground, origin);
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
