/**
 * In-raid HUD, "membrane" language (UI department's own design, references are mood only): the edges of the host's
 * vision carry a few quiet clusters instead of framed panels. Top left the collapse clock and the extract, top centre
 * a bearing tape that hears the zone (extracts, pods, nearby creatures), top right the objectives and what is carried,
 * bottom left the host's vitals, bottom centre the kit (abilities and gear as round cells), bottom right the weapon.
 * Numbers are set in the display serif, labels in small spaced caps. Everything answers to what happens: vitals jolt
 * when hit, numbers tick, cells flash when used, new loot blooms in, the ocellus dilates with overload.
 * Reads a HudView each frame and listens to gameplay events; never touches game objects.
 */
import { Reticle } from './reticle';
import { def as itemOf } from '../items';
import './hud.css';
import { VIRUSES, VIRUS_RULES } from '../../../data';
import { HIVE, PATH, ZONE7 } from '../../render/palette';
import { applyTheme } from '../theme';
import { glyph, itemIcon, KIND_COLOUR } from '../icons';
import type { HudView } from './model';

type Bus = { on(type: string, fn: (e: never) => void): () => void };

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode) => root.querySelector<T>(sel)!;
function el(tag: string, cls: string, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}
/** Restart a one-shot CSS animation class on an element. */
function pulse(e: Element, cls: string): void { e.classList.remove(cls); void (e as HTMLElement).offsetWidth; e.classList.add(cls); }

/** Full control list, shown on the briefing prompt and whenever the mouse is released mid-raid. */
export const CONTROLS = '<small>WASD move · SHIFT sprint · C slide/crouch · SPACE jump · ESC release · TAB cavities</small>'
  + '<small>LMB fire · RMB aim · R regrow · F ego charge · V melee · 1/Q psych-wave pulse · 2 clot gel · hold E harvest</small>'
  + '<small>G neuro-spike grenade · X maw-seed mine · a Heart Husk in your cavities revives you once</small>';

/** Flesh Market gear the HUD counts from what the host carries: key, item, short label. */
export const GEAR: [string, string, string][] = [['G', 'neuroSpikeGrenade', 'SPIKE'], ['X', 'mawSeedMine', 'MINE'], ['', 'heartHusk', 'HUSK']];

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Ocellus tint per active virus (the host's eye "changes tint" when a strain takes hold). */
export const VIRUS_TINT: Record<string, string> = { plagueStalkerStrain: PATH.viral, adrenalineVirus: PATH.melee, splicedParasites: ZONE7.cyan };

/** Bearing tape: degrees either side of the view it shows, and the compass letters. */
export const TAPE = { span: 80, w: 760, h: 64 };
const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/**
 * Angle in degrees of a world point relative to where the host looks (negative left, positive right), from the
 * scanner's yaw convention: yaw 0 looks down -Z, right is +X.
 */
export function relBearing(px: number, pz: number, tx: number, tz: number, yaw: number): number {
  const dx = tx - px, dz = tz - pz;
  const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw), r = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
  return (Math.atan2(r, f) * 180) / Math.PI;
}

const ringLen = (r: number) => 2 * Math.PI * r;
const ring = (cls: string, r: number, inner = '') =>
  el('div', `hud-ring ${cls} hidden`, `<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${r}"/><circle class="val" cx="50" cy="50" r="${r}" style="stroke-dasharray:${ringLen(r)};stroke-dashoffset:${ringLen(r)}"/></svg>${inner}`);

export class OrganicHud {
  readonly root: HTMLElement;
  private q: Record<string, HTMLElement> = {};
  private tape: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D | null;
  private time = 0;
  private toastLeft = 0;
  private hitLeft = 0;
  private veinLeft = { n: 0, s: 0, e: 0, w: 0 };
  private pendingHit: { x: number; z: number } | null = null;
  private lastPhase = '';
  private lastVirus: string | null = null;
  private mutateLeft = 0;
  private bannerLeft = 0;
  private lootKey = '';
  private lootSeen = new Set<string>();
  private bossKey = '';
  private gearKey = '';
  private reviveLeft = 0;
  private lastBio = -1;
  private lastAmmo = -1;
  private lastEgoReady = false;
  readonly reticle: Reticle;

