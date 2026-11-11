/**
 * The living reticle and the living-eye scope (Membrane HUD).
 *
 * The reticle is drawn, not an image: each weapon class has its own mark (a carbine's four membrane arcs, a
 * shotgun's broken ring, a rifle's three thorns...). Its gap is the gun's real cone of fire, read from
 * data/weapons.json and projected through the camera FOV, so what you see is where the spores can land:
 * it tightens as you aim, opens while you move, kicks with each shot and settles at the gun's recoil recovery
 * rate. Reload draws the mark in and runs a thin progress arc; hits flash it (amber on weak points), kills
 * push it outward in danger red; low ammo turns the centre point red.
 *
 * Guns whose sights are scopes (ads.scope, or a Stalk Eye graft reported by Gameplay as weapon.scope) swap the
 * reticle for an eye: an iris aperture that dilates open as aim completes, a wet meniscus at its rim, fibres in
 * the iris, faint veins at the screen edge, and eyelids that blink shut through a reload. No crosshair lines.
 */
import { WEAPONS } from '../../../data';
import { HIVE, ORGANIC } from '../../render/palette';
import { getSettings, type Settings } from '../settings';

export type ReticleShape = 'arcs4' | 'brackets' | 'dots' | 'thorns3' | 'brokenRing' | 'pinhole' | 'ladder' | 'thinRing' | 'diamond';

/**
 * Only long-range classes look through the eye; every other gun aims with a slight zoom and its normal mark
 * (coordinator call 2026-11-11 while Brandon decides on scopes). Empty this set to drop the eye scope entirely.
 */
export const EYE_SCOPE_CLASSES = new Set(['marksman', 'sniper']);

/** Mark per weapon class; anything unknown falls back to the carbine's arcs. */
export const RETICLE_BY_CLASS: Record<string, ReticleShape> = {
  carbine: 'arcs4', sidearm: 'brackets', smg: 'dots', rifle: 'thorns3', shotgun: 'brokenRing',
  marksman: 'pinhole', sniper: 'pinhole', launcher: 'ladder', beam: 'thinRing', relic: 'diamond',
};

/** What the reticle reads each frame (a slice of HudView plus optional Gameplay weapon fields). */
export interface ReticleInput {
  aiming: boolean;
  ammo: number; magazine: number; reloading: number;
  weapon?: { id: string; scope?: number; charge?: number; canAim?: boolean } | null;
  /** 0 standing, 1 at walk speed or faster; sprinting hides the mark. */
  motion?: { moving: number; sprinting: boolean } | null;
  /**
   * Gameplay's live crosshair (follows #68): radius is the spread cone as a fraction of half the viewport height
   * with ADS, movement and bloom folded in; style 'scope' while a scoped gun is fully aimed; ready false while
   * reloading, empty, swapping or sprint-blocked; onTarget/weak when the aim ray rests on a creature / weak point.
   * When present it wins over the reticle's own estimate from data/weapons.json.
   */
  crosshair?: { radius: number; bloom?: number; style?: string; ready?: boolean; pellets?: number; charge?: number; onTarget?: boolean; weak?: boolean } | null;
}

interface Gun { cls: string; shape: ReticleShape; hip: number; ads: number; moving: number; kick: number; recovery: number; zoom: number; aimTime: number; scope: boolean }

export function gunOf(id: string | undefined): Gun {
  const w = (WEAPONS as Record<string, unknown>)[id ?? 'synapseBurster'] as {
    class?: string; spread?: { hip: number; ads?: number; movingPenalty: number }; recoil?: { pitch: number; recovery: number };
    ads?: false | { zoom: number; time: number; scope: boolean }; adsTime?: number;
  } | undefined;
  const base = WEAPONS.synapseBurster as unknown as typeof w;
  const g = w ?? base!;
  const ads = g.ads === undefined ? { zoom: 1.3, time: g.adsTime ?? 0.18, scope: false } : g.ads;
  const spread = g.spread ?? base!.spread!;
  return {
    cls: g.class ?? 'carbine', shape: RETICLE_BY_CLASS[g.class ?? 'carbine'] ?? 'arcs4',
    hip: spread.hip, ads: spread.ads ?? spread.hip, moving: spread.movingPenalty,
    kick: g.recoil?.pitch ?? 0.3, recovery: g.recoil?.recovery ?? 9,
    zoom: ads ? ads.zoom : 1, aimTime: ads ? ads.time : 0.2, scope: !!(ads && ads.scope) && EYE_SCOPE_CLASSES.has(g.class ?? ''),
  };
}

