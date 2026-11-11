# Host milestone: feature list and acceptance criteria

**Goal:** three living hosts that look, move and fight completely differently, and a body that keeps changing as you play. Rival hosts share the island with you. Extracted DNA becomes new flesh through the Genetic Synapse tree, the Viral Lab and the Flesh Market. The map grows to 1 km with five biomes, shifting extracts and anomalies.

**The promise Brandon asked for most:** mutations and evolutions you can see. Every unlock in Host changes the body. If a node, strain or evolution has no visible change, it is not finished.

**Exit criteria (whole milestone):**
- [ ] All three classes playable with their kits; each reads as a different animal from 50 m and in first person (own arms and weapon).
- [ ] Buying any Synapse node changes the host's model in the Hive pedestal view and in first person within one raid.
- [ ] Each class can reach and trigger its first evolution; the evolution replaces the body silhouette, with a dissolve-grow transformation scene in the Hive.
- [ ] A Viral Lab integration permanently changes the host's resting look and stats; going over the stable Viral Load visibly adds an instability.
- [ ] The Flesh Market buys and sells, rotates stock daily, and its mood changes prices.
- [ ] 2 to 4 rival host bots per raid that loot, fight Abominations and the player, and extract or die.
- [ ] The 1 km map has five biomes, extracts that shift every 5 minutes, and at least one anomaly per raid on average.
- [ ] Eight Abomination types: the five from Larva plus Tithe Weaver, Husk Mimic and Lumen Grazer.
- [ ] Every number in `data/` and read through `data/index.ts`: `KITS`, `SYNAPSE`, `PROGRESSION`, `VIRAL_LAB`, `MARKET`, `RIVALS`, `RAID.host`.

## The three hosts (`data/classes.json` stats, `data/kits.json` kits)
Base stats are unchanged (see [02-classes](02-classes.md)). **The Wraith's speed is the single value `venomWraith.moveSpeed` in `classes.json`: 7.3 m/s is +40%; set it to 9.4 for the brief's +80%.**

| | Venom-Wraith | Neuro-Infiltrator | Gore-Behemoth |
| --- | --- | --- | --- |
| Innate weapon | **Venom Lancet**: a segmented ovipositor along the forearm that spits glassy venom needles. 11/s, 9 damage, venom 3/s stacking to 5. | **Synapse Burster** (unchanged) | **Marrow Cannon**: a ribcage on the arm that cracks open and fires 9 bone shards. 1.4/s, close range, knockback. |
| Melee | Blade Forearms, 45, ×2.5 from behind | Cranial Spike, 30 | Crushing Slam, 80 in a 2.5 m area, staggers |
| Slot 1 | **Phase Dash**: 9 m blink, invulnerable, 2 charges | Psych-Wave Pulse | **Crash Through**: 14 m charge, breaks barriers, 60 impact |
| Slot 2 | **Wing Glide**: hold to glide (drains Overload), very quiet | **Bio-Radar Bulb**: plant a living radar bulb that pings life within 30 m for 40 s | **Shell Brace**: hold to take 20% from the front, slow |
| Passives | Silent sprint; fast extract | Faster reload and aim on every weapon; toxin resistance | Ignores minor hits; viruses' side effects halved; can't use crawl tunnels |

All innate weapons are grown, never lost on death. Slots 3 to 5 are filled by Synapse abilities and viruses.

## Genetic Synapse tree (`data/synapse.json`)
Per class, three paths of five nodes drawn as neurons (reference 01): circular nodes joined by glowing veins, coloured by `PATH` in `src/render/palette.ts`. Nodes unlock in order along a path. Cost is DNA plus Raw Mutagen Vials (Infiltrator pays ×1.15 mutagens, rounded up: `nodeMutagenCost`), gated by class level.

| Class | Path (colour) | What it builds toward |
| --- | --- | --- |
| Venom-Wraith | Ghost (stealth green) | Camouflage Pores → Acoustic Dampeners → Phase Dash: Afterimage → Light-Eater Scales → Hollow Step |
| | Stinger (melee amber) | Neurotoxic Blades → Serrated Reach → Adrenaline Spike → Mantis Lock (third pair of arms) → Frenzy Claws |
| | Phage-Carrier (viral violet) | Infectious Spores → Aerosol Spit → Brood Gland (2 virus slots) → Plague Bloom → Hyper-Velo Viral Strain |
| Neuro-Infiltrator | Mind (DNA cyan) | Wide-Band Antennae → Echo Memory → Psychic Hook → Overclock Cortex → Hive Voice |
| | Spore (viral violet) | Dense Spores → Deep Magazine → Seeker Charge → Toxic Burst → Symbiont Bond (the gun fuses into the shoulder) |
| | Graft (stealth green) | Chitin Plates → Clot Glands → Filter Lungs → Second Heart → Graft Carapace |
| Gore-Behemoth | Bulwark (DNA cyan) | Bone Crown → Brace Spines → Ossuary Plates → Anchor Claws → Living Fortress |
| | Ravager (melee amber) | Tusk Jaw → Splinter Shot → Rampage → Gore Feast (a second mouth) → Earthbreaker |
| | Plague-Hulk (viral violet) | Absorbent Hide → Bile Sacks → Brood Hump (2 virus slots) → Swarm Vent → Pestilent Titan |

