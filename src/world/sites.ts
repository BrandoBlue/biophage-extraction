import * as THREE from 'three';
import { GRADE, PATH, ZONE7 } from '../render/palette';
import { bioNode, bioTime, crystal, fungusStem, liquidLight, membrane } from '../render/materials';
import { crystalClusterGeometry, stemGeometry } from '../render/geometry';
import { ZONE7_SITES } from '../../data';
import type { Site, Zone7Layout } from './layout';
import { mulberry32 } from './rng';

/**
 * Set dressing for the raid's gameplay sites: Seed Spire pads (live and dormant), the Brood Heart crater,
 * Gene Bloom harvest nodes and the Gravity Bloom anomaly. Visual only; Gameplay owns the props and rules.
 * Every piece reuses the zone's existing material types so the first frame compiles no new shader families.
 */
export interface SiteDressing {
  group: THREE.Group;
  /** Light a late Seed Spire pad when it opens (Gameplay calls this when the spire activates). */
  setExtractOpen(id: string, open: boolean): void;
  /** Wither a Gene Bloom once it has been harvested. */
  setNodeHarvested(id: string, harvested: boolean): void;
}

type Height = (x: number, z: number) => number;

const tube = (pts: THREE.Vector3[], r: number, seg = 16) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 5);

/** Ribbed arch ring around a Seed Spire pad: bone-like stems curling in toward the spire. */
function padRibs(x: number, z: number, y: number, radius: number, rand: () => number, mat: THREE.Material): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3;
    const r0 = radius * 0.95, h = 3.5 + rand() * 3;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [
      new THREE.Vector3(x + c * r0, y - 0.4, z + s * r0),
      new THREE.Vector3(x + c * r0 * 1.05, y + h * 0.55, z + s * r0 * 1.05),
      new THREE.Vector3(x + c * r0 * 0.85, y + h, z + s * r0 * 0.85),
      new THREE.Vector3(x + c * r0 * 0.6, y + h * 0.9, z + s * r0 * 0.6),
    ];
    out.push(new THREE.Mesh(tube(pts, 0.22 + rand() * 0.12), mat));
  }
  return out;
}

