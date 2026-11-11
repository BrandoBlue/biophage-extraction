/**
 * Organic HUD frames for Zone 7 (reference 04, Art Bible "in-raid HUD is organic"): bone-and-flesh housings for
 * the Psych-Wave Scanner, the eyeball portrait and the vitals, the ability bar and the weapon panel.
 * Pure SVG strings drawn from the palette; the HUD layers live readouts on top.
 */
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../../render/palette';

let uid = 0;
const defs = (u: string) => `<defs>
  <radialGradient id="fl${u}" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="${ZONE7.magenta}"/><stop offset=".55" stop-color="${ZONE7_SHADE.flesh}"/><stop offset="1" stop-color="${ZONE7_SHADE.rockDeep}"/></radialGradient>
  <linearGradient id="bn${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HIVE.bone}"/><stop offset=".6" stop-color="${HIVE.bone}" stop-opacity=".75"/><stop offset="1" stop-color="${ZONE7_SHADE.stem}"/></linearGradient>
  <filter id="wet${u}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="b"/>
    <feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="4" result="n"/>
    <feComposite in="n" in2="b" operator="arithmetic" k2=".18" k3="1" result="h"/>
    <feDiffuseLighting in="h" surfaceScale="4" diffuseConstant="1.2" lighting-color="${HIVE.bone}" result="d"><feDistantLight azimuth="235" elevation="40"/></feDiffuseLighting>
    <feSpecularLighting in="h" surfaceScale="4" specularConstant="1" specularExponent="24" lighting-color="${ZONE7.cyan}" result="s"><feDistantLight azimuth="235" elevation="50"/></feSpecularLighting>
    <feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="1.3" result="l"/>
    <feComposite in="s" in2="l" operator="arithmetic" k2=".5" k3="1" result="w"/>
    <feComposite in="w" in2="SourceAlpha" operator="in"/>
  </filter>
  <filter id="gl${u}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

/** Teeth/spines around a circle (cx, cy, r), pointing outward. */
function spines(cx: number, cy: number, r: number, n: number, len: number, u: string, skip?: (a: number) => boolean): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13;
    if (skip?.(a)) continue;
    const l = len * (0.6 + 0.4 * Math.abs(Math.sin(i * 2.7)));
    const p = (rr: number, da = 0) => `${(cx + Math.cos(a + da) * rr).toFixed(1)} ${(cy + Math.sin(a + da) * rr).toFixed(1)}`;
    s += `<path d="M${p(r, -0.05)} L${p(r + l)} L${p(r, 0.05)}Z" fill="url(#bn${u})"/>`;
  }
  return s;
}

/** Ring housing for the round Psych-Wave Scanner: flesh torus, bone spines, three lidded eyes. viewBox 260. */
export function scannerFrame(): string {
  const u = `s${uid++}`;
  const eye = (a: number) => {
    const x = 130 + Math.cos(a) * 112, y = 130 + Math.sin(a) * 112;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a * 180) / Math.PI + 90})">
      <ellipse rx="13" ry="9" fill="url(#fl${u})"/><ellipse rx="9" ry="6" fill="${HIVE.bone}"/>
      <circle class="hud-eye-iris" r="4" fill="${HIVE.acid}" filter="url(#gl${u})"/><circle r="1.8" fill="${ZONE7_SHADE.rockDeep}"/></g>`;
  };
  return `<svg class="org-frame" viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      ${spines(130, 130, 116, 26, 14, u, (a) => [Math.PI * 0.25, Math.PI * 0.95, Math.PI * 1.6].some((e) => Math.abs(((a - e + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.22))}
      <circle cx="130" cy="130" r="112" fill="none" stroke="url(#fl${u})" stroke-width="16"/>
      <circle cx="130" cy="130" r="103" fill="none" stroke="url(#bn${u})" stroke-width="3"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; return `<path d="M${130 + Math.cos(a) * 104} ${130 + Math.sin(a) * 104} q${Math.cos(a + 1) * 8} ${Math.sin(a + 1) * 8} ${Math.cos(a) * 14} ${Math.sin(a) * 14}" stroke="${ZONE7.magenta}" stroke-width="2" fill="none"/>`; }).join('')}
    </g>
    ${eye(Math.PI * 0.25)}${eye(Math.PI * 0.95)}${eye(Math.PI * 1.6)}
  </svg>`;
}

/** Fleshy eye socket with bone lids and a LVL tag plate, around the reactive eyeball portrait. viewBox 140. */
export function socketFrame(): string {
  const u = `e${uid++}`;
  return `<svg class="org-frame" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      ${spines(70, 70, 60, 18, 12, u, (a) => a > Math.PI * 0.3 && a < Math.PI * 0.7)}
      <circle cx="70" cy="70" r="56" fill="none" stroke="url(#fl${u})" stroke-width="14"/>
      <path d="M22 52 C40 24 100 24 118 52" stroke="url(#bn${u})" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M26 96 C44 118 96 118 114 96" stroke="url(#bn${u})" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M40 120 L100 120 L94 136 L46 136Z" fill="url(#fl${u})"/>
    </g>
  </svg>`;
}

