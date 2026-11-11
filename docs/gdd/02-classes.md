# 02 Host classes

The **Neuro-Infiltrator (medium) is the 100% baseline**; the others are stated against it. Only the Infiltrator is playable in Spore; the other two arrive in Host.

## Final stats (`data/classes.json`)
| | Venom-Wraith (light) | Neuro-Infiltrator (medium) | Gore-Behemoth (heavy) |
| --- | --- | --- | --- |
| Biomass | 120 (−40%) | **200** | 360 (+80%) |
| Walk speed | 7.3 m/s (+40%) | **5.2 m/s** | 3.1 m/s (−40%) |
| Sprint multiplier | 1.6 | 1.5 | 1.35 |
| Noise (footstep radius ×) | 0.5 | 1.0 | 2.0 |
| Stealth | +50% | 0 | −50% (highly visible) |
| Impact vulnerability | +30% taken | 0 | −25% taken (shell armour) |
| Toxin resistance | 0 | +20% | 0 |
| Extract channel | ×0.7 | ×1.0 | ×2.0 |
| Stash slots | 40 | 60 | 80 |
| Internal-cavity grid | 4×3 | 5×4 | 6×5 |
| Mutagen cost | ×1.0 | ×1.15 | ×1.0 |
| Special negative | Low HP, fragile | Overload decays at half speed in toxic gas | Cannot use stealth paths, slow extract |

## Conflicts between the sources, and the call made
| Stat | Project brief | Reference 01 / 02 | Decision | Why |
| --- | --- | --- | --- | --- |
| Wraith speed | +80% | +40% (ref 02), "Max" mobility (ref 01) | **+40% walk, and a higher sprint multiplier (1.6)**, so Wraith sprint is about +50% over Infiltrator sprint | +80% base speed breaks first-person aim tracking and PvP fairness; the Wraith gets "max" mobility from traversal mutations (Phase Dash) instead |
| Wraith stash | "highly limited" | "smaller stash size" | 40 slots vs 60 | Same intent |
| Infiltrator virus stat | +20% virus/toxin resistance | +20% virus spread | **+20% toxin resistance now; +20% virus potency added in Larva when viruses go live** | Resistance matters in Spore (Cantor acid, death cloud); spread needs the virus system |
| Infiltrator negative | slow stamina recovery in toxic environments | same, plus "average evasion" | Neural Overload decays at 50% in toxic gas | Overload is the stamina analogue (see 03) |
| Behemoth HP | "massive" | +80% max HP | **+80%** | Ref is specific |
| Behemoth speed | −40% | −40% | −40% | Agreed |
| Behemoth extract | – | "needs 2× time to extract via pods" | ×2.0 | Agreed |
| Mutagen cost | +15% (Infiltrator) | +15% | ×1.15 | Agreed |

## Kits
- **Neuro-Infiltrator (Spore):** Synapse Burster; slot 1 Psych-Wave Pulse (reveals life within 40 m for 4 s, small stagger); slot 2 Clot Gel (consumable heal). Silhouette: slim biped, bulbous translucent cranium, antennae that glow when Overload rises.
- **Venom-Wraith (Host):** blade forearms (melee), wings for a short glide; paths Ghost (stealth), Stinger (melee), Phage-Carrier (viral area control) per reference 01.
- **Gore-Behemoth (Host):** crash-through charge that breaks barriers, crushing melee, mutation-absorbing skin.

Evolution lines (Apex) follow the brief: Wraith → Acid Parasite, Shadow-Stalker, Xenoflyer; Infiltrator → Neuro-Hound, Spore-Caster, Psych-Warlock; Behemoth → Crustacean Grunt, Gore-Gorgon, Juggernaut-Titan.
