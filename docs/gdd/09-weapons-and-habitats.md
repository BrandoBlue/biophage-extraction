# 09: Weapons and habitats

Written after Brandon's second playtest (2026-11-11). He asked for lots of weapons, each with a reload animation and each either zooming or not. He also asked that nothing feel random or scattered, and that monsters live in particular places. The numbers are in `data/weapons.json`, `data/habitats.json`, `data/loot.json` and `data/vendors.json`. If this doc and the JSON disagree, the JSON wins.

## Weapons: what makes a BIOPHAGE gun
Every gun is a living thing grafted to the host arm. It is never a machine with a skin on it. Three things set each gun apart:
- **Its reload is an act of the body.** `reload.style` picks the animation:
  - **magazine:** tear out a spent sac and push in a fresh one.
  - **perShell:** feed shells into a throat, a cylinder or a jaw one at a time. You can cancel to fire.
  - **regrow:** the gun closes up and heals its charge. It needs no ammo but leaves you exposed.
- **It zooms or it doesn't.** `ads: false` guns are hip-fire beasts: shotguns, the Hive Spitter, the Brood Mortar. Sight guns zoom 1.15× to 2×. Scope guns (`scope: true`, 3× and 6×) draw the living-eye overlay. The choice is part of what the gun is, never a stat to upgrade.
- **Its projectile reads at a glance.** There are five looks: spore, needle, shard, glob and bolt. Each has its own speed, drop and impact.

## The roster (16)
| Id | Class | Rarity | Fire | Zoom | Reload | Found / sold |
| --- | --- | --- | --- | --- | --- | --- |
| synapseBurster | carbine | starter | auto | 1.3× | regrow | innate, never lost |
| quillet | sidearm | common | semi | 1.2× | magazine | Bio-Pods; Mother Clot rep 1 |
| hiveSpitter | SMG | common | auto | none | magazine | Bio-Pods; Mother Clot rep 1 |
| marrowHand | heavy sidearm | uncommon | semi | 1.15× | perShell | cargo crates; Archivist rep 2 |
| stingerChoir | SMG | uncommon | 3-burst | 1.25× | magazine | Mother Clot rep 2 |
| cicadine | rifle | uncommon | 4-burst | 1.6× | magazine | cargo crates; Archivist rep 1 |
| gulletScatter | shotgun | uncommon | semi, 8 pellets | none | perShell | cargo crates; Mother Clot rep 2 |
| vertebraRifle | rifle | rare | auto | 1.5× | magazine | cargo crates (rare); Archivist rep 3 |
| bloomcannon | auto shotgun | rare | auto, 6 pellets | none | magazine | Brood caches; Gullet Broker (Host) |
| eyestalkMarksman | marksman | rare | semi | 3× scope | magazine | sealed lockers, cargo crates (rare); Archivist rep 3 |
| broodMortar | launcher | rare | semi, arcing splash | none | perShell | Brood caches; Mother Clot rep 3 |
| leviathanQuill | sniper | epic | semi, pierces | 6× scope | perShell | sealed lockers only |
| tumorLauncher | launcher | epic | sticky, delayed burst | 1.3× | magazine | sealed lockers; Archivist rep 4 |
| lumenLance | charge beam | epic | charge, pierces 2 | 2× | regrow, heats you | Gene Blooms (rare); Gullet Broker rep 4 (Host) |
| reliquaryHymn | relic | relic | charge, 3-bolt fan | 1.4× | regrow | the Reliquary's cage, guaranteed |
| coreburner | relic | relic | auto, overheats | 1.3× | regrow | the Warden (Host) |

The fantasy line for each gun is in its `fantasy` field. Creature & Mutation models from it.

### Rarity ladder
Rarity runs common, uncommon, rare, epic, relic. Each tier is worth more DNA than the whole tier below it (150, 350, 700, 1400 and 2500 DNA). Rarer guns look more alive: they twitch, breathe, and have eyes and teeth. Relics come only from bosses, which gives you a reason to fight one.

### Ammo is loot
Most guns eat a **feed**: Spore Feed Sacs, Needle Quivers, Shard Clutches or Bolt Seeds. You find feed in containers, buy it cheaply from vendors, and carry it in your cavities. A big gun with an empty belly is dead weight, so every raid has a second shopping list. The starter and the regrow guns need no feed. The Lance and the relics pay in Neural Overload instead.

