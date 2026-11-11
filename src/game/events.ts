/**
 * Gameplay event bus. UI, audio, AI and analytics subscribe here instead of reaching into game objects.
 * Names follow docs/gdd/spore-milestone.md. Every payload is typed.
 */
export interface Vec3Like { x: number; y: number; z: number }
export type HitZone = 'head' | 'torso' | 'limb';

export interface GameEvents {
  raidStart: { raidTime: number };
  collapseWarning: { timeLeft: number };
  shot: { weapon: string; ammo: number; position: Vec3Like; ego: boolean };
  reload: { weapon: string; time: number };
  reloaded: { weapon: string; ammo: number };
  hit: { target: string; id: number; damage: number; weakPoint: boolean; kill: boolean; position: Vec3Like };
  damaged: { amount: number; biomass: number; zone: HitZone; source: string; direction: Vec3Like | null };
  healed: { amount: number; biomass: number };
  overload: { duration: number };
  noise: { position: Vec3Like; radius: number; source: string };
  alert: { id: number; type: string; position: Vec3Like };
  attack: { id: number; type: string; position: Vec3Like };
  creatureDeath: { id: number; type: string; position: Vec3Like; dna: number };
  ability: { id: string; slot: number };
  abilityDenied: { id: string; reason: 'cooldown' | 'overloaded' | 'empty' };
  containerOpenStart: { container: string };
  pickup: { items: { item: string; count: number }[]; dna: number; source: string };
  /** Pickup items that did not fit in the cavities or gut pouch; they stay where they were. */
  cavityFull: { items: { item: string; count: number }[] };
  /** In-raid inventory move between 'cavity', 'pouch' and 'pod' (the opened Bio-Pod in reach). */
  inventoryChanged: { from: string; to: string; item: string; count: number };
  virusInjectStart: { virus: string; time: number };
  virusInjectCancel: { virus: string };
  /** The virus took hold: Creature & Mutation grows the arm mutation from here. */
  virusInjected: { virus: string; item: string };
  harvestStart: { type: string; time: number };
  harvestProgress: { progress: number };
  harvestDone: { item: string; type: string };
  /** A late Seed Spire has opened (World layout; RAID.larva.extracts opensAt). */
  extractOpened: { label: string; x: number; z: number };
  /** Brood Heart nests (PvE AI). */
  nestAwake: { id: string; type: string; label: string };
  nestWave: { id: string; wave: number; of: number };
  nestDamaged: { id: string; biomass: number; fraction: number; weakPoint: boolean };
  nestDestroyed: { id: string; type: string; dna: number; container: string };
  extractStart: { label: string; time: number };
  extractProgress: { progress: number; timeLeft: number };
  extractCancel: Record<string, never>;
  extractDone: { items: { item: string; count: number }[]; dna: number; value: number };
  death: { cause: string; items: { item: string; count: number }[]; dna: number; value: number };
  raidEnd: { result: 'extracted' | 'lost'; value: number; kills: number; time: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) (fn as Handler<E[K]>)(payload);
  }

  clear(): void { this.handlers.clear(); }
}
