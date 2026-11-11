# 10: Three new zones — the Ochre Reach, the Marrow Pit, the Weeping Fen

Written 2026-11-11 from three images Brandon sent: a desert savannah, a descending pit and a drowned swamp. He wants all of them now. The numbers are in:
- `data/zones.json`
- `data/habitats.json` (creature homes and container placement)
- `data/abominations.json` (nine new creatures)
- `data/bosses.json` (three new bosses)
- `data/loot.json`, `data/contracts.json` and `data/progression.json`

If this doc and the JSON disagree, the JSON wins.

**The images are inspiration, not a template.** Each creature below has a twist so it reads as ours, not as the thing in the picture.

Every zone follows the habitat rule from [09](09-weapons-and-habitats.md): each species lives somewhere specific, and containers sit where there is a reason for them.

| Zone | Size | Raid | Threat | Access | Boss |
| --- | --- | --- | --- | --- | --- |
| The Ochre Reach | 800 m across | 25 min | 2–4 | host level 3 or *Dust and Domes* (Archivist) | the Sandwidow |
| The Weeping Fen | 760 m across | 25 min | 2–4 | host level 4 or *Lights in the Fen* (Mother Clot) | the Mire Regent |
| The Marrow Pit | 260 m wide × 240 m deep | 30 min | 2–5 (by depth) | host level 5 or *The Long Drop* (Gullet Broker) | the Nethermaw |

## The Ochre Reach (desert savannah)
A sun-baked savannah under three suns and a ringed planet: red dust, lone umbrella trees with blue-veined bark, a dead settler colony of clay domes and drill rigs, and things under the sand. It's about open, long-range fights, herds you can stampede, and a village you clear room by room.

**Places (landmark ids):**
- `domeVillage`: the Settler Domes, enterable, with lockers inside. Shroudlings nest here.
- `rigYard`: rusted derricks and lookout towers. Sniper roosts.
- `acaciaFlats`: open grass and lone trees. The Bristleback herds.
- `duneSea`: shifting dunes. Dunewake country.
- `cactusGulch`: a canyon run with cover.
- `skyfallCrater`: where ring debris fell. The Sandwidow's arena.

**Mechanics:**
- **Noon heat** fills Overload at 0.5/s outside shade.
- **Sandstorms** come every 5–7 minutes and last 45 s. Sight drops to 35% and the Dunewake hunt harder.

**Threat by area:** village 2, flats 2, rig yard 3, dunes 3, gulch 3, crater 4.

### Creatures
| Creature | Role | Home | The twist |
| --- | --- | --- | --- |
| **Dunewake** | burrowing ambush pack (3–5) | Dune Sea, crater rim, gulch | Eel-bodied sand swimmers. The only tell is a line of ripples racing at you. They feel footsteps: sprinting doubles how far they sense you, crouching cuts it to 30%. |
| **Bristleback** | armoured herd grazer (3–6) | Acacia Flats, rig-yard water tanks | Hollow quills that whistle, and a back that is a living water cistern you can see slosh. Gunfire within 25 m starts a stampede, and adults fire quill volleys. Young cling under the belly. |
| **Shroudling** | scavenger and sniper (1–2) | dome village, rig towers | It wears the dried, shed skin of a dead host like a hermit crab wears a shell, so from 35 m it reads as another player. It loots corpses and open containers, then runs for the huts. Kill it to get the stolen items back. |

Needlemaw packs work the gulch, and Bile Cantors hover over the rig yard's leaking tanks.

**Loot:**
- 6 Settler Lockers in the domes and 2 in the rig towers. These hold guns, mods, ammo and Settler Ledgers.
- 4 cargo crates.
- 4 Bio-Pods in the flats and dunes.

### The Sandwidow (4200 Biomass)
The mother of every Dunewake: a 25 m segmented sand-swimmer with a body like a dune given muscle. When she surfaces, a crown of fused jaw-plates splits into six petals around a pale, egg-sac-ringed throat.

| Phase | What she does | How to fight her |
| --- | --- | --- |
| **Circle** 100–65% | Moves under the sand and makes undertow funnels (30). Calls 4 Dunewake. Surfaces to breathe every 18 s. | Stay on the debris pillars and shoot the throat sacs when she breaches. |
| **Erupt** 65–30% | Bursts out under you (55) and blasts sand (20, blinds for 2 s). Calls 5 Dunewake. | Her jaw petals can be severed; each one cuts her bite. |
| **Drown** 30–0% | 60% of the crater floor turns to quicksand. She thrashes (45). | Fight from the pillars and the rim. |

