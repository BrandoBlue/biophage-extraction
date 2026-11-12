import * as THREE from 'three';
import { FAUNA } from '../../render/palette';
import type { PlanBuilder } from '../builder';
import type { Rand } from '../parts';

/**
 * Organic pass for the new-zone bodies (Brandon, 2026-11-12: "less geometric, more organic ... a bit too dark").
 * Wraps a builder so every skin primitive added after it is nudged off its perfect shape: radii swell or shrink a
 * little, centres drift, and joins get softer. Mirrored left/right primitives get different nudges, so nothing is
 * exactly symmetric. Surface noise is raised so hides read lumpy rather than smooth primitives.
 *
 * Call it right after creating the builder, before any b.skin().
 */
export function organic(b: PlanBuilder, rand: Rand, opts: { jitter?: number; soften?: number; noise?: number } = {}): void {
  // Shared skin code adds soft joins and a slow lumpy octave (Creature, 2026-11-12), so these stay modest.
  const jitter = opts.jitter ?? 0.08, soften = opts.soften ?? 1.1, noise = opts.noise ?? 1.15;
  b.plan.skinNoise = { amp: b.plan.skinNoise.amp * noise, freq: b.plan.skinNoise.freq * 0.85 };
  const add = b.skin.bind(b);
  b.skin = (p) => {
    if (p.subtract) { add(p); return; }
    const j = () => 1 + (rand() - 0.5) * 2 * jitter;
    const q = { ...p, a: p.a.clone() };
    const size = p.radii ? Math.min(p.radii.x, p.radii.y, p.radii.z) : Math.min(p.ra ?? 0.1, p.rb ?? p.ra ?? 0.1);
    const drift = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(size * jitter * 0.8);
    q.a.add(drift);
    if (p.b) q.b = p.b.clone().add(drift.multiplyScalar(0.5));
    if (p.radii) q.radii = new THREE.Vector3(p.radii.x * j(), p.radii.y * j(), p.radii.z * j());
    if (p.ra !== undefined) q.ra = p.ra * j();
    if (p.rb !== undefined) q.rb = p.rb * j();
    if (p.blend !== undefined) q.blend = p.blend * soften;
    add(q);
  };
}

/** Lift a dark hex toward a pale one so the body reads in dim scenes without glowing. */
export function lift(base: string, toward: string, k: number): string {
  return `#${new THREE.Color(base).lerp(new THREE.Color(toward), k).getHexString()}`;
}

/**
 * Readability: hides darker than a floor are lifted toward pale pearl (not toward glow), and the rim sheen is made
 * pale, so silhouettes and form read in a dark fen or pit while the colours stay natural. Call after the species
 * sets its palette.
 */
export function readable(b: PlanBuilder, floor = 0.4): void {
  const pal = b.plan.palette;
  const up = (hex: string) => {
    const c = new THREE.Color(hex);
    // Perceptual (sRGB) luminance, to match the Creature team's 0.3-0.45 hide target.
    const l = Math.pow(c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722, 1 / 2.2);
    return l >= floor ? hex : lift(hex, FAUNA.pearl, Math.min(0.5, (floor - l) * 1.4));
  };
  b.plan.palette = { ...pal, flesh: up(pal.flesh), chitin: up(pal.chitin), bone: up(pal.bone), membrane: up(pal.membrane), rim: lift(pal.rim, FAUNA.pearl, 0.5) };
}
