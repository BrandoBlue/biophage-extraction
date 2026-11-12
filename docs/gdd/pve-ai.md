# PvE AI & Encounters: how Abominations hunt

Owner: PvE AI & Encounters. Code: `src/ai/`. Tuning: `data/ai.json` (attack numbers stay in `data/abominations.json`, nest waves in `data/nests.json`). Tests: `tests/ai.test.ts`.

**Goal:** every Abomination is scary and readable. You should be able to tell what each creature is about to do from its body (the `windup` drive swells weak points, `look` snaps the head, `strike` aims the limbs) and have a counter for every attack.

## Shared brain
- **Modes:** calm (wander near home) → investigate (walk to a sound or glimpse, sweep the area) → hunt (archetype behaviour) → back to investigate when the host has been out of contact for the kind's `loseInterest`, then calm. Damage, a packmate's alert, a screech or a nest pulse jump straight to hunt. A dead or spawn-protected host calms everything.
- **Awareness** is a 0..1 meter. At `suspicious` (0.35) the creature emits `notice` (head snap, chirp) and investigates; at 1 it emits `alert` and hunts.
- **Sight** fills awareness by distance, field of view (outer half of the view cone at 45%) and the host's **visibility**. Within 4 m it always feels you.
- **Noise** (gunfire, footsteps, harvesting, injecting, the Spire signal) adds an impulse per sense tick scaled by how deep inside the noise radius the creature stands. One shot at 20 m makes a Needlemaw suspicious; two or three bring it running.
- **Light / visibility** (`hostVisibility`): crouched 0.6, still 0.8, walking 1, sprinting 1.2; a muzzle flash lights you to 2.2 for 0.6 s; Plague-Stalker glowing footprints ×1.5 while moving. Visibility scales sight range and fill speed.
- **Attack tokens:** at most 2 creatures commit to melee and 2 to ranged attacks on the host at once. The rest circle and feint. Holders refresh their token while committed; a stuck holder loses it after 3 s.
- **Tracking:** a hunter follows your real position for 1.5 s after losing sight, then runs to the last known point and sweeps.

## Homes (data/habitats.json, docs/gdd/09)
Gameplay places each creature at its home and calls `Abomination.setHome(x, z, { roam, hatchOnApproach, disguise, height })` with the group's data. Then:
- **Leash:** a calm creature wanders within `roam` of home. After a chase goes cold it walks back, so packs stay where players learned they live.
- **Tanks (`hatchOnApproach`):** no senses and no movement until the host is that close or it is shot. Then it emits `reveal { how: 'hatch' }` and hunts at once. Packmate alerts don't open the tank.
- **Disguise (`disguise`):** same, but it triggers at striking range (`attackRange + 1.5 m`), so it drops the crate pose and strikes. `Abomination.lurking` tells the body to show the tank or the crate.
- **Roost (`height`):** a flyer's calm height.
- **Reinforcements:** Gameplay spawns them at their species' nearest out-of-sight home and calls `alert(host)`. They walk in hunting, never popping in behind the host.
- The raid turns `reveal` into a `creatureReveal` bus event, a 20 m noise and a burst.

## Menace (what makes hunters frightening; `ai.json` `menace`)
Brandon's bar is enemies that feel hard and unpredictable, as if they are thinking. Every archetype shares these behaviours:
- **The stare.** A creature that spots you itself stops dead, turns and looks at you for 0.35–0.8 s before it comes. Its alert cry goes out at the start of the stare, so the pack hears it. A packmate that was told, or a creature you shot, skips the stare.
- **A fanned-out search.** When the trail goes cold, a hunter runs to where you were heading (your last velocity × 1.5 s, at most 10 m), not to where you were. Each searcher checks its own spot within 7 m, so a pack spreads out to sweep the area. It sweeps for 2.5 s, then tries another spot.
- **The ambush.** Swarm and stalker hunters that lose you after a real chase may not go home at all (45%). They crouch, motionless and silent, where the trail died. They spring when you come within 5 m (`reveal { how: 'ambush' }`); the raid's reveal noise pulls the rest of the pack in. After 45 s an ambush goes cold and the hunter slinks home.
- **Dodging under fire.** When you aim at a Needlemaw or Oculimoth within 30 m (16° cone) and fire, it has a 55% chance to juke sideways, at most once every 1.4 s. It never jukes mid wind-up or lunge, so a committed attack can still be punished.
- **Wounds.** A hunter below 35% Biomass limps (75% speed). The first time one drops below 30%, it has an even chance to break off and run for 2.2 s. Then it cries out (an alert, which calls packmates within its alertShare radius) and comes back. The Mournback never runs.

