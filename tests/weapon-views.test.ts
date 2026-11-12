import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODS, weaponSpec } from '../data';
import { createWeaponModel, hasWeaponView, type WeaponFrame } from '../src/game/weapon-view';
import { LivingWeaponView } from '../src/creatures/weapons/view';
import { WEAPON_BODIES } from '../src/creatures/weapons/bodies';
import { applyMods } from '../src/game/mods';

const frame = (o: Partial<WeaponFrame> = {}): WeaponFrame => ({ ammoFrac: 1, aim: 0, ego: 0, charge: 0, reloading: false, look: null, ...o });
const run = (m: { update(dt: number, f: WeaponFrame): void }, secs: number, f: WeaponFrame) => { for (let t = 0; t < secs; t += 1 / 60) m.update(1 / 60, f); };

describe('living weapon bodies in the hand', () => {
  it('registers a body for every roster weapon that has one', () => {
    for (const id of WEAPON_BODIES) {
      expect(hasWeaponView(id)).toBe(true);
      const m = createWeaponModel(weaponSpec(id));
      expect(m).toBeInstanceOf(LivingWeaponView);
      expect(m.muzzle).toBeTruthy();
      expect(m.grip).toBeTruthy();
    }
  });

  it('the muzzle sits ahead of the grip, along -Z, at viewmodel scale', () => {
    for (const id of WEAPON_BODIES) {
      const m = createWeaponModel(weaponSpec(id));
      m.root.updateMatrixWorld(true);
      const mz = m.muzzle.getWorldPosition(new THREE.Vector3()), gp = m.grip!.getWorldPosition(new THREE.Vector3());
      expect(mz.z).toBeLessThan(gp.z);
      expect(mz.length()).toBeLessThan(1.2);
    }
  });

  it('fires, reloads each style and comes back to rest without moving its root', () => {
    for (const id of ['quillet', 'gulletScatter', 'hiveSpitter'] as const) {
      const m = createWeaponModel(weaponSpec(id)) as LivingWeaponView;
      m.equip(0.3);
      run(m, 0.5, frame());
      m.fired();
      run(m, 0.1, frame());
      const style = weaponSpec(id).reload.style;
      m.reload(style, 0.4);
      for (let i = 0; i < 3; i++) { m.shellIn(); run(m, 0.3, frame({ reloading: true, ammoFrac: i / 3 })); }
      run(m, 1, frame());
      expect(m.root.position.length()).toBe(0);
      expect(m.root.rotation.x).toBe(0);
    }
  });

  it('grows the grafts the spec carries', () => {
    const barrel = Object.keys(MODS).find((k) => MODS[k].slot === 'barrel')!;
    const id = 'quillet'; // data/weapons.json gives it all four sockets
    const m = createWeaponModel(applyMods(weaponSpec(id), [barrel])) as LivingWeaponView;
    expect(m.body.graftMods.barrel).toBe(barrel);
  });
});
