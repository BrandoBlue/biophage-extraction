/** Plain data shapes shared by the PvE brains. No Three.js here so the AI runs (and is tested) headless. */
import type { Noise } from '../game/perception';

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

/** What a brain knows about the host this tick. */
export interface HostView {
  x: number; y: number; z: number;
  vx: number; vz: number;
  alive: boolean;
  /** Spawn protection: creatures cannot notice the host. */
  hidden: boolean;
  /** 0.3..~3: how easy the host is to see (crouch, sprint, muzzle flash, glowing footprints). See light.ts. */
  visibility: number;
  /** Unit direction the host is looking (XZ), if known. Stalkers freeze when watched. */
  forward: Vec2 | null;
}

/** Another creature, as a brain sees it (for separation, screech alerts and pack slots). */
export interface AllyView {
  readonly id: number;
  readonly kind: string;
  readonly alive: boolean;
  readonly position: Vec3;
}

export interface BrainWorld {
  host: HostView;
  noises: readonly Noise[];
  allies: readonly AllyView[];
  /** Shared attack-slot pool for this raid (see tokens.ts). */
  tokens: import('./tokens').AttackTokens;
  playableRadius: number;
}

/** One-shot things a brain did this tick; the Abomination turns them into damage, projectiles, bus events and sound. */
export type AIEvent =
  | { type: 'notice'; at: Vec2 }
  | { type: 'alert' }
  | { type: 'melee'; damage: number; knockback: number }
  | { type: 'spit'; target: Vec3 }
  | { type: 'screech'; radius: number }
  | { type: 'slam'; radius: number; damage: number; knockback: number }
  | { type: 'charge' }
  /** Juked sideways out of the host's aim. */
  | { type: 'dodge' }
  /** Burst from its tank, dropped its disguise, or sprang the ambush it laid where it lost the host. */
  | { type: 'reveal'; how: 'hatch' | 'disguise' | 'ambush' };

export type Mode = 'calm' | 'investigate' | 'hunt' | 'stagger' | 'dead';
