/**
 * Game audio (Audio department): listens to the raid's event bus and reads the raid each frame, and turns it into
 * sound: weapons and reload beats, creature voices placed in 3D, bosses, footsteps, the host's body, zone ambience,
 * the adaptive score and the Hive's UI. The AudioContext starts on the first click or key press (browser autoplay
 * rules); until then everything is skipped at no cost.
 */
import * as THREE from 'three';
import { BOSSES, WEAPONS, WEAPON_FEEL } from '../../data';
import type { Raid } from '../game/raid';
import { AUDIO, ambienceFor, type Weight } from './config';
import { AudioEngine, volumeGain, type Bus, type V3 } from './engine';
import { Ambience } from './ambience';
import { EdgeMurk, edgeLevel } from './edge';
import { Music, flavourFor } from './music';
import { Intensity, Stride, behind, stepLevel, surfaceFor, threatLevel, weightOf } from './director';
import * as S from './sfx';
import { gunShot, weaponSwap } from './guns';
import { bossAttack, bossVoice, ribWind, speciesVoice, stalkWarn } from './voices';

export interface GameAudioOptions {
  /** Zone actually built (data/zones.json id). */
  zone: string;
  /** Host class id picked in the Hive (profile.host). */
  hostClass(): string;
  /** True while a Hive screen covers the game. */
  menuVisible(): boolean;
  /** True where the host is underground or indoors (caves, hull): reverb, ambience and footsteps change. */
  enclosed?(x: number, z: number): boolean;
  /** Ambience region where the zone has several (a Marrow Pit layer: 'pitRim', 'pitDeep'...), else null. */
  region?(x: number, y: number, z: number): string | null;
  /** Depth dread 0..1 (Marrow Pit: 0 at the rim, 1 on the floor). */
  depth?(x: number, y: number, z: number): number;
  /** Playable radius round (0, 0) where the map's edge murk begins (0 = no edge, e.g. the Wreck). */
  edgeRadius?: number;
  /** Master volume 0..1 (Settings). */
  volume(): number;
}

interface WeaponInfo { class?: string; magazine?: number; reload?: { style: 'magazine' | 'perShell' | 'regrow'; time: number; perShellTime?: number } }

const v = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3();

export class GameAudio {
  engine: AudioEngine | null = null;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  private edge: EdgeMurk | null = null;
  private intensity = new Intensity();
  private stride = new Stride();
  private lastPos = new THREE.Vector3();
  private wasGrounded = true;
  private peakY = 0;
  private voiceAt = new Map<number, number>();
  private stepAt = new Map<number, number>();
  private warnAt = 0;
  private heartAt = 0;
  private healAt = 0;
  private bossHurtAt = 0;
  private ribAt = 0;
  private bossActive: string | null = null;
  private hush = 0;
  private reloadGain: GainNode | null = null;
  private riser: GainNode | null = null;
  private enclosedNow = false;
  private regionNow: string | null = null;
  private weight: Weight = 'medium';
  private onSettings = () => this.applyVolume();

  constructor(private raid: Raid, private opt: GameAudioOptions) {
    const unlock = () => this.unlock();
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    addEventListener('biophage:settings', this.onSettings);
    this.bindEvents();
    this.bindUi();
  }

  /** Creates (or resumes) the AudioContext. Must run inside a user gesture. */
  unlock(): void {
    if (this.engine) { if (this.engine.ctx instanceof AudioContext && this.engine.ctx.state === 'suspended') void this.engine.ctx.resume(); return; }
    const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.engine = new AudioEngine(ctx);
      this.music = new Music(this.engine);
      this.ambience = new Ambience(this.engine);
      this.edge = new EdgeMurk(this.engine);
      this.applyVolume();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch (err) {
      console.warn('audio unavailable', err);
    }
  }

  private applyVolume(): void {
    if (!this.engine) return;
    this.engine.master.gain.setTargetAtTime(AUDIO.mix.master * volumeGain(this.opt.volume()), this.engine.now, 0.05);
  }

