# Larva milestone: feature list and acceptance criteria

**Goal:** the full extraction loop. You boot into the Hive, pick your host, choose a raid, deploy with gear from your stash, harvest creatures, inject a virus that visibly mutates you mid-raid, and either extract with your haul into the stash or die and lose what you carried. Raid N's loot is usable in raid N+1.

**Exit criteria (whole milestone):**
- [ ] Loot extracted in one raid appears in the stash after a page reload and can be loaded into the next raid.
- [ ] Death loses everything carried in the cavities, keeps the gut pouch and the innate Synapse Burster.
- [ ] Injecting each of the three viruses mid-raid visibly changes the host's first-person arms within 2.5 s.
- [ ] Five Abomination types and a Brood Heart nest appear in a Larva raid.
- [ ] Scripted raid test covers: deploy with stash items, harvest a corpse, inject a virus, extract, reload page, items in stash; and a death run that empties the cavities.
- [ ] All new numbers read from `data/` through `data/index.ts`: `VIRUSES`, `VIRUS_RULES`, `NESTS`, `PROFILE`, `RAID.larva`, the new Abominations and items.

## Player flow
**Hive main menu → Host select → Stash & loadout → Raid select → Deploy → Raid → Results → back to Stash.**
- **Main menu:** the Hive register (Art Bible). Deploy, Stash, Settings, Quit. A slowly rotating host on its pedestal behind the menu.
- **Host select:** three class cards in the layout of reference 02. Only the Neuro-Infiltrator is unlocked in Larva; Wraith and Behemoth show their cards with "EVOLVES IN HOST" locks.
- **Stash & loadout:** stash grid on the left, the host's translucent torso with its internal-cavity grid on the right, gut pouch below. Drag items in and out. DNA balance top right. Buttons: expand stash (+1 row, cost `stashRowCost`), upgrade gut pouch.
- **Raid select:** one zone (Zone 7, the island) shown as a living orbital map with threat level, the active modifiers (nest present, second extract opens at 4:00), and a squad slot row (greyed until Hive).
- **Results:** EXTRACTED lists each item moving to the stash and DNA banked; HOST LOST lists what was lost. Both return to the stash screen.

## Persistence (`data/profile.json`)
- Stored in `localStorage` under `PROFILE.storageKey` as JSON: `{ schemaVersion, dna, stash: [{item, count, x, y, rotated}], stashRows, gutPouchLevel, cavity: [...], gutPouch: [...], stats: {raids, extracts, deaths, kills} }`.
- New profile: 100 DNA, 3 Clot Gel, 2 DNA Strand Bundles.
- Unknown schema version: keep a backup copy under `<key>.bak`, start a new profile, show a one-line notice. Never silently wipe.
- DNA Strand Bundles are a currency item: on extraction they convert to banked DNA automatically (value per bundle from `loot.json`) and do not take stash space.
- **Free kit:** if the stash holds fewer than `freeKit.clotGelFloor` Clot Gel at deploy, the host grows one for free, so a broke player can always deploy.

## Internal cavities (inventory)
- Grid by class (`classes.json` `cavityGrid`, Infiltrator 5×4). Items occupy `size` cells, can rotate, stack up to `stack`.
- Opened in raid with Tab: the view tilts down into the host's own torso (organs part around the grid). The game keeps running; you are vulnerable.
- Gut pouch (2×1 base): a secure slot that survives death. Any item kind.
- Picking up when full: prompt to swap; never auto-drop.

## Corpse harvesting
- Hold E on a dead Abomination to cut out its organ (`harvest.time`, makes `harvest.noise`). A wet, glowing cut animation; the organ appears in your hand, then in the cavities.
- One harvest per corpse. Corpses stay 40 s. Organs are the main item source: values in `loot.json` (Needlemaw gland 20 to Mournback marrow 140).

## Viruses (`data/viruses.json`)
- Use from a cavity (select and press the inject key, or drag it onto the host in the inventory). Injection takes 3 s, slows you to 30%, and makes a little noise. Only one active virus; a second replaces the first.
- The effect lasts the rest of the raid. The **mutation is visible**: the first-person arms dissolve-grow into the new look over 2.5 s (each virus has an art brief in its `mutation` field), and the eyeball portrait on the HUD changes tint.
| Virus | Gain | Cost |
| --- | --- | --- |
| Plague-Stalker Strain | Spores infect: 4/s for 4 s, stacks to 3, spreads to neighbours on death | Your footprints glow; you are 50% easier to spot |
| Adrenaline Virus | Overload decays twice as fast, sprint ×1.1 | Max Biomass ×0.85 |
| Spliced Parasites | Every kill releases a parasite that seeks and bites (40) the nearest enemy | −1 Biomass/s while a parasite is alive |
Integrating a virus permanently is the Viral Lab, which comes in Host.