Every node has a `visual` brief in the data. Growth order follows Art Bible rule 3: early nodes add glowing nodes and pores, middle nodes add growths (fungus, crystal, glands, plates), the fifth node adds a new limb, mouth, carapace or fused weapon. A host with nine nodes bought looks unmistakably different from a fresh one.

## Levels and evolutions (`data/progression.json`)
- XP per class from kills, harvests, extracts (+200, plus 0.25 per DNA of haul), nests and rival hosts; a death still gives 40. Twenty levels.
- **Evolution** is a new body form, unlocked at the reference-02 levels. Host ships the first evolution of each class; the others are Apex.
- Evolving happens in the Hive Evolution Lab: the host floats in a tube, dissolves into glowing tissue and regrows in the new form (the dissolve-grow shader at full scale). The player chooses whether to evolve; it can be reverted to the base form for free.

| Class | Host evolution (level) | The new body |
| --- | --- | --- |
| Venom-Wraith | **Acid Parasite** (2) | The abdomen stretches into a translucent acid bladder you can see sloshing; the wings shrink to stubs edged with acid-burned lace; the blades corrode into pitted, smoking hooks. Venom Lancet needles become acid. |
| Neuro-Infiltrator | **Neuro-Hound** (3) | Drops to a four-legged lope. The cranium stretches into a long eyeless snout ringed with antennae that sweep like a radar dish, a ridge of glowing nerve nodes runs down the spine, and the Burster is grafted along a forelimb. Pulse-marked enemies take +15% damage. |
| Gore-Behemoth | **Crustacean Grunt** (1) | The raw red muscle is sealed under segmented crab plate that clicks as it moves; one forearm swells into a crushing claw that holds the Marrow Cannon; bone barnacles crust the shoulders; eye stalks rise from the bone crown. |

Apex evolutions (briefs in the data): Shadow-Stalker, Xenoflyer, Spore-Caster, Psych-Warlock, Gore-Gorgon, Juggernaut-Titan.

## Viral Lab (`data/viral-lab.json`)
Integrate an extracted virus permanently into a class's genome: 3 genome slots, the strain item is consumed, DNA and mutagens are paid. Integrated strains work at half their injected strength but never wear off, and they change the host's **resting look** (the same art brief as the injected mutation, permanent and subtler).
Each strain adds 1 Viral Load. Above the class's stable load (Wraith 2, Infiltrator 3, Behemoth 2) the host rolls one **instability** each raid: Tremor (hands shake in first person), Fever Glow (always faintly glowing), Tumour Growth (a pulsing shoulder growth, −8% speed), Neural Static (HUD flicker, slower Overload decay). Greed has a body cost. Purge a strain for 150 DNA (the strain is lost).
The Viral Lab screen is reference 03: host on a lit pedestal with callouts, branching pathogen tree, loadout and infections panel.

## Flesh Market (`data/market.json`)
**The Gullet Broker:** a vast, sessile organism grown into the Hive wall, a translucent gullet three storeys tall with a choir of small hands reaching out to pass you goods, an iris of cybernetic lenses where a face should be, and a payment slit that swallows DNA. It speaks through a dozen throats, slightly out of sync.
- Buys anything at 60% of value. Sells six items from its catalogue, rotating every 24 h (seeded by date, so everyone sees the same stock).
- **Mood** −3 to +3, starting at 0: each organ sold raises it a quarter step, each piece of tech sold drops it half a step. Each step moves prices 6% (`marketPrice`).
- Contraband only it sells: **Neuro-Spike Grenade** (70 damage + 40 Overload in 6 m), **Maw-Seed Mine** (110 damage, roots for 2 s), **Heart Husk** (on death, revive once at 50% after 3 s: the husk bursts out of your back).

## Rival hosts (`data/rivals.json`)
Single-player PvPvE before Hive multiplayer. 2 to 4 rival bots per raid, dropped in over the first 90 s. They follow the player's rules exactly (same kits, damage, Overload, extraction).
- Personalities: **Looter** (avoids fights, extracts at 55% full), **Hunter** (seeks fights, including you), **Rat** (waits near extracts to ambush).
- Human-ish skill: 0.35 to 0.6 s reactions, real aim error, strafing.
- 30% of rivals arrive evolved (they show off the body forms the player is working toward).
- Killing one drops its full cavity loot and steals half its carried kill DNA. The scanner shows rival hosts only after a Psych-Wave Pulse or when they fire.

