// Living weapon roster in a real raid (Gameplay): swap, aim and zoom, fire modes, a per-shell reload fed from an
// ammo item, a sticky round's fuse, and a found weapon going into a free slot. Called from tests/raid.mjs part 2
// (and runnable on its own: `node tests/weapons.mjs`). All waits are on simulated frames.
import { readFileSync } from 'node:fs';
import { freezeAndScreenshot } from './harness.mjs';

const WEAPONS = JSON.parse(readFileSync('data/weapons.json', 'utf8'));

export async function checkWeapons({ page, call, frames, state, fail, log }) {
  const ids = ['synapseBurster', 'gulletScatter', 'eyestalkMarksman', 'lumenLance', 'tumorLauncher'].filter((id) => WEAPONS[id]);
  if (ids.length < 5) { log('weapons: roster not in data yet, skipped'); return; }
  await call('killAll');
  await call('setTimeScale', 1);
  await call('arm', ids);
  for (const [item, n] of [['shardFeed', 30], ['boltFeed', 6]]) await call('give', item, n);
  await frames(1);
  let s = await state();
  if (s.weapons.list.map((w) => w.id).join() !== ids.join()) await fail(`arm gave ${JSON.stringify(s.weapons.list)}`);
  const me = await page.evaluate(() => window.__biophage.position);
  // A target 7 m ahead of the host along -Z (the camera's forward at yaw 0 is irrelevant: aimAt points the shot).
  const target = async () => {
    await call('killAll');
    const id = await call('spawn', 'needlemaw', me[0], me[2] - 7);
    await frames(1);
    const e = (await state()).enemies.find((c) => c.id === id);
    await call('aimAt', e.centre[0], e.centre[1], e.centre[2]);
    return id;
  };
  const enemy = async (id) => (await state()).enemies.find((c) => c.id === id);
  const equip = async (i) => {
    await call('equip', i);
    await frames(30); // the holster-and-draw swing
    s = await state();
    if (s.weapons.held !== i) await fail(`equip ${i} left slot ${s.weapons.held} held`);
  };

  // Gullet Scatter: semi-auto pellets, no aim (ads: false), per-shell reload from Shard Feed.
  await equip(1);
  let id = await target();
  let before = (await enemy(id)).biomass;
  await call('trigger', true); await frames(2); await call('trigger', false);
  for (let k = 0; k < 20; k++) { await frames(2); const e = await enemy(id); if (!e?.alive || e.biomass < before) break; }
  const hitE = await enemy(id);
  if (hitE?.alive && hitE.biomass >= before) await fail(`Gullet Scatter did not hurt a Needlemaw at 7 m: ${JSON.stringify(hitE)}`);
  s = await state();
  const scatter = s.weapons.list[1];
  if (scatter.ammo !== WEAPONS.gulletScatter.magazine - 1) await fail(`Gullet Scatter fired ${WEAPONS.gulletScatter.magazine - scatter.ammo} rounds on one pull`);
  await call('aim', true); await frames(20);
  s = await state();
  if (s.weapons.zoom !== 1 || s.weapons.list[1].aim !== 0) await fail(`a gun without ADS zoomed: ${JSON.stringify(s.weapons)}`);
  await call('aim', false);
  const feedBefore = s.carried.items.find((i) => i.item === 'shardFeed')?.count ?? 0;
  if (!(await call('reload'))) await fail('Gullet Scatter would not reload with Shard Feed carried');
  await call('setTimeScale', 4);
  for (let k = 0; k < 40; k++) { await frames(2); s = await state(); if (!s.weapons.list[1].reloading && s.weapons.list[1].ammo === WEAPONS.gulletScatter.magazine) break; }
  await call('setTimeScale', 1);
  const feedAfter = s.carried.items.find((i) => i.item === 'shardFeed')?.count ?? 0;
  log(`Gullet Scatter: one pull, ${WEAPONS.gulletScatter.pellets} pellets; no zoom; reload ${s.weapons.list[1].ammo}/${WEAPONS.gulletScatter.magazine}, Shard Feed ${feedBefore} -> ${feedAfter}`);

  // Eyestalk Marksman: scoped, aiming zooms by ads.zoom and the HUD gets the scope.
  await equip(2);
  await call('aim', true);
  for (let k = 0; k < 30; k++) { await frames(2); s = await state(); if (s.weapons.list[2].aim >= 1) break; }
  await frames(10);
  s = await state();
  if (Math.abs(s.weapons.zoom - WEAPONS.eyestalkMarksman.ads.zoom) > 0.05) await fail(`Eyestalk Marksman zoom ${s.weapons.zoom}, want ${WEAPONS.eyestalkMarksman.ads.zoom}`);
  await freezeAndScreenshot(page, 'tests/out/raid-scope.png', { resume: true });
  await call('aim', false);
  log(`Eyestalk Marksman: scoped at ${s.weapons.zoom.toFixed(2)}x, FOV ${s.weapons.fov.toFixed(1)}`);

  // Lumen Lance: charge, then release fires one piercing bolt.
  await equip(3);
  id = await target();
  const lanceAmmo = (await state()).weapons.list[3].ammo;
  await call('trigger', true);
  for (let k = 0; k < 40; k++) { await frames(2); s = await state(); if (s.weapons.list[3].charge >= 1) break; }
  await call('trigger', false); await frames(2);
  s = await state();
  if (s.weapons.list[3].ammo !== lanceAmmo - 1) await fail(`Lumen Lance did not fire on release: ${JSON.stringify(s.weapons.list[3])}`);
  log('Lumen Lance: charged and fired on release');

  // Tumor Launcher: the round sticks, then bursts after its fuse.
  await equip(4);
  id = await target();
  before = (await enemy(id)).biomass;
  await call('trigger', true); await frames(2); await call('trigger', false);
  for (let k = 0; k < 60; k++) { await frames(2); const e = await enemy(id); if (!e?.alive || e.biomass < before) break; }
  const stuck = await enemy(id);
  if (stuck?.alive && stuck.biomass >= before) await fail(`Tumor Launcher round never burst: ${JSON.stringify(stuck)}`);
  await freezeAndScreenshot(page, 'tests/out/raid-weapons.png', { resume: true });
  log('Tumor Launcher: round stuck and burst');

  // A weapon found in a raid goes into a free slot.
  await call('killAll');
  await call('arm', ['synapseBurster']);
  await call('give', 'quillet', 1);
  const taken = await call('pickUpWeapons');
  await frames(1);
  s = await state();
  if (!taken.includes('quillet') || !s.weapons.list.some((w) => w.id === 'quillet')) await fail(`found Quillet not taken into a slot: ${JSON.stringify(s.weapons.list)}`);
  log('weapon pickup: Quillet went into a free slot');
}
