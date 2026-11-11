import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HostArm, VIRUS_LOOKS, attachToViewmodel } from '../src/creatures/hostarm';
import { bioTime } from '../src/render/materials';
import { mutation } from '../src/render/dissolve';

const looks = (arm: HostArm) => arm.root.children.map((c) => c.name);

describe('host arm virus mutations', () => {
  it.each(VIRUS_LOOKS)('%s dissolve-grows in within the mutation time and replaces the clean arm', (virus) => {
    const arm = new HostArm();
    expect(looks(arm)).toEqual(['arm:clean']);
    const t0 = bioTime.value;
    arm.mutate(virus, 2.5);
    expect(arm.current).toBe(virus);
    expect(looks(arm)).toEqual(['arm:clean', `arm:${virus}`]);
    for (let i = 1; i <= 26; i++) { bioTime.value = t0 + i * 0.1; mutation.update(); arm.update(0.1); }
    expect(looks(arm)).toEqual([`arm:${virus}`]);
  });

  it('plague pustules erupt wrist first and are all out by the end', () => {
    const arm = new HostArm();
    arm.mutate('plagueStalkerStrain', 2.5);
    arm.update(0.8);
    const sizes = () => {
      const out: { y: number; s: number }[] = [];
      arm.root.getObjectByName('arm:plagueStalkerStrain')!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.parent?.name === 'arm:plagueStalkerStrain' && o.scale.x !== 1) out.push({ y: o.position.y, s: o.scale.x });
      });
      return out.sort((a, b) => a.y - b.y);
    };
    const mid = sizes();
    expect(mid.length).toBeGreaterThan(10);
    expect(mid[0].s).toBeGreaterThan(mid[mid.length - 1].s);
    arm.update(2);
    expect(sizes().every((p) => p.s > 0.9)).toBe(true);
  });

  it('mounts in place of the viewmodel wrist, inside the host-arm group', () => {
    const root = new THREE.Group(), gun = new THREE.Group(), hand = new THREE.Group();
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 0.3, 12));
    hand.add(wrist); gun.add(hand); root.add(gun);
    const arm = new HostArm();
    expect(attachToViewmodel({ root, arm: hand }, arm)).toBe(true);
    expect(arm.root.parent).toBe(hand);
    expect(wrist.visible).toBe(false);
  });
});
