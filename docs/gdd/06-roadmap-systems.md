# 06 Systems after Spore: decisions already made

Short on purpose: these become full docs and data when their iteration starts. Larva is now fully specced in [larva-milestone](larva-milestone.md) and Host in [host-milestone](host-milestone.md); where they differ from this page, they win. Recorded now so Spore code does not paint later systems into a corner.

## Currencies and resources
- **DNA:** the banked currency. Earned by extracting kills and DNA-valued items. Spent on the Genetic Synapse tree and at the Flesh Market.
- **Mutagens:** items. Applied in the Hive to unlock or level a mutation node (cost × class mutagen multiplier).
- **Viruses:** items. Injected mid-raid for a strong temporary effect with a side-effect, or integrated in the Viral Lab to become permanent (costs DNA, and the strain is consumed).

## Inventory and stash (Larva)
- **Internal cavities:** an in-raid grid inside the host's body (Infiltrator 5×4). Items have sizes in `loot.json`. Opening the inventory shows the host's translucent torso with organs shifted aside.
- **Gut pouch:** a 2×1 secure slot that survives death (the extraction-genre safety valve), upgradable on the Synapse tree.
- **Stash:** Hive storage, slot count by class (40 / 60 / 80), expandable with DNA.
- Death loses everything outside the gut pouch. Kill DNA is always lost on death.

## Corpse harvesting (Larva)
Hold interact on a dead creature to cut out an organ (2 to 4 s, loud, wet). Organs are the main item source; each creature type drops a characteristic organ.

## Viruses and mid-raid mutation (Larva)
Inject (3 s, vulnerable): an immediate visible mutation (dissolve-grow on the host's arms in first person) with a buff and a cost, for the rest of the raid. First strains:
- **Plague-Stalker Strain:** spores leave a damage-over-time infection; your footsteps glow (louder to sight).
- **Adrenaline Virus:** Overload decays twice as fast; Biomass max −15%.
- **Spliced Parasites:** kills release a parasite that seeks the nearest enemy; you lose 1 Biomass/s while it lives.

## Genetic Synapse tree (Host)
Per class, three paths drawn as neurons (reference 01): e.g. Infiltrator **Mind** (scanner and pulse), **Spore** (weapon and toxins), **Graft** (survival). Five nodes per path, DNA plus mutagens per node, class level gates tiers. Every node changes the silhouette or glow (Art Bible rule 2).

## Flesh Market (Host)
A cyber-organic vendor that buys anything for DNA at item value × 0.6 and sells contraband weapons and strains with a daily rotating stock. It has moods: selling it organs it likes raises its prices on a strain you want; it remembers you.

## PvP rules (Host bots, Hive online)
- Rival hosts use the same rules and damage as the player. Head ×1.8.
- Killing a host lets you loot their cavities and steals 50% of their carried kill DNA.
- Extracts are shared; a channelling host is visible on everyone's scanner as a pulsing bloom.
- Squads (Hive-Mind) of up to 3 share scanner pings and can revive a downed host within 20 s.
