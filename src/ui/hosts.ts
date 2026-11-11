/**
 * Host specimen scans: code-drawn SVG portraits of the three host classes for the class cards and the
 * stash torso. Silhouettes follow the Art Bible creature rule 1 (Wraith gaunt with blade forearms and
 * insect wings; Infiltrator slim biped with bulbous cranium and antennae; Behemoth hunched mass with a
 * bone crown and spikes). Each is drawn as one half and mirrored, then lit with glowing mutation nodes.
 * The 3D specimen on the Hive lab pedestal is Rendering's; these are the 2D bio-scan read of the same hosts.
 */
import type { ClassId } from '../../data';
import { HIVE, PATH, ZONE7, ZONE7_SHADE } from '../render/palette';

let uid = 0;

interface Look { skin: string; skinDark: string; bone: string; glow: string; membrane: string }
const LOOK: Record<ClassId, Look> = {
  venomWraith: { skin: HIVE.bone, skinDark: ZONE7_SHADE.moss, bone: HIVE.bone, glow: ZONE7.cyan, membrane: ZONE7.cyan },
  neuroInfiltrator: { skin: ZONE7_SHADE.moss, skinDark: HIVE.panel, bone: HIVE.bone, glow: HIVE.acid, membrane: HIVE.acid },
  goreBehemoth: { skin: HIVE.danger, skinDark: ZONE7_SHADE.flesh, bone: HIVE.bone, glow: PATH.melee, membrane: HIVE.danger },
};

