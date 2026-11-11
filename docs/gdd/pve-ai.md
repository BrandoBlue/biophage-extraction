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
