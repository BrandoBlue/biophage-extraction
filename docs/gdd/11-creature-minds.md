# 11 Creature minds: the bar for behaviour

Brandon, 2026-11-12: creatures must be "smart and creepy and intelligent and can show how they think and not just me pulling mobs. it needs to be high level game."

This page sets the bar. Every creature in `data/abominations.json` has a `mind` block, and `tests/data.test.ts` fails if one is missing. PvE AI builds the brains to it (see [pve-ai](pve-ai.md), whose Menace section is the first step). Creature builds the tells into the bodies.

## The five rules
1. **They want something.** Each creature has a goal (`mind.wants`): to feed, to guard, to take loot, to drop you into the pit. A creature is never just "aggro on sight". It does what serves its goal, and that sometimes means not attacking.
2. **You can watch them think.** The player can read every decision before it happens (`mind.shows`): a head tilt while it decides, a stare before it comes, packmates calling to each other, the swarm going dark before it pours out. If a creature changes its mind, the player sees it change. Every attack keeps its readable tell and its counter.
3. **They work together and use the ground** (`mind.plans`):
   - Packs cut off your way out and come from your blind side.
   - Creatures wait at chokepoints, water crossings and loot.
   - Species help each other. The Oculimoth calls in hunters, the Cantor sings Needlemaws onto you, and the Mournback shields the wounded.
4. **They learn you within a raid** (`mind.learns`). A trick works once or twice, then the creatures adapt. Corner camping, ledge cheese, the same dodge every time, a door you hold: each gets a counter. They don't learn across raids, so each raid starts fair.
5. **No pulling.** The player can't drag creatures one at a time to a safe spot:
   - Alerts spread through the pack (`alertShare`).
   - A creature that can't reach you doesn't stand there and take hits. It retreats out of sight, flanks, or waits in ambush.
   - Leashing home is a choice the creature makes when the chase goes cold, never a reset the player can exploit.

## What "creepy" means here
- **Silence is a tell.** A calm area is noisy: chirping, humming, plucking. When it goes quiet, something has noticed you.
- **Almost-human behaviour.** The Husk Mimic, the Shroudling and the Hollowed act almost, but not quite, like players. They stop at the wrong moments, echo the last ping, and reload too slowly.
- **They watch.** Creatures that aren't attacking still track you with their heads. A stalker that freezes when you look at it is scarier than one that charges.
- **They come back.** A wounded hunter that breaks off returns later, from a different direction.

## Bosses
Bosses follow the same rules at a larger scale:
- Each phase has a goal, not just a damage pattern.
- Each phase change is shown before it happens (the Hymnal falls silent, the Bone Tide rolls).
- Bosses punish a squad that repeats a tactic. If everyone hides behind the same pillar, that pillar is the first to break.

## Acceptance checks for PvE AI
A creature's brain is done when a playtester can, without help:
- say what the creature is trying to do, after watching it for 10 seconds
- tell when it is about to attack, and what attack
- see it react to a tactic they repeated, inside one raid
- fail to pull a pack one at a time to a safe spot

## Per creature
The per-creature `mind` blocks in `data/abominations.json` are the brief. Read them together with the creature's `brief`, `archetypeHint` and habitat. If a brain can't meet a line of its brief, tell Design and we'll change the line. Don't silently drop it.