/** Bone housing for one vitals bar with a round icon medallion on the left. viewBox 360 x 44. */
export function barFrame(kind: 'biomass' | 'neural'): string {
  const u = `b${uid++}`;
  const col = kind === 'biomass' ? HIVE.acid : PATH.viral;
  const icon = kind === 'biomass'
    ? `<path d="M22 31C13 24 9 19 11 14c2-4 7-4 11 0 4-4 9-4 11 0 2 5-2 10-11 17z" fill="${HIVE.danger}" filter="url(#gl${u})"/>`
    : `<path d="M14 16c0-5 5-7 8-5 3-2 8 0 8 5 3 1 4 6 1 8 1 4-3 7-6 6-1 3-6 3-7 0-4 1-7-2-6-6-3-2-2-7 2-8z" fill="${ZONE7.magenta}" filter="url(#gl${u})"/><path d="M22 12v19" stroke="${ZONE7_SHADE.rockDeep}" stroke-width="1.2"/>`;
  return `<svg class="org-frame" viewBox="0 0 360 44" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      <path d="M44 8 L330 8 C342 8 354 14 358 22 C354 30 342 36 330 36 L44 36Z" fill="none" stroke="url(#bn${u})" stroke-width="3"/>
      <path d="M330 8 C342 8 354 14 358 22 C354 30 342 36 330 36" fill="url(#fl${u})"/>
      ${[90, 150, 210, 270].map((x) => `<path d="M${x} 6 l4 -5 l2 6Z M${x + 8} 38 l3 5 l3 -6Z" fill="url(#bn${u})"/>`).join('')}
      <circle cx="22" cy="22" r="20" fill="url(#fl${u})"/>
      <circle cx="22" cy="22" r="15" fill="${ZONE7_SHADE.rockDeep}" stroke="${col}" stroke-width="1.5"/>
    </g>
    ${icon}
  </svg>`;
}

/** Chitin plate behind the five ability slots, with a banner tab on top for the active ability name. viewBox 420 x 110. */
export function slotsFrame(): string {
  const u = `a${uid++}`;
  return `<svg class="org-frame" viewBox="0 0 420 110" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      <path d="M10 40 C30 30 60 28 80 28 L340 28 C360 28 390 30 410 40 L404 100 C380 106 360 108 340 108 L80 108 C60 108 40 106 16 100Z" fill="${ZONE7_SHADE.rockDeep}" fill-opacity=".72" stroke="url(#bn${u})" stroke-width="2.5"/>
      <path d="M150 28 C156 14 166 6 180 6 L240 6 C254 6 264 14 270 28" fill="url(#fl${u})" stroke="url(#bn${u})" stroke-width="2"/>
      ${spines(12, 70, 8, 6, 10, u, (a) => a > -1.2 && a < 1.2)}${spines(408, 70, 8, 6, 10, u, (a) => Math.cos(a) < 0.3)}
    </g>
  </svg>`;
}

/** Weapon panel housing: organic slab with a tentacle feed and the EGO CHARGE socket on the right. viewBox 420 x 150. */
export function weaponFrame(): string {
  const u = `w${uid++}`;
  return `<svg class="org-frame" viewBox="0 0 420 150" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      <path d="M8 40 C20 22 60 18 120 18 L300 18 C330 18 350 26 360 40 L360 132 L30 132 C16 132 8 120 8 104Z" fill="${ZONE7_SHADE.rockDeep}" fill-opacity=".72" stroke="url(#bn${u})" stroke-width="2.5"/>
      <circle cx="350" cy="78" r="62" fill="url(#fl${u})"/>
      <circle cx="350" cy="78" r="48" fill="${ZONE7_SHADE.rockDeep}"/>
      ${spines(350, 78, 62, 16, 10, u, (a) => Math.cos(a) < -0.5)}
      <path d="M20 132 C40 144 70 146 96 140 M60 132 C70 146 92 150 120 146" stroke="url(#fl${u})" stroke-width="6" fill="none" stroke-linecap="round"/>
    </g>
  </svg>`;
}

/** Small capsule behind the raid timer: bone caps and a fleshy body. viewBox 240 x 60. */
export function timerFrame(): string {
  const u = `t${uid++}`;
  return `<svg class="org-frame" viewBox="0 0 240 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(u)}
    <g filter="url(#wet${u})">
      <path d="M30 8 L210 8 C226 8 236 18 236 30 C236 42 226 52 210 52 L30 52 C14 52 4 42 4 30 C4 18 14 8 30 8Z" fill="${ZONE7_SHADE.rockDeep}" fill-opacity=".75" stroke="url(#fl${u})" stroke-width="4"/>
      <path d="M10 30 L-2 30 M238 30 L250 30" stroke="url(#bn${u})" stroke-width="5"/>
      ${spines(30, 30, 22, 8, 7, u, (a) => Math.cos(a) > -0.2)}${spines(210, 30, 22, 8, 7, u, (a) => Math.cos(a) < 0.2)}
    </g>
  </svg>`;
}