/** Screen radius in CSS px of a cone `deg` wide (half-angle) for a vertical FOV and viewport height. */
export function coneRadius(deg: number, fovDeg: number, height: number): number {
  const half = (fovDeg * Math.PI) / 360;
  return (Math.tan((deg * Math.PI) / 180) * height) / 2 / Math.tan(half);
}

/** Spread half-angle in degrees for an aim fraction, movement fraction and current recoil bloom. */
export function spreadNow(g: Pick<Gun, 'hip' | 'ads' | 'moving'>, aim: number, moving: number, bloom: number): number {
  const still = g.hip + (g.ads - g.hip) * aim;
  return still * (1 + (g.moving - 1) * Math.min(1, Math.max(0, moving))) + bloom;
}

/** Blend two palette hex colours (t = 0 gives a). */
const mixHex = (a: string, b: string, t: number) => {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((p >> sh) & 255) * (1 - t) + ((q >> sh) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export class Reticle {
  readonly mark: HTMLCanvasElement;
  readonly eye: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D | null;
  private ectx: CanvasRenderingContext2D | null;
  private aim = 0;
  private bloom = 0;
  private flash = 0;
  private hitT = 0;
  private hitKind: 'hit' | 'weak' | 'kill' = 'hit';
  private blink = 0;
  private shown = 1;
  private scopeAmt = 0;
  private veins: { x: number; y: number; cx: number; cy: number; ex: number; ey: number; w: number }[] = [];
  private gun: Gun = gunOf('synapseBurster');
  private gunId = 'synapseBurster';
  private settings: Settings = getSettings();
  /** Last drawn values, for tests and tooling. */
  readonly last = { radius: 0, shape: 'arcs4' as ReticleShape, scope: 0, alpha: 1 };

  constructor(parent: HTMLElement) {
    this.mark = document.createElement('canvas');
    this.mark.className = 'h-reticle';
    this.eye = document.createElement('canvas');
    this.eye.className = 'h-scope';
    parent.prepend(this.eye, this.mark);
    this.mctx = this.mark.getContext('2d');
    this.ectx = this.eye.getContext('2d');
    globalThis.addEventListener?.('biophage:settings', (e) => { this.settings = (e as CustomEvent<Settings>).detail; });
    // Veins grow in from the screen edges; seeded so the eye is the same every raid.
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const x = 0.5 + Math.cos(a) * 0.75, y = 0.5 + Math.sin(a) * 0.75;
      const len = 0.18 + r() * 0.16;
      this.veins.push({ x, y, cx: x - Math.cos(a + (r() - 0.5)) * len * 0.6, cy: y - Math.sin(a + (r() - 0.5)) * len * 0.6,
        ex: x - Math.cos(a + (r() - 0.5) * 0.6) * len, ey: y - Math.sin(a + (r() - 0.5) * 0.6) * len, w: 0.6 + r() * 1.6 });
    }
  }

  shot(weapon?: string): void {
    if (weapon && weapon !== this.gunId) this.setGun(weapon);
    this.bloom += this.gun.kick;
    this.flash = 1;
  }
  hit(weak: boolean, kill: boolean): void { this.hitT = 1; this.hitKind = kill ? 'kill' : weak ? 'weak' : 'hit'; }
  reload(): void { this.blink = 1; }

  private setGun(id: string): void { this.gunId = id; this.gun = gunOf(id); }

  update(dt: number, s: ReticleInput): void {
    if (s.weapon?.id && s.weapon.id !== this.gunId) this.setGun(s.weapon.id);
    const g = this.gun;
    const want = s.aiming && s.weapon?.canAim !== false ? 1 : 0;
    this.aim += Math.sign(want - this.aim) * Math.min(Math.abs(want - this.aim), dt / Math.max(0.05, g.aimTime));
    this.bloom *= Math.exp(-g.recovery * dt * 0.5);
    this.flash = Math.max(0, this.flash - dt * 8);
    this.hitT = Math.max(0, this.hitT - dt * 4);
    this.blink = Math.max(0, this.blink - dt * 2.4);
    // The eye is for long guns only, and the player can turn it off in Settings.
    const eyeOk = EYE_SCOPE_CLASSES.has(g.cls) && this.settings.eyeScope;
    const scoped = eyeOk && (s.weapon?.scope !== undefined ? s.weapon.scope > 0 : g.scope);
    const scopeTarget = eyeOk && s.crosshair?.style === 'scope' ? 1 : scoped ? this.aim : 0;
    this.scopeAmt += (scopeTarget - this.scopeAmt) * Math.min(1, dt * 14);
    const dim = !!s.motion?.sprinting || s.crosshair?.ready === false;
    const hide = (dim ? 0.3 : 1) * (1 - Math.min(1, this.scopeAmt * 1.6));
    this.shown += (hide - this.shown) * Math.min(1, dt * 12);
    this.drawMark(s);
    this.drawEye(s);
  }

  private fit(c: HTMLCanvasElement, w: number, h: number): number {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    return dpr;
  }

  private drawMark(s: ReticleInput): void {
    const ctx = this.mctx;
    const vh = globalThis.innerHeight || 1080;
    const size = Math.round(vh * 0.3);
    this.mark.style.width = this.mark.style.height = `${size}px`;
    if (!ctx) return;
    const dpr = this.fit(this.mark, size, size);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const g = this.gun;
    const fov = this.settings.fov / (1 + (g.zoom - 1) * this.aim);
    const deg = spreadNow(g, this.aim, s.motion?.moving ?? 0, this.bloom);
    const kill = this.hitKind === 'kill' ? this.hitT : 0;
    const u = vh / 100;
    const cone = s.crosshair ? (s.crosshair.radius * vh) / 2 : coneRadius(deg, fov, vh);
    const r = Math.min(size * 0.42, Math.max(u * 0.9, cone) + kill * u * 1.4);
    const reloading = s.reloading > 0 ? Math.min(1, s.reloading) : 0;
    const alpha = this.shown * (reloading ? 0.4 : 1);
    this.last.radius = r; this.last.shape = g.shape; this.last.scope = this.scopeAmt; this.last.alpha = alpha;
    if (alpha < 0.02) return;
    // Resting on a creature warms the mark; on its weak point it turns amber. Hits override briefly.
    const rest = s.crosshair?.weak ? ORGANIC.amber : s.crosshair?.onTarget ? mixHex(HIVE.bone, HIVE.danger, 0.45) : HIVE.bone;
    const tone = this.hitT > 0 ? (this.hitKind === 'kill' ? HIVE.danger : this.hitKind === 'weak' ? ORGANIC.amber : HIVE.bone) : rest;
    const a = alpha * (0.72 + this.flash * 0.25 + this.hitT * 0.3);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = rgba(tone, a); ctx.fillStyle = rgba(tone, a);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4, u * 0.16);
    ctx.shadowColor = rgba(HIVE.background, 0.7); ctx.shadowBlur = 3;
    const arc = (from: number, span: number, rr = r) => { ctx.beginPath(); ctx.arc(0, 0, rr, from - span / 2, from + span / 2); ctx.stroke(); };
    const thorn = (ang: number, len: number) => {
      const c = Math.cos(ang), sn = Math.sin(ang), w = u * 0.22;
      ctx.beginPath();
      ctx.moveTo(c * r, sn * r);
      ctx.lineTo(c * (r + len) - sn * w, sn * (r + len) + c * w);
      ctx.lineTo(c * (r + len) + sn * w, sn * (r + len) - c * w);
      ctx.closePath(); ctx.fill();
    };
    const T = Math.PI * 2;
    switch (g.shape) {
      case 'arcs4': for (let i = 0; i < 4; i++) arc(T / 8 + (i * T) / 4, 0.5); break;
      case 'brackets': arc(0, 1.2); arc(Math.PI, 1.2); break;
      case 'dots': for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(Math.cos((i * T) / 6 - T / 4) * r, Math.sin((i * T) / 6 - T / 4) * r, ctx.lineWidth * 1.1, 0, T); ctx.fill(); } break;
      case 'thorns3': for (let i = 0; i < 3; i++) thorn(-T / 4 + (i * T) / 3, u * 1.1); break;
      case 'brokenRing': for (let i = 0; i < 12; i++) arc((i * T) / 12, 0.32); break;
      case 'pinhole': arc(-T / 4, T * 0.8); break;
      case 'ladder':
        arc(Math.PI / 2, 2.2);
        for (let i = 1; i <= 3; i++) { ctx.beginPath(); const y = r * 0.35 + i * u * 0.9, w = u * (1.1 - i * 0.22); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke(); }
        break;
      case 'thinRing': ctx.lineWidth *= 0.6; arc(0, T); break;
      case 'diamond': for (let i = 0; i < 4; i++) thorn((i * T) / 4, u * 0.8); break;
    }
    // Charge guns: the charge closes a hairline ring around the mark.
    const charge = s.crosshair?.charge ?? s.weapon?.charge ?? 0;
    if (charge > 0.01) { ctx.strokeStyle = rgba(ORGANIC.amber, alpha * 0.8); ctx.lineWidth = Math.max(1, u * 0.09); arc(-T / 4 + charge * Math.PI, charge * T, r + u * 0.7); }
    // Reload: the mark draws in and a thin arc runs round once.
    if (reloading) { ctx.strokeStyle = rgba(ORGANIC.mist, this.shown * 0.85); ctx.lineWidth = Math.max(1, u * 0.09); ctx.beginPath(); ctx.arc(0, 0, r + u * 0.9, -T / 4, -T / 4 + (1 - reloading) * T); ctx.stroke(); }
    // Centre point: always the true aim; red when the magazine runs low.
    const low = s.magazine > 0 && s.ammo / s.magazine < 0.25 && !reloading;
    ctx.fillStyle = rgba(low ? HIVE.danger : HIVE.bone, alpha * 0.9);
    ctx.beginPath(); ctx.arc(0, 0, Math.max(1.1, u * 0.12), 0, T); ctx.fill();
    ctx.restore();
  }

  private drawEye(s: ReticleInput): void {
    const ctx = this.ectx;
    const amt = this.scopeAmt;
    if (!ctx) return;
    const W = globalThis.innerWidth || 1920, H = globalThis.innerHeight || 1080;
    if (amt < 0.02) { if (this.eye.width) { this.eye.width = 0; this.eye.height = 0; } this.eye.style.opacity = '0'; return; }
    const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
    if (this.eye.width !== Math.round(W * dpr)) { this.eye.width = Math.round(W * dpr); this.eye.height = Math.round(H * dpr); }
    this.eye.style.opacity = '1';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ease = 1 - Math.pow(1 - amt, 3);
    // The aperture dilates open as aim completes.
    const R = H * (0.12 + 0.3 * ease);
    const cx = W / 2, cy = H / 2;
    // Flesh outside the aperture.
    ctx.globalAlpha = Math.min(1, amt * 1.4);
    // The socket: deep flesh at the iris that sinks to near-black toward the screen edge.
    const sock = ctx.createRadialGradient(cx, cy, R, cx, cy, Math.hypot(W, H) / 2);
    sock.addColorStop(0, rgba(ORGANIC.wetFleshDeep, 0.97)); sock.addColorStop(0.45, rgba(HIVE.background, 0.97)); sock.addColorStop(1, rgba(HIVE.background, 0.99));
    ctx.fillStyle = sock;
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, R, 0, Math.PI * 2, true); ctx.fill('evenodd');
    // Iris: a soft band of fibres just outside the aperture.
    const band = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.5);
    band.addColorStop(0, rgba(HIVE.background, 0.95)); band.addColorStop(0.18, rgba(ORGANIC.amber, 0.22));
    band.addColorStop(0.6, rgba(ORGANIC.wetFlesh, 0.28)); band.addColorStop(1, rgba(ORGANIC.wetFleshDeep, 0));
    ctx.fillStyle = band; ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2); ctx.arc(cx, cy, R, 0, Math.PI * 2, true); ctx.fill('evenodd');
    ctx.strokeStyle = rgba(ORGANIC.amber, 0.14); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 + Math.sin(i * 12.9) * 0.02;
      const k = 1.04 + ((i * 7) % 5) * 0.06;
      ctx.moveTo(cx + Math.cos(a) * R * 1.01, cy + Math.sin(a) * R * 1.01);
      ctx.lineTo(cx + Math.cos(a + 0.02) * R * k, cy + Math.sin(a + 0.02) * R * k);
    }
    ctx.stroke();
    // Wet meniscus: a thin bright rim and a soft inner shadow, so the edge reads as liquid, not a ring.
    ctx.strokeStyle = rgba(HIVE.bone, 0.18); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
    const inner = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    inner.addColorStop(0, rgba(HIVE.background, 0)); inner.addColorStop(1, rgba(HIVE.background, 0.55));
    ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // Veins creep in from the screen edge.
    ctx.strokeStyle = rgba(ORGANIC.vein, 0.4 * amt);
    for (const v of this.veins) {
      ctx.lineWidth = v.w;
      ctx.beginPath(); ctx.moveTo(v.x * W, v.y * H); ctx.quadraticCurveTo(v.cx * W, v.cy * H, v.ex * W, v.ey * H); ctx.stroke();
    }
    // Aim point: a single pale bead, no lines.
    ctx.fillStyle = rgba(HIVE.bone, 0.75);
    ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
    // Blink: lids close through a reload (and briefly when the reload starts).
    const lid = Math.max(this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0, s.reloading > 0 ? 0.55 : 0);
    if (lid > 0.01) {
      const h = H * 0.76 * lid; // at lid 1 the two edges meet at the centre
      // Lids: dark flesh with a wet pale line along each edge, curved like a real eyelid.
      const lidFill = ctx.createLinearGradient(0, 0, 0, H);
      lidFill.addColorStop(0, rgba(HIVE.background, 1)); lidFill.addColorStop(0.5, rgba(ORGANIC.wetFleshDeep, 1)); lidFill.addColorStop(1, rgba(HIVE.background, 1));
      ctx.fillStyle = lidFill; ctx.strokeStyle = rgba(HIVE.bone, 0.16); ctx.lineWidth = 1.5;
      const edge = (y0: number, dir: number) => {
        ctx.beginPath(); ctx.moveTo(0, y0 - dir * H); ctx.lineTo(W, y0 - dir * H); ctx.lineTo(W, y0 - dir * h * 0.2);
        ctx.bezierCurveTo(W * 0.7, y0 + dir * h * 0.95, W * 0.3, y0 + dir * h * 0.95, 0, y0 - dir * h * 0.2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(W, y0 - dir * h * 0.2); ctx.bezierCurveTo(W * 0.7, y0 + dir * h * 0.95, W * 0.3, y0 + dir * h * 0.95, 0, y0 - dir * h * 0.2); ctx.stroke();
      };
      edge(0, 1); edge(H, -1);
    }
    ctx.globalAlpha = 1;
  }
}
