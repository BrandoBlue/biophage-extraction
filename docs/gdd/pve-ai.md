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
- **Wounds.** A hunter below 35% Biomass limps (75% speed). The first time one drops below 30%, it has an even chance to break off and run for 2.2 s. Then it cries out (an alert, which calls packmates within its alertShare radius) and comes back. The Mournback never runs.

The body can show an ambush through `Abomination.lurking` together with `brain.lurkHow === 'ambush'` (for example, crouched low). The stare is `brain.phase === 'spot'`, and the retreat is `phase === 'flee'`.

## Archetypes
| Kind | Archetype | Behaviour | Tell | Counter |
| --- | --- | --- | --- | --- |
| Needlemaw | swarm | Pack holds flank slots biased toward your back at 5 to 7.5 m, circling and faking short darts. Two at a time weave in, coil and lunge (leading your movement), then skitter back to the ring. | Throat sac swells for 0.35 s | Back against cover, kill the one coiling |
| Bile Cantor | spitter | Hovers at 18 to 35 m, strafing; backs off fast under 10 m. Lobs bile where you are going. | Pustules swell for 0.8 s | Close the distance, pop pustules |
| Glasswalker | stalker | Works round to your flank at 25 m. Freezes (8% visible) when you look at it; creeps when you don't (35%). Inside 25 m it charges at 11 m/s, strikes, then fades out to stalk again. | Lens flares through the 0.5 s wind-up | Keep turning, Psych-Wave Pulse, hits reveal it for 3 s |
| Oculimoth | flyer | Each eye orbits on its own ring and height (2 to 10 m). One dives at a time to peck your face. One that can see you hangs still and screeches every 8 s per swarm, alerting everything within 35 m. | Iris blows wide for 0.6 s before the screech | Shoot the screamer |
| Mournback | tank | Turns slowly (0.9 rad/s) to keep its 15% bone shield toward you. Lined up at 8 to 26 m it paws for 1 s (still tracking), then charges in a near-straight line (0.1 rad/s). Close in, it rears for a 5 m ground slam. Winded for 1.6 s after either. | Horns lower / body rears | Sidestep the charge, circle to the dorsal vents |

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
