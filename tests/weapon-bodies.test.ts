import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODS, WEAPONS, WEAPON_FEEL } from '../data';
import { MOD_SLOTS, WEAPON_BODIES, createWeaponBody, hasWeaponBody, type ModSlot, type WeaponBody, type WeaponPose } from '../src/creatures/weapons/bodies';

const REST: WeaponPose = { reload: null, aim: 0, sinceFire: 9, ammo: 1 };

/** Every transform under the gun, flattened, so two poses can be compared. */
function snapshot(b: WeaponBody): number[] {
  const out: number[] = [];
  b.gun.updateMatrixWorld(true);
  b.gun.traverse((o) => out.push(...o.matrixWorld.elements));
  return out;
}
/** Largest change in any transform (idle breathing moves things a little, a reload a lot). */
const delta = (a: number[], b: number[]) => (a.length !== b.length ? Infinity : Math.max(...a.map((v, i) => Math.abs(v - b[i]))));
const run = (b: WeaponBody, s: Partial<WeaponPose>, secs: number, step = 1 / 60) => { for (let t = 0; t < secs; t += step) b.animate(step, { ...REST, ...s }); };

describe('living weapon bodies', () => {
  it('every body has a muzzle, a grip frame and exactly the mod sockets Design lists', () => {
    for (const id of WEAPON_BODIES) {
      const b = createWeaponBody(id);
      const def = WEAPONS[id];
      expect(hasWeaponBody(id)).toBe(true);
      expect(Object.keys(b.sockets).sort(), id).toEqual([...def.modSlots].sort());
      if (def.ads === false) expect(b.sockets.sight, id).toBeUndefined();
      expect(b.reloadStyle, id).toBe(def.reload.style);
      expect(b.zooms, id).toBe(def.ads !== false);
      expect(b.kick.back, id).toBe(WEAPON_FEEL.fire[def.class].push);
      for (const o of [b.muzzle, b.grip, ...Object.values(b.sockets)]) {
        let p: THREE.Object3D | null = o!;
        while (p && p !== b.gun) p = p.parent;
        expect(p, `${id} ${o.name}`).toBe(b.gun);
      }
      // The muzzle sits forward (-Z) of the grip.
      expect(b.muzzle.position.z).toBeLessThan(b.grip.position.z);
      expect(b.kick.back).toBeGreaterThan(0);
      expect(b.kick.pitch).toBeGreaterThan(0);
    }
    expect(hasWeaponBody('synapseBurster')).toBe(false);
  });

  it('each reload visibly moves the body and settles back to rest', () => {
    for (const id of WEAPON_BODIES) {
      const b = createWeaponBody(id);
      run(b, {}, 0.5);
      const rest = snapshot(b);
      b.animate(1 / 60, { ...REST, reload: 0.5, style: b.reloadStyle, ammo: 0.5, shells: 2 });
      expect(delta(snapshot(b), rest), `${id} reload`).toBeGreaterThan(0.08);
      run(b, {}, 2.5);
      expect(delta(snapshot(b), rest), `${id} settles`).toBeLessThan(0.045);
    }
  });

  it('a shot kicks the body back and the flinch dies away', () => {
    const b = createWeaponBody('broodMortar');
    run(b, {}, 0.5);
    b.animate(1 / 60, { ...REST, sinceFire: 0 });
    let back = 0;
    for (let i = 0; i < 6; i++) { b.animate(1 / 60, { ...REST, sinceFire: (i + 1) / 60 }); back = Math.max(back, b.flex.position.z); }
    expect(back).toBeGreaterThan(0.02);
    run(b, { sinceFire: 2 }, 1.5);
    expect(Math.abs(b.flex.position.z)).toBeLessThan(1e-3);
  });

  it('the draw lifts the body from a curl to rest', () => {
    const b = createWeaponBody('vertebraRifle');
    b.animate(1 / 60, { ...REST, equip: 0 });
    expect(b.flex.rotation.x).toBeLessThan(-0.5);
    for (let k = 0; k <= 1; k += 0.05) b.animate(1 / 60, { ...REST, equip: k });
    run(b, { equip: 1 }, 0.5);
    expect(Math.abs(b.flex.rotation.x)).toBeLessThan(1e-3);
    b.animate(1 / 60, { ...REST, holster: 1 });
    expect(b.flex.rotation.x).toBeLessThan(-0.5);
  });

  it('grafts grow on their socket and can be shed', () => {
    const b = createWeaponBody('vertebraRifle');
    for (const k of MOD_SLOTS) b.graft(k);
    expect(b.grafts).toEqual(MOD_SLOTS);
    run(b, {}, 1.2);
    for (const k of MOD_SLOTS) {
      const g = b.sockets[k]!.getObjectByName(`graft:${k}`)!;
      expect(g.visible).toBe(true);
      expect(g.scale.x).toBeGreaterThan(0.9);
    }
    b.graft('barrel', false);
    run(b, {}, 1);
    expect(b.sockets.barrel!.getObjectByName('graft:barrel')!.visible).toBe(false);
    expect(b.grafts).not.toContain('barrel');
  });

  it('every mod in data/mods.json has its own graft that buds onto its slot', () => {
    const b = createWeaponBody('vertebraRifle');
    const seen = new Set<string>();
    for (const [mod, def] of Object.entries(MODS)) {
      b.graft(def.slot as ModSlot, true, mod);
      expect(b.graftMods[def.slot as ModSlot]).toBe(mod);
      const g = b.sockets[def.slot as ModSlot]!.getObjectByName(`graft:${mod}`);
      expect(g, mod).toBeTruthy();
      let n = 0;
      g!.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
      expect(n, mod).toBeGreaterThan(0);
      seen.add(mod);
    }
    expect(seen.size).toBe(Object.keys(MODS).length);
    // A gun without a sight socket ignores a sight graft.
    const s = createWeaponBody('gulletScatter');
    s.graft('sight', true, 'nightEye');
    expect(s.grafts).toEqual([]);
  });

  it('a magazine reload tears the spent sac free; it falls and is gone after a couple of seconds', () => {
    const b = createWeaponBody('hiveSpitter') as WeaponBody & { spentCount: number };
    run(b, {}, 0.2);
    for (let r = 0; r <= 1; r += 1 / 60 / 1.8) b.animate(1 / 60, { ...REST, reload: r, style: 'magazine', ammo: r });
    expect(b.spentCount).toBe(1);
    const spent = b.gun.getObjectByName('spent')!;
    const y0 = spent.position.y;
    run(b, {}, 0.3);
    expect(spent.position.y).toBeLessThan(y0);
    run(b, {}, 2);
    expect(b.spentCount).toBe(0);
  });

  it('rarer guns are more alive', () => {
    const common = createWeaponBody('quillet') as unknown as { life: number };
    const relic = createWeaponBody('coreburner') as unknown as { life: number };
    expect(relic.life).toBe(common.life * 2);
  });
});
