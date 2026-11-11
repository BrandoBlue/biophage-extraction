import type { ReticleInput } from './reticle';

/**
 * What the in-raid HUD reads each frame. A structural subset of Gameplay's HudState (src/game/raid.ts) plus the
 * Larva fields (virus, harvest, extra extracts, objectives) as optional, so the HUD runs on either side of a
 * Gameplay change and the mocks can feed it fixtures.
 */
export interface HudView {
  phase: string;
  biomass: number; biomassMax: number;
  overload: number; overloaded: boolean;
  ammo: number; magazine: number; reloading: number; ego: number; egoReady: boolean;
  timeLeft: number; collapse: boolean;
  slots: { slot: number; label: string; count: number | null; usable: boolean; active: boolean; cooldownFrac: number }[];
  carried: { item: string; label: string; count: number; kind: string }[];
  dna: number; value: number;
  extract: { progress: number; inside: boolean; distance: number; label: string; time?: number };
  interact: { text: string; progress: number } | null;
  scanner: {
    x: number; z: number; yaw: number; range: number;
    extract: { x: number; z: number };
    extracts?: { x: number; z: number; open: boolean }[];
    pods: { x: number; z: number; opened: boolean }[];
    pings: { x: number; z: number; kind: string; revealed?: boolean }[];
  };
  activeVirus?: string | null;
  /** Virus id being injected, null when not channelling. */
  injecting?: string | null;
  injectProgress?: number;
  harvestProgress?: number;
  cavityUsed?: [number, number];
  objectives?: { text: string; detail?: string; done?: boolean; icon?: string }[];
  /** Awake boss or nest in range (Gameplay's hud().boss): Biomass fraction and wave progress. */
  boss?: { label: string; fraction: number; wave: number; waves: number } | null;
  /** Aim-down-sights held (Gameplay's HudState.aiming). */
  aiming?: boolean;
  /** Active gun (Gameplay's weapons roster); the reticle and scope key off its id and class. */
  weapon?: { id: string; label?: string; class?: string; slot?: number; slots?: number; reserve?: number; charge?: number; scope?: number; canAim?: boolean } | null;
  /** Movement for the reticle's moving spread: 0 standing to 1 at walk speed, and sprinting. */
  motion?: { moving: number; sprinting: boolean } | null;
  /** Gameplay's live crosshair; see ReticleInput in src/ui/raid/reticle.ts. */
  crosshair?: ReticleInput['crosshair'];
}
