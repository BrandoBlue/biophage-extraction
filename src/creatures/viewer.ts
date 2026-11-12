import * as THREE from 'three';
import { BroodHeart } from './broodheart';
import { Reliquary, type ReliquaryPhase } from './reliquary';
import { Warden, type WardenPhase } from './warden';
import { PaleVigil, type VigilPhase } from './palevigil';
import { ZONE_BOSSES, showZoneBoss, type ZoneBossId, type ZoneBossShow } from './zones/showcase';
import { MOD_SLOTS, WEAPON_BODIES, createWeaponBody, type ModSlot, type WeaponBody } from './weapons/bodies';
import { HostArm, VIRUS_LOOKS, type VirusLook } from './hostarm';
import { organMesh } from './organs';
import { EVOLUTION_BODIES, EvolutionStage, type HostBody } from './hosts';
import type { ClassId } from '../../data';
import { HIVE, ORGANIC, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';
import { bioSurface, bioNode } from '../render/materials';
import { createPipeline, simplifyForSoftware, type Pipeline } from '../render/pipeline';
import { buildZone7, groundHeight } from '../world/zone7';
import { mutation } from '../render/dissolve';
import { Creature, type MindTells } from './creature';
import { creatureGore } from './gore';
import { SPECIES_IDS } from './species';
import { MAX_STAGE, type SpeciesId } from './plan';
import type { Abomination } from '../../data';
import { ABOMINATIONS, MODS } from '../../data';

/**
 * Creature viewer: open the game with `?creatures` (add `&env=zone7` to see them on the island).
 * Review every Abomination at every mutation stage, watch it walk, strike, mutate and lose limbs.
 * Test hook: window.__biophageViewer (tests/creatures.mjs).
 */

export function creatureViewerRequested(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has('creatures') || (window as unknown as { __BIOPHAGE_VIEWER__?: boolean }).__BIOPHAGE_VIEWER__ === true;
}

/** The Hive specimen chamber: wet black-teal floor with acid veins, a dark drum wall, strong rims. */
function specimenStage(scene: THREE.Scene): void {
  scene.background = new THREE.Color(HIVE.background);
  scene.fog = new THREE.FogExp2(HIVE.background, 0.028);
  const floorMat = bioSurface(new THREE.MeshStandardMaterial({ color: HIVE.panel, roughness: 0.35, metalness: 0.2 }), {
    uniforms: { uAcid: { value: new THREE.Color(HIVE.acid) } },
    declarations: 'uniform vec3 uAcid;\n',
    fragment: /* glsl */ `
      vec2 p = vBioWorld.xz;
      float r = length(p);
      float tiles = smoothstep(0.02, 0.05, abs(fract(p.x * 0.5) - 0.5)) * smoothstep(0.02, 0.05, abs(fract(p.y * 0.5) - 0.5));
      diffuseColor.rgb *= 0.18 + 0.14 * tiles + 0.12 * bioNoise(vec3(p * 2.0, 1.0));
      float veins = bioVein(vec3(p * 0.6, 3.0));
      float ring = 1.0 - smoothstep(0.0, 0.08, abs(r - 6.5));
      totalEmissiveRadiance += uAcid * (veins * 0.07 * (1.0 - smoothstep(4.0, 14.0, r)) + ring * 0.22);
      roughnessFactor = mix(0.15, 0.6, tiles);
    `,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2), floorMat);
  scene.add(floor);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 16, 64, 1, true), new THREE.MeshStandardMaterial({ color: HIVE.background, roughness: 0.8, side: THREE.BackSide }));
  wall.position.y = 8;
  scene.add(wall);
  const ribs: THREE.Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 9, 0.08), bioNode(HIVE.acid, 0.8));
    rib.position.set(Math.cos(a) * 21.6, 4.5, Math.sin(a) * 21.6);
    ribs.push(rib);
  }
  scene.add(...ribs);
  scene.add(new THREE.HemisphereLight(HIVE.panel, HIVE.background, 1.1));
  const key = new THREE.SpotLight(HIVE.bone, 170, 30, 0.6, 0.55, 1.4);
  key.position.set(4, 11, 6);
  const rimL = new THREE.SpotLight(HIVE.acid, 110, 30, 0.6, 0.5, 1.4);
  rimL.position.set(-7, 6, -8);
  const rimR = new THREE.SpotLight(PATH.dna, 110, 30, 0.6, 0.5, 1.4);
  rimR.position.set(8, 5, -7);
  const fill = new THREE.SpotLight(ZONE7.violet, 70, 30, 0.7, 0.6, 1.4);
  fill.position.set(-2, 2.5, 9);
  for (const l of [key, rimL, rimR]) { l.target.position.set(0, 1.2, 0); scene.add(l, l.target); }
  fill.target.position.set(0, 1, 0);
  scene.add(fill, fill.target);
}

