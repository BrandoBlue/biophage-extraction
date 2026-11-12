/**
 * The Hive screens (Larva flow: main menu → host select → stash & loadout → raid select → deploy; results).
 * Each screen is a pure function of ProfileView plus callbacks, so the same code drives the game and the
 * static mocks in mocks/ui.html. Styled in the UI department's own "membrane" language (hive.css); the
 * references in docs/reference/ set the mood only.
 */
import { def as itemOf } from '../items';
import { ABOMINATIONS, BOSSES, CLASSES, CONTRACTS, RAID, ZONES } from '../../../data';
import type { ClassId } from '../../../data';
import { FAUNA, HIVE, ORGANIC, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { hostPortrait } from '../hosts';
import { glyph, itemIcon, KIND_COLOUR } from '../icons';
import { cta, esc, h, keyHints, meter, panel, q } from './kit';
import type { ProfileView, ZoneView } from './model';
import { usage, valueOf } from './model';
import { zoneExtracts, zoneMap } from './zonemap';

const BASE: ClassId = 'neuroInfiltrator';
const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

/** Buffs and negatives worded from classes.json, relative to the Neuro-Infiltrator baseline. */
export function classTraits(id: ClassId): { buffs: [string, string][]; negatives: [string, string][] } {
  const c = CLASSES[id], b = CLASSES[BASE];
  const buffs: [string, string][] = [], neg: [string, string][] = [];
  const spd = c.moveSpeed / b.moveSpeed - 1;
  if (spd > 0.01) buffs.push(['speed', `${pct(spd)} Movement Speed`]); else if (spd < -0.01) neg.push(['speed', `${pct(spd)} Movement Speed`]);
  const hp = c.biomass / b.biomass - 1;
  if (hp > 0.01) buffs.push(['health', `${pct(hp)} Max Biomass`]); else if (hp < -0.01) neg.push(['health', `Low Biomass pool (${c.biomass})`]);
  if (c.stealth > 0) buffs.push(['stealth', `${pct(c.stealth)} Stealth / Camo`]); else if (c.stealth < 0) neg.push(['eye', 'Easily spotted']);
  if (c.impactVulnerability > 0) neg.push(['armour', `${Math.round(c.impactVulnerability * 100)}% Vulnerability to impact`]);
  else if (c.impactVulnerability < 0) buffs.push(['armour', `Heavy shell: ${Math.round(-c.impactVulnerability * 100)}% less impact damage`]);
  if (c.toxinResistance > 0) buffs.push(['toxin', `${pct(c.toxinResistance)} Virus / Toxin resistance`]);
  if (c.extractTimeMultiplier < 1) buffs.push(['extract', `Rapid extraction (${Math.round((1 - c.extractTimeMultiplier) * 100)}% faster)`]);
  else if (c.extractTimeMultiplier > 1) neg.push(['extract', `Slow extract (${c.extractTimeMultiplier}× time)`]);
  if (c.noise < 1) buffs.push(['noise', `Quiet footfalls (${Math.round(c.noise * 100)}% noise)`]);
  else if (c.noise > 1) neg.push(['noise', `Highly noisy (${c.noise}× footsteps)`]);
  if (c.stashSlots < b.stashSlots) neg.push(['stash', `Smaller stash (${c.stashSlots} slots)`]);
  else if (c.stashSlots > b.stashSlots) buffs.push(['stash', `Larger stash (${c.stashSlots} slots)`]);
  if (c.mutagenCostMultiplier > 1) neg.push(['dna', `${pct(c.mutagenCostMultiplier - 1)} Mutagen cost`]);
  if ((c.toxicOverloadDecayMultiplier ?? 1) < 1) neg.push(['toxin', 'Slow Overload recovery in toxic gas']);
  if (id === BASE) buffs.push(['armour', 'Balanced build, efficient weapon handling']);
  return { buffs, negatives: neg };
}

/** The Evolution tracks from the GDD (unlock names only; levels come with the Synapse tree in Host). */
export const EVOLUTIONS: Record<ClassId, { lvl: number; name: string }[]> = {
  venomWraith: [{ lvl: 2, name: 'Acid Parasite' }, { lvl: 5, name: 'Shadow-Stalker' }, { lvl: 12, name: 'Xenoflyer' }],
  neuroInfiltrator: [{ lvl: 3, name: 'Neuro-Hound' }, { lvl: 6, name: 'Spore-Caster' }, { lvl: 15, name: 'Psych-Warlock' }],
  goreBehemoth: [{ lvl: 1, name: 'Crustacean Grunt' }, { lvl: 8, name: 'Gore-Gorgon' }, { lvl: 20, name: 'Juggernaut-Titan' }],
};
const TYPE: Record<ClassId, [string, string, string]> = {
  venomWraith: ['LIGHT CLASS', 'LIGHT', 'AGILITY & INFILTRATION'],
  neuroInfiltrator: ['MEDIUM CLASS', 'MEDIUM', 'TACTICAL & VIRAL'],
  goreBehemoth: ['HEAVY CLASS', 'HEAVY', 'ARMOUR & DESTRUCTION'],
};
const CLASS_TONE: Record<ClassId, string> = { venomWraith: 'wraith', neuroInfiltrator: 'infiltrator', goreBehemoth: 'behemoth' };
const ORDER: ClassId[] = ['venomWraith', 'neuroInfiltrator', 'goreBehemoth'];

const unlocked = (id: ClassId) => CLASSES[id].playableFrom !== 'host';

/** Item tile markup shared by grids, previews and results. */
export function tile(item: string, count: number, rotated = false): string {
  const d = itemOf(item);
  return `<div class="tile k-${d?.kind ?? 'tech'}" style="--kc:${KIND_COLOUR[d?.kind ?? 'tech']}">${itemIcon(item, rotated)}${count > 1 ? `<b class="n">${count}</b>` : ''}</div>`;
}

/* ------------------------------------------------------------------------------------------- MAIN MENU */
export interface MenuCallbacks { go(tab: string): void; deploy(): void; quit(): void; /** Show the Flesh Market entry. */ market?: boolean; /** Show the WEAPONS entry. */ arms?: boolean }

/** The observation lens on the main menu: radius in --u, and the arcs the places and the log hang from (degrees). */
export const LENS = { r: 19.5, left: [-32, 32], right: [-42, 16], loadout: 28, release: 47 };

/** A point on the lens rim: degrees from the horizontal (positive down), on the left or right side, `gap` u outside. */
export function rim(deg: number, side: 'left' | 'right', gap = 0): { x: number; y: number } {
  const a = (deg * Math.PI) / 180, r = LENS.r + gap;
  return { x: (side === 'left' ? -1 : 1) * Math.cos(a) * r, y: Math.sin(a) * r };
}
const spread = ([a, b]: number[], n: number, i: number) => (n < 2 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));
const at = (p: { x: number; y: number }) => `--x:${p.x.toFixed(2)};--y:${p.y.toFixed(2)}`;

