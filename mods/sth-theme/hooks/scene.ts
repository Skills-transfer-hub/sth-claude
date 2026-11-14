/**
 * Le coin fika de Buddy: the scene behind the conversation (desktop and mobile).
 *
 * Everything is vector (hooks/art.ts): the app's backdrop draws no image, so Buddy 3D's renders
 * can't be used. The room is drawn in the design system's neutrals plus the warm of wood and lamp,
 * morning in light mode and evening in dark mode. The ASCII mark hangs on the wall as a print. The
 * little Buddies show Buddy's statuses: three ferry crates (skills, to be installed) along the rug, and
 * on the left, where the conversation leaves a margin, three shelves climb the wall with a Buddy who
 * looks to the window, one who waits and one who waves, while on the floor one jumps on a pile of
 * crates, one has failed beside the crate he dropped, and a carrier is at work. Four more doze off
 * sitting: two on the shelves, one on the floor against the wall, and one against the pile at the end
 * of the rug. At the window a Buddy
 * peeps in over the sill, in review, his hands on its edge. From time to time Buddy himself has his
 * fika: he lifts the cup and sips, and later bites the kanelbulle.
 *
 * The app draws a backdrop as a still and plays no animation in it, so the scene is a function of the
 * time `t` in seconds (motion.ts) that the mod draws once, at one instant. Only the light and dark
 * modes are left to the styles inside, and a wash of the window's own color that covers the scene
 * when the system asks for more contrast.
 *
 * The root has a viewBox of 1600 x 900 and is sliced to fill any screen. The nook sits in the right
 * of it, where the conversation leaves a margin; a portrait box moves it to the middle.
 */
import { ART_DEFS, hero, minion } from './art'
import type { Look } from './art'
import { fikaPose, patrol, runPhase, tri } from './motion'

const DAY = {
  w0: '#ece9e2', w1: '#e2ded5', f0: '#dccdb1', f1: '#c8b693', plank: '#a99671', base: '#d6d1c6',
  win: '#f8f6f1', sky0: '#fbf8ef', sky1: '#e8e2d3', hill: '#cdd1c4', halo: '.55', frame: '#2b2b2d', paper: '#f8f6f0',
  cable: '#55534e', shade: '#d9d4c8', bulb: '#f1ece0', lamp: '#ffe2b0', la: '0', ca: '0',
  leaf1: '#7ca58b', leaf2: '#5f8a72', pot: '#c9b79c', rug: '#d6d0c3', rug2: '#bdb6a5',
  box: '#c8a46c', box2: '#dcbc88', tape: '#ece1c6', wd1: '#dccdb5', wd2: '#c9b99f', wd3: '#cdbca3',
  mote: '#fff', sh: '.2', vig: '.06', calm: '#f8f8f5',
}
const NIGHT = {
  w0: '#1d1c21', w1: '#131216', f0: '#2c251e', f1: '#1b1712', plank: '#4a3f33', base: '#27252b',
  win: '#2e2c33', sky0: '#07070a', sky1: '#13131a', hill: '#0e0e13', halo: '.05', frame: '#d9d3c6', paper: '#232227',
  cable: '#6c6962', shade: '#ecd9ae', bulb: '#fff1cf', lamp: '#ffc47a', la: '.6', ca: '.2',
  leaf1: '#4f7d66', leaf2: '#3c6350', pot: '#4a3f35', rug: '#2a2c2a', rug2: '#3a3d39',
  box: '#8d6e42', box2: '#a07f50', tape: '#bdae8f', wd1: '#cdbb9c', wd2: '#b3a183', wd3: '#b9a78a',
  mote: '#ffd9a0', sh: '.4', vig: '.5', calm: '#0f0f11',
}
const vars = (p: Record<string, string>) =>
  Object.entries(p)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';')