  constructor(root: HTMLElement, bus?: Bus) {
    applyTheme();
    this.root = root;
    root.classList.add('raid', 'organic');
    root.insertAdjacentHTML('beforeend', `
      <div class="h-clock"><b data-q="timer">10:00</b><small>until the zone folds</small><span class="h-objective" data-q="objective"></span></div>
      <div class="h-top">
        <div class="h-tape"><canvas width="${TAPE.w}" height="${TAPE.h}"></canvas></div>
        <div class="h-boss hidden" data-q="boss"><div class="bh"><b data-q="bossName"></b><span data-q="bossWave"></span></div>
          <div class="bt"><div class="trk"><div class="ghost" data-q="bossGhost"></div><div class="fill" data-q="bossFill"></div><div class="notches" data-q="bossNotches"></div></div></div></div>
      </div>
      <div class="h-quest"><h4>OBJECTIVES</h4><ul data-q="quests"></ul>
        <div class="h-haul"><span>HAUL</span><b data-q="haul">0</b><span>KILL DNA</span><b data-q="dna">0</b></div>
        <div class="h-carried" data-q="carried"></div></div>
      <div id="vitals" class="h-vitals" data-q="vitals">
        <div class="h-id"><span class="eye" data-q="eye"><i class="iris"><i class="pupil"></i></i></span><span class="lvl" data-q="lvl">INFILTRATOR</span><span class="h-virus hidden" data-q="virus"></span></div>
        <div class="h-bar biomass"><div class="hd"><label>BIOMASS</label><span class="value" data-q="bioVal">200</span></div><div class="trk"><div class="ghost" data-q="bioGhost"></div><div id="biomass" class="fill" data-q="bio"></div></div></div>
        <div class="h-bar neural"><div class="hd"><label>NEURAL OVERLOAD</label><span class="value" data-q="neuVal">0</span></div><div class="trk"><div id="neural" class="fill" data-q="neu"></div></div></div>
      </div>
      <div class="h-kit"><div class="h-banner" data-q="banner"></div><div class="row"><div class="cells" data-q="slots">
        ${[1, 2, 3, 4, 5].map((i) => `<div class="hslot locked"><div class="cd"></div><div class="ico"></div><span class="count"></span><kbd>${i}</kbd><span class="name"></span></div>`).join('')}</div><div class="h-gear" data-q="gear"></div></div></div>
      <div class="h-weapon">
        <div class="wname">Synapse Burster</div>
        <div class="wrow"><div class="ego" data-q="ego"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="40"/><circle class="val" cx="50" cy="50" r="40" data-q="egoRing"/></svg><span>F</span><small>EGO</small></div>
          <div class="ammo" data-q="ammoBox"><b data-q="ammo">42</b><small>/ ∞ spores</small></div></div>
        <div class="mag"><i data-q="mag"></i></div>
      </div>
      <div class="h-revive hidden" data-q="revive"><b>Heart Husk</b><span>THE HUSK SPLITS · REBIRTH IN <i data-q="reviveT">0.0</i></span></div>
      <div class="h-centre">
        <div class="hitmarker" data-q="hit"></div>
        <div class="h-interact hidden" data-q="interact"><span></span><div class="bar"><div></div></div></div>
      </div>
      <div class="vein n"></div><div class="vein s"></div><div class="vein e"></div><div class="vein w"></div>
      <div class="h-mutate" data-q="mutate"></div>
      <div class="toast" data-q="toast"></div>`);
    root.querySelectorAll<HTMLElement>('[data-q]').forEach((e) => { this.q[e.dataset.q!] = e; });
    const centre = $('.h-centre', root);
    this.q.harvest = ring('harvest', 44, '<span>HARVEST</span><b></b>');
    this.q.inject = ring('inject', 44, '<span>INJECTING</span><b></b>');
    this.q.extract = ring('extract', 46, '<span>EXTRACTING</span><b></b>');
    centre.append(this.q.harvest, this.q.inject, this.q.extract);
    this.reticle = new Reticle(centre);
    this.tape = $('.h-tape canvas', root) as HTMLCanvasElement;
    this.tctx = this.tape.getContext('2d');

    if (bus) this.listen(bus);
  }

