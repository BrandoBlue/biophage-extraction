# Game Design Document

Owned by the Game Design department. Short living docs, one per system. **Every number lives in `data/*.json`** and is read through `data/index.ts`; the docs explain intent, the JSON is the truth. If a doc and the JSON disagree, the JSON wins and the doc is a bug.

## Design pillars
1. **Every raid is a bet.** You carry your best stuff in, and you can lose all of it. Greed, not the timer, is what kills most hosts.
2. **You are the monster.** The player is an alien organism, not a soldier. Movement, weapons, healing and upgrades are biological: you grow, inject, rupture and regrow.
3. **Mutation you can see from 50 m.** Every upgrade changes your silhouette or glow pattern. Power is readable to friend and rival.
4. **Beautiful, then horrible.** Zone 7 is gorgeous from afar and grotesque up close. Gore glows; kills are wet, luminous and anatomical, never arcade.
5. **Readable chaos.** Psychedelic visuals, but threats always read: glowing weak points, clear wind-ups, no damage numbers.
6. **Ethereal, not neon.** (Brandon, v0.1 playtest.) Mist, soft natural light and wet organic surfaces; glow is an accent on creatures, fungi and liquid light, never a wash. Neon-everything reads as AI-made.
7. **Every raid has a shopping list.** Contracts, Hive organs and evolution catalysts give each raid a goal; nothing counts until you extract. See [07](07-economy-and-progression.md).

## Docs
| Doc | What it decides |
| --- | --- |
| [01-core-loop](01-core-loop.md) | The raid loop and the meta loop, what Spore ships of each |
| [02-classes](02-classes.md) | Three host classes, final stats, conflicts between reference screens resolved |
| [03-combat](03-combat.md) | Biomass, Neural Overload, Synapse Burster, abilities, hit zones, feedback rules |
| [04-abominations](04-abominations.md) | Spore creatures: Needlemaw and Bile Cantor, briefs for art, AI and audio |
| [05-raid-and-extraction](05-raid-and-extraction.md) | Raid timer, layout, spawns, Bio-Pod loot, Seed Spire extraction, death |
| [07-economy-and-progression](07-economy-and-progression.md) | **Why you extract:** what every loot type is for, vendors, contracts, the Hive Body, evolution catalysts, difficulty |
| [08-zones-and-bosses](08-zones-and-bosses.md) | **Zone roster** (Glowmire Isle, Wreck of the Long Seed, the Expanse, two Apex zones) and **bosses** (the Reliquary, the Warden) |
| [09-weapons-and-habitats](09-weapons-and-habitats.md) | **16-gun roster** (reload styles, zoom or not, rarity, ammo feeds, where each is found) and **habitats**: where every creature lives and where containers sit |
| [06-roadmap-systems](06-roadmap-systems.md) | Decisions already made for Larva and Host: inventory, stash, viruses, Synapse tree, Flesh Market, PvP |
| [spore-milestone](spore-milestone.md) | The Spore feature list with acceptance criteria per department |
| [larva-milestone](larva-milestone.md) | The Larva feature list: stash, cavities, harvesting, viruses, three new creatures, the Brood Heart |
| [host-milestone](host-milestone.md) | **The Host feature list: three class kits, Synapse trees, first evolutions, Viral Lab, Flesh Market, rival hosts, the 1 km map, three more creatures** |

## Data files
| File | Contents | Main readers |
| --- | --- | --- |
| `data/classes.json` | Host class stats | Gameplay, UI |
| `data/host.json` | Neural Overload, hit zones, fall damage | Gameplay, UI, Rendering (overload FX) |
| `data/weapons.json` | The 16-gun roster (the Synapse Burster keeps its Ego Charge) | Gameplay, Creatures, UI, Audio |
| `data/abilities.json` | Ability slots: Psych-Wave Pulse, Clot Gel | Gameplay, UI |
| `data/abominations.json` | Needlemaw, Bile Cantor | AI, Creatures, Gameplay |
| `data/loot.json` | Items, values, Bio-Pod loot table | Gameplay, UI |
| `data/raid.json` | Timer, layout, spawns, extraction, reinforcements; `larva` block | World, AI, Gameplay |
| `data/viruses.json` | Mid-raid viruses, injection rules, mutation art briefs | Gameplay, Creatures, Rendering |
| `data/nests.json` | Brood Heart waves and rewards | AI, Gameplay |
| `data/profile.json` | Persistent profile, stash, gut pouch, death rules | Gameplay, UI |
| `data/kits.json` | Class weapons, melee, abilities, passives (Host) | Gameplay, Creatures, UI |
| `data/synapse.json` | Genetic Synapse trees with a visual brief per node | Gameplay, Creatures, UI |
| `data/progression.json` | XP, levels, evolutions with body briefs | Gameplay, Creatures, UI |
| `data/viral-lab.json` | Virus integration, Viral Load, instabilities | Gameplay, UI |
| `data/market.json` | The Gullet Broker: catalogue, mood, contraband | Gameplay, UI, Audio |
| `data/rivals.json` | Rival host bots | AI |
| `data/vendors.json` | Mother Clot, the Archivist, the Gullet Broker: rates, stock, reputation | Gameplay, UI |
| `data/contracts.json` | Contract chains and objectives | Gameplay, UI |
| `data/hive.json` | Hive Body organs and Gestation recipes | Gameplay, UI |
| `data/zones.json` | Zone roster: access, raid time, structures, foes, loot focus | World, AI, UI, Gameplay |
| `data/mods.json` | Weapon mods: living grafts per socket | Gameplay, Creatures, UI |
| `data/weapon-feel.json` | Reload beats and firing feel per class | Gameplay, Creatures, Audio |
| `data/habitats.json` | Where each species lives per zone; deliberate container placement | AI, World, Gameplay |
| `data/bosses.json` | The Reliquary and the Warden: phases, weak points, arenas, rewards | Creatures, AI, World, Gameplay |

`tests/data.test.ts` checks cross-references and the balance targets stated in these docs, so a tuning change that breaks a design promise fails CI.

## Naming
All names here are original to BIOPHAGE. Before adding a name, search it against existing games; if it is a known game's term, pick another.