/** The living lens ring: a soft membrane of fibres around the aperture, a focus scale, and the specimen's names on the arc. */
function lensSvg(top: string, bottom: string): string {
  // 1000-unit box; the aperture is r 440 (LENS.r), the membrane runs out to 500.
  let fibres = '';
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2 + rnd() * 0.02, r0 = 442 + rnd() * 6, r1 = r0 + 14 + rnd() * 34, bend = (rnd() - 0.5) * 0.05;
    const p = (r: number, d: number) => `${(500 + Math.cos(a + d) * r).toFixed(1)} ${(500 + Math.sin(a + d) * r).toFixed(1)}`;
    fibres += `<path d="M${p(r0, 0)}Q${p((r0 + r1) / 2, bend)} ${p(r1, bend * 1.6)}" style="--o:${(0.08 + rnd() * 0.22).toFixed(2)}"/>`;
  }
  let ticks = '';
  for (let d = -62; d <= -28; d += 2) {
    const a = (d * Math.PI) / 180, long = d % 10 === 0;
    ticks += `<line x1="${(500 + Math.cos(a) * 452).toFixed(1)}" y1="${(500 + Math.sin(a) * 452).toFixed(1)}" x2="${(500 + Math.cos(a) * (long ? 474 : 464)).toFixed(1)}" y2="${(500 + Math.sin(a) * (long ? 474 : 464)).toFixed(1)}"${long ? ' class="long"' : ''}/>`;
  }
  return `<svg class="lens" viewBox="0 0 1000 1000" aria-hidden="true">
    <defs>
      <radialGradient id="lens-membrane"><stop offset="86%" style="stop-color:var(--background);stop-opacity:0"/><stop offset="88.5%" style="stop-color:var(--wetFleshDeep);stop-opacity:.55"/><stop offset="93%" style="stop-color:var(--background);stop-opacity:.85"/><stop offset="100%" style="stop-color:var(--background);stop-opacity:0"/></radialGradient>
      <path id="lens-top" d="M 36 500 A 464 464 0 0 1 964 500"/>
      <path id="lens-bottom" d="M 20 500 A 480 480 0 0 0 980 500"/>
    </defs>
    <circle class="membrane" cx="500" cy="500" r="500" fill="url(#lens-membrane)"/>
    <g class="fibres">${fibres}</g>
    <circle class="meniscus" cx="500" cy="500" r="440"/>
    <circle class="meniscus inner" cx="500" cy="500" r="432"/>
    <g class="focus">${ticks}<line class="needle" x1="${500 + Math.cos(-0.785) * 446}" y1="${500 + Math.sin(-0.785) * 446}" x2="${500 + Math.cos(-0.785) * 482}" y2="${500 + Math.sin(-0.785) * 482}"/></g>
    <text class="arc top"><textPath href="#lens-top" startOffset="50%">${esc(top)}</textPath></text>
    <text class="arc bottom"><textPath href="#lens-bottom" startOffset="50%">${esc(bottom)}</textPath></text>
  </svg>`;
}

