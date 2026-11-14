/**
 * The time of the scene. The app draws a backdrop as a still: no CSS animation and no SMIL plays in
 * it, and no `Client` is mounted there, so everything that moves is a function of the time `t` in
 * seconds in this file, and the scene shows one instant of it.
 */

/** The fika repeats every 48 s, and the scene starts 8 s in, so Buddy sips within 6 s. */
export const LOOP = 48
const START = 8

/** 0 to 1 and back over one period, for any `u` counted in periods. */
export const tri = (u: number) => {
  const x = u - Math.floor(u)

  return x < 0.5 ? 2 * x : 2 - 2 * x
}

/** The values of a track of `[seconds, ...values]` keys at `t`: linear between keys, held beyond them. */
export function track(t: number, keys: number[][]): number[] {
  const first = keys[0]!

  if (t <= first[0]!) return first.slice(1)

  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!
    const b = keys[i]!

    if (t <= b[0]!) {
      const k = (t - a[0]!) / (b[0]! - a[0]!)

      return b.slice(1).map((v, j) => a[j + 1]! + (v - a[j + 1]!) * k)
    }
  }

  return keys[keys.length - 1]!.slice(1)
}

// The sip: his right arm reaches the cup, the two rise to his mouth, rest, and go back. The bite: his
// left arm comes forward for the bun, lifts it, bites, and puts it back bitten. [seconds, ...values].
const ARM = [[0, 0, 0], [14, 0, 0], [14.7, -94, 29], [15.3, -127, -9], [17, -127, -9], [17.6, -94, 29], [18.3, 0, 0], [LOOP, 0, 0]]
const CUP = [[0, 0, 0, 0], [14.7, 0, 0, 0], [15.3, -95, -60, -12], [17, -95, -60, -12], [17.6, 0, 0, 0], [LOOP, 0, 0, 0]]
const STEAM = [[0, 1], [14.5, 1], [14.7, 0], [17.6, 0], [17.8, 1], [LOOP, 1]]
const LEFT_BACK = [[0, 1], [33.9, 1], [34, 0], [37.6, 0], [37.7, 1], [LOOP, 1]]
const LEFT_FRONT = [[0, 0, 0, 0], [33.9, 0, 0, 0], [34, 1, 0, 0], [34.7, 1, 40, 66], [35.3, 1, 86, 0], [36.4, 1, 86, 0], [37, 1, 40, 66], [37.6, 1, 0, 0], [37.7, 0, 0, 0], [LOOP, 0, 0, 0]]
const BUN = [[0, 0, 0], [34.7, 0, 0], [35.3, 101, -59], [36.4, 101, -59], [37, 0, 0], [LOOP, 0, 0]]
const BUN_WHOLE = [[0, 1], [35.2, 1], [35.3, 0], [LOOP, 0]]

/** What the fika moves at `t` seconds: offsets of the parts of Buddy, and the opacity of some. */
export type FikaPose = {
  arm: [number, number] // the right arm
  cup: [number, number, number] // x, y and the tilt in degrees
  steam: number // opacity: none while the cup is in his hand
  leftBack: number // opacity of the left arm behind him
  leftFront: [number, number, number] // opacity and offset of the left arm in front of him
  bun: [number, number]
  bunWhole: number // opacity: the bun is bitten from the first bite on
}

export function fikaPose(t: number): FikaPose {
  const u = (t + START) % LOOP

  return {
    arm: track(u, ARM) as [number, number],
    cup: track(u, CUP) as [number, number, number],
    steam: track(u, STEAM)[0]!,
    leftBack: track(u, LEFT_BACK)[0]!,
    leftFront: track(u, LEFT_FRONT) as [number, number, number],
    bun: track(u, BUN) as [number, number],
    bunWhole: track(u, BUN_WHOLE)[0]!,
  }
}

/** How far along his run a little Buddy is, 0 to 1: out in the first 46% of the period, a rest, and back. */
export function patrol(t: number, period: number, phase: number): number {
  const u = ((t + phase) / period) % 1

  if (u < 0.46) return u / 0.46
  if (u < 0.5) return 1
  if (u < 0.96) return 1 - (u - 0.5) / 0.46

  return 0
}

/** 0 or 1, flipping every quarter second: the run cycle of the little Buddies' feet and arms. */
export const runPhase = (t: number) => Math.floor(t * 4) % 2
