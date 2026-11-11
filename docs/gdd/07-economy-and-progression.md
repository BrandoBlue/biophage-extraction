# 07 Economy and progression: why you extract

Brandon's ask after playing v0.1: *"the game needs to feel like it has a reason to play and extract."* This doc is that reason. Numbers live in `data/vendors.json`, `data/contracts.json`, `data/hive.json`, `data/progression.json` and `data/market.json`.

## The loop in one line
**Every raid has a shopping list.** You go in for something specific (a contract, an organ your Hive needs, a catalyst for your next evolution), you grab what else you can, and you only keep it if you get out.

## What every kind of loot is for
| Loot | What it buys you | Where you spend it |
| --- | --- | --- |
| **DNA** (kills, Strand Bundles, selling) | Everything: Synapse nodes, evolutions, Hive organs, stash rows, gut pouch, vendor stock, Viral Lab, paid extracts, zone intel | Every Hive screen |
| **Organs** (corpse harvesting) | Hive organ upgrades, Gestation Vat recipes, Mother Clot's contracts and best prices, evolution catalysts | Hive Body, Mother Clot |
| **Tech** (crates, sealed lockers, the Long Seed) | Memory Coral, the Archivist's contracts and best prices, Seed Keys, the Long Seed's power | Hive Body, Archivist |
| **Viruses** | Inject mid-raid, make permanent in the Viral Lab, or sell | Raid, Viral Lab |
| **Boss and nest organs** (Reliquary Heart, Warden Seed-Core, Brood Heart Seed) | **Evolutions** (each needs a catalyst), top Hive organ levels, the big contracts | Evolution Lab |

Nothing is "vendor trash only": every item type has at least one use besides selling, so picking what to carry out is a real decision.

## Vendors (a menu in the Hive, not a town)
Each vendor buys anything (at their own rate, better for what they like), sells a stock that grows with **reputation** (levels 1 to 4 at 0 / 100 / 300 / 700 points; 1 point per 100 DNA traded, plus contract rewards), and gives **contracts**.
| Vendor | From | Who they are | Buys best | Sells |
| --- | --- | --- | --- | --- |
| **Mother Clot** | Larva | A heavy, kindly, many-breasted organism grown into a nest of warm membrane at the heart of the Hive, tending a crèche of half-formed hosts. Her arms are umbilical cords; she hums. | Organs (×1.25) | Clot Gel, mutagens, viruses, Heart Husk at rep 4 |
| **The Archivist** | Larva | A blind cephalopod the size of a room in a tank of milky liquid memory, reading thousands of glass data-spines. It speaks in your own voice, played back. | Tech (×1.3) | Seed Keys, grenades, Coolant Rods, Synapse Lenses; zone intel; scanner tuning |
| **The Gullet Broker** | Host | The black market (see Host spec): a three-storey gullet with a choir of small hands. | Everything, at its mood | Contraband: grenades, mines, Heart Husk |

## Contracts
One active contract per vendor; each chain tells a small story and unlocks something real.
| Vendor | Chain | Unlocks |
| --- | --- | --- |
| Mother Clot | First Blood → A Song for the Crèche → Heart of the Brood → **Rib and Hymn** (kill the Reliquary) | Gestation Vat; a Heart Husk |
| The Archivist | Eyes in the Glass → **Signal in the Wreck** → Cold Reactor → Wake the Warden (Host) | **The Wreck of the Long Seed zone**; Seed Keys; the Warden fight |
| The Gullet Broker (Host) | Husks and Liars → A Rival's Tithe → The Lantern Hunt | Contraband, the Broker's rep tiers |
Objective types: harvest, kill, extract with an item, visit a landmark, open a container, kill a boss, kill rival hosts, survive a raid, place an item. **Progress only counts if you extract**, so a contract is itself a reason to get out alive.

## The Hive Body (your base is alive)
The Hive is an organism you grow by feeding it what you extract. Each organ has levels, and **each level costs specific items**, so every upgrade is a raid goal.
| Organ | From | Does | Example costs |
| --- | --- | --- | --- |
| **Gestation Vat** | Larva | Grows consumables, mutagens and finally random viruses from organs over real time | 4 Needlemaw glands → 2 Song Sacs + a Brood Heart Seed → a Reliquary Heart + 2 Embryo Pods |
| **Spore Garden** | Larva | Fruits DNA while you are away (20 → 45 → 90 per hour, capped) | Oculimoth eyes → Mournback marrow → a Lumen lantern gland |
| **Memory Coral** | Larva | Shows Bio-Pods at raid start; later shows boss state and anomaly forecasts | Synapse Lenses → a Black Box + Glasswalker lenses |
| **Antibody Well** | Host | Toxin resistance; later +1 stable Viral Load | Weaver ganglia → a Warden Seed-Core |
The Hive screen shows each organ as a living thing that visibly grows with its level.

## Evolutions need catalysts
On top of class level and DNA, every evolution needs **catalyst organs** from bosses or nests (`progression.json` `cost`): the Neuro-Hound needs a Reliquary Heart; the Acid Parasite needs a Brood Heart Seed and Glasswalker lenses; the Crustacean Grunt needs Mournback marrow and Ribchoir bone. The strongest bodies come from the hardest fights, and you have to carry the catalyst out.

## Difficulty: a hard game
- Death costs everything carried; banked DNA and the Hive are never at risk, so loss stings without wiping progress.
- Bosses are tuned for a well-equipped solo host to need most of a magazine cycle per phase and to punish standing still; a squad of three is the comfortable way (Hive milestone).
- Bosses sing across the whole zone: everyone knows when someone is fighting one. That is the PvP magnet in multiplayer.
- No floating damage numbers, no minimap pins on loot: you learn the zones.

## Folded into the milestones
- **Larva** adds Mother Clot and the Archivist with their first contract chains, the Gestation Vat, Spore Garden and Memory Coral, the Glowmire Isle structures, the **Reliquary**, and the **Wreck of the Long Seed** zone (no boss yet; the reactor is cold). See [larva-milestone](larva-milestone.md).
- **Host** adds the Gullet Broker's contracts, the Antibody Well, evolution catalysts in use, the Warden, and the Expanse. See [host-milestone](host-milestone.md).
