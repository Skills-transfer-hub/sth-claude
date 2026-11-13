/** Buddy pets: a strip where each Buddy wanders, chases a ball and reacts to
 * Claude, like a desk pet. Pure and deterministic (seeded): the Client module
 * steps it every 50 ms and draws it; the tests step it directly.
 *
 * Positions are fractions of the walkable strip: x = 0 puts a pet against the
 * left edge, x = 1 against the right edge, whatever the strip's real width.
 */

export const PET_CLIPS = ['walk', 'run', 'jump', 'sit', 'sleep', 'ok', 'update', 'error'] as const
export type Clip = typeof PET_CLIPS[number]
/** Clips rendered 3/4 toward the right: mirrored when the pet heads left. */
export const SIDE_CLIPS: ReadonlySet<Clip> = new Set(['walk', 'run', 'jump', 'sit', 'sleep'])
export type Mood = 'idle' | 'working' | 'waiting' | 'error'

// Neutral variants only (STH design system: no coloured materials). Desktop maps each pixel's
// luminance through grey stops [luminance, colour]; the terminal uses ui/pixel-buddy.ts palettes.
// Chalk turns the pale frame and face dark so they stay readable on its light body.
export const PET_COLORS = {
  graphite: null,
  chalk: [[0, 0x8a8984], [0.2, 0xd6d5cf], [0.5, 0xeeede8], [0.65, 0x55544f], [1, 0x1c1c1c]],
  steel: [[0, 0x141414], [0.2, 0x7c7c80], [1, 0xf2f2ee]],
} as const
export type PetColor = keyof typeof PET_COLORS
export const MAX_PETS = 3
export type PetSpec = { id: string; color: PetColor }

export type Pet = PetSpec & {
  x: number; dir: 1 | -1; clip: Clip; start: number; until: number
  target: number | null; heartUntil: number
}
export type Ball = { x: number; y: number; vx: number; vy: number }
export type World = {
  tick: number; seed: number; mood: Mood; idleSince: number
  pets: Pet[]; ball: Ball | null
}
/** Frames per clip at 20 FPS (desktop); the terminal sheets keep every other one. */
export type Counts = Record<Clip, number>

export const TICK_MS = 50
const WALK = 0.0035
const RUN = 0.011
const SLEEP_AFTER = 2_400 // two idle minutes
const HEART_TICKS = 30
const GRAVITY = 0.012

function random(world: World): number {
  world.seed = (world.seed * 1_103_515_245 + 12_345) % 2_147_483_648
  return world.seed / 2_147_483_648
}

function play(pet: Pet, clip: Clip, tick: number, ticks: number): void {
  if (pet.clip !== clip) pet.start = tick
  pet.clip = clip
  pet.until = tick + ticks
}

export function newWorld(specs: readonly PetSpec[], seed = 1): World {
  const world: World = { tick: 0, seed, mood: 'idle', idleSince: 0, pets: [], ball: null }
  return syncPets(world, specs)
}

/** Keeps pets that are still listed, adds new ones spread along the strip. */
export function syncPets(world: World, specs: readonly PetSpec[]): World {
  const pets = specs.slice(0, MAX_PETS).map((spec, index) => {
    const known = world.pets.find(pet => pet.id === spec.id)
    if (known) return { ...known, color: spec.color }
    const pet: Pet = { ...spec, x: (index + 0.5) / Math.max(specs.length, 1), dir: index % 2 ? -1 : 1, clip: 'ok', start: world.tick, until: world.tick, target: null, heartUntil: 0 }
    return pet
  })
  return { ...world, pets }
}

/** The pose a pet shows now, at `fps` (20 desktop, 10 terminal). */
export function frameOf(pet: Pet, tick: number, count: number, fps = 20): number {
  const frame = Math.floor((tick - pet.start) * fps * TICK_MS / 1000)
  return pet.clip === 'jump' ? Math.min(count - 1, frame) : ((frame % count) + count) % count
}

export function throwBall(world: World, x: number): World {
  const at = Math.min(1, Math.max(0, x))
  return { ...world, ball: { x: at, y: 1, vx: (at < 0.5 ? 1 : -1) * 0.004, vy: 0 } }
}

/** A click at strip position `x`: the pet under it jumps with a heart, else a ball drops there.
 * `reach` is half a pet's width in strip units. */
export function poke(world: World, x: number, reach: number): World {
  const hit = world.pets.find(pet => Math.abs(pet.x - x) <= reach)
  if (!hit) return throwBall(world, x)
  const pets = world.pets.map(pet => {
    if (pet !== hit) return pet
    const next = { ...pet, heartUntil: world.tick + HEART_TICKS }
    play(next, 'jump', world.tick, 20)
    return next
  })
  return { ...world, pets, idleSince: world.tick }
}

function moveToward(pet: Pet, target: number, speed: number): boolean {
  const distance = target - pet.x
  if (Math.abs(distance) <= speed) { pet.x = target; return true }
  pet.dir = distance > 0 ? 1 : -1
  pet.x += pet.dir * speed
  return false
}

