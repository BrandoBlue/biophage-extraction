import * as THREE from 'three';
import { ABILITIES, ABOMINATIONS, AI, BOSSES, CLASSES, HOST, KITS, LOOT, RAID, VIRUSES, VIRUS_RULES, extractTimeFor, itemDef, layoutPosition, projectileDamage, rollContainer, type ClassId } from '../../data';
import { groundHeight, ISLAND_RADIUS, mulberry32 } from '../world/zone7';
import { Abomination, type AbominationContext, type AbominationKind, type HitSphere } from './abominations';
import { AbilitySystem } from './abilities';
import { EventBus } from './events';
import { ExtractionPoint } from './extraction';
import { Fx, GORE } from './fx';
import { Carried, type CarriedSnapshot } from './inventory';
import type { Deployment } from './profile';
import type { Placed } from './grid';
import { Injection, SporeInfection, virusForItem, virusModifiers } from './virus';
import { Grenade, huskRules, Mine, throwVelocity } from './gear';
import type { Noise } from './perception';
import { hostVisibility, WebField } from '../ai';
import { BroodNest } from './nest';
import { RaidBoss, type HostStrike } from './boss';
import { RaidVigil } from './vigil';
import { RaidWarden } from './warden';
import { RaidWidow } from './widow';
import { RaidNethermaw, type MawHit } from './nethermaw';
import { RaidRegent } from './regent';
import type { RegentHit } from '../creatures/zones/mireRegent';
import type { WidowHit } from '../creatures/zones/sandwidow';
import type { WardenHit } from '../creatures/warden';
import type { VigilHit } from '../creatures/palevigil';
import type { ReliquaryHit } from '../creatures/reliquary';
import { liquidLight } from '../render/materials';
import { BroodHeart } from '../creatures/broodheart';
import { Player } from './player';
import { Projectiles, segmentSphere, type Projectile } from './projectiles';
import { BioPod, Hazards, SeedSpire } from './props';
import { gravityAt, zone7Layout, type Zone7Layout } from '../world/layout';
import type { SiteDressing } from '../world/sites';
import type { ArenaInfo, BuiltStructures } from '../world/structures';

/** Another host in an online raid, as the creature brains on the squad leader's machine see it (src/net). */
export interface NetTarget {
  id: string;
  position: THREE.Vector3; velocity: THREE.Vector3;
  /** How lit up it is (src/ai/light.ts) and where it looks. */
  visibility: number; forward: { x: number; z: number };
  hurt(damage: number, source: string, from: THREE.Vector3): void;
  push(dx: number, dz: number, strength: number): void;
}

/**
 * Online raids (Online & Backend, src/net): the seam between this raid and the other hosts in it. Absent in solo
 * play, where every branch below behaves exactly as before. The squad leader's machine has `authority`: it runs the
 * creature brains, reinforcements and nests and hunts every host; the others pose creatures from its snapshots and
 * send it their damage.
 */
export interface RaidNet {
  readonly authority: boolean;
  /** Guests: pose every creature from the leader's latest snapshots (instead of running brains). */
  follow(dt: number): void;
  /** Leader: the other living hosts creatures may hunt. */
  targets(): NetTarget[];
  /** Leader: noises other hosts made since last frame. Guests: forward this host's noise to the leader. */
  heard(into: Noise[]): void;
  noise(x: number, z: number, radius: number): void;
  /** PvP: the nearest other host a swept segment strikes. */
  hitHost(a: THREE.Vector3, b: THREE.Vector3): { t: number; id: string; zone: 'head' | 'torso' | 'limb' } | null;
  /** This host's shot struck another host for `damage`. */
  hitOther(id: string, damage: number, zone: 'head' | 'torso' | 'limb', from: THREE.Vector3): void;
  /** Guests: creature damage goes to the leader, which owns biomass and deaths. */
  damageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, sphere?: HitSphere): void;
  /** Leader: a creature died; `by` is the killer's id, null for this host. */
  killed(c: Abomination, by: string | null): void;
  harvested(c: Abomination): void;
  /** Every projectile this machine fires (not replicas): replayed on the others as harmless copies. */
  fired(p: Projectile): void;
  /** Squadmates and visible rival hosts for the scanner. */
  pings(): ScannerPing[];
}

/** One Seed Spire of the raid: the World layout says where and when it opens (src/world/layout.ts). */
export interface SpireSite { id: string; label: string; opensAt: number; open: boolean; point: ExtractionPoint; spire: SeedSpire }
import { gore } from '../render/gore';
import { simplifyForSoftware } from '../render/pipeline';
import { creatureGore } from '../creatures/gore';
import { HostArm, VIRUS_LOOKS, attachToViewmodel, type VirusLook } from '../creatures/hostarm';
import type { AmmoFeed } from './weapon-state';
import { HarvestFx } from '../creatures/organs';
import { SPECIES } from '../creatures/species';
import { FAUNA, HIVE, OCHRE, ZONE7 } from '../render/palette';
import { NeuralOverload, Biomass } from './vitals';
import { LivingWeapon, STARTER_WEAPON, projectileLooks } from './weapon';
import { isWeapon, weaponSlots } from './arsenal';
import { WeaponRig } from './weapon-rig';
import { createWeaponModel } from './weapon-view';
// Creature & Mutation's living weapon bodies register themselves with the weapon view registry.
import '../creatures/weapons/view';
import { weaponSpec, WEAPONS as WEAPON_DATA, WEAPON_FEEL, type WeaponSpec } from '../../data';
import { applyMods } from './mods';
import { planHabitats, usesHabitats, type HabitatMap, type PlannedGroup } from './habitats';
import { DEFAULT_ZONE, RaidLog } from './economy';

export type Phase = 'briefing' | 'raid' | 'extracted' | 'lost';

/** Optional hooks into the render pipeline (Rendering & Tech Art). Missing methods are ignored. */
export interface PipelineHooks { setOverload?(v: number): void; hitPulse?(strength: number): void; readonly quality?: 'low' | 'high' }

export interface ScannerPing { x: number; z: number; kind: string; revealed: boolean }

/** Everything the HUD needs each frame; UI reads this and never touches game objects. */
export interface HudState {
  phase: Phase;
  biomass: number; biomassMax: number;
  overload: number; overloaded: boolean;
  ammo: number; magazine: number; reloading: number; ego: number; egoReady: boolean; aiming: boolean;
  /** The held weapon: slot index in `slots`, rounds left in its ammo item (Infinity: regrows), charge and scope 0..1. */
  weapon: { id: string; label: string; class: string; slot: number; slots: number; reserve: number; charge: number; scope: number; canAim: boolean };
  /**
   * What the crosshair should show: `radius` is the live spread cone as a fraction of half the viewport height
   * (hip spread + movement + shot bloom, shrinking as you aim), `bloom` 0..1 how far shot bloom has opened it,
   * `style` the class reticle (weapon-feel.json), `ready` false while reloading, empty, swapping or sprint-blocked,
   * `pellets` > 1 for spread guns, `charge` 0..1 for charge guns, `onTarget` when the aim ray rests on a live
   * creature, `weak` when on its live weak point.
   */
  crosshair: { radius: number; bloom: number; style: string; ready: boolean; pellets: number; charge: number; onTarget: boolean; weak: boolean };
  timeLeft: number; collapse: boolean;
  slots: ReturnType<AbilitySystem['slots']>;
  carried: { item: string; label: string; count: number; kind: string }[];
  dna: number; value: number; kills: number;
  extract: { progress: number; inside: boolean; distance: number; label: string };
  interact: { text: string; progress: number } | null;
  scanner: { x: number; z: number; yaw: number; extract: { x: number; z: number }; pods: { x: number; z: number; opened: boolean }[]; pings: ScannerPing[]; range: number };
  healing: boolean;
  /** Awake boss nest (Brood Heart) in range: label, Biomass fraction, wave progress. */
  boss: { label: string; fraction: number; wave: number; waves: number } | null;
  /** Larva: active virus id, the virus being injected, and channel progress 0..1. */
  activeVirus: string | null;
  injecting: string | null;
  injectProgress: number;
  harvestProgress: number;
}

const tmp = new THREE.Vector3();
const SAND_SPRAY = new THREE.Color(OCHRE.dust);
const MUZZLE_AT = new THREE.Vector3(), MUZZLE_DIR = new THREE.Vector3(), MUZZLE_TINT = new THREE.Color();
const SPORE = new THREE.Color(FAUNA.sickGreen);
const MIRE_WATER = new THREE.Color(FAUNA.water);
const CHEST = 1.2;
const PLAYER_RADIUS = 0.55;

/**
 * One Spore raid: spawns the host, Abominations, Bio-Pods and the Seed Spire from data/raid.json, runs combat,
 * looting, extraction, the timer and the result. Emits every gameplay event on `bus`.
 */
export class Raid {
  readonly bus = new EventBus();
  phase: Phase = 'briefing';
  /** Descent speed while dropping into the zone at raid start (0 once landed). */
  private dropping = 0;
  readonly player: Player;
  readonly biomass: Biomass;
  readonly overload: NeuralOverload;
  /** The weapons carried into the raid (loadout slots), and which one is held. */
  readonly weapons: LivingWeapon[] = [];
  private held = 0;
  readonly rig: WeaponRig;
  get weapon(): LivingWeapon { return this.weapons[this.held]; }
  readonly hostArm = new HostArm();
  private harvestFx = new HarvestFx();
  /** Raid-select zone and the contract log for this raid (src/game/economy.ts). */
  zone = DEFAULT_ZONE;
  log = new RaidLog();
  readonly abilities: AbilitySystem;
  readonly carried = new Carried();
  readonly creatures: Abomination[] = [];
  readonly pods: BioPod[] = [];
  /** Every Seed Spire this raid, in opening order. `extract`/`spire` are the one the host is at or nearest to. */
  readonly spires: SpireSite[] = [];
  /** The zone's boss arena (World & Level): bounds, entrances, pillars, pool and boss spawn. Null if none. */
  readonly arena: ArenaInfo | null;
  /** Brood Heart nests (PvE AI): wave-spawning set pieces placed from the World layout (RAID.larva.nests). */
  readonly nests: BroodNest[] = [];
  /** The zone boss in its arena (PvE AI): the Reliquary in World's bowl. Null when the zone has none. */
  readonly boss: RaidBoss | null = null;
  /** The Pale Vigil hanging in World's Fungal Cave lair (PvE AI). Null when the zone has no lair. */
  readonly vigil: RaidVigil | null = null;
  /** The Warden of the Long Seed in World's reactor chamber aboard the wreck (PvE AI). Null in other zones. */
  readonly warden: RaidWarden | null = null;
  /** The Sandwidow under World's Skyfall Crater on the Ochre Reach (PvE AI). Null in other zones. */
  readonly widow: RaidWidow | null = null;
  /** Quicksand slow on the host this frame (1: none). */
  private widowSlow = 1;
  /** The Nethermaw at the bottom of the Marrow Pit (World's Undermouth). Null in other zones. */
  readonly maw: RaidNethermaw | null = null;
  /** The Nethermaw's false extract lights (the dream phase's lie). */
  private mawLights: SeedSpire[] = [];
  private mawPull = new THREE.Vector3();
  /** The Mire Regent under the Weeping Fen's black pool. Null in other zones. */
  readonly regent: RaidRegent | null = null;
  /** Tithe Weaver web strands (PvE AI, src/ai/web.ts): walking through one roots the host and rings the web. */
  readonly webs = new WebField();
  private readonly webLines = new Map<number, THREE.Line>();
  private rootedFor = 0;
  private readonly lastFeet = new THREE.Vector3();
  private bossPool: THREE.Mesh | null = null;
  readonly fx: Fx;
  readonly projectiles: Projectiles;
  readonly hazards: Hazards;
  /** Walkable radius actually used for layout (data radius clamped to the island that exists). */
  readonly playable: number;
  kills = 0;
  elapsed = 0;
  timeLeft = RAID.raidTime;
  timeScale = 1;
  pipeline: PipelineHooks = {};
  /** Online raid (src/net); null in solo play. Set before deploy. */
  net: RaidNet | null = null;

  private rand = mulberry32(2026);
  private raycaster = new THREE.Raycaster();
  private lastDecal = new Map<number, number>();
  private noises: Noise[] = [];
  /** Acid graft burns (mods special 'acid'): damage per second on a creature until it runs out. */
  /** What the aim ray rested on last frame (crosshair target feedback). */
  private aimTarget: { weak: boolean } | null = null;
  /** Reload feel beats already played this reload (or this shell). */
  private reloadBeat = { idx: 0, last: 0 };
  /** Habitat homes this raid (Design's habitats.json), for placement and reinforcements. */
  private homes: PlannedGroup[] = [];
  private acidBurns: { c: Abomination; dps: number; left: number }[] = [];
  private trigger = false;
  private aimHeld = false;
  private egoQueued = false;
  private debugTrigger: boolean | null = null;
  private debugAim: THREE.Vector3 | null = null;
  private interactTarget: BioPod | null = null;
  private interactText: { text: string; progress: number } | null = null;
  /** Mid-raid virus: the injection channel and the active virus (Larva). */
  readonly injection = new Injection();
  private injectingItem: string | null = null;
  private spores = new SporeInfection();
  private parasites: { mesh: THREE.Mesh; target: Abomination | null; life: number }[] = [];
  private parasiteMat = new THREE.MeshBasicMaterial({ color: GORE.limeFluid });
  private parasiteGeo = new THREE.SphereGeometry(0.12, 8, 6);
  /** Corpse harvesting (Larva). */
  private harvestTarget: Abomination | null = null;
  private harvestProgress = 0;
  private harvested = new Set<number>();
  /** Melee and Flesh Market gear (grenades, mines, Heart Husk). */
  private meleeCooldown = 0;
  private meleeQueued = false;
  private grenades: { g: Grenade; mesh: THREE.Mesh }[] = [];
  private mines: { m: Mine; mesh: THREE.Mesh }[] = [];
  private gearMat = new THREE.MeshStandardMaterial({ color: GORE.bone, emissive: GORE.cyanFluid, emissiveIntensity: 1.5 });
  private gearGeo = new THREE.IcosahedronGeometry(0.12, 1);
  private reviveLeft = 0;
  private healLeft = 0;
  private healRate = 0;
  private useLeft = 0;
  private pendingHeal = { amount: 0, duration: 0 };
  private nextReinforce = RAID.reinforcements.firstAt;
  private collapseWarned = false;
  private spireSignal = 0;
  private sinceHit = 99;
  private result: (CarriedSnapshot & { cause?: string; weapons: string[]; mods: string[][] }) | null = null;
  private classId: ClassId = 'neuroInfiltrator';
  private spawnScale: number;