/** Neutral look-dev stage (`?creatures&env=studio`): grey floor, bone-white key, cool mist rim, no coloured light. */
function studioStage(scene: THREE.Scene): void {
  scene.background = new THREE.Color(HIVE.background).lerp(new THREE.Color(ORGANIC.mist), 0.12);
  scene.add(new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(ORGANIC.mist).multiplyScalar(0.18), roughness: 0.9 })));
  scene.add(new THREE.HemisphereLight(ORGANIC.mist, HIVE.background, 0.9));
  const key = new THREE.SpotLight(HIVE.bone, 110, 34, 0.6, 0.5, 1.3);
  key.position.set(5, 11, 7);
  const rim = new THREE.SpotLight(ORGANIC.mist, 80, 34, 0.6, 0.5, 1.3);
  rim.position.set(-6, 7, -9);
  const fill = new THREE.SpotLight(ORGANIC.amber, 20, 30, 0.7, 0.6, 1.4);
  fill.position.set(-4, 2.5, 8);
  for (const l of [key, rim, fill]) { l.target.position.set(0, 1.2, 0); scene.add(l, l.target); }
}

interface ViewerState { species: SpeciesId; seed: number; stage: number; walking: boolean; striking: number; burrowed: boolean; acting: number; env: 'hive' | 'zone7' | 'studio' }