// What stays in the styles: the two modes, the wash for when the system asks for more contrast (`--calm-o`),
// and where the nook sits.
const CSS = `
:root{${vars(DAY)};--calm-o:0}
.night{display:none}
@media (prefers-color-scheme:dark){:root{${vars(NIGHT)}}.day{display:none}.night{display:inline}}
@media (prefers-contrast:more){:root{--calm-o:.6}}
.nook{transform:translate(80px,0) scale(.9);transform-origin:1180px 760px}
@media (max-aspect-ratio:1/1){.nook{transform:translate(-420px,0) scale(.8)}}`

const f = (x: number) => +x.toFixed(2)

// [x, y, radius, delay] of the evening stars, inside the window.
const STAR_AT = [
  [918, 152, 1.6, 0], [950, 178, 1.2, 1.3], [1066, 160, 1.5, 2.1], [1052, 214, 1.1, .6], [930, 238, 1.4, 2.8],
  [1074, 262, 1.6, 1.7], [962, 300, 1.2, .3], [1040, 332, 1.5, 2.4], [920, 360, 1.3, 1.1], [1064, 372, 1.1, 3.2],
  [1000, 150, 1.2, 1.9], [1024, 288, 1.4, 3.6], [940, 330, 1, 2.6], [1080, 318, 1.3, .9],
]
const stars = (t: number) =>
  STAR_AT.map(([x, y, r, d]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f4efe3" opacity="${f(0.25 + 0.75 * tri((t + d!) / (3 + (d! % 2))))}"/>`).join('')

// [angle, length, tone] of the leaves, which grow from the pot's top.
const LEAVES = [[-58, 40, 1], [-38, 56, 2], [-14, 72, 1], [12, 64, 2], [36, 52, 1], [60, 40, 2]]
  .map(([a, l, t]) => `<ellipse cx="935" cy="${702 - l!}" rx="13" ry="${l}" fill="var(--leaf${t})" transform="rotate(${a} 935 702)"/>`)
  .join('')

// Rises from the cup, in front of Buddy's dark screen: soft white puffs, in the hero's own space, one
// every 1.7 s, each over 5 s.
const steam = (t: number) =>
  [0, 1.7, 3.4]
    .map((d, i) => {
      const p = ((t + d) % 5) / 5

      return `<circle r="13" fill="url(#puff)" opacity="${f(p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75)}" transform="translate(${f(340 + i * 4 + 7 * p)} ${f(242 - 52 * p)}) scale(${f(0.6 + 1.2 * p)})"/>`
    })
    .join('')

// Dust in the lamp's light above Buddy's head, and in the sunbeam by day: each rises over 16 s.
const dust = (t: number, at: number[][]) =>
  at
    .map(([x, y, d]) => {
      const p = ((t + d!) % 16) / 16

      return `<circle cx="${x}" cy="${y}" r="1.8" fill="var(--mote)" opacity="${f(0.85 * (p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75))}" transform="translate(${f(10 * p)} ${f(-60 * p)})"/>`
    })
    .join('')
const LAMP_DUST = [[1132, 430, 0], [1162, 402, 4], [1196, 424, 8], [1216, 384, 11], [1146, 362, 2], [1182, 346, 6]]
const SUN_DUST = [[1120, 240, 0], [1160, 300, 3], [1205, 360, 7], [1135, 420, 10], [1232, 250, 5], [1190, 200, 12]]

// A crate w wide at (x, y): the skills the little Buddies ferry.
const crate = (x: number, y: number, w: number) => {
  const h = w * 0.75

  return `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="2" fill="var(--box)"/><rect width="${w}" height="${h * 0.28}" rx="2" fill="var(--box2)"/><rect x="${w * 0.4}" width="${w * 0.2}" height="${h}" fill="var(--tape)"/></g>`
}

// A stack of three crates, for each end of the rug.
const pile = (x: number, y: number) => crate(x, y, 30) + crate(x + 32, y, 30) + crate(x + 16, y - 23, 30)
const PILES = pile(960, 838) + pile(1344, 840)

type Pose = Look & { run?: number; crated?: boolean; tilt?: number; squash?: number; lift?: number }

// A little Buddy of scale `k`, his box of 100 x 96 starting at `left` and his feet on `feet`. `run` is the
// beat of his run, and the crate on his head bobs with it; `tilt` leans him, `squash` flattens him, and
// `lift` takes him off the ground, his shadow staying on it.
const buddy = (left: number, feet: number, k: number, { run = 0, crated = false, tilt = 0, squash = 1, lift = 0, ...look }: Pose = {}) => {
  const ground = lift ? `<ellipse cx="${f(left + 50 * k)}" cy="${f(feet + k)}" rx="${f(34 * k)}" ry="${f(6 * k)}" fill="url(#shade)" style="opacity:var(--sh)"/>` : ''
  const body = `${minion(run, { ...look, shade: !lift })}${crated ? `<g transform="translate(0 ${run ? -3 : 0})">${crate(22, -30, 56)}</g>` : ''}`
  const posed = tilt || squash !== 1 ? `<g transform="rotate(${tilt} 50 92) translate(50 92) scale(${f(1 + (1 - squash) * 0.8)} ${squash}) translate(-50 -92)">${body}</g>` : body

  return `${ground}<g transform="translate(${f(left)} ${f(feet - lift - 92 * k)}) scale(${k})">${posed}</g>`
}

// [feet y, scale, left x, span, steps, phase]: a little Buddy runs `span` along the rug in `steps`
// steps of a tenth of a second and back, with a crate on his head.
const WORKER_AT = [[812, 0.58, 990, 330, 44, 0], [832, 0.66, 1010, 290, 40, 3.1], [854, 0.74, 980, 350, 48, 6.2]]
const workers = (t: number) =>
  WORKER_AT.map(([feet, k, left, span, steps, phase], i) =>
    buddy(left! + span! * patrol(t, steps! / 4.6, phase!), feet!, k!, { run: runPhase(t + i * 0.13), crated: true }),
  ).join('\n')

const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace"

// The z's of a sleeper, from his head at (x, y) up and away, to the right (`dir` 1) or to the left (-1).
const zzz = (x: number, y: number, dir: number) =>
  [[0, 0, 12], [11, -15, 15], [24, -33, 19]]
    .map(([dx, dy, size]) => `<text x="${f(x + dir * dx!)}" y="${f(y + dy!)}" font-size="${size}" font-weight="700" font-family="${MONO}" fill="var(--frame)" opacity=".6">z</text>`)
    .join('')

// A shelf on the wall, w wide with its top at y: the plank, its shadow, and two brackets.
const shelf = (x: number, y: number, w: number) =>
  `<rect x="${x + 4}" y="${y + 12}" width="${w}" height="8" rx="4" fill="#000" opacity=".06"/><rect x="${x}" y="${y}" width="${w}" height="12" rx="3" fill="var(--wd2)"/><path d="M${x + 26} ${y + 12}v22l22-22M${x + w - 48} ${y + 12}v22l22-22" fill="var(--wd3)"/>`

// The left margin, where the conversation leaves room, shows more of Buddy's statuses. Three shelves climb the
// wall: a Buddy looks to the window from the top one, one waits on the middle one, one waves from the lowest.
// On the floor one jumps on a pile of crates, one has failed beside the crate he dropped, and a carrier is at work.
const DEPOT = [
  shelf(412, 196, 150), buddy(419, 196, 0.62, { face: 'sleep', sit: true, tilt: -9 }), zzz(430, 150, -1), buddy(490, 196, 0.7, { face: 'idle', gaze: [9, 1] }),
  shelf(380, 330, 170), buddy(392, 330, 0.7, { face: 'wait' }), buddy(476, 330, 0.62, { face: 'sleep', sit: true, tilt: 9 }), zzz(518, 284, 1),
  shelf(372, 458, 190), crate(386, 432, 34), crate(424, 432, 34), buddy(485, 458, 0.7, { face: 'idle', arms: 'wave' }),
  `<ellipse cx="470" cy="846" rx="140" ry="12" fill="url(#shade)" style="opacity:var(--sh)"/>`,
  crate(392, 808, 50), crate(444, 808, 50), crate(496, 808, 50), crate(418, 770, 50), crate(470, 770, 50), crate(444, 733, 50),
  buddy(434, 733, 0.7, { face: 'idle', arms: 'cheer', lift: 12 }),
  `<g transform="rotate(-24 584 860)">${crate(566, 846, 36)}</g>`,
  buddy(354, 872, 0.92, { run: 1, crated: true }),
  buddy(498, 876, 0.85, { face: 'failed', squash: 0.88, tilt: 5 }),
  buddy(560, 736, 0.5, { face: 'sleep', sit: true, tilt: 7 }), zzz(596, 690, 1),
].join('\n')

// One more sleeper, in the nook: against the pile of crates at the right end of the rug.
const NAP = buddy(1399, 862, 0.52, { face: 'sleep', sit: true, tilt: -8 }) + zzz(1430, 822, 1)

/** The scene `t` seconds after it started, as one SVG document. */
export function scene(t: number): string {
  const pose = fikaPose(t)
  const shoot = (t % 21) / 21

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><style>${CSS}</style>
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w0)"/><stop offset="1" stop-color="var(--w1)"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--f0)"/><stop offset="1" stop-color="var(--f1)"/></linearGradient>
<linearGradient id="skyd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sky0)"/><stop offset="1" stop-color="var(--sky1)"/></linearGradient>
<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--lamp)" stop-opacity=".9"/><stop offset="1" stop-color="var(--lamp)" stop-opacity="0"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2d0" stop-opacity=".55"/><stop offset="1" stop-color="#fff2d0" stop-opacity="0"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="var(--lamp)" stop-opacity=".75"/><stop offset="1" stop-color="var(--lamp)" stop-opacity="0"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".6" cy=".5" r=".8"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000"/></radialGradient>
<radialGradient id="puff"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="shade"><stop offset="0" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="moonlight"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="pane"><rect x="900" y="130" width="190" height="270" rx="8"/></clipPath>
<mask id="crescent"><rect x="980" y="150" width="100" height="100" fill="#fff"/><circle cx="1052" cy="186" r="17" fill="#000"/></mask>${ART_DEFS}
</defs>
<rect width="1600" height="900" fill="url(#wall)"/>
<circle cx="995" cy="265" r="260" fill="url(#halo)" style="opacity:var(--halo)"/>

<g class="nook">
<path class="day" d="M1010 140H1090L1500 780H1180Z" fill="url(#beam)"/>
<g clip-path="url(#pane)">
<g class="day"><rect x="900" y="130" width="190" height="270" fill="url(#skyd)"/>
<g fill="#fff" opacity=".92" transform="translate(${f(60 * tri(t / 160))} 0)"><ellipse cx="950" cy="218" rx="34" ry="11"/><ellipse cx="975" cy="207" rx="22" ry="13"/><ellipse cx="930" cy="210" rx="17" ry="9"/></g>
<g fill="#fff" opacity=".8" transform="translate(${f(60 * tri((t + 40) / 220))} 0)"><ellipse cx="1030" cy="305" rx="30" ry="9"/><ellipse cx="1048" cy="297" rx="17" ry="10"/></g></g>
<g class="night"><rect x="900" y="130" width="190" height="270" fill="url(#skyd)" style="--sky0:#07070a;--sky1:#14141b"/>
<circle cx="1041" cy="193" r="72" fill="url(#moonlight)"/><circle cx="1041" cy="193" r="19" fill="#f4efe3" mask="url(#crescent)"/>${stars(t)}
${shoot >= 0.9 && shoot <= 0.97 ? `<path d="M0 0L22-10" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity="${f(shoot < 0.91 ? (shoot - 0.9) / 0.01 : 1 - (shoot - 0.91) / 0.06)}" transform="translate(${f(1076 - (132 * (shoot - 0.9)) / 0.07)} ${f(160 + (66 * (shoot - 0.9)) / 0.07)})"/>` : ''}</g>
<path d="M900 366C930 356 962 362 996 368S1056 360 1090 366V400H900Z" fill="var(--hill)"/>
<g class="night"><circle cx="1040" cy="380" r="80" fill="url(#glow)" opacity=".5"/></g>
${buddy(990, 429, 1, { face: 'review', gaze: [5, 1], tilt: -6 })}
<path d="M905 135H962L905 260Z" fill="#fff" opacity=".08"/>
</g>
<rect x="900" y="130" width="190" height="270" rx="8" fill="none" stroke="var(--win)" stroke-width="10"/>
<path d="M995 130V400M900 265H1090" stroke="var(--win)" stroke-width="7"/>
<rect x="886" y="398" width="218" height="13" rx="3" fill="var(--win)"/>
<rect x="890" y="411" width="210" height="9" rx="4" fill="#000" opacity=".07"/>
<rect x="991" y="388" width="22" height="12" rx="6" fill="url(#ag-arm)"/><rect x="1067" y="388" width="22" height="12" rx="6" fill="url(#ag-arm)"/>

<g transform="translate(1262 160)"><rect width="112" height="150" rx="3" fill="var(--paper)" stroke="var(--frame)" stroke-width="5"/>
<g font-family="${MONO}" font-size="24" fill="var(--frame)" text-anchor="middle" xml:space="preserve">
<text x="56" y="56">╭───╮</text><text x="56" y="84">│^.^│</text><text x="56" y="112">╰───╯</text>
<text x="56" y="136" font-size="11" opacity=".7">sth</text></g></g>

<path d="M1118 322H1222L1332 772H1008Z" fill="url(#cone)" style="opacity:var(--ca)"/>
<path d="M1170-10V262" stroke="var(--cable)" stroke-width="3"/>
<path d="M1108 322Q1108 262 1170 258Q1232 262 1232 322Z" fill="var(--shade)"/>
<ellipse cx="1170" cy="322" rx="60" ry="6" fill="var(--bulb)"/>
<g style="opacity:var(--la)"><circle cx="1170" cy="330" r="210" fill="url(#glow)"/></g>
</g>

<rect y="690" width="1600" height="16" fill="var(--base)"/>
<rect y="706" width="1600" height="194" fill="url(#floor)"/>
<path d="M0 746H1600M0 792H1600M0 848H1600" stroke="var(--plank)" stroke-width="1.5" opacity=".35"/>

${DEPOT}
<g class="nook">
<ellipse cx="1180" cy="782" rx="330" ry="44" fill="var(--rug)"/>
<ellipse cx="1180" cy="782" rx="300" ry="36" fill="none" stroke="var(--rug2)" stroke-width="3"/>
<g transform="rotate(${f(-1.6 + 3.2 * tri(t / 16))} 935 702)">${LEAVES}</g>
<path d="M906 702h58l-7 52a6 6 0 0 1-6 5H919a6 6 0 0 1-6-5z" fill="var(--pot)"/>
<rect x="902" y="696" width="66" height="11" rx="4" fill="var(--pot)"/>
<ellipse cx="1155" cy="766" rx="170" ry="17" fill="url(#shade)" style="opacity:var(--sh)"/>
<g class="night" style="opacity:.4"><ellipse cx="1170" cy="806" rx="270" ry="52" fill="url(#glow)"/></g>
<g class="day">${dust(t, SUN_DUST)}</g><g class="night">${dust(t, LAMP_DUST)}</g>
<g transform="translate(984.67 428.67) scale(.7778)">${hero(pose)}<g opacity="${f(pose.steam)}">${steam(t)}</g></g>
<g class="night" style="opacity:.2"><ellipse cx="1170" cy="470" rx="200" ry="110" fill="url(#glow)"/></g>
${PILES}
${NAP}
${workers(t)}
</g>
<rect width="1600" height="900" fill="url(#vig)" style="opacity:var(--vig)"/>
<rect width="1600" height="900" fill="var(--calm)" style="opacity:var(--calm-o)"/>
</svg>`
}
