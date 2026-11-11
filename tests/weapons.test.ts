import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPONS, WEAPON_FEEL, weaponSpec, type WeaponClass } from '../data';
import { AutoWeaponState, type AmmoFeed, type AutoTuning } from '../src/game/weapon-state';
import { STARTER_WEAPON, equipWeapon, raidWeapons, unequipWeapon, weaponSlots } from '../src/game/arsenal';
import { deploy, die, extract, loadProfile, memoryStorage, newProfile, saveProfile, stashGrid } from '../src/game/profile';
import { GenericWeaponModel, createWeaponModel, registerWeaponView } from '../src/game/weapon-view';
import { WeaponRig } from '../src/game/weapon-rig';

const run = (s: AutoWeaponState, seconds: number, trigger: (t: number) => boolean, dt = 1 / 120) => {
  const out = { shots: 0, reloaded: 0, shellsIn: 0, charges: [] as number[] };
  for (let t = 0; t < seconds; t += dt) {
    const r = s.update(dt, trigger(t));
    out.shots += r.shots; out.reloaded += r.reloaded ? 1 : 0; out.shellsIn += r.shellsIn;
    if (r.shots) out.charges.push(r.charge);
  }
  return out;
};
const tune = (o: Partial<AutoTuning>): AutoTuning => ({ fireRate: 10, magazine: 6, reloadTime: 1, ...o });
const feedOf = (n: number): AmmoFeed & { left: number } => {
  const f = { left: n, available: () => f.left, take: (k: number) => { const g = Math.min(k, f.left); f.left -= g; return g; } };
  return f;
};

describe('fire modes', () => {
  it('semi fires once per trigger press, however long it is held', () => {
    const s = new AutoWeaponState(tune({ fireMode: 'semi' }));
    expect(run(s, 1, () => true).shots).toBe(1);
    // Let go, then three taps.
    expect(run(s, 0.7, (t) => Math.floor(t / 0.1) % 2 === 1).shots).toBe(3);
  });

  it('burst fires burstCount rounds burstDelay apart per press', () => {
    const s = new AutoWeaponState(tune({ fireMode: 'burst', burstCount: 3, burstDelay: 0.05, fireRate: 2, magazine: 30 }));
    const first = run(s, 0.04, () => true);
    expect(first.shots).toBe(1);
    expect(run(s, 0.2, () => true).shots).toBe(2); // the rest of the burst, then nothing while still held
    expect(s.ammo).toBe(27);
  });

  it('charge fires on release only past minCharge, at the charge reached', () => {
    const s = new AutoWeaponState(tune({ fireMode: 'charge', chargeTime: 1, minCharge: 0.5 }));
    expect(run(s, 0.3, (t) => t < 0.2).shots).toBe(0); // released at 20%: fizzles
    const r = run(s, 1, (t) => t < 0.7);
    expect(r.shots).toBe(1);
    expect(r.charges[0]).toBeGreaterThan(0.6);
    expect(r.charges[0]).toBeLessThan(0.8);
  });
});

describe('reload styles', () => {
  it('magazine reloads take from the ammo feed, partially when it runs short, and wait longer when empty', () => {
    const feed = feedOf(4);
    const s = new AutoWeaponState(tune({ reloadStyle: 'magazine', emptyExtra: 0.5 }), feed);
    run(s, 1, () => true); // empties 6, starts reload (1.5 s with emptyExtra)
    expect(s.reloadTotal).toBeCloseTo(1.5);
    run(s, 1.6, () => false);
    expect(s.ammo).toBe(4);
    expect(feed.left).toBe(0);
    run(s, 1, () => true);
    expect(s.reload()).toBe(false); // nothing to reload from
  });

  it('perShell feeds one round at a time and firing interrupts it', () => {
    const feed = feedOf(20);
    const s = new AutoWeaponState(tune({ reloadStyle: 'perShell', perShellTime: 0.25, fireMode: 'semi' }), feed);
    s.ammo = 0;
    expect(s.reload()).toBe(true);
    const r = run(s, 0.6, () => false);
    expect(r.shellsIn).toBe(2);
    expect(s.ammo).toBe(2);
    // Pull the trigger: the reload stops and a round fires.
    const shot = run(s, 0.2, (t) => t > 0.05);
    expect(shot.shots).toBe(1);
    expect(s.isReloading).toBe(false);
  });

  it('regrow refills in place without an ammo item', () => {
    const s = new AutoWeaponState(tune({ reloadStyle: 'regrow' }), feedOf(0));
    run(s, 1, () => true);
    run(s, 1.1, () => false);
    expect(s.ammo).toBe(6);
  });
});