export function mainMenu(p: ProfileView, cb: MenuCallbacks): HTMLElement {
  const el = h('div', 'scr scr-menu');
  const [used, cap] = usage('stash', p);
  const places: [string, string, string][] = [
    ['deploy', 'Deploy', 'Choose host, loadout and drop zone'],
    ['stash', 'Stash & loadout', `${used}/${cap} cells · ${p.cavity.length} items in cavities`],
    ...(cb.arms ? [['arms', 'Weapons', 'Loadout slots, grafts and the Armoury'] as [string, string, string]] : []),
    ...(cb.market ? [['vendors', 'Vendors', 'Mother Clot, the Archivist, the Gullet Broker'] as [string, string, string]] : []),
    ['host', 'Host', CLASSES[p.host].label],
    ['settings', 'Settings', 'Controls, video, audio, fullscreen'],
    ['quit', 'Quit', 'Return the host to dormancy'],
  ];
  const zone = p.zone && ZONES[p.zone] ? ZONES[p.zone].label : 'Glowmire Isle';
  const rate = p.stats.raids ? Math.round((p.stats.extracts / p.stats.raids) * 100) : 0;
  const notes: string[] = [
    `<h2>Observation log</h2>`,
    `<p><span>Raids</span><b>${p.stats.raids}</b></p>`,
    `<p><span>Extracted</span><b class="good">${p.stats.extracts}</b></p>`,
    `<p><span>Hosts lost</span><b class="bad">${p.stats.deaths}</b></p>`,
    `<p><span>Kills</span><b>${p.stats.kills}</b></p>`,
    `<p><span>Survival</span><b>${rate}%</b><i style="--v:${rate / 100}"></i></p>`,
    p.last ? `<p class="last ${p.last.result}"><span>Last raid</span><b>${p.last.result === 'extracted' ? 'Extracted' : 'Host lost'} · ${p.last.value} DNA</b></p>` : `<p class="last none"><span>Last raid</span><b>None yet</b></p>`,
    `<p><span>Stash value</span><b class="dna">${valueOf(p.stash).toLocaleString('en-US')} DNA</b></p>`,
  ];
  el.innerHTML = `
    <div class="lens-dof"></div><div class="lens-focus"></div>
    ${lensSvg(`OBSERVATION CHAMBER · ${zone.toUpperCase()} · ${p.callsign}`, `ACTIVE BIOSPECIMEN · ${CLASSES[p.host].label.toUpperCase()}`)}
    <div class="specimen">${hostPortrait(p.host)}<div class="pedestal"></div></div>
    <ul class="menu-list">${places.map(([go, name, sub], i) => `<li style="${at(rim(spread(LENS.left, places.length, i), 'left', 1.2))}"><button data-go="${go}"${i === 0 ? ' class="primary"' : ''}><span>${esc(name)}</span><small>${esc(sub)}</small><i class="node"></i></button></li>`).join('')}</ul>
    <div class="menu-record">${notes.map((n, i) => `<div class="note" style="${at(rim(spread(LENS.right, notes.length, i), 'right', 1.6))}">${n}</div>`).join('')}
      <div class="note loadout" style="${at(rim(LENS.loadout, 'right', 1.6))}"><span>Carrying <em>${valueOf(p.cavity).toLocaleString('en-US')} DNA at risk</em></span>
        <div class="tiles">${p.cavity.map((c) => tile(c.item, c.count)).join('') || '<i class="none">Cavities empty</i>'}${p.gutPouch.length ? `<b class="sep">POUCH</b>${p.gutPouch.map((c) => tile(c.item, c.count)).join('')}` : ''}</div></div>
    </div>`;
  // Release: a seed-shaped control on the lower rim, the one way out of the Hive.
  const go = h<HTMLButtonElement>('button', 'lens-go', `<i class="seed">${glyph('play')}</i><span>Enter the zone<small>${glyph('warn')}PvPvE · death loses your loadout</small></span>`);
  go.dataset.go = 'deploy';
  go.setAttribute('style', at(rim(LENS.release, 'right', 5.5)));
  el.append(go, keyHints([['ENTER', 'DEPLOY'], ['S', 'STASH'], ['H', 'HOST'], ...(cb.market ? [['M', 'VENDORS'] as [string, string]] : []), ['F', 'FULLSCREEN'], ['ESC', 'BACK']]));
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!b) return;
    const g = b.dataset.go!;
    if (g === 'deploy') cb.deploy(); else if (g === 'quit') cb.quit(); else cb.go(g);
  });
  return el;
}

/* ----------------------------------------------------------------------------------------- HOST SELECT */
export function hostSelect(p: ProfileView, cb: { pick(id: ClassId): void; next(): void }): HTMLElement {
  const el = h('div', 'scr scr-host');
  const cards = h('div', 'host-cards');
  for (const id of ORDER) {
    const c = CLASSES[id];
    const tr = classTraits(id);
    const open = unlocked(id);
    const [slot, type, role] = TYPE[id];
    const selected = p.host === id;
    const card = h('article', `host-card ${CLASS_TONE[id]}${selected ? ' selected' : ''}${open ? '' : ' locked'}`);
    card.dataset.host = id;
    const evo = EVOLUTIONS[id];
    card.innerHTML = `
      <div class="cls-slot"><span>${slot}</span><em>${open ? (selected ? 'ACTIVE' : 'AVAILABLE') : 'GESTATING'}</em></div>
      <h3>${esc(c.label.toUpperCase())}</h3>
      <div class="type">CLASS TYPE: <b>${type}</b> (${role})</div>
      <div class="portrait">${hostPortrait(id, { locked: !open })}${open ? '' : `<div class="lock">${glyph('lock')}<span>Still gestating</span><small>Playable in the next update</small></div>`}</div>
      <div class="traits">
        <div class="buffs"><h4>BUFFS (+)</h4><ul>${tr.buffs.slice(0, 4).map(([g, t]) => `<li>${glyph(g)}${esc(t)}</li>`).join('')}</ul></div>
        <div class="negs"><h4>NEGATIVES (−)</h4><ul>${tr.negatives.slice(0, 4).map(([g, t]) => `<li>${glyph(g)}${esc(t)}</li>`).join('')}</ul></div>
      </div>
      <div class="meters">
        ${meter('MOBILITY', 'speed', c.moveSpeed / CLASSES.venomWraith.moveSpeed, c.moveSpeed > 6 ? 'MAX' : c.moveSpeed > 4 ? 'MID' : 'LOW', c.moveSpeed > 6 ? 'good' : c.moveSpeed < 4 ? 'bad' : 'mid')}
        ${meter('BIOMASS', 'health', c.biomass / CLASSES.goreBehemoth.biomass, String(c.biomass), c.biomass >= 300 ? 'good' : c.biomass < 150 ? 'bad' : 'mid')}
        ${meter('STEALTH', 'stealth', (c.stealth + 0.5) / 1, c.stealth > 0 ? 'HIGH' : c.stealth < 0 ? 'NONE' : 'MID', c.stealth > 0 ? 'good' : c.stealth < 0 ? 'bad' : 'mid')}
      </div>
      <div class="evo"><h4>PROGRESSION & UNLOCKS</h4>
        <div class="evo-track">${evo.map((e) => `<div class="node">${glyph('lock')}<span>${esc(e.name)}<br/><em>Unlocks at level ${e.lvl}</em></span></div>`).join('<i class="vein"></i>')}</div>
        <small>${open ? `This host is level ${p.classLevels?.[id] ?? 1}. Raids earn it experience and open its signature guns in the Armoury.` : 'Evolves once this host can be played.'}</small>
      </div>`;
    cards.append(card);
  }
  el.append(cards);
  // Stash preview strip (ref 02 bottom row).
  const viral = p.stash.filter((s) => itemOf(s.item)?.kind === 'virus' || itemOf(s.item)?.kind === 'mutagen');
  const loot = p.stash.filter((s) => !viral.includes(s));
  const [used, cap] = usage('stash', p);
  el.insertAdjacentHTML('beforeend', `
    <div class="preview">
      <div class="strip"><span class="vlabel">VIRUSES & GENES</span><div class="pv-grid">${viral.slice(0, 8).map((s) => tile(s.item, s.count)).join('') || '<em>No strains yet</em>'}</div></div>
      <div class="strip"><span class="vlabel">EXTRACTED LOOT</span><h5>STASH CONTAINER (${used}/${cap} CELLS)</h5><div class="pv-grid">${loot.slice(0, 10).map((s) => tile(s.item, s.count)).join('') || '<em>Empty</em>'}</div></div>
    </div>`);
  const go = cta('CONFIRM HOST', 'NEXT: STASH & LOADOUT');
  el.append(go, keyHints([['←/→', 'BROWSE'], ['ENTER', 'CONFIRM'], ['ESC', 'BACK']]));
  cards.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.host-card');
    if (card && !card.classList.contains('locked')) cb.pick(card.dataset.host as ClassId);
  });
  go.addEventListener('click', () => cb.next());
  return el;
}

