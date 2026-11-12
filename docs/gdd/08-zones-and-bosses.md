# 08 Zones and bosses

Numbers in `data/zones.json` and `data/bosses.json`; geometry in World & Level's `data/zone7.json` keyed by the same zone ids.

**Look direction from Brandon (v0.1 playtest):** he loves the ethereal feel and the creature aesthetic; **don't lean too hard into neon, it reads as AI-made.** Zones are misty, grounded and naturally lit. Glow is an accent: creature weak points, fungi, liquid light. It is never a wash over everything.

## Zone roster
Each zone is its own raid, picked on raid select. Each has its own structures, foes, loot focus and reason to go.
| # | Zone | From | Access | Raid | Threat | What makes it different |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Glowmire Isle** | Spore | open | 10 min | 1–3 | The misty first island. Hollow Chitin Tower (3 floors, sniper roost), Long Seed debris field, fungal caves, the Reliquary's sunken bowl. Organs and first viruses. |
| 2 | **Wreck of the Long Seed** | Larva | Archivist contract *Signal in the Wreck* | 15 min | 2–4 | **Interior.** A crashed seedship on 3 floors: breached prow, cargo holds, crew warrens with Wraith vents, an embryo gallery whose tanks hatch, Seed-Key lockers, a cold reactor. Tech loot. Restoring power (3 Coolant Rods) opens sealed doors and escape pods, and wakes the Warden (Host). |
| 3 | **The Expanse** | Host | level 5 or *Rib and Hymn* | 25 min | 1–4 | The full 1 km of Zone 7: five biomes, rival hosts, shifting extracts, anomalies, Lumen Grazers overhead. |
| 4 | The Hollow Choir | Apex | — | — | 3–5 | A vertical cave-cathedral where sound is light: noise makes the walls glow and gives you away. Stealth zone. |
| 5 | The Ossuary Reef | Apex | — | — | 4–5 | A dry sea floor of bone coral in low gravity among mountain-sized ribs. The hardest zone. |

## The Reliquary (Glowmire Isle boss, Larva)
Body concept shared with Creature & Mutation. A 10 to 12 m colony organism, part hermit crab, part siphonophore, part banyan tree. On its back it wears a cathedral of fused host ribcages, the bones of everything that died in Zone 7. It walks on six pillar legs with root-like toes. A brood sac hangs underneath and drops Needlemaws. Three heart chambers glow through the bone and are the only bright things on it. It sings low, like wind through a ribcage, audible across the island.

**3600 Biomass.** Weak points: 3 hearts (×2.5, exposed from phase 2), the brood sac (×1.5; destroying it stops the drops), 6 legs (severable from phase 2, each slows it 15%).
| Phase | Biomass | Behaviour | How to fight it |
| --- | --- | --- | --- |
| **Stalk** | 100–65% | Bone shell takes 20% from the front. Leg stamp (45), rib sweep (35), drops 3 Needlemaws every 25 s | Flank from the ledge, bait stamps, pop the brood sac |
| **Bloom** | 65–30% | Rears and splits the ribcage open: hearts exposed. Vents spore clouds (8/s plus Overload), sends a jumpable hymn ring (25), breaks cover, drops 4 Needlemaws | Burst the hearts during vents; jump the rings; sever legs |
| **Collapse** | 30–0% | Legs give out; it drags itself fast on two forelimbs (50); tendril grab pins for 2 s (teammates free you); the liquid-light pool floods outward (10/s) | Stay mobile; the body now takes ×1.5 |
Enrage at 7:00: the whole bowl floor floods; only the ledge is safe.
**Arena (World):** a sunken bowl 60 m across and 9 m deep, two entrances, a 3 m ledge around half the rim, 4 destructible cover pieces, a liquid-light pool at the centre, an exit within 80 m.
**Rewards:** 400 DNA; the Reliquary Cage container (Reliquary Heart, Ribchoir Bones, 4 rich rolls); a harvestable Reliquary Heart (6 s, loud); 1000 XP. Respawns every raid, dormant until someone enters the bowl.

## The Pale Vigil (Glowmire Isle, fungal caves, Larva)
Glowmire's second boss, made for Brandon's "harder, scarier" ask. Where the Reliquary is a loud fight in the open, the Vigil is a silent horror in the dark. It is a 7 m, starvation-thin thing that hangs upside down from the cave ceiling on four long jointed limbs. Its body is a pale, translucent sack of folded skin, and you can see its slow organs through it. A long stalk hangs from its chest and ends in a soft, warm-glowing lure that sways at head height, like a lantern someone left behind. It has no face, only a vertical slit that opens to the ribs when it shrieks. It makes no sound until it has you, and the only tell is the lure going still.

