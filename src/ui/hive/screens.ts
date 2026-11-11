/**
 * The Hive screens (Larva flow: main menu → host select → stash & loadout → raid select → deploy; results).
 * Each screen is a pure function of ProfileView plus callbacks, so the same code drives the game and the
 * static mocks in mocks/ui.html. Layouts follow references 01 to 03 (docs/reference/).
 */
import { def as itemOf } from '../items';
import { CLASSES, RAID, VIRUSES, layoutPosition } from '../../../data';
import type { ClassId } from '../../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';
import { hostPortrait } from '../hosts';
import { glyph, itemIcon, KIND_COLOUR } from '../icons';
import { cta, esc, h, keyHints, meter, panel, q } from './kit';
import type { ProfileView } from './model';
import { usage, valueOf } from './model';

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
export interface MenuCallbacks { go(tab: string): void; deploy(): void; quit(): void; /** Show the Flesh Market entry. */ market?: boolean }

export function mainMenu(p: ProfileView, cb: MenuCallbacks): HTMLElement {
  const el = h('div', 'scr scr-menu');
  const [used, cap] = usage('stash', p);
  el.innerHTML = `
    <div class="logo"><span class="l1">BIOPHAGE</span><span class="l2">EXTRACTION</span><small>ZONE 7 · BIOLUMINESCENT PSYCH-WAVE SECTOR</small></div>
    <ul class="menu-list">
      <li><button data-go="deploy" class="primary">${glyph('play')}<span>DEPLOY</span><small>Choose host, loadout and drop zone</small></button></li>
      <li><button data-go="stash">${glyph('stash')}<span>STASH & LOADOUT</span><small>${used}/${cap} cells · ${p.cavity.length} items in cavities</small></button></li>
      ${cb.market ? `<li><button data-go="market">${glyph('dna')}<span>FLESH MARKET</span><small>Buy and sell with The Gullet Broker</small></button></li>` : ''}
      <li><button data-go="host">${glyph('virus')}<span>HOST SELECT</span><small>${esc(CLASSES[p.host].label)}</small></button></li>
      <li><button data-go="settings">${glyph('gear')}<span>SETTINGS</span><small>Controls, video, audio</small></button></li>
      <li><button data-go="quit">${glyph('quit')}<span>QUIT</span><small>Return the host to dormancy</small></button></li>
    </ul>
    <div class="specimen">${hostPortrait(p.host)}<div class="pedestal"></div><div class="tag"><b>ACTIVE BIOSPECIMEN</b>${esc(CLASSES[p.host].label.toUpperCase())}</div></div>`;
  const side = panel('menu-record', 'HOST RECORD', 'Extraction history');
  side.insertAdjacentHTML('beforeend', `
    <dl class="record">
      <div><dt>RAIDS</dt><dd>${p.stats.raids}</dd></div><div><dt>EXTRACTED</dt><dd class="good">${p.stats.extracts}</dd></div>
      <div><dt>HOSTS LOST</dt><dd class="bad">${p.stats.deaths}</dd></div><div><dt>KILLS</dt><dd>${p.stats.kills}</dd></div>
    </dl>
    <div class="survival"><span>SURVIVAL RATE</span><b>${p.stats.raids ? Math.round((p.stats.extracts / p.stats.raids) * 100) : 0}%</b><i style="--v:${p.stats.raids ? p.stats.extracts / p.stats.raids : 0}"></i></div>
    ${p.last ? `<div class="last ${p.last.result}"><span>LAST RAID</span><b>${p.last.result === 'extracted' ? 'EXTRACTED' : 'HOST LOST'}</b><em>${p.last.value} DNA</em></div>` : '<div class="last none"><span>LAST RAID</span><b>NO RAIDS YET</b><em>Zone 7 awaits</em></div>'}
    <div class="stashval"><span>STASH VALUE</span><b>${valueOf(p.stash).toLocaleString('en-US')} DNA</b></div>
    <div class="loadout"><span>LOADOUT <em>${valueOf(p.cavity).toLocaleString('en-US')} DNA AT RISK</em></span>
      <div class="tiles">${p.cavity.map((c) => tile(c.item, c.count)).join('') || '<i class="none">Cavities empty</i>'}${p.gutPouch.length ? `<b class="sep">POUCH</b>${p.gutPouch.map((c) => tile(c.item, c.count)).join('')}` : ''}</div></div>`);
  el.append(side);
  const go = cta('ENTER EXCLUSION ZONE', 'PVPVE ZONE · DEATH LOSES YOUR LOADOUT');
  go.dataset.go = 'deploy';
  el.append(go, keyHints([['ENTER', 'DEPLOY'], ['S', 'STASH'], ['H', 'HOST'], ...(cb.market ? [['M', 'MARKET'] as [string, string]] : []), ['ESC', 'BACK']]));
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
      <div class="cls-slot"><span>${slot}</span><em>${open ? (selected ? 'ACTIVE' : 'AVAILABLE') : 'EVOLVES IN HOST'}</em></div>
      <h3>${esc(c.label.toUpperCase())}</h3>
      <div class="type">CLASS TYPE: <b>${type}</b> (${role})</div>
      <div class="portrait">${hostPortrait(id, { locked: !open })}${open ? '' : `<div class="lock">${glyph('lock')}<span>EVOLVES IN HOST</span></div>`}</div>
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
        <div class="evo-track">${evo.map((e, i) => `<div class="node${open && i === 0 ? ' lit' : ''}">${open && i === 0 ? glyph('virus') : glyph('lock')}<span>Lvl ${e.lvl}:<br/>${esc(e.name)}</span></div>`).join('<i class="vein"></i>')}</div>
        <small>Strains unlock with the Synapse tree in HOST.</small>
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

export function raidSelect(p: ProfileView, cb: { deploy(): void }): HTMLElement {
  const el = h('div', 'scr scr-raid');
  const plan = raidPlan();
  const extracts = RAID.larva?.extracts ?? [{ label: RAID.extract.label, radius: RAID.extract.radius, bearing: RAID.extract.bearing, opensAt: 0 }];
  el.innerHTML = `
    <div class="orbit"><canvas width="1100" height="1100"></canvas>
      <div class="orbit-label"><b>ZONE 7</b><span>BIOLUMINESCENT PSYCH-WAVE SECTOR</span></div>
      <ul class="legend">
        <li class="spire">${glyph('spire')}Seed Spire extract</li><li class="nest">${glyph('nest')}Brood Heart nest</li>
        <li class="pod">${glyph('pod')}Bio-Pod</li><li class="drop">${glyph('play')}Your drop point</li>
      </ul>
    </div>`;
  const info = panel('raid-info', 'EXCLUSION ZONE: ZONE 7', 'The Island · 1 of 1 sectors open');
  info.insertAdjacentHTML('beforeend', `
    <div class="threat"><span>THREAT LEVEL</span><div class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= plan.threat ? 'on' : ''}"></i>`).join('')}</div><b>${['', 'LOW', 'GUARDED', 'HIGH', 'SEVERE', 'EXTREME'][plan.threat]}</b></div>
    <dl class="raidfacts">
      <div><dt>RAID TIME</dt><dd>${fmt(RAID.raidTime)}</dd></div>
      <div><dt>ZONE COLLAPSE WARNING</dt><dd>${fmt(RAID.zoneCollapse.warningAt)} left</dd></div>
      <div><dt>BIO-PODS</dt><dd>${plan.pods}</dd></div>
      <div><dt>EXTRACTS</dt><dd>${extracts.length}</dd></div>
    </dl>
    <h3>ACTIVE MODIFIERS</h3>
    <ul class="mods">
      ${plan.nests ? `<li class="danger">${glyph('nest')}<b>Brood Heart nest present</b><span>Wakes within range, pulses spawn waves. Kill it for the Brood Cache.</span></li>` : ''}
      ${extracts.filter((x) => x.opensAt > 0).map((x) => `<li class="lime">${glyph('spire')}<b>Second ${esc(x.label)} opens at ${fmt(x.opensAt)}</b><span>Bearing ${x.bearing}°. Routes and timing shift mid-raid.</span></li>`).join('')}
      ${RAID.larva?.corpseHarvest ? `<li class="cyan">${glyph('dna')}<b>Corpse harvesting</b><span>Hold E on a dead Abomination to cut out its organ.</span></li>` : ''}
      <li class="violet">${glyph('virus')}<b>Viral strains in the wild</b><span>${Object.values(VIRUSES).map((v) => esc(v.label)).join(' · ')}</span></li>
    </ul>
    <h3>KNOWN ABOMINATIONS</h3>
    <ul class="roster">${plan.hostiles.map((x) => `<li><span>${esc(NAMES[x.type] ?? x.type)}</span><b>×${x.count}</b></li>`).join('')}</ul>`);
  el.append(info);
  el.insertAdjacentHTML('beforeend', `
    <div class="squad"><h3>HIVE-MIND SQUAD</h3>
      <div class="sq-slots"><div class="sq you">${hostPortrait(p.host)}<span>${esc(p.callsign)}</span></div>
      <div class="sq off">${glyph('lock')}<span>OPENS IN HIVE</span></div><div class="sq off">${glyph('lock')}<span>OPENS IN HIVE</span></div></div></div>
    <div class="loadout-sum"><h3>CARRYING IN</h3><div class="pv-grid">${p.cavity.map((s) => tile(s.item, s.count)).join('') || '<em>Cavities empty: innate Synapse Burster only</em>'}</div>
      <p>${glyph('warn')} Cavity contents are lost if the host dies. Gut pouch survives.</p></div>`);
  const go = cta('DEPLOY', 'PVPVE ZONE · DEATH LOSES YOUR LOADOUT', 'deploy');
  el.append(go, keyHints([['ENTER', 'DEPLOY'], ['ESC', 'BACK']]));
  go.addEventListener('click', () => cb.deploy());
  drawOrbit(q<HTMLCanvasElement>(el, 'canvas'));
  return el;
}

/** Static orbital map frame. HiveMenu animates it by calling drawOrbit with a time. */
export function drawOrbit(cv: HTMLCanvasElement, t = 0): void {
  const c = cv.getContext('2d');
  if (!c) return;
  const W = cv.width, cx = W / 2, cy = W / 2, R = W * 0.36;
  c.clearRect(0, 0, W, W);
  // Halo and orbital rings.
  const halo = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.45);
  halo.addColorStop(0, `${ZONE7.violet}55`); halo.addColorStop(0.5, `${ZONE7.magenta}18`); halo.addColorStop(1, `${ZONE7.void}00`);
  c.fillStyle = halo; c.beginPath(); c.arc(cx, cy, R * 1.45, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    c.save(); c.rotate(t * (0.03 + i * 0.012) * (i % 2 ? -1 : 1) + i);
    c.strokeStyle = i % 2 ? `${ZONE7.cyan}40` : `${HIVE.acid}38`; c.lineWidth = 1.2; c.setLineDash([2 + i * 3, 8 + i * 4]);
    c.beginPath(); c.ellipse(0, 0, R * (1.12 + i * 0.09), R * (1.12 + i * 0.09) * (0.94 - i * 0.03), 0, 0, Math.PI * 2); c.stroke();
    c.restore();
  }
  c.setLineDash([]);
  c.restore();
  // Island body.
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
  const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, ZONE7_SHADE.moss); g.addColorStop(0.55, ZONE7_SHADE.rock); g.addColorStop(1, ZONE7_SHADE.rockDeep);
  c.fillStyle = g; c.fillRect(0, 0, W, W);
  // Swirling psych-wave clouds.
  for (let i = 0; i < 9; i++) {
    c.strokeStyle = [ZONE7.magenta, ZONE7.cyan, ZONE7.violet, ZONE7.lime][i % 4];
    c.globalAlpha = 0.16 + 0.06 * Math.sin(t * 0.8 + i);
    c.lineWidth = 2 + (i % 3) * 2;
    c.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
      const rr = R * (0.12 + i * 0.1) + Math.sin(a * (2 + (i % 3)) + t * 0.4 + i * 1.7) * R * 0.05;
      const x = cx + Math.cos(a + t * 0.05 * (i % 2 ? 1 : -1)) * rr, y = cy + Math.sin(a) * rr * 0.96;
      if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
  // Fungal glow specks.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
    c.fillStyle = [ZONE7.magenta, ZONE7.cyan, ZONE7.lime][i % 3];
    c.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.3 + i));
    c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 2.2, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  // Terminator shading.
  const sh = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  sh.addColorStop(0, `${ZONE7.void}00`); sh.addColorStop(0.65, `${ZONE7.void}33`); sh.addColorStop(1, `${ZONE7.void}dd`);
  c.fillStyle = sh; c.fillRect(0, 0, W, W);
  c.restore();
  // Rim.
  c.strokeStyle = HIVE.acid; c.lineWidth = 2; c.shadowColor = HIVE.acid; c.shadowBlur = 18;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke(); c.shadowBlur = 0;
  // Compass ticks.
  c.fillStyle = HIVE.bone; c.font = `600 ${W * 0.018}px "Chakra Petch", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let b = 0; b < 360; b += 10) {
    const a = (b - 90) * (Math.PI / 180), r1 = R * 1.03, r2 = R * (b % 90 ? 1.05 : 1.09);
    c.strokeStyle = `${HIVE.bone}${b % 90 ? '55' : 'cc'}`; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
    if (b % 90 === 0) c.fillText(['N', 'E', 'S', 'W'][b / 90], cx + Math.cos(a) * R * 1.14, cy + Math.sin(a) * R * 1.14);
  }
  // Markers from raid.json layout (world radius → map radius).
  const toMap = (radius: number, bearing: number): [number, number] => {
    const [x, z] = layoutPosition({ radius, bearing });
    const k = R / RAID.playableRadius;
    return [cx + x * k, cy + z * k];
  };
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const ring = (x: number, y: number, col: string, r: number) => {
    c.strokeStyle = col; c.globalAlpha = 0.25 + pulse * 0.4; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, r + pulse * 8, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
  };
  const label = (x: number, y: number, text: string, col: string) => {
    c.font = `600 ${W * 0.017}px "Chakra Petch", sans-serif`; c.fillStyle = col; c.shadowColor = HIVE.background; c.shadowBlur = 6;
    c.fillText(text, x, y); c.shadowBlur = 0;
  };
  for (const pod of RAID.larva?.containers ?? RAID.containers) {
    const [x, y] = toMap(pod.radius, pod.bearing);
    c.fillStyle = PATH.dna; c.shadowColor = PATH.dna; c.shadowBlur = 12;
    c.beginPath(); c.ellipse(x, y, 7, 10, 0, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    if (pod.guard) label(x, y + 22, 'GUARDED', PATH.dna);
  }
  for (const n of RAID.larva?.nests ?? []) {
    const [x, y] = toMap(n.radius, n.bearing);
    ring(x, y, HIVE.danger, 18);
    c.fillStyle = HIVE.danger; c.shadowColor = HIVE.danger; c.shadowBlur = 20;
    c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    label(x, y - 30, 'BROOD HEART', HIVE.danger);
  }
  const ex = RAID.larva?.extracts ?? [{ label: RAID.extract.label, radius: RAID.extract.radius, bearing: RAID.extract.bearing, opensAt: 0 }];
  for (const e of ex) {
    const [x, y] = toMap(e.radius, e.bearing);
    ring(x, y, ZONE7.lime, 14);
    c.strokeStyle = ZONE7.lime; c.lineWidth = 3; c.shadowColor = ZONE7.lime; c.shadowBlur = 14;
    c.beginPath(); c.moveTo(x, y - 12); c.lineTo(x + 9, y); c.lineTo(x, y + 12); c.lineTo(x - 9, y); c.closePath(); c.stroke(); c.shadowBlur = 0;
    label(x, y - 28, e.opensAt ? `SPIRE · ${fmt(e.opensAt)}` : 'SEED SPIRE', ZONE7.lime);
  }
  const [sx, sy] = toMap(RAID.spawn.radius, RAID.spawn.bearing);
  c.fillStyle = HIVE.acid; c.shadowColor = HIVE.acid; c.shadowBlur = 16;
  c.beginPath(); c.moveTo(sx, sy - 12); c.lineTo(sx + 9, sy + 8); c.lineTo(sx - 9, sy + 8); c.closePath(); c.fill(); c.shadowBlur = 0;
  label(sx, sy + 26, 'DROP', HIVE.acid);
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
