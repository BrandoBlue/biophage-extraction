import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Creature } from '../src/creatures/creature';

const MINE = ['needlemaw', 'bilecantor', 'glasswalker', 'oculimoth', 'mournback', 'titheWeaver', 'huskMimic', 'lumenGrazer'] as const;
const run = (c: Creature, secs: number) => { for (let t = 0; t < secs; t += 1 / 30) c.update(1 / 30); };
const headOf = (c: Creature) => c.rig.bones.find((b) => b.name === 'head') ?? c.rig.bones.find((b) => b.name === 'neck') ?? c.rig.bones[0];
const glow = (c: Creature) => c.rig.glows.reduce((s, g) => s + g.mat.emissiveIntensity, 0);

describe('creature minds: body language the brain can drive', () => {
  it.each(MINE)('%s cocks its head while it decides and lowers it to brace', (id) => {
    const c = new Creature(id, 2, 0);
    run(c, 0.3);
    const h = headOf(c), q0 = h.getWorldQuaternion(new THREE.Quaternion());
    c.drive.mind.tilt = 1;
    run(c, 0.1);
    const q1 = h.getWorldQuaternion(new THREE.Quaternion());
    expect(q1.angleTo(q0)).toBeGreaterThan(0.08);
    c.drive.mind.tilt = 0;
    c.drive.mind.brace = 1;
    run(c, 0.1);
    expect(h.getWorldQuaternion(new THREE.Quaternion()).angleTo(q1)).toBeGreaterThan(0.05);
  });

  it.each(MINE)('%s goes dark, shuts and opens its eyes, and calls', (id) => {
    const c = new Creature(id, 2, 0);
    run(c, 0.3);
    const lit = glow(c);
    c.drive.mind.dark = 1;
    run(c, 0.1);
    if (lit > 0) expect(glow(c)).toBeLessThan(lit * 0.3);
    c.drive.mind.dark = 0;
    c.drive.mind.eyes = 0;
    run(c, 0.1);
    const eyes = [...c.rig.parts.values()].filter((p) => p.spec.type === 'eye' && !p.mesh.userData.popped);
    for (const e of eyes) expect(e.mesh.scale.y).toBeLessThan(0.2 * e.mesh.scale.x);
    c.drive.mind.eyes = 1;
    c.drive.mind.call = 1;
    run(c, 0.5);
    expect(c.drive.mind.call).toBe(0);
  });

  it('a frozen creature all but stops its idle life', () => {
    const c = new Creature('lumenGrazer', 2, 0);
    run(c, 0.2);
    const t0 = c.clock;
    c.drive.mind.still = 1;
    run(c, 1);
    expect(c.clock - t0).toBeLessThan(0.2);
  });

  it('recoil pulls tendrils up under the body', () => {
    const c = new Creature('lumenGrazer', 2, 0);
    run(c, 1);
    const tip = () => {
      const t = [...c.rig.limbs.values()].find((l) => l.spec.kind === 'tendril')!;
      return t.bones[t.bones.length - 1].getWorldPosition(new THREE.Vector3()).y;
    };
    const hang = tip();
    c.drive.mind.recoil = 1;
    run(c, 2);
    expect(tip()).toBeGreaterThan(hang + 0.5);
  });
});
