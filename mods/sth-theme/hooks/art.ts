/**
 * Buddy and his fika, drawn in vector.
 *
 * The app's backdrop draws no image at all, not even a 344-byte PNG as a data: URI, so the Blender
 * renders of the sth-usage mod can't be used here. Everything is paths and gradients, measured on
 * the render of Buddy 3D V6 at his bench (504 x 436, the crop the renders were cut to). Nothing here
 * animates by itself: the parts that move take their place from the time (motion.ts).
 */
import type { FikaPose } from './motion'

/** Gradients and clips for Buddy, his bench, the cup and the bun. */
export const ART_DEFS = `
<radialGradient id="ag-body" cx=".62" cy=".08" r=".98"><stop offset="0" stop-color="#8c8c90"/><stop offset=".3" stop-color="#646468"/><stop offset=".62" stop-color="#48484b"/><stop offset="1" stop-color="#313134"/></radialGradient>
<linearGradient id="ag-side" x1="0" y1="0" x2="1" y2="0"><stop offset=".74" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
<linearGradient id="ag-arm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#707074"/><stop offset="1" stop-color="#323235"/></linearGradient>
<linearGradient id="ag-foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#404042"/><stop offset="1" stop-color="#1b1b1d"/></linearGradient>
<linearGradient id="ag-cup" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6f7f5"/><stop offset=".55" stop-color="#dde0dc"/><stop offset="1" stop-color="#b6bab6"/></linearGradient>
<radialGradient id="ag-bun" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#eaa35c"/><stop offset=".55" stop-color="#c26e2f"/><stop offset="1" stop-color="#874820"/></radialGradient>
<linearGradient id="ag-mini" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e6e72"/><stop offset=".5" stop-color="#47474a"/><stop offset="1" stop-color="#2f2f32"/></linearGradient>
<clipPath id="ag-clip"><rect x="78" y="6" width="400" height="296" rx="92" ry="86" transform="rotate(2.2 278 154)"/></clipPath>`

const WHITE = '#ecece8'
const n = (x: number) => +x.toFixed(1)

/**
 * Buddy at his bench, in the 504 x 436 space of the renders, with the parts the fika moves at the
 * places `p` gives: the right arm and the cup, the left arm behind and in front of him, the bun whole
 * or bitten.
 */
export function hero(p: FikaPose): string {
  const [ax, ay] = p.arm
  const [cx, cy, tilt] = p.cup
  const [lo, lx, ly] = p.leftFront
  const [bx, by] = p.bun

  return `
<ellipse cx="180" cy="356" rx="46" ry="19" fill="url(#ag-foot)"/>
<ellipse cx="398" cy="360" rx="36" ry="19" fill="url(#ag-foot)"/>
<g opacity="${n(p.leftBack)}"><ellipse cx="88" cy="228" rx="20" ry="46" fill="url(#ag-arm)" transform="rotate(-5 88 228)"/></g>
<rect x="78" y="6" width="400" height="296" rx="92" ry="86" fill="url(#ag-body)" transform="rotate(2.2 278 154)"/>
<g clip-path="url(#ag-clip)"><rect x="78" y="6" width="400" height="296" fill="url(#ag-side)"/>
<ellipse cx="300" cy="22" rx="190" ry="34" fill="#fff" opacity=".1"/>
<path d="M110 30Q260 -4 450 36" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="8" stroke-linecap="round"/></g>
<g transform="rotate(3 247 187)">
<rect x="100" y="86" width="296" height="202" rx="20" fill="#2a2a2d" opacity=".4"/>
<rect x="98" y="84" width="298" height="206" rx="20" fill="none" stroke="${WHITE}" stroke-width="3.6"/>
<path d="M177 182L192 150L212 183M273 187L288 155L307 189" fill="none" stroke="${WHITE}" stroke-width="6.5" stroke-linejoin="miter"/>
<circle cx="243" cy="207" r="7.5" fill="${WHITE}"/></g>

<path d="M62 338h42v58q0 6-6 6H68q-6 0-6-6z" fill="var(--wd3)"/>
<path d="M328 366h42v64q0 6-6 6h-30q-6 0-6-6z" fill="var(--wd3)"/>
<path d="M14 318Q8 310 24 304L58 293L410 322Q424 324 420 337L414 356Q300 352 14 318Z" fill="var(--wd1)"/>
<path d="M14 318L414 356L412 376L14 338Z" fill="var(--wd2)"/>

<g opacity="${n(lo)}" transform="translate(${n(lx)} ${n(ly)})"><ellipse cx="88" cy="228" rx="20" ry="46" fill="url(#ag-arm)" transform="rotate(-5 88 228)"/></g>
<g transform="translate(${n(bx)} ${n(by)})"><g opacity="${n(p.bunWhole)}"><ellipse cx="101" cy="289" rx="41" ry="22" fill="url(#ag-bun)"/>
<path d="M101 289m-27 0a27 14 0 1 1 54 0a19 10 0 1 1-38 0a11 6 0 1 1 22 0" fill="none" stroke="#a45a26" stroke-width="3"/>
<g fill="#fff" opacity=".85"><circle cx="82" cy="279" r="1.6"/><circle cx="104" cy="274" r="1.6"/><circle cx="122" cy="282" r="1.6"/><circle cx="92" cy="298" r="1.6"/><circle cx="116" cy="297" r="1.6"/></g></g>
<g opacity="${n(1 - p.bunWhole)}"><path d="M101 289m-41 0a41 22 0 0 1 22-19a24 24 0 0 0 28 14a20 11 0 0 0 4 20a41 22 0 0 1-54-15z" fill="url(#ag-bun)"/>
<path d="M101 289m-24 2a24 12 0 0 1 26-12" fill="none" stroke="#a45a26" stroke-width="3"/></g></g>

<g class="cu" transform="translate(${n(cx)} ${n(cy)}) rotate(${n(tilt)} 338 294)"><path d="M304 255h68l-9 74q-1 6-8 6h-34q-7 0-8-6z" fill="url(#ag-cup)"/>
<ellipse cx="338" cy="256" rx="34" ry="9" fill="#eceeea"/><ellipse cx="338" cy="258" rx="29" ry="6.5" fill="#34241d"/>
<path d="M368 281q26 2 22 22q-4 14-24 12" fill="none" stroke="#e3e5e1" stroke-width="7" stroke-linecap="round"/></g>

<g transform="translate(${n(ax)} ${n(ay)})"><path d="M462 168C486 158 507 192 505 238C503 280 487 300 468 293C449 286 446 212 462 168Z" fill="url(#ag-arm)"/>
<path d="M468 188C482 186 492 210 492 240" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="6" stroke-linecap="round"/></g>`
}

