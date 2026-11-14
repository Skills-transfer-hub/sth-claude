import { expect, test } from 'claude-code/testing'

import { fikaPose, patrol } from '../hooks/motion'

// The scene starts 8 s into the 48 s fika, so `t` seconds on is `t + 8` in its timeline.
test('Buddy sits at his bench, sips at 16 s, bites at 36 s, and is back at rest by 46 s', () => {
  const rest = fikaPose(0)

  expect(rest.cup).toEqual([0, 0, 0])
  expect(rest.bunWhole).toBe(1)

  const sip = fikaPose(8)

  expect(Math.round(sip.cup[0])).toBe(-95)
  expect(sip.steam).toBe(0)

  const bite = fikaPose(28)

  expect(Math.round(bite.bun[0])).toBe(101)
  expect(bite.bunWhole).toBe(0)

  expect(fikaPose(38).cup).toEqual([0, 0, 0])
})

test('a little Buddy runs out, rests, and comes back', () => {
  expect(patrol(0, 10, 0)).toBe(0)
  expect(patrol(4.6, 10, 0)).toBeGreaterThan(0.99)
  expect(patrol(4.8, 10, 0)).toBe(1)
  expect(patrol(7.5, 10, 0)).toBeGreaterThan(0)
  expect(patrol(9.8, 10, 0)).toBe(0)
})
