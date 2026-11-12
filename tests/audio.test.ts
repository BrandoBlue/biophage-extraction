import { describe, expect, it } from 'vitest';
import { ABOMINATIONS, BOSSES, MODS, WEAPONS, WEAPON_FEEL, ZONES } from '../data';
import { AUDIO, ambienceFor } from '../src/audio/config';
import { AudioEngine, airCutoff, volumeGain } from '../src/audio/engine';
import { Ambience } from '../src/audio/ambience';
import { FLAVOURS, Music, flavourFor, layerLevels, tempo } from '../src/audio/music';
import { Intensity, Stride, behind, stepLevel, surfaceFor, threatLevel, weightOf } from '../src/audio/director';
import * as S from '../src/audio/sfx';
import { GUNS, MOD_SOUNDS, graftTakesHold, gunShot, weaponSwap } from '../src/audio/guns';
import { BOSSES as BOSS_VOICES, EMITTERS, SPECIES, bossVoice, speciesVoice, stalkWarn } from '../src/audio/voices';
import { EdgeMurk, MURK, edgeLevel } from '../src/audio/edge';
import { fakeContext } from './lib/fake-audio';

const rig = () => { const ctx = fakeContext(); const e = new AudioEngine(ctx); return { ctx, e, out: e.buses.sfx }; };

describe('audio coverage', () => {
  it('every weapon class has a firing sound', () => {
    for (const cls of Object.keys(WEAPON_FEEL.fire)) expect(S.FIRE[cls], cls).toBeTypeOf('function');
    for (const [id, w] of Object.entries(WEAPONS)) expect(S.FIRE[(w as { class: string }).class], id).toBeTypeOf('function');
  });
  it('every reload beat cue in weapon-feel.json has a sound', () => {
    for (const style of Object.values(WEAPON_FEEL.reload)) for (const b of style.beats) expect(S.RELOAD_CUES[b.cue], b.cue).toBeTypeOf('function');
  });
  it('every gun has its own voice and every barrel or chamber graft changes it', () => {
    for (const id of Object.keys(WEAPONS)) expect(GUNS[id], id).toBeTypeOf('function');
    for (const [id, m] of Object.entries(MODS)) if (m.slot === 'barrel' || m.slot === 'chamber') expect(MOD_SOUNDS[id], id).toBeDefined();
    const fallback = S.FIRE.carbine;
    expect(gunShot('quillet', [], fallback)).toBe(GUNS.quillet);
    expect(gunShot('somethingNew', [], fallback)).toBe(fallback);
    expect(gunShot('quillet', ['hushGill'], fallback)).not.toBe(GUNS.quillet);
    expect(gunShot('quillet', ['pupilBud'], fallback)).toBe(GUNS.quillet); // sights are silent
  });
  it('every Abomination has its own voice and every boss its own set', () => {
    for (const kind of Object.keys(ABOMINATIONS)) expect(SPECIES[kind], kind).toBeDefined();
    for (const id of Object.keys(BOSSES)) expect(BOSS_VOICES[id], id).toBeDefined();
  });
  it('every zone, the caves and the Hive resolve to an ambience profile with known emitters', () => {
    const ids = [...Object.keys(ZONES), 'cave', 'hive', 'sunbleachedDunes', 'theDeepPit', 'unknownZone', 'pitRim', 'pitCables', 'pitWarrens', 'pitDeep'];
    for (const id of ids) {
      const p = ambienceFor(id);
      expect(p, id).toBeDefined();
      for (const em of p.emitters) expect(EMITTERS[em.kind], `${id}:${em.kind}`).toBeTypeOf('function');
    }
    expect(ambienceFor('sunbleachedDunes')).toBe(AUDIO.zones.desert);
    expect(ambienceFor('theDeepPit')).toBe(AUDIO.zones.pit);
    expect(ambienceFor('glowmireIsle')).toBe(AUDIO.zones.glowmireIsle);
    expect(ambienceFor('weepingFen')).toBe(AUDIO.zones.fen);
    expect(ambienceFor('ochreReach')).toBe(AUDIO.zones.desert);
    expect(ambienceFor('marrowPit')).toBe(AUDIO.zones.pitRim);
  });
});

