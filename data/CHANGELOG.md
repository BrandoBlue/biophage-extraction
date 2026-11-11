# Balance changelog

Every tuning change to `data/*.json`, newest first, with the reason.

## Economy, zones and bosses (2026-11-11, after Brandon's v0.1 playtest)
- New: vendors.json (Mother Clot, the Archivist, the Gullet Broker), contracts.json (11 contracts in 3 chains), hive.json (Hive Body organs and recipes), zones.json (5 zones), bosses.json (the Reliquary, the Warden).
- New items: Seed Key, Black Box, Coolant Rod, Reliquary Heart, Ribchoir Bone, Warden Seed-Core, Embryo Pod; containers Reliquary Cage, Sealed Locker, Cargo Crate.
- Evolutions now cost DNA plus catalyst organs; Reliquary and Warden XP added.

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