  private listen(bus: Bus): void {
    const on = <T>(t: string, fn: (e: T) => void) => bus.on(t, fn as (e: never) => void);
    on<{ weakPoint: boolean; kill: boolean }>('hit', (e) => { this.hitLeft = 0.18; this.q.hit.className = `hitmarker on${e.weakPoint ? ' weak' : ''}${e.kill ? ' kill' : ''}`;  this.reticle.hit(e.weakPoint, e.kill); });
    on<{ weapon?: string; ego?: boolean }>('shot', (e) => { if (!e.ego) this.reticle.shot(e.weapon); });
    on<{ weapon?: string }>('reload', () => this.reticle.reload());
    on<{ direction: { x: number; z: number } | null }>('damaged', (e) => {
      pulse(this.q.vitals, 'jolt');
      if (!e.direction) { for (const k of ['n', 's', 'e', 'w'] as const) this.veinLeft[k] = 0.6; return; }
      this.pendingHit = e.direction;
    });
    on('overload', () => this.say('OVERLOADED', 'violet'));
    on<{ reason: string }>('abilityDenied', (e) => this.say(e.reason === 'overloaded' ? 'OVERLOADED' : e.reason === 'empty' ? 'NONE CARRIED' : 'RECHARGING'));
    on<{ items: { item: string; count: number }[] }>('pickup', (e) => this.say(`HARVESTED ${e.items.map((i) => `${i.count > 1 ? `${i.count}× ` : ''}${itemOf(i.item)?.label ?? i.item}`).join(' · ')}`.toUpperCase(), 'cyan'));
    on<{ items: { item: string; count: number }[] }>('cavityFull', (e) => this.say(`CAVITIES FULL · ${e.items.map((i) => itemOf(i.item)?.label ?? i.item).join(', ').toUpperCase()} LEFT BEHIND · [TAB] SWAP`, 'danger', 3.5));
    on('collapseWarning', () => this.say('ZONE COLLAPSE IN 2:00 · EXTRACT NOW', 'danger alarm', 5));
    on<{ label: string }>('extractStart', (e) => this.say(`${e.label.toUpperCase()} SIGNAL · HOLD THE ZONE`, 'lime'));
    on('extractCancel', () => this.say('EXTRACTION INTERRUPTED', 'danger'));
    on('alert', () => { this.q.eye.classList.add('alarm'); setTimeout(() => this.q.eye.classList.remove('alarm'), 600); });
    on<{ virus: string }>('virusInjectStart', (e) => this.say(`INJECTING ${(VIRUSES[e.virus]?.label ?? e.virus).toUpperCase()} · YOU ARE SLOWED`, 'violet', VIRUS_RULES.injectTime));
    on('virusInjectCancel', () => this.say('INJECTION INTERRUPTED', 'danger'));
    on<{ virus: string }>('virusInjected', (e) => this.mutate(e.virus));
    on<{ item: string }>('harvestDone', (e) => this.say(`CUT OUT ${(itemOf(e.item)?.label ?? e.item).toUpperCase()}`, 'cyan'));
    on<{ id: string; slot: number }>('ability', (e) => {
      this.bannerLeft = 1.4;
      const cell = this.q.slots.children[e.slot - 1];
      if (cell) pulse(cell, 'fired');
    });
    on<{ hit: number | null }>('melee', (e) => { if (e.hit !== null) { this.hitLeft = 0.18; this.q.hit.className = 'hitmarker on'; } });
    on<{ time: number }>('reviving', (e) => { this.reviveLeft = e.time; this.q.revive.classList.remove('hidden'); });
    on('revived', () => { this.reviveLeft = 0; this.q.revive.classList.add('hidden'); this.say('REBORN FROM THE HUSK', 'lime', 2.5); });
    on<{ label: string }>('nestAwake', (e) => this.say(`${e.label.toUpperCase()} STIRS`, 'danger', 3));
    on<{ wave: number; of: number }>('nestWave', (e) => this.say(`BROOD WAVE ${e.wave} OF ${e.of}`, 'danger', 2.5));
    on<{ dna: number }>('nestDestroyed', (e) => this.say(`THE HEART BURSTS · +${e.dna} DNA · BROOD CACHE EXPOSED`, 'lime', 4));
  }

