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
}
