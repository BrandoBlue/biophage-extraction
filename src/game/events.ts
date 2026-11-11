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
  /** A reload reached one of its feel beats (weapon-feel.json reload[style].beats; perShell: per shell). */
  reloadBeat: { weapon: string; style: string; beat: number; cue: string };
  reloaded: { weapon: string; ammo: number };
  /** The held weapon changed (mouse wheel or Z). */
  weaponSwap: { weapon: string; slot: number };
  /** A weapon found in the raid went into a free weapon slot. */
  weaponPickup: { weapon: string; label: string; slot: number };
  /** A fed weapon took rounds from its ammo item in the cavities or pouch. */
  ammoFed: { weapon: string; item: string; count: number };
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
  /** Melee strike (kit melee); `hit` is the creature id or null on a whiff. */
  melee: { id: string; hit: number | null };
  /** Flesh Market gear: thrown or placed, then detonated. */
  gearUsed: { item: string };
  explosion: { item: string; position: Vec3Like };
  /** Heart Husk: lethal damage turned into a delayed revive. */
  reviving: { time: number };
  revived: { biomass: number };
  /** A late Seed Spire has opened (World layout; RAID.larva.extracts opensAt). */
  extractOpened: { label: string; x: number; z: number };
  /** Brood Heart nests (PvE AI). */
  nestAwake: { id: string; type: string; label: string };
  nestWave: { id: string; wave: number; of: number };
  nestDamaged: { id: string; biomass: number; fraction: number; weakPoint: boolean };
  nestDestroyed: { id: string; type: string; dna: number; container: string };
  /** A creature burst from its tank or dropped its disguise (PvE AI homes, data/habitats.json). */
  creatureReveal: { id: number; type: string; how: 'hatch' | 'disguise' | 'ambush'; position: { x: number; y: number; z: number } };
  /** Zone boss (PvE AI, src/game/boss.ts). `songRadius`: how far the wake song carries. */
  bossAwake: { boss: string; label: string; songRadius: number };
  bossPhase: { boss: string; phase: string };
  bossEnraged: { boss: string };
  bossAttack: { boss: string; attack: string };
  bossDamaged: { boss: string; biomass: number; fraction: number; weakPoint: boolean; part: string };
  bossPartDestroyed: { boss: string; part: string };
  /** A coolant valve in the Warden's reactor chamber was shot open (its seam beside it cracks). */
  valveVented: { boss: string; valve: string };
  bossCoverBroken: { boss: string; pillar: string };
  bossDefeated: { boss: string; dna: number; container: string | null };
  extractStart: { label: string; time: number };
  extractProgress: { progress: number; timeLeft: number };
  extractCancel: Record<string, never>;
  extractDone: { items: { item: string; count: number }[]; dna: number; value: number };
  death: { cause: string; items: { item: string; count: number }[]; dna: number; value: number };
  raidEnd: { result: 'extracted' | 'lost'; value: number; kills: number; time: number };
  // Contracts (Gameplay): first open of a container, a landmark reached, a boss killed.
  containerOpened: { id: string; container: string };
  landmarkVisited: { landmark: string };
  bossKilled: { boss: string; dna: number; container: string | null; harvest: string | null };
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