/* ----------------------------------------------------------------------------------------- RAID SELECT */
export interface RaidPlan { threat: number; hostiles: { type: string; count: number }[]; pods: number; nests: number }

/** Threat and roster summary from raid.json (Spore spawns plus the Larva additions). */
export function raidPlan(): RaidPlan {
  const larva = RAID.larva;
  const groups = [...RAID.spawnGroups, ...(larva?.spawnGroups ?? [])];
  const by = new Map<string, number>();
  for (const g of groups) by.set(g.type, (by.get(g.type) ?? 0) + g.count);
  const hostiles = [...by].map(([type, count]) => ({ type, count }));
  const total = hostiles.reduce((s, x) => s + x.count, 0) + (larva?.nests?.length ?? 0) * 6;
  return { threat: Math.min(5, Math.max(1, Math.round(total / 5))), hostiles, pods: (larva?.containers ?? RAID.containers).length, nests: larva?.nests?.length ?? 0 };
}

const NAMES: Record<string, string> = { needlemaw: 'Needlemaw', bilecantor: 'Bile Cantor', glasswalker: 'Glasswalker', oculimoth: 'Oculimoth', mournback: 'Mournback' };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** The zone this build deploys into (Zone 7 is Glowmire Isle). */
export const LIVE_ZONE = 'glowmireIsle';

/** Plain-words access requirement for a zone (zones.json `access`), when Gameplay's zone list is not there. */
export function zoneAccess(access: string): string {
  return access === 'open' ? 'OPEN' : accessReason(access).toUpperCase();
}

const accessReason = (access: string) => plainLock(access.split(/\s+or\s+/).map((alt) => {
  const c = /^contract (\w+)/.exec(alt);
  return c ? `finish ${CONTRACTS.find((k) => k.id === c[1])?.title ?? c[1]}` : alt;
}).join(' or '));

/**
 * Why a zone is shut, in a player's words (Gameplay's reasons are terse and name milestones): "Unlocks at host level 5
 * or when you finish the contract The Reliquary", "Not open yet: its map is still being built".
 */
export function plainLock(reason: string): string {
  const r = reason.trim();
  if (/^apex$|^arrives in /i.test(r)) return 'Not open yet: it arrives in a later update';
  if (/map is still growing/i.test(r)) return 'Not open yet: its map is still being built';
  const parts = r.split(/\s+or\s+/).map((alt) => {
    const lvl = /level\s+(\d+)/i.exec(alt);
    if (lvl) return `at host level ${lvl[1]}`;
    const fin = /^finish\s+(.+)$/i.exec(alt);
    if (fin) return `when you finish the contract ${fin[1].replace(/\s*\(.*\)$/, '')}`;
    return alt;
  });
  return `Unlocks ${parts.join(' or ')}`;
}

/** The zone roster in travel order: open zones first-class, the rest show what opens them. */
export function zoneRoster(open: (id: string) => boolean = (id) => ZONES[id]?.access === 'open') {
  return Object.entries(ZONES).sort(([, a], [, b]) => a.order - b.order).map(([id, z]) => ({
    id, label: z.label, order: z.order, threat: z.threat, raidTime: z.raidTime ?? null, boss: z.boss ? BOSSES[z.boss]?.label ?? z.boss : null,
    open: open(id), access: zoneAccess(z.access), pitch: z.pitch,
  }));
}

interface ZoneCallbacks { notice?(msg: string, tone?: string): void; zones?(): ZoneView[]; selectZone?(id: string): boolean; changed?(): void }

/** A shut zone the player is looking at (its map and details show; Deploy says why it cannot go). Cleared on a pick. */
let preview: string | null = null;

