# 05 Raid, loot and extraction (Spore)

Numbers in `data/raid.json` and `data/loot.json`.

## The pocket
A single Zone 7 floating island, about 300 m across (playable radius 150 m), edges falling into the void. Positions in the data are fractions of the radius plus a compass bearing (0° = north = −Z, 90° = east = +X), so World & Level can reshape the island without breaking design.

| Feature | Where | Notes |
| --- | --- | --- |
| Spawn | rim, bearing 200° | 8 s safety, no enemy within 35 m |
| Seed Spire extract | rim, bearing 20° (opposite spawn, about 250 m away) | visible from spawn as a towering lit stalk |
| Bio-Pod | near centre, bearing 90° | guarded by a Bile Cantor |
| Falls of liquid light, giant fungi | World's call | navigation landmarks, cover |

## Spawns
- Start: two Needlemaw packs in the middle ring, one pack near the extract (the last test), one Cantor guarding the Bio-Pod, one roaming Cantor.
- Reinforcements: from 2:30, a Needlemaw pack every 90 s, spawned at least 45 m from the player, out of view. Cap 18 creatures alive.

## Raid timer
10:00. At 2:00 remaining the zone begins to collapse: sky shifts, warning on HUD, scanner pulses red. At 0:00 the host takes 25/s until dead. The point is a hard ceiling for greed, not the usual cause of death.

## Loot: the Bio-Pod
A waist-high pulsing cyst of membrane and bone. Hold interact 1.5 s to tear it open (makes noise to 18 m). Always contains 1 Clot Gel plus 2 rolls:
| Item | Kind | Weight | DNA value |
| --- | --- | --- | --- |
| DNA Strand Bundle ×2 to 4 | currency | 40 | 25 each |
| Clot Gel ×1 to 2 | consumable | 20 | 15 |
| Raw Mutagen Vial | mutagen | 18 | 60 |
| Synapse Lens | tech | 12 | 90 |
| Plague-Stalker Strain | virus (inert until Larva) | 8 | 180 |
| Glitching Heart | organ, jackpot | 2 | 300 |

In Spore, looted items go straight into a simple carried list (shown as icons on the HUD); the grid inventory arrives in Larva. Kill DNA is added to the carried haul too.

## Extraction: the Seed Spire
A tall fleshy stalk with a seed-capsule at its base. Step into its 4 m zone and the capsule opens; hold the zone for **8 s** (Infiltrator; ×0.7 Wraith, ×2.0 Behemoth). Leaving resets it. Taking damage does not interrupt. The capsule's signal is loud (40 m), so starting extraction pulls nearby creatures: clear the area or bring Overload headroom. At 8 s the capsule closes and fires skyward: **EXTRACTED**.

## Death
Biomass 0 = **HOST LOST**. Everything carried, including kill DNA, is lost. The end screen lists what was lost and its value.
