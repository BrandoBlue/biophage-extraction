# 04 Abominations (Spore)

Two creatures that play off each other: one rushes you, one makes you move. Each combines at least two unrelated biology sources (Art Bible creature rule 4). Numbers in `data/abominations.json`.

## Needlemaw: fast melee crawler
**Fantasy:** a pack of starving mouths that sprint at you on needle legs.
**Body:** a low six-legged crawler, about 1 m long. Front half is a radial lamprey mouth ringed with translucent glassy needles; back half is a ribbed jellyfish-like bell that pulses cyan when it hunts. Legs are long, thin and jointed like a harvestman's, clicking on stone. **Weak point:** a bulging throat sac under the mouth that glows brighter as it winds up a lunge (×2).
**Sources mixed:** lamprey, harvestman, comb jelly.
**Behaviour:** packs of 3 to 5. Idle: feeding on fungus, bells dim. Alerted: one shrieks and the pack converges (alerts share to 20 m). Approaches in a zig-zag, then a lunge: 0.35 s wind-up (throat flares, bell contracts), leap at 14 m/s, bite 14. 1.3 s between lunges. Faster than a walking host (6.8 m/s vs 5.2), slower than a sprinting one, so the counter is to sprint to a choke point and turn.
**Death:** the bell ruptures in a spray of cyan light, legs curl. Leaves a glowing corpse (harvestable in Larva). 5 DNA.

## Bile Cantor: slow hovering ranged spitter
**Fantasy:** a floating choir of sacks that sings acid at you.
**Body:** a 3 m translucent gas bladder hovering 3 to 6 m up, veined violet, with a hanging fringe of long fleshy tendrils like a siphonophore. Under the bladder, a cluster of throat-like organs with vocal folds that pulse as it "sings". **Weak points:** three swollen song pustules on its flanks that glow brighter as it charges a shot; each takes ×2.5 and has 45 Biomass. Pop all three and the Cantor collapses instantly.
**Sources mixed:** siphonophore, bullfrog vocal sac, pitcher plant.
**Behaviour:** keeps 18 to 35 m from the target and drifts sideways. Every 2.8 s: 0.8 s wind-up (a rising choral tone, pustules flare), then lobs an arcing glob of luminous bile (22 on hit) that leaves an acid pool (6/s for 4 s, 2.5 m). Leads moving targets by half. Sees in every direction (360°), so it is the alarm of the area: when it spots you, it alerts within 35 m.
**Counter:** close distance under it (it is slow, 2.4 m/s) or pop pustules from range.
**Death:** the bladder tears, the body drops and releases a 4 m toxic death cloud for 4 s (5/s and Overload 10/s). Don't stand under it. 20 DNA.

## Combined encounter
The Cantor forces you to move; moving makes noise and pulls Needlemaws; Needlemaws force you to stop and shoot; stopping lets the Cantor hit you. The Bio-Pod in the centre is guarded by a Cantor.

## Perception (both)
Sight range and cone, plus hearing radius multiplied by the target's class noise (Infiltrator 1.0). Noise sources: footsteps, gunfire (25 m), container opening (18 m), the Seed Spire signal (40 m). AI loses interest after 8 s (Needlemaw) or 12 s (Cantor) without contact.
