/**
 * Code-generated item and UI icons (SVG strings). No bitmap art: every icon is drawn here from the palette,
 * so items read at a glance in the stash, the cavities and loot toasts. One cell = 64 px; an icon's
 * viewBox follows the item's footprint from data/loot.json, so a 2x2 organ fills its four cells.
 */
import { LOOT } from '../../data';
import type { ItemKind } from '../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';

export const CELL = 64;
let uid = 0;

/** Colour that marks each kind of item everywhere in the UI (borders, chips, rarity glow). */
export const KIND_COLOUR: Record<ItemKind, string> = {
  consumable: HIVE.acid,
  currency: PATH.dna,
  mutagen: ZONE7.lime,
  virus: PATH.viral,
  tech: ZONE7.cyan,
  organ: ZONE7.magenta,
};

interface Ctx { w: number; h: number; id: string }

const defs = (c: Ctx, body: string) => `<defs>
  <filter id="g${c.id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="s${c.id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${HIVE.background}" flood-opacity=".8"/></filter>
  ${body}</defs>`;

const radial = (id: string, stops: [number, string, number?][], cx = '40%', cy = '35%') =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="70%">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const linear = (id: string, stops: [number, string, number?][], x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

/** Glass vial with a coloured culture, cork of chitin and a floating payload (viruses, mutagen). */
function vial(c: Ctx, liquid: string, payload: string): string {
  const cx = c.w / 2;
  return defs(c, linear(`l${c.id}`, [[0, liquid, 0.95], [1, liquid, 0.45]]) + linear(`gl${c.id}`, [[0, HIVE.bone, 0.35], [0.5, HIVE.bone, 0.04], [1, HIVE.bone, 0.2]], 1, 0))
    + `<g filter="url(#s${c.id})">
      <rect x="${cx - 13}" y="14" width="26" height="${c.h - 26}" rx="11" fill="${HIVE.background}" fill-opacity=".55" stroke="${HIVE.bone}" stroke-opacity=".7" stroke-width="1.5"/>
      <rect x="${cx - 11}" y="${c.h * 0.36}" width="22" height="${c.h * 0.64 - 14}" rx="9" fill="url(#l${c.id})" filter="url(#g${c.id})"/>
      ${payload}
      <rect x="${cx - 13}" y="14" width="26" height="${c.h - 26}" rx="11" fill="url(#gl${c.id})"/>
      <path d="M${cx - 15} 8 h30 l-3 9 h-24z" fill="${HIVE.bone}" stroke="${ZONE7_SHADE.rockDeep}" stroke-width="1"/>
      <path d="M${cx - 9} 10 v5 M${cx} 9 v6 M${cx + 9} 10 v5" stroke="${ZONE7_SHADE.rockDeep}" stroke-width="1.2"/>
    </g>`;
}

/** A spiky virion drawn at (x, y). */
const virion = (x: number, y: number, r: number, col: string, spikes = 10) => {
  let s = '';
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    s += `<line x1="${x + Math.cos(a) * r}" y1="${y + Math.sin(a) * r}" x2="${x + Math.cos(a) * r * 1.55}" y2="${y + Math.sin(a) * r * 1.55}" stroke="${col}" stroke-width="1.6"/><circle cx="${x + Math.cos(a) * r * 1.6}" cy="${y + Math.sin(a) * r * 1.6}" r="1.6" fill="${col}"/>`;
  }
  return `${s}<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" fill-opacity=".35" stroke="${col}" stroke-width="1.5"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.35}" fill="${HIVE.bone}" fill-opacity=".6"/>`;
};

