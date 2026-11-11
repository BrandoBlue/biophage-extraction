import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MOD_SLOTS, WEAPON_BODIES, createWeaponBody, hasWeaponBody, type WeaponBody, type WeaponPose } from '../src/creatures/weapons/bodies';

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
  it('every body has a muzzle, a grip frame and the four mod sockets on the gun', () => {
    for (const id of WEAPON_BODIES) {
      const b = createWeaponBody(id);
      expect(hasWeaponBody(id)).toBe(true);
      for (const o of [b.muzzle, b.grip, ...MOD_SLOTS.map((k) => b.sockets[k])]) {
        let p: THREE.Object3D | null = o;
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
      run(b, {}, 1.5);
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
    const b = createWeaponBody('gulletScatter');
    for (const k of MOD_SLOTS) b.graft(k);
    expect(b.grafts).toEqual(MOD_SLOTS);
    run(b, {}, 1.2);
    for (const k of MOD_SLOTS) {
      const g = b.sockets[k].getObjectByName(`graft:${k}`)!;
      expect(g.visible).toBe(true);
      expect(g.scale.x).toBeGreaterThan(0.9);
    }
    b.graft('barrel', false);
    run(b, {}, 1);
    expect(b.sockets.barrel.getObjectByName('graft:barrel')!.visible).toBe(false);
    expect(b.grafts).not.toContain('barrel');
  });
});
