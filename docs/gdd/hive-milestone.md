# Hive milestone: online play

Pulled forward on 2026-11-11 so the online thread is not waiting on a spec. The numbers are in `data/online.json` (`ONLINE` in data/index.ts). PvP rules carry over from [06](06-roadmap-systems.md).

## The raid
- Up to **12 hosts** per raid, in **squads of 1 to 3**. Squads spawn at least 80 m apart and are protected for 10 s.
- If fewer than 6 humans queue, rival host bots (`rivals.json`) fill the raid up to 8 hosts. When humans join late, bots leave in their place. Late join is allowed for the first 2 minutes.
- **Server-authoritative:** damage, hits, loot rolls, inventory, extraction and death. The tick rate is 30 Hz, with 0.1 s client interpolation and 150 ms of lag compensation. You can reconnect within 60 s and keep your host.

## Matchmaking
- You queue by zone, and the squad leader picks the zone.
- **Gear score** is the value of what you carry in. Bands at 0, 1500, 5000 and 12000 DNA keep fresh hosts away from fully kitted squads. After 45 s in the queue the bands widen, and the queue tops out at 90 s.

## Squads (the Hive-Mind)
- **Shared scanner and pings:** here, enemy, loot, extract and danger. There is no voice requirement.
- **Downed, not dead:**
  - At 0 Biomass a squad host goes down. They bleed out over 20 s, can crawl at 1.2 m/s, and can be executed by an enemy.
  - A squadmate revives them in 4 s, at 30% Biomass, at most twice per raid.
- **Friendly fire** is 25%.
- **Shared extract:** the whole squad leaves together when everyone alive is in the bloom.
- **Loot** is free within the squad; you ping to call items.

## The squad vault
The "shared stash" Brandon asked for. Each squad gets a **10 × 4 vault** next to everyone's personal stash. Any member can put items in or take them out, and every move is logged so the squad can see who took what.

## PvP
- Head shots do ×1.8.
- Killing a host lets you loot their cavities and steals 50% of their carried kill DNA.
- A channelling extract is visible on everyone's scanner.
- **No kill feed:** you learn who died by what you find.

## Department asks
| Department | Build |
| --- | --- |
| Online thread | A Colyseus room per raid, built to the authority list above; matchmaking by zone and gear-score band; squads, pings, the downed state and revive; the squad vault; bot fill and leave. |
| Gameplay Engineering | Move the authoritative parts of the raid (damage, loot rolls, extract) behind an interface the server can run. |
| UI & HUD | Squad frames, the ping wheel, the downed and revive UI, the queue screen with gear score, the vault tab in the Hive. |
| PvE AI | Creatures pick targets among all hosts. Aggro and the token system work per host, not per client. |
| Sound | Squad pings, the downed heartbeat, the revive. Each host's footsteps are positional for everyone. |