describe('recipes render without Web Audio errors', () => {
  it('weapons, reloads and host sounds', () => {
    const { e, out } = rig();
    const x = e.x;
    const all: S.Recipe[] = [
      ...Object.values(S.FIRE).flatMap((f) => [(a: typeof x, o: AudioNode, t: number) => f(a, o, t, false), (a: typeof x, o: AudioNode, t: number) => f(a, o, t, true)]),
      ...Object.values(S.RELOAD_CUES), S.fleshHit, S.weakHit, S.killBurst, S.hitTick(true), S.hitTick(false), S.hurt(true), S.hurt(false),
      S.overloadHit, S.heal, S.pickup, S.dnaChime, S.cavityFull, S.membraneTear, S.harvest, S.injectStart, S.injectCancel, S.mutation,
      S.ability, S.denied, S.meleeSwing, S.meleeHit, S.throwGear, S.explosion, S.revive, S.spireCall, S.extractRiser(5), S.extractDone,
      S.death, S.dropIn, S.collapseHorn, S.nestPulse, S.nestCollapse, S.burst('hatch'), S.burst('disguise'), S.burst('ambush'), S.jump,
      S.uiHover, S.uiClick, S.uiTab, S.uiDeploy, S.uiError, S.distantShot, S.dryClick,
    ];
    for (const r of all) { const len = r(x, out, 0.1); expect(len).toBeGreaterThan(0); expect(len).toBeLessThan(15); }
    for (const g of Object.values(GUNS)) for (const ego of [false, true]) { const len = g(x, out, 0.1, ego); expect(len).toBeGreaterThan(0); expect(len).toBeLessThan(8); }
    for (const id of Object.keys(MOD_SOUNDS)) expect(gunShot('vertebraRifle', [id], S.FIRE.rifle)(x, out, 0.1, true), id).toBeGreaterThan(0);
    expect(gunShot('gulletScatter', Object.keys(MOD_SOUNDS), S.FIRE.shotgun)(x, out, 0.1, false)).toBeGreaterThan(0);
    expect(weaponSwap(x, out, 0.1)).toBeGreaterThan(0);
    for (const slot of ['barrel', 'sight', 'under', 'chamber']) expect(graftTakesHold(slot)(x, out, 0.1), slot).toBeGreaterThan(0.5);
    for (const surface of ['moss', 'stone', 'metal', 'sand', 'flesh', 'water'] as const) for (const w of ['light', 'medium', 'heavy'] as const) {
      expect(S.footstep(x, out, 0, surface, w, 1)).toBeGreaterThan(0);
      expect(S.land(x, out, 0, surface, w, 6)).toBeGreaterThan(0);
    }
  });
  it('every creature, boss and ambience one-shot', () => {
    const { e, out } = rig();
    for (const v of [...Object.values(SPECIES), speciesVoice('somethingNew')]) for (const r of [v.idle, v.hunt, v.attack, v.death, v.step]) if (r) expect(r(e.x, out, 0)).toBeGreaterThan(0);
    for (const id of [...Object.keys(BOSS_VOICES), 'unknownBoss']) {
      const b = bossVoice(id);
      for (const r of [b.wake, b.phase, b.enrage, b.defeated, b.hurt, ...Object.values(b.attacks)]) expect(r(e.x, out, 0)).toBeGreaterThan(0);
    }
    for (const r of Object.values(EMITTERS)) expect(r(e.x, out, 0)).toBeGreaterThan(0);
    expect(stalkWarn(e.x, out, 0)).toBeGreaterThan(0);
  });
  it('music runs every mode and intensity, ambience runs every profile', () => {
    const { ctx, e } = rig();
    const m = new Music(e), a = new Ambience(e);
    for (const mode of ['hive', 'raid'] as const) {
      m.start(mode, ctx.currentTime);
      for (let i = 0; i <= 40; i++) { ctx.currentTime += 0.5; m.update(ctx.currentTime, i / 40, i > 30); }
    }
    expect(m.notes).toBeGreaterThan(10);
    for (const id of Object.keys(AUDIO.zones)) { a.set(AUDIO.zones[id], 1); for (let i = 0; i < 60; i++) { ctx.currentTime += 1; a.update(ctx.currentTime); } }
    expect(a.calls).toBeGreaterThan(5);
  });
  it('the engine budgets voices and places sounds in 3D', () => {
    const { e } = rig();
    let ok = 0;
    for (let i = 0; i < 500; i++) if (e.claim(5, 1)) ok++;
    expect(ok).toBe(AUDIO.mix.maxVoices);
    expect(e.claim(5, 3)).toBe(true); // critical sounds still get through
    expect(e.at({ x: 10, y: 0, z: 0 }, 1)).toBeDefined();
  });
});

describe('zones sound distinct', () => {
  it('each built zone has its own music flavour and ambience', () => {
    expect(flavourFor('ochreReach')).toBe('desert');
    expect(flavourFor('weepingFen')).toBe('fen');
    expect(flavourFor('marrowPit')).toBe('pit');
    expect(flavourFor('glowmireIsle')).toBe('default');
    const beds = new Set(['glowmireIsle', 'longSeedWreck', 'ochreReach', 'weepingFen', 'marrowPit'].map((z) => ambienceFor(z)));
    expect(beds.size).toBe(5);
    expect(surfaceFor('ochreReach', false)).toBe('sand');
  });
  it('every flavour plays in explore and combat', () => {
    for (const f of Object.keys(FLAVOURS) as (keyof typeof FLAVOURS)[]) {
      const { ctx, e } = rig();
      const m = new Music(e);
      m.flavour = f;
      m.start('raid', 0);
      for (let i = 0; i <= 60; i++) { ctx.currentTime += 0.5; m.update(ctx.currentTime, i < 30 ? 0.1 : 0.9, false); }
      expect(m.notes, f).toBeGreaterThan(5);
    }
  });
  it('the pit gets more dreadful with depth: dread emitters call more often', () => {
    const count = (dread: number) => {
      const { ctx, e } = rig();
      const a = new Ambience(e);
      a.dread = dread;
      a.set(AUDIO.zones.pitDeep, 1, 0);
      for (let i = 0; i < 600; i++) { ctx.currentTime += 1; a.update(ctx.currentTime); }
      return a.calls;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 1.15);
  });
});

