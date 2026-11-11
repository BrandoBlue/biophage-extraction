import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ABOMINATIONS } from '../data';
import { Abomination, type AbominationContext } from '../src/game/abominations';
import { groundHeight } from '../src/world/zone7';

/** layout.spawns `buried`: a creature waits under the ground and claws out when the host comes close. */
function ctx(others: Abomination[], player: THREE.Vector3, reveals: string[]): AbominationContext {
  return {
    player, playerVelocity: new THREE.Vector3(), playerAlive: true, playerHidden: false,
    noises: [], others, playableRadius: 400, playerVisibility: 1, playerForward: { x: 0, z: 1 },
    onAlert: () => {}, onMelee: () => {}, onSpit: () => {}, onReveal: (_a, how) => { reveals.push(how); },
  };
}

describe('burrowed spawns', () => {
  it('stay under the ground while the host is far, then erupt and stand on it', () => {
    const c = new Abomination('needlemaw', ABOMINATIONS.needlemaw, 20, 20, 3);
    c.setHome(20, 20, { hatchOnApproach: 8 });
    c.burrowed = true;
    const reveals: string[] = [];
    const far = ctx([c], new THREE.Vector3(20, 0, 80), reveals);
    for (let i = 0; i < 60; i++) c.update(1 / 60, far);
    expect(c.lurking).toBe(true);
    expect(c.position.y).toBeLessThan(groundHeight(c.position.x, c.position.z) - 1);

    const near = ctx([c], new THREE.Vector3(20, 0, 25), reveals);
    for (let i = 0; i < 90; i++) c.update(1 / 60, near);
    expect(reveals).toEqual(['hatch']);
    expect(c.lurking).toBe(false);
    expect(Math.abs(c.position.y - groundHeight(c.position.x, c.position.z))).toBeLessThan(0.05);
  });

  it('leaves ordinary creatures on the ground', () => {
    const c = new Abomination('needlemaw', ABOMINATIONS.needlemaw, -20, 10, 4);
    const p = ctx([c], new THREE.Vector3(-20, 0, 90), []);
    for (let i = 0; i < 30; i++) c.update(1 / 60, p);
    expect(Math.abs(c.position.y - groundHeight(c.position.x, c.position.z))).toBeLessThan(0.05);
  });
});
