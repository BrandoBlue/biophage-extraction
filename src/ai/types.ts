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
  /** Reloading right now: hunters that see it press in (ai.json tactics.reload). */
  reloading?: boolean;
  /** Aiming down sights: a held aim unsettles hunters faster (tactics.aim). */
  aiming?: boolean;
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
  /** What this raid's creatures have learned about the host (src/ai/memory.ts). Optional: none, nothing is learned. */
  memory?: import('./memory').RaidMemory;
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
  /** Strung a web strand between two ground points (Tithe Weaver). */
  | { type: 'web'; from: Vec2; to: Vec2 }
  /** A fan of projectiles (a Bristleback's quill volley): `count` shots of `damage` each at `target`, spread a little. */
  | { type: 'volley'; target: Vec3; count: number; damage: number; spread: number }
  /** Calls every creature of its own kind within `radius` (a herd's alarm). */
  | { type: 'alarm'; radius: number }
  /** Juked sideways out of the host's aim. */
  | { type: 'dodge' }
  /** Thinking out loud (ai.json tactics): calls the pack in on a reload, breaks out of a held aim, starts or springs a
   *  lure, falters when a packmate falls. The body, sound and HUD read these as tells. */
  | { type: 'tactic'; what: Tactic }
  /** Calls creatures of other kinds within `radius` onto `at` (a Bile Cantor singing Needlemaws onto the host). */
  | { type: 'rally'; kinds: readonly string[]; radius: number; at: Vec2 }
  /** Burst from its tank, dropped its disguise, or sprang the ambush it laid where it lost the host. */
  | { type: 'reveal'; how: 'hatch' | 'disguise' | 'ambush' };

/** A tactical choice a hunter just made (see Brain.intent). */
export type Tactic = 'press' | 'evade' | 'lure' | 'spring' | 'falter' | 'rout' | 'adapt' | 'rally';
/** What a creature is thinking right now, readable by the body, sound and HUD. */
export type Intent = 'idle' | 'wary' | 'stare' | 'hunt' | 'stalk' | 'attack' | 'search' | 'flee' | 'reel' | 'press' | 'evade' | 'lure' | 'falter' | 'dead';
export type Mode = 'calm' | 'investigate' | 'hunt' | 'stagger' | 'dead';