## New Abominations (`data/abominations.json`)
Each mixes at least two unrelated biology sources (Art Bible rule 4).

**Glasswalker: camouflaged stalker.** A tall, thin, four-legged ambusher whose skin is a living refraction layer (cuttlefish chromatophores over a glass-sponge lattice) so it is nearly invisible when still (8% visible) and shimmers when moving (35%). A single fist-sized **refraction lens** in its chest is the only thing that does not bend light: it is the tell and the weak point (×2.5). Stalks to 25 m, then charges at 11 m/s and strikes with folding mantis-like forelimbs for 30 after a 0.5 s wind-up (the lens flares). Hits reveal it for 3 s. Psych-Wave Pulse reveals it fully. Sources: cuttlefish, glass sponge, mantis.

**Oculimoth: flying swarm scout.** The winged eyeballs of reference 04, made our own: a palm-sized eyeball with an iris that opens like a camera aperture, carried by two pairs of translucent moth wings with veins that glow. Packs of 4 to 8 orbit at 2 to 10 m, peck for 6, and every 8 s a spotted one **screeches**, alerting everything within 35 m. Fragile (18), but their job is to bring friends. Sources: moth, cephalopod eye, swiftlet (nest-building saliva cords hang from them).

**Mournback: armoured tank.** A slow quadruped the size of a van carrying a hump of fused bone plates and the skulls of things it has eaten, like a hermit crab's shell that grew into its spine. From the front its bone shield takes only 15% damage. On its back, a cluster of **dorsal vents** glow and exhale violet spores (×3 weak point): flank it. Attacks: a horn charge (9 m/s, 45 damage) and a ground slam (5 m, 30, knockback). 700 Biomass, 60 DNA. Sources: hermit crab, tardigrade, bison.

## Brood Heart nest (`data/nests.json`)
A pulsing heart-sized organ the size of a car, half-buried in a fungal crater, wired into the ground by roots. When a host comes within 45 m it wakes and pulses out a wave every 25 s (six scripted waves, ending in a Mournback), up to 12 of its spawn alive. Four glowing ventricle weak points (×2, 120 each). Kill it: waves stop, a shockwave spikes nearby Overload by 40, and a **Brood Cache** opens with a guaranteed Brood Heart Seed (260 DNA) and three rich rolls. It is the high-risk, high-reward set piece of the island.

## Larva raid changes (`RAID.larva`)
- Three Bio-Pods (one guarded), one Brood Heart at bearing 300°, two Glasswalkers, an Oculimoth swarm and a Mournback added to the Spore spawns.
- A second Seed Spire opens at 4:00 elapsed (bearing 110°), so routes and timing vary.
- Corpse harvesting on.

## Department asks
| Department | Larva deliverables |
| --- | --- |
| Gameplay Engineering | Profile save/load, stash and cavity grid model (place, rotate, stack, swap), deploy/extract/death transfers, harvesting, virus injection and effects, second extract, nest logic. Vitest for every transfer rule above. |
| Creature & Mutation (wave 2) | Procedural generator producing all five Abominations from part graphs; dissolve-grow mutation for the three virus looks on the host arms; harvest cut and organ meshes; Brood Heart. |
| PvE AI & Encounters (wave 2) | Glasswalker stalking and camouflage, Oculimoth swarm and screech alerts, Mournback facing and charge, nest wave director. |
| UI & HUD (wave 2) | Main menu, host select (ref 02), stash and cavity screens, raid select, results; inventory overlay in raid; virus status on HUD. |
| World & Level (wave 2) | Brood Heart crater at bearing 300°, two extra Bio-Pod sites, second Spire site at bearing 110°. |
| Rendering & Tech Art | Camouflage refraction shader, glowing footprints, virus mutation materials. |
| Build, QA & Release | Scripted Larva raid test (exit criteria), persistence across reload test, publish. |
| Game Design | Tune from playtest bot runs and Brandon's feedback; Host spec before Host starts. |

## Out of scope for Larva
Wraith and Behemoth playable, Genetic Synapse tree, Viral Lab integration, Flesh Market, rival host bots, multiplayer.