function zoneRow(current: string, shown: string, cb: ZoneCallbacks): HTMLElement {
  const row = h('div', 'zones');
  // Gameplay's zoneList decides access when it is there; otherwise zones.json's `access` does.
  const live = cb.zones?.();
  const roster = zoneRoster(live ? (id) => live.find((z) => z.id === id)?.access.state === 'open' : undefined);
  for (const z of roster) {
    const why = lockWhy(z.id, live);
    const b = h<HTMLButtonElement>('button', `zone${z.open ? '' : ' locked'}${z.id === current ? ' on' : ''}${z.id === shown ? ' shown' : ''}`, `<em>${ROMAN[z.order] ?? z.order}</em>
      <div><b>${esc(z.label.toUpperCase())}</b><small>${z.open ? `<span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i >= z.threat[0] && i <= z.threat[1] ? 'on' : ''}"></i>`).join('')}</span>${z.raidTime ? fmt(z.raidTime) : ''}` : `${glyph('lock')}${esc(why ?? '')}`}</small></div>`);
    b.dataset.zone = z.id;
    b.title = z.open ? z.pitch : `${z.label}: ${why}`;
    b.addEventListener('click', () => {
      if (!z.open) { preview = z.id; cb.changed?.(); return; }
      preview = null;
      if (z.id !== current) { if (cb.selectZone?.(z.id)) cb.changed?.(); } else cb.changed?.();
    });
    row.append(b);
  }
  return row;
}

/** Why a zone is shut, or null when it is open. */
function lockWhy(id: string, live?: ZoneView[]): string | null {
  const acc = live?.find((x) => x.id === id)?.access;
  if (acc) return acc.state === 'open' ? null : plainLock(acc.reason);
  return ZONES[id]?.access === 'open' ? null : accessReason(ZONES[id]?.access ?? 'apex');
}