The body can show an ambush through `Abomination.lurking` together with `brain.lurkHow === 'ambush'` (for example, crouched low). The stare is `brain.phase === 'spot'`, and the retreat is `phase === 'flee'`.

## Thinking (readable tactics; `ai.json` `tactics`)

Brandon's bar: creatures must feel smart and creepy, and the player must be able to read how they think, never just "pulling mobs". On top of every archetype's hunt, a hunter makes decisions the player can see. Each one sets `Brain.intent` (idle, wary, stare, stalk, hunt, attack, search, flee, reel, press, evade, lure, falter) and fires a `tactic` event that the raid puts on the bus as `creatureTactic`, for sound and the HUD. `tactics.uses` lists the archetypes that make each choice.

- **Lure** (swarm, stalker): a hunter that finds the host itself, with at least `lure.packMin` of its kind nearby, may not call them in. It stands in plain view for `lure.show` s, then backs toward its pack, still watching the host. Packmates that spot the host during the lure hold still and stare. When the host follows to within `lure.spring` m of the pack, or after `lure.time` s, it springs them: the whole pack comes at once (a screech).
- **Falter and rout** (swarm, spitter, stalker): when a packmate it was hunting beside dies (not one that just wandered off), a hunter that is not mid-attack stops, watches the host and edges back for `falter.time` s. Once `falter.rout` of the pack it started with is dead, it runs.
- **Evade** (swarm, spitter): when the host holds it in their sights (inside `aim.cone`; aiming down sights fills `aim.adsFactor` times faster) for `aim.hold` s, a hunter that is not mid-attack breaks sideways out of the line.
- **Press** (swarm, stalker, spitter, burrower): a reload is a window, and they know it. The first hunter within `reload.range` m to notice calls it (a screech). Cooldowns reset, and `reload.extraTokens` more hunters may commit while the reload lasts.

None of these interrupts a committed attack (a wind-up, lunge, burst or charge), so every attack stays punishable.

### Body language (src/ai/tells.ts to Creature's `drive.mind`)

`mindLevels` turns `Brain.intent` into eased body-language levels, and `mindPulse` turns events into pulses. The Abomination eases toward them every frame.

| Thinking | Body |
|---|---|
| wary, search | head cocked (`tilt`) |
| stare | head cocked and frozen (`tilt`, `still`) |
| a stalker caught in the host's gaze | dead still |
| about to commit (wind-up) | `brace` |
| falter | `recoil` and `grieve` |
| flee | `recoil`, glows dim |
| idle Oculimoth | eyes half shut, open when hunting |
| alert, alarm, screech, press, spring, rout | `call` pulse |
| lure, adapt, evade, charge | `glint` pulse |

### Learning within a raid (`ai.json` `learning`, src/ai/memory.ts)

**Switched off for now** (Brandon, 2026-11-12: "lets skip creatures that learn your tricks during a raid, for now"). `learning.enabled` is false, so raids get no memory and nothing below happens in play. The code and tests stay; set the flag to true to bring it back.

One `RaidMemory` per raid (keyed like the attack tokens) records the tricks the host uses on each kind. Once a trick has worked `learning.after` times, that kind counters it, and the switch shows as an `adapt` tactic. Nothing carries between raids.

| Trick | Noted when | Counter |
|---|---|---|
| Digging into a corner or ledge (`camp`) | the host stays within `campRadius` m for `campTime` s while hunted, once per kind per `campCooldown` s | Swarms stop entering and hold their ring at `campRing` x until the host moves (Needlemaw: "they stop entering it and wait outside") |
| Killing the lunger (`lungerKilled`) | a creature dies mid-attack | Swarms fake the coil (`fakeout`, `fakeoutTime` s) on all but every `feintEvery`-th approach ("they feint with two and lunge with a third") |
| Dodging a charge to one side (`dodge+`/`dodge-`) | a Mournback's charge ends without goring | It lines up `cutAhead` m to that side of the host ("it cuts the angle") |