**2400 Biomass.** Weak points:
- the lure (×2.5; destroying it ends the hang phase early)
- 3 spines (×2, exposed while it hangs or rears to shriek)
- 4 limbs (severable from the stalk phase; each slows it 12%; with all four gone it cannot climb)

| Phase | Biomass | Behaviour | How to fight it |
| --- | --- | --- | --- |
| **Hang** | 100–70% | Crawls the ceiling and parks the lure over the paths through the cave. Looking at the lure fills Overload (5/s). Walk under it and it drops (40), or snatches you up to the ceiling and pins you for 2.5 s (35, then 12/s; teammates free you with 120 damage) | Don't stand under the light; shoot the lure and the spines |
| **Stalk** | 70–35% | Drops to the floor and hunts in total silence. It lunges only from outside your view (55), rakes up close (30), then climbs into the dark and comes back from behind 3 s later | Keep your back to a wall; sever limbs |
| **Unravel** | 35–0% | Its skin splits and it shrieks (18 m, 25 Overload, stagger). The ceiling falls in four places, with dust as a 1.5 s warning (60 each). Chains three fast lunges | Shoot the spines while it shrieks; watch for falling dust |

Enrage at 6:00: web-roots seal the cave mouths and the ceiling falls every 6 s.

**Arena (World):** the main chamber of the fungal caves under the east cliff:
- 34 m across and 16 m high
- 3 entrances
- ceiling roots it can climb
- 5 glow-fungus patches (the only light besides the lure)
- 6 pieces of cover
- an exit within 70 m

**Rewards:** 350 DNA. Vigil's Cocoon is a hanging silk bundle holding the gear of hosts it took: a guaranteed Hush Gill, plus rolls for Night Eye, Splinter Strain, marksman and sniper guns, and needle feed. You can harvest the Vigil Lure (a catalyst, 5 s), and the kill gives 900 XP. The Archivist's contract *The Light Under the Cliff* asks for the lure. The Vigil respawns every raid.

## The Warden of the Long Seed (Wreck boss, Host)
The seedship's gardener, a caretaker grown to tend the embryos the ship carried, now fused with its reactor. A 20 m centipede body of hull plates and roots that runs along walls and ceiling. Its head is a cluster of glass seed-pods, each holding a dormant embryo of a never-born species that twitches when hurt. It glows only where the reactor shows through cracked plates.

**5200 Biomass.** Weak points: 5 seed-pods (×2) and 4 reactor seams (×3), which are exposed only by venting the coolant valve beside the Warden (8 s interaction, while it hunts you).
| Phase | Biomass | Behaviour |
| --- | --- | --- |
| **Tend** | 100–60% | On walls and ceiling; plates take 30%; root spears (40); releases Oculimoth swarms from the embryo pods |
| **Overheat** | 60–25% | Drops to the floor with seams glowing; steam bursts (30); catwalks start to collapse |
| **Meltdown** | 25–0% | Reactor pulses (60 across the room, 3 s warning) that only shielded pillars block |
Enrage at 9:00: pulses every 8 s. **Arena:** reactor chamber about 38 m across and 18 m high (the hull height), 2 catwalk levels, 4 coolant valves, an exit within 60 m. **Rewards:** 700 DNA, Warden Seed-Core (a top catalyst), 2–4 Embryo Pods, 1500 XP. It only wakes once someone restores the ship's power.

## Department asks
| Department | Build |
| --- | --- |
| World & Level | Glowmire Isle structures (chitin tower, debris field, fungal caves, sunken bowl arena); the Long Seed as its own map with the rooms above, doors, vents and the reactor chamber; landmarks named as in `zones.json` so contracts can target them. Keep the look misty and natural-lit, with glow as accents. |
| Creature & Mutation | The Reliquary body (built from the concept above) with severable legs, the opening ribcage and heart chambers; the Pale Vigil (ceiling hang, lure, splitting skin, severable limbs); the Warden later. |
| PvE AI & Encounters | Reliquary phase logic, attacks and brood drops; dormancy and zone-wide song; Pale Vigil ceiling movement, lure, snatch-and-pin, silent stalking from behind, collapse; Warden wall-crawling (Host). |
| Gameplay Engineering | Boss damage, phases and weak points from `bosses.json`; landmark visits; Long Seed power state, doors, Seed-Key lockers and escape pods. |
| UI & HUD | Raid select with zone cards (threat, raid time, access, boss state with Memory Coral); a boss bar in bone and flesh, never a neon bar. |
