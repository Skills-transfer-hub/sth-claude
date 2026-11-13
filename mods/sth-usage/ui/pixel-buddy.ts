/** Buddy Pixel: the terminal pet, hand-drawn at the terminal's own grid. One pixel is half a
 * cell (▀ ▄), so the terminal shows every pixel as drawn, with no resampling. Frames are built
 * from parts (body, canonical face, arms, feet); the face is never mirrored. Neutral palettes
 * only, per the STH design system (see design-system/guidelines/buddy-pixel.md).
 *
 * Keys: k outline · h highlight · b body · d shade · f screen frame · s screen · l face,
 * plus neutral extras (H heart, B/C ball, Z sleep, Q question, M motion lines).
 */
import type { Clip, PetColor } from './pet-world'

export const PIXEL_W = 23
export const PIXEL_H = 21
const BX = 3, BY = 4

const BODY = [
  '....kkkkkkkkk....',
  '..kkhhhhhhhhhkk..',
  '.khhbbbbbbbbbbdk.',
  'khb' + 'f'.repeat(11) + 'bdk',
  'khbf' + 's'.repeat(9) + 'fbdk',
  'khbfFFFFFFFFFfbdk',
  'khbfFFFFFFFFFfbdk',
  'khbfFFFFFFFFFfbdk',
  'khbf' + 's'.repeat(9) + 'fbdk',
  'khb' + 'f'.repeat(11) + 'bdk',
  '.k' + 'b'.repeat(12) + 'dk.',
  '..kk' + 'd'.repeat(9) + 'kk..',
  '....kkkkkkkkk....',
]
const SCREEN = 9 // inner screen width the face is centred in

// The canonical faces (assets/buddy.js), drawn 3 pixels tall.
const FACES = {
  ok: ['l...l.l', '.l.l.l.', 'l.l...l'],       // >/<
  work: ['l.....l', '.l...l.', 'l.lll.l'],     // >_<
  done: ['.l...l.', 'l.l.l.l', '.......'],     // ^.^
  error: ['l.l.l.l', '.l...l.', 'l.l.l.l'],    // x x
  update: ['.....lll', 'll...l.l', 'll.l.lll'], // o.O
  sleeping: ['.......', 'll...ll', '.......'], // - -
} as const
type Face = keyof typeof FACES

const ARM = ['.k', 'kh', 'kb', 'kb', '.k']
const FOOT = ['.kkkk.', 'khhbbk', 'kbbbdk', '.kkkk.']
const FOOT_SIT = ['.kkkk.', 'khbbbk', 'kbbbbk', '.kkkk.']
export const HEART = ['.H.H.', 'HHHHH', '.HHH.', '..H..']
export const BALL = ['.BB.', 'BBBC', 'BBCC', '.CC.']
const Z = ['ZZZ', '.Z.', 'ZZZ']
const QUESTION = ['QQQ', '..Q', '.Q.', '...', '.Q.']
const SPEED = ['MM', '...', 'MMM']

const PALETTES: Record<PetColor, Record<string, number>> = {
  graphite: { k: 0x0a0a0a, h: 0x5e5e63, b: 0x3d3d40, d: 0x2a2a2d, f: 0xa9a8a1, s: 0x151516, l: 0xecebe4 },
  chalk: { k: 0x1c1c1c, h: 0xf4f4f0, b: 0xd2d1cb, d: 0xa8a7a1, f: 0x8f8e88, s: 0x1a1a1a, l: 0xf4f4f0 },
  steel: { k: 0x0d0d0e, h: 0xa3a3a7, b: 0x7c7c80, d: 0x5c5c60, f: 0xc6c5bf, s: 0x161617, l: 0xecebe4 },
}
// Mid greys stay readable on dark and light terminals alike.
const EXTRAS: Record<string, number> = { H: 0x9a9a96, B: 0xb8b7b1, C: 0x6f6e69, Z: 0x9a9a96, Q: 0x9a9a96, M: 0x7a7a76 }

type Pose = {
  face?: Face; dy?: number; squash?: number; sway?: number; lean?: number; faceDx?: number
  arms?: [number, number] | 'up'; feet?: [number, number, number, number]; sit?: boolean
  zz?: number; q?: number
}
type PixelClip = { fps: number; side?: boolean; speed?: boolean; frames: Pose[] }

const running = (lift: [number, number], stride: number): Pose =>
  ({ face: 'work', lean: 1, faceDx: 1, feet: [lift[0], lift[1], -stride, stride], arms: [-lift[0], -lift[1]] })
const sitting: Pose = { dy: 3, squash: 1, sit: true, arms: [1, 1] }