## The 1 km map (`RAID.host`)
Playable radius 500 m, 25-minute raid.
| Biome | Where | Threat | Look and purpose |
| --- | --- | --- | --- |
| Glowmire Flats | centre | 1 | Liquid-light marsh, giant fungi; the safe middle |
| Chitin Spires | NE | 2 | Forest of hollow chitin towers that whistle in the wind; Glasswalker country |
| Wreck of the Long Seed | S | 3 | Crashed bio-tech seedship split open; tech loot; Mournbacks graze in its ribs |
| Choir Chasm | W | 3 | Floating island chain over the void, Bile Cantor colonies, liquid-light falls, the Lumen Grazers' sky |
| Brood Hollow | NW rim | 4 | Fleshy crater field with two Brood Hearts; the best loot |
- Six spawn points on the rim, at least 250 m apart.
- **Shifting extracts:** two of five Seed Spires open at the start; every 5 minutes one closes and another opens (60 s warning on the scanner); never more than three open. A **paid extract** near the centre costs 150 DNA and channels in 5 s.
- **Anomalies:** Psych-Wave Storm (scanner dead, Overload creeps up, the sky tears into magenta bands), Gravity Bloom (a turning violet lens where gravity drops to 35%), Red Tide (every Abomination glows red, moves 20% faster and drops 50% more DNA).

## Three new Abominations (`data/abominations.json`)
Each mixes at least two unrelated biology sources, and none resembles a creature from an existing franchise.

**Tithe Weaver: trap-layer.** A floating nervous system with no skin: a knot of glowing ganglia trailing kelp-like nerve fronds, drifting at head height. It strings living nerve strands (up to 6, 14 m each) between rocks and fungi. Touching a strand roots you for 1.8 s and screams an alert to everything within 40 m. Shoot the strands (15 each) or the ganglion knot (×2.5). Sources: orb-weaver spider, jellyfish nerve net, kelp.

**Husk Mimic: the liar.** A parasite that wears the shed husk of a dead host. From further than 8 m it walks, idles and even "loots" like a rival player, wearing a random class's silhouette. Closer, the husk splits down the middle and opens into a mouth lined with long fingers. Lunges for 38. It makes the player doubt every distant figure. Sources: decorator crab, cordyceps fungus, anglerfish lure.

**Lumen Grazer: the gentle giant.** A sky-whale the size of a building drifting 25 to 60 m above Choir Chasm, its body a translucent bell full of floating lantern glands, with long trailing feeding curtains that brush the treetops. It is harmless until hurt; then it panics into three crushing dives (90 damage) before calming. Six lantern glands (×2) are weak points; harvesting one (5 s, very loud) is the richest organ in the game. Killing it is a raid-defining choice. Sources: whale shark, siphonophore, comb jelly.

## Department asks
| Department | Host deliverables |
| --- | --- |
| Gameplay Engineering | Class switching and the three kits (weapons, melee, the six abilities, passives); Synapse effects applied from data; XP and levels; evolution stat swap; Viral Lab integration and instabilities; Flesh Market transactions and mood; shifting and paid extracts; anomalies. |
| Creature & Mutation | Three host body plans and three first evolutions; every Synapse node as a visible part change (45 nodes, from the `visual` briefs); permanent virus looks; Tithe Weaver, Husk Mimic (with class-husk disguise), Lumen Grazer; evolution dissolve-grow scene. |
| PvE AI & Encounters | Rival host bots with the three personalities; Tithe Weaver web placement; Husk Mimic disguise behaviour; Lumen Grazer temperament; biome-based spawn tables. |
| World & Level | The 1 km map with five biomes, six spawns, the extract pool, crawl tunnels (Wraith-only paths), barriers the Behemoth can crash through. |
| UI & HUD | Synapse tree (ref 01), Evolution and Viral Lab (ref 03), Flesh Market, class select with progression tracks (ref 02), raid select with anomaly forecast, extract-shift warnings. |
| Rendering & Tech Art | Evolution dissolve-grow at full scale; Light-Eater and camouflage materials; anomaly skies; Lumen Grazer translucency. |
| Audio | Class footsteps and voices; the Gullet Broker's out-of-sync choir; anomaly ambience; the Grazer's song. |
| Build, QA & Release | Scripted tests: buy a node and see the model change, evolve, integrate a virus, trade, fight a rival bot. |
| Game Design | Tune Synapse costs, XP curve and market economy from bot runs and Brandon's play; Hive (multiplayer) rules before Hive starts. |

## Out of scope for Host
Online multiplayer and squads (Hive), Apex evolutions, raid boss, more maps.
