/** In-raid HUD mock: the organic HUD fed with fixture HudViews over a captured Zone 7 frame. */
import { OrganicHud } from '../src/ui/raid/hud';
import type { HudView } from '../src/ui/raid/model';

const base: HudView = {
  phase: 'raid', biomass: 174, biomassMax: 200, overload: 0.42, overloaded: false,
  ammo: 34, magazine: 42, reloading: 0, ego: 0.72, egoReady: false, timeLeft: 412, collapse: false,
  slots: [
    { slot: 1, label: 'Psych-Wave Pulse', count: null, usable: true, active: false, cooldownFrac: 0 },
    { slot: 2, label: 'Clot Gel', count: 2, usable: true, active: false, cooldownFrac: 0 },
  ],
  carried: [
    { item: 'clotGel', label: 'Clot Gel', count: 2, kind: 'consumable' },
    { item: 'plagueStalkerStrain', label: 'Plague-Stalker Strain', count: 1, kind: 'virus' },
    { item: 'needlemawGland', label: 'Needlemaw Throat Gland', count: 3, kind: 'organ' },
    { item: 'dnaStrand', label: 'DNA Strand Bundle', count: 4, kind: 'currency' },
  ],
  dna: 35, value: 525,
  extract: { progress: 0, inside: false, distance: 121, label: 'Seed Spire', time: 10 },
  interact: null,
  scanner: { x: 0, z: 40, yaw: 0.4, range: 60, extract: { x: 30, z: -60 }, extracts: [{ x: 30, z: -60, open: true }, { x: 70, z: 10, open: false }],
    pods: [{ x: -12, z: 30, opened: false }, { x: 20, z: 52, opened: true }],
    pings: [{ x: -10, z: 20, kind: 'needlemaw', revealed: true }, { x: -14, z: 18, kind: 'needlemaw' }, { x: 16, z: 28, kind: 'bilecantor', revealed: true }, { x: 30, z: 50, kind: 'mournback' }] },
  activeVirus: null,
  cavityUsed: [7, 20],
  objectives: [{ text: 'Second Spire opens', detail: '4:00', icon: 'spire' }, { text: 'Brood Heart nest', detail: 'BEARING 300°', icon: 'nest' }],
};
const states: Record<string, Partial<HudView>> = {
  fight: {},
  inject: { injecting: true, injectProgress: 0.55, overload: 0.3 },
  mutated: { activeVirus: 'plagueStalkerStrain' },
  harvest: { harvestProgress: 0.62, interact: { text: 'HOLD E · HARVEST NEEDLEMAW GLAND', progress: 0.62 } },
  extract: { extract: { progress: 0.4, inside: true, distance: 2, label: 'Seed Spire', time: 10 }, activeVirus: 'adrenalineVirus' },
  low: { biomass: 38, overload: 0.92, overloaded: false, collapse: true, timeLeft: 94, activeVirus: 'splicedParasites', ammo: 6 },
};
const key = new URLSearchParams(location.search).get('state') ?? 'fight';
const hud = new OrganicHud(document.querySelector<HTMLElement>('#hud')!);
const s = { ...base, ...states[key] } as HudView;
let t = 0;
const tick = () => { t++; hud.update(1 / 60, s); if (t < 40) requestAnimationFrame(tick); else (window as unknown as { __mock: object }).__mock = { ready: true }; };
if (key === 'mutated') hud.mutate('plagueStalkerStrain');
if (key === 'low') hud.say('ZONE COLLAPSE IN 2:00 · EXTRACT NOW', 'danger alarm', 99);
requestAnimationFrame(tick);

if (key === 'cavity') {
  const { CavityOverlay } = await import('../src/ui/raid/cavity-overlay');
  const { fits } = await import('../src/ui/hive/grid');
  const g = {
    cavity: { zone: 'cavity', label: 'CAVITIES', size: [5, 4] as [number, number], items: [
      { item: 'clotGel', count: 2, x: 0, y: 0, rotated: false }, { item: 'plagueStalkerStrain', count: 1, x: 1, y: 0, rotated: false },
      { item: 'mournbackMarrow', count: 1, x: 2, y: 0, rotated: false }, { item: 'needlemawGland', count: 3, x: 4, y: 0, rotated: false },
      { item: 'synapseLens', count: 1, x: 2, y: 2, rotated: false }, { item: 'oculimothEye', count: 2, x: 0, y: 2, rotated: false },
      { item: 'cantorSongSac', count: 1, x: 0, y: 3, rotated: false }, { item: 'mutagenVial', count: 1, x: 4, y: 1, rotated: false } ] },
    pouch: { zone: 'pouch', label: 'POUCH', size: [2, 1] as [number, number], items: [{ item: 'dnaStrand', count: 4, x: 0, y: 0, rotated: false }] },
    pod: { zone: 'pod', label: 'POD', size: [4, 3] as [number, number], items: [{ item: 'glitchingHeart', count: 1, x: 0, y: 0, rotated: false }, { item: 'adrenalineVirus', count: 1, x: 2, y: 0, rotated: false }] },
  };
  const ov = new CavityOverlay(document.body, {
    grids: () => g,
    transfer: (from, i, to, x, y, r) => { const s = g[from].items[i]; if (fits(g[to], s.item, x, y, r, from === to ? i : -1) !== 'fit') return false; g[from].items.splice(i, 1); g[to].items.push({ ...s, x, y, rotated: r }); return true; },
    inject: () => true,
  }, (m) => hud.say(m, 'danger'));
  ov.toggle(true);
}