### Balance promises (tested)
- No gun kills a Neuro-Infiltrator faster than 0.6 s with body shots, and no gun one-shots a host with a body shot. The Leviathan Quill's one-shot needs a weak-point hit.
- Sustained damage is between 30 DPS (launchers, which make up for it with splash) and 333 DPS.
- Every non-relic gun can be found or bought. Every relic names the boss it comes from.
- Vendors never sell a gun for less than they pay for it.

### What sets the guns apart (besides damage)
- **handling.moveSpeed:** big guns slow you, by up to 10% for the Leviathan Quill.
- **equipTime:** how long a swap takes.
- **Spread while moving:** marksman guns punish moving shots (×1.6 to ×2.0).
- **Falloff:** shotguns drop to 25% damage by 15 to 18 m. Marksman guns keep 70 to 80% out to their range.

## Habitats: every creature lives somewhere
No creature appears at a random point any more. `data/habitats.json` gives each species a **home** in each zone, and the `where` field says where that home is:
- `landmark`: a named landmark.
- `room`: a room in the Long Seed.
- `band`: a stretch of terrain given as a radius fraction and a bearing range.
- `biome`: one of the Expanse biomes.
- `nearExtract`: the approach to the extract.
- `guards`: sitting over a container.

`roam` is the leash, i.e. how far the creature wanders before it drifts home. Reinforcements walk in from the nearest home of their species that is out of sight. They never pop in behind you. Learning where things live becomes player knowledge: *the tower top has a Glasswalker; the rim falls sing with Cantors.*

### Glowmire Isle
| Species | Home | Why |
| --- | --- | --- |
| Needlemaw | packs at the Long Seed debris, the western marsh, the southern fungus fields; one pack patrols the extract | pack hunters of open ground; scavengers of the wreck |
| Bile Cantor | over a Bio-Pod it has claimed; a colony of two at the south-west rim falls | they hover over liquid light |
| Glasswalker | top floor of the Hollow Chitin Tower; the fungal caves (the debris field until the caves are built) | ambushers of tight, dark places |
| Oculimoth | swarm round the northern Seed Spire | drawn to light |
| Mournback | alone in the north-east fungal grove | a grazer, kept clear of the Reliquary's bowl |

Head-count is unchanged from the tuned Spore and Larva spawn groups: only *where* changed. This is tested.

### Wreck of the Long Seed
| Species | Room |
| --- | --- |
| Needlemaw | packs in the Breached Prow (they came in through the breach) and in Cargo Hold B |
| Glasswalker | two in the Crew Warrens; one hatches from an Embryo Gallery tank when you come within 8 m |
| Oculimoth | roosting high in Cargo Hold A |
| Tithe Weaver (Host) | webbing the Crew Warren vents |
| Husk Mimic (Host) | in both cargo holds, disguised as a cargo crate |

The Escape Pod Bay is quiet on purpose: it's the breather before you extract.

### The Expanse (Host)
Each species lives in its biome:
- Needlemaw in Glowmire Flats and Brood Hollow.
- Cantor colonies on the Choir Chasm islands.
- Glasswalkers and Oculimoth swarms in the Chitin Spires.
- Mournbacks grazing the wreck's ribs, with Husk Mimics among its loot.
- Tithe Weavers across Brood Hollow.
- Lumen Grazers drifting high over the Chasm and the Flats.

### Loot placement
Containers sit where there is a reason for them (`habitats.json` `loot`):
- Two Bio-Pods on the upper floors of the tower, so the climb is the risk.
- One Bio-Pod in Needlemaw marsh.
- One Bio-Pod under the Cantor falls.
- Three cargo crates spilled from the debris field. These hold the first real guns and ammo.

In the Long Seed, the crates are in the holds and the lockers are in the warrens and gallery, as World has built them.

## Department asks
| Department | Build |
| --- | --- |
| Gameplay Engineering | A data-driven weapon engine for the schema above; feed items as ammo; spawning from `HABITATS` via `habitatGroups(zone, kind, milestone)` instead of `spawnGroups`; reinforcements walk in from homes. |
| Creature & Mutation | One living model per weapon from its `fantasy` line, a reload animation per `reload.style`, an eye-scope overlay for `scope: true`, rarity readable on the model. |
| PvE AI & Encounters | `roam` leash per home; a Glasswalker that hatches on approach; Husk Mimics disguised as crates (Host); reinforcements path in from a home. |
| World & Level | Places for every home: the fungal caves, the north-east grove, the rim falls, the tower top floor; container placement as listed. |
| UI & HUD | Weapon cards (class, rarity, zoom or not, reload style, ammo), the ammo count by feed type, weapon stock in vendor screens. |