describe('weapons.json', () => {
  it('resolves every entry into a full spec, including the legacy Synapse Burster fields', () => {
    for (const id of Object.keys(WEAPONS)) {
      const w = weaponSpec(id);
      expect(w.magazine).toBeGreaterThan(0);
      expect(w.reload.time).toBeGreaterThan(0);
      expect(w.projectile.speed).toBeGreaterThan(0);
      expect(w.range.maxDistance).toBeGreaterThan(w.range.falloffStart);
    }
    const b = weaponSpec('synapseBurster');
    expect(b.reload.time).toBe(WEAPONS.synapseBurster.reloadTime ?? WEAPONS.synapseBurster.reload!.time);
    expect(b.egoCharge).not.toBeNull();
    expect(b.ads).not.toBeNull();
    expect(() => weaponSpec('nope')).toThrow();
  });
});

describe('weapon loadout', () => {
  const other = Object.keys(WEAPONS).find((id) => id !== STARTER_WEAPON);

  it('always carries the starter, equips from the stash, and loses equipped weapons on death', () => {
    const p = newProfile();
    expect(raidWeapons(p)).toEqual([STARTER_WEAPON]);
    expect(p.weaponSlots).toHaveLength(weaponSlots());
    if (!other) return; // roster not on main yet
    expect(equipWeapon(p, 0, other)).toBe(false); // not in the stash
    const g = stashGrid(p); g.add(other, 1); p.stash = g.snapshot();
    expect(equipWeapon(p, 0, other)).toBe(true);
    expect(stashGrid(p).count(other)).toBe(0);
    expect(raidWeapons(p)).toEqual([STARTER_WEAPON, other]);
    const d = deploy(p);
    expect(d.weapons).toEqual([STARTER_WEAPON, other]);
    expect(p.weaponSlots.every((w) => w === null)).toBe(true);
    die(p, { pouch: [] }, 0);
    expect(raidWeapons(p)).toEqual([STARTER_WEAPON]);
  });

  it('brings equipped weapons home on extraction, and unequips back into the stash', () => {
    if (!other) return;
    const p = newProfile();
    const g = stashGrid(p); g.add(other, 1); p.stash = g.snapshot();
    equipWeapon(p, 1, other);
    const d = deploy(p);
    extract(p, { cavity: [], pouch: [], dna: 0, weapons: d.weapons }, 0);
    expect(p.weaponSlots[0]).toBe(other);
    const kv = memoryStorage(); saveProfile(kv, p);
    expect(loadProfile(kv).profile.weaponSlots).toEqual(p.weaponSlots);
    expect(unequipWeapon(p, 0)).toBe(true);
    expect(stashGrid(p).count(other)).toBe(1);
  });
});