  /** Plays a recipe now (or `delay` seconds from now), at a world position or straight into a bus. */
  play(recipe: S.Recipe, at: V3 | null = null, o: { bus?: Bus; level?: number; priority?: number; near?: number; delay?: number; into?: AudioNode } = {}): void {
    const e = this.engine;
    if (!e || !e.claim(1.5, o.priority ?? 1)) return;
    const g = e.ctx.createGain();
    g.gain.value = o.level ?? 1;
    g.connect(o.into ?? (at ? e.at(at, 3, o.bus ?? 'sfx', o.near ?? 1) : e.buses[o.bus ?? 'sfx']));
    recipe(e.x, g, e.now + 0.01 + (o.delay ?? 0));
  }

  /** Somewhere just around the host (for sounds with a direction but no position). */
  private around(dir: V3 | null, dist = 2): V3 {
    // Events can arrive before the first click has started audio (an online guest tab): `play` then skips them.
    const L = this.engine?.listener ?? { x: 0, y: 0, z: 0 };
    if (!dir) return { x: L.x, y: L.y, z: L.z };
    const n = Math.hypot(dir.x, dir.z) || 1;
    return { x: L.x + (dir.x / n) * dist, y: L.y, z: L.z + (dir.z / n) * dist };
  }

  private bossPos(id: string): V3 | null {
    const b = this.raid.boss && this.raid.boss.id === id ? this.raid.boss : this.raid.vigil && this.raid.vigil.id === id ? this.raid.vigil : null;
    return b ? b.centre(new THREE.Vector3()) : null;
  }