Enrage at 8:00: the whole floor turns to quicksand.

**Rewards:** 550 DNA, the Widow's Clutch, a harvestable Sandwidow Egg (a catalyst) and 1200 XP.

## The Weeping Fen (drowned swamp)
A drowned swamp under giant mushroom-trees: black water, glowing moss, mist, long-necked giants wading through it, and something in the deep pool. It's slow, tense wading with ambushes from the water, and a rich passive giant to hunt if you dare.

**Places:**
- `rootHut`: a dwelling grown into a giant root.
- `mushroomCathedral`: the tallest cap-trees, climbable.
- `stiltVillage`: drowned stilt houses.
- `mistwaderShallows`: open shallows where the giants graze.
- `spiderHollow`: the Mirebrood nest around an old fire.
- `drownedPod`: a sunken seedship pod with Seed-Key lockers.
- `regentPool`: a deep black pool. The boss arena.

**Mechanics:**
- **Water:** knee-deep water slows you to 85% and waist-deep to 60%. Wading is 1.5× louder.
- **Mist** cuts sight to 55%.

**Threat by area:** hut 2, village 2, shallows 2, cathedral 3, hollow 3, pod 3, pool 4.

### Creatures
| Creature | Role | Home | Notes |
| --- | --- | --- | --- |
| **Fenstalker** | six-legged water ambusher (1–2) | shallows, stilt village, the pool | Striped like reeds over water, with a split tail. It lies under the surface with only its eye stalks up, nearly invisible, and erupts within 10 m. |
| **Mirebrood** | spider swarm (6–12) | Spider Hollow, Root Hut | Hand-sized, with lantern backs. Each bite slows you, stacking up to 3 times. |
| **Mistwader** | huge passive wader (1–3), 3000 Biomass | the shallows | Four storeys tall and eyeless, combing the water. It's harmless until hurt, then it stomps. Hunting one is slow, loud and rich: its heart is worth 520 DNA. |

Tithe Weavers web the cathedral caps, and Glasswalkers haunt the drowned pod.

**Loot:**
- 10 Root Hollows: in the hut, the stilt houses, on the caps and in the brood nest.
- 2 Drowned Pod Lockers (need a Seed Key).
- 3 Bio-Pods on the shallows' islands.

### The Mire Regent (4600 Biomass)
A barge-sized amphibian under the black pool: a frog's mouth as wide as a door, a pale belly hung with grown pearls, two arms like drowned branches, and eyes only on top of its head.

| Phase | What it does | How to fight it |
| --- | --- | --- |
| **Lurk** 100–60% | An arm rises and drags a host under (25 + 10/s, pinned 2.5 s; free them with 100 damage). It sends out ripples (15) and calls 8 Mirebrood. | Stay on the root islands. Shoot the arm to free a teammate. |
| **Rise** 60–30% | Rears out of the pool with its pearls exposed. Belly slam (50), a pulling tongue (40), moss clouds. | Burst the pearls. |
| **Drown** 30–0% | The pool floods and the islands shrink. Thrash (45). | Take the high ground. |

Enrage at 8:00: the islands go under and the water drains 4 Biomass/s.

**Rewards:** 600 DNA, the Regent's Hoard, a harvestable Regent's Pearl (a catalyst) and 1300 XP.

## The Marrow Pit (the descent)
A vertical shaft strung with rickety walkways, cables and hanging huts. **The deeper you go, the stronger, stranger and richer it gets, and the further it is back up.** The only always-open extract is the rim lift. The updraft at the bottom opens only once the Nethermaw is dead.

**Layers** (`zones.json` `layers`; `depthLayer(zone, depth)` in data/index.ts):

| Layer | Depth | Creature HP | Damage | Loot tier | Containers | Light |
| --- | --- | --- | --- | --- | --- | --- |
| Rim (`rimCamp`) | 0–40 m | ×1.0 | ×1.0 | 1 | 4 pit crates | daylight from above |
| Cables (`cableBridge`) | 40–100 m | ×1.2 | ×1.1 | 2 | 4 pit crates | grey mist, lamps |
| Warrens (`hangingWarren`, `boneGallery`) | 100–170 m | ×1.45 | ×1.25 | 3 | 4 pit crates, 2 deep caches | lamps only |
| Deep (`undermouth`) | 170–240 m | ×1.75 | ×1.4 | 4 | 2 deep caches | the green glow |

**Mechanics:**
- A fall of more than 18 m kills, and walkways can be cut.
- Ladders climb at 2.5 m/s, and the rim lift takes 20 s to come.
- **Dread:** below 170 m, Overload creeps up at 0.4/s.

