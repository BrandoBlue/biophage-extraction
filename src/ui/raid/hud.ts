/**
 * Larva in-raid HUD (reference 04): organic bone-and-flesh frames, reactive eyeball portrait that takes the active
 * virus's tint, swirling Psych-Wave Scanner, five ability slots under an ability banner, the Synapse Burster panel
 * with its EGO CHARGE ring, objectives top right, harvest / inject / extract rings in the centre.
 * Reads a HudView each frame and listens to gameplay events; never touches game objects.
 */
import { def as itemOf } from '../items';
import './hud.css';
import { VIRUSES, VIRUS_RULES } from '../../../data';
import { HIVE, PATH, ZONE7 } from '../../render/palette';
import { applyTheme } from '../theme';
import { glyph, itemIcon, KIND_COLOUR } from '../icons';
import { barFrame, bossFrame, scannerFrame, slotsFrame, socketFrame, timerFrame, weaponFrame } from './organic';
import type { HudView } from './model';

type Bus = { on(type: string, fn: (e: never) => void): () => void };

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode) => root.querySelector<T>(sel)!;
function el(tag: string, cls: string, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

/** Full control list, shown on the briefing prompt and whenever the mouse is released mid-raid. */
export const CONTROLS = '<small>WASD move · SHIFT sprint · C slide/crouch · SPACE jump · ESC release · TAB cavities</small>'
  + '<small>LMB fire · RMB aim · R regrow · F ego charge · V melee · 1/Q psych-wave pulse · 2 clot gel · hold E harvest</small>'
  + '<small>G neuro-spike grenade · X maw-seed mine · a Heart Husk in your cavities revives you once</small>';

/** Flesh Market gear the HUD counts from what the host carries: key, item, short label. */
export const GEAR: [string, string, string][] = [['G', 'neuroSpikeGrenade', 'SPIKE'], ['X', 'mawSeedMine', 'MINE'], ['', 'heartHusk', 'HUSK']];

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Eye tint per active virus (the portrait "changes tint" when a strain takes hold). */
export const VIRUS_TINT: Record<string, string> = { plagueStalkerStrain: PATH.viral, adrenalineVirus: PATH.melee, splicedParasites: ZONE7.cyan };
const ringLen = (r: number) => 2 * Math.PI * r;
const ring = (cls: string, r: number, inner = '') =>
  el('div', `hud-ring ${cls} hidden`, `<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${r}"/><circle class="val" cx="50" cy="50" r="${r}" style="stroke-dasharray:${ringLen(r)};stroke-dashoffset:${ringLen(r)}"/></svg>${inner}`);

export class OrganicHud {
  readonly root: HTMLElement;
  private q: Record<string, HTMLElement> = {};
  private scanner: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D | null;
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
  private bossKey = '';
  private gearKey = '';
  private reviveLeft = 0;

  constructor(root: HTMLElement, bus?: Bus) {
    applyTheme();
    this.root = root;
    root.classList.add('raid', 'organic');
    root.insertAdjacentHTML('beforeend', `
      <div class="h-scanner">${scannerFrame()}<canvas width="220" height="220"></canvas><label>PSYCH-WAVE SCANNER</label></div>
      <div class="h-top">
        <div class="h-timer">${timerFrame()}<b data-q="timer">10:00</b></div>
        <div class="h-objective" data-q="objective"></div>
        <div class="h-boss hidden" data-q="boss"><div class="bh"><b data-q="bossName"></b><span data-q="bossWave"></span></div>
          <div class="bt">${bossFrame()}<div class="trk"><div class="ghost" data-q="bossGhost"></div><div class="fill" data-q="bossFill"></div><div class="notches" data-q="bossNotches"></div></div></div></div>
      </div>
      <div class="h-quest"><h4>${glyph('spire')}OBJECTIVES</h4><ul data-q="quests"></ul>
        <div class="h-haul"><span>HAUL</span><b data-q="haul">0</b><span>KILL DNA</span><b data-q="dna">0</b></div>
        <div class="h-carried" data-q="carried"></div></div>
      <div id="vitals" class="h-vitals">
        <div class="h-socket">${socketFrame()}<div class="eye" data-q="eye"><div class="iris"><div class="pupil"></div></div></div><span class="lvl" data-q="lvl">INFILTRATOR</span></div>
        <div class="h-bars">
          <div class="h-bar biomass">${barFrame('biomass')}<label>BIOMASS <small>(HP)</small><span class="value" data-q="bioVal">200/200</span></label><div class="trk"><div id="biomass" class="fill" data-q="bio"></div><div class="ghost" data-q="bioGhost"></div></div></div>
          <div class="h-bar neural">${barFrame('neural')}<label>NEURAL OVERLOAD</label><div class="trk"><div id="neural" class="fill" data-q="neu"></div></div></div>
        </div>
        <div class="h-virus hidden" data-q="virus"></div>
      </div>
      <div class="h-slots">${slotsFrame()}<div class="h-banner" data-q="banner">PSYCH-WAVE PULSE</div><div class="row" data-q="slots">
        ${[1, 2, 3, 4, 5].map((i) => `<div class="hslot locked"><div class="ico"></div><div class="cd"></div><span class="name"></span><span class="count"></span><kbd>[${i}]</kbd></div>`).join('')}</div></div>
      <div class="h-weapon">${weaponFrame()}
        <div class="wname">SYNAPSE BURSTER</div>
        <div class="wicon">${this.gunGlyph()}</div>
        <div class="ammo" data-q="ammoBox"><b data-q="ammo">42</b> / ∞ <small>SPORES</small></div>
        <div class="ego" data-q="ego"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="40"/><circle class="val" cx="50" cy="50" r="40" data-q="egoRing"/></svg><span>EGO<br/>CHARGE</span></div>
      </div>
      <div class="h-gear" data-q="gear"></div>
      <div class="h-revive hidden" data-q="revive"><b>HEART HUSK</b><span>THE HUSK SPLITS · REBIRTH IN <i data-q="reviveT">0.0</i></span></div>
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
    this.scanner = $('.h-scanner canvas', root) as HTMLCanvasElement;
    this.sctx = this.scanner.getContext('2d');

    if (bus) this.listen(bus);
  }

  private gunGlyph(): string {
    return `<svg viewBox="0 0 120 40" aria-hidden="true"><path d="M4 22 C10 12 26 10 40 12 L86 14 C96 14 104 18 112 20 L116 24 L104 26 L60 28 C50 34 40 36 30 34 C18 32 8 30 4 22Z" fill="${ZONE7.magenta}" fill-opacity=".55" stroke="${HIVE.bone}" stroke-width="1.2"/>
      ${[30, 44, 58].map((x) => `<circle cx="${x}" cy="20" r="3.4" fill="${HIVE.bone}"/><circle cx="${x}" cy="20" r="1.6" fill="${HIVE.acid}"/>`).join('')}
      <path d="M70 14 l6 -8 l6 8Z" fill="${ZONE7.cyan}"/><path d="M24 32 C22 38 16 40 10 38" stroke="${ZONE7.magenta}" stroke-width="3" fill="none"/></svg>`;
  }

  private listen(bus: Bus): void {
    const on = <T>(t: string, fn: (e: T) => void) => bus.on(t, fn as (e: never) => void);
    on<{ weakPoint: boolean; kill: boolean }>('hit', (e) => { this.hitLeft = 0.18; this.q.hit.className = `hitmarker on${e.weakPoint ? ' weak' : ''}${e.kill ? ' kill' : ''}`; });
    on<{ direction: { x: number; z: number } | null }>('damaged', (e) => {
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
    on<{ id: string; slot: number }>('ability', () => { this.bannerLeft = 1.4; });
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
    const q = this.q;
    this.root.classList.toggle('briefing', s.phase === 'briefing');
    const bf = s.biomass / s.biomassMax;
    q.bio.style.width = `${bf * 100}%`;
    // Damage ghost: a pale segment that drains after the bar drops (reads hit size without numbers).
    const gw = parseFloat(q.bioGhost.style.width || '100');
    q.bioGhost.style.width = `${Math.max(bf * 100, gw - dt * 30)}%`;
    q.bioVal.textContent = `${Math.ceil(s.biomass)}/${s.biomassMax}`;
    q.neu.style.width = `${s.overload * 100}%`;
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
    q.objective.textContent = s.extract.inside ? `HOLD ${s.extract.label.toUpperCase()}` : `EXTRACT · ${s.extract.label.toUpperCase()} · ${Math.round(s.extract.distance)} M`;
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
      this.lootKey = key;
      q.carried.innerHTML = s.carried.map((c) => `<div class="chip" style="--kc:${KIND_COLOUR[(itemOf(c.item)?.kind ?? 'tech') as keyof typeof KIND_COLOUR]}" title="${c.label}">${itemIcon(c.item)}${c.count > 1 ? `<b>${c.count}</b>` : ''}</div>`).join('')
        + (s.cavityUsed ? `<span class="cap">${s.cavityUsed[0]}/${s.cavityUsed[1]} <kbd>TAB</kbd></span>` : '');
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
      ($('.cd', e)).style.height = `${(v?.cooldownFrac ?? 0) * 100}%`;
      const ico = $('.ico', e);
      const gk = v ? (v.label.toUpperCase().includes('PULSE') ? 'eye' : v.label.toUpperCase().includes('GEL') ? 'health' : 'virus') : 'lock';
      if (ico.dataset.g !== gk) { ico.innerHTML = glyph(gk); ico.dataset.g = gk; }
      if (v?.active) activeLabel = v.label;
    }
    this.bannerLeft = Math.max(0, this.bannerLeft - dt);
    q.banner.textContent = (activeLabel || s.slots[0]?.label || 'ABILITIES').toUpperCase();
    q.banner.classList.toggle('lit', this.bannerLeft > 0 || !!activeLabel);

    q.ammo.textContent = s.reloading > 0 ? 'REGROW' : String(s.ammo);
    q.ammoBox.classList.toggle('low', s.ammo < s.magazine * 0.2);
    const ec = ringLen(40);
    const er = q.egoRing as unknown as SVGCircleElement;
    er.style.strokeDasharray = `${ec}`;
    er.style.strokeDashoffset = `${ec * (1 - s.ego)}`;
    q.ego.classList.toggle('ready', s.egoReady);

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
    this.drawScanner(s);
    if (s.phase !== this.lastPhase) this.lastPhase = s.phase;
  }

  /** Gear chips over the weapon panel: only what is carried, with its key and count. */
  private updateGear(s: HudView): void {
    const have = GEAR.map(([key, item, label]) => ({ key, item, label, n: s.carried.filter((c) => c.item === item).reduce((a, c) => a + c.count, 0) })).filter((g) => g.n > 0);
    const k = have.map((g) => `${g.item}${g.n}`).join(',');
    if (k === this.gearKey) return;
    this.gearKey = k;
    this.q.gear.innerHTML = have.map((g) => `<div class="gchip">${g.key ? `<kbd>${g.key}</kbd>` : ''}<i>${itemIcon(g.item)}</i><span>${g.label}</span><b>×${g.n}</b></div>`).join('');
  }

  /** Boss bar under the objective: bone-and-flesh sinew, a pale damage ghost, one notch per brood wave. */
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

  private drawScanner(s: HudView): void {
    const c = this.sctx;
    if (!c) return;
    const W = 220, R = 100, cx = W / 2, cy = W / 2, sc = s.scanner;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, ZONE7.void); g.addColorStop(0.7, `${ZONE7.violet}55`); g.addColorStop(1, HIVE.background);
    c.fillStyle = g; c.fillRect(0, 0, W, W);
    // Swirling psych-wave spiral (reference 04's living map).
    c.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      c.strokeStyle = [ZONE7.cyan, ZONE7.violet, ZONE7.magenta][i];
      c.globalAlpha = 0.2;
      c.beginPath();
      for (let t = 0; t < 1; t += 0.01) {
        const a = t * Math.PI * 6 + this.time * (0.4 + i * 0.15) + (i * Math.PI * 2) / 3;
        const rr = t * R * 0.95 + Math.sin(t * 20 + this.time * 2) * 2;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (t === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    const sweep = (this.time * 1.5) % (Math.PI * 2);
    if ('createConicGradient' in c) {
      const sg = c.createConicGradient(sweep, cx, cy);
      sg.addColorStop(0, `${HIVE.bone}38`); sg.addColorStop(0.08, `${HIVE.bone}00`); sg.addColorStop(1, `${HIVE.bone}00`);
      c.fillStyle = sg; c.fillRect(0, 0, W, W);
    }
    const k = R / sc.range;
    const fx = -Math.sin(sc.yaw), fz = -Math.cos(sc.yaw), rx = Math.cos(sc.yaw), rz = -Math.sin(sc.yaw);
    const toScreen = (x: number, z: number): [number, number] => { const dx = x - sc.x, dz = z - sc.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k]; };
    const edge = (p: [number, number]): [number, number] => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy); return d > R - 10 ? [cx + (dx / d) * (R - 10), cy + (dy / d) * (R - 10)] : p; };
    for (const pod of sc.pods) {
      if (pod.opened) continue;
      const [x, y] = edge(toScreen(pod.x, pod.z));
      c.fillStyle = PATH.dna; c.shadowColor = PATH.dna; c.shadowBlur = 8; c.beginPath(); c.ellipse(x, y, 3.5, 5, 0, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    }
    for (const p of sc.pings) {
      const [x, y] = toScreen(p.x, p.z);
      if (Math.hypot(x - cx, y - cy) > R) continue;
      c.fillStyle = HIVE.danger; c.shadowColor = HIVE.danger; c.shadowBlur = 8;
      c.globalAlpha = p.revealed ? 1 : 0.65;
      c.beginPath(); c.arc(x, y, p.kind === 'bilecantor' || p.kind === 'mournback' ? 5 : 3, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
    for (const ex of sc.extracts ?? [{ ...sc.extract, open: true }]) {
      const [x, y] = edge(toScreen(ex.x, ex.z));
      c.strokeStyle = ex.open === false ? `${ZONE7.lime}55` : `${ZONE7.lime}cc`; c.lineWidth = 1.6; c.shadowColor = ZONE7.lime; c.shadowBlur = 4;
      c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 7); c.lineTo(x - 6, y); c.closePath(); c.stroke(); c.shadowBlur = 0;
    }
    c.fillStyle = HIVE.acid;
    c.beginPath(); c.moveTo(cx, cy - 8); c.lineTo(cx + 5, cy + 5); c.lineTo(cx - 5, cy + 5); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = s.collapse ? HIVE.danger : `${HIVE.bone}66`; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  }
}