  private bindEvents(): void {
    const bus = this.raid.bus;
    bus.on('shot', (e) => {
      const w = WEAPONS[e.weapon] as WeaponInfo | undefined;
      // Each gun has its own voice; grafts fitted to the held gun (mods.json) change it.
      const held = this.raid.weapon;
      const mods = held && held.id === e.weapon ? held.spec.mods : [];
      const fire = gunShot(e.weapon, mods, S.FIRE[w?.class ?? 'carbine'] ?? S.FIRE.carbine);
      this.play((x, o, t) => fire(x, o, t, e.ego), null, { priority: 2 });
      // A shot cuts any reload still running.
      if (this.reloadGain && this.engine) { this.reloadGain.gain.setTargetAtTime(0, this.engine.now, 0.02); this.reloadGain = null; }
    });
    bus.on('reload', (e) => this.reload(e.weapon, e.time));
    bus.on('weaponSwap', () => this.play(weaponSwap, null, { priority: 2 }));
    bus.on('hit', (e) => {
      if (!e.kill) this.play(e.weakPoint ? S.weakHit : S.fleshHit, e.position, { priority: 1 });
      this.play(S.hitTick(e.weakPoint), null, { priority: 2, level: 0.8 });
    });
    bus.on('damaged', (e) => {
      this.play(S.hurt(e.amount >= 15), null, { priority: 2 });
      if (e.direction) this.play(S.fleshHit, this.around(e.direction), { priority: 1, level: 0.6 });
      this.intensity.kick();
    });
    bus.on('healed', () => { const e = this.engine; if (e && e.now > this.healAt) { this.healAt = e.now + 2.5; this.play(S.heal, null, { level: 0.8 }); } });
    bus.on('overload', () => this.play(S.overloadHit, null, { priority: 2 }));
    bus.on('alert', (e) => { this.play(speciesVoice(e.type).hunt, e.position, { priority: 1 }); this.voiceAt.set(e.id, (this.engine?.now ?? 0) + 2); });
    bus.on('attack', (e) => this.play(speciesVoice(e.type).attack, e.position, { priority: 2 }));
    bus.on('creatureDeath', (e) => this.play(speciesVoice(e.type).death, e.position, { priority: 2 }));
    bus.on('creatureReveal', (e) => {
      this.play(S.burst(e.how), e.position, { priority: 2 });
      this.play(speciesVoice(e.type).hunt, e.position, { priority: 1, delay: 0.3 });
      this.intensity.kick(0.25);
    });
    bus.on('ability', () => this.play(S.ability));
    bus.on('abilityDenied', () => this.play(S.denied, null, { bus: 'ui' }));
    bus.on('containerOpenStart', () => this.play(S.membraneTear, this.around(null)));
    bus.on('pickup', (e) => { this.play(S.pickup); if (e.dna > 0) this.play(S.dnaChime, null, { delay: 0.08 }); });
    bus.on('cavityFull', () => this.play(S.cavityFull, null, { bus: 'ui' }));
    bus.on('inventoryChanged', () => this.play(S.pickup, null, { bus: 'ui', level: 0.6 }));
    bus.on('virusInjectStart', () => this.play(S.injectStart));
    bus.on('virusInjectCancel', () => this.play(S.injectCancel));
    bus.on('virusInjected', () => this.play(S.mutation, null, { priority: 2 }));
    bus.on('harvestStart', () => this.play(S.harvest));
    bus.on('harvestDone', () => this.play(S.RELOAD_CUES.rip));
    bus.on('melee', (e) => this.play(e.hit !== null ? S.meleeHit : S.meleeSwing, null, { priority: 2 }));
    bus.on('gearUsed', () => this.play(S.throwGear));
    bus.on('explosion', (e) => { this.play(S.explosion, e.position, { priority: 2, near: 3 }); this.intensity.kick(0.3); });
    bus.on('reviving', () => this.play(S.revive, null, { priority: 2 }));
    bus.on('revived', () => this.play(S.heal, null, { priority: 2 }));
    bus.on('extractOpened', (e) => {
      const L = this.engine?.listener;
      this.play(S.spireCall, { x: e.x, y: (L?.y ?? 0) + 8, z: e.z }, { priority: 2, near: 12 });
    });
    bus.on('extractStart', (e) => {
      const en = this.engine;
      if (!en) return;
      this.riser?.gain.setTargetAtTime(0, en.now, 0.1);
      const g = en.ctx.createGain();
      g.connect(en.buses.sfx);
      this.riser = g;
      this.play(S.extractRiser(e.time), null, { priority: 2, into: g });
    });
    bus.on('extractCancel', () => { if (this.riser && this.engine) { this.riser.gain.setTargetAtTime(0, this.engine.now, 0.15); this.riser = null; } });
    bus.on('extractDone', () => { this.riser = null; this.play(S.extractDone, null, { priority: 3 }); this.music?.start('off'); });
    bus.on('death', () => { this.play(S.death, null, { priority: 3 }); this.music?.start('off'); });
    bus.on('raidStart', () => { this.play(S.dropIn, null, { priority: 2 }); this.intensity.value = 0; });
    bus.on('collapseWarning', () => this.play(S.collapseHorn, null, { priority: 3 }));
    bus.on('nestAwake', () => { this.play(S.nestPulse, null, { priority: 2 }); this.intensity.kick(0.4); });
    bus.on('nestWave', () => this.play(speciesVoice('needlemaw').hunt, null, { priority: 1 }));
    bus.on('nestDestroyed', () => this.play(S.nestCollapse, null, { priority: 2 }));
    bus.on('bossAwake', (e) => { this.bossActive = e.boss; this.play(bossVoice(e.boss).wake, this.bossPos(e.boss), { priority: 3, near: 6 }); });
    bus.on('bossPhase', (e) => this.play(bossVoice(e.boss).phase, this.bossPos(e.boss), { priority: 3, near: 6 }));
    bus.on('bossEnraged', (e) => this.play(bossVoice(e.boss).enrage, this.bossPos(e.boss), { priority: 3, near: 6 }));
    bus.on('bossAttack', (e) => this.play(bossAttack(e.boss, e.attack), this.bossPos(e.boss), { priority: 2, near: 5 }));
    bus.on('bossDamaged', (e) => {
      const en = this.engine;
      if (!en) return;
      this.play(e.weakPoint ? S.weakHit : S.fleshHit, this.bossPos(e.boss), { near: 3 });
      if (en.now > this.bossHurtAt) { this.bossHurtAt = en.now + 1.2; this.play(bossVoice(e.boss).hurt, this.bossPos(e.boss), { near: 5 }); }
    });
    bus.on('bossPartDestroyed', (e) => this.play(S.killBurst, this.bossPos(e.boss), { priority: 2, near: 4 }));
    bus.on('bossCoverBroken', (e) => this.play(bossAttack(e.boss, 'coverBreak'), this.bossPos(e.boss), { priority: 2, near: 5 }));
    bus.on('bossDefeated', (e) => { this.play(bossVoice(e.boss).defeated, this.bossPos(e.boss), { priority: 3, near: 8 }); this.bossActive = null; });
  }