  /** Mutation flash: the screen edges bloom in the strain's colour while the arms dissolve-grow. */
  mutate(virus: string): void {
    const col = VIRUS_TINT[virus] ?? PATH.viral;
    this.q.mutate.style.setProperty('--vc', col);
    this.q.mutate.classList.remove('on'); void this.q.mutate.offsetWidth; this.q.mutate.classList.add('on');
    this.mutateLeft = VIRUS_RULES.mutationGrowTime;
    this.say(`MUTATING · ${(VIRUSES[virus]?.label ?? virus).toUpperCase()} TAKES HOLD`, 'violet', VIRUS_RULES.mutationGrowTime);
  }

  say(text: string, tone = 'acid', seconds = 2): void {
    this.q.toast.textContent = text;
    this.q.toast.className = `toast on ${tone}`;
    this.toastLeft = seconds;
  }

  update(dt: number, s: HudView): void {
    this.time += dt;
    this.reticle.update(dt, { aiming: !!s.aiming, ammo: s.ammo, magazine: s.magazine, reloading: s.reloading, weapon: s.weapon, motion: s.motion, crosshair: s.crosshair });
    const q = this.q;
    this.root.classList.toggle('briefing', s.phase === 'briefing');
    const bf = s.biomass / s.biomassMax;
    q.bio.style.width = `${bf * 100}%`;
    // Damage ghost: a pale segment that drains after the bar drops (reads hit size without numbers).
    const gw = parseFloat(q.bioGhost.style.width || '100');
    q.bioGhost.style.width = `${Math.max(bf * 100, gw - dt * 30)}%`;
    const bio = Math.ceil(s.biomass);
    if (bio !== this.lastBio) {
      // The number ticks: it sinks red when hurt and lifts pale when healed.
      if (this.lastBio >= 0) pulse(q.bioVal, bio < this.lastBio ? 'down' : 'up');
      this.lastBio = bio;
      q.bioVal.innerHTML = `${bio}<small>/${s.biomassMax}</small>`;
    }
    q.neu.style.width = `${s.overload * 100}%`;
    q.neuVal.textContent = `${Math.round(s.overload * 100)}%`;
    const nb = q.neu.closest('.h-bar')!;
    nb.classList.toggle('hot', s.overload > 0.75);
    nb.classList.toggle('over', s.overloaded);
    q.biomass = q.bio.closest('.h-bar')!;
    q.biomass.classList.toggle('low', bf < 0.3);

    // Eye: dilates with overload, bloodshot when hurt, tinted by the active virus.
    const eye = q.eye;
    eye.style.setProperty('--dilate', String(0.32 + s.overload * 0.5));
    eye.classList.toggle('hurt', bf < 0.3);
    eye.classList.toggle('over', s.overloaded);
    const virus = s.activeVirus ?? null;
    if (virus !== this.lastVirus) {
      this.lastVirus = virus;
      eye.style.setProperty('--iris', virus ? VIRUS_TINT[virus] ?? PATH.viral : HIVE.acid);
      q.virus.classList.toggle('hidden', !virus);
      if (virus) {
        const v = VIRUSES[virus];
        q.virus.innerHTML = `<i>${itemIcon(v?.item ?? virus)}</i><div><small>ACTIVE STRAIN</small><b>${(v?.label ?? virus).toUpperCase()}</b></div>`;
        q.virus.style.setProperty('--vc', VIRUS_TINT[virus] ?? PATH.viral);
      }
    }

    q.timer.textContent = fmtTime(s.timeLeft);
    q.timer.parentElement!.classList.toggle('collapse', s.collapse);
    q.objective.textContent = s.extract.inside ? `Hold ${s.extract.label}` : `${s.extract.label} · ${Math.round(s.extract.distance)} m`;
    const quests = [
      `<li class="${s.extract.inside ? 'done' : ''}">${glyph('spire')}<span>Reach the ${s.extract.label}</span><b>${Math.round(s.extract.distance)} M</b></li>`,
      ...(s.objectives ?? []).map((o) => `<li class="${o.done ? 'done' : ''}">${glyph(o.icon ?? 'dna')}<span>${o.text}</span>${o.detail ? `<b>${o.detail}</b>` : ''}</li>`),
    ].join('');
    if (q.quests.dataset.k !== quests) { q.quests.innerHTML = quests; q.quests.dataset.k = quests; }
    q.haul.textContent = String(s.value);
    q.dna.textContent = String(s.dna);

    // Carried: small icon row (the full grid is the TAB overlay).
    const key = s.carried.map((c) => `${c.item}${c.count}`).join(',') + (s.cavityUsed ?? '');
    if (key !== this.lootKey) {
      // Anything newly carried (or more of it) blooms in; the first fill on load does not.
      const fresh = this.lootKey !== '';
      this.lootKey = key;
      const seen = new Set(s.carried.map((c) => `${c.item}${c.count}`));
      q.carried.innerHTML = s.carried.map((c) => `<div class="chip${fresh && !this.lootSeen.has(`${c.item}${c.count}`) ? ' new' : ''}" style="--kc:${KIND_COLOUR[(itemOf(c.item)?.kind ?? 'tech') as keyof typeof KIND_COLOUR]}" title="${c.label}">${itemIcon(c.item)}${c.count > 1 ? `<b>${c.count}</b>` : ''}</div>`).join('')
        + (s.cavityUsed ? `<span class="cap">${s.cavityUsed[0]}/${s.cavityUsed[1]} <kbd>TAB</kbd></span>` : '');
      this.lootSeen = seen;
    }

    // Ability slots.
    const slotEls = q.slots.children;
    let activeLabel = '';
    for (let i = 0; i < 5; i++) {
      const v = s.slots.find((x) => x.slot === i + 1);
      const e = slotEls[i] as HTMLElement;
      e.className = `hslot${v ? '' : ' locked'}${v && !v.usable ? ' dim' : ''}${v?.active ? ' active' : ''}`;
      $('.name', e).textContent = v ? v.label : '';
      $('.count', e).textContent = v && v.count !== null ? `×${v.count}` : '';
      e.style.setProperty('--cd', String(v?.cooldownFrac ?? 0));
      const ico = $('.ico', e);
      const gk = v ? (v.label.toUpperCase().includes('PULSE') ? 'eye' : v.label.toUpperCase().includes('GEL') ? 'health' : 'virus') : 'lock';
      if (ico.dataset.g !== gk) { ico.innerHTML = glyph(gk); ico.dataset.g = gk; }
      if (v?.active) activeLabel = v.label;
    }
    this.bannerLeft = Math.max(0, this.bannerLeft - dt);
    q.banner.textContent = activeLabel || (this.bannerLeft > 0 ? s.slots[0]?.label ?? '' : '');
    q.banner.classList.toggle('lit', this.bannerLeft > 0 || !!activeLabel);

    q.ammo.textContent = s.reloading > 0 ? 'regrowing' : String(s.ammo);
    q.ammoBox.classList.toggle('regrow', s.reloading > 0);
    q.ammoBox.classList.toggle('low', s.ammo < s.magazine * 0.2);
    if (s.ammo < this.lastAmmo && s.reloading <= 0) pulse(q.ammo, 'shot');
    this.lastAmmo = s.ammo;
    q.mag.style.width = `${Math.max(0, Math.min(1, s.ammo / Math.max(1, s.magazine))) * 100}%`;
    const ec = ringLen(40);
    const er = q.egoRing as unknown as SVGCircleElement;
    er.style.strokeDasharray = `${ec}`;
    er.style.strokeDashoffset = `${ec * (1 - s.ego)}`;
    q.ego.classList.toggle('ready', s.egoReady);
    if (s.egoReady && !this.lastEgoReady) pulse(q.ego, 'bloom');
    this.lastEgoReady = s.egoReady;

    // Centre: interact prompt, harvest / inject / extract rings.
    const harvesting = (s.harvestProgress ?? 0) > 0;
    q.interact.classList.toggle('hidden', !s.interact || harvesting);
    if (s.interact) { $('span', q.interact).textContent = s.interact.text; ($('.bar div', q.interact)).style.width = `${s.interact.progress * 100}%`; }
    this.setRing(q.harvest, harvesting ? s.harvestProgress! : null, `${Math.round((s.harvestProgress ?? 0) * 100)}%`);
    this.setRing(q.inject, s.injecting ? s.injectProgress ?? 0 : null, ((1 - (s.injectProgress ?? 0)) * VIRUS_RULES.injectTime).toFixed(1));
    this.setRing(q.extract, s.extract.inside && s.phase === 'raid' ? s.extract.progress : null, ((1 - s.extract.progress) * (s.extract.time ?? 8)).toFixed(1));

    // Hit-marker and directional damage veins.
    this.hitLeft -= dt;
    if (this.hitLeft <= 0) q.hit.className = 'hitmarker';
    if (this.pendingHit) {
      const yaw = s.scanner.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const f = this.pendingHit.x * fx + this.pendingHit.z * fz, r = this.pendingHit.x * rx + this.pendingHit.z * rz;
      this.veinLeft[Math.abs(f) > Math.abs(r) ? (f > 0 ? 'n' : 's') : (r > 0 ? 'e' : 'w')] = 0.8;
      this.pendingHit = null;
    }
    for (const k of ['n', 's', 'e', 'w'] as const) {
      this.veinLeft[k] = Math.max(0, this.veinLeft[k] - dt);
      (this.root.querySelector(`.vein.${k}`) as HTMLElement).style.opacity = String(Math.min(1, this.veinLeft[k] * 1.6) + (bf < 0.3 ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0));
    }
    this.toastLeft -= dt;
    if (this.toastLeft <= 0) q.toast.classList.remove('on');
    this.mutateLeft = Math.max(0, this.mutateLeft - dt);
    if (this.mutateLeft <= 0) q.mutate.classList.remove('on');

    this.updateBoss(dt, s.boss ?? null);
    this.updateGear(s);
    if (this.reviveLeft > 0) { this.reviveLeft = Math.max(0, this.reviveLeft - dt); q.reviveT.textContent = this.reviveLeft.toFixed(1); }
    this.drawTape(s);
    if (s.phase !== this.lastPhase) this.lastPhase = s.phase;
  }

