# Balance changelog

Every tuning change to `data/*.json`, newest first, with the reason.

## The Expanse opens now; the pay-to-leave rule (2026-11-12)
- zones.json `expanse`: milestone larva, access open (coordinator: Brandon reviews by playing and wants the 1 km map now). The intended gate is kept in `accessNote`.
- raid.json `host.extracts.paidExtract`: alwaysOpen, payFrom carried kill DNA then banked DNA, charged on a completed channel, per host.

## Vendors sell ammo for the guns they sell (2026-11-12)
- vendors.json: Mother Clot adds Needle Feed (rep 1), Shard Feed (rep 2) and Bolt Feed (rep 3). The Gullet Broker adds Spore Feed (rep 2). Prices match the Archivist's. A data test enforces the rule.

## Creature minds (2026-11-12, Brandon: smart, creepy, show how they think)
- abominations.json: every creature gets a `mind` block (wants, shows, plans, learns). The bar is in docs/gdd/11-creature-minds.md, and a data test enforces it.

## Warden arena fits the hull (2026-11-11, World #81)
- bosses.json `warden.arena`: height 24 → 18 and diameter 30 → 38. The Long Seed's hull is 18 m, and World's built reactor chamber is about 38 × 40 m.

## Three new zones, Apex and online (2026-11-11, Brandon: everything now)
- zones.json: `ochreReach`, `weepingFen` and `marrowPit` (orders 4–6, with depth `layers` for the pit). The Hollow Choir and Ossuary Reef move to orders 7–8 and get sizes, landmarks, creatures and bosses.
- abominations.json: nine creatures (Dunewake, Bristleback, Shroudling, Cablecrawler, Veilwing, the Hollowed, Fenstalker, Mirebrood, Mistwader), introducedIn host.
- bosses.json: the Sandwidow, the Nethermaw, the Mire Regent; Apex: the Hymnal, the Bone Tide.
- loot.json: 15 organs and catalysts, 3 tech items, the Undermouth Spore; containers Settler Locker, Pit Crate, Deep Cache, Root Hollow, Drowned Pod Locker and three boss hoards.
- habitats.json: homes and loot placement for all five zones; the Glowmire Glasswalker fallback is removed now that the fungal caves exist.
- contracts.json: three zone-unlock contracts and three boss contracts. progression.json: kill XP; Apex evolutions get stat changes, grants, full body briefs, and new-boss catalysts.
- online.json (new): the Hive milestone's online rules.

## The Pale Vigil (2026-11-11, Brandon: harder, scarier, more bosses)
- bosses.json: `paleVigil`, Glowmire's second boss in the fungal caves. 2400 Biomass, a silent ceiling-hanger with a lure; phases hang, stalk and unravel; enrage at 360 s.
- loot.json: Vigil Lure (organ catalyst) and the Vigil's Cocoon container. progression.json xp.kill.paleVigil 900. zones.json glowmireIsle `bosses`. contracts.json: the Archivist's *The Light Under the Cliff*.

## Weapons and habitats (2026-11-11, after Brandon's second playtest)
- weapons.json: 15 new guns across sidearm, SMG, rifle, shotgun, marksman, sniper, launcher, beam and relic. The Synapse Burster keeps every Spore number and gains the shared schema fields.
- loot.json: weapon and ammo items. Four feeds (Spore, Needle, Shard, Bolt). Guns and feeds added to the Bio-Pod, cargo crate, sealed locker, Brood cache and Gene Bloom tables. The Reliquary Hymn is guaranteed from the Reliquary Cage. Bio-Pod odds for non-weapon loot drop slightly because the table grew.
- vendors.json: weapon and feed stock by reputation. The Gullet Broker prefers weapons (×1.15).
- Class signature guns: `unlock {class, level}`, three per class at levels 3, 6 and 10, grown in the Armoury at 60% of value. profile.json `weaponSlots: 2`.
- mods.json (new): 15 graft mods across the barrel, sight, under and chamber sockets. Added to loot tables, vendor stock and four new Gestation Vat recipes.
- weapon-feel.json (new): reload beats, fire kick/shake/push per class, idle breathing.
- habitats.json (new): homes per species per zone. Glowmire head-count is unchanged from raid.json spawnGroups, so only placement changes.

