# Art Bible

Derived from Brandon's five reference images in `docs/reference/`. Every department follows this.

## Two registers
- **The Hive** (menus, lab, stash, trader): dark, clinical, acid-green. Targets: `01-light-class-select`, `02-three-class-select`, `03-genetic-evolution-lab`.
- **Zone 7** (in-raid): a grounded, eerie alien wilderness at night. Target: `04-in-raid-combat` for composition and creatures only, read through the two rule sections below. Its neon saturation and psychedelic sky are no longer targets.
- Creatures are rendered grounded and photoreal in both. `05-painterly-collage` is used for screen layout ideas only, not for its cartoon rendering.

## Grounded and eerie (Brandon, 2026-11-11 evening): the standing rule
Brandon: the art is still "very neon". He wants it more realistic and easier to look at, weirder and more textured so it feels unique, and scary. This section overrides anything softer below.
1. **Natural first.** Bodies are weathered stone, olive moss, bruise-brown flesh, bone and chitin under a cold night key (`ZONE7_SHADE`, `ORGANIC`). Zone 7 glow colours (magenta, cyan, violet, lime) are never a body colour for anything larger than a hand.
2. **Glow is rare.** A guide of under 5% of the screen self-lit: eyes, weak points, spores, pickups, a few veins. If a thing glows, ask what the light means to the player.
3. **Strange surfaces make it ours.** Texture is where the alien lives: ribbed and pitted flesh growths erupting from rock, fossil bone in the ground, wet sheen against dry chitin, sutures, pores, scars. Use `BIO_BUMP` relief and roughness contrast, never a flat colour.
4. **Scary comes from darkness and silhouette.** Low-key lighting, deep shadows, fog that hides distance, creatures read first as shapes against mist, then as detail when close. Leave some places dark.
5. **Easy on the eyes.** The grade is low saturation (0.7) with film grain. Keep contrast in value (light and dark), not in hue.
6. **Sky is an overcast night.** The nebula is a faint grey veil, planets are hazed and desaturated; no plasma bands, no bright rings.

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
| Organic (lit, not glowing) | Wet flesh / Deep flesh / Vein / Amber / Mist | #6E4E4C / #3A1C2A / #5A3036 / #C98A3E / #8C9BB4 |

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
"Membrane" (UI department, 2026-11-11). Brandon found the first UI too close to the reference images, so the references set the mood only. This is our own look.
- Type: Cormorant Garamond, a display serif, for names, numbers and titles. Manrope for labels and body. Labels are small spaced caps. Both are SIL OFL and bundled through @fontsource.
- Shape: glass panels with an asymmetric "seed" curve (two soft corners, two tight) and hairlines instead of borders. Actions are round nodes and capsules. No chamfers, no vine framing, no glow boxes.
- Colour: bone at rest, amber for what is selected or in use, acid only for alive and ready, cyan for DNA, danger for loss. The 3D lab and the zone carry the colour; the UI stays quiet.
- Primary action: a soft amber capsule, bottom right, with an arrow node. Its warning sits beneath it in small danger caps.
- Feel: every control answers. Hover lifts and warms, press sinks. Screens settle in with a short stagger. Numbers tick when they change. Dragged items lift and tilt, then settle with a bounce where they land.
- In-raid HUD: quiet clusters at the edges of vision on soft pools of shade, never framed.
  - Top left: the collapse clock and the way out.
  - Top centre: a bearing tape with extracts, pods and nearby creatures, with the boss line under it.
  - Top right: objectives and what is carried.
  - Bottom left: the host's ocellus and the Biomass and Neural Overload lines.
  - Bottom centre: the kit as round cells.
  - Bottom right: the weapon, ammo in the serif and ego charge as a ring.