const DRAW: Record<string, (c: Ctx) => string> = {
  clotGel: (c) => defs(c, radial(`r${c.id}`, [[0, ZONE7.magenta], [0.55, HIVE.danger], [1, ZONE7_SHADE.rockDeep]]))
    + `<g filter="url(#s${c.id})"><path d="M32 10 C46 12 54 24 52 36 C50 50 40 56 30 54 C16 52 10 40 13 28 C15 18 22 9 32 10Z" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5"/>
      <path d="M20 26 C24 20 30 18 36 19" stroke="${HIVE.bone}" stroke-opacity=".7" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M24 40 q8 6 18 -2" stroke="${HIVE.acid}" stroke-width="1.6" fill="none" filter="url(#g${c.id})"/>
      <circle cx="40" cy="30" r="3" fill="${HIVE.acid}" filter="url(#g${c.id})"/><circle cx="26" cy="34" r="2" fill="${HIVE.acid}"/></g>`,

  dnaStrand: (c) => {
    let rungs = '';
    for (let i = 0; i < 9; i++) {
      const y = 10 + i * 5.4, ph = i * 0.75, x1 = 32 + Math.sin(ph) * 14, x2 = 32 - Math.sin(ph) * 14;
      rungs += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${HIVE.bone}" stroke-opacity=".55" stroke-width="1.5"/><circle cx="${x1}" cy="${y}" r="2.6" fill="${PATH.dna}"/><circle cx="${x2}" cy="${y}" r="2.6" fill="${ZONE7.magenta}"/>`;
    }
    return defs(c, '') + `<g filter="url(#g${c.id})"><path d="M18 8 C46 18 46 32 18 44 S46 58 46 58" stroke="${PATH.dna}" stroke-width="2" fill="none" opacity=".6"/>${rungs}</g>
      <path d="M12 52 h40" stroke="${HIVE.bone}" stroke-width="3" stroke-linecap="round" opacity=".7"/>`;
  },

  mutagenVial: (c) => vial(c, ZONE7.lime, `<circle cx="${c.w / 2 - 3}" cy="${c.h * 0.6}" r="3" fill="${HIVE.bone}" opacity=".8"/><circle cx="${c.w / 2 + 4}" cy="${c.h * 0.72}" r="2" fill="${HIVE.bone}" opacity=".6"/><circle cx="${c.w / 2}" cy="${c.h * 0.48}" r="1.6" fill="${HIVE.bone}" opacity=".7"/>`),
  plagueStalkerStrain: (c) => vial(c, PATH.viral, virion(c.w / 2, c.h * 0.62, 6, HIVE.acid, 9)),
  adrenalineVirus: (c) => vial(c, PATH.melee, virion(c.w / 2, c.h * 0.62, 5.5, HIVE.danger, 8) + `<path d="M${c.w / 2 - 6} ${c.h * 0.42} l4 -6 l3 5 l4 -8" stroke="${HIVE.bone}" stroke-width="1.6" fill="none"/>`),
  splicedParasites: (c) => vial(c, ZONE7.cyan, [0, 1, 2].map((i) => `<path d="M${c.w / 2 - 7 + i * 5} ${c.h * 0.5 + i * 9} q4 -6 7 0 t7 0" stroke="${HIVE.bone}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`).join('')),

  synapseLens: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.bone], [0.3, ZONE7.cyan], [1, ZONE7.violet]]) + linear(`m${c.id}`, [[0, ZONE7_SHADE.stem], [1, ZONE7_SHADE.rockDeep]]))
    + `<g filter="url(#s${c.id})"><path d="M10 32 C10 18 26 12 40 14 L100 22 C114 24 118 40 104 44 L40 52 C26 54 10 46 10 32Z" fill="url(#m${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5"/>
      <path d="M44 20 L100 26 M44 46 L100 40" stroke="${ZONE7.cyan}" stroke-opacity=".5"/>
      <circle cx="32" cy="32" r="15" fill="url(#r${c.id})" filter="url(#g${c.id})"/><circle cx="32" cy="32" r="6" fill="${ZONE7_SHADE.rockDeep}"/>
      <path d="M70 26 l6 6 l-6 6 l-6 -6z M90 28 l4 4 l-4 4 l-4 -4z" fill="${ZONE7.cyan}" filter="url(#g${c.id})"/></g>`,

  glitchingHeart: (c) => defs(c, radial(`r${c.id}`, [[0, ZONE7.magenta], [0.6, ZONE7_SHADE.flesh], [1, ZONE7_SHADE.rockDeep]]))
    + `<g filter="url(#s${c.id})"><path d="M64 112 C30 92 14 70 18 46 C22 26 44 20 58 34 C62 22 76 14 92 20 C114 30 114 64 96 84 C86 96 74 104 64 112Z" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".45" stroke-width="1.5"/>
      <path d="M50 30 C52 16 60 8 66 6 M74 22 C80 10 90 8 96 10" stroke="${HIVE.bone}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".75"/>
      <path d="M30 56 C46 50 56 66 70 58 S96 50 102 60" stroke="${ZONE7.cyan}" stroke-width="2" fill="none" filter="url(#g${c.id})"/>
      <rect x="24" y="66" width="44" height="5" fill="${ZONE7.cyan}" opacity=".7"/><rect x="58" y="78" width="40" height="4" fill="${HIVE.acid}" opacity=".6"/><rect x="36" y="44" width="30" height="3" fill="${ZONE7.magenta}"/>
      <circle cx="78" cy="48" r="6" fill="${ZONE7.cyan}" filter="url(#g${c.id})"/></g>`,

  needlemawGland: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.acid, 0.9], [0.5, ZONE7_SHADE.moss], [1, ZONE7_SHADE.rockDeep]]))
    + `<g filter="url(#s${c.id})">${[0, 1, 2, 3, 4, 5].map((i) => { const a = -2.6 + i * 0.42; return `<line x1="32" y1="36" x2="${32 + Math.cos(a) * 28}" y2="${36 + Math.sin(a) * 28}" stroke="${HIVE.bone}" stroke-width="2" stroke-linecap="round"/>`; }).join('')}
      <ellipse cx="32" cy="38" rx="17" ry="14" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5"/><circle cx="28" cy="34" r="4" fill="${HIVE.acid}" filter="url(#g${c.id})"/></g>`,

  cantorSongSac: (c) => defs(c, radial(`r${c.id}`, [[0, PATH.melee], [0.5, ZONE7_SHADE.flesh], [1, ZONE7_SHADE.rockDeep]]))
    + `<g filter="url(#s${c.id})"><path d="M14 34 C14 16 40 10 64 12 C92 14 116 20 116 34 C116 48 92 54 64 54 C40 54 14 50 14 34Z" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M${34 + i * 18} 16 q5 18 0 36" stroke="${HIVE.bone}" stroke-opacity=".35" fill="none"/>`).join('')}
      <circle cx="40" cy="30" r="5" fill="${ZONE7.lime}" filter="url(#g${c.id})"/><circle cx="66" cy="38" r="4" fill="${ZONE7.lime}" filter="url(#g${c.id})"/><circle cx="90" cy="28" r="4.5" fill="${ZONE7.lime}" filter="url(#g${c.id})"/></g>`,

  glasswalkerLens: (c) => defs(c, linear(`l${c.id}`, [[0, ZONE7.cyan, 0.15], [0.5, HIVE.bone, 0.55], [1, ZONE7.violet, 0.2]], 1, 1))
    + `<g filter="url(#s${c.id})"><path d="M32 10 C50 24 54 64 50 96 C46 116 18 116 14 96 C10 64 14 24 32 10Z" fill="url(#l${c.id})" stroke="${HIVE.bone}" stroke-width="1.5"/>
      <path d="M22 40 C28 60 28 80 24 100 M42 40 C36 60 36 80 40 100" stroke="${ZONE7.cyan}" stroke-opacity=".6" fill="none"/>
      <ellipse cx="32" cy="62" rx="8" ry="14" fill="${HIVE.bone}" fill-opacity=".85" filter="url(#g${c.id})"/><path d="M26 30 l6 -10 l6 10" stroke="${HIVE.bone}" fill="none"/></g>`,

  oculimothEye: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.bone], [0.75, HIVE.bone], [1, ZONE7_SHADE.flesh]]) + radial(`i${c.id}`, [[0, HIVE.acid], [0.6, ZONE7_SHADE.moss], [1, ZONE7_SHADE.rockDeep]], '50%', '50%'))
    + `<g filter="url(#s${c.id})"><path d="M8 22 C2 10 14 8 24 20 M56 22 C62 10 50 8 40 20" stroke="${ZONE7.cyan}" stroke-opacity=".6" stroke-width="2" fill="${ZONE7.cyan}" fill-opacity=".15"/>
      <circle cx="32" cy="34" r="18" fill="url(#r${c.id})"/><path d="M18 26 q6 4 4 10 M44 44 q-6 -2 -6 -8" stroke="${HIVE.danger}" stroke-width="1" fill="none" opacity=".8"/>
      <circle cx="34" cy="33" r="9" fill="url(#i${c.id})" filter="url(#g${c.id})"/><circle cx="34" cy="33" r="3.5" fill="${ZONE7_SHADE.rockDeep}"/><circle cx="30" cy="29" r="2" fill="${HIVE.bone}"/>
      <path d="M26 52 q-2 6 2 10 M38 52 q2 6 -1 10" stroke="${HIVE.bone}" stroke-opacity=".6" fill="none"/></g>`,

  mournbackMarrow: (c) => defs(c, radial(`r${c.id}`, [[0, PATH.viral], [0.5, ZONE7.violet], [1, ZONE7_SHADE.rockDeep]], '50%', '50%'))
    + `<g filter="url(#s${c.id})"><path d="M20 28 C12 18 22 6 34 14 C40 18 44 22 48 26 L80 82 C84 86 88 90 94 94 C106 102 98 118 86 110 C82 118 66 116 70 104 L36 46 C26 48 12 42 20 28Z" fill="${HIVE.bone}" stroke="${ZONE7_SHADE.rockDeep}" stroke-width="1.5"/>
      <path d="M40 34 L84 96" stroke="url(#r${c.id})" stroke-width="12" stroke-linecap="round" filter="url(#g${c.id})"/>
      <path d="M44 44 L50 40 M56 62 L62 58 M68 80 L74 76" stroke="${ZONE7_SHADE.rockDeep}" stroke-width="2"/></g>`,

  broodHeartSeed: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.acid], [0.35, ZONE7_SHADE.moss], [1, ZONE7_SHADE.rockDeep]], '50%', '45%'))
    + `<g filter="url(#s${c.id})"><path d="M64 10 C96 22 112 52 104 82 C98 106 78 118 64 118 C50 118 30 106 24 82 C16 52 32 22 64 10Z" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".55" stroke-width="1.5"/>
      ${[-30, -12, 8, 26].map((dx) => `<path d="M${64 + dx * 0.3} 16 C${64 + dx} 50 ${64 + dx} 86 ${64 + dx * 0.4} 116" stroke="${HIVE.bone}" stroke-opacity=".3" fill="none"/>`).join('')}
      <circle cx="64" cy="62" r="13" fill="${HIVE.acid}" filter="url(#g${c.id})" opacity=".9"/><circle cx="64" cy="62" r="6" fill="${HIVE.bone}"/>
      ${[[40, 44], [88, 46], [46, 92], [84, 88]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${ZONE7.lime}" filter="url(#g${c.id})"/>`).join('')}
      <path d="M48 116 C40 122 30 124 22 122 M80 116 C88 122 98 124 106 122" stroke="${ZONE7_SHADE.flesh}" stroke-width="4" fill="none" stroke-linecap="round"/></g>`,

  weaverGanglion: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.bone], [0.4, ZONE7.violet], [1, ZONE7_SHADE.rockDeep]], '50%', '50%'))
    + `<g filter="url(#s${c.id})">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2 + 0.3; return `<path d="M32 32 Q${32 + Math.cos(a + 0.5) * 18} ${32 + Math.sin(a + 0.5) * 18} ${32 + Math.cos(a) * 28} ${32 + Math.sin(a) * 28}" stroke="${HIVE.bone}" stroke-opacity=".6" stroke-width="1.2" fill="none"/>`; }).join('')}
      <circle cx="32" cy="32" r="12" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".6"/>
      ${[[26, 28], [37, 30], [31, 38]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${PATH.viral}" filter="url(#g${c.id})"/>`).join('')}</g>`,

  mimicLure: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.bone], [0.35, PATH.melee], [1, ZONE7_SHADE.flesh]], '50%', '40%'))
    + `<g filter="url(#s${c.id})"><path d="M32 8 C40 20 38 40 34 56" stroke="${ZONE7_SHADE.flesh}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M32 8 C40 20 38 40 34 56" stroke="${HIVE.bone}" stroke-opacity=".4" stroke-width="1.5" fill="none"/>
      <ellipse cx="34" cy="84" rx="18" ry="24" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5" filter="url(#g${c.id})"/>
      <path d="M22 76 C28 70 40 70 46 76" stroke="${HIVE.bone}" stroke-opacity=".6" fill="none"/><circle cx="30" cy="80" r="4" fill="${HIVE.bone}"/>
      <path d="M20 104 q-6 8 -2 14 M48 104 q6 8 2 14" stroke="${ZONE7_SHADE.flesh}" stroke-width="3" fill="none"/></g>`,

  lanternGland: (c) => defs(c, radial(`r${c.id}`, [[0, HIVE.bone], [0.3, ZONE7.lime], [0.7, ZONE7_SHADE.moss], [1, ZONE7_SHADE.rockDeep]], '50%', '45%'))
    + `<g filter="url(#s${c.id})">${[0, 1, 2, 3, 4].map((i) => `<path d="M${44 + i * 10} 104 C${40 + i * 12} 112 ${36 + i * 14} 118 ${30 + i * 16} 124" stroke="${ZONE7.lime}" stroke-opacity=".7" stroke-width="2" fill="none"/>`).join('')}
      <path d="M64 12 C96 14 112 40 108 66 C104 92 86 106 64 106 C42 106 24 92 20 66 C16 40 32 14 64 12Z" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5" stroke-width="1.5" filter="url(#g${c.id})"/>
      ${[-24, -8, 8, 24].map((dx) => `<path d="M${64 + dx * 0.4} 14 C${64 + dx} 40 ${64 + dx} 80 ${64 + dx * 0.5} 104" stroke="${ZONE7_SHADE.moss}" stroke-opacity=".6" fill="none"/>`).join('')}
      <ellipse cx="54" cy="44" rx="10" ry="14" fill="${HIVE.bone}" fill-opacity=".5"/></g>`,
};

