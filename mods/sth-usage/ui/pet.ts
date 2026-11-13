import type { ClientModule, ClientSurface } from 'claude-code'
import { askForPoses, poseAt, posesFor } from './frame-stream'
import type { PoseBatch } from './frame-stream'
import { PET_CLIPS, SIDE_CLIPS, TICK_MS, frameOf, newWorld, poke, step, syncPets, throwBall, tintTables } from './pet-world'
import type { Counts, Mood, PetColor, PetSpec, World } from './pet-world'
import { BALL as PIXEL_BALL, HEART as PIXEL_HEART, PIXEL_CLIPS, PIXEL_H, PIXEL_W, pixelColor, pixelFrame, stamp } from './pixel-buddy'

export type PetProps = {
  surface: 'desktop' | 'terminal'
  mood: Mood
  caption: string
  pets: PetSpec[]
  /** Poses per clip in the desktop sheets; the terminal draws Buddy Pixel instead. */
  counts: Counts
  /** Presses of the panel's ball button: each new one drops a ball. */
  balls: number
  batch?: PoseBatch
}
type PetState = { world: World; balls: number }

// Terminal: Buddy Pixel, one pixel per half cell (▀ ▄), the strip as tall as a pet.
export const TERMINAL_ROWS = Math.ceil(PIXEL_H / 2)
const DEFAULT_COLOR = 0x01000000
// Desktop: one SVG, Buddy 3D poses drawn 120 px tall on a 480 x 128 stage. Neutral extras.
const VIEW_W = 480
const VIEW_H = 128
const POSE = 120
const GROUND = VIEW_H - POSE * 0.2
const HEART = '#9a9a96'
const BALL = '#b8b7b1'
const BALL_EDGE = '#6f6e69'

const latest = new WeakMap<object, PetProps>()