export function buildSites(layout: Zone7Layout, height: Height, seed = 7): SiteDressing {
  const rand = mulberry32(seed * 31 + 5);
  const group = new THREE.Group();
  group.name = 'zone7-sites';

  const ribMat = fungusStem(ZONE7.cyan);
  const liveRing = bioNode(ZONE7.lime, 3);
  const lateRing = bioNode(ZONE7.violet, 1.2);
  const deadCrystal = crystal(ZONE7.violet);
  const padRadius = ZONE7_SITES.padRadius;

  // ---- Seed Spire pads. Live pads get a glowing ring and a sky beacon; dormant pads are broken husks.
  const rings = new Map<string, { ring: THREE.Mesh; beacon: THREE.Mesh }>();
  const beaconMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  layout.extracts.forEach((e, i) => {
    const y = height(e.x, e.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(padRadius * 0.55, 0.12, 6, 64).rotateX(-Math.PI / 2), e.opensAt > 0 ? lateRing : liveRing);
    ring.position.set(e.x, y + 0.08, e.z);
    ring.name = `spire-pad-${e.id}`;
    const beacon = new THREE.Mesh(beaconGeometry(rand), beaconMat);
    beacon.position.set(e.x, y, e.z);
    // The first beacon keeps its Spore name: the Raid already moves it onto its active extract.
    beacon.name = i === 0 ? 'extraction-beacon' : `extraction-beacon-${e.id}`;
    beacon.visible = e.opensAt <= 0;
    group.add(ring, beacon, ...padRibs(e.x, e.z, y, padRadius, rand, ribMat));
    rings.set(e.id, { ring, beacon });
  });
  const shards: { pos: THREE.Vector3; scale: number; yaw: number; tilt: number }[] = [];
  for (const p of layout.dormantPads) {
    const y = height(p.x, p.z);
    group.add(...padRibs(p.x, p.z, y, padRadius, rand, ribMat).filter((_, i) => i % 2 === 0));
    for (let k = 0; k < 5; k++) {
      const a = rand() * Math.PI * 2, d = rand() * 2.2;
      shards.push({ pos: new THREE.Vector3(p.x + Math.cos(a) * d, y - 0.3, p.z + Math.sin(a) * d), scale: 0.6 + rand() * 1.4, yaw: rand() * 6.28, tilt: 0.3 + rand() * 0.5 });
    }
  }

  // ---- Brood Heart crater: roots radiating from the heart's bed up over the rim, a clutch of egg sacs.
  const crater = ZONE7_SITES.broodCrater;
  const rootMat = fungusStem(ZONE7.magenta);
  const sacPos: { pos: THREE.Vector3; scale: number }[] = [];
  for (const n of layout.nests) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand() * 0.4;
      const reach = crater.radius * (1.1 + rand() * 0.6);
      const pts = [0.08, 0.35, 0.65, 0.9, 1].map((t) => {
        const wob = Math.sin(t * 7 + i) * 1.2 * t;
        const px = n.x + Math.cos(a) * reach * t - Math.sin(a) * wob, pz = n.z + Math.sin(a) * reach * t + Math.cos(a) * wob;
        return new THREE.Vector3(px, height(px, pz) + 0.15 - t * 0.2, pz);
      });
      group.add(new THREE.Mesh(tube(pts, 0.5 - rand() * 0.25, 24), rootMat));
    }
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, d = crater.radius * (0.35 + rand() * 0.55);
      const px = n.x + Math.cos(a) * d, pz = n.z + Math.sin(a) * d;
      const s = 0.35 + rand() * 0.6;
      sacPos.push({ pos: new THREE.Vector3(px, height(px, pz) + s * 0.4, pz), scale: s });
    }
  }
  if (sacPos.length) {
    const sacs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), membrane(ZONE7.magenta, 0.7), sacPos.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    sacPos.forEach((p, i) => sacs.setMatrixAt(i, m.compose(p.pos, q, s.set(p.scale, p.scale * 1.3, p.scale))));
    sacs.name = 'brood-egg-sacs';
    group.add(sacs);
  }

  // ---- Gene Blooms: clusters of tall bulbs on stalks, a DNA-cyan core in each. Instanced across all nodes.
  const bloomOf: { id: string; stalks: number[] }[] = [];
  const stalkM: THREE.Matrix4[] = [], bulbM: THREE.Matrix4[] = [], coreM: THREE.Matrix4[] = [];
  for (const node of layout.nodes) {
    const entry = { id: node.id, stalks: [] as number[] };
    const count = 6 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, d = 0.8 + rand() * 1.8;
      const px = node.x + Math.cos(a) * d, pz = node.z + Math.sin(a) * d;
      const h = 1.2 + rand() * 1.8, w = 0.18 + rand() * 0.1, b = 0.35 + rand() * 0.25;
      const base = new THREE.Vector3(px, height(px, pz) - 0.1, pz);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, a, (rand() - 0.5) * 0.4));
      stalkM.push(new THREE.Matrix4().compose(base, q, new THREE.Vector3(w, h, w)));
      const top = new THREE.Vector3(0.22 * w, 1, 0).applyQuaternion(q).multiplyScalar(h).add(base);
      bulbM.push(new THREE.Matrix4().compose(top, q, new THREE.Vector3(b, b * 1.35, b)));
      coreM.push(new THREE.Matrix4().compose(top, q, new THREE.Vector3(b * 0.45, b * 0.6, b * 0.45)));
      entry.stalks.push(stalkM.length - 1);
    }
    bloomOf.push(entry);
  }
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = list.length;
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  mk(stemGeometry(0.22, 6), fungusStem(ZONE7.lime), stalkM, 'gene-bloom-stalks');
  const bloomBulbs = mk(new THREE.SphereGeometry(1, 16, 12), membrane(PATH.dna, 0.6), bulbM, 'gene-bloom-bulbs');
  const bloomCores = mk(new THREE.IcosahedronGeometry(1, 1), bioNode(PATH.dna, 2.6), coreM, 'gene-bloom-cores');

  // ---- Gravity Bloom: a slowly turning violet lens over a glowing basin, lifting rock and spore debris.
  const an = layout.anomaly;
  const ay = height(an.x, an.z);
  const anomaly = new THREE.Group();
  anomaly.name = `anomaly-${an.kind}`;
  anomaly.position.set(an.x, ay, an.z);
  const basin = new THREE.Mesh(new THREE.CircleGeometry(an.radius * 0.55, 48).rotateX(-Math.PI / 2), liquidLight({ pool: true, a: ZONE7.violet, b: ZONE7.magenta, c: ZONE7.cyan, flow: 0.3 }));
  basin.position.y = 0.25;
  const lensMat = membrane(ZONE7.violet, 0.4);
  const lensA = new THREE.Mesh(new THREE.TorusGeometry(an.radius * 0.46, 0.5, 10, 72), lensMat);
  const lensB = new THREE.Mesh(new THREE.TorusGeometry(an.radius * 0.3, 0.35, 10, 72), lensMat);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 2), bioNode(ZONE7.violet, 1.4));
  lensA.position.y = lensB.position.y = core.position.y = 13;
  // A faint shaft of violet light from basin to lens: the anomaly reads from across the island.
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(an.radius * 0.05, an.radius * 0.3, 26, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: ZONE7.violet, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  shaft.position.y = 13;
  shaft.name = 'anomaly-shaft';
  anomaly.add(basin, shaft, lensA, lensB, core);
  const DEBRIS = 54;
  const debris = new THREE.InstancedMesh(crystalClusterGeometry(rand, 3), deadCrystal, DEBRIS);
  debris.name = 'anomaly-debris';
  const orbit = Array.from({ length: DEBRIS }, () => ({
    r: 2 + Math.sqrt(rand()) * an.radius * 0.6, a: rand() * Math.PI * 2, y: 0.8 + rand() * 20,
    spin: (rand() - 0.5) * 0.25, bob: rand() * 6.28, s: 0.5 + rand() * 1.3,
  }));
  anomaly.add(debris);
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), dp = new THREE.Vector3(), ds = new THREE.Vector3();
  const animate = () => {
    const t = bioTime.value;
    lensA.rotation.set(Math.PI / 2 + Math.sin(t * 0.21) * 0.35, t * 0.17, 0);
    lensB.rotation.set(Math.PI / 2 + Math.cos(t * 0.19) * 0.5, -t * 0.23, 0.4);
    core.scale.setScalar(1 + Math.sin(t * 1.3) * 0.12);
    orbit.forEach((o, i) => {
      const a = o.a + t * o.spin;
      dp.set(Math.cos(a) * o.r, o.y + Math.sin(t * 0.5 + o.bob) * 1.1, Math.sin(a) * o.r);
      dq.setFromEuler(de.set(t * 0.3 + o.bob, t * 0.2 + i, 0));
      debris.setMatrixAt(i, dm.compose(dp, dq, ds.setScalar(o.s)));
    });
    debris.instanceMatrix.needsUpdate = true;
  };
  animate();
  // onBeforeRender only fires on renderables, so the anomaly's animation hangs on its core.
  core.onBeforeRender = animate;
  group.add(anomaly);

  if (shards.length) {
    const husk = new THREE.InstancedMesh(crystalClusterGeometry(rand, 5), deadCrystal, shards.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    shards.forEach((p, i) => husk.setMatrixAt(i, m.compose(p.pos, q.setFromEuler(e.set(p.tilt, p.yaw, p.tilt * 0.5)), s.setScalar(p.scale))));
    husk.name = 'dormant-spire-husks';
    group.add(husk);
  }

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    group,
    setExtractOpen(id, open) {
      const r = rings.get(id);
      if (!r) return;
      r.beacon.visible = open;
      r.ring.material = open ? liveRing : lateRing;
    },
    setNodeHarvested(id, harvested) {
      const b = bloomOf.find((n) => n.id === id);
      if (!b) return;
      for (const i of b.stalks) {
        bloomCores.setMatrixAt(i, harvested ? zero : coreM[i]);
        bloomBulbs.setMatrixAt(i, harvested ? bulbM[i].clone().multiply(new THREE.Matrix4().makeScale(0.6, 0.3, 0.6)) : bulbM[i]);
      }
      bloomCores.instanceMatrix.needsUpdate = bloomBulbs.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Sites whose ground must stay clear of big flora and foreground cover. */
export function clearings(layout: Zone7Layout): (Site & { radius: number })[] {
  return [
    ...layout.extracts.map((e) => ({ ...e, radius: 4 })),
    ...layout.nodes.map((n) => ({ ...n, radius: ZONE7_SITES.geneBlooms.clearingRadius * 0.6 })),
    ...layout.nests.map((n) => ({ ...n, radius: ZONE7_SITES.broodCrater.radius * 0.45 })),
  ];
}

/**
 * Extract beacon: a pale, broken shaft of light rising from the pad. Lime only where it leaves the ground,
 * then washed-out and fading, split into uneven pieces so it reads as spore haze, not a neon tube.
 */
function beaconGeometry(rand: () => number, height = 80): THREE.BufferGeometry {
  const lime = new THREE.Color(ZONE7.lime), pale = new THREE.Color(GRADE.zone7Highlight), c = new THREE.Color();
  const pos: number[] = [], col: number[] = [];
  const sides = 14;
  const vert = (a: number, h: number, fade: number) => {
    const t = h / height, r = 0.55 + t * 0.5;
    pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
    c.copy(lime).lerp(pale, Math.min(1, t * 6));
    col.push(c.r, c.g, c.b, fade * (0.32 * (1 - t) ** 1.6 + 0.02));
  };
  let y = 0;
  while (y < height - 2) {
    const len = y === 0 ? 7 + rand() * 4 : 3 + rand() * 9;
    const y1 = Math.min(height, y + len), mid = y + (y1 - y) * (0.35 + rand() * 0.3);
    // Three rings per piece: soft bottom (solid on the pad), bright middle, soft top, so each break looks hazy.
    const rings = [[y, y === 0 ? 0.6 : 0], [mid, 1], [y1, 0]] as const;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      for (let j = 0; j < 2; j++) {
        const [h0, f0] = rings[j], [h1, f1] = rings[j + 1];
        vert(a0, h0, f0); vert(a1, h0, f0); vert(a1, h1, f1);
        vert(a0, h0, f0); vert(a1, h1, f1); vert(a0, h1, f1);
      }
    }
    y = y1 + 0.6 + rand() * 2.4 * (y / height + 0.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}
