# Game Design Document

Owned by the Game Design department. Short living docs, one per system. **Every number lives in `data/*.json`** and is read through `data/index.ts`; the docs explain intent, the JSON is the truth. If a doc and the JSON disagree, the JSON wins and the doc is a bug.

## Design pillars
1. **Every raid is a bet.** You carry your best stuff in, and you can lose all of it. Greed, not the timer, is what kills most hosts.
2. **You are the monster.** The player is an alien organism, not a soldier. Movement, weapons, healing and upgrades are biological: you grow, inject, rupture and regrow.
3. **Mutation you can see from 50 m.** Every upgrade changes your silhouette or glow pattern. Power is readable to friend and rival.
4. **Beautiful, then horrible.** Zone 7 is gorgeous from afar and grotesque up close. Gore glows; kills are wet, luminous and anatomical, never arcade.
5. **Readable chaos.** Psychedelic visuals, but threats always read: glowing weak points, clear wind-ups, no damage numbers.

## Docs
| Doc | What it decides |
| --- | --- |
| [01-core-loop](01-core-loop.md) | The raid loop and the meta loop, what Spore ships of each |
| [02-classes](02-classes.md) | Three host classes, final stats, conflicts between reference screens resolved |
| [03-combat](03-combat.md) | Biomass, Neural Overload, Synapse Burster, abilities, hit zones, feedback rules |
| [04-abominations](04-abominations.md) | Spore creatures: Needlemaw and Bile Cantor, briefs for art, AI and audio |
| [05-raid-and-extraction](05-raid-and-extraction.md) | Raid timer, layout, spawns, Bio-Pod loot, Seed Spire extraction, death |
| [06-roadmap-systems](06-roadmap-systems.md) | Decisions already made for Larva and Host: inventory, stash, viruses, Synapse tree, Flesh Market, PvP |
| [spore-milestone](spore-milestone.md) | The Spore feature list with acceptance criteria per department |
| [larva-milestone](larva-milestone.md) | The Larva feature list: stash, cavities, harvesting, viruses, three new creatures, the Brood Heart |
| [host-milestone](host-milestone.md) | **The Host feature list: three class kits, Synapse trees, first evolutions, Viral Lab, Flesh Market, rival hosts, the 1 km map, three more creatures** |

## Data files
| File | Contents | Main readers |
| --- | --- | --- |
| `data/classes.json` | Host class stats | Gameplay, UI |
| `data/host.json` | Neural Overload, hit zones, fall damage | Gameplay, UI, Rendering (overload FX) |
| `data/weapons.json` | Synapse Burster and Ego Charge | Gameplay, Audio |
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

`tests/data.test.ts` checks cross-references and the balance targets stated in these docs, so a tuning change that breaks a design promise fails CI.

## Naming
All names here are original to BIOPHAGE. Before adding a name, search it against existing games; if it is a known game's term, pick another.