  /** Reload beats from data/weapon-feel.json, timed to the weapon's reload. */
  private reload(weapon: string, time: number): void {
    const e = this.engine;
    if (!e) return;
    const w = WEAPONS[weapon] as WeaponInfo | undefined;
    const style = w?.reload?.style ?? 'regrow';
    const feel = WEAPON_FEEL.reload[style];
    if (!feel) return;
    this.reloadGain?.gain.setTargetAtTime(0, e.now, 0.02);
    const g = e.ctx.createGain();
    g.connect(e.buses.sfx);
    this.reloadGain = g;
    const cue = (name: string, delay: number) => { const r = S.RELOAD_CUES[name]; if (r) this.play(r, null, { into: g, delay, priority: 2 }); };
    if (style === 'perShell') {
      const per = w?.reload?.perShellTime ?? 0.5, open = feel.openAndCloseTime ?? 0.25;
      const shells = Math.max(1, (w?.magazine ?? 1) - this.raid.weapon.state.ammo);
      const [first, mid, last] = feel.beats;
      cue(first.cue, 0);
      for (let i = 0; i < Math.min(shells, 12); i++) cue(mid.cue, open + i * per + per * mid.at);
      cue(last.cue, open + Math.min(shells, 12) * per);
    } else {
      for (const b of feel.beats) cue(b.cue, b.at * time);
    }
  }

  /** Hive UI: hover and click sounds for every button and tab, deploy gets its own swell. */
  private bindUi(): void {
    let last: Element | null = null;
    const target = (ev: Event) => (ev.target instanceof Element ? ev.target.closest('button, .tab, [role="button"], .slot, .cell, a') : null);
    document.addEventListener('pointerover', (ev) => {
      const el = target(ev);
      if (!el || el === last || !this.opt.menuVisible()) return;
      last = el;
      this.play(S.uiHover, null, { bus: 'ui', priority: 0 });
    });
    document.addEventListener('click', (ev) => {
      const el = target(ev);
      if (!el || !this.engine) return;
      const deploy = el.id === 'deploy';
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
      this.play(deploy ? S.uiDeploy : disabled ? S.uiError : el.classList.contains('tab') ? S.uiTab : S.uiClick, null, { bus: 'ui', priority: 2 });
    });
  }