  /** Gear cells after the abilities in the kit row: only what is carried, with its key and count. */
  private updateGear(s: HudView): void {
    const have = GEAR.map(([key, item, label]) => ({ key, item, label, n: s.carried.filter((c) => c.item === item).reduce((a, c) => a + c.count, 0) })).filter((g) => g.n > 0);
    const k = have.map((g) => `${g.item}${g.n}`).join(',');
    if (k === this.gearKey) return;
    this.gearKey = k;
    this.q.gear.innerHTML = have.map((g) => `<div class="hslot gchip" title="${g.label}"><div class="ico">${itemIcon(g.item)}</div><span class="count">${g.n}</span><kbd>${g.key || '·'}</kbd></div>`).join('');
  }

  /** Boss bar under the bearing tape: a thin flesh line, a pale damage ghost, one notch per brood wave. */
  private updateBoss(dt: number, b: HudView['boss']): void {
    const q = this.q;
    q.boss.classList.toggle('hidden', !b);
    if (!b) { this.bossKey = ''; return; }
    const f = Math.max(0, Math.min(1, b.fraction));
    q.bossFill.style.width = `${f * 100}%`;
    const gw = parseFloat(q.bossGhost.style.width || '100');
    q.bossGhost.style.width = `${Math.max(f * 100, gw - dt * 18)}%`;
    q.boss.classList.toggle('low', f < 0.25);
    const key = `${b.label}|${b.wave}|${b.waves}`;
    if (key === this.bossKey) return;
    this.bossKey = key;
    q.bossName.textContent = b.label.toUpperCase();
    q.bossWave.textContent = b.waves ? `WAVE ${b.wave}/${b.waves}` : '';
    q.bossNotches.innerHTML = Array.from({ length: Math.max(0, b.waves - 1) }, (_, i) => `<i style="left:${((i + 1) / b.waves) * 100}%"${i < b.wave - 1 ? ' class="past"' : ''}></i>`).join('');
  }

