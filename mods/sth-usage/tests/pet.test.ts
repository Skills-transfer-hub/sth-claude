import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { PET_CLIPS, frameOf, newWorld, poke, step, tint, tintTables } from '../ui/pet-world'
import { PIXEL_CLIPS, PIXEL_H, PIXEL_W, pixelColor, pixelFrame } from '../ui/pixel-buddy'
import type { Mood, World } from '../ui/pet-world'
import { TERMINAL_ROWS } from '../ui/pet'
import { desktopFixture, sheetFixture } from './frame-fixtures'

const TWO = [{ id: 'a', color: 'graphite' }, { id: 'b', color: 'chalk' }] as const

function run(world: World, mood: Mood, ticks: number, each?: (world: World) => void): World {
  for (let tick = 0; tick < ticks; tick += 1) { world = step(world, mood); each?.(world) }
  return world
}

describe('Buddy pet simulation', () => {
  test('working pets run both ways and never leave the strip', () => {
    const directions = new Set<number>()
    run(newWorld(TWO), 'working', 400, world => {
      for (const pet of world.pets) {
        expect(pet.clip).toBe('run')
        expect(pet.x).toBeGreaterThanOrEqual(0)
        expect(pet.x).toBeLessThanOrEqual(1)
        directions.add(pet.dir)
      }
    })
    expect([...directions].sort()).toEqual([-1, 1])
  })

  test('the end of a turn makes every pet jump once, then they wander again', () => {
    let world = run(newWorld(TWO), 'working', 5)
    world = step(world, 'idle')
    expect(world.pets.map(pet => pet.clip)).toEqual(['jump', 'jump'])
    world = run(world, 'idle', 25)
    for (const pet of world.pets) expect(['walk', 'sit', 'ok']).toContain(pet.clip)
  })

  test('permission and errors hold the pets in their matching pose', () => {
    expect(step(newWorld(TWO), 'waiting').pets.map(pet => pet.clip)).toEqual(['update', 'update'])
    expect(step(newWorld(TWO), 'error').pets.map(pet => pet.clip)).toEqual(['error', 'error'])
  })

  test('a click on a pet gives it a heart and a jump', () => {
    const world = newWorld(TWO)
    const petted = poke(world, world.pets[1]!.x, 0.05)
    expect(petted.ball).toBeNull()
    expect(petted.pets[1]!.clip).toBe('jump')
    expect(petted.pets[1]!.heartUntil).toBeGreaterThan(petted.tick)
    expect(petted.pets[0]!.heartUntil).toBe(0)
  })

  test('a click on the floor drops a ball that the nearest pet runs to and catches', () => {
    let world = newWorld([{ id: 'a', color: 'graphite' }])
    world = poke(world, 0.95, 0.05)
    expect(world.ball).not.toBeNull()
    let ran = false, caught = false
    run(world, 'idle', 600, next => {
      ran ||= next.pets[0]!.clip === 'run'
      if (!caught && next.ball === null) { caught = true; expect(next.pets[0]!.heartUntil).toBeGreaterThan(next.tick) }
    })
    expect(ran).toBe(true)
    expect(caught).toBe(true)
  })

  test('pets fall asleep after two idle minutes and wake when petted', () => {
    let world = run(newWorld(TWO), 'idle', 2_500)
    expect(world.pets.map(pet => pet.clip)).toEqual(['sleep', 'sleep'])
    world = poke(world, world.pets[0]!.x, 0.05)
    world = run(world, 'idle', 25)
    expect(world.pets[0]!.clip).not.toBe('sleep')
  })

  test('loops wrap while a jump holds its last pose', () => {
    const pet = { ...newWorld(TWO).pets[0]!, clip: 'walk' as const, start: 0 }
    expect(frameOf(pet, 24, 24)).toBe(0)
    expect(frameOf(pet, 25, 24)).toBe(1)
    expect(frameOf(pet, 6, 12, 10)).toBe(3)
    expect(frameOf({ ...pet, clip: 'jump' }, 99, 20)).toBe(19)
  })

  test('desktop variants stay neutral grey: graphite is untouched, chalk and steel map luminance', () => {
    expect(tint(0x333333, 'graphite')).toBe(0x333333)
    expect(tint(0x333333, 'chalk')).toBe(0xd6d5cf) // the body's luminance lands on the body grey
    expect(tint(0xe0e0e0, 'chalk')).toBeLessThan(0x404040) // its pale face turns dark
    expect(tint(0x000000, 'steel')).toBe(0x141414)
    expect(tintTables('graphite')).toBeNull()
    expect(tintTables('chalk')![0].split(' ')).toHaveLength(21)
    for (const color of ['chalk', 'steel'] as const) {
      for (const value of [0, 0x333333, 0x808080, 0xffffff]) {
        const rgb = tint(value, color), r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8) // no hue
      }
    }
  })
})