/** Asks the hooks module for the first desktop pose this strip lacks: shown clips first, then the rest. */
function requestPoses(surface: ClientSurface<PetState>, props: PetProps, world: World): void {
  if (props.batch) posesFor(props.batch.sequence, props.batch)
  const shown = new Map(world.pets.map(pet => [pet.clip, pet] as const))
  for (const clip of [...shown.keys(), ...PET_CLIPS]) {
    const count = props.counts[clip], poses = posesFor(clip, undefined)
    if (!count || poses.filter(pose => pose !== undefined).length >= count) continue
    const pet = shown.get(clip)
    askForPoses(data => surface.post(data), clip, poses, pet ? frameOf(pet, world.tick, count) : 0, count, true, world.tick)
    return
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function desktop(props: PetProps, world: World) {
  const filters = new Set<PetColor>()
  let body = ''
  for (const pet of world.pets) {
    const count = props.counts[pet.clip]
    const pose = count ? poseAt(posesFor(pet.clip, undefined), frameOf(pet, world.tick, count)) : undefined
    const left = pet.x * (VIEW_W - POSE)
    const mirror = pet.dir < 0 && SIDE_CLIPS.has(pet.clip)
    if (pose) {
      if (pet.color !== 'graphite') filters.add(pet.color)
      body += `<g transform="translate(${(mirror ? left + POSE : left).toFixed(1)} ${VIEW_H - POSE})${mirror ? ' scale(-1 1)' : ''}">` +
        `<image href="data:image/webp;base64,${pose}" width="${POSE}" height="${POSE}"${pet.color !== 'graphite' ? ` filter="url(#${pet.color})"` : ''}/></g>`
    }
    if (pet.heartUntil > world.tick) {
      const rise = 30 - (pet.heartUntil - world.tick)
      body += `<text x="${(left + POSE / 2).toFixed(1)}" y="${(28 - rise * 0.6).toFixed(1)}" font-size="20" text-anchor="middle" fill="${HEART}">♥</text>`
    }
  }
  if (world.ball) {
    const cx = world.ball.x * (VIEW_W - POSE) + POSE / 2, cy = GROUND - 6 - world.ball.y * (GROUND - 16)
    body += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="${BALL}" stroke="${BALL_EDGE}" stroke-width="1"/>`
  }
  const defs = [...filters].map(color => {
    const [r, g, b] = tintTables(color)!
    return `<filter id="${color}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/>` +
      `<feComponentTransfer><feFuncR type="table" tableValues="${r}"/><feFuncG type="table" tableValues="${g}"/><feFuncB type="table" tableValues="${b}"/></feComponentTransfer></filter>`
  }).join('')
  return {
    type: 'Svg' as const,
    props: {
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}">` +
        (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>',
      alt: props.caption,
      isInteractive: false,
    },
  }
}

/** The strip in Buddy Pixel: a pixel canvas two pixels per cell tall, then one ▀/▄ per cell, runs merged. */
function terminal(surface: ClientSurface<PetState>, props: PetProps, world: World) {
  const { Box, Text } = surface.elements
  const columns = Math.max(PIXEL_W, surface.columns || 46)
  const height = TERMINAL_ROWS * 2
  const canvas = new Uint32Array(columns * height).fill(DEFAULT_COLOR)
  const paint = (rows: readonly string[], x: number, y: number, color: PetColor) => {
    const grid = Array.from({ length: height }, () => Array<string>(columns).fill('.'))
    stamp(grid, x, y, rows)
    grid.forEach((row, py) => row.forEach((key, px) => {
      const rgb = key === '.' ? undefined : pixelColor(key, color)
      if (rgb !== undefined) canvas[py * columns + px] = rgb
    }))
  }
  for (const pet of world.pets) {
    const spec = PIXEL_CLIPS[pet.clip]
    const index = frameOf(pet, world.tick, Number.MAX_SAFE_INTEGER, spec.fps)
    const x = Math.round(pet.x * (columns - PIXEL_W))
    paint(pixelFrame(pet.clip, pet.clip === 'jump' ? Math.min(index, spec.frames.length - 1) : index, pet.dir), x, height - PIXEL_H, pet.color)
    if (pet.heartUntil > world.tick) paint(PIXEL_HEART, x + 9, Math.max(0, height - PIXEL_H - 1 - Math.floor((30 - (pet.heartUntil - world.tick)) / 10)), pet.color)
  }
  if (world.ball) {
    const x = Math.round(world.ball.x * (columns - PIXEL_W) + PIXEL_W / 2 - 2)
    paint(PIXEL_BALL, x, height - 4 - Math.round(world.ball.y * (height - 6)), 'graphite')
  }
  const rows: ReturnType<typeof Text>[] = []
  for (let row = 0; row < TERMINAL_ROWS; row += 1) {
    const spans: ReturnType<typeof Text>[] = []
    let text = '', fg = -1, bg = -1
    const flush = () => {
      if (!text) return
      spans.push(Text({ children: text, ...(fg !== DEFAULT_COLOR && { color: hex(fg) }), ...(bg !== DEFAULT_COLOR && { backgroundColor: hex(bg) }) }))
      text = ''
    }
    for (let column = 0; column < columns; column += 1) {
      const top = canvas[row * 2 * columns + column]!, bottom = canvas[(row * 2 + 1) * columns + column]!
      // One cell, two exact pixels: ▀ paints the top in the foreground, the bottom in the background.
      const [glyph, foreground, background] = top === DEFAULT_COLOR
        ? bottom === DEFAULT_COLOR ? [' ', DEFAULT_COLOR, DEFAULT_COLOR] : ['▄', bottom, DEFAULT_COLOR]
        : ['▀', top, bottom]
      if (foreground !== fg || background !== bg) { flush(); fg = foreground; bg = background }
      text += glyph
    }
    flush()
    rows.push(Text({ wrap: 'truncate-end', children: spans }))
  }
  return Box({ flexDirection: 'column', children: rows })
}

const PetStrip: ClientModule<PetProps, PetState> = (props, surface) => {
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.setState({ world: newWorld(props.pets, (props.balls + 1) * 7919), balls: props.balls })
    surface.every(TICK_MS, () => {
      const current = latest.get(surface)!, state = surface.state!
      let world = step(syncPets(state.world, current.pets), current.mood)
      if (current.balls > state.balls) world = throwBall(world, ((world.seed % 1000) / 1000) * 0.8 + 0.1)
      surface.setState({ world, balls: current.balls })
    })
    surface.onPointer(event => {
      if (event.type !== 'down' || !surface.state) return
      const current = latest.get(surface)!
      const terminalStrip = current.surface === 'terminal'
      const width = terminalStrip ? Math.max(PIXEL_W, surface.columns) : VIEW_W
      const pose = terminalStrip ? PIXEL_W : POSE
      const at = (event.fine?.x ?? event.x + 0.5) / Math.max(1, surface.columns) * width
      const x = (at - pose / 2) / (width - pose)
      surface.setState({ ...surface.state, world: poke(surface.state.world, x, (pose / 2) / (width - pose) * 0.8) })
    })
  }
  const world = surface.state?.world ?? newWorld(props.pets)
  if (props.surface === 'desktop') requestPoses(surface, props, world)
  return props.surface === 'terminal' ? terminal(surface, props, world) : desktop(props, world)
}

export default PetStrip
