import * as THREE from 'three';
import { BroodHeart } from './broodheart';
import { HostArm, VIRUS_LOOKS, type VirusLook } from './hostarm';
import { organMesh } from './organs';
import { HostBody } from './hosts';
import type { ClassId } from '../../data';
import { HIVE, PATH, ZONE7 } from '../render/palette';
import { bioSurface, bioNode } from '../render/materials';
import { createPipeline, simplifyForSoftware, type Pipeline } from '../render/pipeline';
import { buildZone7, groundHeight } from '../world/zone7';
import { mutation } from '../render/dissolve';
import { Creature } from './creature';
import { creatureGore } from './gore';
import { SPECIES_IDS } from './species';
import { MAX_STAGE, type SpeciesId } from './plan';
import type { Abomination } from '../../data';
import { ABOMINATIONS } from '../../data';

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

interface ViewerState { species: SpeciesId; seed: number; stage: number; walking: boolean; striking: number; env: 'hive' | 'zone7' }

export function startCreatureViewer(canvas: HTMLCanvasElement): void {
  const q = new URLSearchParams(location.search);
  const env: ViewerState['env'] = q.get('env') === 'zone7' ? 'zone7' : 'hive';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1500);
  // Zone 7: a flat spot on the island (the Bio-Pod clearing).
  const origin = env === 'zone7' ? new THREE.Vector3(22, 0, 0) : new THREE.Vector3();
  const ground = env === 'zone7' ? groundHeight : () => 0;
  if (env === 'zone7') buildZone7(scene); else specimenStage(scene);
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
    species: (q.get('species') as SpeciesId) ?? 'needlemaw', seed: Number(q.get('seed') ?? 7), stage: Number(q.get('stage') ?? 0), walking: q.has('walk'), striking: 0, env,
  };
  let creatures: Creature[] = [];
  let lineup = q.has('lineup');
  // Non-creature specimens: the Brood Heart nest, the harvest organs, the host arm.
  type Extra = 'nest' | 'organs' | 'arm' | 'host' | null;
  let extra: Extra = null;
  const extras = new THREE.Group();
  scene.add(extras);
  let heart: BroodHeart | null = null, arm: HostArm | null = null, host: HostBody | null = null;
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
      <button id="v-kill">Gib</button><button id="v-seed">New seed</button><button id="v-lineup">Lineup</button>
      <button id="v-nest">Brood Heart</button><button id="v-organs">Organs</button><button id="v-arm">Host arm</button><button id="v-host">Hosts</button>
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
  $('#v-sever').onclick = () => api.sever();
  $('#v-kill').onclick = () => api.gib();
  $('#v-seed').onclick = () => { st.seed = (st.seed * 7919 + 13) % 100000; rebuild(); };
  $('#v-lineup').onclick = () => { lineup = !lineup; rebuild(); };
  $('#v-nest').onclick = () => { if (extra === 'nest') api.pulse(); else api.nest(); };
  $('#v-organs').onclick = () => api.organs();
  $('#v-host').onclick = () => api.host(HOSTS[(HOSTS.indexOf(host?.classId as ClassId) + 1) % HOSTS.length]);
  $('#v-arm').onclick = () => { if (extra !== 'arm') api.arm(); else api.arm(VIRUS_LOOKS[(VIRUS_LOOKS.indexOf(arm!.current as VirusLook) + 1) % VIRUS_LOOKS.length]); };
  $('#v-env').onclick = () => { const u = new URL(location.href); u.searchParams.set('env', env === 'zone7' ? 'hive' : 'zone7'); location.href = u.href; };
  addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') ui.classList.toggle('hidden'); });

  const refreshUi = () => {
    ui.querySelectorAll<HTMLButtonElement>('[data-species]').forEach((b) => b.classList.toggle('on', !lineup && b.dataset.species === st.species));
    ui.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) => b.classList.toggle('on', Number(b.dataset.stage) === st.stage));
    $('#v-walk').classList.toggle('on', st.walking);
    $('#v-lineup').classList.toggle('on', lineup);
    const t = (ABOMINATIONS as Record<string, Abomination>)[st.species];
    for (const k of ['nest', 'organs', 'arm', 'host']) $(`#v-${k}`).classList.toggle('on', extra === k);
    if (extra) {
      $('#v-card').innerHTML = extra === 'nest' ? '<b>Brood Heart</b><br>Wave nest. Click again to pulse a wave; sever pops a weak point; gib destroys it.'
        : extra === 'organs' ? '<b>Harvest organs</b><br>Gland, song sac, lens, eye, marrow.'
        : extra === 'host' ? `<b>Host</b><br>${host?.classId} · click again for the next class` : `<b>Host arm</b><br>${arm?.current ?? 'clean'} · click again for the next virus`;
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
    scene.add(c.root);
    if (soft) simplifyForSoftware(c.root);
    c.plant();
  };

  function clearExtras(): void {
    extras.clear();
    heart = null; arm = null; host = null; extra = null;
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
    else if (extra === 'organs') { target.set(origin.x, origin.y + 1.2, origin.z); dist = 1.75; }
    else if (extra === 'host') { target.set(origin.x, origin.y + 1.1, origin.z); dist = 4.2; }
    else if (extra === 'arm') { target.set(origin.x, origin.y + 1.25, origin.z); dist = 0.75; }
    else if (lineup) { target.set(origin.x + 0.4, origin.y + 2.0, origin.z - 0.8); dist = 13; }
    else if (c) {
      const r = c.plan.radius, h = c.plan.bodyHeight;
      const top = c.plan.locomotion === 'walker' ? h : h;
      target.copy(c.root.position).setY(c.root.position.y + (c.plan.locomotion === 'hover' ? h - 1.3 : c.plan.locomotion === 'flyer' ? h : top * 0.8));
      dist = c.plan.locomotion === 'hover' ? 9.5 : c.plan.locomotion === 'flyer' ? 1.7 : Math.max(2.2, r * 3.4 + h * 1.4);
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
    /** A playable host body (Hive menu look). */
    host(classId: ClassId = 'neuroInfiltrator') {
      clearAll();
      extra = 'host';
      host = new HostBody(classId);
      host.root.position.copy(origin);
      extras.add(host.root);
      if (soft) simplifyForSoftware(host.root);
      refreshUi();
    },
    sever(id?: string) {
      if (heart) { const i = heart.weakPoints.findIndex((w) => w.alive); heart.popWeakPoint(i); heart.hurt((i + 1) / heart.weakPoints.length * 0.5); return i >= 0; }
      const c = creatures[0];
      const limb = id ?? [...c.rig.limbs.values()].filter((l) => !l.severed && l.spec.severable).map((l) => l.spec.id)[0];
      return limb ? creatureGore.sever(scene, c, limb, new THREE.Vector3(Math.random() * 2 - 1, 0, 1.5)) : false;
    },
    gib() {
      if (heart) { heart.destroy(); return; }
      const c = creatures[0];
      creatureGore.burstAll(scene, c, new THREE.Vector3(0, 2, 0));
      creatureGore.pool(scene, c);
      c.alive = false;
    },
    walk(on: boolean) { st.walking = on; refreshUi(); },
    strike() { st.striking = 1.2; },
    view(y: number, p = pitch, z = 1) { yaw = y; pitch = p; zoom = z; },
    state() { return { ...st, lineup, extra, arm: arm?.current ?? null, host: host?.classId ?? null, nestWeak: heart?.weakPoints.filter((w) => w.alive).length ?? null, nestAlive: heart?.alive ?? null, creatures: creatures.map((c) => ({ species: c.species, stage: c.plan.stage, limbs: c.rig.limbs.size, severed: [...c.rig.limbs.values()].filter((l) => l.severed).length })) }; },
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
    for (const [i, c] of creatures.entries()) {
      const d = c.drive;
      d.windup = st.striking > 0 ? Math.min(1, (1.2 - st.striking) / 0.5) : 0;
      d.look = camera.position;
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
    heart?.update(dt);
    arm?.update(dt);
    host?.update(dt);
    for (const o of extras.children) if (o.userData.spin) o.rotation.y += dt * 0.6;
    frame();
    pipeline.render(dt);
    frames++;
    (window as unknown as { __biophage: object }).__biophage = { frames, viewer: true };
  });
}