describe('weapon views and rig', () => {
  it('builds a procedural stand-in for every class, with muzzle, sight and grip', () => {
    for (const cls of ['carbine', 'sidearm', 'smg', 'rifle', 'shotgun', 'marksman', 'sniper', 'launcher', 'beam', 'relic'] as WeaponClass[]) {
      const spec = { ...weaponSpec('synapseBurster'), id: `test-${cls}`, class: cls };
      const m = createWeaponModel(spec);
      expect(m).toBeInstanceOf(GenericWeaponModel);
      expect(m.root.getObjectById(m.muzzle.id)).toBeDefined();
      expect(m.grip).toBeDefined();
      for (const style of ['magazine', 'perShell', 'regrow'] as const) {
        m.reload(style, 0.5);
        for (let i = 0; i < 40; i++) m.update(1 / 60, { ammoFrac: 0.5, aim: 0, ego: 0, charge: 0, reloading: true, look: null });
      }
    }
  });

  it('uses a registered body, and the rig keeps one light set across swaps and centres the sight when aiming', () => {
    const spec = { ...weaponSpec('synapseBurster'), id: 'test-registered' };
    const custom = new GenericWeaponModel(spec);
    registerWeaponView('test-registered', () => custom);
    expect(createWeaponModel(spec)).toBe(custom);
    const rig = new WeaponRig(new THREE.PerspectiveCamera());
    const a = new GenericWeaponModel({ ...spec, id: 'a' }), b = new GenericWeaponModel({ ...spec, id: 'b', class: 'sniper' });
    const lights = () => { let n = 0; rig.root.traverse((o) => { if ((o as THREE.Light).isLight) n++; }); return n; };
    rig.equip(a, 0);
    const n = lights();
    rig.equip(b, 0.4);
    expect(lights()).toBe(n);
    expect(rig.equipping).toBe(true);
    const frame = { ammoFrac: 1, aim: 1, ego: 0, charge: 0, reloading: false, look: null };
    const motion = { yaw: 0, pitch: 0, speed: 0, sprinting: false, grounded: true };
    for (let i = 0; i < 60; i++) rig.update(1 / 60, motion, frame);
    expect(rig.equipping).toBe(false);
    rig.root.updateMatrixWorld(true);
    const sight = b.sight.getWorldPosition(new THREE.Vector3());
    expect(Math.abs(sight.x)).toBeLessThan(0.05);
    expect(Math.abs(sight.y)).toBeLessThan(0.05);
    expect(sight.z).toBeLessThan(-0.1);
  });

  it('kicks harder and settles slower for heavy classes (weapon-feel.json)', () => {
    const peak = (cls: WeaponClass) => {
      const rig = new WeaponRig(new THREE.PerspectiveCamera());
      const m = new GenericWeaponModel({ ...weaponSpec('synapseBurster'), id: `feel-${cls}`, class: cls });
      rig.setFeel(WEAPON_FEEL.fire[cls]);
      rig.equip(m, 0);
      const frame = { ammoFrac: 1, aim: 0, ego: 0, charge: 0, reloading: false, look: null };
      const motion = { yaw: 0, pitch: 0, speed: 0, sprinting: false, grounded: true };
      for (let i = 0; i < 30; i++) rig.update(1 / 60, motion, frame);
      const rest = m.root.getWorldPosition(new THREE.Vector3()).z;
      rig.fired();
      let back = 0, settledAt = -1;
      for (let i = 0; i < 120; i++) {
        rig.update(1 / 120, motion, frame);
        const d = m.root.getWorldPosition(new THREE.Vector3()).z - rest;
        back = Math.max(back, Math.abs(d));
        if (settledAt < 0 && i > 4 && Math.abs(d) < back * 0.1) settledAt = i;
      }
      return { back, settledAt: settledAt < 0 ? 120 : settledAt };
    };
    const smg = peak('smg'), sniper = peak('sniper');
    expect(sniper.back).toBeGreaterThan(smg.back * 2);
    expect(sniper.settledAt).toBeGreaterThan(smg.settledAt);
  });

  it('blooms the spread per shot, less while aiming, and recovers (the crosshair reads it)', async () => {
    const { LivingWeapon } = await import('../src/game/weapon');
    const { Projectiles } = await import('../src/game/projectiles');
    const spec = weaponSpec('synapseBurster');
    const w = new LivingWeapon(spec, new GenericWeaponModel({ ...spec, id: 'bloom-test' }), new Projectiles(new THREE.Scene(), new Proxy({}, { get: () => () => new THREE.Mesh() }) as never));
    const ctx = { aimPoint: new THREE.Vector3(0, 0, -10), moving: false, sprinting: false };
    const rest = w.spreadRadians();
    let peak = 0, widest = 0;
    for (let i = 0; i < 30; i++) { w.update(1 / 60, true, false, ctx); peak = Math.max(peak, w.bloom); widest = Math.max(widest, w.spreadRadians()); }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(WEAPON_FEEL.fire[spec.class].bloomMax!);
    expect(widest).toBeGreaterThan(rest);
    for (let i = 0; i < 120; i++) w.update(1 / 60, false, false, ctx);
    expect(w.bloom).toBe(0);
  });
});