  update(dt: number, camera: THREE.Camera): void {
    const e = this.engine, music = this.music, amb = this.ambience;
    if (!e || !music || !amb) return;
    const now = e.now;
    camera.getWorldPosition(v);
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    e.setListener(v, fwd, up);

    const raid = this.raid, live = raid.phase === 'raid' && !this.opt.menuVisible();
    if (!live) {
      if (this.opt.menuVisible()) { music.start('hive'); amb.set(ambienceFor('hive')); }
      e.duck('music', 1); e.duck('ambience', 1);
      e.muffle.frequency.setTargetAtTime(20000, now, 0.3);
      music.update(now, 0, false);
      amb.update(now);
      this.edge?.update(now, 0, 0, 0);
      return;
    }
    music.start('raid');
    music.flavour = flavourFor(this.opt.zone);
    const p = raid.player.position;
    const dread = Math.max(0, Math.min(1, this.opt.depth?.(p.x, p.y, p.z) ?? 0));
    music.dread = dread;
    amb.dread = dread;
    this.weight = weightOf(this.opt.hostClass());
    this.enclosedNow = this.opt.enclosed?.(p.x, p.z) ?? false;
    const region = this.opt.region?.(p.x, p.y, p.z) ?? null;
    this.regionNow = region;
    amb.set(ambienceFor(region ?? (this.enclosedNow && !/wreck|pit/i.test(this.opt.zone) ? 'cave' : this.opt.zone)));

    this.footsteps(p);
    this.creatures(now, p, fwd);

    // Danger → music intensity. A boss in range pins it high.
    const threats = raid.creatures.filter((c) => c.alive).map((c) => ({ x: c.position.x, z: c.position.z, engaged: c.engaged }));
    let target = threatLevel(threats, p.x, p.z);
    const frac = raid.biomass.current / Math.max(1, raid.biomass.max);
    target = Math.max(target, frac < 0.35 ? 0.4 : 0);
    if (raid.extract.progress > 0) target = Math.max(target, 0.45);
    const bossNear = !!this.bossActive && (() => { const b = this.bossPos(this.bossActive!); return !!b && Math.hypot(b.x - p.x, b.z - p.z) < 70; })();
    for (const n of raid.nests) if ((n.state as string) === 'active' && Math.hypot(n.position.x - p.x, n.position.z - p.z) < 40) target = Math.max(target, 0.7);
    // The deeper into the pit, the less the music lets you relax.
    target = Math.max(target, dread * AUDIO.pitDepth.intensityFloor);
    const intensity = this.intensity.update(dt, target);

    // The sleeping Reliquary: wind through its ribs carries across the island (Design: songRadius).
    const rq = raid.boss;
    if (rq && rq.alive && !rq.awake && now >= this.ribAt) {
      this.ribAt = now + e.x.range(7, 13);
      const song = (BOSSES[rq.id] as { songRadius?: number } | undefined)?.songRadius ?? 120;
      if (Math.hypot(rq.position.x - p.x, rq.position.z - p.z) < song) this.play(ribWind, rq.centre(new THREE.Vector3()), { priority: 0, near: 14, bus: 'ambience' });
    }

    // The Pale Vigil: the world goes quiet when it is close. Silence is the warning.
    let hush = 0;
    const vg = raid.vigil;
    if (vg && vg.alive) {
      const d = Math.hypot(vg.position.x - p.x, vg.position.z - p.z);
      const phase = vg.brain.phase?.id;
      if (vg.awake && (vg.brain.hidden || phase === 'stalk') && d < 35) hush = 1;
      else if (!vg.awake && d < vg.lair.radius + 6) hush = 0.6;
    }
    this.hush += (hush - this.hush) * Math.min(1, dt * (hush > this.hush ? 1.5 : 0.4));
    const duck = 1 - this.hush * AUDIO.music.hushDuck;
    // The edge of the map: the murk's own sound fades in and the music thins out.
    const edge = this.enclosedNow && this.opt.zone !== 'marrowPit' ? 0 : edgeLevel(p.x, p.z, this.opt.edgeRadius ?? 0);
    this.edge?.update(now, edge, p.x, p.z);
    e.duck('music', duck * (1 - edge * AUDIO.edge.musicDuck), 0.5);
    e.duck('ambience', duck, 0.5);
    music.update(now, this.hush > 0.5 ? Math.min(intensity, AUDIO.music.tension + 0.1) : intensity, bossNear);
    amb.update(now);

    // Near death: the world muffles and your heart is all you hear.
    const M = AUDIO.mix;
    e.muffle.frequency.setTargetAtTime(frac < M.lowHealthMuffleAt ? M.lowHealthCutoff + (frac / M.lowHealthMuffleAt) * 4000 : 20000, now, 0.3);
    const deepHeart = dread >= AUDIO.pitDepth.heartbeatFrom;
    if ((frac < 0.35 || this.hush > 0.5 || deepHeart) && now >= this.heartAt) {
      const bpm = frac >= 0.35 ? (this.hush > 0.5 ? 64 : 56) : 70 + (1 - frac / 0.35) * 60;
      this.heartAt = now + 60 / bpm;
      this.play((x, o, t) => S.heartbeat(x, o, t, frac >= 0.35 && this.hush <= 0.5 ? 0.35 : 0.55), null, { priority: 3, bus: 'ui' });
    }
  }