function chooseIdle(world: World, pet: Pet): void {
  const tick = world.tick
  if (tick - world.idleSince > SLEEP_AFTER) return play(pet, 'sleep', tick, Number.MAX_SAFE_INTEGER)
  const roll = random(world)
  if (roll < 0.55) {
    pet.target = random(world)
    play(pet, 'walk', tick, Number.MAX_SAFE_INTEGER)
  } else if (roll < 0.8) {
    play(pet, 'sit', tick, 60 + Math.floor(random(world) * 80))
  } else {
    play(pet, 'ok', tick, 40 + Math.floor(random(world) * 60))
  }
}

export function step(previous: World, mood: Mood): World {
  const world: World = { ...previous, tick: previous.tick + 1, pets: previous.pets.map(pet => ({ ...pet })) }
  const tick = world.tick
  if (mood !== world.mood) {
    const finished = world.mood === 'working' && mood === 'idle'
    world.mood = mood
    world.idleSince = tick
    for (const pet of world.pets) {
      pet.target = null
      pet.until = tick
      if (finished) play(pet, 'jump', tick, 20) // a turn just ended: celebrate
    }
  }
  let ball = world.ball && { ...world.ball }
  if (ball) {
    ball.vy -= GRAVITY
    ball.y += ball.vy
    ball.x += ball.vx
    if (ball.y <= 0) { ball.y = 0; ball.vy = Math.abs(ball.vy) > 0.03 ? -ball.vy * 0.55 : 0; ball.vx *= 0.9 }
    if (ball.x < 0 || ball.x > 1) { ball.x = Math.min(1, Math.max(0, ball.x)); ball.vx = -ball.vx }
  }
  const chaser = ball && world.pets.reduce<Pet | null>((best, pet) => !best || Math.abs(pet.x - ball!.x) < Math.abs(best.x - ball!.x) ? pet : best, null)
  for (const pet of world.pets) {
    if (pet.clip === 'jump' && tick < pet.until) continue
    if (ball && pet === chaser) {
      if (Math.abs(ball.x - pet.x) < 0.03 && ball.y < 0.25) {
        ball = null
        pet.heartUntil = tick + HEART_TICKS
        play(pet, 'jump', tick, 20)
        world.idleSince = tick
      } else {
        moveToward(pet, ball.x, RUN)
        play(pet, 'run', tick, Number.MAX_SAFE_INTEGER)
      }
      continue
    }
    if (mood === 'working') {
      if (pet.x <= 0) pet.dir = 1
      if (pet.x >= 1) pet.dir = -1
      pet.x = Math.min(1, Math.max(0, pet.x + pet.dir * RUN))
      play(pet, 'run', tick, Number.MAX_SAFE_INTEGER)
    } else if (mood === 'waiting') {
      play(pet, 'update', tick, Number.MAX_SAFE_INTEGER)
    } else if (mood === 'error') {
      play(pet, 'error', tick, Number.MAX_SAFE_INTEGER)
    } else if (pet.clip === 'walk' && pet.target !== null) {
      if (moveToward(pet, pet.target, WALK)) { pet.target = null; chooseIdle(world, pet) }
    } else if (tick >= pet.until || pet.clip === 'run' || pet.clip === 'update' || pet.clip === 'error' || pet.clip === 'jump') {
      chooseIdle(world, pet)
    }
  }
  world.ball = ball
  return world
}

/** A pixel's colour in a pet's variant: graphite keeps it, the others map its luminance. */
export function tint(rgb: number, color: PetColor): number {
  const stops = PET_COLORS[color]
  if (!stops) return rgb
  const lum = ((rgb >> 16 & 255) * 0.2126 + (rgb >> 8 & 255) * 0.7152 + (rgb & 255) * 0.0722) / 255
  const next = Math.max(1, stops.findIndex(([at]) => at >= lum))
  const [a, from] = stops[next - 1]!, [b, to] = stops[next]!
  const t = Math.min(1, Math.max(0, (lum - a) / (b - a)))
  let out = 0
  for (const shift of [16, 8, 0]) out |= Math.round((from >> shift & 255) + ((to >> shift & 255) - (from >> shift & 255)) * t) << shift
  return out
}

/** The same mapping as SVG feComponentTransfer tables, sampled every 0.05 (every stop lands on a sample). */
export function tintTables(color: PetColor): [string, string, string] | null {
  if (!PET_COLORS[color]) return null
  const tables: [number[], number[], number[]] = [[], [], []]
  for (let step = 0; step <= 20; step += 1) {
    const value = Math.round(step / 20 * 255)
    const rgb = tint(value << 16 | value << 8 | value, color)
    tables[0].push((rgb >> 16 & 255) / 255)
    tables[1].push((rgb >> 8 & 255) / 255)
    tables[2].push((rgb & 255) / 255)
  }
  return tables.map(values => values.map(value => value.toFixed(3)).join(' ')) as [string, string, string]
}
