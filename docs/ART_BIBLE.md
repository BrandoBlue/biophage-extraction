# Art Bible

Derived from Brandon's five reference images in `docs/reference/`. Every department follows this.

## Two registers
- **The Hive** (menus, lab, stash, trader): dark, clinical, acid-green. Targets: `01-light-class-select`, `02-three-class-select`, `03-genetic-evolution-lab`.
- **Zone 7** (in-raid): an ethereal, atmospheric cosmic wasteland. Target: `04-in-raid-combat`, read through the restraint rules below: take its composition, sky and creatures, not its neon saturation.
- Creatures are rendered grounded and photoreal in both. `05-painterly-collage` is used for screen layout ideas only, not for its cartoon rendering.

## Ethereal, not neon (Brandon, 2026-11-11, after playing the build)
Brandon likes how ethereal the world looks and likes the alien creatures. Too much neon reads as AI-made. Every department follows these rules:
1. **Lit material first, glow second.** Most of the frame is real surface lit by soft, coloured light: stone, moss, wet flesh, chitin, bone. A surface glows only where it has a reason to: a weak point, an eye, a vein, a spore, a pickup or a liquid-light pool.
2. **Glow is an accent.** As a guide, no more than about 10% of the screen should be self-lit. Large shapes such as fungus caps, crystals, membranes and armour must not glow over their whole surface.
3. **Moderate saturation.** Palette colours are hues to tint with, not paint to fill with. Mix them into darker, greyed body tones. Save full-strength palette colour for small focal points.
4. **Atmosphere carries depth.** Use haze, height fog, soft light shafts and distance fade instead of more glow. The sky is a veil, not a light show.
5. **Bloom is a halo, not a fog.** Only the brightest focal points should bloom.
6. **Code enforces it.** Every `bioSurface` material passes through the global glow restraint (`bioGlow`, `bioSat` in `src/render/materials.ts`). Plain emissive materials and FX must carry the same restraint themselves. Do not bypass it to make something "pop": use contrast, rim light or motion instead.

## What each reference sets
| Reference | Take | Do not take |
| --- | --- | --- |
| 01 Light class select | Hero creature render, black-teal UI, node-and-vein skill paths coloured per path, stat card, glowing green CTA | Exact Wraith silhouette (starting point only) |
| 02 Three-class select | Class card layout (buffs, negatives, unlock track), Behemoth raw-red flesh and ivory bone, stash grid preview | Stat numbers (the GDD sets them) |
| 03 Genetic Evolution & Viral Lab | Creature on lit pedestal with callouts, branching pathogen tree, loadout and infections panel, top nav with currencies | Nothing; closest Hive target |
| 04 In-raid combat | Zone 7 palette and sky, floating islands, glowing fungi, liquid-light falls, organic HUD frames, eyeball portrait, swirling Psych-Wave Scanner, living gun | Arcade "999!" damage numbers; use hit-markers and wound VFX |
| 05 Painterly collage | Screen list: main menu, synapse, evolution lab tube, lobby with three host portraits, arsenal cards | Cartoon rendering, pink ornate frames |

## Palette (code: `src/render/palette.ts`)
| Register | Role | Hex |
| --- | --- | --- |
| Hive | Background black-teal | #050F0C |
| Hive | Panel teal | #0B2A26 |
| Hive | Acid green (lines, CTA, bioluminescence) | #6CFF4A |
| Hive | Bone / chitin ivory | #D3CBB2 |
| Hive | Negative / danger red | #E0402E |
| Paths | Stealth green / Melee amber / Viral violet / DNA cyan | #6CFF4A / #FFB13B / #A55BFF / #34E3F0 |
| Zone 7 | Void indigo | #140A33 |
| Zone 7 | Magenta / Electric cyan / Violet / Lime | #FF3FA4 / #2EE6FF / #8B3DFF / #B6FF3B |
| Organic (lit, not glowing) | Wet flesh / Deep flesh / Vein / Amber / Mist | #7A4756 / #3A1C2A / #6E2E4A / #C98A3E / #8C9BB4 |

The organic tones are for bodies that are lit rather than glowing: the held weapon, hands, hides and hulls. Use the Zone 7 glow colours on top of them as accents (eyes, chamber, weak points), never as the body colour of something the player looks at all the time.

## Materials
- Wet chitin and bone plating with subsurface scattering; ivory spikes on raw red muscle for heavies.
- Translucent veined membranes (wings, frills) that glow from behind.
- Bioluminescent nodes and pustules on every creature: they read as weak points, loot sources and evolution stage. They are small, deliberate points of light on a creature whose body reads as lit flesh and chitin.
- Fungal and crystal growths that sprout from armour as mutation stages climb.
- Living weapons: flesh, tracking eyes, tentacle feeds, crystal implants, wet sheen.

## Lighting
- Hive: low-key, teal-green key, strong rim light, pedestal light pools, light haze.
- Zone 7: multi-colour skies (nebulae, ringed planets) kept soft and partly desaturated; restrained bloom on focal emissives only; valley haze; shadows stay dark. Readability beats spectacle in combat.
- Gore: wet, glossy, anatomical but alien. Fluids glow violet or green; red is reserved for the Behemoth line and damage feedback.

## Creature rules
1. Silhouette first. Wraith: gaunt, blade forearms, insect wings. Infiltrator: slim biped, bulbous cranium, antennae. Behemoth: hunched mass, bone crown and spikes.
2. Every mutation changes the silhouette or the glow pattern, readable from 50 m.
3. Mutation stages grow in order: nodes, then growths (fungus, crystal), then new limbs or carapace.
4. Never-before-seen: combine at least two unrelated biology sources per creature. Nothing recognisable from another franchise.

## UI language
- Dark translucent panels, 1 px acid-green borders, chamfered corners, thorned vine framing in screen corners with glowing pustules.
- Uppercase condensed sans. Open-licence fonts only: Chakra Petch (headings), Rajdhani (body).
- Trees are neurons: circular icon nodes joined by glowing veins, coloured by path, locked nodes greyed.
- Primary action bottom-right: glowing bevelled green button with a red PvPvE warning line.
- In-raid HUD is organic: Biomass and Neural Overload in bone-and-flesh frames, reactive eyeball portrait, round Psych-Wave Scanner, five ability slots, weapon panel with charge ring.