describe('Buddy Pixel', () => {
  const keys = new Set('khbdfslHBCZQM.')
  test('every clip frame fits the sprite and uses only palette keys', () => {
    for (const clip of PET_CLIPS) {
      for (const dir of [1, -1] as const) {
        for (let index = 0; index < PIXEL_CLIPS[clip].frames.length; index += 1) {
          const rows = pixelFrame(clip, index, dir)
          expect(rows).toHaveLength(PIXEL_H)
          for (const row of rows) {
            expect(row).toHaveLength(PIXEL_W)
            for (const key of row) expect(keys.has(key)).toBe(true)
          }
        }
      }
    }
  })

  test('faces are the canonical ones and are never mirrored', () => {
    const screen = (clip: Parameters<typeof pixelFrame>[0], dir: 1 | -1, index = 0) => pixelFrame(clip, index, dir).join('\n')
    // >/< has 'lssslsl' on its top row and 'lslsssl' on its bottom row; a mirror would swap them.
    for (const dir of [1, -1] as const) {
      const rows = screen('walk', dir).split('\n')
      expect(rows.findIndex(row => row.includes('lssslsl'))).toBeLessThan(rows.findIndex(row => row.includes('lslsssl')))
    }
    expect(screen('update', 1)).toContain('llslslll') // o.O
    expect(screen('sleep', 1)).toContain('llssslls') // - -
  })

  test('palettes are neutral grey', () => {
    for (const color of ['graphite', 'chalk', 'steel'] as const) {
      for (const key of 'khbdfslHBCZQM') {
        const rgb = pixelColor(key, color)!
        const r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12)
      }
    }
  })
})

function paneProps(bodyColumns: number): RenderPropsOf['Pane'] {
  return { title: 'Buddy', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
}

function stubs(on: On, store: Record<string, unknown> = {}) {
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.env(on, { TERM: 'xterm-256color', TMUX: '' })
  const saved = new Map(Object.entries(store))
  on('store.get', (_, e) => ({ value: saved.get(e.key) }))
  on('store.set', (_, e) => { saved.set(e.key, e.value); return { value: undefined } })
  on('fs.read', (_, e) => ({ value: e.as === 'bytes' ? { base64: sheetFixture(e.path) ?? '' } : '{}' }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not available in tests', isStdoutTruncated: false, isStderrTruncated: false } }))
  return saved
}

async function strip(ui: Mounted<'terminal', 'Pane'> | Mounted<'desktop', 'Pane'>) {
  await ui.resize({ columns: 48, rows: TERMINAL_ROWS, in: 'buddy-pets' })
  await ui.advance(500)
  return ui.drawn({ in: 'buddy-pets' })
}

describe('Pet strip in the Home pane', () => {
  test('desktop draws the Buddy HD poses and drops a ball where the floor is clicked', async ($, on) => {
    stubs(on)
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-usage', props: paneProps(48) })
    expect(await ui.find({ type: 'Client', key: 'buddy-pets' })).toBeDefined()
    let drawing = await strip(ui)
    if (drawing.type !== 'Svg') throw new Error('The desktop strip draws one SVG')
    expect(desktopFixture('ok').some(pose => drawing.type === 'Svg' && drawing.props.source.includes(pose)) ||
      desktopFixture('walk').some(pose => drawing.type === 'Svg' && drawing.props.source.includes(pose)) ||
      desktopFixture('sit').some(pose => drawing.type === 'Svg' && drawing.props.source.includes(pose))).toBe(true)
    expect(drawing.props.source).not.toContain('<circle')
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'buddy-pets' })
    await ui.advance(50)
    drawing = await ui.drawn({ in: 'buddy-pets' })
    expect(drawing.type === 'Svg' && drawing.props.source).toContain('<circle')
  })

  test('adding a pet saves it and draws it in its color; removing it saves that too', async ($, on) => {
    const saved = stubs(on)
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-usage', props: paneProps(48) })
    await ui.press({ key: 'pet-add' })
    expect(saved.get('pets')).toEqual([{ id: 'buddy', color: 'graphite' }, { id: expect.stringMatching(/^pet-/), color: 'chalk' }])
    const drawing = await strip(ui)
    expect(drawing.type === 'Svg' && drawing.props.source).toContain('filter="url(#chalk)"')
    await ui.press({ key: 'pet-remove' })
    expect(saved.get('pets')).toEqual([{ id: 'buddy', color: 'graphite' }])
  })

  test('terminal draws Buddy Pixel as exact half-block pixels', async ($, on) => {
    stubs(on)
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(50) })
    await strip(ui)
    const rows = (await ui.findAll({ type: 'Text', in: 'buddy-pets' })).filter(row => row.props.wrap === 'truncate-end')
    expect(rows).toHaveLength(TERMINAL_ROWS)
    const spans = await ui.findAll({ type: 'Text', in: 'buddy-pets' })
    const colors = new Set(spans.flatMap(span => [span.props.color, span.props.backgroundColor]).filter(Boolean))
    expect(colors).toContain('#0a0a0a') // graphite outline
    expect(colors).toContain('#ecebe4') // face
    expect(spans.some(span => /[▀▄]/.test(span.text))).toBe(true)
    expect(spans.every(span => !/[▘▝▖▗▚▞▙▛▜▟▌▐]/.test(span.text))).toBe(true) // no quadrant blends
  })

  test('the classic Buddy stays one press away and the choice is kept', async ($, on) => {
    const saved = stubs(on)
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-usage', props: paneProps(48) })
    await ui.press({ key: 'home-classic' })
    expect(saved.get('homeView')).toBe('classic')
    expect(await ui.find({ type: 'Client', key: 'buddy-pets' })).toBeUndefined()
    await ui.press({ key: 'home-pets' })
    expect(await ui.find({ type: 'Client', key: 'buddy-pets' })).toBeDefined()
  })
})
