/**
 * Ground ecology for open terrain (World & Level): where the low growth thickens or thins, where the worn trails run,
 * and where bare rock breaks the surface. Nothing is placed by hand and nothing is uniform noise: density follows
 * slope (steep ground is bare), moisture (lush round pools and along the valley floor), exposure (thin on ridge
 * crests), wear (trails between the named areas) and a few bald patches, so cover reads as grown rather than sprayed.
 */

export interface EcologyContext {
  height(x: number, z: number): number;
  pools: readonly { x: number; z: number; radius: number }[];
  valleys: readonly { points: [number, number][]; halfWidth: number }[];
  ridges: readonly { points: [number, number][]; halfWidth: number }[];
  trails: readonly [number, number][][];
  /** Low-frequency noise in [0, 1]. */
  noise(x: number, z: number): number;
  /** Half extent of the square the grid covers (metres). */
  extent: number;
}

const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Distance from (x, z) to a polyline. */
export function lineDist(x: number, z: number, pts: readonly [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** A trail between area centres that wanders a little (deterministic), one point every ~8 m. */
export function wanderingTrail(stops: readonly [number, number][], noise: (x: number, z: number) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const [ax, az] = stops[i], [bx, bz] = stops[i + 1];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / 8));
    const px = -(bz - az) / len, pz = (bx - ax) / len;
    for (let j = 0; j < n; j++) {
      const t = j / n, ends = Math.sin(t * Math.PI);
      const sway = (noise(ax + (bx - ax) * t, az + (bz - az) * t) - 0.5) * 9 * ends;
      out.push([ax + (bx - ax) * t + px * sway, az + (bz - az) * t + pz * sway]);
    }
  }
  out.push(stops[stops.length - 1]);
  return out;
}

export interface Ecology {
  /** Cover density multiplier at (x, z): 0 bare, 1 typical, up to ~1.4 lush. */
  density(x: number, z: number): number;
  /** Ground slope (rise over run) at (x, z). */
  slope(x: number, z: number): number;
  /** Metres to the nearest trail. */
  trailDist(x: number, z: number): number;
}

/** Bakes the ecology onto a grid once (cell metres) so per-frame lookups are a bilinear sample. */
export function bakeEcology(ctx: EcologyContext, cell = 2): Ecology {
  const n = Math.ceil((ctx.extent * 2) / cell) + 1;
  const at = (i: number) => -ctx.extent + i * cell;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = ctx.height(at(i), at(j));
  const slopeG = new Float32Array(n * n), dens = new Float32Array(n * n), trail = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = at(i), z = at(j);
    const hx = (h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)]) / (2 * cell);
    const hz = (h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i]) / (2 * cell);
    const slope = Math.hypot(hx, hz);
    let k = 1 - smooth(0.32, 0.85, slope);
    let wet = 0;
    for (const p of ctx.pools) wet = Math.max(wet, 1 - smooth(p.radius, p.radius + 16, Math.hypot(x - p.x, z - p.z)));
    for (const v of ctx.valleys) wet = Math.max(wet, 1 - smooth(v.halfWidth * 0.4, v.halfWidth * 1.7, lineDist(x, z, v.points)));
    k *= 0.72 + 0.65 * wet;
    for (const r of ctx.ridges) k *= 0.5 + 0.5 * smooth(r.halfWidth * 0.15, r.halfWidth * 0.9, lineDist(x, z, r.points));
    let td = Infinity;
    for (const t of ctx.trails) td = Math.min(td, lineDist(x, z, t));
    k *= 0.08 + 0.92 * smooth(0.8, 2.6, td);
    k *= smooth(0.16, 0.34, ctx.noise(x, z));
    slopeG[j * n + i] = slope;
    dens[j * n + i] = Math.min(1.4, Math.max(0, k));
    trail[j * n + i] = td;
  }
  const sample = (g: Float32Array, x: number, z: number, outside: number) => {
    const fx = (x + ctx.extent) / cell, fz = (z + ctx.extent) / cell;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return outside;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  return {
    density: (x, z) => sample(dens, x, z, 0.6),
    slope: (x, z) => sample(slopeG, x, z, 0),
    trailDist: (x, z) => sample(trail, x, z, Infinity),
  };
}
