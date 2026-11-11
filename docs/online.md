# Online squads (Hive): how the free build plays together

Owner: Online & Backend (`src/net/`). Rules and numbers: Design's [hive-milestone](gdd/hive-milestone.md) and
`data/online.json` (`ONLINE`; the `peerToPeer` block is what this build runs).

## How to play together
1. Both players open the **online build**: https://brandoblue.github.io/biophage-extraction/ (a normal web page;
   the claude.ai play link cannot do online play, see below). Chrome, Edge, Firefox or Safari.
2. One player opens **Hive-Mind → Open a squad** in the Hive and sends the **invite link** (or the five-letter code).
3. The others open the link (or type the code and press Join). Each can pick a host and loadout, and choose
   **squad** (fight together) or **rival** (drop far away and hunt each other).
4. The leader presses **Deploy**. Everyone drops at once. After the raid, both pages come back to the same squad.

To try it alone: open the build twice with `?net=local` (two windows of one browser), Open a squad in one, join in the other.

## How it works (no server of ours, no cost)
- **Peer-to-peer.** Browsers talk directly over WebRTC data channels (PeerJS). The free public PeerJS broker only
  introduces them by code; then game traffic goes browser to browser. PeerJS's free TURN relay is the fallback when two
  networks cannot connect directly.
- **Star around the leader.** Guests connect to the leader, who relays messages between guests.
- **Who decides what.** Each host owns its own body (movement, Biomass, death, extraction) and sends it 20×/s;
  others play it back 0.1 s behind, smoothly. The shooter's machine decides whom a shot hit (PvP and creatures).
  The leader's machine runs every creature brain, reinforcement and nest and alone changes creature Biomass:
  guests send it their damage, it sends snapshots 12×/s, spawns and deaths with kill credit.
- **Leader leaves mid-raid:** each guest takes over its own creatures and finishes the raid solo.

## Limits (honest list)
- **Not cheat-proof.** There is no neutral server, so a modified page could lie about hits or position. Fine for
  friends; a public ranked mode needs the dedicated server Design's spec describes (paid hosting, parked).
- **Up to 6 hosts** per raid (Design's target is 12): the leader's upload carries everyone.
- **The leader's connection is the raid's.** If the leader's machine is slow or their connection drops, creatures
  stutter for everyone, and a dropped leader ends the shared raid (guests continue solo).
- **Some networks block it.** Strict corporate/school firewalls or carrier NAT can stop browser-to-browser
  connections; the free TURN relay helps but has no guarantee. The free broker has no uptime guarantee either.
- **Join before the drop.** Late joining is not in yet.
- **claude.ai play link:** its sandbox blocks WebRTC and WebSockets, so the Hive-Mind panel there links to the
  online build instead.

## Not yet synced (next PRs)
Bosses (Reliquary, Pale Vigil) and Brood Hearts still run on each machine separately; containers and their loot;
looting a fallen host's cavities; downed state and revives; shared squad extract; squad pings.

## Tests
- `tests/net.test.ts`: codes and invite links, snapshot interpolation, the same-browser link, lobby handshake,
  seed mismatch reload, build refusal, creature pairing, spawns, follow, kills and damage routing.
- `tests/online.mjs` (`npm run smoke:online[:release]`): two pages, one raid, end to end.