## Economy, zones and bosses (2026-11-11, after Brandon's v0.1 playtest)
- New: vendors.json (Mother Clot, the Archivist, the Gullet Broker), contracts.json (11 contracts in 3 chains), hive.json (Hive Body organs and recipes), zones.json (5 zones), bosses.json (the Reliquary, the Warden).
- New items: Seed Key, Black Box, Coolant Rod, Reliquary Heart, Ribchoir Bone, Warden Seed-Core, Embryo Pod; containers Reliquary Cage, Sealed Locker, Cargo Crate.
- Evolutions now cost DNA plus catalyst organs; Reliquary and Warden XP added.
- Mother Clot gets machine-readable `perks` (10% off pouch upgrades at rep 2, one free Clot Gel per deploy at rep 4) for Gameplay to enforce; other vendor unlocks stay as text for now. Kill objectives name their target with `creature`.
- Reliquary timing for PvE AI (approved by Design): per-phase `turnRate`, attack wind-ups (rear-up 1.4 s, hymn 1.0 s, cover break 1.2 s, tendril grab 0.8 s, brood drop 0.8 s), hearts exposed 4 s after a vent, hymn ring to 30 m and 0.6 m tall, cover break reach 12 m, grab range 10 m, forelimb lunge ×2.5 for 0.6 s, stalk front armour covers a 120° arc, first brood drop 8 s after waking, `wakeRadius` 30, `songLoops`; plus `holdDistance` per phase (5, 10, 0 m), vent trigger range 14 m and `legs.slowPerSevered` 0.15 (the brief's 15%).

## Host spec (2026-11-11)
- New tables: kits, synapse, progression, viral-lab, market, rivals, `RAID.host`; Tithe Weaver, Husk Mimic and Lumen Grazer added with their organs. No Spore or Larva values changed.
- `classes.json` `stashSlots` is deprecated: the stash is shared by the profile (see Larva).

## Spore tuning pass 1 (2026-11-11)
Measured with `scripts/playtest.mjs` (headless bot: beelines to the Bio-Pod then the Seed Spire, sprints under 70 Overload, stops to shoot threats with aim error 0.5 m + 5 cm per metre, heals under 80 Biomass).

Before (v0.1.0 values, near-perfect bot aim): full raid 66 s, 13 kills, 116 damage taken, 3/3 extracted; rush 52 s, 0 damage; greedy (camp until 2:00 left) 0 to 86 damage. Reinforcements were no threat and nothing pushed back on a full raid.

Changes:
- Needlemaw Biomass 60 → 75 and pack size 3–5 → 4–6. Still dies in under a second of fire; a magazine still clears a full pack.
- Spore spawns: 3 middle-ring Needlemaw packs (was 2) and 2 roaming Bile Cantors (was 1).
- Reinforcements from 1:30 every 60 s (was 2:30 every 90 s).
- Seed Spire channel 8 → 10 s, so the extract signal has time to pull creatures in.
- Pacing targets: rush 75 s, full raid 240 s (the 300 m island is crossed in about 40 s; 5 minutes was not realistic without more content, which Larva adds).

After (human-like aim): full raid 74 s, 14 kills, 74 damage taken (one run down to 42 Biomass), 4/4 extracted; rush 61 s, 105 damage taken (one run down to 32); greedy 461 s, 46 kills, 221 damage taken and a Clot Gel used. Every mode now costs Biomass, and greed costs the most. Next tuning pass: from Brandon's own play of v0.1.x.

## Spore design pass (2026-11-11)
- First full values for classes, host rules, Synapse Burster, abilities, Needlemaw, Bile Cantor, Bio-Pod loot and the raid. Reasoning in `docs/gdd/`.
- Venom-Wraith walk speed set to +40%, not the brief's +80%, for aim tracking and PvP fairness (see `docs/gdd/02-classes.md`).