/** Fallback by kind, for items Design adds before the UI draws them. */
function generic(c: Ctx, kind: ItemKind): string {
  const col = KIND_COLOUR[kind];
  return defs(c, radial(`r${c.id}`, [[0, col], [1, ZONE7_SHADE.rockDeep]]))
    + `<rect x="10" y="10" width="${c.w - 20}" height="${c.h - 20}" rx="14" fill="url(#r${c.id})" stroke="${HIVE.bone}" stroke-opacity=".5" filter="url(#s${c.id})"/>`;
}

/** SVG markup for an item, sized to its footprint (rotated swaps width and height). */
export function itemIcon(item: string, rotated = false): string {
  const def = LOOT.items[item];
  const [sw, sh] = def ? def.size : [1, 1];
  const w = sw * CELL, h = sh * CELL;
  const c: Ctx = { w, h, id: `i${uid++}` };
  const body = DRAW[item] ? DRAW[item](c) : generic(c, def?.kind ?? 'tech');
  const vw = rotated ? h : w, vh = rotated ? w : h;
  const inner = rotated ? `<g transform="translate(${h} 0) rotate(90)">${body}</g>` : body;
  return `<svg class="icon" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}

/** Items the icon set draws by hand (tests check every item in loot.json has one). */
export const DRAWN_ITEMS = Object.keys(DRAW);

/** Small line glyphs for nav, stats and buttons: 24-unit viewBox, stroke = currentColor. */
const GLYPH: Record<string, string> = {
  dna: '<path d="M7 3c10 5 10 13 0 18M17 3C7 8 7 16 17 21M8 7h8M7.5 12h9M8 17h8"/>',
  virus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M5 19l3.5-3.5M15.5 8.5L19 5"/>',
  speed: '<path d="M3 17h7M5 12h9M3 7h7M13 5l8 7-8 7"/>',
  stealth: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><path d="M4 20L20 4"/>',
  health: '<path d="M12 21C5 15 2 11 4 7c2-3 6-3 8 0 2-3 6-3 8 0 2 4-1 8-8 14z"/>',
  armour: '<path d="M12 2l8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5z"/>',
  noise: '<path d="M3 9v6h4l5 4V5L7 9zM16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/>',
  extract: '<path d="M12 22V8M6 14l6-6 6 6M4 3h16"/>',
  stash: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M10 14h4"/>',
  toxin: '<path d="M12 2c3 6 7 9 7 13a7 7 0 01-14 0c0-4 4-7 7-13z"/><circle cx="12" cy="15" r="2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  skull: '<path d="M12 3a8 8 0 00-8 8c0 3 2 5 3 6v3h10v-3c1-1 3-3 3-6a8 8 0 00-8-8z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  spire: '<path d="M12 2l3 9-3 11-3-11z"/><path d="M5 22h14"/>',
  nest: '<path d="M12 20c-5-3-8-6-8-10a4 4 0 018-2 4 4 0 018 2c0 4-3 7-8 10z"/><circle cx="12" cy="11" r="2"/>',
  pod: '<ellipse cx="12" cy="13" rx="6" ry="8"/><path d="M12 5v16M7 9c3 2 7 2 10 0"/>',
  squad: '<circle cx="12" cy="8" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M6 20c0-4 3-6 6-6s6 2 6 6M1 18c0-3 2-4 4-4M23 18c0-3-2-4-4-4"/>',
  rotate: '<path d="M20 12a8 8 0 11-3-6.2M20 4v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  quit: '<path d="M9 21H4V3h5M16 17l5-5-5-5M21 12H9"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
export function glyph(name: keyof typeof GLYPH | string): string {
  return `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[name] ?? GLYPH.dna}</svg>`;
}