  constructor(
    private scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement,
    /** Live sites for this raid (World & Level). Seed 1 is Design's RAID.larva layout. */
    readonly layout: Zone7Layout = zone7Layout(1),
    private sites?: SiteDressing,
    structures?: BuiltStructures,
    /** The zone this map was built for (habitats are placed against it); deploy may confirm it. */
    zone: string = layout.area ? 'longSeedWreck' : DEFAULT_ZONE,
  ) {
    this.zone = zone;
    this.arena = structures?.arena ?? null;
    const cls = CLASSES[this.classId];
    // Bigger zones give their own walkable radius; spawn distances keep Glowmire's scale.
    const island = Math.min(RAID.playableRadius, ISLAND_RADIUS * 0.84);
    this.playable = layout.playableRadius ?? island;
    this.spawnScale = island / RAID.playableRadius;
    scene.add(camera);

    this.player = new Player(camera, cls, HOST, canvas);
    if (layout.playableRadius) this.player.edge = layout.playableRadius;
    this.biomass = new Biomass(cls.biomass);
    this.overload = new NeuralOverload(HOST.neuralOverload, cls.overloadDecayMultiplier);
    this.fx = new Fx(scene);
    this.hazards = new Hazards(scene);
    this.projectiles = new Projectiles(scene, projectileLooks());
    this.rig = new WeaponRig(camera);
    this.arm([STARTER_WEAPON]);
    this.projectiles.onFire = (pr) => this.net?.fired(pr);
    // Contracts: what happened this raid (settled in the Hive by economy.settleContracts).
    this.bus.on('harvestDone', (e) => this.log.harvest(e.item));
    this.bus.on('creatureDeath', (e) => this.log.kill(e.type));
    this.bus.on('virusInjected', (e) => {
      if ((VIRUS_LOOKS as string[]).includes(e.virus)) this.hostArm.mutate(e.virus as VirusLook, VIRUS_RULES.mutationGrowTime);
    });

    // Sites from the World layout: Seed Spires (a late one opens mid-raid), Bio-Pods, Gene Blooms.
    for (const e of layout.extracts) {
      const point = new ExtractionPoint(e.x, e.z, RAID.extract.zoneRadius, extractTimeFor(this.classId), RAID.extract.cancelOnLeave);
      const spire = new SeedSpire(e.x, e.z, RAID.extract.zoneRadius);
      const open = e.opensAt <= 0;
      spire.root.visible = open;
      scene.add(spire.root);
      this.spires.push({ id: e.id, label: e.label, opensAt: e.opensAt, open, point, spire });
    }
    const [ex, ez] = [this.spires[0].point.x, this.spires[0].point.z];
    for (const s of [...layout.pods, ...layout.nodes.map((n) => ({ ...n, type: 'geneBloom' }))]) {
      this.dropContainer(s.type, s.x, s.z, s.id);
    }
    // Caches inside structures stand on their decks, not on the terrain.
    for (const spot of structures?.loot ?? []) {
      const pod = new BioPod(spot.id, spot.container && LOOT.containers[spot.container] ? spot.container : 'bioPod', spot.x, spot.z);
      pod.root.position.y = spot.y;
      this.pods.push(pod);
      scene.add(pod.root);
    }

    for (const n of layout.nests) this.addNest(n.id, n.type, n.x, n.z);
    if (this.arena?.id === 'reliquaryBowl' && BOSSES.reliquary) {
      this.boss = new RaidBoss(this.arena, scene, Math.floor(this.rand() * 1e6), groundHeight);
      scene.add(this.boss.body.root);
      // The collapse flood: a sheet of liquid light spreading from the centre pool.
      this.bossPool = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), liquidLight({ pool: true }));
      this.bossPool.position.set(this.arena.pool.x, this.arena.floorY + 0.12, this.arena.pool.z);
      this.bossPool.visible = false;
      scene.add(this.bossPool);
    }
    if (structures?.lair && BOSSES.paleVigil) {
      this.vigil = new RaidVigil(structures.lair, scene, Math.floor(this.rand() * 1e6));
      scene.add(this.vigil.body.root);
    }
    if (structures?.warden && BOSSES.warden) {
      this.warden = new RaidWarden(structures.warden, scene, Math.floor(this.rand() * 1e6));
      scene.add(this.warden.body.root);
    }
    if (structures?.widow && BOSSES.sandwidow) {
      this.widow = new RaidWidow(structures.widow, groundHeight, scene, Math.floor(this.rand() * 1e6));
      scene.add(this.widow.body.root);
    }
    if (this.arena?.id === 'undermouth' && BOSSES.nethermaw) {
      this.maw = new RaidNethermaw(this.arena, structures?.walkways ?? [], scene, Math.floor(this.rand() * 1e6));
      scene.add(this.maw.body.root);
    }
    if (structures?.regent && BOSSES.mireRegent) {
      this.regent = new RaidRegent(structures.regent, scene, Math.floor(this.rand() * 1e6));
      scene.add(this.regent.body.root);
    }

    const [sx, sz] = [layout.spawn.x, layout.spawn.z];
    this.player.spawn(sx, sz, Math.atan2(-(ex - sx), -(ez - sz)));
    this.player.onJump = () => { this.overload.add(HOST.neuralOverload.jumpFill); };
    this.player.onLand = (h) => {
      this.noise(this.player.position, HOST.noiseRadius.jumpLand, 'land');
      if (this.dropping) { this.dropping = 0; return; } // the drop-in lands softly
      // Impact energy scales with gravity: falls inside the Gravity Bloom land softly.
      const over = h * this.player.gravityScale - HOST.fallDamage.safeHeight;
      if (over > 0) this.hurt(over * HOST.fallDamage.damagePerMetre, 'limb', 'fall', null);
    };

    this.spawnInitial();

    this.abilities = new AbilitySystem(ABILITIES, { overload: this.overload, count: (i) => this.carried.count(i), consume: (i) => this.carried.consume(i) });
    this.abilities.register('neuralPulse', (a) => this.psychWavePulse(a as typeof ABILITIES.neuralPulse));
    this.abilities.register('clotGel', (a) => {
      this.useLeft = Number(a.useTime ?? 1.2);
      this.pendingHeal = { amount: Number(a.heal ?? 70), duration: Number(a.healDuration ?? 3) };
      this.abilities.setActive('clotGel', this.useLeft + this.pendingHeal.duration);
    });

    this.bindInput();
  }

  /** The open Seed Spire the host is channelling, else the nearest open one. */
  get currentSpire(): SpireSite {
    const p = this.player.position;
    const open = this.spires.filter((s) => s.open);
    if (!open.length) return this.spires[0];
    return open.find((s) => s.point.inside)
      ?? open.reduce((a, b) => (Math.hypot(a.point.x - p.x, a.point.z - p.z) <= Math.hypot(b.point.x - p.x, b.point.z - p.z) ? a : b));
  }
  get extract(): ExtractionPoint { return this.currentSpire.point; }
  get spire(): SeedSpire { return this.currentSpire.spire; }

  // ------------------------------------------------------------------ setup
  private habitatMap(): HabitatMap {
    return { zone: this.zone, playable: this.playable, extract: { x: this.extract.x, z: this.extract.z }, pods: this.pods.map((p) => ({ type: p.type, x: p.position.x, z: p.position.z })), rand: this.rand };
  }

  /** Design's habitats: each species starts at its home (landmark, room, band...), packed or alone, never at random. */
  private spawnHabitats(): void {
    const spawn = this.player.position;
    const minFromSpawn = Math.max(15, RAID.spawn.noEnemyWithin * this.spawnScale);
    this.homes = planHabitats(this.habitatMap()).filter((g) => ABOMINATIONS[g.kind as AbominationKind]);
    for (const g of this.homes) {
      // A home on top of the drop point would ambush the host on frame one: those groups wait for reinforcements.
      if (Math.hypot(g.home.x - spawn.x, g.home.z - spawn.z) < minFromSpawn) continue;
      this.spawnGroup(g, false);
    }
  }

  /** Places one habitat group at its home and hands each body its home and habits (PvE AI's setHome). */
  private spawnGroup(g: PlannedGroup, alertTo: { x: number; z: number } | false): number {
    const kind = g.kind as AbominationKind, data = ABOMINATIONS[kind];
    const size = g.group.packed ? data.packSize[0] + Math.floor(this.rand() * (data.packSize[1] - data.packSize[0] + 1)) : 1;
    for (let k = 0; k < size; k++) {
      const a = this.rand() * Math.PI * 2, d = this.rand() * (g.home.spread || (size > 1 ? 3 : 0));
      const c = this.addCreature(kind, g.home.x + Math.cos(a) * d, g.home.z + Math.sin(a) * d);
      c.setHome(g.home.x, g.home.z, {
        roam: g.roam, hatchOnApproach: g.group.hatchOnApproach, disguise: g.group.disguise, height: g.group.height,
      });
      if (alertTo) c.alert(alertTo);
    }
    return size;
  }

  private spawnInitial(): void {
    this.homes = [];
    // Zones that place their own life (layout.spawns): fixed homes, some buried until the host comes close.
    if (this.layout.spawns) {
      for (const s of this.layout.spawns) {
        const kind = s.kind as AbominationKind, data = ABOMINATIONS[kind];
        if (!data || !(kind in SPECIES)) continue; // no body yet (Creature builds it): skip rather than crash
        for (let n = 0; n < (s.count ?? 1); n++) {
          const size = s.packed ? data.packSize[0] + Math.floor(this.rand() * (data.packSize[1] - data.packSize[0] + 1)) : 1;
          for (let k = 0; k < size; k++) {
            const a = this.rand() * Math.PI * 2, d = (s.spread ?? 3) * Math.sqrt(this.rand());
            const c = this.addCreature(kind, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d);
            c.setHome(c.position.x, c.position.z, { roam: s.roam, hatchOnApproach: s.buried });
            if (s.buried) c.burrowed = true;
            if (s.toughness) c.biomass *= s.toughness;
          }
        }
      }
      return;
    }
    if (usesHabitats(this.zone)) { this.spawnHabitats(); return; }
    const minFromSpawn = Math.max(15, RAID.spawn.noEnemyWithin * this.spawnScale);
    const spawn = this.player.position;
    const [ex, ez] = [this.extract.x, this.extract.z];
    // Spore spawns plus the Larva roster (Glasswalkers, an Oculimoth swarm, a Mournback).
    for (const g of [...RAID.spawnGroups, ...(RAID.larva?.spawnGroups ?? [])]) {
      const kind = g.type as AbominationKind;
      const data = ABOMINATIONS[kind];
      for (let n = 0; n < g.count; n++) {
        let cx = 0, cz = 0;
        for (let tries = 0; tries < 30; tries++) {
          if (g.guardsContainer && this.pods.length) {
            const p = this.pods[n % this.pods.length].position, a = this.rand() * Math.PI * 2;
            cx = p.x + Math.cos(a) * 5; cz = p.z + Math.sin(a) * 5;
          } else if (g.nearExtract) {
            const a = this.rand() * Math.PI * 2, d = 8 + this.rand() * 8;
            cx = ex + Math.cos(a) * d; cz = ez + Math.sin(a) * d;
          } else {
            const [lo, hi] = g.radius;
            const ar = this.layout.area;
            const [x, z] = ar ? [ar.x0 + this.rand() * (ar.x1 - ar.x0), ar.z0 + this.rand() * (ar.z1 - ar.z0)]
              : layoutPosition({ radius: lo + this.rand() * (hi - lo), bearing: this.rand() * 360 }, this.playable);
            cx = x; cz = z;
          }
          if (Math.hypot(cx - spawn.x, cz - spawn.z) >= minFromSpawn) break;
        }
        const size = g.packed ? data.packSize[0] + Math.floor(this.rand() * (data.packSize[1] - data.packSize[0] + 1)) : 1;
        for (let k = 0; k < size; k++) {
          const a = this.rand() * Math.PI * 2, d = size > 1 ? 1.5 + this.rand() * 2.5 : 0;
          this.addCreature(kind, cx + Math.cos(a) * d, cz + Math.sin(a) * d);
        }
      }
    }
  }

  private addCreature(kind: AbominationKind, x: number, z: number, seed = Math.floor(this.rand() * 1e9)): Abomination {
    const r = Math.hypot(x, z), edge = this.playable * 0.95, ar = this.layout.area;
    if (ar) { x = Math.min(ar.x1, Math.max(ar.x0, x)); z = Math.min(ar.z1, Math.max(ar.z0, z)); }
    else if (r > edge) { x *= edge / r; z *= edge / r; }
    const c = new Abomination(kind, ABOMINATIONS[kind], x, z, seed);
    this.creatures.push(c);
    this.scene.add(c.root);
    // Creatures spawned after the first frame miss the pipeline's one-time software-tier simplification.
    if (this.pipeline.quality === 'low') simplifyForSoftware(c.root);
    return c;
  }

  /** Online guests: a creature the squad leader spawned (reinforcement, nest brood), with the leader's seed. */
  netSpawn(kind: AbominationKind, x: number, z: number, seed: number): Abomination {
    const c = this.addCreature(kind, x, z, seed);
    c.place(x, z);
    return c;
  }

  private reinforce(): void {
    const alive = this.creatures.filter((c) => c.alive).length;
    const min = Math.max(15, RAID.reinforcements.spawnMinDistanceFromPlayer * this.spawnScale);
    if (this.homes.length) {
      // Reinforcements walk in from the nearest home of their species that the host cannot see.
      const p = this.player.position;
      const fwd = { x: -Math.sin(this.player.yaw), z: -Math.cos(this.player.yaw) };
      let total = alive;
      for (const w of RAID.reinforcements.wave) {
        for (let n = 0; n < w.count; n++) {
          const homes = this.homes.filter((g) => g.kind === w.type).map((g) => {
            const dx = g.home.x - p.x, dz = g.home.z - p.z, d = Math.hypot(dx, dz);
            return { g, d, seen: d < 60 && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.5 };
          }).filter((h) => h.d >= min && !h.seen).sort((a, b) => a.d - b.d);
          if (!homes[0]) continue;
          const kind = w.type as AbominationKind;
          if (total + (w.packed ? ABOMINATIONS[kind].packSize[1] : 1) > RAID.reinforcements.maxAlive) return;
          total += this.spawnGroup({ ...homes[0].g, group: { ...homes[0].g.group, packed: w.packed } }, { x: p.x, z: p.z });
        }
      }
      return;
    }
    for (const w of RAID.reinforcements.wave) {
      const kind = w.type as AbominationKind;
      for (let n = 0; n < w.count; n++) {
        const size = w.packed ? ABOMINATIONS[kind].packSize[0] + Math.floor(this.rand() * (ABOMINATIONS[kind].packSize[1] - ABOMINATIONS[kind].packSize[0] + 1)) : 1;
        if (alive + size > RAID.reinforcements.maxAlive) return;
        // Behind the host, out of view, at least `min` away.
        const back = this.player.yaw + (this.rand() - 0.5) * 1.6;
        const d = min + this.rand() * 10;
        const cx = this.player.position.x + Math.sin(back) * d, cz = this.player.position.z + Math.cos(back) * d;
        for (let k = 0; k < size; k++) {
          const c = this.addCreature(kind, cx + (this.rand() - 0.5) * 4, cz + (this.rand() - 0.5) * 4);
          c.alert();
        }
      }
    }
  }

  private bindInput(): void {
    const locked = () => document.pointerLockElement === this.canvas;
    addEventListener('mousedown', (e) => {
      if (!locked() || this.phase !== 'raid') return;
      if (e.button === 0) this.trigger = true;
      if (e.button === 2) this.aimHeld = true;
      if (e.button === 1) { this.egoQueued = true; e.preventDefault(); }
    });
    addEventListener('wheel', (e) => {
      if (!locked() || this.phase !== 'raid' || Math.abs(e.deltaY) < 1) return;
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.trigger = false;
      if (e.button === 2) this.aimHeld = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (this.phase !== 'raid' || e.repeat) return;
      if (e.code === 'KeyR') { if (this.weapon.reload()) this.onReload(); }
      if (e.code === 'KeyF') this.egoQueued = true;
      if (e.code === 'Digit1' || e.code === 'KeyQ') this.useAbility(1);
      if (e.code === 'Digit2') this.useAbility(2);
      if (e.code === 'KeyV') this.meleeQueued = true;
      if (e.code === 'KeyG') this.throwGrenade();
      if (e.code === 'KeyX') this.placeMine();
      if (e.code === 'KeyZ') this.cycleWeapon(1);
    });
  }

  /** Deploys from the Hive with the profile's loadout and starts the raid clock. */
  deploy(d: Deployment): void {
    if (this.phase !== 'briefing') return;
    this.carried.load(d.loadout, d.cavitySize, d.pouchSize);
    if (d.weapons?.length) this.arm(d.weapons, d.mods);
    this.zone = d.zone ?? DEFAULT_ZONE;
    this.log = new RaidLog(this.zone);
    this.begin();
  }

  /** Starts the raid clock with whatever is carried (the Hive menu calls `deploy`). */
  begin(): void {
    if (this.phase !== 'briefing') return;
    this.phase = 'raid';
    // Drop-in (World layout): the host falls into the zone from high above the spawn, steering on the way down.
    // Automated runs and `?nodrop` start on the ground so scripted tests stay quick and deterministic.
    const drop = this.layout.dropIn;
    if (drop && typeof navigator !== 'undefined' && !navigator.webdriver && !new URLSearchParams(location.search).has('nodrop')) {
      this.player.position.y += drop.height;
      this.player.grounded = false;
      this.dropping = drop.fallSpeed;
    }
    this.bus.emit('raidStart', { raidTime: RAID.raidTime });
  }

  // ------------------------------------------------------------------ actions
  private useAbility(slot: number): void {
    const id = this.abilities.bySlot(slot);
    if (!id) return;
    const r = this.abilities.use(id);
    if (r === 'ok') this.bus.emit('ability', { id, slot });
    else if (r !== 'unknown') this.bus.emit('abilityDenied', { id, reason: r });
  }

  private psychWavePulse(a: typeof ABILITIES.neuralPulse): void {
    const p = this.player.position;
    const radius = Number(a.radius), dmgR = Number(a.damageRadius), reveal = Number(a.revealDuration);
    this.fx.ring(p, GORE.cyanFluid, radius, 1.1);
    this.fx.ring(p, GORE.violetFluid, dmgR, 0.4);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
      if (d <= radius) c.revealed = reveal;
      if (d <= dmgR) {
        const dir = tmp.set(c.position.x - p.x, 0, c.position.z - p.z).normalize().clone();
        this.damageCreature(c, Number(a.damage), false, dir, c.centre, 'pulse');
        c.stagger(Number(a.staggerDuration));
      }
    }
    this.player.addTrauma(0.25);
  }

  private onReload(): void {
    this.bus.emit('reload', { weapon: this.weapon.id, time: this.weapon.state.reloadTotal });
    this.noise(this.player.position, HOST.noiseRadius.reload, 'reload');
  }

  private noise(at: THREE.Vector3, radius: number, source: string): void {
    this.noises.push({ x: at.x, z: at.z, radius });
    this.net?.noise(at.x, at.z, radius);
    this.bus.emit('noise', { position: { x: at.x, y: at.y, z: at.z }, radius, source });
  }

  hurt(amount: number, zone: 'head' | 'torso' | 'limb', source: string, from: THREE.Vector3 | null): void {
    if (this.phase !== 'raid' || amount <= 0 || this.reviveLeft > 0) return;
    const applied = this.biomass.damage(amount * HOST.hitZones[zone]);
    let direction = null;
    if (from) {
      const d = from.clone().sub(this.player.position); d.y = 0; d.normalize();
      direction = { x: d.x, y: 0, z: d.z };
    }
    this.sinceHit = 0;
    this.player.addTrauma(Math.min(0.6, applied / 40));
    if (applied >= 3 && from) {
      // The host's own blood: a spray in front of the camera toward the attacker (red is reserved for player damage).
      const eye = this.player.eyePosition.clone();
      const toward = from.clone().sub(eye); toward.y = 0; toward.normalize();
      const at = eye.addScaledVector(toward, 0.7).add(new THREE.Vector3(0, -0.35, 0));
      gore.burst(this.scene, { point: at, normal: toward.clone().negate().setY(0.4), colour: HIVE.danger, count: Math.min(60, 10 + applied * 2), speed: 3.5 });
      const p = this.player.position;
      gore.splat(this.scene, { point: new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z), normal: new THREE.Vector3(0, 1, 0), size: 0.6 + applied / 30, colour: HIVE.danger });
    }
    this.pipeline.hitPulse?.(Math.min(1, applied / 30));
    this.bus.emit('damaged', { amount: applied, biomass: this.biomass.current, zone, source, direction });
    if (this.biomass.dead && !this.tryRevive()) this.lose(source);
  }

  /**
   * Wound VFX from Rendering's gore library: a glowing splat that sticks to the creature mesh that was hit
   * (decals follow it as it moves) plus a droplet spray. Decals are throttled per creature to keep CPU cost flat.
   */
  private wound(c: Abomination, at: THREE.Vector3, dir: THREE.Vector3 | null, weak: boolean): void {
    const colour = `#${c.fluid.getHexString()}`;
    const back = (dir ?? new THREE.Vector3(0, -1, 0)).clone().normalize();
    gore.burst(this.scene, { point: at, normal: back.clone().negate(), colour, count: weak ? 34 : 16, speed: weak ? 7 : 4.5 });
    const now = this.elapsed;
    if (now - (this.lastDecal.get(c.id) ?? -1) < 0.15) return;
    this.lastDecal.set(c.id, now);
    this.raycaster.set(at.clone().addScaledVector(back, -0.8), back);
    this.raycaster.far = 2;
    const hit = this.raycaster.intersectObject(c.root, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.name !== 'gore-splat' && h.face);
    if (!hit) return;
    const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
    gore.splat(this.scene, { point: hit.point, normal, target: hit.object as THREE.Mesh, size: weak ? 0.45 : 0.3, colour });
  }

  private damageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, source: string, sphere?: HitSphere): void {
    if (!c.alive) return;
    if (this.net && !this.net.authority) {
      // Online guest: the leader owns the creature's biomass. Show the wound now; the kill arrives from the leader.
      this.net.damageCreature(c, amount, weak, dir, at, sphere);
      this.fx.bleed(at, dir ?? new THREE.Vector3(0, -1, 0), c.fluid, weak ? 12 : 5);
      this.wound(c, at, dir, weak);
      this.bus.emit('hit', { target: c.kind, id: c.id, damage: amount, weakPoint: weak, kill: false, position: { x: at.x, y: at.y, z: at.z } });
      if (this.injection.active === 'plagueStalkerStrain' && source !== 'debug') this.spores.infect(c.id);
      return;
    }
    const kill = c.damage(amount, dir, sphere);
    this.fx.bleed(at, dir ?? new THREE.Vector3(0, -1, 0), c.fluid, weak ? 12 : 5);
    this.wound(c, at, dir, weak);
    this.bus.emit('hit', { target: c.kind, id: c.id, damage: amount, weakPoint: weak, kill, position: { x: at.x, y: at.y, z: at.z } });
    if (!kill && this.injection.active === 'plagueStalkerStrain' && source !== 'debug') this.spores.infect(c.id);
    if (kill) this.onKill(c);
  }

  /**
   * Online leader: damage another host dealt to creature `c` (relayed by src/net). The leader applies it so one
   * machine decides every death; `by` gets the kill credit.
   */
  netDamageCreature(c: Abomination, amount: number, weak: boolean, dir: THREE.Vector3 | null, at: THREE.Vector3, sphere: HitSphere | undefined, by: string): void {
    if (!c.alive) return;
    const kill = c.damage(amount, dir, sphere);
    this.fx.bleed(at, dir ?? new THREE.Vector3(0, -1, 0), c.fluid, weak ? 12 : 5);
    this.wound(c, at, dir, weak);
    if (kill) { this.deathFx(c); this.net?.killed(c, by); }
  }

  /** Online guests: the leader says creature `c` died; `mine` when this host landed the killing blow. */
  netKilled(c: Abomination, mine: boolean): void {
    if (!c.alive) return;
    c.killedRemotely();
    this.deathFx(c);
    if (mine) this.creditKill(c);
  }

  /** A corpse another host harvested: it cannot be harvested again here. */
  netHarvested(c: Abomination): void { this.harvested.add(c.id); if (this.harvestTarget === c) { this.harvestTarget = null; this.harvestProgress = 0; } }

  private onKill(c: Abomination): void {
    this.deathFx(c);
    this.creditKill(c);
    this.net?.killed(c, null);
  }

  /** What every machine shows when a creature dies: the fountain, the pool, the Bile Cantor's death cloud. */
  private deathFx(c: Abomination): void {
    this.fx.burst(c.centre.clone(), c.fluid, c.kind === 'bilecantor' ? 1.8 : 1);
    {
      // Death: a big fountain and a glowing pool where the body falls.
      const colour = `#${c.fluid.getHexString()}`;
      const big = c.kind === 'bilecantor';
      gore.burst(this.scene, { point: c.centre.clone(), colour, count: big ? 160 : 90, speed: big ? 10 : 8 });
      const g = new THREE.Vector3(c.position.x, groundHeight(c.position.x, c.position.z), c.position.z);
      gore.splat(this.scene, { point: g, normal: new THREE.Vector3(0, 1, 0), size: big ? 5 : 2.6, colour });
      this.lastDecal.delete(c.id);
      if (c.kind === 'bilecantor') {
        const cloud = ABOMINATIONS.bilecantor.deathCloud as { radius: number; duration: number; damagePerSecond: number; overloadPerSecond: number };
        this.hazards.deathCloud(c.position.x, c.centre.y - 1.5, c.position.z, cloud.radius, cloud.damagePerSecond, cloud.overloadPerSecond, cloud.duration);
      }
    }
  }

  /** The kill's rewards, for the host that landed it: kill count, DNA, contracts, virus on-kill effects. */
  private creditKill(c: Abomination): void {
    {
      this.kills++;
      const dna = ABOMINATIONS[c.kind].dnaDrop;
      this.carried.dna += dna;
      this.bus.emit('creatureDeath', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z }, dna });
      // Plague-Stalker: an infected death spreads spores to its neighbours.
      if (this.spores.stacksOf(c.id) > 0) {
        this.spores.clear(c.id);
        for (const o of this.creatures) if (o.alive && o.position.distanceTo(c.position) <= this.spores.r.spreadOnDeathRadius) this.spores.infect(o.id);
        this.fx.burst(c.centre.clone(), GORE.violetFluid, 1.2);
      }
      if (this.injection.active === 'splicedParasites') this.spawnParasite(c.centre);
      this.hostArm.onKill(this.scene);
    }
  }

  // ------------------------------------------------------------------ viruses
  /** Starts injecting the virus stack at `index` of a cavity or pouch zone. Returns false if it cannot. */
  inject(zone: 'cavity' | 'pouch', index: number): boolean {
    if (this.phase !== 'raid' || this.injection.injecting) return false;
    const grid = zone === 'cavity' ? this.carried.cavity : this.carried.pouch;
    const e = grid.entries[index];
    const virus = e ? virusForItem(e.item) : null;
    if (!e || !virus || !this.injection.start(virus)) return false;
    if (--e.count <= 0) grid.take(e);
    this.injectingItem = e.item;
    this.noise(this.player.position, VIRUS_RULES.injectNoise, 'inject');
    this.bus.emit('virusInjectStart', { virus, time: VIRUS_RULES.injectTime });
    return true;
  }

  /** Aborts an injection; the vial goes back into the cavities (or pouch). */
  cancelInject(): boolean {
    const virus = this.injection.cancel();
    if (!virus) return false;
    if (this.injectingItem) this.carried.add(this.injectingItem, 1);
    this.injectingItem = null;
    this.bus.emit('virusInjectCancel', { virus });
    return true;
  }

  private onVirus(virus: string): void {
    this.biomass.scaleMax(virusModifiers(virus).biomassMax);
    const item = this.injectingItem ?? VIRUSES[virus].item;
    this.injectingItem = null;
    this.bus.emit('virusInjected', { virus, item });
  }

  private spawnParasite(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.parasiteGeo, this.parasiteMat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    const r = (VIRUSES.splicedParasites.effect as { parasiteOnKill: { lifetime: number } }).parasiteOnKill;
    this.parasites.push({ mesh, target: null, life: r.lifetime });
  }

  private updateVirusEffects(dt: number): void {
    // Spore infection damage over time (no hit gore per tick, just the kill).
    for (const [id, dmg] of this.spores.update(dt)) {
      const c = this.creatures.find((x) => x.id === id);
      if (!c?.alive) { this.spores.clear(id); continue; }
      if (this.net && !this.net.authority) { this.net.damageCreature(c, dmg, false, null, c.centre); continue; }
      if (c.damage(dmg, null)) { this.bus.emit('hit', { target: c.kind, id: c.id, damage: dmg, weakPoint: false, kill: true, position: { x: c.centre.x, y: c.centre.y, z: c.centre.z } }); this.onKill(c); }
    }
    // Parasites seek the nearest Abomination and bite once.
    if (!this.parasites.length) return;
    const r = (VIRUSES.splicedParasites.effect as { parasiteOnKill: { damage: number; seekRadius: number; speed: number } }).parasiteOnKill;
    const drain = Number((VIRUSES.splicedParasites.cost as { biomassDrainPerSecondWhileParasiteAlive?: number }).biomassDrainPerSecondWhileParasiteAlive ?? 0);
    for (let i = this.parasites.length - 1; i >= 0; i--) {
      const q = this.parasites[i];
      q.life -= dt;
      if (!q.target?.alive) {
        q.target = null;
        let bd = r.seekRadius;
        for (const c of this.creatures) { const d = c.alive ? c.centre.distanceTo(q.mesh.position) : Infinity; if (d < bd) { bd = d; q.target = c; } }
      }
      let bit = false;
      if (q.target) {
        const to = q.target.centre.clone().sub(q.mesh.position);
        const d = to.length();
        if (d < 0.7) {
          this.damageCreature(q.target, r.damage, false, to.normalize(), q.target.centre.clone(), 'parasite');
          bit = true;
        } else q.mesh.position.addScaledVector(to, Math.min(1, (r.speed * dt) / d));
      }
      if (bit || q.life <= 0) { this.scene.remove(q.mesh); this.parasites.splice(i, 1); }
    }
    if (this.parasites.length && drain > 0) {
      this.biomass.damage(drain * dt);
      if (this.biomass.dead && !this.tryRevive()) this.lose('spliced parasites');
    }
  }

  // ------------------------------------------------------------------ melee and Flesh Market gear
  private updateGear(dt: number): void {
    const p = this.player;
    // Heart Husk revive: frozen and untouchable while the husk regrows you.
    if (this.reviveLeft > 0) {
      this.reviveLeft -= dt;
      p.speedMultiplier = 0;
      if (this.reviveLeft <= 0) {
        this.biomass.current = this.biomass.max * huskRules().reviveFraction;
        this.fx.burst(p.position.clone().add(new THREE.Vector3(0, 1, 0)), GORE.flesh, 1.4);
        this.bus.emit('revived', { biomass: this.biomass.current });
      }
    }
    // Melee: a short lunge and a strike on the nearest Abomination in front.
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (this.meleeQueued) {
      this.meleeQueued = false;
      const k = KITS[this.classId].melee;
      if (this.meleeCooldown <= 0 && this.reviveLeft <= 0) {
        this.meleeCooldown = k.cooldown;
        const fwd = p.forward(new THREE.Vector3()).setY(0).normalize();
        p.velocity.addScaledVector(fwd, Number(k.lunge ?? 0) * 4);
        let best: Abomination | null = null, bd = k.range + 0.6;
        for (const c of this.creatures) {
          if (!c.alive) continue;
          const to = c.centre.clone().sub(p.eyePosition);
          const d = Math.hypot(to.x, to.z) - c.radius * 0.5;
          if (d < bd && to.setY(0).normalize().dot(fwd) > 0.55) { bd = d; best = c; }
        }
        if (best) {
          this.damageCreature(best, k.damage, false, fwd.clone(), best.centre.clone(), 'melee');
          best.stagger(0.4);
          p.addTrauma(0.25);
        }
        this.noise(p.position, HOST.noiseRadius.gunfire * 0.3, 'melee');
        this.bus.emit('melee', { id: k.id, hit: best ? best.id : null });
      }
    }
    // Grenades in flight.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const q = this.grenades[i];
      const boom = q.g.update(dt, groundHeight);
      q.mesh.position.set(q.g.pos.x, q.g.pos.y, q.g.pos.z);
      if (!boom) continue;
      this.scene.remove(q.mesh);
      this.grenades.splice(i, 1);
      const at = q.mesh.position.clone();
      this.fx.ring(at, GORE.cyanFluid, q.g.r.radius, 0.6);
      this.fx.burst(at, GORE.violetFluid, 1.2);
      gore.burst(this.scene, { point: at, colour: `#${GORE.cyanFluid.getHexString()}`, count: 80, speed: 9 });
      this.noise(at, HOST.noiseRadius.egoCharge, 'grenade');
      for (const c of this.creatures) {
        if (!c.alive) continue;
        const dmg = q.g.damageAt(c.centre.distanceTo(at));
        if (dmg <= 0) continue;
        this.damageCreature(c, dmg, false, c.centre.clone().sub(at).normalize(), c.centre.clone(), 'grenade');
        c.stagger(q.g.r.overload / 40);
      }
      for (const n of this.nests) {
        if (!n.alive) continue;
        const core = n.core(new THREE.Vector3()), dmg = q.g.damageAt(core.distanceTo(at));
        if (dmg > 0) this.damageNest(n, dmg, null, core);
      }
      if (this.boss?.alive) {
        const core = this.boss.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - this.boss.body.body.radius));
        if (dmg > 0) this.damageBoss(dmg, null, at, core);
      }
      if (this.vigil?.alive && !this.vigil.brain.hidden) {
        const core = this.vigil.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - 1));
        if (dmg > 0) this.damageVigil(dmg, null, core);
      }
      if (this.widow?.alive && !this.widow.brain.submerged) {
        const core = this.widow.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - 2));
        if (dmg > 0) this.damageWidow(dmg, null, core);
      }
      if (this.warden?.alive) {
        const core = this.warden.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - 1.5));
        if (dmg > 0) this.damageWarden(dmg, null, core);
      }
      if (this.maw?.alive) {
        const core = this.maw.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - 6));
        if (dmg > 0) this.damageMaw(dmg, null, core);
      }
      if (this.regent?.alive) {
        const core = this.regent.centre(new THREE.Vector3()), dmg = q.g.damageAt(Math.max(0, core.distanceTo(at) - 3));
        if (dmg > 0) this.damageRegent(dmg, null, core);
      }
      const self = p.position.distanceTo(at);
      if (self <= q.g.r.radius) { this.overload.add(q.g.r.overload); this.hurt(q.g.damageAt(self) * 0.5, 'torso', 'own grenade', at); }
      this.bus.emit('explosion', { item: 'neuroSpikeGrenade', position: { x: at.x, y: at.y, z: at.z } });
    }
    // Mines.
    const alive = this.creatures.filter((c) => c.alive);
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const q = this.mines[i];
      const hit = q.m.update(dt, alive.map((c) => c.position));
      (q.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = q.m.armed ? 2.5 + Math.sin(this.elapsed * 8) : 0.4;
      if (hit < 0) continue;
      const c = alive[hit];
      this.scene.remove(q.mesh);
      this.mines.splice(i, 1);
      this.damageCreature(c, q.m.r.damage, false, new THREE.Vector3(0, 1, 0), c.centre.clone(), 'mine');
      c.stagger(q.m.r.root);
      gore.burst(this.scene, { point: c.centre.clone(), colour: `#${c.fluid.getHexString()}`, count: 70, speed: 7 });
      this.noise(c.position, HOST.noiseRadius.gunfire, 'mine');
      this.bus.emit('explosion', { item: 'mawSeedMine', position: { x: c.position.x, y: c.position.y, z: c.position.z } });
    }
  }

  /** Throws a Neuro-Spike Grenade from the cavities (or pouch). */
  throwGrenade(): boolean {
    if (this.phase !== 'raid' || this.reviveLeft > 0 || !this.carried.consume('neuroSpikeGrenade')) return false;
    const eye = this.player.eyePosition, dir = this.player.forward(new THREE.Vector3());
    const g = new Grenade({ x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6 - 0.1, z: eye.z + dir.z * 0.6 }, throwVelocity(dir));
    const mesh = new THREE.Mesh(this.gearGeo, this.gearMat);
    this.scene.add(mesh);
    this.grenades.push({ g, mesh });
    this.bus.emit('gearUsed', { item: 'neuroSpikeGrenade' });
    return true;
  }

  /** Plants a Maw-Seed Mine at the host's feet. */
  placeMine(): boolean {
    if (this.phase !== 'raid' || this.reviveLeft > 0 || !this.carried.consume('mawSeedMine')) return false;
    const p = this.player.position;
    const m = new Mine({ x: p.x, y: groundHeight(p.x, p.z), z: p.z });
    const mesh = new THREE.Mesh(this.gearGeo, this.gearMat.clone());
    mesh.scale.set(2.2, 0.6, 2.2);
    mesh.position.set(m.pos.x, m.pos.y + 0.05, m.pos.z);
    this.scene.add(mesh);
    this.mines.push({ m, mesh });
    this.bus.emit('gearUsed', { item: 'mawSeedMine' });
    return true;
  }

  /** Heart Husk: on lethal damage, spend one and regrow after a delay instead of dying. */
  private tryRevive(): boolean {
    if (this.reviveLeft > 0) return true;
    if (!this.carried.consume('heartHusk')) return false;
    this.reviveLeft = huskRules().reviveDelay;
    this.biomass.current = 0.001;
    this.bus.emit('reviving', { time: this.reviveLeft });
    return true;
  }

  // ------------------------------------------------------------------ in-raid inventory (UI & HUD's Tab overlay)
  /** The opened Bio-Pod within reach, as the third inventory zone, or null. */
  openContainer(): { id: string; type: string; items: { item: string; count: number }[] } | null {
    const pod = this.nearOpenPod();
    return pod ? { id: pod.id, type: pod.type, items: pod.remaining.map((s) => ({ ...s })) } : null;
  }

  private nearOpenPod(): BioPod | null {
    const p = this.player.position;
    return this.pods.find((q) => q.opened && Math.hypot(q.position.x - p.x, q.position.z - p.z) < 2.4 && Math.abs(q.position.y - p.y) < 2) ?? null;
  }

  /**
   * Moves the stack at `index` of zone `from` into zone `to`: at (x, y, rotated) when given, otherwise stacked and
   * first-fit. 'pod' is the opened Bio-Pod in reach (`openContainer`). Returns how many moved; never drops anything.
   */
  transfer(from: 'cavity' | 'pouch' | 'pod', index: number, to: 'cavity' | 'pouch' | 'pod', x?: number, y?: number, rotated = false): number {
    if (this.phase !== 'raid' || from === to) return 0;
    const pod = this.nearOpenPod();
    const grid = (z: string) => (z === 'cavity' ? this.carried.cavity : z === 'pouch' ? this.carried.pouch : null);
    let src: Placed | { item: string; count: number } | undefined;
    if (from === 'pod') src = pod?.remaining[index]; else src = grid(from)!.entries[index];
    if (!src || (to === 'pod' && !pod) || (from === 'pod' && !pod)) return 0;
    let moved: number;
    const dst = grid(to);
    if (dst) {
      if (x !== undefined && y !== undefined) moved = dst.place(src.item, src.count, x, y, rotated) ? src.count : 0;
      else moved = src.count - dst.add(src.item, src.count);
    } else {
      const s = pod!.remaining.find((r) => r.item === src!.item);
      if (s) s.count += src.count; else pod!.remaining.push({ item: src.item, count: src.count });
      moved = src.count;
    }
    if (moved <= 0) return 0;
    src.count -= moved;
    if (src.count <= 0) {
      if (from === 'pod') pod!.remaining.splice(index, 1); else grid(from)!.take(src as Placed);
    }
    this.bus.emit('inventoryChanged', { from, to, item: src.item, count: moved });
    return moved;
  }

  private lose(cause: string): void {
    if (this.phase !== 'raid') return;
    this.phase = 'lost';
    this.result = { ...this.carried.snapshot(), cause, weapons: this.weapons.map((w) => w.id), mods: this.weapons.map((w) => [...w.spec.mods]) };
    this.player.enabled = false;
    this.trigger = false;
    this.bus.emit('death', { cause, items: this.result.items, dna: this.result.dna, value: this.result.value });
    this.bus.emit('raidEnd', { result: 'lost', value: this.result.value, kills: this.kills, time: this.elapsed });
    document.exitPointerLock?.();
  }

  private win(): void {
    if (this.phase !== 'raid') return;
    this.phase = 'extracted';
    this.result = { ...this.carried.snapshot(), weapons: this.weapons.map((w) => w.id), mods: this.weapons.map((w) => [...w.spec.mods]) };
    this.player.enabled = false;
    this.trigger = false;
    this.spire.launch();
    this.bus.emit('extractDone', { items: this.result.items, dna: this.result.dna, value: this.result.value });
    this.bus.emit('raidEnd', { result: 'extracted', value: this.result.value, kills: this.kills, time: this.elapsed });
    document.exitPointerLock?.();
  }

  get outcome(): typeof this.result { return this.result; }

  // ------------------------------------------------------------------ frame
  /** First creature along the crosshair ray, or a far point. Used to converge spores from the muzzle. */
  aimPoint(): THREE.Vector3 {
    if (this.debugAim) return this.debugAim.clone();
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const far = origin.clone().addScaledVector(dir, 80);
    let best = 1;
    this.aimTarget = null;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      for (const h of c.hitSpheres) {
        const t = segmentSphere(origin, far, h.world, h.r);
        if (t !== null && t < best && t > 0.002) { best = t; this.aimTarget = { weak: c.isLiveWeakPoint(h) }; }
      }
    }
    // March the ground so spores land where the crosshair points at terrain.
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      if (t >= best) break;
      const p = origin.clone().lerp(far, t);
      if (p.y < groundHeight(p.x, p.z)) { best = t; break; }
    }
    return origin.lerp(far, best);
  }

  update(rawDt: number): void {
    const dt = rawDt * this.timeScale;
    const p = this.player;
    const live = this.phase === 'raid';
    if (live) { this.elapsed += dt; this.timeLeft = Math.max(0, RAID.raidTime - this.elapsed); }
    this.noises.length = 0;
    this.net?.heard(this.noises);

    // Movement and Overload.
    p.canSprint = !this.overload.overloaded && this.useLeft <= 0;
    p.slowed = this.useLeft > 0 ? Number(ABILITIES.clotGel.movementMultiplierWhileUsing ?? 0.6) : 1;
    p.speedMultiplier = (this.injection.injecting ? VIRUS_RULES.injectMovementMultiplier : 1) * (this.boss && this.boss.pinned > 0 ? 0 : 1) * (this.vigil && this.vigil.pinned > 0 ? 0 : 1) * (this.regent && this.regent.pinned > 0 ? 0 : 1) * (this.rootedFor > 0 ? 0 : 1) * this.widowSlow * this.weapon.spec.handling.moveSpeed;
    const mods = virusModifiers(this.injection.active);
    p.sprintBoost = mods.sprint;
    p.footstepScale = mods.footstep;
    this.overload.decayBoost = mods.overloadDecay;
    const wasOver = this.overload.overloaded;
    // Gravity Bloom anomaly: lighter gravity in its field (World layout).
    p.gravityScale = gravityAt(this.layout, p.position.x, p.position.z);
    if (this.dropping) p.velocity.y = -this.dropping;
    p.carry.copy(this.mawPull);
    p.update(dt);
    if (live && p.sprinting) this.overload.add(HOST.neuralOverload.sprintFillPerSecond * dt);
    this.overload.update(dt);
    if (!wasOver && this.overload.overloaded) this.bus.emit('overload', { duration: HOST.neuralOverload.overloadedDuration });
    this.pipeline.setOverload?.(this.overload.overloaded ? 1 : this.overload.fraction);
    const steps = p.footstepNoise;
    if (live && steps > 0) this.noises.push({ x: p.position.x, z: p.position.z, radius: steps });

    // Clot Gel: apply, then heal over time.
    if (this.useLeft > 0) {
      this.useLeft -= dt;
      if (this.useLeft <= 0) { this.healLeft = this.pendingHeal.duration; this.healRate = this.pendingHeal.amount / this.pendingHeal.duration; }
    } else if (this.healLeft > 0) {
      const step = Math.min(this.healLeft, dt);
      this.healLeft -= step;
      const h = this.biomass.heal(this.healRate * step);
      if (h > 0) this.bus.emit('healed', { amount: h, biomass: this.biomass.current });
    }

    // Virus: injection channel, spore infection ticks, parasites.
    if (live) {
      const done = this.injection.update(dt);
      if (done) this.onVirus(done);
      this.updateVirusEffects(dt);
    }

    if (live) this.updateGear(dt);

    // Weapon.
    for (const c of this.creatures) c.refreshHitSpheres();
    const trigger = live && (this.debugTrigger ?? this.trigger);
    const w = this.weapon;
    const fire = w.update(dt, trigger, live && this.aimHeld, { aimPoint: this.aimPoint(), moving: p.moving, sprinting: p.sprinting }, !this.rig.equipping);
    if (fire.shots > 0) {
      const rc = w.spec.recoil;
      p.kick(rc.pitch * (Math.PI / 180) * fire.shots * (1 - w.aim * 0.5));
      p.yaw += (this.rand() - 0.5) * rc.yawJitter * (Math.PI / 180) * fire.shots;
      // Screen shake per class from Design's feel table, halved while aiming down the sight.
      p.addTrauma((WEAPON_FEEL.fire[w.spec.class]?.shake ?? 0.06) * (1 - w.aim * 0.5));
      for (let i = 0; i < fire.shots; i++) this.rig.fired(fire.kick);
      // The body exhales each shot at its muzzle (spray look by its muzzleFx, size by the class's fire feel).
      w.model.muzzle.getWorldPosition(MUZZLE_AT);
      this.camera.getWorldDirection(MUZZLE_DIR);
      this.fx.muzzle(MUZZLE_AT, MUZZLE_DIR, w.model.muzzleFx, MUZZLE_TINT.set(w.model.flashColour), WEAPON_FEEL.fire[w.spec.class]?.flash);
      if (w.spec.overloadPerShot) this.overload.add(w.spec.overloadPerShot * fire.shots); // charge weapons heat the host
      this.noise(p.position, HOST.noiseRadius.gunfire * w.spec.noise.gunfire, 'gunfire');
      this.bus.emit('shot', { weapon: w.id, ammo: w.state.ammo, position: { x: p.position.x, y: p.position.y, z: p.position.z }, ego: false });
    }
    if (fire.startedReload) this.onReload();
    this.playReloadBeats(w, fire.startedReload);
    if (fire.reloaded) this.bus.emit('reloaded', { weapon: w.id, ammo: w.state.ammo });
    if (this.egoQueued) {
      this.egoQueued = false;
      if (live && w.egoReady) {
        if (this.overload.overloaded) this.bus.emit('abilityDenied', { id: 'egoCharge', reason: 'overloaded' });
        else if (w.fireEgo(this.aimPoint())) {
          this.overload.add(w.spec.egoCharge!.overloadFill);
          this.noise(p.position, HOST.noiseRadius.egoCharge, 'egoCharge');
          p.addTrauma(0.3);
          p.kick(0.05);
          this.rig.fired(w.lastKick);
          this.bus.emit('shot', { weapon: w.id, ammo: w.state.ammo, position: { x: p.position.x, y: p.position.y, z: p.position.z }, ego: true });
        }
      }
    }
    // Aiming down sights zooms by the weapon's ads.zoom (weapons without ADS never zoom).
    p.zoom = 1 + (w.adsZoom - 1) * THREE.MathUtils.smoothstep(w.aim, 0, 1);
    this.rig.update(dt, { yaw: p.yaw, pitch: p.pitch, speed: Math.hypot(p.velocity.x, p.velocity.z), sprinting: p.sprinting, grounded: p.grounded },
      { ammoFrac: w.state.ammo / w.spec.magazine, aim: w.aim, ego: w.egoFraction, charge: fire.charge, reloading: w.state.isReloading, look: this.lookTarget(), eyeScope: w.eyeScope });

    // Abilities.
    this.abilities.update(dt);

    // Projectiles.
    this.projectiles.update(dt, (pr, a, b) => this.projectileHit(pr, a, b), (pr, at) => this.projectileLand(pr, at), (pr, sdt) => this.steer(pr, sdt));
    this.updateAcid(dt);

    // Creatures.
    const ctx: AbominationContext = {
      player: p.position, playerVelocity: p.velocity, playerAlive: live, playerHidden: this.elapsed < RAID.spawn.safeTime,
      noises: this.noises, others: this.creatures, playableRadius: this.playable,
      // PvE AI senses: how lit up the host is, and where it is looking (src/ai).
      playerVisibility: hostVisibility({ moving: p.moving, sprinting: p.sprinting, crouched: p.crouched, sinceShot: p.sinceFired, virus: p.footstepScale }),
      playerForward: { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) },
      playerReloading: this.weapon.state.isReloading, playerAiming: this.weapon.aim > 0.5,
      onTactic: (c, what) => this.bus.emit('creatureTactic', { id: c.id, type: c.kind, what, position: { x: c.position.x, y: c.position.y, z: c.position.z } }),
      onKnockback: (c, strength) => {
        const d = new THREE.Vector3(p.position.x - c.position.x, 0, p.position.z - c.position.z);
        if (d.lengthSq() < 1e-6) d.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        this.knockback(d.x, d.z, strength);
      },
      onWeb: (c, from, to) => {
        const W = c.t.web as { maxStrands: number; strandBiomass: number } | undefined;
        const r = this.webs.add(c.id, from, to, W?.strandBiomass ?? 15, W?.maxStrands ?? 6);
        for (const s of r.dropped) this.dropStrand(s.id);
        const y = (x: number, z: number) => groundHeight(x, z) + 0.7;
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, y(from.x, from.z), from.z), new THREE.Vector3(to.x, y(to.x, to.z), to.z)]);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: HIVE.bone, transparent: true, opacity: 0.55 }));
        this.webLines.set(r.strand.id, line);
        this.scene.add(line);
      },
      onReveal: (c, how) => {
        this.bus.emit('creatureReveal', { id: c.id, type: c.kind, how, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        this.noise(c.position, 20, how);
        // Burrowers erupt in a spray of sand and a dust ring instead of a fluid burst.
        if (c.burrowed) { this.fx.burst(c.position.clone().setY(groundHeight(c.position.x, c.position.z) + 0.4), SAND_SPRAY, 1.6); this.fx.ring(c.position, SAND_SPRAY, 4 + c.radius * 2, 0.7); }
        else this.fx.burst(c.centre.clone(), c.fluid, 0.8);
      },
      onScreech: (c, radius) => {
        this.bus.emit('alert', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        this.noise(c.position, radius, 'screech');
      },
      onAlert: (c) => {
        this.bus.emit('alert', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        for (const o of this.creatures) if (o !== c && o.alive && o.position.distanceTo(c.position) <= c.t.perception.alertShare) o.alert();
      },
      onMelee: (c, dmg) => {
        this.bus.emit('attack', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        this.hurt(dmg, 'torso', c.kind, c.position);
        this.fx.bleed(p.eyePosition.clone().add(new THREE.Vector3(0, -0.4, 0)), c.position.clone().sub(p.position).normalize(), GORE.flesh, 6);
      },
      onSpit: (c, from, vel, damage) => {
        this.bus.emit('attack', { id: c.id, type: c.kind, position: { x: c.position.x, y: c.position.y, z: c.position.z } });
        const proj = (c.t.projectile ?? ABOMINATIONS.bilecantor.projectile) as { gravity: number };
        this.projectiles.fire('bile', 'enemy', from, vel, { damage: damage ?? c.t.damage, gravity: damage !== undefined ? 0 : proj.gravity, life: 6 });
      },
    };
    const net = this.net;
    if (net && !net.authority) net.follow(dt);
    else {
      // Online leader: each creature hunts the nearest living host, this one or another player's.
      const targets = net?.targets() ?? [];
      for (const c of this.creatures) c.update(dt, targets.length ? this.ctxFor(c, ctx, targets, live) : ctx);
    }
    if (!net || net.authority) this.updateWebs(dt, live);
    if (live && (!net || net.authority)) this.updateNests(dt);
    if (this.boss) this.updateBoss(dt, live);
    if (this.vigil) this.updateVigil(dt, live);
    if (this.warden) this.updateWarden(dt, live);
    if (this.widow) this.updateWidow(dt, live);
    if (this.maw) this.updateMaw(dt, live);
    if (this.regent) this.updateRegent(dt, live);
    creatureGore.update(dt);
    this.hostArm.update(dt);
    this.harvestFx.update(dt);
    for (let i = this.creatures.length - 1; i >= 0; i--) if (this.creatures[i].removable) { this.scene.remove(this.creatures[i].root); this.creatures.splice(i, 1); }
    if (live && this.elapsed >= this.nextReinforce) { this.nextReinforce += RAID.reinforcements.interval; if (!net || net.authority) this.reinforce(); }

    // Hazards.
    const hz = this.hazards.update(dt, p.position.x, p.position.z);
    if (live && hz.source) {
      this.hurt(hz.dps * dt * (1 - CLASSES[this.classId].toxinResistance), 'limb', hz.source, null);
      if (hz.overloadPerSecond > 0) this.overload.add(hz.overloadPerSecond * dt);
    }

    // Bio-Pods: hold E.
    this.interactTarget = null;
    for (const pod of this.pods) {
      pod.update(dt);
      if (!pod.lootable || !live) continue;
      if (Math.hypot(pod.position.x - p.position.x, pod.position.z - p.position.z) < 2.4 && Math.abs(pod.position.y - p.position.y) < 2) this.interactTarget = pod;
    }
    for (const pod of this.pods) if (pod !== this.interactTarget && pod.lootable) pod.progress = 0;
    if (this.interactTarget) {
      const pod = this.interactTarget;
      const c = pod.fixed ? { openTime: pod.fixed.openTime, noiseOnOpen: pod.fixed.noise } : LOOT.containers[pod.type];
      if (p.keys.has('KeyE')) {
        if (pod.progress === 0) { this.bus.emit('containerOpenStart', { container: pod.type }); this.noise(pod.position, c.noiseOnOpen, 'container'); }
        pod.progress = Math.min(1, pod.progress + dt / c.openTime);
        if (pod.progress >= 1) this.openPod(pod);
      } else pod.progress = 0;
    }

    // Corpse harvesting: hold E on a dead Abomination (when no Bio-Pod is in reach).
    let corpse: Abomination | null = null;
    if (live && !this.interactTarget) {
      let bd = 2.6;
      for (const c of this.creatures) {
        if (c.alive || this.harvested.has(c.id) || !ABOMINATIONS[c.kind].harvest) continue;
        const d = Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z);
        if (d < bd) { bd = d; corpse = c; }
      }
    }
    if (corpse !== this.harvestTarget) { this.harvestTarget = corpse; this.harvestProgress = 0; }
    if (corpse) {
      const h = ABOMINATIONS[corpse.kind].harvest!;
      if (p.keys.has('KeyE')) {
        if (this.harvestProgress === 0) { this.bus.emit('harvestStart', { type: corpse.kind, time: h.time }); this.noise(corpse.position, h.noise, 'harvest'); }
        this.harvestProgress = Math.min(1, this.harvestProgress + dt / h.time);
        this.bus.emit('harvestProgress', { progress: this.harvestProgress });
        if (this.harvestProgress >= 1) this.harvest(corpse);
      } else this.harvestProgress = 0;
    }
    // Creature & Mutation: the wet, glowing cut grows with the hold.
    if (this.harvestTarget && this.harvestProgress > 0) this.harvestFx.progress(this.scene, this.harvestTarget, this.harvestProgress);
    else this.harvestFx.cancel();
    this.interactText = this.interactTarget
      ? { text: this.interactTarget.opened ? 'HOLD E · TAKE WHAT IS LEFT' : `HOLD E · ${this.interactTarget.fixed?.verb ?? 'TEAR OPEN'} ${(this.interactTarget.fixed?.label ?? LOOT.containers[this.interactTarget.type]?.label ?? 'container').toUpperCase()}`, progress: this.interactTarget.progress }
      : this.harvestTarget ? { text: `HOLD E · HARVEST ${LOOT.items[ABOMINATIONS[this.harvestTarget.kind].harvest!.item].label.toUpperCase()}`, progress: this.harvestProgress } : null;

    // Seed Spires: late ones open on the clock; every open one can be channelled.
    for (const sp of this.spires) {
      if (!sp.open && live && this.elapsed >= sp.opensAt) {
        sp.open = true;
        sp.spire.root.visible = true;
        this.sites?.setExtractOpen(sp.id, true);
        this.bus.emit('extractOpened', { label: sp.label, x: sp.point.x, z: sp.point.z });
      }
      if (live && sp.open) {
        const change = sp.point.update(p.position.x, p.position.z, dt);
        if (change === 'start') {
          this.bus.emit('extractStart', { label: sp.label, time: sp.point.time });
          this.noise(sp.spire.position, RAID.extract.signalNoise, 'extract');
          this.spireSignal = 0;
        }
        if (sp.point.inside) {
          this.spireSignal += dt;
          if (this.spireSignal > 2) { this.spireSignal = 0; this.noise(sp.spire.position, RAID.extract.signalNoise, 'extract'); }
          this.bus.emit('extractProgress', { progress: sp.point.progress, timeLeft: sp.point.timeLeft });
        }
        if (change === 'cancel') this.bus.emit('extractCancel', {});
        if (change === 'done') this.win();
      }
      if (sp.open) sp.spire.update(dt, sp.point.progress, sp.point.inside);
    }

    // Raid clock and zone collapse.
    if (live) {
      if (!this.collapseWarned && this.timeLeft <= RAID.zoneCollapse.warningAt) { this.collapseWarned = true; this.bus.emit('collapseWarning', { timeLeft: this.timeLeft }); }
      if (this.timeLeft <= 0) this.hurt(RAID.zoneCollapse.damagePerSecondAfterTimeout * dt, 'torso', 'zone collapse', null);
    }

    this.sinceHit += dt;
    this.fx.update(dt);
  }

  /** Shoves the host along (dx, dz) (creature horns and slams, here or relayed from the squad leader). */
  knockback(dx: number, dz: number, strength: number): void {
    const p = this.player, l = Math.hypot(dx, dz) || 1;
    p.velocity.x += (dx / l) * strength; p.velocity.z += (dz / l) * strength;
    p.velocity.y = Math.max(p.velocity.y, strength * 0.45);
    p.grounded = false;
    p.addTrauma(Math.min(0.8, strength / 12));
  }

  /** Online leader: the context a creature sees when another player's host is nearer than this one. */
  private ctxFor(c: Abomination, ctx: AbominationContext, targets: NetTarget[], live: boolean): AbominationContext {
    const at = c.position;
    let best: NetTarget | null = null;
    let bd = live ? Math.hypot(this.player.position.x - at.x, this.player.position.z - at.z) : Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.position.x - at.x, t.position.z - at.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return ctx;
    const t = best;
    return {
      ...ctx, player: t.position, playerVelocity: t.velocity, playerAlive: true,
      playerVisibility: t.visibility, playerForward: t.forward, playerReloading: false, playerAiming: false,
      onMelee: (a, dmg) => {
        this.bus.emit('attack', { id: a.id, type: a.kind, position: { x: a.position.x, y: a.position.y, z: a.position.z } });
        t.hurt(dmg, a.kind, a.position);
      },
      onKnockback: (a, strength) => t.push(t.position.x - a.position.x, t.position.z - a.position.z, strength),
    };
  }

  private lookTarget(): THREE.Vector3 | null {
    // Eyes on the gun track the nearest engaged creature (in camera space).
    let best: Abomination | null = null, bd = 30;
    for (const c of this.creatures) {
      if (!c.alive || !c.engaged) continue;
      const d = c.position.distanceTo(this.player.position);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    const v = best.centre.clone();
    this.camera.worldToLocal(v);
    return v.normalize();
  }

  private harvest(c: Abomination): void {
    const item = ABOMINATIONS[c.kind].harvest!.item;
    this.harvestProgress = 0;
    if (this.carried.add(item, 1) > 0) { this.bus.emit('cavityFull', { items: [{ item, count: 1 }] }); return; }
    this.harvested.add(c.id);
    this.net?.harvested(c);
    this.harvestTarget = null;
    const colour = `#${c.fluid.getHexString()}`;
    gore.burst(this.scene, { point: c.centre.clone(), colour, count: 50, speed: 4 });
    this.harvestFx.done(this.scene, item, c.centre, this.hostArm.root);
    this.bus.emit('harvestDone', { item, type: c.kind });
    this.bus.emit('pickup', { items: [{ item, count: 1 }], dna: 0, source: c.kind });
  }

  private openPod(pod: BioPod): void {
    if (pod.type === 'geneBloom') this.sites?.setNodeHarvested(pod.id, true);
    const rolled = pod.opened ? pod.remaining : pod.fixed ? pod.fixed.items.map((s) => ({ ...s })) : rollContainer(pod.type, this.rand);
    if (!pod.opened && !pod.fixed) { this.log.open(pod.type); this.bus.emit('containerOpened', { id: pod.id, container: pod.type }); }
    pod.open();
    pod.remaining = [];
    const items: typeof rolled = [], left: typeof rolled = [];
    for (const s of rolled) {
      const miss = this.carried.add(s.item, s.count);
      if (s.count - miss > 0) items.push({ item: s.item, count: s.count - miss });
      if (miss > 0) left.push({ item: s.item, count: miss });
    }
    this.fx.burst(pod.position.clone().add(new THREE.Vector3(0, 0.7, 0)), GORE.cyanFluid, 0.6);
    if (items.length) this.bus.emit('pickup', { items, dna: 0, source: pod.type });
    this.pickUpWeapons();
    // Never auto-drop what is carried: what does not fit stays in the pod (swap UI comes with the cavity overlay).
    if (left.length) { pod.reseal(left); this.bus.emit('cavityFull', { items: left }); }
  }

  private steer(pr: Projectile, dt: number): void {
    let best: Abomination | null = null, bd = pr.seek!.radius;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = c.centre.distanceTo(pr.pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    const speed = pr.vel.length();
    const want = best.centre.clone().sub(pr.pos).normalize().multiplyScalar(speed);
    pr.vel.lerp(want, Math.min(1, pr.seek!.turnRate * dt)).setLength(speed);
  }

  // ------------------------------------------------------------------ nests (Brood Heart)
  /** Places a nest. World's layout can call this with its own crater position. */
  addNest(id: string, type: string, x: number, z: number): BroodNest {
    const n = new BroodNest(id, type, x, z, new BroodHeart(Math.floor(this.rand() * 1e6), this.scene), this.rand);
    this.scene.add(n.body.root);
    if (this.pipeline.quality === 'low') simplifyForSoftware(n.body.root);
    this.nests.push(n);
    return n;
  }

  private updateNests(dt: number): void {
    const p = this.player.position;
    for (const n of this.nests) {
      const wasDormant = n.state === 'dormant';
      let alive = 0;
      for (const c of this.creatures) if (c.alive && n.brood.has(c.id)) alive++;
      const spawns = n.update(dt, Math.hypot(n.position.x - p.x, n.position.z - p.z), alive);
      if (wasDormant && (n.state as string) === 'active') this.bus.emit('nestAwake', { id: n.id, type: n.type, label: n.t.label });
      if (!spawns.length) continue;
      const waveBefore = n.brood.size;
      for (const s of spawns) {
        if (!ABOMINATIONS[s.type]) continue;
        const c = this.addCreature(s.type as AbominationKind, s.x, s.z);
        c.place(s.x, s.z, s.vx, s.vz);
        c.alert({ x: p.x, z: p.z });
        n.brood.add(c.id);
      }
      this.fx.burst(n.core(new THREE.Vector3()), GORE.violetFluid, 1.6);
      if (n.brood.size > waveBefore) this.bus.emit('nestWave', { id: n.id, wave: n.wave, of: n.waves });
    }
  }

  // ------------------------------------------------------------------ zone boss (the Reliquary)
  private updateBoss(dt: number, live: boolean): void {
    const b = this.boss!, p = this.player;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: null,
    };
    const f = b.update(dt, host, p.position.y - groundHeight(p.position.x, p.position.z));
    const at = (x: number, z: number) => new THREE.Vector3(x, groundHeight(x, z) + 0.2, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: b.id, label: b.t.label, songRadius: e.songRadius }); p.addTrauma(0.35); break;
        case 'phase': this.bus.emit('bossPhase', { boss: b.id, phase: e.id }); p.addTrauma(0.5); this.fx.burst(b.centre(new THREE.Vector3()), GORE.violetFluid, 2.2); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: b.id }); break;
        case 'stamp': this.fx.ring(at(e.at.x, e.at.z), GORE.bone, e.radius, 0.45); this.noise(at(e.at.x, e.at.z), 30, 'boss'); break;
        case 'sweep': this.fx.ring(at(b.position.x, b.position.z), GORE.bone, e.range, 0.35); break;
        default: break;
      }
      if (e.type !== 'wake' && e.type !== 'phase' && e.type !== 'enrage') this.bus.emit('bossAttack', { boss: b.id, attack: e.type });
    }
    for (const s of f.strikes) this.bossStrike(s, s.source === 'light pool' ? 'the light pool' : `${b.t.label} ${s.source}`, b.brain.body.yaw);
    for (const s of f.brood) {
      if (!ABOMINATIONS[s.type]) continue;
      const c = this.addCreature(s.type as AbominationKind, s.x, s.z);
      c.place(s.x, s.z, (s.x - b.position.x) * 1.5, (s.z - b.position.z) * 1.5);
      c.alert({ x: p.position.x, z: p.position.z });
    }
    for (const v of f.vents) this.hazards.deathCloud(v.x, v.y + 1, v.z, v.radius, v.damagePerSecond, v.overloadPerSecond, v.duration);
    for (const h of f.hymns) this.fx.ring(at(h.x, h.z), GORE.violetFluid, h.maxRadius, h.maxRadius / h.speed);
    for (const id of f.broken) {
      const q = this.arena!.pillars.find((x) => x.id === id)!;
      this.fx.burst(at(q.x, q.z).add(new THREE.Vector3(0, 2, 0)), GORE.bone, 2);
      gore.burst(this.scene, { point: at(q.x, q.z).add(new THREE.Vector3(0, 1.5, 0)), colour: HIVE.bone, count: 60, speed: 8 });
      this.bus.emit('bossCoverBroken', { boss: b.id, pillar: id });
    }
    if (this.bossPool) {
      const r = b.poolRadius;
      this.bossPool.visible = r > this.arena!.pool.radius;
      if (this.bossPool.visible) this.bossPool.scale.setScalar(r);
    }
  }

  /** Web strands: a host who walks through one is rooted and every creature within the web's alert radius comes. */
  private updateWebs(dt: number, live: boolean): void {
    const p = this.player.position;
    this.rootedFor = Math.max(0, this.rootedFor - dt);
    // A dead weaver's web falls.
    for (const s of [...this.webs.strands]) {
      const owner = this.creatures.find((c) => c.id === s.owner);
      if (!owner?.alive) { this.webs.clear(s.owner).forEach((x) => this.dropStrand(x.id)); }
    }
    if (live && this.lastFeet.lengthSq() > 0) {
      const hit = this.webs.tripped({ x: this.lastFeet.x, z: this.lastFeet.z }, { x: p.x, z: p.z });
      for (const s of hit) {
        this.dropStrand(s.id);
        const W = ABOMINATIONS.titheWeaver?.web as { rootDuration: number; alertRadius: number } | undefined;
        this.rootedFor = Math.max(this.rootedFor, W?.rootDuration ?? 1.8);
        this.player.addTrauma(0.25);
        this.noise(p, W?.alertRadius ?? 40, 'web');
        for (const c of this.creatures) if (c.alive && c.position.distanceTo(p) <= (W?.alertRadius ?? 40)) c.alert({ x: p.x, z: p.z });
      }
    }
    this.lastFeet.copy(p);
  }

  private dropStrand(id: number): void {
    const l = this.webLines.get(id);
    if (!l) return;
    this.scene.remove(l);
    l.geometry.dispose();
    (l.material as THREE.Material).dispose();
    this.webLines.delete(id);
  }

  /** A boss hit on the host: damage, knockback away from `from` (or along `yaw`), and a shake. */
  private bossStrike(s: HostStrike, source: string, yaw: number): void {
    const p = this.player;
    this.hurt(s.damage, 'torso', source, s.from);
    if (s.knock && s.from) {
      const d = new THREE.Vector3(p.position.x - s.from.x, 0, p.position.z - s.from.z);
      if (d.lengthSq() < 1e-6) d.set(Math.sin(yaw), 0, Math.cos(yaw));
      d.normalize();
      p.velocity.x += d.x * s.knock; p.velocity.z += d.z * s.knock;
      p.velocity.y = Math.max(p.velocity.y, s.knock * 0.45);
      p.grounded = false;
      p.addTrauma(Math.min(0.8, s.knock / 12));
    }
    if (s.pin && s.damage > 1) p.addTrauma(0.5);
  }

  // ------------------------------------------------------------------ cave boss (the Pale Vigil)
  private updateVigil(dt: number, live: boolean): void {
    const v = this.vigil!, p = this.player, L = v.lair;
    const fwd = p.forward(new THREE.Vector3());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: { x: fwd.x / fl, z: fwd.z / fl },
    };
    const f = v.update(dt, host);
    if (f.overload > 0) this.overload.add(f.overload);
    const floor = (x: number, z: number) => new THREE.Vector3(x, L.floorY + 0.15, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: v.id, label: v.t.label, songRadius: 0 }); break;
        case 'phase': this.bus.emit('bossPhase', { boss: v.id, phase: e.id }); p.addTrauma(0.4); this.fx.burst(v.centre(new THREE.Vector3()), GORE.violetFluid, 2); break;
        case 'enrage':
          // Web-roots seal the cave mouths until it dies.
          for (const m of L.entrances) m.seal();
          this.bus.emit('bossEnraged', { boss: v.id });
          break;
        case 'drop': this.fx.ring(floor(e.at.x, e.at.z), GORE.bone, e.radius, 0.4); this.noise(floor(e.at.x, e.at.z), 25, 'boss'); p.addTrauma(0.45); break;
        case 'shriek': this.fx.ring(floor(v.position.x, v.position.z), GORE.violetFluid, e.radius, 0.7); this.noise(v.position, e.radius * 2, 'boss'); p.addTrauma(0.6); break;
        case 'collapseWarn': this.fx.ring(floor(e.at.x, e.at.z), GORE.bone, e.radius, e.warning); break;
        case 'chunk':
          this.fx.burst(floor(e.at.x, e.at.z).add(new THREE.Vector3(0, 1, 0)), GORE.bone, 2);
          gore.burst(this.scene, { point: floor(e.at.x, e.at.z).add(new THREE.Vector3(0, 0.5, 0)), colour: HIVE.bone, count: 40, speed: 6 });
          this.noise(floor(e.at.x, e.at.z), 20, 'boss');
          if (Math.hypot(p.position.x - e.at.x, p.position.z - e.at.z) < 8) p.addTrauma(0.35);
          break;
        default: break;
      }
      if (e.type !== 'wake' && e.type !== 'phase' && e.type !== 'enrage' && e.type !== 'chunk' && e.type !== 'collapseWarn') this.bus.emit('bossAttack', { boss: v.id, attack: e.type });
    }
    for (const s of f.strikes) this.bossStrike(s, `${v.t.label} ${s.source}`, v.brain.body.yaw);
  }

  // ------------------------------------------------------------------ wreck boss (the Warden of the Long Seed)
  private updateWarden(dt: number, live: boolean): void {
    const w = this.warden!, p = this.player;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: null,
    };
    const f = w.update(dt, host);
    const floor = (x: number, z: number) => new THREE.Vector3(x, w.arena.floorY + 0.15, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: w.id, label: w.t.label, songRadius: w.t.songRadius }); p.addTrauma(0.35); break;
        case 'phase': this.bus.emit('bossPhase', { boss: w.id, phase: e.id }); p.addTrauma(0.5); this.fx.burst(w.centre(new THREE.Vector3()), GORE.limeFluid, 2.2); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: w.id }); break;
        case 'spear': this.fx.ring(new THREE.Vector3(e.at.x, e.at.y + 0.15, e.at.z), GORE.bone, e.radius, 0.3); this.noise(floor(e.at.x, e.at.z), 20, 'boss'); break;
        case 'steam': this.fx.ring(new THREE.Vector3(e.at.x, e.at.y + 0.2, e.at.z), GORE.bone, e.radius, 0.6); this.noise(floor(e.at.x, e.at.z), 25, 'boss'); break;
        case 'pulse': {
          this.fx.ring(floor(w.arena.core.x, w.arena.core.z), GORE.limeFluid, e.radius, 0.9);
          this.noise(floor(w.arena.core.x, w.arena.core.z), e.radius * 2, 'boss');
          p.addTrauma(0.7);
          break;
        }
        default: break;
      }
      if (e.type !== 'wake' && e.type !== 'phase' && e.type !== 'enrage') this.bus.emit('bossAttack', { boss: w.id, attack: e.type });
    }
    for (const id of f.fallen) {
      const c = w.arena.catwalks.find((x) => x.id === id)!;
      const mid = new THREE.Vector3((c.x0 + c.x1) / 2, c.y, (c.z0 + c.z1) / 2);
      this.fx.burst(mid, GORE.bone, 2);
      gore.burst(this.scene, { point: mid, colour: HIVE.bone, count: 50, speed: 6 });
      this.noise(mid, 30, 'boss');
      this.bus.emit('bossCoverBroken', { boss: w.id, pillar: id });
    }
    for (const b of f.brood) {
      if (!ABOMINATIONS[b.type]) continue;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * Math.PI * 2, x = b.x + Math.cos(a) * 1.2, z = b.z + Math.sin(a) * 1.2;
        const c = this.addCreature(b.type as AbominationKind, x, z);
        c.place(x, z, Math.cos(a) * 3, Math.sin(a) * 3);
        c.alert({ x: p.position.x, z: p.position.z });
      }
    }
    for (const s of f.strikes) this.bossStrike(s, `${w.t.label} ${s.source}`, w.brain.yaw);
  }

  // ------------------------------------------------------------------ desert boss (the Sandwidow)
  private updateWidow(dt: number, live: boolean): void {
    const w = this.widow!, p = this.player;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: null,
    };
    const f = w.update(dt, host);
    this.widowSlow = f.slow;
    const sand = (x: number, z: number) => new THREE.Vector3(x, groundHeight(x, z) + 0.15, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: w.id, label: w.t.label, songRadius: w.t.songRadius }); p.addTrauma(0.4); break;
        case 'phase': this.bus.emit('bossPhase', { boss: w.id, phase: e.id }); p.addTrauma(0.5); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: w.id }); break;
        case 'funnel': this.fx.ring(sand(e.at.x, e.at.z), SAND_SPRAY, e.radius, e.warning); this.noise(sand(e.at.x, e.at.z), 15, 'boss'); break;
        case 'undertow': case 'breach': case 'thrash':
          this.fx.burst(sand(e.at.x, e.at.z).add(new THREE.Vector3(0, 1, 0)), SAND_SPRAY, 2.4);
          this.fx.ring(sand(e.at.x, e.at.z), SAND_SPRAY, e.radius, 0.5);
          this.noise(sand(e.at.x, e.at.z), 35, 'boss');
          if (Math.hypot(p.position.x - e.at.x, p.position.z - e.at.z) < e.radius * 2) p.addTrauma(0.5);
          break;
        case 'surface': this.fx.burst(w.centre(new THREE.Vector3()), SAND_SPRAY, 2); this.noise(w.position, 30, 'boss'); break;
        case 'quicksand': this.fx.ring(sand(w.crater.x, w.crater.z), SAND_SPRAY, e.fraction * w.crater.radius, 1.5); break;
        default: break;
      }
      if (e.type !== 'wake' && e.type !== 'phase' && e.type !== 'enrage' && e.type !== 'funnel' && e.type !== 'surface' && e.type !== 'dive' && e.type !== 'quicksand') this.bus.emit('bossAttack', { boss: w.id, attack: e.type });
    }
    if (f.blind > 0) { p.addTrauma(0.6); this.bus.emit('hostBlinded', { seconds: f.blind, source: w.id }); }
    for (const b of f.brood) {
      if (!ABOMINATIONS[b.type]) continue;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * Math.PI * 2, x = b.x + Math.cos(a) * 2, z = b.z + Math.sin(a) * 2;
        const c = this.addCreature(b.type as AbominationKind, x, z);
        c.place(x, z, Math.cos(a) * 4, Math.sin(a) * 4);
        c.alert({ x: p.position.x, z: p.position.z });
      }
    }
    for (const s of f.strikes) {
      if (s.source === 'quicksand') { this.hurt(s.damage, 'limb', 'the quicksand', null); continue; }
      this.bossStrike(s, `${w.t.label} ${s.source}`, w.brain.yaw);
    }
  }

  /** Damages the Sandwidow. Returns true on a weak-point hit. */
  private damageWidow(amount: number, sphere: WidowHit | null, at: THREE.Vector3): boolean {
    const w = this.widow;
    if (!w?.alive || w.brain.submerged) return false;
    const r = w.damage(amount, sphere);
    this.fx.impact(at, r.weak ? GORE.limeFluid : SAND_SPRAY, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: w.id, biomass: w.biomass, fraction: w.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: w.id, part: r.popped });
    if (r.killed) {
      const rw = w.t.rewards, c = w.position;
      this.kills++;
      this.widowSlow = 1;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      this.bossKilled(w.id, c.x, c.z);
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: w.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  // ------------------------------------------------------------------ pit boss (the Nethermaw)
  private updateMaw(dt: number, live: boolean): void {
    const m = this.maw!, p = this.player;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: null,
    };
    const f = m.update(dt, host);
    this.mawPull.set(f.pull.x, 0, f.pull.z);
    if (f.overload > 0) this.overload.add(f.overload);
    const floor = (x: number, z: number) => new THREE.Vector3(x, groundHeight(x, z) + 0.15, z);
    const mouth = floor(m.pit.x, m.pit.z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: m.id, label: m.t.label, songRadius: m.t.songRadius }); p.addTrauma(0.4); break;
        case 'phase': this.bus.emit('bossPhase', { boss: m.id, phase: e.id }); p.addTrauma(0.5); this.clearMawLights(); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: m.id }); p.addTrauma(0.6); break;
        case 'swell': this.noise(mouth, 20, 'boss'); break;
        case 'pulse': this.fx.ring(mouth, SPORE, e.radius, 0.9); this.noise(mouth, 40, 'boss'); if (Math.hypot(p.position.x - m.pit.x, p.position.z - m.pit.z) <= e.radius) p.addTrauma(0.35); break;
        case 'stir': this.fx.ring(mouth, SPORE, m.pit.mawRadius, e.warning); this.noise(mouth, 30, 'boss'); break;
        case 'falseLight':
          this.clearMawLights();
          for (const l of e.at) { const s = new SeedSpire(l.x, l.z, RAID.extract.zoneRadius); this.scene.add(s.root); this.mawLights.push(s); }
          break;
        case 'trap': {
          const i = this.mawLights.findIndex((s) => Math.hypot(s.root.position.x - e.at.x, s.root.position.z - e.at.z) < 0.5);
          if (i >= 0) { this.scene.remove(this.mawLights[i].root); this.mawLights.splice(i, 1); }
          this.fx.burst(floor(e.at.x, e.at.z).add(new THREE.Vector3(0, 1, 0)), SPORE, 2.4);
          this.fx.ring(floor(e.at.x, e.at.z), SPORE, e.radius, 0.6);
          break;
        }
        case 'rumble': { const at = new THREE.Vector3(e.at.x, e.y + 0.15, e.at.z); this.fx.ring(at, GORE.bone, AI.nethermaw.rootRadius, e.warning); this.noise(at, 20, 'boss'); p.addTrauma(0.2); break; }
        case 'roots': { const at = new THREE.Vector3(e.at.x, e.y + 1, e.at.z); this.fx.burst(at, GORE.bone, 2.2); this.fx.impact(at, GORE.bone, 14, 9); break; }
        case 'collapse': p.addTrauma(0.3); break;
        default: break;
      }
      if (e.type === 'pulse' || e.type === 'trap' || e.type === 'roots' || e.type === 'raise' || e.type === 'collapse') this.bus.emit('bossAttack', { boss: m.id, attack: e.type });
    }
    for (const id of f.cut) {
      const w = this.maw!.walkways.find((x) => x.id === id);
      if (w) { this.fx.burst(new THREE.Vector3(w.x, w.y, w.z), GORE.bone, 1.6); this.noise(new THREE.Vector3(w.x, w.y, w.z), 30, 'boss'); }
    }
    for (const lt of this.mawLights) lt.update(dt, 0, false);
    for (const b of f.brood) {
      if (!ABOMINATIONS[b.type]) continue;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * Math.PI * 2 + this.rand(), r = m.pit.mawRadius + 2, x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
        const c = this.addCreature(b.type as AbominationKind, x, z);
        c.place(x, z, Math.cos(a) * 4, Math.sin(a) * 4);
        c.alert({ x: p.position.x, z: p.position.z });
      }
    }
    for (const s of f.strikes) {
      if (!s.from) { this.hurt(s.damage, 'torso', s.source === 'the mouth' ? `${m.t.label}'s mouth` : m.t.label, null); continue; }
      this.bossStrike(s, `${m.t.label} ${s.source}`, 0);
    }
  }

  private clearMawLights(): void {
    for (const s of this.mawLights) this.scene.remove(s.root);
    this.mawLights.length = 0;
  }

  /** Damages the Nethermaw (or one of its root columns). Returns true on a weak-point hit. */
  private damageMaw(amount: number, sphere: MawHit | null, at: THREE.Vector3): boolean {
    const m = this.maw;
    if (!m?.alive) return false;
    const r = m.damage(amount, sphere);
    this.fx.impact(at, r.weak ? SPORE : GORE.bone, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: m.id, biomass: m.biomass, fraction: m.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) {
      this.bus.emit('bossPartDestroyed', { boss: m.id, part: r.popped });
      if (sphere?.tag === 'column') { this.bus.emit('bossCoverBroken', { boss: m.id, pillar: r.popped }); this.fx.burst(at, GORE.bone, 2); }
    }
    if (r.killed) {
      const rw = m.t.rewards, c = m.position;
      this.kills++;
      this.mawPull.set(0, 0, 0);
      this.clearMawLights();
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      this.bossKilled(m.id, c.x + m.pit.mawRadius + 3, c.z);
      // The updraft extract at its centre opens when it dies.
      for (const sp of this.spires) if (!Number.isFinite(sp.opensAt)) sp.opensAt = this.elapsed;
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: m.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  // ------------------------------------------------------------------ swamp boss (the Mire Regent)
  private updateRegent(dt: number, live: boolean): void {
    const g = this.regent!, p = this.player;
    const fwd = p.forward(new THREE.Vector3());
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const host = {
      x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vz: p.velocity.z,
      alive: live, hidden: this.elapsed < RAID.spawn.safeTime, visibility: 1, forward: { x: fwd.x / fl, z: fwd.z / fl },
    };
    const f = g.update(dt, host);
    const water = (x: number, z: number) => new THREE.Vector3(x, g.waterY + 0.1, z);
    for (const e of f.events) {
      switch (e.type) {
        case 'wake': this.bus.emit('bossAwake', { boss: g.id, label: g.t.label, songRadius: g.t.songRadius }); p.addTrauma(0.3); break;
        case 'phase': this.bus.emit('bossPhase', { boss: g.id, phase: e.id }); p.addTrauma(0.5); break;
        case 'enrage': this.bus.emit('bossEnraged', { boss: g.id }); break;
        case 'reach': this.fx.ring(water(e.at.x, e.at.z), MIRE_WATER, AI.regent.grabRadius, e.warning); this.noise(water(e.at.x, e.at.z), 15, 'boss'); break;
        case 'bulge': this.fx.ring(water(e.at.x, e.at.z), MIRE_WATER, e.radius, e.warning); break;
        case 'heave': this.fx.ring(water(e.at.x, e.at.z), MIRE_WATER, e.radius, e.warning); this.noise(water(e.at.x, e.at.z), 30, 'boss'); break;
        case 'slam': case 'ripple': case 'thrash':
          this.noise(water(e.at.x, e.at.z), 35, 'boss');
          if (Math.hypot(p.position.x - e.at.x, p.position.z - e.at.z) < e.radius * 1.6) p.addTrauma(0.45);
          break;
        case 'flood': this.bus.emit('bossAttack', { boss: g.id, attack: 'flood' }); break;
        case 'dive': this.fx.burst(water(g.position.x, g.position.z), MIRE_WATER, 2); break;
        default: break;
      }
      if (e.type === 'grab' || e.type === 'ripple' || e.type === 'slam' || e.type === 'tongue' || e.type === 'moss' || e.type === 'thrash' || e.type === 'brood') this.bus.emit('bossAttack', { boss: g.id, attack: e.type });
    }
    for (const v of f.clouds) this.hazards.deathCloud(v.x, v.y + 1, v.z, v.radius, v.damagePerSecond, v.overloadPerSecond, v.duration);
    if (f.drain > 0) this.hurt(f.drain, 'limb', 'the flood', null);
    for (const b of f.brood) {
      if (!ABOMINATIONS[b.type]) continue;
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * Math.PI * 2, x = b.x + Math.cos(a) * 1.5, z = b.z + Math.sin(a) * 1.5;
        const c = this.addCreature(b.type as AbominationKind, x, z);
        c.place(x, z, Math.cos(a) * 3, Math.sin(a) * 3);
        c.alert({ x: p.position.x, z: p.position.z });
      }
    }
    for (const s of f.strikes) {
      if (!s.from) { this.hurt(s.damage, 'torso', `${g.t.label} ${s.source}`, null); if (s.pin) p.addTrauma(0.5); continue; }
      this.bossStrike(s, `${g.t.label} ${s.source}`, g.brain.yaw);
    }
  }

  /** Damages the Mire Regent. Returns true on a weak-point hit. */
  private damageRegent(amount: number, sphere: RegentHit | null, at: THREE.Vector3): boolean {
    const g = this.regent;
    if (!g?.alive) return false;
    const r = g.damage(amount, sphere);
    if (r.dealt <= 0) { this.fx.impact(at, MIRE_WATER, 4); return false; }
    this.fx.impact(at, r.weak ? GORE.limeFluid : MIRE_WATER, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: g.id, biomass: g.biomass, fraction: g.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: g.id, part: r.popped });
    if (r.freed) this.player.addTrauma(0.3);
    if (r.killed) {
      const rw = g.t.rewards, c = g.position, P = g.pool;
      this.kills++;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      // The spoils wash up on the pool's edge nearest where it died.
      const a = Math.atan2(c.z - P.z, c.x - P.x);
      this.bossKilled(g.id, P.x + Math.cos(a) * (P.radius + 3), P.z + Math.sin(a) * (P.radius + 3));
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: g.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  /** Damages the Warden. Returns true on a weak-point hit. */
  private damageWarden(amount: number, sphere: WardenHit | null, at: THREE.Vector3): boolean {
    const w = this.warden;
    if (!w?.alive) return false;
    const r = w.damage(amount, sphere);
    this.fx.impact(at, r.weak ? GORE.limeFluid : GORE.bone, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: w.id, biomass: w.biomass, fraction: w.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: w.id, part: r.popped });
    if (r.killed) {
      const rw = w.t.rewards, c = w.position, A = w.arena;
      this.kills++;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      // It may die on the roof: the spoils land on the floor below it, kept inside the chamber.
      const x = Math.min(A.x1 - 4, Math.max(A.x0 + 4, c.x)), z = Math.min(A.z1 - 4, Math.max(A.z0 + 4, c.z));
      this.bossKilled(w.id, x, z);
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: w.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  /** Damages the Pale Vigil. Returns true on a weak-point hit. */
  private damageVigil(amount: number, sphere: VigilHit | null, at: THREE.Vector3): boolean {
    const v = this.vigil;
    if (!v?.alive) return false;
    const r = v.damage(amount, sphere);
    this.fx.impact(at, r.weak ? GORE.limeFluid : GORE.bone, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: v.id, biomass: v.biomass, fraction: v.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: v.id, part: r.popped });
    if (r.killed) {
      const rw = v.t.rewards, c = v.position, L = v.lair;
      for (const m of L.entrances) m.unseal();
      this.kills++;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      this.bossKilled(v.id, c.x, c.z);
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: v.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  /** Damages the boss. Returns true on a weak-point hit. */
  private damageBoss(amount: number, sphere: ReliquaryHit | null, from: THREE.Vector3, at: THREE.Vector3): boolean {
    const b = this.boss;
    if (!b?.alive) return false;
    const r = b.damage(amount, sphere, from.x, from.z);
    this.fx.impact(at, r.weak ? GORE.limeFluid : GORE.bone, r.weak ? 12 : 5);
    this.bus.emit('bossDamaged', { boss: b.id, biomass: b.biomass, fraction: b.fraction, weakPoint: r.weak, part: sphere?.tag ?? 'body' });
    if (r.popped) this.bus.emit('bossPartDestroyed', { boss: b.id, part: r.popped });
    if (r.killed) {
      const rw = b.t.rewards, c = b.position;
      this.kills++;
      this.noise(c, HOST.noiseRadius.egoCharge, 'boss');
      // Rewards (DNA, loot container, the hold-E heart) are paid by bossKilled, in front of the body.
      this.bossKilled(b.id, c.x + Math.sin(b.brain.body.yaw) * 8, c.z + Math.cos(b.brain.body.yaw) * 8);
      const container = rw.container && LOOT.containers[rw.container] ? rw.container : null;
      this.bus.emit('bossDefeated', { boss: b.id, dna: rw.dna, container });
    }
    return r.weak;
  }

  private damageNest(n: BroodNest, amount: number, vent: number | null, at: THREE.Vector3): void {
    const killed = n.damage(amount, vent);
    this.fx.impact(at, vent !== null ? GORE.limeFluid : GORE.violetFluid, vent !== null ? 12 : 6);
    this.bus.emit('nestDamaged', { id: n.id, biomass: n.biomass, fraction: n.fraction, weakPoint: vent !== null });
    if (!killed) return;
    const o = n.t.onDestroyed, c = n.position;
    this.fx.ring(c.clone().setY(c.y + 0.5), GORE.violetFluid, o.shockwave.radius, 0.8);
    if (this.player.position.distanceTo(c) <= o.shockwave.radius) this.overload.add(o.shockwave.overload);
    this.carried.dna += o.dnaDrop;
    this.kills++;
    this.dropContainer(o.container, c.x + 3.5, c.z, `${o.container}-${n.id}`);
    this.noise(c, HOST.noiseRadius.egoCharge, 'nest');
    this.log.destroyNest();
    this.bus.emit('nestDestroyed', { id: n.id, type: n.type, dna: o.dnaDrop, container: o.container });
  }

  private bossHud(): HudState['boss'] {
    const p = this.player.position;
    const b = this.boss;
    if (b?.awake && Math.hypot(b.position.x - p.x, b.position.z - p.z) <= b.t.songRadius) {
      const phase = b.brain.phase.id.toUpperCase();
      return { label: `${b.t.label} · ${b.brain.enraged ? 'ENRAGED' : phase}`, fraction: b.fraction, wave: 0, waves: 0 };
    }
    const v = this.vigil;
    if (v?.awake && Math.hypot(v.position.x - p.x, v.position.z - p.z) <= v.lair.radius * 1.6) {
      return { label: `${v.t.label} · ${v.brain.enraged ? 'ENRAGED' : v.brain.phase.id.toUpperCase()}`, fraction: v.fraction, wave: 0, waves: 0 };
    }
    const sw = this.widow;
    if (sw?.awake && Math.hypot(sw.crater.x - p.x, sw.crater.z - p.z) <= sw.crater.radius * 1.5) {
      return { label: `${sw.t.label} · ${sw.brain.enraged ? 'ENRAGED' : sw.brain.phase.id.toUpperCase()}`, fraction: sw.fraction, wave: 0, waves: 0 };
    }
    const nm = this.maw;
    if (nm?.awake && Math.hypot(nm.pit.x - p.x, nm.pit.z - p.z) <= nm.pit.radius * 1.6) {
      return { label: `${nm.t.label} · ${nm.brain.enraged ? 'ENRAGED' : nm.brain.phase.id.toUpperCase()}`, fraction: nm.fraction, wave: 0, waves: 0 };
    }
    const rg = this.regent;
    if (rg?.awake && Math.hypot(rg.pool.x - p.x, rg.pool.z - p.z) <= rg.pool.radius * 2) {
      return { label: `${rg.t.label} · ${rg.brain.enraged ? 'ENRAGED' : rg.brain.phase.id.toUpperCase()}`, fraction: rg.fraction, wave: 0, waves: 0 };
    }
    const w = this.warden;
    if (w?.awake && p.x >= w.arena.x0 - 10 && p.x <= w.arena.x1 + 10 && p.z >= w.arena.z0 - 10 && p.z <= w.arena.z1 + 10) {
      return { label: `${w.t.label} · ${w.brain.enraged ? 'ENRAGED' : w.brain.phase.id.toUpperCase()}`, fraction: w.fraction, wave: 0, waves: 0 };
    }
    for (const n of this.nests) {
      if (n.state !== 'active' && n.state !== 'spent') continue;
      if (Math.hypot(n.position.x - p.x, n.position.z - p.z) > n.t.activationRadius * 1.5) continue;
      return { label: n.t.label, fraction: n.fraction, wave: n.wave, waves: n.waves };
    }
    return null;
  }

  private projectileHit(pr: Projectile, a: THREE.Vector3, b: THREE.Vector3): { point: THREE.Vector3; t: number } | null {
    // Another host's shot replayed here: it stops on what it meets, but its shooter's machine decides the damage.
    if (pr.remote && pr.owner === 'player') return this.replicaHit(a, b);
    if (pr.owner === 'enemy') {
      if (this.phase !== 'raid') return null;
      const chest = this.player.position.clone(); chest.y += CHEST;
      const t = segmentSphere(a, b, chest, PLAYER_RADIUS + 0.25);
      if (t === null) return null;
      const point = a.clone().lerp(b, t);
      this.hurt(pr.damage, 'torso', 'bilecantor', pr.origin);
      this.projectileLand(pr, point);
      return { point, t };
    }
    let bestT = Infinity, bestC: Abomination | null = null, bestS: HitSphere | null = null;
    for (const c of this.creatures) {
      if (!c.alive || pr.hit?.has(c.id)) continue;
      let weakHit: { t: number; s: HitSphere } | null = null;
      let bodyHit: { t: number; s: HitSphere } | null = null;
      for (const h of c.hitSpheres) {
        const t = segmentSphere(a, b, h.world, h.r);
        if (t === null) continue;
        if (c.isLiveWeakPoint(h)) { if (!weakHit || t < weakHit.t) weakHit = { t, s: h }; }
        else if (!bodyHit || t < bodyHit.t) bodyHit = { t, s: h };
      }
      const hit = weakHit ?? bodyHit;
      if (hit && hit.t < bestT) { bestT = hit.t; bestC = c; bestS = hit.s; }
    }
    let nestHit: { n: BroodNest; t: number; vent: number | null } | null = null;
    for (const n of this.nests) {
      const h = n.hit(a, b);
      if (h && h.t < (nestHit?.t ?? bestT)) nestHit = { n, ...h };
    }
    // PvP (online raids): another host's body, if nothing else is nearer along the shot.
    const hh = this.net?.hitHost(a, b) ?? null;
    if (hh && hh.t < Math.min(bestT, nestHit?.t ?? Infinity, this.vigil?.hit(a, b)?.t ?? Infinity, this.boss?.hit(a, b)?.t ?? Infinity, this.warden?.hit(a, b)?.t ?? Infinity, this.widow?.hit(a, b)?.t ?? Infinity, this.maw?.hit(a, b)?.t ?? Infinity, this.regent?.hit(a, b)?.t ?? Infinity)) {
      const point = a.clone().lerp(b, hh.t);
      const dmg = (pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage);
      this.net!.hitOther(hh.id, dmg, hh.zone, pr.origin);
      this.fx.impact(point, new THREE.Color(HIVE.danger), 8);
      this.bus.emit('hit', { target: 'host', id: -1, damage: dmg, weakPoint: hh.zone === 'head', kill: false, position: { x: point.x, y: point.y, z: point.z } });
      return { point, t: hh.t };
    }
    const sh = this.widow?.hit(a, b) ?? null;
    if (sh && sh.t < (nestHit?.t ?? bestT)) {
      const point = a.clone().lerp(b, sh.t);
      const dmg = (pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage);
      const weak = this.damageWidow(dmg, sh.sphere, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(weak);
      return { point, t: sh.t };
    }
    for (const boss of [this.maw, this.regent]) {
      const bh = boss?.hit(a, b) ?? null;
      if (!bh || bh.t >= (nestHit?.t ?? bestT)) continue;
      const point = a.clone().lerp(b, bh.t);
      const dmg = (pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage);
      const weak = boss === this.maw ? this.damageMaw(dmg, bh.sphere as MawHit, point) : this.damageRegent(dmg, bh.sphere as RegentHit, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(weak);
      return { point, t: bh.t };
    }
    const wh = this.warden?.hit(a, b) ?? null, valve = this.warden?.valveHit(a, b) ?? null;
    if (valve && valve.t < (wh?.t ?? Infinity) && valve.t < (nestHit?.t ?? bestT)) {
      // Shooting a coolant valve's wheel vents it: the Warden's seam beside it cracks open.
      const point = a.clone().lerp(b, valve.t);
      this.warden!.vent(valve.index);
      this.fx.impact(point, GORE.bone, 6);
      this.noise(point, 25, 'valve');
      this.bus.emit('valveVented', { boss: 'warden', valve: this.warden!.arena.valves[valve.index].id });
      return { point, t: valve.t };
    }
    if (wh && wh.t < (nestHit?.t ?? bestT)) {
      const point = a.clone().lerp(b, wh.t);
      const dmg = (pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage);
      const weak = this.damageWarden(dmg, wh.sphere, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(weak);
      return { point, t: wh.t };
    }
    const vh = this.vigil?.hit(a, b) ?? null;
    if (vh && vh.t < (nestHit?.t ?? bestT) && vh.t < (this.boss?.hit(a, b)?.t ?? Infinity)) {
      const point = a.clone().lerp(b, vh.t);
      if (pr.stick) return { point, t: vh.t }; // sticky rounds burst on their fuse
      const dmg = pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage;
      const weak = this.damageVigil(dmg, vh.sphere, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(weak);
      return { point, t: vh.t };
    }
    const bh = this.boss?.hit(a, b) ?? null;
    if (bh && bh.t < (nestHit?.t ?? bestT)) {
      const point = a.clone().lerp(b, bh.t);
      if (pr.stick) return { point, t: bh.t }; // sticky rounds burst on their fuse
      const dmg = pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage;
      const weak = this.damageBoss(dmg, bh.sphere, pr.origin, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(weak);
      return { point, t: bh.t };
    }
    if (nestHit) {
      const point = a.clone().lerp(b, nestHit.t);
      if (pr.stick) return { point, t: nestHit.t }; // sticky rounds burst on their fuse
      const dmg = pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, point.distanceTo(pr.origin), 1) : pr.damage;
      this.damageNest(nestHit.n, dmg, nestHit.vent, point);
      if (pr.weapon) this.weaponFor(pr)?.credit(nestHit.vent !== null);
      return { point, t: nestHit.t };
    }
    if (!bestC || !bestS) return null;
    const point = a.clone().lerp(b, bestT);
    const weak = bestC.isLiveWeakPoint(bestS);
    const dist = point.distanceTo(pr.origin);
    if (pr.stick) {
      // Sticky rounds burst on their fuse, riding the creature they hit.
      const c = bestC, off = point.clone().sub(c.centre);
      pr.follow = () => (c.alive ? c.centre.clone().add(off) : null);
      return { point, t: bestT };
    }
    const mult = weak ? (bestC.t.weakPoint.multiplier ?? pr.weapon?.weakPointMultiplier ?? 2) : 1;
    const dmg = pr.weapon ? projectileDamage({ damage: pr.damage, range: pr.weapon.range }, dist, mult) : pr.damage * mult;
    const dir = pr.vel.clone().normalize();
    (pr.hit ??= new Set()).add(bestC.id);
    this.damageCreature(bestC, dmg, weak, dir, point, pr.kind, bestS);
    if (pr.weapon) { this.weaponFor(pr)?.credit(weak); this.graftHit(pr.weapon, bestC, dmg, point); }
    this.fx.impact(point, weak ? GORE.limeFluid : GORE.spore, weak ? 12 : 6);
    this.splash(pr, point, bestC);
    return { point, t: bestT };
  }

  /** Walks the reload's feel beats (Design's weapon-feel.json) and tells the body and the sound about each. */
  private playReloadBeats(w: LivingWeapon, started: boolean): void {
    const b = this.reloadBeat;
    if (!w.state.isReloading) { b.idx = 0; b.last = 0; return; }
    const style = w.state.reloadStyle;
    const beats = WEAPON_FEEL.reload[style]?.beats ?? [];
    const prog = w.state.reloadProgress;
    if (started || prog < b.last) b.idx = 0; // a new reload, or the next shell
    b.last = prog;
    while (b.idx < beats.length && prog >= beats[b.idx].at) {
      w.model.beat?.(b.idx, beats[b.idx].pose);
      this.bus.emit('reloadBeat', { weapon: w.id, style, beat: b.idx, cue: beats[b.idx].cue });
      b.idx++;
    }
  }

  /** Grafted behaviours on a creature hit (mods.json effects.special): acid burn, leech, splinter shards. */
  private graftHit(spec: WeaponSpec, c: Abomination, dmg: number, at: THREE.Vector3): void {
    for (const sp of spec.specials) {
      const n = (k: string, d: number) => Number(sp[k] ?? d);
      if (sp.id === 'acid') {
        const b = this.acidBurns.find((x) => x.c === c);
        if (b) b.left = n('duration', 3); else this.acidBurns.push({ c, dps: n('dps', 3), left: n('duration', 3) });
      } else if (sp.id === 'leech' && this.phase === 'raid') {
        this.biomass.heal(dmg * n('fraction', 0.04));
      } else if (sp.id === 'splinter') {
        const others = this.creatures.filter((o) => o.alive && o !== c && o.centre.distanceTo(at) < 6)
          .sort((a, b) => a.centre.distanceTo(at) - b.centre.distanceTo(at)).slice(0, n('shards', 3));
        for (const o of others) this.damageCreature(o, n('damage', 8), false, o.centre.clone().sub(at).normalize(), o.centre.clone(), 'splinter');
        this.fx.impact(at, GORE.bone, 8);
      }
    }
  }

  private updateAcid(dt: number): void {
    for (const b of this.acidBurns) {
      b.left -= dt;
      if (b.c.alive) this.damageCreature(b.c, b.dps * dt, false, null, b.c.centre, 'acid');
    }
    this.acidBurns = this.acidBurns.filter((b) => b.left > 0 && b.c.alive);
  }

  /** The carried weapon that fired a player round (Ego Charge is credited to it). */
  private weaponFor(pr: Projectile): LivingWeapon | undefined { return this.weapons.find((w) => w.spec === pr.weapon); }

  // ------------------------------------------------------------------ arsenal
  /** Loads the raid's weapon slots (weapons.json ids; unknown ids are skipped) and holds the first. */
  arm(ids: string[], mods: string[][] = []): void {
    const known = ids.map((id, i) => ({ id, mods: mods[i] ?? [] })).filter((k) => WEAPON_DATA[k.id]);
    if (!known.length) known.push({ id: STARTER_WEAPON, mods: [] });
    for (const w of this.weapons) w.model.root.removeFromParent();
    this.weapons.length = 0;
    for (const { id, mods: grafts } of known) {
      const spec = applyMods(weaponSpec(id), grafts);
      const w = new LivingWeapon(spec, createWeaponModel(spec), this.projectiles, spec.ammo ? this.ammoFeed(id, spec.ammo) : null);
      this.weapons.push(w);
      this.rig.add(w.model);
    }
    this.held = -1;
    this.equip(0, true);
  }

  /** Draws carried weapon `i` (its equipTime swing; instantly at raid start). */
  equip(i: number, instant = false): boolean {
    if (i === this.held || !this.weapons[i]) return false;
    const prev = this.weapons[this.held];
    if (prev) { prev.state.cancelReload(); prev.aim = 0; }
    this.held = i;
    const w = this.weapons[i];
    this.rig.setFeel(WEAPON_FEEL.fire[w.spec.class]);
    if (instant) this.rig.equip(w.model, 0); else this.rig.swap(w.model, w.spec.handling.equipTime);
    // Creature & Mutation: the host's forearm (and its virus mutation) moves onto the drawn weapon's grip.
    if (w.model.grip) {
      w.model.grip.add(this.hostArm.root);
      this.hostArm.root.position.set(0, 0, 0);
      this.hostArm.root.quaternion.identity();
      this.hostArm.root.scale.setScalar(1);
    } else attachToViewmodel(w.model as { root: THREE.Object3D }, this.hostArm);
    if (!instant) this.bus.emit('weaponSwap', { weapon: w.id, slot: i });
    return true;
  }

  /**
   * Weapons found in a raid: while a weapon slot is free, a weapon item in the cavities is taken into the hands
   * (mouse wheel or Z to draw it). With every slot full it rides home in the cavities as loot.
   */
  pickUpWeapons(): string[] {
    const taken: string[] = [];
    for (const s of this.carried.items) {
      if (!isWeapon(s.item) || this.weapons.some((w) => w.id === s.item)) continue;
      if (this.weapons.length >= 1 + weaponSlots()) break;
      if (!this.carried.consume(s.item)) continue;
      const spec = weaponSpec(s.item);
      const w = new LivingWeapon(spec, createWeaponModel(spec), this.projectiles, spec.ammo ? this.ammoFeed(spec.id, spec.ammo) : null);
      this.weapons.push(w);
      this.rig.add(w.model);
      taken.push(s.item);
      this.bus.emit('weaponPickup', { weapon: s.item, label: spec.label, slot: this.weapons.length - 1 });
    }
    return taken;
  }

  private ammoFeed(id: string, item: string): AmmoFeed {
    return {
      available: () => this.carried.count(item),
      take: (n) => { let got = 0; while (got < n && this.carried.consume(item)) got++; if (got) this.bus.emit('ammoFed', { weapon: id, item, count: got }); return got; },
    };
  }

  private cycleWeapon(step: number): void {
    if (this.weapons.length < 2) return;
    this.equip((this.held + step + this.weapons.length) % this.weapons.length);
  }

  /** A replayed shot from another host: stops at the first creature or host it meets, deals nothing. */
  private replicaHit(a: THREE.Vector3, b: THREE.Vector3): { point: THREE.Vector3; t: number } | null {
    let bestT = Infinity;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      for (const h of c.hitSpheres) { const t = segmentSphere(a, b, h.world, h.r); if (t !== null && t < bestT) bestT = t; }
    }
    const chest = this.player.position.clone(); chest.y += CHEST;
    const me = this.phase === 'raid' ? segmentSphere(a, b, chest, PLAYER_RADIUS + 0.25) : null;
    if (me !== null && me < bestT) bestT = me;
    if (!Number.isFinite(bestT)) return null;
    const point = a.clone().lerp(b, bestT);
    this.fx.impact(point, GORE.spore, 5, 4);
    return { point, t: bestT };
  }

  private splash(pr: Projectile, at: THREE.Vector3, except: Abomination | null): void {
    if (pr.splashRadius <= 0) return;
    // Weapons with selfDamage (launchers) hurt the host inside their own blast.
    if (pr.weapon?.selfDamage && this.phase === 'raid') {
      const chest = this.player.position.clone(); chest.y += CHEST;
      if (chest.distanceTo(at) <= pr.splashRadius) this.hurt(pr.splashDamage * (HOST.throwables?.selfDamageMultiplier ?? 0.5), 'torso', pr.weapon.id, at);
    }
    for (const c of this.creatures) {
      if (!c.alive || c === except) continue;
      const d = c.centre.distanceTo(at) - c.radius;
      if (d <= pr.splashRadius) this.damageCreature(c, pr.splashDamage, false, null, c.centre, 'splash');
    }
    if (pr.kind === 'ego') { this.fx.ring(at, GORE.cyanFluid, pr.splashRadius, 0.35); this.fx.impact(at, GORE.cyanFluid, 24, 9); }
  }

  private projectileLand(pr: Projectile, at: THREE.Vector3): void {
    if (pr.owner === 'enemy') {
      const pool = ABOMINATIONS.bilecantor.acidPool as { radius: number; damagePerSecond: number; duration: number };
      this.hazards.acidPool(at.x, at.z, pool.radius, pool.damagePerSecond, pool.duration);
      gore.burst(this.scene, { point: at, colour: ZONE7.lime, count: 30, speed: 5 });
      this.fx.impact(at, GORE.limeFluid, 20, 6);
      return;
    }
    this.fx.impact(at, pr.kind === 'ego' ? GORE.cyanFluid : GORE.spore, pr.kind === 'ego' ? 16 : 5, 4);
    if (!pr.remote) this.splash(pr, at, null);
  }

  // ------------------------------------------------------------------ HUD + test hooks
  hud(): HudState {
    const p = this.player.position;
    const w = this.weapon;
    return {
      phase: this.phase,
      biomass: this.biomass.current, biomassMax: this.biomass.max,
      overload: this.overload.fraction, overloaded: this.overload.overloaded,
      ammo: w.state.ammo, magazine: w.spec.magazine, reloading: w.state.reloadProgress,
      weapon: { id: w.id, label: w.spec.label, class: w.spec.class, slot: this.held, slots: this.weapons.length, reserve: w.state.reserve, charge: w.state.charge, scope: w.eyeScope ? w.aim : 0, canAim: w.canAim },
      crosshair: {
        radius: Math.tan(w.spreadRadians()) / Math.tan((this.player.camera.fov * Math.PI) / 360),
        bloom: Math.min(1, w.bloom / (w.feel?.bloomMax ?? 2)),
        style: w.eyeScope && w.aim > 0.95 ? 'scope' : (w.feel?.reticle ?? 'cross'),
        ready: !w.state.isReloading && w.state.ammo > 0 && !this.rig.equipping && !(w.spec.spread.sprintBlocksFire && this.player.sprinting),
        pellets: w.spec.pellets, charge: w.state.charge, onTarget: !!this.aimTarget, weak: !!this.aimTarget?.weak,
      },
      ego: w.egoFraction, egoReady: w.egoReady, aiming: w.aim > 0.5,
      timeLeft: this.timeLeft, collapse: this.timeLeft <= RAID.zoneCollapse.warningAt,
      slots: this.abilities.slots(),
      carried: this.carried.items.map((s) => ({ item: s.item, label: itemDef(s.item)!.label, count: s.count, kind: itemDef(s.item)!.kind })),
      dna: this.carried.dna, value: this.carried.value, kills: this.kills,
      extract: { progress: this.extract.progress, inside: this.extract.inside, distance: Math.hypot(this.extract.x - p.x, this.extract.z - p.z), label: this.currentSpire.label },
      interact: this.interactText,
      scanner: {
        x: p.x, z: p.z, yaw: this.player.yaw, range: 60,
        extract: { x: this.extract.x, z: this.extract.z },
        pods: this.pods.map((q) => ({ x: q.position.x, z: q.position.z, opened: q.opened })),
        pings: [
          ...this.creatures.filter((c) => c.alive && (c.revealed > 0 || (c.engaged && c.position.distanceTo(p) < 25))).map((c) => ({ x: c.position.x, z: c.position.z, kind: c.kind, revealed: c.revealed > 0 })),
          ...(this.net?.pings() ?? []),
        ],
      },
      healing: this.useLeft > 0 || this.healLeft > 0,
      boss: this.bossHud(),
      activeVirus: this.injection.active,
      injecting: this.injection.pending,
      injectProgress: this.injection.progress,
      harvestProgress: this.harvestTarget ? this.harvestProgress : 0,
    };
  }

  /** World & Level calls this when the host reaches a named landmark (zones.json landmarks); contracts count it. */
  visit(landmark: string): void {
    if (this.log.visited.has(landmark)) return;
    this.log.visit(landmark);
    this.bus.emit('landmarkVisited', { landmark });
  }

  /**
   * PvE AI calls this when a bosses.json boss dies at (x, z): contracts count it, its kill DNA is carried, its loot
   * container drops beside the body and its organ (e.g. the Reliquary Heart) becomes a hold-E harvest. Once per raid.
   */
  bossKilled(boss: string, x = this.player.position.x, z = this.player.position.z): void {
    if (this.log.bosses.has(boss)) return;
    this.log.killBoss(boss);
    const r = BOSSES[boss]?.rewards;
    if (r) {
      // bosses.json rewards: kill DNA, the boss's loot container, and its harvestable organ (hold E, loud).
      this.carried.dna += r.dna;
      if (r.container) this.dropContainer(r.container, x + 3, z, `${r.container}-${boss}`);
      if (r.items?.length) {
        const spoils = new BioPod(`${boss}-spoils`, 'spoils', x, z + 3);
        const n = (c: number | [number, number]) => (Array.isArray(c) ? c[0] + Math.floor(this.rand() * (c[1] - c[0] + 1)) : c);
        spoils.fixed = { items: r.items.map((i) => ({ item: i.item, count: n(i.count) })), openTime: LOOT.containers.bioPod.openTime, noise: 0, verb: 'TEAR OPEN', label: `${BOSSES[boss].label} spoils` };
        this.pods.push(spoils);
        this.scene.add(spoils.root);
      }
      if (r.harvest) {
        const heart = new BioPod(`${boss}-harvest`, 'harvest', x - 3, z);
        heart.fixed = { items: [{ item: r.harvest.item, count: 1 }], openTime: r.harvest.time, noise: r.harvest.noise, verb: 'CUT OUT', label: itemDef(r.harvest.item)?.label ?? r.harvest.item };
        this.pods.push(heart);
        this.scene.add(heart.root);
      }
    }
    this.bus.emit('bossKilled', { boss, dna: r?.dna ?? 0, container: r?.container ?? null, harvest: r?.harvest?.item ?? null });
  }

  /**
   * Places a lootable container (any id in data/loot.json containers) on the ground: its contents roll from the
   * loot table when it is first opened, through the same hold-E and transfer flow as the map's pods. PvE AI's
   * Brood Heart calls this with 'broodCache' when it dies.
   */
  dropContainer(type: string, x: number, z: number, id = `${type}-drop-${this.pods.length}`): BioPod {
    if (!LOOT.containers[type]) throw new Error(`unknown container ${type}`);
    const pod = new BioPod(id, type, x, z);
    this.pods.push(pod);
    this.scene.add(pod.root);
    return pod;
  }

  /** State for tests/raid.mjs and tooling. */
  testState(): Record<string, unknown> {
    return {
      phase: this.phase, zone: this.zone, log: { harvested: Object.fromEntries(this.log.harvested), killed: Object.fromEntries(this.log.killed), opened: Object.fromEntries(this.log.opened), visited: [...this.log.visited], bosses: [...this.log.bosses] }, armLook: this.hostArm.current, biomass: this.biomass.current, overload: this.overload.value, overloaded: this.overload.overloaded,
      ammo: this.weapon.state.ammo, ego: this.weapon.ego, timeLeft: this.timeLeft, kills: this.kills,
      carried: this.carried.snapshot(), extractProgress: this.extract.progress,
      extractPosition: [this.extract.x, this.extract.z], pods: this.pods.map((q) => ({ id: q.id, position: [q.position.x, q.position.z], opened: q.opened })),
      weapons: { held: this.held, zoom: this.player.zoom, fov: this.player.camera.fov, list: this.weapons.map((w) => ({ id: w.id, ammo: w.state.ammo, reloading: w.state.isReloading, aim: w.aim, charge: w.state.charge, mods: w.spec.mods, magazine: w.spec.magazine })) },
      enemies: this.creatures.map((c) => ({ id: c.id, kind: c.kind, alive: c.alive, state: c.state, biomass: c.biomass, position: [c.position.x, c.position.y, c.position.z], centre: [c.centre.x, c.centre.y, c.centre.z] })),
      result: this.result, gore: gore.stats(),
      boss: this.boss ? { state: this.boss.brain.state, phase: this.boss.brain.phase.id, action: this.boss.brain.action, biomass: this.boss.biomass, fraction: this.boss.fraction, hearts: [...this.boss.hearts], sac: this.boss.sac, legs: [...this.boss.legs], pinned: this.boss.pinned, pool: this.boss.poolRadius, position: [this.boss.position.x, this.boss.position.y, this.boss.position.z], centre: this.boss.centre(new THREE.Vector3()).toArray() } : null,
      maw: this.maw ? { state: this.maw.brain.state, phase: this.maw.brain.phase.id, action: this.maw.brain.action, breath: this.maw.brain.breath, swell: [...this.maw.brain.swell], biomass: this.maw.biomass, fraction: this.maw.fraction, lobes: [...this.maw.lobes], columns: [...this.maw.columns], lights: this.maw.brain.lights.length, pull: [this.mawPull.x, this.mawPull.z], position: this.maw.position.toArray(), centre: this.maw.centre(new THREE.Vector3()).toArray(), pit: { ...this.maw.pit } } : null,
      regent: this.regent ? { state: this.regent.brain.state, phase: this.regent.brain.phase.id, action: this.regent.brain.action, rise: this.regent.body.risen, diving: this.regent.brain.diving, flood: this.regent.brain.flood, pinned: this.regent.pinned, biomass: this.regent.biomass, fraction: this.regent.fraction, pearls: [...this.regent.pearls], eyes: [...this.regent.eyes], position: this.regent.position.toArray(), centre: this.regent.centre(new THREE.Vector3()).toArray(), pool: { x: this.regent.pool.x, z: this.regent.pool.z, radius: this.regent.pool.radius, waterY: this.regent.pool.waterY } } : null,
      widow: this.widow ? { state: this.widow.brain.state, phase: this.widow.brain.phase.id, action: this.widow.brain.action, surface: this.widow.brain.surface, submerged: this.widow.brain.submerged, quicksand: this.widow.brain.quicksand, biomass: this.widow.biomass, fraction: this.widow.fraction, sacs: [...this.widow.sacs], petals: [...this.widow.petals], position: this.widow.position.toArray(), centre: this.widow.centre(new THREE.Vector3()).toArray(), crater: { ...this.widow.crater, pillars: this.widow.arena.pillars } } : null,
      warden: this.warden ? { state: this.warden.brain.state, phase: this.warden.brain.phase.id, action: this.warden.brain.action, surface: this.warden.brain.surface, biomass: this.warden.biomass, fraction: this.warden.fraction, pods: [...this.warden.pods], seams: this.warden.brain.seamOpen.map((_, i) => this.warden!.brain.seamExposed(i)), position: this.warden.position.toArray(), centre: this.warden.centre(new THREE.Vector3()).toArray(), arena: { x0: this.warden.arena.x0, x1: this.warden.arena.x1, z0: this.warden.arena.z0, z1: this.warden.arena.z1, core: this.warden.arena.core, valves: this.warden.arena.valves, catwalks: this.warden.arena.catwalks.map((c) => ({ id: c.id, collapsed: c.collapsed })) } } : null,
      vigil: this.vigil ? { state: this.vigil.brain.state, phase: this.vigil.brain.phase.id, action: this.vigil.brain.action, hidden: this.vigil.brain.hidden, hang: this.vigil.brain.hang, biomass: this.vigil.biomass, fraction: this.vigil.fraction, lure: this.vigil.lure, spines: [...this.vigil.spines], limbs: [...this.vigil.limbs], pinned: this.vigil.pinned, position: this.vigil.position.toArray(), centre: this.vigil.centre(new THREE.Vector3()).toArray(), lair: { x: this.vigil.lair.x, z: this.vigil.lair.z, floorY: this.vigil.lair.floorY, radius: this.vigil.lair.radius, exit: this.vigil.lair.exit, sealed: this.vigil.lair.entrances.map((m) => m.sealed) } } : null,
      arena: this.arena ? { x: this.arena.x, z: this.arena.z, radius: this.arena.radius, floorY: this.arena.floorY, entrances: this.arena.entrances, pillars: this.arena.pillars.map((q) => ({ id: q.id, broken: q.broken })) } : null,
      nests: this.nests.map((n) => ({ id: n.id, state: n.state, biomass: n.biomass, wave: n.wave, brood: n.brood.size, position: [n.position.x, n.position.z] })),
      reviving: this.reviveLeft > 0, grenades: this.grenades.length, mines: this.mines.length, virus: this.injection.active, injecting: this.injection.pending, parasites: this.parasites.length, harvested: [...this.harvested], maxBiomass: this.biomass.max,
    };
  }

  debug() {
    return {
      begin: () => this.begin(),
      teleport: (x: number, z: number) => { this.player.position.set(x, groundHeight(x, z), z); this.player.velocity.set(0, 0, 0); },
      aimAt: (x: number, y: number, z: number) => {
        const eye = this.player.eyePosition;
        const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
        this.player.yaw = Math.atan2(-dx, -dz);
        this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.debugAim = new THREE.Vector3(x, y, z);
      },
      clearAim: () => { this.debugAim = null; },
      trigger: (on: boolean | null) => { this.debugTrigger = on; },
      ego: () => { this.weapon.ego = this.weapon.spec.egoCharge?.chargeToFire ?? 0; this.egoQueued = true; },
      /** Loads these weapons.json ids as the raid's weapon slots. */
      arm: (ids: string[], mods?: string[][]) => this.arm(ids, mods),
      pickUpWeapons: () => this.pickUpWeapons(),
      /** Spawns an Abomination at (x, z) and returns its id (weapon tests need a target). */
      spawn: (kind: string, x: number, z: number) => this.addCreature(kind as AbominationKind, x, z).id,
      equip: (i: number) => this.equip(i),
      reload: () => { const ok = this.weapon.reload(); if (ok) this.onReload(); return ok; },
      aim: (on: boolean) => { this.aimHeld = on; },
      ability: (slot: number) => this.useAbility(slot),
      hold: (code: string, on: boolean) => { if (on) this.player.keys.add(code); else this.player.keys.delete(code); },
      /** Damages nest `i` directly (ventricle index or null for the body). */
      hitNest: (i: number, amount: number, vent: number | null = null) => { const n = this.nests[i]; if (n) this.damageNest(n, amount, vent, n.core(new THREE.Vector3())); },
      /** Damages the boss directly: a tagged sphere ('heart', 'broodSac', 'leg', 'body') or null for a blast. */
      hitBoss: (amount: number, tag: string | null = null, index = 0) => {
        const b = this.boss;
        if (!b) return null;
        const s = tag ? b.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        const at = s ? s.world.clone() : b.centre(new THREE.Vector3());
        return this.damageBoss(amount, s, this.player.position, at);
      },
      /** Damages the Pale Vigil directly: a tagged sphere ('lure', 'spine', 'limb', 'body') or null for a blast. */
      hitVigil: (amount: number, tag: string | null = null, index = 0) => {
        const v = this.vigil;
        if (!v) return null;
        const s = tag ? v.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        return this.damageVigil(amount, s, s ? s.world.clone() : v.centre(new THREE.Vector3()));
      },
      /** Damages the Warden directly: a tagged sphere ('seedPod', 'reactorSeam', 'plate', 'head') or null for a blast. */
      hitWarden: (amount: number, tag: string | null = null, index = 0) => {
        const w = this.warden;
        if (!w) return null;
        const s = tag ? w.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        return this.damageWarden(amount, s, s ? s.world.clone() : w.centre(new THREE.Vector3()));
      },
      /** Damages the Nethermaw directly: a tagged sphere ('lobe', 'column') or null for the body. */
      hitMaw: (amount: number, tag: string | null = null, index = 0) => {
        const m = this.maw;
        if (!m) return false;
        const s = tag === 'column' ? { tag: 'column' as const, index, world: m.centre(new THREE.Vector3()), r: 1 } : tag ? m.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        return this.damageMaw(amount, s, s ? s.world.clone() : m.centre(new THREE.Vector3()));
      },
      /** Damages the Mire Regent directly: a tagged sphere ('pearl', 'eye', 'arm') or null for the body. */
      hitRegent: (amount: number, tag: string | null = null, index = 0) => {
        const g = this.regent;
        if (!g) return false;
        const s = tag ? g.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        return this.damageRegent(amount, s, s ? s.world.clone() : g.centre(new THREE.Vector3()));
      },
      /** Damages the Sandwidow directly: a tagged sphere ('throatSac', 'petal', 'head') or null; only while she is up. */
      hitWidow: (amount: number, tag: string | null = null, index = 0) => {
        const w = this.widow;
        if (!w) return null;
        const s = tag ? w.body.hitSpheres.find((h) => h.tag === tag && h.index === index) ?? null : null;
        return this.damageWidow(amount, s, s ? s.world.clone() : w.centre(new THREE.Vector3()));
      },
      /** Brings the Sandwidow up to breathe now (for tests and screenshots). */
      surfaceWidow: (seconds = 6) => this.widow?.brain.breathe(seconds),
      /** Vents coolant valve i as if shot. */
      ventValve: (i: number) => this.warden?.vent(i),
      killAll: () => { for (const c of this.creatures) if (c.alive) this.damageCreature(c, 1e6, false, null, c.centre, 'debug'); },
      damage: (n: number) => this.hurt(n, 'torso', 'debug', null),
      extractNow: () => { const ex = this.extract; this.player.position.set(ex.x, groundHeight(ex.x, ex.z), ex.z); },
      setTimeScale: (k: number) => { this.timeScale = k; },
      setTimeLeft: (t: number) => { this.elapsed = RAID.raidTime - t; },
      give: (item: string, n = 1) => this.carried.add(item, n),
      melee: () => { this.meleeQueued = true; },
      grenade: () => this.throwGrenade(),
      mine: () => this.placeMine(),
      pouch: (item: string, n = 1) => this.carried.pouch.add(item, n),
      /** Throws `n` of `item` out of the cavities (tests making room); returns how many went. */
      discard: (item: string, n = 1) => this.carried.cavity.remove(item, n),
      /** Drops a container at the host's feet (offset 1.2 m on x); returns its id. */
      dropContainer: (type: string) => this.dropContainer(type, this.player.position.x - 1.2, this.player.position.z).id,
      openContainer: () => this.openContainer(),
      visit: (landmark: string) => this.visit(landmark),
      bossKilled: (boss: string, x?: number, z?: number) => this.bossKilled(boss, x, z),
      /** Injects the first carried vial of `item` (cavities, then pouch). */
      inject: (item: string) => {
        for (const zone of ['cavity', 'pouch'] as const) {
          const i = (zone === 'cavity' ? this.carried.cavity : this.carried.pouch).entries.findIndex((e) => e.item === item);
          if (i >= 0) return this.inject(zone, i);
        }
        return false;
      },
      transfer: (from: 'cavity' | 'pouch' | 'pod', i: number, to: 'cavity' | 'pouch' | 'pod', x?: number, y?: number, r?: boolean) => this.transfer(from, i, to, x, y, r),
    };
  }
}
