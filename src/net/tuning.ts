/**
 * Numbers online play reads, all from Design's data/online.json (ONLINE, docs/gdd/hive-milestone.md). The
 * `peerToPeer` block is what the free build runs while there is no dedicated server.
 */
import { ONLINE } from '../../data';

export const ONLINE_TUNING = {
  /** Own-body snapshots per second. */
  hostRate: ONLINE.peerToPeer.hostSendRate,
  /** Leader's creature snapshots per second. */
  creatureRate: ONLINE.peerToPeer.creatureSendRate,
  /** Playback delay for other hosts and creatures, seconds. */
  interpDelay: ONLINE.network.clientInterpolation,
  /** Damage share between squadmates. */
  friendlyFire: ONLINE.squad.friendlyFireMultiplier,
  /** Rival squads drop at least this far apart, metres. */
  spawnSeparation: ONLINE.raid.spawnSeparation,
  /** Squadmates land this far from each other, metres. */
  squadSpread: ONLINE.peerToPeer.squadSpread,
  /** Most hosts in one peer-to-peer raid (the leader's upload carries everyone). */
  maxHosts: ONLINE.peerToPeer.maxHosts,
};