/** Right half of each body (x >= 100 in a 200 x 240 box). Left half is the mirror. */
function half(id: ClassId, L: Look, u: string): string {
  const limb = (d: string, w: number) => `<path d="${d}" stroke="url(#b${u})" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const node = (x: number, y: number, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${L.glow}" filter="url(#g${u})"/>`;
  if (id === 'venomWraith') {
    return `
      <path d="M108 86 C130 40 168 12 194 6 C186 30 160 70 112 94Z" fill="${L.membrane}" fill-opacity=".14" stroke="${L.membrane}" stroke-opacity=".7"/>
      <path d="M112 96 C150 92 182 100 196 118 C170 122 136 116 112 104Z" fill="${L.membrane}" fill-opacity=".12" stroke="${L.membrane}" stroke-opacity=".6"/>
      <path d="M112 90 C140 60 168 30 190 10 M120 82 L150 50 M128 74 L176 34 M114 100 C150 100 176 108 194 116 M130 101 L160 112" stroke="${L.membrane}" stroke-opacity=".45" stroke-width=".8" fill="none"/>
      ${limb('M100 84 C112 84 120 90 124 96', 7)}
      ${limb('M124 96 L144 128', 6)}
      <path d="M142 124 C158 146 166 178 156 214 C154 186 146 160 136 134Z" fill="url(#b${u})" stroke="${L.skinDark}" stroke-width="1"/>
      <path d="M150 150 C156 170 158 190 156 210" stroke="${L.glow}" stroke-opacity=".6" fill="none"/>
      <path d="M100 88 C116 92 118 108 114 122 C110 132 106 140 102 146 L100 146Z" fill="url(#k${u})" stroke="${L.skinDark}"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M101 ${98 + i * 9} C110 ${97 + i * 9} 114 ${101 + i * 9} 113 ${106 + i * 9}" stroke="${L.skinDark}" stroke-width="2.2" fill="none"/>`).join('')}
      ${limb('M104 148 C114 156 122 168 130 182', 7)}
      ${limb('M130 182 C126 196 122 208 124 222', 5)}
      ${limb('M124 222 L140 232', 3)}
      <path d="M100 44 C108 46 110 56 108 66 C106 74 102 80 100 80Z" fill="url(#k${u})" stroke="${L.skinDark}"/>
      <path d="M102 46 L112 24 L106 48 M104 50 L120 34 L108 54" stroke="${L.bone}" stroke-width="2" fill="none"/>
      <path d="M102 58 L107 61" stroke="${L.glow}" stroke-width="2.4" filter="url(#g${u})"/>
      ${node(124, 96)}${node(144, 128)}${node(130, 182)}${node(106, 112, 3.2)}`;
  }
  if (id === 'neuroInfiltrator') {
    return `
      ${[[118, 22, 150, 4, 164, 6], [126, 30, 160, 18, 178, 24], [124, 44, 156, 40, 172, 50]].map(([x1, y1, cx, cy, x2, y2]) => `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${L.bone}" stroke-width="1.8" fill="none"/>${node(x2, y2, 2.6)}`).join('')}
      <path d="M100 4 C120 4 134 18 134 36 C134 52 124 62 114 70 C110 76 106 84 100 88Z" fill="url(#k${u})"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M101 ${12 + i * 11} C112 ${10 + i * 11} 122 ${14 + i * 11} 128 ${22 + i * 11}" stroke="${L.skinDark}" stroke-width="1.6" fill="none"/>`).join('')}
      <path d="M102 56 C110 52 120 52 124 58 C118 62 108 62 102 60Z" fill="${L.glow}" filter="url(#g${u})"/>
      <path d="M104 74 C110 80 112 88 106 96 M102 78 L104 92" stroke="${L.bone}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      ${limb('M100 90 L102 100', 8)}
      <path d="M100 98 C120 98 136 104 140 116 C136 128 124 136 116 142 C112 152 108 160 104 166 L100 166Z" fill="url(#k${u})"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M101 ${122 + i * 11} C108 ${120 + i * 11} 114 ${122 + i * 11} 116 ${126 + i * 11}" stroke="${L.skinDark}" stroke-width="2" fill="none"/>`).join('')}
      <path d="M118 96 C136 92 152 100 154 114 C146 112 136 112 126 112Z" fill="${L.bone}"/>
      <path d="M122 104 L146 86 L138 106" fill="${L.bone}"/>
      ${limb('M146 112 C162 124 170 138 168 152', 7)}
      ${limb('M168 152 C164 170 160 184 164 198', 5)}
      <path d="M164 196 L178 214 M164 198 L170 218 M163 198 L156 216" stroke="${L.bone}" stroke-width="2.2" stroke-linecap="round"/>
      ${limb('M108 166 C126 172 140 182 146 196', 9)}
      ${limb('M146 196 C140 208 134 216 136 230', 6)}
      ${limb('M136 230 L152 236', 3)}
      ${node(146, 112)}${node(168, 152)}${node(146, 196)}${node(108, 124, 3.6)}`;
  }
  return `
    <path d="M100 58 C130 46 168 58 182 84 C192 104 190 132 180 150 C170 140 156 132 140 130 L100 128Z" fill="url(#k${u})" stroke="${L.skinDark}" stroke-width="1.5"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${112 + i * 15} ${58 + i * 4} L${118 + i * 16} ${30 + i * 6} L${126 + i * 15} ${62 + i * 5}Z" fill="${L.bone}" stroke="${L.skinDark}"/>`).join('')}
    <path d="M140 72 C160 74 172 88 176 104 C166 98 152 94 140 92Z" fill="${L.bone}" stroke="${L.skinDark}"/>
    <path d="M124 90 C140 86 156 92 166 104 C154 104 138 102 124 100Z" fill="${L.bone}" fill-opacity=".85" stroke="${L.skinDark}"/>
    ${[0, 1, 2].map((i) => `<path d="M110 ${74 + i * 18} C130 ${70 + i * 18} 150 ${80 + i * 18} 164 ${96 + i * 18}" stroke="${L.skinDark}" stroke-width="2" fill="none"/>`).join('')}
    ${limb('M172 140 C180 162 182 180 176 204', 22)}
    <path d="M160 200 C170 196 188 198 192 212 C186 222 166 224 158 214Z" fill="${L.bone}" stroke="${L.skinDark}"/>
    <path d="M168 150 L184 140 M172 166 L190 160 M174 182 L190 182" stroke="${L.bone}" stroke-width="3" stroke-linecap="round"/>
    <path d="M100 128 C118 128 128 140 130 160 L100 162Z" fill="url(#k${u})" stroke="${L.skinDark}"/>
    ${limb('M114 160 C124 180 126 196 122 214', 18)}
    <path d="M110 214 C120 210 134 214 138 226 L108 228Z" fill="${L.bone}" stroke="${L.skinDark}"/>
    <path d="M100 86 C110 86 116 94 114 104 C112 112 106 116 100 116Z" fill="${L.skinDark}" stroke="${L.bone}" stroke-opacity=".5"/>
    <path d="M100 84 L104 70 L108 86 M106 88 L118 76 L112 92" fill="${L.bone}" stroke="${L.skinDark}"/>
    <path d="M103 98 L110 96" stroke="${L.glow}" stroke-width="2.4" filter="url(#g${u})"/>
    ${node(152, 110, 3.4)}${node(178, 128, 3)}${node(126, 144, 3)}${node(120, 186, 2.8)}`;
}

/** Hologram-style specimen scan, sized by the container (viewBox 200 x 240). */
export function hostPortrait(id: ClassId, opts: { locked?: boolean } = {}): string {
  const L = LOOK[id];
  const u = `h${uid++}`;
  const body = half(id, L, u);
  return `<svg class="host-scan${opts.locked ? ' locked' : ''}" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <filter id="g${u}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="r${u}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="blur"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="3" seed="${id.length}" result="noise"/>
        <feComposite in="noise" in2="blur" operator="arithmetic" k2="0.22" k3="1" result="height"/>
        <feDiffuseLighting in="height" surfaceScale="5" diffuseConstant="1.25" lighting-color="${HIVE.bone}" result="diff"><feDistantLight azimuth="225" elevation="38"/></feDiffuseLighting>
        <feSpecularLighting in="height" surfaceScale="5" specularConstant="1.15" specularExponent="26" lighting-color="${L.glow}" result="spec"><fePointLight x="40" y="-30" z="90"/></feSpecularLighting>
        <feComposite in="SourceGraphic" in2="diff" operator="arithmetic" k1="1.35" result="lit"/>
        <feComposite in="spec" in2="lit" operator="arithmetic" k2=".55" k3="1" result="wet"/>
        <feComposite in="wet" in2="SourceAlpha" operator="in" result="body"/>
        <feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="d"/><feFlood flood-color="${L.glow}" flood-opacity=".28"/><feComposite in2="d" operator="in"/><feGaussianBlur stdDeviation="3.4" result="rim"/>
        <feMerge><feMergeNode in="rim"/><feMergeNode in="body"/></feMerge>
      </filter>
      <linearGradient id="k${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.skin}"/><stop offset=".55" stop-color="${L.skinDark}"/><stop offset="1" stop-color="${HIVE.background}"/></linearGradient>
      <linearGradient id="b${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.bone}"/><stop offset="1" stop-color="${L.skinDark}"/></linearGradient>
      <radialGradient id="p${u}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${L.glow}" stop-opacity=".3"/><stop offset="1" stop-color="${L.glow}" stop-opacity="0"/></radialGradient>
      <pattern id="s${u}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="${L.glow}" fill-opacity=".07"/></pattern>
    </defs>
    <ellipse cx="100" cy="232" rx="78" ry="9" fill="url(#p${u})"/>
    <g filter="url(#r${u})">
      <g>${body}</g>
      <g transform="translate(200 0) scale(-1 1)">${body}</g>
    </g>
    <rect width="200" height="240" fill="url(#s${u})"/>
  </svg>`;
}