// The faces of the little Buddies, in their screen of 60 x 44 at 20 22. Buddy has one for each of his
// statuses: idle `^.^`, at work `>_<`, failed `x x`, waiting `•_•` and review `o.O`, and one more for when
// he dozes off, `-.-`. His look is the idle face sent to a corner of the screen (`gaze`).
const FACES = {
  idle: `<path d="M35.5 42.5L39.5 36L43.5 42.5M56.5 42.5L60.5 36L64.5 42.5" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="49.5" r="2.1" fill="${WHITE}"/>`,
  sleep: `<path d="M34.5 43.5H44.5M55.5 43.5H65.5" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round"/><circle cx="50" cy="49.5" r="2.1" fill="${WHITE}"/>`,
  work: `<path d="M33 35L41 42L33 49M67 35L59 42L67 49M45 53H55" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  failed: `<path d="M39 41L45 47M45 41L39 47M55 41L61 47M61 41L55 47" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round"/>`,
  wait: `<circle cx="40" cy="44" r="1.9" fill="${WHITE}"/><circle cx="60" cy="44" r="1.9" fill="${WHITE}"/><path d="M45 49.5H55" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round"/>`,
  review: `<circle cx="37" cy="46" r="2.6" fill="none" stroke="${WHITE}" stroke-width="2"/><circle cx="46.5" cy="50" r="1.5" fill="${WHITE}"/><circle cx="58" cy="45" r="6" fill="none" stroke="${WHITE}" stroke-width="2.4"/>`,
}

export type Face = keyof typeof FACES

/** What his arms do: swing as he runs, one waves, or both cheer. */
export type Arms = 'swing' | 'wave' | 'cheer'

export type Look = { face?: Face; arms?: Arms; gaze?: [number, number]; shade?: boolean; sit?: boolean }

// The angles of the left and right arms, hanging down at 0, while `swing` degrees go with his run.
const angles = (arms: Arms, swing: number): [number, number] =>
  arms === 'wave' ? [swing, -160] : arms === 'cheer' ? [160, -160] : [swing, -swing]

/**
 * A little Buddy, in a box of 100 x 96 with his feet on y 92: the same body, a smaller screen with
 * his `face` looking `gaze` points off its centre. `run` is 0 or 1, the two beats of his run: feet and
 * arms swing, the body hops. `sit` has him on the ground, his feet out in front of him. `shade` draws
 * his shadow under his feet.
 */
export function minion(run: number, { face = 'work', arms = 'swing', gaze = [0, 0], shade = true, sit = false }: Look = {}): string {
  const hop = run ? -3 : 0
  const [left, right] = angles(arms, run ? 18 : -18)

  return `
${shade ? '<ellipse cx="50" cy="93" rx="34" ry="6" fill="url(#shade)" style="opacity:var(--sh)"/>' : ''}
${sit ? '' : `<ellipse cx="33" cy="${run ? 80 : 86}" rx="15" ry="8" fill="url(#ag-foot)"/><ellipse cx="67" cy="${run ? 86 : 80}" rx="15" ry="8" fill="url(#ag-foot)"/>`}
<g transform="translate(0 ${hop + (sit ? 5 : 0)})"><ellipse cx="9" cy="58" rx="7" ry="15" fill="url(#ag-arm)" transform="rotate(${left} 9 47)"/><ellipse cx="91" cy="58" rx="7" ry="15" fill="url(#ag-arm)" transform="rotate(${right} 91 47)"/>
<rect x="11" y="10" width="78" height="70" rx="20" fill="url(#ag-mini)"/>
<ellipse cx="50" cy="16" rx="30" ry="5" fill="#fff" opacity=".1"/>
<rect x="20" y="22" width="60" height="44" rx="9" fill="none" stroke="${WHITE}" stroke-width="2.2"/>
<g transform="translate(${gaze[0]} ${gaze[1]})">${FACES[face]}</g></g>${sit ? '<ellipse cx="29" cy="88" rx="15" ry="6.5" fill="url(#ag-foot)"/><ellipse cx="71" cy="88" rx="15" ry="6.5" fill="url(#ag-foot)"/>' : ''}`
}
