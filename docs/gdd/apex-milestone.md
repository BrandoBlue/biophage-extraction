# Apex milestone: advanced evolutions, the last zones and the raid boss

Pulled forward on 2026-11-11 so no department is waiting on a spec. The numbers are in:
- `data/progression.json` (evolutions)
- `data/zones.json` (`hollowChoir`, `ossuaryReef`)
- `data/bosses.json` (`hymnal`, `boneTide`)
- `data/habitats.json`

## Advanced evolutions
Each class gets two more body forms after its Host evolution. Every one of them costs DNA plus a **catalyst from a new boss**, so the bosses of the new zones are the road to Apex.

| Class | Evolution (level) | What it gives | Catalysts |
| --- | --- | --- | --- |
| Venom-Wraith | **Shadow-Stalker** (5) | near-invisible when still, half the footstep noise, +0.4 m/s | 2 Shroud Skin, 1 Vigil Lure, 2 Mimic Lures |
| Venom-Wraith | **Xenoflyer** (12) | true flight: 9 m/s, up to 40 m, costs 6 Overload/s | 3 Veil Membrane, 1 Nethermaw Lobe |
| Neuro-Infiltrator | **Spore-Caster** (6) | spore mortar (45, 4 m burst, every 8 s) | 1 Regent's Pearl, 10 Mire Lanterns, 2 Embryo Pods |
| Neuro-Infiltrator | **Psych-Warlock** (15) | levitates, Neural Pulse radius ×1.5, mind lash (20/s at 25 m) | 1 Hymnal Tongue, 1 Nethermaw Lobe |
| Gore-Behemoth | **Gore-Gorgon** (8) | a crown of three serpent heads that bite (25 each), 5% lifesteal | 1 Sandwidow Egg, 2 Bristleback Cisterns |
| Gore-Behemoth | **Juggernaut-Titan** (20) | +160 Biomass, half impact damage, immune to knockback, a burning furnace aura | 1 Bone Tide Heart, 1 Warden Seed-Core |

Each evolution has a full body brief in its `body` field for Creature & Mutation. Like the Host evolutions, you choose whether to evolve and can revert for free.

## The Hollow Choir (Apex stealth zone)
A vertical cave-cathedral under Zone 7, 200 m deep in five chambers. **Sound is light here.** Any noise lights the walls around you for 2 s, and creatures see the light.
- **Places:** `choirMouth`, `echoGallery`, `mineralCurtains`, `silentStair`, `choirFloor`.
- **Creatures:**
  - Glasswalkers invisible against the curtains
  - Oculimoth swarms that hunt by noise-light
  - Veilwings down the stair
  - the Hollowed on the floor
- **The Hymnal** (7000 Biomass, stationary): a cathedral-sized throat lined with thousands of vocal cords and conducted by four hanging larynx "cantors". It fights in three phases:
  - **Listen:** it lances the loudest host.
  - **Chorus:** room-wide resonance and falling stalactites.
  - **Silence:** total dark, where only gunfire lights the room.
  - Its drop is the Hymnal Tongue, the Psych-Warlock catalyst.

## The Ossuary Reef (Apex squad zone)
A dried sea floor of bone coral in low gravity (×0.45, jumps ×1.8, falls do 30% damage), 1.2 km across. Squads only.
- **Places:** `ribArch`, `coralForest`, `dryTrench`, `voidEdge`, `tidePath`.
- **Creatures:** Bristleback herds, Veilwings, Mournbacks, Lumen Grazers and Needlemaw packs.
- **The Bone Tide** is the raid boss (40,000 Biomass). It's a reef organism 300 m long that rises at minute 8 and migrates across the reef. Squads climb onto it, break its coral plates, crack its four hearts and jump off before it dives into the void.
  - **Phases:**
    - **Migrate:** shrug-off and reef spawns.
    - **Breach:** it rolls, and anyone on top must hold on, while bone rain falls.
    - **Sink:** the last minute.
  - **Rewards:** 3000 DNA and the Bone Tide Heart, the Juggernaut-Titan catalyst.

## The economy, tuned
Targets to tune toward with the playtest bot. Each one becomes a test in `tests/data.test.ts` as it is tuned:
- A fresh host, with only free kit and no catalysts, can afford its first Host evolution after about 8 to 12 good raids.
- An Apex evolution costs about 3 to 5 boss kills' worth of catalysts plus DNA.
- Average haul per minute rises with zone threat: Glowmire < Wreck = Ochre = Fen < Expanse < Pit (deep) < Apex zones.
- A death should cost about 1 to 2 raids of income, never a whole session.

## Desktop build
Apex also ships a desktop wrapper around the same web build: a native window, fullscreen and controller support. The native-engine (Unreal) track stays parked until Brandon brings it back.

## Department asks
| Department | Build |
| --- | --- |
| Creature & Mutation | The six Apex evolution bodies from their `body` briefs, and the Hymnal and Bone Tide bodies. |
| Gameplay Engineering | Each evolution's `grants`: flight, levitation, mind lash, spore mortar, serpent bites, the furnace aura. Sound-as-light in the Choir. Low gravity on the Reef. |
| PvE AI | The Hymnal and the Bone Tide brains. Oculimoth that hunt by noise-light. |
| World / zone threads | The Hollow Choir and the Ossuary Reef maps, built to the landmark ids. |
| Sound | The Choir: every sound is a light, so audio and light are one system there. |