  private setRing(r: HTMLElement, v: number | null, label: string): void {
    r.classList.toggle('hidden', v === null);
    if (v === null) return;
    const c = r.querySelector<SVGCircleElement>('circle.val')!;
    const len = ringLen(Number(c.getAttribute('r')));
    c.style.strokeDashoffset = `${len * (1 - Math.max(0, Math.min(1, v)))}`;
    $('b', r).textContent = label;
  }

  /**
   * Bearing tape: a soft scale of degrees with the compass letters, sliding as the host turns. Open extracts are
   * diamonds (pinned to the edge when behind you), seed pods within scanner range are small cyan seeds, creatures
   * within range are red motes that fade with distance (bright once revealed). The baseline reddens in a collapse.
   */
  private drawTape(s: HudView): void {
    const c = this.tctx;
    if (!c) return;
    const { w: W, h: H, span } = TAPE, cx = W / 2, sc = s.scanner;
    const yawDeg = (sc.yaw * 180) / Math.PI;
    const toX = (rel: number) => cx + (rel / span) * (W / 2 - 24);
    c.clearRect(0, 0, W, H);
    const fam = getComputedStyle(this.root).getPropertyValue('--display').trim() || 'serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    // Scale: a tick every 15 degrees, letters on the cardinals, numbers on the diagonals.
    for (let b = 0; b < 360; b += 15) {
      // World bearing b (0 = -Z, 90 = +X) seen from the host's heading (-yaw in this convention).
      const a = ((b + yawDeg) % 360 + 540) % 360 - 180;
      if (Math.abs(a) > span) continue;
      const x = toX(a), fade = 1 - Math.pow(Math.abs(a) / span, 2);
      c.globalAlpha = 0.25 + 0.75 * fade;
      c.fillStyle = HIVE.bone; c.strokeStyle = HIVE.bone; c.lineWidth = 1.2;
      const big = b % 45 === 0;
      c.beginPath(); c.moveTo(x, H - 16); c.lineTo(x, H - (big ? 26 : 21)); c.stroke();
      if (CARDINAL[b]) { c.font = `600 26px ${fam}`; c.fillText(CARDINAL[b], x, H - 31); }
      else if (big) { c.globalAlpha *= 0.6; c.font = `500 17px ${fam}`; c.fillText(String(b), x, H - 31); }
    }
    c.globalAlpha = 1;
    // Baseline.
    const base = c.createLinearGradient(0, 0, W, 0);
    const line = s.collapse ? HIVE.danger : HIVE.bone;
    base.addColorStop(0, `${line}00`); base.addColorStop(0.5, `${line}88`); base.addColorStop(1, `${line}00`);
    c.fillStyle = base; c.fillRect(0, H - 14, W, 1.4);
    const rel = (x: number, z: number) => relBearing(sc.x, sc.z, x, z, sc.yaw);
    for (const pod of sc.pods) {
      if (pod.opened || Math.hypot(pod.x - sc.x, pod.z - sc.z) > sc.range) continue;
      const r = rel(pod.x, pod.z);
      if (Math.abs(r) > span) continue;
      c.fillStyle = PATH.dna; c.globalAlpha = 0.85;
      c.beginPath(); c.ellipse(toX(r), H - 7, 2.6, 4, 0, 0, Math.PI * 2); c.fill();
    }
    for (const p of sc.pings) {
      const d = Math.hypot(p.x - sc.x, p.z - sc.z);
      if (d > sc.range) continue;
      const r = rel(p.x, p.z);
      if (Math.abs(r) > span) continue;
      const big = p.kind === 'bilecantor' || p.kind === 'mournback';
      // Online raids: squadmates read in bone, everything hostile in danger red.
      c.fillStyle = p.kind === 'squad' ? HIVE.bone : HIVE.danger; c.globalAlpha = (p.revealed ? 1 : 0.55) * (1 - 0.6 * (d / sc.range));
      c.beginPath(); c.arc(toX(r), H - 7, big ? 4.2 : 3, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    for (const ex of sc.extracts ?? [{ ...sc.extract, open: true }]) {
      let r = rel(ex.x, ex.z);
      const behind = Math.abs(r) > span;
      r = Math.max(-span, Math.min(span, r));
      const x = toX(r), y = H - 7;
      c.strokeStyle = ex.open === false ? `${HIVE.bone}55` : HIVE.acid; c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 5.5, y); c.lineTo(x, y + 7); c.lineTo(x - 5.5, y); c.closePath(); c.stroke();
      if (behind && ex.open !== false) {
        c.fillStyle = HIVE.acid; const dir = Math.sign(r);
        c.beginPath(); c.moveTo(x + dir * 14, y); c.lineTo(x + dir * 9, y - 4); c.lineTo(x + dir * 9, y + 4); c.closePath(); c.fill();
      }
    }
    // Heading needle.
    c.fillStyle = HIVE.bone;
    c.beginPath(); c.moveTo(cx, H - 15); c.lineTo(cx - 5, H - 9); c.lineTo(cx + 5, H - 9); c.closePath(); c.fill();
  }
}