| Turning to check on a Glasswalker (`checked`) | it is caught in the host's gaze while stalking close, once per `checkedCooldown` s | It stops closing in and waits for a noise of at least `coverNoise` m near the host, then comes in under it for `coverTime` s |
| Shooting at a Mistwader (`shot`) | once is enough | It wades away (`shyDistance` m) from any host noise it hears |
| Hurting a Lumen Grazer (`hurt`, a place) | the host's position when it was hurt | The herd keeps `avoidRadius` m from there for the rest of the raid |
| Shooting at a Bristleback herd (`shot`) | the herd was alarmed by gunfire or a wound | Next time, the herd stampedes at first sight (within `sightFraction` of its sight) |

### Species working together (`ai.json` `teamwork`)

`teamwork.calls` lists who calls whom. When the caller commits (a Bile Cantor winds up, an Oculimoth screeches, a Mistwader rears), every creature of the listed kinds within the radius is sent to the host as a `rally`. Their bodies show it as a call.

The remaining `mind.learns` and `mind.plans` lines are next: the Mournback shielding the wounded, Dunewake ringing a rock, Oculimoth after a flare, the Weaver rebuilding elsewhere, and the Mimic and Shroudling getting more convincing.

## Archetypes
| Kind | Archetype | Behaviour | Tell | Counter |
| --- | --- | --- | --- | --- |
| Needlemaw | swarm | Pack holds flank slots biased toward your back at 5 to 7.5 m, circling and faking short darts. Two at a time weave in, coil and lunge (leading your movement), then skitter back to the ring. | Throat sac swells for 0.35 s | Back against cover, kill the one coiling |
| Bile Cantor | spitter | Hovers at 18 to 35 m, strafing; backs off fast under 10 m. Lobs bile where you are going. | Pustules swell for 0.8 s | Close the distance, pop pustules |
| Glasswalker | stalker | Works round to your flank at 25 m. Freezes (8% visible) when you look at it; creeps when you don't (35%). Inside 25 m it charges at 11 m/s, strikes, then fades out to stalk again. | Lens flares through the 0.5 s wind-up | Keep turning, Psych-Wave Pulse, hits reveal it for 3 s |
| Oculimoth | flyer | Each eye orbits on its own ring and height (2 to 10 m). One dives at a time to peck your face. One that can see you hangs still and screeches every 8 s per swarm, alerting everything within 35 m. | Iris blows wide for 0.6 s before the screech | Shoot the screamer |
| Mournback | tank | Turns slowly (0.9 rad/s) to keep its 15% bone shield toward you. Lined up at 8 to 26 m it paws for 1 s (still tracking), then charges in a near-straight line (0.1 rad/s). Close in, it rears for a 5 m ground slam. Winded for 1.6 s after either. | Horns lower / body rears | Sidestep the charge, circle to the dorsal vents |
| Husk Mimic | mimic | Walks up at a host's pace with no tell, as if it were another player. Inside its reveal distance it splits open (screech), then lunges. Shot, it drops the act at once. | The husk splits for 0.45 s | Treat any host walking straight at you as hostile |
| Lumen Grazer | grazer | Drifts high and ignores hosts and noise until it is hurt. Then it panics: it hangs over the shooter while its glands flare, dives into a crushing slam, and repeats for its panic dives before it calms. | Lantern glands flare while it hovers overhead | Don't shoot it; if you do, run out from under it |
| Tithe Weaver | weaver | Hovers near home, spinning strands. Hunting, it strings a strand across a running host's path and spits from 12 to 18 m. A strand roots whoever walks through it and calls every creature near the web. | A fresh strand across your path | Watch your feet, shoot strands, kill the weaver to drop its web |
| Dunewake | burrower | Swims under the sand at `burrowSpeed`, where nothing can hit it, curling in from the side. Inside `burrow.triggerRadius` a line of ripples races in for `rippleTell` s, then it bursts out in a lunge. It fights on the surface (now hittable) for `resurfaceAfter` s and dives again. | The ripple line and a dry hiss | Keep moving sideways at the ripple, shoot it while it is up |
| Bristleback | herd | Grazes and ignores hosts. Gunfire within `temperament.alarmedByGunfireWithin`, or hurting one, raises the alarm through every Bristleback within `stampede.herdAlertRadius`. They stampede through the host (the trample hits, and they barely turn), wheel round, and between charges rack and loose a quill volley. Armoured front. | Quills racking up; the herd turning as one | Don't shoot near a herd. If you do, sidestep the run and shoot the cistern seam from the side |
| Fenstalker | burrower (lurker) | Lies under the water with only its eye stalks up and creeps in at `burrower.lurkCreep` x its speed. Inside `submerge.ambushRange` the stalks leave fast rings for `ripplesTell` s, then it bursts out in a lunge, fights on the surface and sinks again. | Rings off the eye stalks racing in | Keep out of deep water, or watch the rings and step aside from the lunge; shoot the eye stalks |
| Mistwader | wader | Combs the water and ignores hosts and gunfire. Hurt it and it panics: wades after the host, rears through a long wind-up and stamps (`stomp`), `temperament.panicStomps` times or until `calmAfter` s pass. A host underfoot gets one warning stamp. | Neck up, rearing back | Never stand under it. Hunt it from range and move when it rears; the throat sacs are the weak points |
| Cablecrawler | crawler | While the host is out on a walkway it does not come for the host: it scuttles to a deck behind the host's travel (the way back, never the deck underfoot) and chews through it in `cutWalkway.time` s. The raid cuts the deck. Hurting it for `cutWalkway.interruptDamage` while it chews makes it let go. Off the walkways it hunts like a stalker. | The chewing (`action` rises), the shears scissoring | Shoot it off the deck before it snaps; keep moving forward |
| Veilwing | grabber | Soars wide and silent over the host. Committing, it goes still (`hush`), spreads its skirt over the host (wind-up) and drops. A hit grabs the host: it climbs at `grab.liftSpeed` toward the open shaft (`dropZone`) for `grab.carryTime` s and lets go, so the fall does the rest. `grab.freedByDamage` while carrying frees the host early. | Silence overhead; the skirt spreading | Stay under cover and away from edges; shoot it when it hangs still |
| The Hollowed | gunner | Keeps a fighting range and sidesteps like a host, raises the gun (wind-up), fires a burst of `usesWeapon.burst` shots at `usesWeapon.accuracy` (worse at range and against a running host), then reloads far too slowly. Sometimes it forgets the gun and stares at its hands. Its head jerks toward any sound. | The barrel coming up; the chest light swinging onto you | Push it during the reload, or when it forgets the gun |
| Shroudling | spitter | For now it is a long-range spitter at its `preferredRange` (20 to 35 m). Corpse looting and the host disguise come next. | Neck slides out before the spit | Close in or break line of sight |