  private footsteps(p: THREE.Vector3): void {
    const pl = this.raid.player;
    const dist = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos.copy(p);
    const surface = this.regionNow === 'pitDeep' ? 'flesh' : surfaceFor(this.opt.zone, this.enclosedNow);
    if (pl.grounded && !this.wasGrounded) {
      const fall = this.peakY - p.y;
      if (fall > AUDIO.footsteps.landMinFall) this.play((x, o, t) => S.land(x, o, t, surface, this.weight, fall), null, { priority: 2 });
    }
    if (!pl.grounded) {
      if (this.wasGrounded) { this.peakY = p.y; if (pl.velocity.y > 1) this.play(S.jump); }
      this.peakY = Math.max(this.peakY, p.y);
    }
    this.wasGrounded = pl.grounded;
    if (dist > 3) return; // teleport or respawn
    if (this.stride.update(dist, this.weight, pl.sprinting, pl.grounded)) {
      const level = stepLevel(this.weight, pl.crouched, pl.sprinting);
      this.play((x, o, t) => S.footstep(x, o, t, surface, this.weight, level), null, { priority: 1 });
    }
  }

  private creatures(now: number, p: THREE.Vector3, look: THREE.Vector3): void {
    const C = AUDIO.creatures;
    const near = this.raid.creatures
      .filter((c) => c.alive && Math.hypot(c.position.x - p.x, c.position.z - p.z) < C.hearing)
      .sort((a, b) => a.position.distanceToSquared(p) - b.position.distanceToSquared(p))
      .slice(0, C.nearest);
    const x = this.engine!.x;
    for (const c of near) {
      const voice = speciesVoice(c.kind);
      const due = this.voiceAt.get(c.id);
      const hunting = c.engaged;
      if (due === undefined) this.voiceAt.set(c.id, now + x.range(0.5, C.idle[1]));
      else if (now >= due) {
        const [a, b] = hunting ? C.hunt : C.idle;
        this.voiceAt.set(c.id, now + x.range(a, b));
        this.play(hunting ? voice.hunt : voice.idle, c.centre, { priority: hunting ? 1 : 0, level: hunting ? 0.9 : 0.7 });
      }
      if (voice.step && c.velocity.lengthSq() > 0.25 && now >= (this.stepAt.get(c.id) ?? 0)) {
        this.stepAt.set(c.id, now + C.heavyStepEvery);
        this.play(voice.step, c.position, { priority: 0, near: 2 });
      }
      // Something closing in behind you gets one faint chitter: fair warning for those who listen.
      if (hunting && now >= this.warnAt && behind(c.position.x, c.position.z, p.x, p.z, look.x, look.z, C.stalkWarnRadius)) {
        this.warnAt = now + 3;
        this.play(stalkWarn, c.centre, { priority: 1, near: 0.6 });
      }
    }
  }

  /** Numbers for tests and the debug overlay. */
  stats(): Record<string, unknown> {
    const e = this.engine;
    return e
      ? { started: true, state: (e.ctx as AudioContext).state, played: e.played, dropped: e.dropped, active: e.active, level: +e.level.toFixed(3), music: this.music?.mode, notes: this.music?.notes, intensity: +this.intensity.value.toFixed(3), hush: +this.hush.toFixed(2), flavour: this.music?.flavour, dread: +(this.ambience?.dread ?? 0).toFixed(2), ambience: this.ambience?.current?.bed ?? null, ambienceCalls: this.ambience?.calls ?? 0, edge: +(this.edge?.level ?? 0).toFixed(2), edgeCalls: this.edge?.calls ?? 0 }
      : { started: false };
  }
}
