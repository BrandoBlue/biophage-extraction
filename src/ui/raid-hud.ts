/**
 * Spore in-raid HUD. Reads Raid.hud() each frame and listens to gameplay events; never touches game objects.
 * Interim build by Gameplay Engineering; the UI & HUD department rebuilds it to the Art Bible in wave 2.
 */
import { HIVE, PATH, ZONE7 } from '../render/palette';
import type { EventBus, GameEvents } from '../game/events';
import type { HudState } from '../game/raid';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

function el(tag: string, cls: string, html = ''): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class RaidHud {
  private root = $('#hud');
  private biomassFill = $('#biomass');
  private neuralFill = $('#neural');
  private biomassValue: HTMLElement;
  private eye: HTMLElement;
  private scanner: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private timer: HTMLElement;
  private objective: HTMLElement;
  private slots: HTMLElement;
  private ammo: HTMLElement;
  private egoRing: SVGCircleElement;
  private egoLabel: HTMLElement;
  private loot: HTMLElement;
  private interact: HTMLElement;
  private extractRing: HTMLElement;
  private hitmarker: HTMLElement;
  private veins: Record<'n' | 's' | 'e' | 'w', HTMLElement>;
  private toast: HTMLElement;
  private results: HTMLElement;
  private prompt = $('#prompt');
  private toastLeft = 0;
  private hitLeft = 0;
  private veinLeft = { n: 0, s: 0, e: 0, w: 0 };
  private time = 0;
  private lastPhase = '';

  constructor(bus: EventBus<GameEvents>, private onDeployAgain: () => void) {
    const css = document.documentElement.style;
    for (const [k, v] of Object.entries({ ...HIVE, ...ZONE7 })) css.setProperty(`--${k}`, v);
    for (const [k, v] of Object.entries(PATH)) css.setProperty(`--path-${k}`, v);
    this.root.classList.add('raid');

    // Vitals: eyeball portrait + values.
    const vitals = $('#vitals');
    this.eye = el('div', 'eye', '<div class="iris"><div class="pupil"></div></div><span class="lvl">INFILTRATOR</span>');
    vitals.prepend(this.eye);
    this.biomassValue = el('span', 'value', '200/200');
    $('.bar label', vitals).append(this.biomassValue);

    // Scanner.
    const scan = el('div', 'scanner', '<canvas width="220" height="220"></canvas><label>PSYCH-WAVE SCANNER</label>');
    this.scanner = $('canvas', scan) as HTMLCanvasElement;
    this.sctx = this.scanner.getContext('2d')!;
    this.root.append(scan);

    // Top centre: timer + objective.
    const top = el('div', 'topbar', '<div class="timer">10:00</div><div class="objective"></div>');
    this.timer = $('.timer', top); this.objective = $('.objective', top);
    this.root.append(top);

    // Ability slots.
    this.slots = el('div', 'slots');
    for (let i = 1; i <= 5; i++) this.slots.append(el('div', 'slot locked', `<div class="cd"></div><span class="name"></span><span class="count"></span><kbd>[${i}]</kbd>`));
    this.root.append(this.slots);

    // Weapon panel.
    const weapon = el('div', 'weapon', `
      <div class="wname">SYNAPSE BURSTER</div>
      <div class="ammo"><b>42</b> / ∞ <small>SPORES</small></div>
      <div class="ego"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42"/></svg><span>EGO<br/>CHARGE</span></div>`);
    this.ammo = $('.ammo b', weapon);
    this.egoRing = weapon.querySelector('circle.fill') as SVGCircleElement;
    this.egoLabel = $('.ego', weapon);
    this.root.append(weapon);

    // Carried loot.
    this.loot = el('div', 'loot');
    this.root.append(this.loot);

    // Centre feedback.
    this.interact = el('div', 'interact hidden', '<span></span><div class="bar"><div></div></div>');
    this.extractRing = el('div', 'extract-ring hidden', '<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="fill" cx="50" cy="50" r="44"/></svg><span>EXTRACTING</span><b>8.0</b>');
    this.hitmarker = el('div', 'hitmarker');
    this.root.append(this.interact, this.extractRing, this.hitmarker);
    this.veins = { n: el('div', 'vein n'), s: el('div', 'vein s'), e: el('div', 'vein e'), w: el('div', 'vein w') };
    Object.values(this.veins).forEach((v) => this.root.append(v));
    this.toast = el('div', 'toast');
    this.root.append(this.toast);

    this.results = el('div', 'results hidden');
    document.body.append(this.results);

    this.prompt.innerHTML = 'CLICK TO DROP INTO ZONE 7<small>WASD move · SHIFT sprint · C slide/crouch · SPACE jump · LMB fire · RMB aim · F ego charge · R regrow · 1/Q psych-wave pulse · 2 clot gel · E hold to harvest · ESC release</small>';

    bus.on('hit', (e) => { this.hitLeft = 0.18; this.hitmarker.className = `hitmarker on${e.weakPoint ? ' weak' : ''}${e.kill ? ' kill' : ''}`; });
    bus.on('damaged', (e) => {
      if (!e.direction) { for (const k of ['n', 's', 'e', 'w'] as const) this.veinLeft[k] = 0.6; return; }
      // direction is world-space; the HUD rotates it into view space using the scanner yaw.
      this.pendingHit = e.direction;
    });
    bus.on('overload', () => this.say('OVERLOADED', 'violet'));
    bus.on('abilityDenied', (e) => this.say(e.reason === 'overloaded' ? 'OVERLOADED' : e.reason === 'empty' ? 'NONE CARRIED' : 'RECHARGING'));
    bus.on('pickup', (e) => this.say(`HARVESTED ${e.items.map((i) => (i.count > 1 ? `${i.count}× ` : '') + i.item.replace(/([A-Z])/g, ' $1')).join(' · ')}`.toUpperCase(), 'cyan'));
    bus.on('collapseWarning', () => this.say('ZONE COLLAPSE IN 2:00 · EXTRACT NOW', 'danger', 4));
    bus.on('extractStart', (e) => this.say(`${e.label.toUpperCase()} SIGNAL · HOLD THE ZONE`, 'lime'));
    bus.on('extractCancel', () => this.say('EXTRACTION INTERRUPTED', 'danger'));
    bus.on('alert', () => { this.eye.classList.add('alarm'); setTimeout(() => this.eye.classList.remove('alarm'), 600); });
  }

  private pendingHit: { x: number; z: number } | null = null;

  private say(text: string, tone = 'acid', seconds = 2): void {
    this.toast.textContent = text;
    this.toast.className = `toast on ${tone}`;
    this.toastLeft = seconds;
  }

  update(dt: number, s: HudState): void {
    this.time += dt;
    this.root.classList.toggle('briefing', s.phase === 'briefing');
    this.biomassFill.style.width = `${(s.biomass / s.biomassMax) * 100}%`;
    this.biomassValue.textContent = `${Math.ceil(s.biomass)}/${s.biomassMax}`;
    this.neuralFill.style.width = `${s.overload * 100}%`;
    this.neuralFill.parentElement!.parentElement!.classList.toggle('hot', s.overload > 0.75);
    this.neuralFill.parentElement!.parentElement!.classList.toggle('over', s.overloaded);
    this.eye.style.setProperty('--dilate', String(0.35 + s.overload * 0.5));
    this.eye.classList.toggle('hurt', s.biomass / s.biomassMax < 0.3);
    this.eye.classList.toggle('over', s.overloaded);

    this.timer.textContent = fmtTime(s.timeLeft);
    this.timer.classList.toggle('collapse', s.collapse);
    this.objective.textContent = s.extract.inside ? `HOLD ${s.extract.label.toUpperCase()}` : `EXTRACT · ${s.extract.label.toUpperCase()} · ${Math.round(s.extract.distance)} M`;

    // Slots.
    const slotEls = this.slots.children;
    for (let i = 0; i < 5; i++) {
      const v = s.slots.find((x) => x.slot === i + 1);
      const e = slotEls[i] as HTMLElement;
      e.className = `slot${v ? '' : ' locked'}${v && !v.usable ? ' dim' : ''}${v?.active ? ' active' : ''}`;
      $('.name', e).textContent = v ? v.label : 'LOCKED';
      $('.count', e).textContent = v && v.count !== null ? `×${v.count}` : '';
      ($('.cd', e)).style.height = `${(v?.cooldownFrac ?? 0) * 100}%`;
    }

    this.ammo.textContent = s.reloading > 0 ? 'REGROW' : String(s.ammo);
    this.ammo.parentElement!.classList.toggle('low', s.ammo < s.magazine * 0.2);
    const circ = 2 * Math.PI * 42;
    this.egoRing.style.strokeDasharray = `${circ}`;
    this.egoRing.style.strokeDashoffset = `${circ * (1 - s.ego)}`;
    this.egoLabel.classList.toggle('ready', s.egoReady);

    // Loot.
    const lootHtml = s.carried.map((c) => `<div class="chip ${c.kind}"><i></i>${c.label}${c.count > 1 ? ` ×${c.count}` : ''}</div>`).join('')
      + `<div class="haul">DNA ${s.dna} · HAUL ${s.value}</div>`;
    if (this.loot.dataset.html !== lootHtml) { this.loot.innerHTML = lootHtml; this.loot.dataset.html = lootHtml; }

    // Interaction and extraction.
    this.interact.classList.toggle('hidden', !s.interact);
    if (s.interact) { $('span', this.interact).textContent = s.interact.text; ($('.bar div', this.interact)).style.width = `${s.interact.progress * 100}%`; }
    this.extractRing.classList.toggle('hidden', !s.extract.inside || s.phase !== 'raid');
    const ec = 2 * Math.PI * 44;
    const ef = this.extractRing.querySelector('circle.fill') as SVGCircleElement;
    ef.style.strokeDasharray = `${ec}`;
    ef.style.strokeDashoffset = `${ec * (1 - s.extract.progress)}`;
    $('b', this.extractRing).textContent = ((1 - s.extract.progress) * 8).toFixed(1);

    // Hit-marker and damage veins.
    this.hitLeft -= dt;
    if (this.hitLeft <= 0) this.hitmarker.className = 'hitmarker';
    if (this.pendingHit) {
      // Rotate world direction into view: forward is (-sin yaw, -cos yaw).
      const fx = -Math.sin(s.scanner.yaw), fz = -Math.cos(s.scanner.yaw);
      const rx = Math.cos(s.scanner.yaw), rz = -Math.sin(s.scanner.yaw);
      const f = this.pendingHit.x * fx + this.pendingHit.z * fz, r = this.pendingHit.x * rx + this.pendingHit.z * rz;
      const key = Math.abs(f) > Math.abs(r) ? (f > 0 ? 'n' : 's') : (r > 0 ? 'e' : 'w');
      this.veinLeft[key] = 0.8;
      this.pendingHit = null;
    }
    for (const k of ['n', 's', 'e', 'w'] as const) {
      this.veinLeft[k] = Math.max(0, this.veinLeft[k] - dt);
      this.veins[k].style.opacity = String(Math.min(1, this.veinLeft[k] * 1.6) + (s.biomass / s.biomassMax < 0.3 ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0));
    }
    this.toastLeft -= dt;
    if (this.toastLeft <= 0) this.toast.classList.remove('on');

    this.drawScanner(s);

    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      if (s.phase === 'raid') this.prompt.innerHTML = 'CLICK TO TAKE CONTROL<small>ESC releases the mouse · the raid keeps running</small>';
    }
  }

  private drawScanner(s: HudState): void {
    const c = this.sctx, W = 220, R = 100, cx = W / 2, cy = W / 2;
    const sc = s.scanner;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, ZONE7.void); g.addColorStop(1, HIVE.background);
    c.fillStyle = g; c.fillRect(0, 0, W, W);
    // Swirling psych-wave rings.
    c.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      c.strokeStyle = i % 2 ? ZONE7.violet : HIVE.acid;
      c.globalAlpha = 0.18 + 0.08 * Math.sin(this.time * 2 + i);
      c.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
        const rr = (i + 1) * 13 + Math.sin(a * 3 + this.time * (1 + i * 0.2) + i) * 3;
        const x = cx + Math.cos(a + this.time * 0.2 * (i % 2 ? 1 : -1)) * rr, y = cy + Math.sin(a) * rr;
        if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    // Sweep.
    const sweep = (this.time * 1.5) % (Math.PI * 2);
    const sg = c.createConicGradient ? c.createConicGradient(sweep, cx, cy) : null;
    if (sg) { sg.addColorStop(0, `${HIVE.acid}59`); sg.addColorStop(0.08, `${HIVE.acid}00`); sg.addColorStop(1, `${HIVE.acid}00`); c.fillStyle = sg; c.fillRect(0, 0, W, W); }

    const k = R / sc.range;
    // World → scanner: rotate so the host's forward points up.
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - sc.x, dz = z - sc.z;
      const fx = -Math.sin(sc.yaw), fz = -Math.cos(sc.yaw);
      const rx = Math.cos(sc.yaw), rz = -Math.sin(sc.yaw);
      return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k];
    };
    const clampEdge = (p: [number, number]): [number, number] => {
      const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy);
      return d > R - 10 ? [cx + (dx / d) * (R - 10), cy + (dy / d) * (R - 10)] : p;
    };
    for (const pod of sc.pods) {
      if (pod.opened) continue;
      const [x, y] = clampEdge(toScreen(pod.x, pod.z));
      c.fillStyle = PATH.dna; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    }
    for (const p of sc.pings) {
      const [x, y] = toScreen(p.x, p.z);
      if (Math.hypot(x - cx, y - cy) > R) continue;
      c.fillStyle = HIVE.danger;
      c.globalAlpha = p.revealed ? 1 : 0.7;
      c.beginPath(); c.arc(x, y, p.kind === 'bilecantor' ? 5 : 3, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    const [ex, ey] = clampEdge(toScreen(sc.extract.x, sc.extract.z));
    c.strokeStyle = ZONE7.lime; c.lineWidth = 2;
    c.beginPath(); c.moveTo(ex, ey - 7); c.lineTo(ex + 6, ey); c.lineTo(ex, ey + 7); c.lineTo(ex - 6, ey); c.closePath(); c.stroke();
    // Host.
    c.fillStyle = HIVE.acid;
    c.beginPath(); c.moveTo(cx, cy - 8); c.lineTo(cx + 5, cy + 5); c.lineTo(cx - 5, cy + 5); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = s.collapse ? HIVE.danger : HIVE.acid; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  }

  showResult(kind: 'extracted' | 'lost', r: { items: { item: string; count: number }[]; dna: number; value: number; cause?: string }, labels: Record<string, string>, kills: number, time: number): void {
    const rows = r.items.map((i) => `<li><span>${labels[i.item] ?? i.item}</span><b>×${i.count}</b></li>`).join('') + `<li><span>Kill DNA</span><b>${r.dna}</b></li>`;
    const won = kind === 'extracted';
    this.results.innerHTML = `
      <div class="panel ${won ? 'won' : 'lost'}">
        <h1>${won ? 'EXTRACTED' : 'HOST LOST'}</h1>
        <p class="sub">${won ? 'The Seed Spire carried your haul out of Zone 7.' : `Biomass depleted${r.cause ? ` · ${r.cause}` : ''}. Everything you carried is gone.`}</p>
        <h2>${won ? 'HAUL BANKED' : 'LOST WITH THE HOST'}</h2>
        <ul>${rows}</ul>
        <div class="total"><span>${won ? 'HAUL VALUE' : 'VALUE LOST'}</span><b>${r.value} DNA</b></div>
        <div class="stats">KILLS ${kills} · TIME ${fmtTime(time)}</div>
        <button class="cta" id="deploy-again">DEPLOY AGAIN<small>PVPVE ZONE · DEATH LOSES YOUR LOADOUT</small></button>
      </div>`;
    this.results.classList.remove('hidden');
    this.results.classList.add(kind);
    $('#deploy-again', this.results).addEventListener('click', () => this.onDeployAgain());
    addEventListener('keydown', (e) => { if (e.code === 'Enter') this.onDeployAgain(); }, { once: true });
  }
}