/** One clip per pet-world clip. fps is the clip's own rate; the strip ticks at 20 Hz. */
export const PIXEL_CLIPS: Record<Clip, PixelClip> = {
  ok: { fps: 4, frames: [{}, {}, { dy: 1, squash: 1 }, {}, {}, { face: 'sleeping' }, {}, { dy: 1, squash: 1 }] },
  walk: { fps: 8, side: true, frames: [
    { faceDx: 1, feet: [1, 0, 1, 0], arms: [-1, 1] }, { faceDx: 1, dy: 1 },
    { faceDx: 1, feet: [0, 1, 0, 1], arms: [1, -1] }, { faceDx: 1, dy: 1 }] },
  run: { fps: 12, side: true, speed: true, frames: [running([2, 0], 1), { ...running([1, 1], 0), dy: -1 }, running([0, 2], 1), { ...running([1, 1], 0), dy: -1 }] },
  sit: { fps: 2, frames: [sitting, sitting, { ...sitting, face: 'sleeping' }, sitting] },
  sleep: { fps: 3, frames: [0, 1, 2, 3, 4, 5].map(i => ({ face: 'sleeping' as const, dy: 3 + (i % 3 === 1 ? 1 : 0), squash: 1 + (i % 3 === 1 ? 1 : 0), sit: true, arms: [2, 2] as [number, number], zz: i })) },
  jump: { fps: 10, frames: [
    { face: 'done', dy: 1, squash: 2 }, { face: 'done', dy: -2, arms: 'up' }, { face: 'done', dy: -4, arms: 'up', feet: [1, 1, 0, 0] },
    { face: 'done', dy: -3, arms: 'up' }, { face: 'done', dy: -1, arms: [-1, -1] }, { face: 'done', dy: 1, squash: 1 }, { face: 'done' }] },
  update: { fps: 3, frames: [{ face: 'update', q: 0 }, { face: 'update', q: 1, dy: 1, squash: 1 }] },
  error: { fps: 10, frames: [{ face: 'error' }, { face: 'error', sway: -1 }, { face: 'error' }, { face: 'error', sway: 1 }] },
}

type Grid = string[][]
const mirror = (rows: readonly string[]) => rows.map(row => [...row].reverse().join(''))

export function stamp(grid: Grid, x: number, y: number, rows: readonly string[]): void {
  rows.forEach((row, dy) => [...row].forEach((key, dx) => {
    const X = x + dx, Y = y + dy
    if (key !== '.' && Y >= 0 && Y < grid.length && X >= 0 && X < grid[Y]!.length) grid[Y]![X] = key
  }))
}

function draw(pose: Pose, dir: 1 | -1): Grid {
  const g: Grid = Array.from({ length: PIXEL_H }, () => Array<string>(PIXEL_W).fill('.'))
  const { face = 'ok', dy = 0, squash = 0, sway = 0, lean = 0, faceDx = 0, arms = [0, 0], feet = [0, 0, 0, 0], sit = false } = pose
  const body = BODY.slice()
  if (squash >= 1) body.splice(10, 1) // lose the row under the screen,
  if (squash >= 2) body.splice(2, 1)  // then the one above it
  const rows = FACES[face], width = rows[0]!.length
  const left = Math.max(0, Math.min(SCREEN - width, Math.ceil((SCREEN - width) / 2) + faceDx * dir))
  let faceRow = 0
  const drawn = body.map(row => {
    if (!row.includes('F')) return row
    const inner = 's'.repeat(left) + rows[faceRow++]!.replace(/\./g, 's') + 's'.repeat(SCREEN - width - left)
    return row.replace('F'.repeat(SCREEN), inner)
  })
  const top = BY + dy + squash
  drawn.forEach((row, r) => stamp(g, BX + sway + (lean && r < 6 ? lean * dir : 0), top + r, [row]))
  const armY = top + 5
  if (arms === 'up') {
    stamp(g, BX + sway - 2, armY - 5, ARM); stamp(g, BX + sway + 17, armY - 5, mirror(ARM))
  } else {
    stamp(g, BX + sway - 2, armY + arms[0], ARM); stamp(g, BX + sway + 17, armY + arms[1], mirror(ARM))
  }
  const ground = Math.min(PIXEL_H - 4, top + drawn.length - 1)
  if (sit) {
    stamp(g, BX + sway - 1, PIXEL_H - 4, FOOT_SIT); stamp(g, BX + sway + 12, PIXEL_H - 4, FOOT_SIT)
  } else {
    stamp(g, BX + sway + 2 + feet[2], ground - feet[0], FOOT); stamp(g, BX + sway + 9 + feet[3], ground - feet[1], FOOT)
  }
  return g
}

/** The frame a pet shows: rows of palette keys, '.' transparent. Side clips face `dir`. */
export function pixelFrame(clip: Clip, index: number, dir: 1 | -1): string[] {
  const spec = PIXEL_CLIPS[clip], pose = spec.frames[index % spec.frames.length]!
  const side: 1 | -1 = spec.side ? dir : 1
  const g = draw(pose, side)
  if (spec.speed) stamp(g, side > 0 ? 0 : PIXEL_W - 3, BY + 6 + (index % 2), side > 0 ? SPEED : mirror(SPEED))
  if (pose.zz !== undefined) stamp(g, 16 + (pose.zz % 3), 3 - (pose.zz % 3), Z)
  if (pose.q !== undefined) stamp(g, 19, pose.q, QUESTION)
  return g.map(row => row.join(''))
}

export function pixelColor(key: string, color: PetColor): number | undefined {
  return PALETTES[color][key] ?? EXTRAS[key]
}