## Brood Heart wave director
`WaveDirector` (`src/ai/nest.ts`) is timing only: dormant until a host is within `activationRadius`, first wave after `firstWaveDelay`, then every `waveInterval` for `maxWaves`, never more than `maxAliveFromNest` of its brood alive (the overflow trickles out as the brood dies). Spawns are flung outward from the heart and hunt immediately. The raid owns the heart's body, damage and Brood Cache.

## Integration
`createBrain(kind, id, x, z, seed, radius)` builds the brain for a kind. Each frame the Abomination fills a `BrainWorld` (host view, noises, allies, the raid's `tokensFor(creatures)` pool), calls `brain.step(dt, world)`, copies `brain.body` to its root and the outputs onto `Creature.drive`, and turns `brain.events` into raid callbacks (melee, spit, screech, slam). Damage calls `brain.hurt()`, stagger calls `brain.stagger()`, death calls `brain.kill()`.

## The Reliquary (Glowmire Isle boss)
`ReliquaryBrain` (`src/ai/reliquary.ts`) runs the boss in `data/bosses.json` (spec: `docs/gdd/08-zones-and-bosses.md`). Dormant until a host comes within `wakeRadius` of the bowl or wounds it; waking starts the zone-wide song (`songRadius`). Phase from `bossPhase()`; every attack has a wind-up the body shows (`windup`, `strike`, `rear`).
| Phase | Moves | Tell | Counter |
| --- | --- | --- | --- |
| Stalk | Holds 5 m, turns slowly with its bone shell (×0.2 from a 120° front arc). Leg stamp lands where you stood when it began; rib sweep hits the front arc; brood drops every 25 s from 8 s after waking | Stamp 0.9 s, sweep 1.1 s, sac 0.8 s | Step off the marked spot, flank, pop the brood sac (stops drops) |
| Bloom | Holds 10 m. Rears for 1.4 s and vents a spore cloud; the hearts stay exposed 4 s. Hymn ring to 30 m (jump it); breaks cover within 12 m | Rear-up, hymn 1.0 s, cover 1.2 s | Burst the hearts during the vent, jump the ring, sever legs (each −15% speed) |
| Collapse | Drags itself fast: forelimb lunge (×2.5 for 0.6 s), tendril grab within 10 m pins for 2 s; the light pool floods to 70% of the bowl over 90 s. Body takes ×1.5 | Lunge 0.7 s, grab 0.8 s | Keep moving, stay out of 10 m when the tendrils coil |
Enrage at 7:00: the pool fills the bowl; only the ledge is safe.

**In raids** `RaidBoss` (`src/game/boss.ts`) joins the brain, Creature's body (`src/creatures/reliquary.ts`) and World's bowl (`ArenaInfo`), and the raid spawns it whenever the zone has a `reliquaryBowl`.
- Biomass 3600; hearts ×2.5 only while the cage is open; brood sac ×1.5 (bursting it stops drops); legs from bloom on (each 250, severing slows it). Shell hits from the front arc in stalk do ×0.2, collapse body hits ×1.5.
- A shot takes an exposed weak point if it reaches it within 2 m of the body surface, so you can't hit hearts through the whole body.
- Stamp hits inside its radius where you stood; sweep hits the front arc in range; the hymn ring hits once as its front passes unless your feet are above its height (jump, or stand on the ledge); grab pins you (no movement) for 2 s or until you deal 80 to it; the vent lays a spore cloud; cover break smashes pillars within reach; brood drops spawn Needlemaws from the sac.
- The flood burns the bowl floor out to the pool radius; the ledge is safe.
- Kill: 400 DNA, the Reliquary Cage container, `bossKilled` for contracts, and the Reliquary Heart to cut out (hold E for 6 s, noise 40 m).
- Bus events: `bossAwake`, `bossPhase`, `bossEnraged`, `bossAttack`, `bossDamaged`, `bossPartDestroyed`, `bossCoverBroken`, `bossDefeated`. HUD boss bar shows `The Reliquary · PHASE`.

## The Pale Vigil (Glowmire Isle, Fungal Cave boss)
`src/ai/vigil.ts` (`PaleVigilBrain`) is renderer-free and takes every number from `bosses.json` `paleVigil`. It makes no sound at all; the only tell is the lure going still.
- **Dormant:** it hangs over its spot and wakes when a host comes within `wakeRadius`, or when it is shot.
- **hang:** it crawls the ceiling at `ceilingSpeed` to park its lure over where the host is *heading* (1.5 s ahead).
  - Standing under it (`triggerUnderLure`) earns the drop: the lure holds dead still for the wind-up (`lureStill`), it falls, crouches for 1.5 s, then climbs back.
  - Coming within `snatch.range` earns a grab (pin, lift, freed by damage).
  - `lurePull()` gives the Overload per second a host within range takes; the raid checks line of sight.
  - Losing the lure forces stalk.
- **stalk:** on the floor and dim.
  - Seen from the front, it swings wide round the host; it only lunges from the `fromBehindArc` blind cone, and rakes up close.
  - After each attack it climbs into the roof (`vanish`), stays `hiddenFor` s, and drops back `reappear`ing 6 m behind the host.
  - With every limb cut off it can't climb. Each lost limb slows it by `slowPerSevered`.
- **unravel:** it charges. The shriek opens the chest with the spines out (`spinesExposed`).
  - Ceiling collapse warns (`collapseWarn`, dust) `warning` s before each `chunk` lands: one on the host, the rest scattered.
  - Frenzy lunges chain `chain` times.
- **Enrage:** at `enrage.after` the ceiling keeps falling every 6 s.
- **Raid wiring:** this lands once Creature's body is in, with the same pattern as `src/game/boss.ts` (hit spheres: lure, spines, limbs).


## The Warden of the Long Seed (the Wreck's reactor chamber)
`src/ai/warden.ts` (`WardenBrain`) is renderer-free. Attack numbers come from `bosses.json` `warden`, and movement, wake and tells from `ai.json` `warden`.
- **Wake:** `wake.trigger` is `'approach'` for now, so it wakes when a host enters the chamber or comes within `wake.radius`. Switch it to `'power'` once Gameplay's ship-power objective exists (`input.powered`), or call `wake()`.
- **tend:**
  - The head crawls the walls and ceiling (`surface` and `up` feed the body's `drive.surface` and `drive.up`) and re-perches every `perchTime` s. Half the time it perches on the ceiling over the host, otherwise high on the nearest wall.
  - Root spear: the head rears back, then the spear lands where the host was *heading* (`spearLead`), so moving dodges it.
  - Embryo swarm: Oculimoths are born from the pods after a `birthTell`.
  - Plates soak body fire (`plateMultiplier`). `vent(i)` opens seam i for `seamOpenTime` s.
- **overheat:** it drops to the floor at `holdDistance` and its seams stay open.
  - Steam burst around the head after `steamTell`.
  - Catwalk collapse near the host (World's hook).
  - A faster spear.
- **meltdown:** the reactor charges for the full 3 s wind-up (`windup` and `rear` swell), then pulses through the chamber. Only cover blocks it.
- **Enrage:** the reactor pulses every `enragePulseEvery` s.
- **In a raid** (`src/game/warden.ts` `RaidWarden`, wired in `raid.ts`): it uses World's `WardenArena` (`structures.warden`).
  - Shooting a coolant valve's wheel vents it. The plume shows, and the seam with the same index cracks for `seamOpenTime` s.
  - Seed pods are always weak points (×2, 300 Biomass each, and they shatter). Seams take ×3 while they are open.
  - The pulse comes from the core. `SOLIDS.blocked` between the core's skin and the host's chest decides cover, so the four shield pillars save you.
  - Catwalk events bring down the nearest standing catwalk, and anyone on it falls.
  - The swarm spawns at the body's `birthPoint`, clamped inside the chamber.
  - When it dies, the spoils drop on the floor under it.

## The Sandwidow (Ochre Reach, Skyfall Crater)
`src/ai/widow.ts` (`WidowBrain`) is renderer-free. Attack numbers come from `bosses.json` `sandwidow`; movement, tells and rise/sink rates from `ai.json` `widow`. `src/game/widow.ts` (`RaidWidow`) joins it to Creature's body (`src/creatures/zones/sandwidow.ts`) and World's crater (`structures.widow`, a `WidowArena`).
- **Wake:** a host steps onto the crater floor near her (or shoots her while she is up).
- **Under the sand** (`surface` below `hittableAbove`) nothing reaches her: shots, splash and the boss bar damage all stop.
- **circle:** she swims `circleRadius` m round the host. The **undertow** sinks a funnel where the host stood (the tell) and bites up through it. Every `surface.every` s she **breathes** for `surface.duration` s: crown open, throat sacs exposed (×2.5, 400 each). **Brood call** brings Dunewake out of her throat.
- **erupt:** the **breach** tracks the host through its wind-up, bursts out under them, and she stays up `eruptUp` s. Up, she **sand-blasts** a cone (damage and `blindDuration`, raised as the `hostBlinded` bus event). Jaw petals can be shot off (200 each), and each takes `petalBite` off her bites.
- **drown:** the floor turns to **quicksand** (`floorFraction` of the radius, the whole floor once enraged). It slows the host to `slowMultiplier` and grinds `damagePerSecond`. She closes in and **thrashes**; her body takes ×1.3.
- **Debris rocks** are the counter. A host standing on one (feet 0.9 m above the sand) is out of reach of the undertow, the thrash and the quicksand; the breach still reaches a low rock.
- **Kill:** `bossKilled('sandwidow')` pays her DNA, the Widow Clutch and the Widow Egg harvest.