### Creatures
| Creature | Role | Home | Notes |
| --- | --- | --- | --- |
| **Cablecrawler** | wall-running walkway cutter (2–4) | cables, warrens | A flat spider with shear mandibles. It cuts a walkway in 2.5 s unless it takes 30 damage. |
| **Veilwing** | silent flying grabber (1–3) | the middle of the shaft | A torn-sail membrane with a tentacle skirt. It grabs a host, climbs and lets go over the drop. 60 damage frees you. |
| **The Hollowed** | infested hosts (1–3) | warrens, bone gallery, the floor | Earlier hosts worked like gloves by a rooted thing inside. They still fire their guns: Quillet, Hive Spitter, Cicadine, Gullet Scatter or Vertebra Rifle, at 45% accuracy. Kill one to take its gear. Spores burst out when it dies. |

Glasswalkers ambush on the rim scaffold, and Oculimoth swarm the warren lamps.

### The Nethermaw (6000 Biomass, stationary)
A brain-coral mass the size of a house grown into the pit floor. Its folds pulse a sick green that lights the shaft from below. In the middle is a lipless, cilia-rimmed mouth that breathes the updraft. It doesn't move; the pit moves for it.

| Phase | What it does | How to fight it |
| --- | --- | --- |
| **Breathe** 100–60% | Pulls hosts toward the mouth. A lobe swells and glows before each spore pulse (20 + 15 Overload). Raises 2 Hollowed every 30 s. | Shoot each lobe as it swells. Break the 4 root columns: each one cuts its pulses by 20%. |
| **Dream** 60–25% | False extract lights that are pulse traps, whispered Overload, and roots bursting from the walls at walkway height (35). | Trust the map, not the glow. |
| **Swallow** 25–0% | Strong inhale (40/s inside the mouth). The lowest walkway ring tears loose every 10 s. | Get high and pour fire into the open throat. Its body takes ×1.5. |

Enrage at 9:00: a permanent full inhale.

**Rewards:** 800 DNA, the Undermouth container (a Nethermaw Lobe, an Undermouth Spore and 5 rich rolls) and 1800 XP. The updraft extract opens.

## New contracts
| Contract | Vendor | Unlocks / pays |
| --- | --- | --- |
| *Dust and Domes* (after *Signal in the Wreck*) | Archivist | unlocks the Ochre Reach; bring back 2 Settler Ledgers |
| *Lights in the Fen* (after *Heart of the Brood*) | Mother Clot | unlocks the Weeping Fen; harvest 10 Mire Lanterns |
| *The Long Drop* (after *Husks and Liars*) | Gullet Broker | unlocks the Marrow Pit |
| *The Widow's Clutch* | Mother Clot | kill the Sandwidow, bring an egg |
| *What the Deep Keeps* | Archivist | kill the Nethermaw, bring a lobe |
| *Pearl of the Regent* | Gullet Broker | kill the Mire Regent, bring a pearl |

## Why these bosses matter
Their harvests are the catalysts for the **Apex evolutions** (see [apex-milestone](apex-milestone.md)). Killing them is how a host becomes something new.

## Department asks
| Department | Build |
| --- | --- |
| Desert / Swamp / Pit zone threads | The map: every landmark id above as a named area (`landmarkAt`), the structures, the extracts, the containers as in `HABITATS.loot`, the boss arena to the `arena` block. The pit also needs its depth layers, cuttable walkways, ladders and the lift. |
| Creature & Mutation | Nine bodies from the `brief` lines in abominations.json, keeping the twists, plus the Sandwidow, the Nethermaw and the Mire Regent. |
| PvE AI & Encounters | The new behaviours: burrowing with a ripple tell, herd stampede and quill volley, scavenging and fleeing with loot, wall-climbing and walkway cutting, grab-and-drop, armed Hollowed, submerged ambush, a slowing swarm, a passive giant. Also the three boss brains (`archetypeHint` gives the closest existing archetype). |
| Gameplay Engineering | Zone mechanics (heat, sandstorm, water speed and noise, fall death, dread), depth scaling with `depthLayer`, the new containers, the boss rewards and contracts. |
| Sound | Every creature has a sound tell in its brief: the Dunewake hiss, the Bristleback whistling chord, the Nethermaw's breath, the Mistwader hum. Bosses have `songRadius` and `songLoops`. |
| UI & HUD | Zone cards for the three zones, the pit's depth readout, and the boss bars. |