export function startCreatureViewer(canvas: HTMLCanvasElement): void {
  const q = new URLSearchParams(location.search);
  const env: ViewerState['env'] = q.get('env') === 'zone7' ? 'zone7' : q.get('env') === 'studio' ? 'studio' : 'hive';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1500);
  // Zone 7: a flat spot on the island (the Bio-Pod clearing).
  const origin = env === 'zone7' ? new THREE.Vector3(22, 0, 0) : new THREE.Vector3();
  const ground = env === 'zone7' ? groundHeight : () => 0;
  if (env === 'zone7') buildZone7(scene); else if (env === 'studio') studioStage(scene); else specimenStage(scene);
  origin.y = ground(origin.x, origin.z);
  const pipeline: Pipeline = createPipeline(canvas, scene, camera, env === 'zone7' ? 'zone7' : 'hive');
  const soft = pipeline.quality === 'low';
  if (!soft && env === 'hive') {
    // Reflections for wet chitin: a coarse glow-only copy of the chamber (acid strips, a bone-white top light).
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(HIVE.background);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(HIVE.acid).multiplyScalar(1.5) });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      envScene.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), strip).translateX(Math.cos(a) * 9).translateZ(Math.sin(a) * 9).translateY(3));
    }
    const top = new THREE.Mesh(new THREE.CircleGeometry(4, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(HIVE.bone).multiplyScalar(2) }));
    top.position.y = 9;
    envScene.add(top);
    const pmrem = new THREE.PMREMGenerator(pipeline.renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  const st: ViewerState = {
    species: (q.get('species') as SpeciesId) ?? 'needlemaw', seed: Number(q.get('seed') ?? 7), stage: Number(q.get('stage') ?? 0), walking: q.has('walk'), striking: 0, burrowed: q.has('burrow'), acting: 0, env,
  };
  let creatures: Creature[] = [];
  let lineup = q.has('lineup');
  // Non-creature specimens: the Brood Heart nest, the harvest organs, the host arm.
  type Extra = 'nest' | 'organs' | 'arm' | 'host' | 'boss' | 'warden' | 'vigil' | 'weapons' | 'zoneBoss' | null;
  let extra: Extra = null;
  const extras = new THREE.Group();
  scene.add(extras);
  let boss: Reliquary | null = null;
  let warden: Warden | null = null;
  let vigil: PaleVigil | null = null;
  /** New-zone bosses (src/creatures/zones/showcase.ts). */
  let zoneBoss: ZoneBossShow | null = null;
  /** Cave ceiling the Vigil hangs from: above ground, so the lure sways at head height. */
  const VIGIL_CEILING = 9.5;
  let guns: { body: WeaponBody; t: number; eq: number; shot: number }[] = [];
  let gunAim = 0;
  let heart: BroodHeart | null = null, arm: HostArm | null = null, host: HostBody | null = null, evoStage: EvolutionStage | null = null;
  const HOSTS: ClassId[] = ['neuroInfiltrator', 'venomWraith', 'goreBehemoth'];
  const ORGANS = ['needlemawGland', 'cantorSongSac', 'glasswalkerLens', 'oculimothEye', 'mournbackMarrow'];
  let yaw = Number(q.get('yaw') ?? 0.6), pitch = 0.12, zoom = 1;
  let walkAngle = 0;

  const ui = document.createElement('div');
  ui.id = 'viewer';
  ui.innerHTML = `
    <style>
      #viewer { position:fixed; left:18px; top:18px; width:270px; padding:14px; background:rgba(5,15,12,.82); border:1px solid var(--acid);
        clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px); font-size:12px; z-index:5; }
      #viewer h1 { font-size:14px; margin:0 0 4px; color:var(--acid); letter-spacing:.14em; }
      #viewer .sub { opacity:.65; font-size:10px; margin-bottom:10px; text-transform:none; letter-spacing:.02em; }
      #viewer .row { display:flex; flex-wrap:wrap; gap:5px; margin:8px 0; }
      #viewer button { background:rgba(11,42,38,.9); color:var(--bone); border:1px solid rgba(108,255,74,.45); padding:5px 8px; font:inherit; font-size:11px; cursor:pointer; text-transform:uppercase; }
      #viewer button.on { border-color:var(--acid); color:var(--acid); box-shadow:0 0 10px rgba(108,255,74,.4); }
      #viewer .card { margin-top:10px; border-top:1px solid rgba(108,255,74,.3); padding-top:8px; text-transform:none; letter-spacing:.02em; line-height:1.45; }
      #viewer .card b { color:var(--acid); text-transform:uppercase; letter-spacing:.1em; }
      #viewer.hidden { display:none; }
    </style>
    <h1>SPECIMEN VIEWER</h1>
    <div class="sub">Drag to orbit, wheel to zoom. H hides this panel.</div>
    <div class="row" id="v-species"></div>
    <div class="row" id="v-stage"></div>
    <div class="row">
      <button id="v-walk">Walk</button><button id="v-strike">Strike</button><button id="v-sever">Sever limb</button>
      <button id="v-burrow" title="New-zone creatures: dive under the sand or water">Burrow</button><button id="v-act" title="New-zone creatures: species action (quill volley, neck out, jaws)">Act</button>
      <button id="v-kill">Gib</button><button id="v-seed">New seed</button><button id="v-lineup">Lineup</button>
      <button id="v-nest">Brood Heart</button><button id="v-organs">Organs</button><button id="v-arm">Host arm</button><button id="v-host">Hosts</button><button id="v-boss">Reliquary</button><button id="v-warden">Warden</button><button id="v-vigil">Pale Vigil</button><button id="v-weapons">Weapons</button>
      ${ZONE_BOSSES.map((z) => `<button data-zone-boss="${z.id}">${z.label}</button>`).join('')}
      <button id="v-env">${env === 'zone7' ? 'Hive lab' : 'Zone 7'}</button>
    </div>
    <div class="card" id="v-card"></div>`;
  document.body.appendChild(ui);
  document.querySelector('#hud')?.remove();
  const $ = <T extends HTMLElement>(s: string) => ui.querySelector<T>(s)!;
  for (const id of SPECIES_IDS) {
    const b = document.createElement('button');
    b.textContent = (ABOMINATIONS as Record<string, Abomination>)[id]?.label ?? id;
    b.dataset.species = id;
    b.onclick = () => { lineup = false; st.species = id; st.stage = 0; rebuild(); };
    $('#v-species').appendChild(b);
  }
  for (let s = 0; s <= MAX_STAGE; s++) {
    const b = document.createElement('button');
    b.textContent = `Stage ${s}`;
    b.dataset.stage = String(s);
    b.onclick = () => api.mutate(s);
    $('#v-stage').appendChild(b);
  }
  $('#v-walk').onclick = () => { st.walking = !st.walking; refreshUi(); };
  $('#v-strike').onclick = () => { st.striking = 1.2; };
  $('#v-burrow').onclick = () => api.burrow(!st.burrowed);
  $('#v-act').onclick = () => api.act();
  $('#v-sever').onclick = () => api.sever();
  $('#v-kill').onclick = () => api.gib();
  $('#v-seed').onclick = () => { st.seed = (st.seed * 7919 + 13) % 100000; rebuild(); };
  $('#v-lineup').onclick = () => { lineup = !lineup; rebuild(); };
  $('#v-nest').onclick = () => { if (extra === 'nest') api.pulse(); else api.nest(); };
  $('#v-weapons').onclick = () => { if (extra === 'weapons') api.reloadGuns(); else api.weapons(); };
  $('#v-boss').onclick = () => { if (extra === 'boss') api.phase(); else api.boss(); };
  $('#v-warden').onclick = () => { if (extra === 'warden') api.wardenPhase(); else api.warden(); };
  $('#v-vigil').onclick = () => { if (extra === 'vigil') api.vigilPhase(); else api.vigil(); };
  ui.querySelectorAll<HTMLButtonElement>('[data-zone-boss]').forEach((b) => { b.onclick = () => { const id = b.dataset.zoneBoss as ZoneBossId; if (zoneBoss?.id === id) api.zoneBossPhase(); else api.zoneBoss(id); }; });
  $('#v-organs').onclick = () => api.organs();
  // Each class, then its evolutions: Infiltrator, Neuro-Hound, Spore-Caster, Psych-Warlock, Wraith, Acid Parasite, ...
  const HOST_LOOKS = HOSTS.flatMap((c) => [[c, undefined], ...Object.entries(EVOLUTION_BODIES).filter(([, k]) => k === c).map(([e]) => [c, e])] as [ClassId, string | undefined][]);
  $('#v-host').onclick = () => {
    const i = HOST_LOOKS.findIndex(([c, e]) => c === host?.classId && (e ?? null) === host?.evolution);
    api.host(...HOST_LOOKS[(i + 1) % HOST_LOOKS.length]);
  };
  $('#v-arm').onclick = () => { if (extra !== 'arm') api.arm(); else api.arm(VIRUS_LOOKS[(VIRUS_LOOKS.indexOf(arm!.current as VirusLook) + 1) % VIRUS_LOOKS.length]); };
  $('#v-env').onclick = () => { const u = new URL(location.href); u.searchParams.set('env', env === 'zone7' ? 'hive' : 'zone7'); location.href = u.href; };
  addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') ui.classList.toggle('hidden'); });

  const refreshUi = () => {
    ui.querySelectorAll<HTMLButtonElement>('[data-species]').forEach((b) => b.classList.toggle('on', !lineup && b.dataset.species === st.species));
    ui.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) => b.classList.toggle('on', Number(b.dataset.stage) === st.stage));
    $('#v-walk').classList.toggle('on', st.walking);
    $('#v-burrow').classList.toggle('on', st.burrowed);
    $('#v-lineup').classList.toggle('on', lineup);
    const t = (ABOMINATIONS as Record<string, Abomination>)[st.species];
    for (const k of ['nest', 'organs', 'arm', 'host', 'boss', 'warden', 'vigil', 'weapons']) $(`#v-${k}`).classList.toggle('on', extra === k);
    ui.querySelectorAll<HTMLButtonElement>('[data-zone-boss]').forEach((b) => b.classList.toggle('on', zoneBoss?.id === b.dataset.zoneBoss));
    if (extra) {
      $('#v-card').innerHTML = extra === 'zoneBoss' ? zoneBoss!.card() : extra === 'weapons' ? '<b>Living weapons</b><br>The grown roster. Click again to reload them all; Strike fires.'
        : extra === 'warden' ? `<b>The Warden of the Long Seed</b><br>Phase ${warden?.drive.phase} · pods ${warden?.podsAlive}. Click again for the next phase; Walk sends it round the stage, Strike thrusts the root spear, Sever shatters a seed pod, Gib kills it.`
        : extra === 'vigil' ? `<b>The Pale Vigil</b><br>Phase ${vigil?.drive.phase} · limbs ${vigil?.limbsIntact}/4. Click again for the next phase (stalk unfolds it, unravel splits the skin); Walk shrieks, Strike snatches at you, Sever takes a limb, Gib kills it.`
        : extra === 'boss' ? `<b>The Reliquary</b><br>Phase ${boss?.drive.phase} · legs ${boss?.legsIntact}/6. Click again for the next phase; Walk circles it, Strike stamps, Sever takes a leg (or a heart in bloom), Gib kills it.`
        : extra === 'nest' ? '<b>Brood Heart</b><br>Wave nest. Click again to pulse a wave; sever pops a weak point; gib destroys it.'
        : extra === 'organs' ? '<b>Harvest organs</b><br>Gland, song sac, lens, eye, marrow.'
        : extra === 'host' ? `<b>Host</b><br>${host?.classId}${host?.evolution ? ` → ${host.evolution}` : ''} · click again for the next body` : `<b>Host arm</b><br>${arm?.current ?? 'clean'} · click again for the next virus`;
      return;
    }
    $('#v-card').innerHTML = lineup ? '<b>Larva roster</b><br>All five Abominations at the selected stage.' :
      `<b>${t?.label ?? st.species}</b> · ${t?.role ?? ''}<br>Biomass ${t?.biomass ?? '?'} · weak point: ${(t?.weakPoint as { name?: string })?.name ?? '?'}<br>Seed ${st.seed} · mutation stage ${st.stage}/${MAX_STAGE}`;
  };

  const place = (c: Creature, x: number, z: number, faceYaw: number) => {
    c.ground = ground;
    c.root.position.set(origin.x + x, ground(origin.x + x, origin.z + z), origin.z + z);
    c.root.rotation.y = faceYaw;
    c.drive.excite = 0.5;
    // Sky-sized hovers (the Lumen Grazer) come down to the stage lights, low enough that their curtains brush the floor.
    if (c.plan.locomotion === 'hover' && c.plan.radius > 6) c.drive.altitude = c.plan.radius * 1.5;
    scene.add(c.root);
    if (soft) simplifyForSoftware(c.root);
    c.plant();
  };

  function clearExtras(): void {
    extras.clear();
    heart = null; arm = null; host = null; evoStage = null; boss = null; warden = null; vigil = null; zoneBoss = null; guns = []; extra = null;
  }

  function clearAll(): void {
    for (const c of creatures) c.root.removeFromParent();
    creatures = [];
    clearExtras();
  }

  function rebuild(): void {
    clearAll();
    if (lineup) {
      // Small ones in front, the big ones behind: one group shot of the roster.
      const spots: [SpeciesId, number, number, number][] = [
        ['mournback', 0.4, -3.2, 0.25], ['glasswalker', -4.4, -1.2, 0.7], ['bilecantor', 5.2, -3.6, -0.4], ['needlemaw', 1.9, 1.6, -0.5], ['oculimoth', -1.6, 2.4, 0.3],
      ];
      spots.forEach(([id, x, z, f], i) => { const c = new Creature(id, st.seed + i, st.stage); place(c, x, z, f); creatures.push(c); });
    } else {
      const c = new Creature(st.species, st.seed, st.stage);
      place(c, 0, 0, 0);
      creatures.push(c);
    }
    refreshUi();
  }

  const frame = () => {
    const c = creatures[0];
    let target = new THREE.Vector3(origin.x, origin.y + 1, origin.z), dist = 6;
    if (extra === 'nest') { target.set(origin.x, origin.y + 2.3, origin.z); dist = 15; }
    else if (extra === 'weapons') { target.set(origin.x, origin.y + 1.2, origin.z); dist = guns.length > 1 ? 3.6 : 2.4; }
    else if (extra === 'warden') { target.set(origin.x, origin.y + 2.2, origin.z - 6); dist = 24; }
    else if (extra === 'vigil') { target.set(origin.x, origin.y + 5.2, origin.z); dist = 17; }
    else if (extra === 'zoneBoss' && zoneBoss) { target.set(origin.x, origin.y + zoneBoss.frame.y, origin.z + zoneBoss.frame.z); dist = zoneBoss.frame.dist; }
    else if (extra === 'boss') { target.set(origin.x, origin.y + 4.2, origin.z); dist = 26; }
    else if (extra === 'organs') { target.set(origin.x, origin.y + 1.2, origin.z); dist = 1.75; }
    else if (extra === 'host') { target.set(origin.x, origin.y + 1.1, origin.z); dist = 4.2; }
    else if (extra === 'arm') { target.set(origin.x, origin.y + 1.25, origin.z); dist = 0.75; }
    else if (lineup) { target.set(origin.x + 0.4, origin.y + 2.0, origin.z - 0.8); dist = 13; }
    else if (c) {
      const r = c.plan.radius, h = c.plan.bodyHeight;
      const top = c.plan.locomotion === 'walker' ? h : h;
      const hoverY = (c.drive.altitude ?? h) - Math.min(1.3, r);
      target.copy(c.root.position).setY(c.root.position.y + (c.plan.locomotion === 'hover' ? hoverY : c.plan.locomotion === 'flyer' ? h : top * 0.8));
      dist = c.plan.locomotion === 'hover' ? Math.max(4, r * 6.3) : c.plan.locomotion === 'flyer' ? 1.7 : Math.max(2.2, r * 3.4 + h * 1.4);
      if (st.walking) { target.set(origin.x, target.y, origin.z); dist = Math.max(3.2, r * 3.2) * 2.6 + h; }
    }
    dist *= zoom;
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist + 0.3, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(target);
  };

  // Orbit controls.
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.006; pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.004, -0.2, 1.2);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('wheel', (e) => { zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.35, 3); });

  const api = {
    show(species: SpeciesId, seed = st.seed, stage = 0) { lineup = false; st.species = species; st.seed = seed; st.stage = stage; rebuild(); },
    lineup(stage = st.stage) { lineup = true; st.stage = stage; rebuild(); },
    /** Mutate to `stage` with the dissolve-grow transition (only new parts grow in). */
    mutate(stage: number) {
      if (stage <= st.stage || lineup) { st.stage = stage; rebuild(); return; }
      const old = creatures[0];
      const next = Creature.grown(old, stage);
      next.drive.excite = old.drive.excite;
      scene.add(next.root);
      if (soft) simplifyForSoftware(next.root);
      old.root.removeFromParent();
      creatures[0] = next;
      st.stage = stage;
      if (next.rig.growth) mutation.growIn(next.rig.growth, { duration: 2.2, colour: next.plan.palette.glow });
      for (const p of next.rig.parts.values()) if (p.mesh.userData.growth) mutation.growIn(p.mesh, { duration: 2.2, colour: next.plan.palette.glow });
      refreshUi();
    },
    /** The Brood Heart nest on the stage. */
    nest() {
      clearAll();
      extra = 'nest';
      heart = new BroodHeart(st.seed, scene);
      heart.root.position.copy(origin);
      extras.add(heart.root);
      if (soft) simplifyForSoftware(heart.root);
      heart.refresh();
      refreshUi();
    },
    pulse() { heart?.pulse(); },
    /** The living weapon roster in two rows, barrels pointing left. */
    weapons(only?: string) {
      clearAll();
      extra = 'weapons';
      const ids = only ? WEAPON_BODIES.filter((w) => w === only) : WEAPON_BODIES;
      ids.forEach((id, i) => {
        const body = createWeaponBody(id);
        const one = ids.length === 1;
        body.gun.position.set(origin.x + (one ? 0 : ((i % 3) - 1) * 0.85), origin.y + (one ? 1.2 : 1.8 - Math.floor(i / 3) * 0.3), origin.z);
        body.gun.rotation.y = -Math.PI / 2;
        if (one) body.gun.scale.setScalar(2.2);
        extras.add(body.gun);
        guns.push({ body, t: 99, eq: 9, shot: 9 });
      });
      if (soft) simplifyForSoftware(extras);
      refreshUi();
    },
    /** Start every weapon's reload. */
    reloadGuns() { for (const g of guns) g.t = 0; },
    /** Draw every weapon (the organism wakes). */
    equipGuns() { for (const g of guns) g.eq = 0; },
    /** Fire every weapon once. */
    fireGuns() { for (const g of guns) g.shot = 0; },
    /** Grow (or shed) a mod graft on every weapon; no slot = all four. */
    graftGuns(slot?: ModSlot, on = true) { for (const g of guns) for (const k of slot ? [slot] : MOD_SLOTS) g.body.graft(k, on); },
    /** Bud real mods (data/mods.json) onto every weapon, a different mix per gun. */
    modGuns() {
      const bySlot = (k: ModSlot) => Object.keys(MODS).filter((m) => MODS[m].slot === k);
      guns.forEach((g, i) => { for (const k of MOD_SLOTS) { const list = bySlot(k); g.body.graft(k, true, list[(i + MOD_SLOTS.indexOf(k)) % list.length]); } });
    },
    /** Aim all weapons (0..1). */
    aimGuns(k: number) { gunAim = k; },
    /** The Reliquary boss on the stage. */
    boss() {
      clearAll();
      extra = 'boss';
      boss = new Reliquary(st.seed, scene);
      boss.ground = ground;
      boss.root.position.set(origin.x, ground(origin.x, origin.z), origin.z);
      extras.add(boss.root);
      if (soft) simplifyForSoftware(boss.root);
      boss.plant();
      refreshUi();
    },
    /** The Warden of the Long Seed on the stage (a 20 m reactor centipede; it clings to any surface). */
    warden() {
      clearAll();
      extra = 'warden';
      warden = new Warden(st.seed, scene);
      warden.root.position.set(origin.x, ground(origin.x, origin.z), origin.z + 4);
      extras.add(warden.root);
      if (soft) simplifyForSoftware(warden.root);
      warden.plant();
      refreshUi();
    },
    /** The Pale Vigil hanging upside down from a cave ceiling over the stage (Fungal Cave boss). */
    vigil() {
      clearAll();
      extra = 'vigil';
      const top = ground(origin.x, origin.z) + VIGIL_CEILING;
      const roof = new THREE.Mesh(new THREE.CircleGeometry(9, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: ZONE7_SHADE.rockDeep, roughness: 0.95 }));
      roof.position.set(origin.x, top + 0.05, origin.z);
      extras.add(roof);
      vigil = new PaleVigil(st.seed, scene);
      vigil.root.position.set(origin.x, top, origin.z);
      vigil.root.rotation.set(0, 0, Math.PI);
      extras.add(vigil.root);
      if (soft) simplifyForSoftware(vigil.root);
      vigil.plant();
      refreshUi();
    },
    /** Set (or cycle) the Vigil's phase: hang folds it to the ceiling, stalk unfolds it, unravel splits its skin. */
    /** A new-zone boss on the stage (Sandwidow, ...). */
    zoneBoss(id: ZoneBossId) {
      clearAll();
      extra = 'zoneBoss';
      zoneBoss = showZoneBoss(id, st.seed, scene, ground, origin);
      extras.add(zoneBoss.root);
      if (soft) simplifyForSoftware(zoneBoss.root);
      refreshUi();
    },
    zoneBossPhase(p?: string) { zoneBoss?.nextPhase(p); refreshUi(); },
    vigilPhase(p?: VigilPhase) {
      if (!vigil) return;
      const order: VigilPhase[] = ['hang', 'stalk', 'unravel'];
      vigil.drive.phase = p ?? order[(order.indexOf(vigil.drive.phase) + 1) % order.length];
      vigil.drive.hanging = vigil.drive.phase === 'hang' ? 1 : 0;
      refreshUi();
    },
    /** Set (or cycle) the Warden's phase; overheat opens two seams, meltdown all four and pulses. */
    wardenPhase(p?: WardenPhase) {
      if (!warden) return;
      const order: WardenPhase[] = ['tend', 'overheat', 'meltdown'];
      const next = p ?? order[(order.indexOf(warden.drive.phase) + 1) % order.length];
      warden.drive.phase = next;
      warden.drive.seamsOpen = next === 'tend' ? [0, 0, 0, 0] : next === 'overheat' ? [1, 0, 1, 0] : [1, 1, 1, 1];
      if (next !== 'tend') warden.steam(0);
      if (next === 'meltdown') warden.pulse();
      refreshUi();
    },
    /** Set (or cycle) the boss phase. Bloom rears and opens the cage; collapse drops it on its forelegs. */
    phase(p?: ReliquaryPhase) {
      if (!boss) return;
      const order: ReliquaryPhase[] = ['stalk', 'bloom', 'collapse'];
      boss.drive.phase = p ?? order[(order.indexOf(boss.drive.phase) + 1) % 3];
      boss.drive.heartsOpen = boss.drive.phase !== 'stalk';
      boss.drive.rear = boss.drive.phase === 'stalk' ? 0 : 1;
      if (boss.drive.phase === 'bloom') boss.vent();
      refreshUi();
    },
    /** The five Larva harvest organs in a row. */
    organs() {
      clearAll();
      extra = 'organs';
      ORGANS.forEach((id, i) => {
        const o = organMesh(id);
        o.position.set(origin.x + (i - 2) * 0.24, origin.y + 1.2, origin.z);
        o.userData.spin = true;
        extras.add(o);
      });
      if (soft) simplifyForSoftware(extras);
      refreshUi();
    },
    /** The host's forearm; pass a virus to dissolve-grow into it. */
    arm(virus?: VirusLook) {
      if (extra !== 'arm') {
        clearAll();
        extra = 'arm';
        arm = new HostArm();
        arm.root.position.set(origin.x - 0.18, origin.y + 1.25, origin.z);
        arm.root.rotation.set(0, 0, -Math.PI / 2);
        extras.add(arm.root);
      }
      if (virus) arm!.mutate(virus, 2.5);
      refreshUi();
    },
    /** Play the evolution scene on the host on show: it shudders, burns away and regrows as `evolution`. */
    evolve(evolution: string) {
      if (!evoStage) return false;
      evoStage.evolve(evolution, () => refreshUi());
      host = evoStage.body;
      refreshUi();
      return true;
    },
    /** A playable host body (Hive menu look). */
    host(classId: ClassId = 'neuroInfiltrator', evolution?: string) {
      clearAll();
      extra = 'host';
      evoStage = new EvolutionStage(classId, evolution, soft ? simplifyForSoftware : undefined);
      host = evoStage.body;
      evoStage.root.position.copy(origin);
      extras.add(evoStage.root);
      refreshUi();
    },
    sever(id?: string) {
      if (boss) {
        const leg = boss.drive.phase === 'stalk' ? -1 : [5, 3, 4, 2, 0, 1].find((i) => boss!.legsIntact > 2 && boss!.hitSpheres.some((h) => h.tag === 'leg' && h.index === i && h.r > 0));
        if (leg !== undefined && leg >= 0) { boss.severLeg(leg); refreshUi(); return true; }
        const w = boss.weakPoints.findIndex((p) => p.alive); boss.popWeakPoint(w); return w >= 0;
      }
      if (warden) { const i = warden.weakPoints.findIndex((w) => w.alive); warden.popWeakPoint(i); refreshUi(); return i >= 0; }
      if (zoneBoss) { const ok = zoneBoss.sever(); refreshUi(); return ok; }
      if (vigil) { const i = vigil.limbs.findIndex((l) => !l.severed); if (i >= 0) vigil.severLimb(i); else vigil.popWeakPoint(0); refreshUi(); return i >= 0; }
      if (heart) { const i = heart.weakPoints.findIndex((w) => w.alive); heart.popWeakPoint(i); heart.hurt((i + 1) / heart.weakPoints.length * 0.5); return i >= 0; }
      const c = creatures[0];
      const limb = id ?? [...c.rig.limbs.values()].filter((l) => !l.severed && l.spec.severable).map((l) => l.spec.id)[0];
      return limb ? creatureGore.sever(scene, c, limb, new THREE.Vector3(Math.random() * 2 - 1, 0, 1.5)) : false;
    },
    gib() {
      if (heart) { heart.destroy(); return; }
      if (boss) { boss.destroy(); return; }
      if (warden) { warden.destroy(); return; }
      if (vigil) { vigil.destroy(); return; }
      if (zoneBoss) { zoneBoss.gib(); return; }
      const c = creatures[0];
      creatureGore.burstAll(scene, c, new THREE.Vector3(0, 2, 0));
      creatureGore.pool(scene, c);
      c.alive = false;
    },
    /** Body-language tells (creature minds) on every creature on show, e.g. { tilt: 1 } or { recoil: 1, dark: 0.8 }. */
    mind(tells: Partial<MindTells>) { for (const c of creatures) Object.assign(c.drive.mind, tells); },
    walk(on: boolean) { st.walking = on; refreshUi(); },
    strike() { st.striking = 1.2; },
    /** New-zone creatures: dive under (Dunewake into sand, Fenstalker under water) or surface. */
    burrow(on: boolean) { st.burrowed = on; refreshUi(); },
    /** New-zone creatures: the species action for ~1.5 s (see each file in src/creatures/zones). */
    act() { st.acting = 1.5; },
    view(y: number, p = pitch, z = 1) { yaw = y; pitch = p; zoom = z; },
    state() { return { ...st, lineup, extra, arm: arm?.current ?? null, host: host?.classId ?? null, evolution: host?.evolution ?? null, evolving: evoStage?.phase ?? null, nestWeak: heart?.weakPoints.filter((w) => w.alive).length ?? null, nestAlive: heart?.alive ?? null, weapons: guns.length, zoneBoss: zoneBoss ? { id: zoneBoss.id, ...zoneBoss.state() } : null, vigil: vigil ? { phase: vigil.drive.phase, limbs: vigil.limbsIntact, lure: vigil.lureAlive, alive: vigil.alive } : null, warden: warden ? { phase: warden.drive.phase, pods: warden.podsAlive, seams: warden.seamsAlive, alive: warden.alive } : null, boss: boss ? { phase: boss.drive.phase, legs: boss.legsIntact, weak: boss.weakPoints.filter((w) => w.alive).length, alive: boss.alive } : null, creatures: creatures.map((c) => ({ species: c.species, stage: c.plan.stage, limbs: c.rig.limbs.size, severed: [...c.rig.limbs.values()].filter((l) => l.severed).length })) }; },
    stats() { const i = pipeline.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0 }; },
  };
  (window as unknown as { __biophageViewer: typeof api }).__biophageViewer = api;

  const resize = () => { pipeline.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  resize();
  rebuild();

  let frames = 0;
  const clock = new THREE.Clock();
  pipeline.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    st.striking = Math.max(0, st.striking - dt);
    st.acting = Math.max(0, st.acting - dt);
    for (const [i, c] of creatures.entries()) {
      const d = c.drive;
      d.windup = st.striking > 0 ? Math.min(1, (1.2 - st.striking) / 0.5) : 0;
      d.look = camera.position;
      d.burrow = THREE.MathUtils.damp(d.burrow, st.burrowed ? 1 : 0, 2.2, dt);
      d.action = Math.min(1, st.acting * 2);
      d.strike = st.striking > 0 ? c.root.localToWorld(new THREE.Vector3(0, c.plan.bodyHeight * 0.6, c.plan.radius * 2.6)) : null;
      if (st.walking && !lineup && i === 0 && c.alive) {
        const R = Math.max(3.2, c.plan.radius * 3.2), speed = c.plan.locomotion === 'walker' ? 1.1 + c.plan.radius * 0.6 : 2.5;
        walkAngle += (speed / R) * dt;
        const nx = origin.x + Math.cos(walkAngle) * R, nz = origin.z + Math.sin(walkAngle) * R;
        d.velocity.set(nx - c.root.position.x, 0, nz - c.root.position.z).divideScalar(Math.max(dt, 1e-4));
        c.root.position.set(nx, ground(nx, nz), nz);
        c.root.rotation.y = Math.atan2(-Math.sin(walkAngle), Math.cos(walkAngle));
        d.excite = 1;
      } else d.velocity.set(0, 0, 0);
      c.update(dt);
    }
    creatureGore.update(dt);
    if (boss) {
      // Walk: a slow circle around the stage. Strike: a stamp toward the camera side.
      const d = boss.drive;
      d.look = camera.position;
      d.windup = st.striking > 0 ? Math.min(1, (1.2 - st.striking) / 0.9) : 0;
      if (st.striking > 0) d.strike ??= boss.root.localToWorld(new THREE.Vector3(-2.5, 0, 7));
      else if (d.strike) { boss.slam(); d.strike = null; }
      if (st.walking && boss.alive) {
        const R = 14, speed = d.phase === 'collapse' ? 3.2 : d.phase === 'bloom' ? 1.8 : 2.4;
        walkAngle += (speed / R) * dt;
        const nx = origin.x + Math.cos(walkAngle) * R, nz = origin.z + Math.sin(walkAngle) * R;
        boss.root.position.set(nx, ground(nx, nz), nz);
        boss.root.rotation.y = Math.atan2(-Math.sin(walkAngle), Math.cos(walkAngle));
      }
      boss.update(dt);
    }
    if (warden) {
      const d = warden.drive;
      d.look = camera.position;
      d.windup = st.striking > 0 ? Math.min(1, (1.2 - st.striking) / 0.6) : 0;
      d.strike = st.striking > 0 && st.striking < 0.6 ? camera.position.clone() : null;
      if (st.walking && warden.alive) {
        const R = 9;
        walkAngle += (3 / R) * dt;
        const nx = origin.x + Math.cos(walkAngle) * R, nz = origin.z + Math.sin(walkAngle) * R;
        warden.root.position.set(nx, ground(nx, nz), nz);
        warden.root.rotation.y = Math.atan2(-Math.sin(walkAngle), Math.cos(walkAngle));
      }
      warden.update(dt);
    }
    zoneBoss?.tick({ dt, time: clock.elapsedTime, camera: camera.position, origin, striking: st.striking, walking: st.walking, acting: st.acting });
    if (vigil) {
      const d = vigil.drive;
      d.look = camera.position;
      d.windup = st.striking > 0 ? Math.min(1, (1.2 - st.striking) / 0.6) : 0;
      d.strike = st.striking > 0 && st.striking < 0.6 ? camera.position.clone().lerp(vigil.root.position, 0.4) : null;
      d.rear = st.walking && vigil.alive ? Math.max(0, Math.sin(clock.elapsedTime * 0.8)) : 0;
      vigil.update(dt);
    }
    for (const g of guns) {
      g.t += dt;
      const dur = g.body.reloadStyle === 'perShell' ? 2.4 : 1.8;
      const r = g.t < dur ? g.t / dur : null;
      g.eq += dt;
      g.shot += dt;
      const shot = st.striking > 0 ? (1.2 - st.striking) % 0.25 : g.shot;
      g.body.animate(dt, { reload: r, style: g.body.reloadStyle, aim: gunAim, sinceFire: shot, ammo: r === null ? 1 : r, shells: r === null ? 0 : Math.floor(r * 4), equip: Math.min(1, g.eq / 0.7) });
    }
    heart?.update(dt);
    arm?.update(dt);
    evoStage?.update(dt);
    for (const o of extras.children) if (o.userData.spin) o.rotation.y += dt * 0.6;
    frame();
    pipeline.render(dt);
    frames++;
    (window as unknown as { __biophage: object }).__biophage = { frames, viewer: true };
  });
}
