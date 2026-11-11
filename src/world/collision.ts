/**
 * Static collision for World structures (walls, decks, ramps). Pure maths, no three.js, so Vitest can drive it.
 *
 * A collider is an oriented box in the XZ plane (centre, half extents, yaw) spanning y0..y1. Its top is a walkable
 * floor; a ramp's top rises linearly along its local +X axis from `y1 - rise` to `y1`. Bodies are vertical capsules
 * approximated as a circle of `radius` from feet to feet + height.
 *
 * Broadphase: colliders are bucketed in a coarse grid by their XZ bounds, so a query touches only nearby boxes.
 */
export interface Collider {
  cx: number; cz: number;
  hx: number; hz: number;
  yaw: number;
  y0: number; y1: number;
  /** Ramp: the top rises by `rise` metres across the box's local X (from -hx to +hx). */
  rise?: number;
  /** Optional tag for tests and debugging. */
  tag?: string;
}

export interface Vec3Like { x: number; y: number; z: number }

/** Height a body can step up without jumping. */
export const STEP_HEIGHT = 0.55;
const CELL = 8;

/** Local box coordinates of a world point. */
function toLocal(c: Collider, x: number, z: number): [number, number] {
  const dx = x - c.cx, dz = z - c.cz, co = Math.cos(c.yaw), si = Math.sin(c.yaw);
  return [dx * co - dz * si, dx * si + dz * co];
}
function toWorld(c: Collider, lx: number, lz: number): [number, number] {
  const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
  return [c.cx + lx * co + lz * si, c.cz - lx * si + lz * co];
}

/** Top surface height of a collider at local x (ramps slope; boxes are flat). */
function topAt(c: Collider, lx: number): number {
  if (!c.rise) return c.y1;
  const t = Math.min(1, Math.max(0, (lx + c.hx) / (2 * c.hx)));
  return c.y1 - c.rise * (1 - t);
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private grid = new Map<string, number[]>();

  constructor(private ground: (x: number, z: number) => number = () => 0) {}

  clear(): void { this.colliders.length = 0; this.grid.clear(); }

  add(c: Collider): Collider {
    const i = this.colliders.push(c) - 1;
    const r = Math.hypot(c.hx, c.hz);
    for (let gx = Math.floor((c.cx - r) / CELL); gx <= Math.floor((c.cx + r) / CELL); gx++) {
      for (let gz = Math.floor((c.cz - r) / CELL); gz <= Math.floor((c.cz + r) / CELL); gz++) {
        const k = `${gx},${gz}`;
        const list = this.grid.get(k);
        if (list) list.push(i); else this.grid.set(k, [i]);
      }
    }
    return c;
  }

  /** Colliders whose bounds may touch the disc at (x, z) of radius r. */
  near(x: number, z: number, r = 0): Collider[] {
    const out = new Set<number>();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        for (const i of this.grid.get(`${gx},${gz}`) ?? []) out.add(i);
      }
    }
    return [...out].map((i) => this.colliders[i]);
  }

  /**
   * Height of the floor under a body whose feet are at `feetY`: the terrain, or the highest collider top that is
   * no more than a step above the feet (so you walk onto decks and up ramps, and fall off their edges).
   */
  floorAt(x: number, z: number, feetY = Infinity): number {
    let h = this.ground(x, z);
    for (const c of this.near(x, z)) {
      const [lx, lz] = toLocal(c, x, z);
      if (Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
      const top = topAt(c, lx);
      if (top > h && top <= feetY + STEP_HEIGHT) h = top;
    }
    return h;
  }

  /**
   * Height of the lowest ceiling above the body's feet at (x, z) (the underside of a collider), or Infinity.
   */
  ceilingAt(x: number, z: number, feetY: number): number {
    let h = Infinity;
    for (const c of this.near(x, z)) {
      const [lx, lz] = toLocal(c, x, z);
      if (Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
      if (c.y0 > feetY + STEP_HEIGHT && c.y0 < h) h = c.y0;
    }
    return h;
  }

  /**
   * Push a body out of every collider it overlaps sideways. Colliders the body can stand on (top within a step of
   * its feet) or that are wholly above or below it are ignored. Mutates and returns `pos`; `hit` is true if pushed.
   */
  collide(pos: Vec3Like, radius = 0.4, height = 1.8): { pos: Vec3Like; hit: boolean } {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.near(pos.x, pos.z, radius)) {
        const [lx, lz] = toLocal(c, pos.x, pos.z);
        const top = topAt(c, Math.max(-c.hx, Math.min(c.hx, lx)));
        if (top <= pos.y + STEP_HEIGHT || c.y0 >= pos.y + height) continue;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let nx = lx - qx, nz = lz - qz;
        const d = Math.hypot(nx, nz);
        if (d >= radius) continue;
        let px: number, pz: number;
        if (d > 1e-6) {
          nx /= d; nz /= d;
          px = qx + nx * radius; pz = qz + nz * radius;
        } else {
          // Centre inside the box: leave by the nearest face.
          const ex = c.hx - Math.abs(lx), ez = c.hz - Math.abs(lz);
          if (ex < ez) { px = Math.sign(lx || 1) * (c.hx + radius); pz = lz; } else { px = lx; pz = Math.sign(lz || 1) * (c.hz + radius); }
        }
        [pos.x, pos.z] = toWorld(c, px, pz);
        hit = true;
      }
    }
    return { pos, hit };
  }

  /**
   * First hit of the segment a→b against any collider, as a fraction 0..1 along it, or null if clear.
   * For line of sight and projectiles (terrain is not tested here).
   */
  blocked(a: Vec3Like, b: Vec3Like): number | null {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const reach = Math.hypot(b.x - a.x, b.z - a.z) / 2;
    let best: number | null = null;
    for (const c of this.near(mx, mz, reach)) {
      const [ax, az] = toLocal(c, a.x, a.z), [bx, bz] = toLocal(c, b.x, b.z);
      // Slab test in local space; ramps are treated as their bounding box (good enough for sight lines).
      let t0 = 0, t1 = 1;
      const slabs: [number, number, number, number][] = [[ax, bx - ax, -c.hx, c.hx], [a.y, b.y - a.y, c.y0, c.y1], [az, bz - az, -c.hz, c.hz]];
      let miss = false;
      for (const [o, d, lo, hi] of slabs) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { miss = true; break; } continue; }
        let u = (lo - o) / d, v = (hi - o) / d;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) { miss = true; break; }
      }
      if (!miss && (best === null || t0 < best)) best = t0;
    }
    return best;
  }
}