const firstSentence = (s: string) => (s.split(/(?<=[.;])\s/)[0] ?? s).replace(/[;.]$/, '');
const creatureName = (k: string) => ABOMINATIONS[k]?.label ?? NAMES[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** The zone's pitch cut to a short line for the map caption. */
const caption = (pitch: string) => {
  const s = pitch.split(/[:.]/)[0];
  return s.length > 58 ? `${s.slice(0, 56).replace(/\s+\S*$/, '')}…` : s;
};

export function raidSelect(p: ProfileView, cb: { deploy(): void } & ZoneCallbacks): HTMLElement {
  const el = h('div', 'scr scr-raid');
  const current = p.zone && ZONES[p.zone] ? p.zone : LIVE_ZONE;
  const live = cb.zones?.();
  if (preview && (!ZONES[preview] || !lockWhy(preview, live))) preview = null;
  const zoneId = preview ?? current;
  const zone = ZONES[zoneId];
  const why = lockWhy(zoneId, live);
  const map = zoneMap(zoneId);
  const ex = zoneExtracts(zoneId);
  const isle = zoneId === LIVE_ZONE;
  const plan = isle ? raidPlan() : null;
  const bosses = (zone.bosses ?? (zone.boss ? [zone.boss] : [])).map((b) => BOSSES[b]).filter(Boolean);
  const threat = zone.threat[1];
  const pods = zone.containers ? Object.values(zone.containers).reduce((a, b) => a + b, 0) : plan?.pods ?? 0;
  const mechanics = Object.entries(zone.mechanics ?? {}).map(([k, v]) => {
    const m = v as { note?: string; description?: string };
    const text = typeof v === 'object' && v ? m.note ?? m.description : null;
    return text ? { label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), text: firstSentence(text.replace(/\s*\([^)]*\)/g, '')).replace(/^./, (c) => c.toUpperCase()) } : null;
  }).filter(Boolean) as { label: string; text: string }[];
  // Most telling first; the panel keeps five so it never runs into Deploy.
  const mods = [
    ...bosses.map((b) => `<li class="bone">${glyph('nest')}<b>${esc(b.label)} waits in the ${esc(String(b.arena.shape ?? 'arena'))}</b><span>Wakes when ${esc(b.dormantUntil.replace(/\s*\(.*\)$/, ''))}.</span></li>`),
    ...((zone.nests ?? []).length ? [`<li class="danger">${glyph('nest')}<b>Brood Heart nest present</b><span>Wakes within range, pulses spawn waves. Kill it for the Brood Cache.</span></li>`] : []),
    ...ex.later.map((x) => `<li class="lime">${glyph('spire')}<b>${esc(x.label)} ${x.opensAt ? `opens at ${fmt(x.opensAt)}` : 'opens later'}</b><span>${x.opensAt ? 'Routes and timing shift mid-raid.' : 'Only once its condition is met in the raid.'}</span></li>`),
    ...mechanics.slice(0, 2).map((m) => `<li class="cyan">${glyph('warn')}<b>${esc(m.label)}</b><span>${esc(m.text)}.</span></li>`),
    ...(isle && RAID.larva?.corpseHarvest ? [`<li class="cyan">${glyph('dna')}<b>Corpse harvesting</b><span>Hold E on a dead Abomination to cut out its organ.</span></li>`] : []),
    ...(zone.lootFocus ? [`<li class="violet">${glyph('virus')}<b>Worth taking</b><span>${esc(zone.lootFocus.charAt(0).toUpperCase() + zone.lootFocus.slice(1))}.</span></li>`] : []),
  ];
  const legend = [
    ex.count ? `<li class="spire">${glyph('spire')}Extract</li>` : '',
    bosses.length && map.marks.some((m) => m.kind === 'boss') ? `<li class="nest">${glyph('nest')}Boss lair</li>` : '',
    map.marks.some((m) => m.kind === 'nest') ? `<li class="nest">${glyph('nest')}Brood Heart nest</li>` : '',
    map.marks.some((m) => m.kind === 'pod') ? `<li class="pod">${glyph('pod')}Bio-Pod</li>` : '',
    map.marks.some((m) => m.kind === 'drop') ? `<li class="drop">${glyph('play')}Your drop point</li>` : '',
  ].join('');
  el.innerHTML = `
    <div class="orbit${why ? ' shut' : ''}" data-zone="${zoneId}"><canvas width="1100" height="1100" data-zone="${zoneId}"></canvas>
      <div class="orbit-label${zone.label.length > 18 ? ' long' : ''}"><b>${esc((isle ? 'Zone 7' : zone.label.replace(/^The /, '')).toUpperCase())}</b><span>${esc(caption(zone.pitch).toUpperCase())}</span></div>
      ${map.shape === 'uncharted' ? '<div class="uncharted">Uncharted<small>No survey of this zone yet</small></div>' : ''}
      <ul class="legend">${legend}</ul>
    </div>`;
  const open = cb.zones ? (cb.zones() ?? []).filter((z) => z.access.state === 'open').length : zoneRoster().filter((z) => z.open).length;
  const info = panel('raid-info', `EXCLUSION ZONE: ${zone.label.toUpperCase()}`, why ?? `${open} of ${Object.keys(ZONES).length} zones open`);
  if (why) info.classList.add('shut');
  info.insertAdjacentHTML('beforeend', `
    <div class="threat"><span>THREAT LEVEL</span><div class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i >= zone.threat[0] && i <= threat ? 'on' : ''}"></i>`).join('')}</div><b>${['', 'LOW', 'GUARDED', 'HIGH', 'SEVERE', 'EXTREME'][threat]}</b></div>
    <dl class="raidfacts">
      <div><dt>RAID TIME</dt><dd>${zone.raidTime ? fmt(zone.raidTime) : '?'}</dd></div>
      <div><dt>ZONE COLLAPSE WARNING</dt><dd>${fmt(RAID.zoneCollapse.warningAt)} left</dd></div>
      <div><dt>CONTAINERS</dt><dd>${pods || '?'}</dd></div>
      <div><dt>EXTRACTS</dt><dd>${ex.count || '?'}</dd></div>
    </dl>
    <h3>ACTIVE MODIFIERS</h3>
    <ul class="mods">${mods.slice(0, 5).join('')}
    </ul>
    <h3>KNOWN ABOMINATIONS</h3>
    <ul class="roster">${plan ? plan.hostiles.map((x) => `<li><span>${esc(creatureName(x.type))}</span><b>×${x.count}</b></li>`).join('')
      : (zone.creatures ?? []).map((k) => `<li><span>${esc(creatureName(k))}</span></li>`).join('') || '<li><span>Unknown</span></li>'}</ul>`);
  el.append(info, zoneRow(current, zoneId, cb));
  el.insertAdjacentHTML('beforeend', `
    <div class="squad"><h3>HIVE-MIND SQUAD</h3>
      <div class="sq-slots"><div class="sq you">${hostPortrait(p.host)}<span>${esc(p.callsign)}</span></div>
      <div class="sq off">${glyph('lock')}<span>SQUAD UP IN HIVE-MIND</span></div><div class="sq off">${glyph('lock')}<span>SQUAD UP IN HIVE-MIND</span></div></div></div>
    <div class="loadout-sum"><h3>CARRYING IN</h3><div class="pv-grid">${p.cavity.map((s) => tile(s.item, s.count)).join('') || '<em>Cavities empty: innate Synapse Burster only</em>'}</div>
      <p>${glyph('warn')} Cavity contents are lost if the host dies. Gut pouch survives.</p></div>`);
  const go = cta(why ? 'ZONE SHUT' : 'DEPLOY', why ? why.toUpperCase() : `INTO ${zone.label.toUpperCase()} · DEATH LOSES YOUR LOADOUT`, 'deploy');
  go.disabled = !!why;
  el.append(go, keyHints([['ENTER', 'DEPLOY'], ['ESC', 'BACK']]));
  go.addEventListener('click', () => { if (!go.disabled) cb.deploy(); });
  drawOrbit(q<HTMLCanvasElement>(el, 'canvas'));
  return el;
}

/** The zone map disc. HiveUI animates it by calling drawOrbit with a time; the zone comes from the canvas. */
export function drawOrbit(cv: HTMLCanvasElement, t = 0): void {
  const c = cv.getContext('2d');
  if (!c) return;
  const map = zoneMap(cv.dataset.zone ?? LIVE_ZONE);
  const W = cv.width, cx = W / 2, cy = W / 2, R = W * 0.36;
  const [inner, outer, ink] = map.tone;
  c.clearRect(0, 0, W, W);
  // Halo and orbital rings.
  const halo = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.45);
  halo.addColorStop(0, `${ink}30`); halo.addColorStop(0.5, `${ink}0c`); halo.addColorStop(1, `${ZONE7.void}00`);
  c.fillStyle = halo; c.beginPath(); c.arc(cx, cy, R * 1.45, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    c.save(); c.rotate(t * (0.03 + i * 0.012) * (i % 2 ? -1 : 1) + i);
    c.strokeStyle = i % 2 ? `${ORGANIC.mist}38` : `${HIVE.bone}30`; c.lineWidth = 1; c.setLineDash([2 + i * 3, 8 + i * 4]);
    c.beginPath(); c.ellipse(0, 0, R * (1.12 + i * 0.09), R * (1.12 + i * 0.09) * (0.94 - i * 0.03), 0, 0, Math.PI * 2); c.stroke();
    c.restore();
  }
  c.setLineDash([]);
  c.restore();
  const k = R / map.radius;
  const P = (x: number, z: number): [number, number] => [cx + x * k, cy + z * k];
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Ground.
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
  const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, inner); g.addColorStop(0.6, map.shape === 'isle' ? ZONE7_SHADE.rock : outer); g.addColorStop(1, outer);
  c.fillStyle = map.shape === 'hull' || map.shape === 'uncharted' ? outer : g; c.fillRect(0, 0, W, W);
  if (map.shape === 'isle' || map.shape === 'fen' || map.shape === 'uncharted') {
    // Drifting mist (psych-wave clouds on the isle, fog over the fen, nothing known elsewhere).
    for (let i = 0; i < 9; i++) {
      c.strokeStyle = map.shape === 'isle' ? [ORGANIC.mist, ZONE7.cyan, HIVE.bone, ORGANIC.amber][i % 4] : [ink, HIVE.bone][i % 2];
      c.globalAlpha = (map.shape === 'uncharted' ? 0.05 : 0.09) + 0.04 * Math.sin(t * 0.8 + i);
      c.lineWidth = 2 + (i % 3) * 2;
      c.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr = R * (0.12 + i * 0.1) + Math.sin(a * (2 + (i % 3)) + t * 0.4 + i * 1.7) * R * 0.05;
        const x = cx + Math.cos(a + t * 0.05 * (i % 2 ? 1 : -1)) * rr, y = cy + Math.sin(a) * rr * 0.96;
        if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  if (map.shape === 'desert') {
    // Dune ripples: long soft waves that drift with the wind.
    c.strokeStyle = ink; c.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      c.globalAlpha = 0.08 + 0.05 * Math.sin(i * 1.3);
      const y0 = cy - R + (i / 26) * R * 2;
      c.beginPath();
      for (let x = cx - R; x <= cx + R; x += 8) c.lineTo(x, y0 + Math.sin(x * 0.012 + i * 0.9 + t * 0.15) * R * 0.03);
      c.stroke();
    }
  }
  if (map.shape === 'fen') {
    // Water channels: dark pools with a moss sheen.
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.9;
      c.fillStyle = FAUNA.water; c.globalAlpha = 0.5;
      c.beginPath(); c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.05 + rnd() * 0.08), R * (0.03 + rnd() * 0.05), rnd() * 3, 0, Math.PI * 2); c.fill();
    }
  }
  if (map.shape === 'pit' && map.layers) {
    // Depth layers: each shelf a ring, darker and greener toward the bottom.
    map.layers.forEach((l, i) => {
      const rr = l.r * k;
      const lg = c.createRadialGradient(cx, cy, rr * 0.6, cx, cy, rr);
      lg.addColorStop(0, i === map.layers!.length - 1 ? `${ink}66` : `${FAUNA.soot}`); lg.addColorStop(1, i ? `${ZONE7_SHADE.rockDeep}` : `${FAUNA.rope}44`);
      c.globalAlpha = 0.9; c.fillStyle = lg; c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.5; c.strokeStyle = HIVE.bone; c.lineWidth = 1; c.setLineDash([3, 6]); c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    });
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.3);
    glow.addColorStop(0, `${ink}${Math.round(0x40 + 0x20 * Math.sin(t)).toString(16)}`); glow.addColorStop(1, `${ink}00`);
    c.globalAlpha = 1; c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, R * 0.3, 0, Math.PI * 2); c.fill();
  }
  if (map.shape === 'hull' && map.rooms) {
    // The wreck's plan: the hull seen from above, its rooms in order from prow to reactor.
    for (const r of map.rooms) {
      const [x0, y0] = P(r.x0, r.z0), [x1, y1] = P(r.x1, r.z1);
      c.globalAlpha = 0.85; c.fillStyle = inner; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.globalAlpha = 0.5; c.strokeStyle = HIVE.bone; c.lineWidth = 1; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  // Fungal glow specks (or dust).
  if (map.shape !== 'hull') {
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
      c.fillStyle = map.shape === 'isle' ? [HIVE.bone, ZONE7.cyan, ORGANIC.amber][i % 3] : i % 2 ? HIVE.bone : ink;
      c.globalAlpha = (map.shape === 'isle' ? 0.15 : 0.06) + (map.shape === 'isle' ? 0.35 : 0.14) * Math.abs(Math.sin(t * 1.3 + i));
      c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 2.2, 0, Math.PI * 2); c.fill();
    }
  }
  c.globalAlpha = 1;
  // Terminator shading.
  const sh = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  sh.addColorStop(0, `${ZONE7.void}00`); sh.addColorStop(0.65, `${ZONE7.void}33`); sh.addColorStop(1, `${ZONE7.void}dd`);
  c.fillStyle = sh; c.fillRect(0, 0, W, W);
  c.restore();
  // Rim.
  c.strokeStyle = `${HIVE.bone}88`; c.lineWidth = 1.2;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  // Compass ticks.
  c.fillStyle = HIVE.bone; c.font = `600 ${W * 0.026}px "Cormorant Garamond", serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let b = 0; b < 360; b += 10) {
    const a = (b - 90) * (Math.PI / 180), r1 = R * 1.03, r2 = R * (b % 90 ? 1.05 : 1.09);
    c.strokeStyle = `${HIVE.bone}${b % 90 ? '55' : 'cc'}`; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
    if (b % 90 === 0) c.fillText(['N', 'E', 'S', 'W'][b / 90], cx + Math.cos(a) * R * 1.14, cy + Math.sin(a) * R * 1.14);
  }
  // Markers.
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const ring = (x: number, y: number, col: string, r: number) => {
    c.strokeStyle = col; c.globalAlpha = 0.25 + pulse * 0.4; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r + pulse * 8, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
  };
  const label = (x: number, y: number, text: string, col: string, size = 0.015) => {
    c.font = `600 ${W * size}px "Manrope", sans-serif`; c.fillStyle = col; c.shadowColor = HIVE.background; c.shadowBlur = 6;
    c.fillText(text, x, y); c.shadowBlur = 0;
  };
  // Area names stay quiet and give way to anything marked in them (a boss lair, an extract).
  const marked = map.marks.filter((x) => x.kind === 'boss' || x.kind === 'extract');
  for (const m of map.marks.filter((x) => x.kind === 'site' && !marked.some((b) => Math.hypot(x.x - b.x, x.z - b.z) < (x.r ?? 20) * 0.8))) {
    const [x, y] = P(m.x, m.z);
    c.strokeStyle = `${HIVE.bone}40`; c.lineWidth = 1; c.setLineDash([2, 5]);
    c.beginPath(); c.arc(x, y, (m.r ?? 20) * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    label(x, y, m.label.toUpperCase(), `${HIVE.bone}99`, 0.012);
  }
  if (map.shape === 'hull') for (const r of map.rooms ?? []) {
    // Room names only where they fit inside the room and nothing else is marked there.
    const [x, y] = P((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    c.font = `600 ${W * 0.011}px "Manrope", sans-serif`;
    if (c.measureText(r.label.toUpperCase()).width < (r.x1 - r.x0) * k - 6 && !marked.some((b) => b.x >= r.x0 && b.x <= r.x1 && b.z >= r.z0 && b.z <= r.z1)) label(x, y, r.label.toUpperCase(), `${HIVE.bone}99`, 0.011);
  }
  if (map.shape === 'pit') for (const l of map.layers ?? []) { const [x, y] = P(0, -l.r); label(x, y + 14, l.label.toUpperCase(), `${HIVE.bone}aa`, 0.012); }
  for (const m of map.marks) {
    const [x, y] = P(m.x, m.z);
    if (m.kind === 'pod') {
      c.fillStyle = PATH.dna; c.shadowColor = PATH.dna; c.shadowBlur = 4;
      c.beginPath(); c.ellipse(x, y, 6, 9, 0, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      if (m.guard) label(x, y + 22, 'GUARDED', PATH.dna);
    } else if (m.kind === 'nest' || m.kind === 'boss') {
      ring(x, y, HIVE.danger, m.kind === 'boss' ? 24 : 18);
      c.fillStyle = HIVE.danger; c.shadowColor = HIVE.danger; c.shadowBlur = 6;
      c.beginPath(); c.arc(x, y, m.kind === 'boss' ? 8 : 10, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      label(x, y + (m.kind === 'boss' ? 38 : -30), m.label, HIVE.danger);
    } else if (m.kind === 'extract') {
      ring(x, y, HIVE.acid, 14);
      c.strokeStyle = HIVE.acid; c.lineWidth = 2; c.shadowColor = HIVE.acid; c.shadowBlur = 4;
      c.beginPath(); c.moveTo(x, y - 12); c.lineTo(x + 9, y); c.lineTo(x, y + 12); c.lineTo(x - 9, y); c.closePath(); c.stroke(); c.shadowBlur = 0;
      label(x, y - 28, `${m.label.toUpperCase()}${m.opensAt ? ` · ${fmt(m.opensAt)}` : m.opensAt === null ? ' · LATER' : ''}`, HIVE.acid);
    } else if (m.kind === 'drop') {
      c.fillStyle = ORGANIC.amber; c.shadowColor = ORGANIC.amber; c.shadowBlur = 4;
      c.beginPath(); c.moveTo(x, y - 12); c.lineTo(x + 9, y + 8); c.lineTo(x - 9, y + 8); c.closePath(); c.fill(); c.shadowBlur = 0;
      label(x, y + 26, 'DROP', ORGANIC.amber);
    }
  }
}

/* ------------------------------------------------------------------------------------------- RESULTS */
export interface ResultData {
  result: 'extracted' | 'lost';
  items: { item: string; count: number }[];
  dna: number;
  value: number;
  kills: number;
  time: number;
  cause?: string;
  kept?: { item: string; count: number }[];
  /** One line from Gameplay's settlement (DNA banked, stash overflow, gut pouch kept). */
  note?: string;
}

export function results(r: ResultData, cb: { again(): void }): HTMLElement {
  const won = r.result === 'extracted';
  // `results` is the hook tests/raid.mjs reads (`.results h1`).
  const el = h('div', `scr scr-results results ${won ? 'won' : 'lost'}`);
  el.innerHTML = `
    <div class="res-head"><h1>${won ? 'EXTRACTED' : 'HOST LOST'}</h1>
      <p>${won ? 'The Seed Spire carried your haul out of Zone 7.' : `Biomass depleted${r.cause ? ` · ${esc(r.cause)}` : ''}. Everything in your cavities is gone.`}</p>${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}</div>
    <section class="hv-panel res-items"><h2>${won ? 'MOVING TO STASH' : 'LOST WITH THE HOST'}</h2>
      <ul>${r.items.map((i, n) => `<li style="--d:${n * 0.08}s">${tile(i.item, i.count)}<span>${esc(itemOf(i.item)?.label ?? i.item)}</span><b>×${i.count}</b><em>${(itemOf(i.item)?.value ?? 0) * i.count} DNA</em></li>`).join('') || '<li class="none">Nothing carried</li>'}</ul>
      ${r.kept?.length ? `<h2 class="kept">GUT POUCH · KEPT</h2><ul>${r.kept.map((i) => `<li>${tile(i.item, i.count)}<span>${esc(itemOf(i.item)?.label ?? i.item)}</span><b>×${i.count}</b></li>`).join('')}</ul>` : ''}
    </section>
    <section class="hv-panel res-sum">
      <div class="big"><span>${won ? 'HAUL VALUE' : 'VALUE LOST'}</span><b>${won ? '+' : '−'}${r.value.toLocaleString('en-US')}</b></div>
      <dl><div><dt>KILL DNA</dt><dd>${won ? r.dna : `${r.dna} lost`}</dd></div><div><dt>KILLS</dt><dd>${r.kills}</dd></div><div><dt>RAID TIME</dt><dd>${fmt(r.time)}</dd></div></dl>
    </section>`;
  const go = cta('RETURN TO HIVE', won ? 'HAUL SECURED IN STASH' : 'DEATH LOST YOUR LOADOUT', 'deploy-again');
  el.append(go);
  go.addEventListener('click', () => cb.again());
  return el;
}

export { ORDER as HOST_ORDER };