describe('the edge of the map', () => {
  it('fades in from 70% of the playable radius to the edge, and not at all without an edge', () => {
    expect(edgeLevel(0, 0, 200)).toBe(0);
    expect(edgeLevel(AUDIO.edge.from * 200 - 1, 0, 200)).toBe(0);
    const mid = edgeLevel(0, ((AUDIO.edge.from + AUDIO.edge.to) / 2) * 200, 200);
    expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.7);
    expect(edgeLevel(150, 150, 200)).toBe(1);
    expect(edgeLevel(500, 0, 0)).toBe(0);
  });
  it('the murk breathes and things move in it, more the closer you are', () => {
    const { e, out } = rig();
    for (const r of Object.values(MURK)) expect(r(e.x, out, 0)).toBeGreaterThan(0);
    const run = (level: number) => {
      const { ctx, e } = rig();
      const m = new EdgeMurk(e);
      for (let i = 0; i < 600; i++) { ctx.currentTime += 1; m.update(ctx.currentTime, level, 190, 0); }
      return m.calls;
    };
    expect(run(0)).toBe(0);
    expect(run(1)).toBeGreaterThan(run(0.3));
    expect(run(1)).toBeGreaterThan(20);
  });
});

describe('audio director', () => {
  it('threat grows with hunters and nearness', () => {
    expect(threatLevel([], 0, 0)).toBe(0);
    const far = threatLevel([{ x: 40, z: 0, engaged: true }], 0, 0), near = threatLevel([{ x: 4, z: 0, engaged: true }], 0, 0);
    expect(near).toBeGreaterThan(far);
    expect(threatLevel([{ x: 4, z: 0, engaged: false }], 0, 0)).toBeLessThan(AUDIO.music.tension);
    expect(threatLevel([{ x: 4, z: 0, engaged: true }, { x: 5, z: 0, engaged: true }], 0, 0)).toBeGreaterThan(AUDIO.music.combat);
  });
  it('intensity rises fast and drains slowly', () => {
    const i = new Intensity();
    for (let k = 0; k < 30; k++) i.update(1 / 30, 1);
    expect(i.value).toBeGreaterThan(0.9);
    for (let k = 0; k < 30; k++) i.update(1 / 30, 0);
    expect(i.value).toBeGreaterThan(0.85);
  });
  it('music layers follow intensity', () => {
    expect(layerLevels(0, false, 'raid').drums).toBe(0);
    expect(layerLevels(0, false, 'raid').bells).toBeGreaterThan(0.9);
    expect(layerLevels(1, false, 'raid').drums).toBe(1);
    expect(layerLevels(0, true, 'raid').brass).toBeGreaterThan(0);
    expect(layerLevels(0.5, false, 'hive').drums).toBe(0);
    expect(tempo(1, false)).toBeGreaterThan(tempo(0, false));
  });
  it('footsteps land once per stride, heavier hosts are louder, crouching is quiet', () => {
    const s = new Stride();
    let steps = 0;
    for (let k = 0; k < 100; k++) if (s.update(0.14, 'medium', false, true)) steps++;
    expect(steps).toBe(Math.floor(14 / AUDIO.footsteps.stride.medium));
    expect(stepLevel('heavy', false, false)).toBeGreaterThan(stepLevel('light', false, false));
    expect(stepLevel('medium', true, false)).toBeLessThan(stepLevel('medium', false, false));
    expect(weightOf('goreBehemoth')).toBe('heavy');
    expect(surfaceFor('longSeedWreck', true)).toBe('metal');
    expect(surfaceFor('glowmireIsle', false)).toBe('moss');
    expect(surfaceFor('ashDesert', false)).toBe('sand');
    expect(surfaceFor('weepingFen', false)).toBe('water');
  });
  it('knows what is behind you', () => {
    expect(behind(0, 5, 0, 0, 0, -1, 10)).toBe(true);
    expect(behind(0, -5, 0, 0, 0, -1, 10)).toBe(false);
    expect(behind(0, 50, 0, 0, 0, -1, 10)).toBe(false);
  });
  it('far sounds lose their highs, volume is perceptual', () => {
    expect(airCutoff(2)).toBeGreaterThan(airCutoff(60));
    expect(volumeGain(0.5)).toBeCloseTo(0.25);
  });
});
