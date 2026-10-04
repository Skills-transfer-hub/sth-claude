import type { On, RenderPropsOf, SessionMessage, UiBlitArgs } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted, MockClock } from 'claude-code/testing'

import { isPromptText, isUserPrompt } from '../hooks/fika'
import { terminalRaster } from '../hooks/terminal-raster'
import type { SkillsView } from '../types'
import ok from '../ui/frames/ok'
import work from '../ui/frames/work'
import done from '../ui/frames/done'
import error from '../ui/frames/error'
import update from '../ui/frames/update'
import noConfig from '../ui/frames/noConfig'
import fika from '../ui/frames/fika/index'
import terminalFika, { COLUMNS as FIKA_COLUMNS, ROWS as FIKA_ROWS, FPS as FIKA_RASTER_FPS } from '../ui/terminal-frames/fika/index'
import terminalNoConfig from '../ui/terminal-frames/noConfig'
import { COLUMNS as MAIN_COLUMNS, ROWS as MAIN_ROWS } from '../ui/terminal-frames/settings'

const buddyFrames = { ok, work, done, error, update, noConfig }

const SURFACES = ['terminal', 'desktop'] as const
const RESOURCE = 'team::guides/review'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mEAAAAASUVORK5CYII='
let fixtureClock: MockClock | undefined

function paneProps(bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'Skills STH',
    isFocused: true,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

function rasterColors(cells: unknown, columns = MAIN_COLUMNS, rows = MAIN_ROWS) {
  if (typeof cells !== 'string') throw new Error('Buddy must provide terminal cells')
  const bytes = Uint8Array.from(atob(cells), character => character.charCodeAt(0))
  expect(bytes.length).toBe(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  let visibleCells = 0
  const colors = new Set<number>()
  const luminance: number[] = []
  for (let offset = 0; offset < bytes.length; offset += 12) {
    if (view.getUint32(offset, true) !== 0x20) visibleCells += 1
    for (const word of [4, 8]) {
      const color = view.getUint32(offset + word, true)
      colors.add(color)
      if (color !== 0x01000000) {
        luminance.push(((color >> 16) & 255) * 0.2126 + ((color >> 8) & 255) * 0.7152 + (color & 255) * 0.0722)
      }
    }
  }
  return { visibleCells, colors, luminance: luminance.sort((a, b) => a - b) }
}

function expectVisibleRaster(cells: unknown, columns = MAIN_COLUMNS, rows = MAIN_ROWS) {
  const { visibleCells, colors } = rasterColors(cells, columns, rows)
  expect(visibleCells).toBeGreaterThan(20)
  expect(colors.size).toBeGreaterThan(10)
}

function expectRasterPose(cells: unknown, packet: string | undefined, columns = MAIN_COLUMNS, rows = MAIN_ROWS) {
  if (!packet) throw new Error('The expected Buddy source pose is missing')
  // Keep failures readable: a full base64 comparison hides the useful assertion.
  expect(cells === terminalRaster(packet, columns, rows), `Buddy pose must match the decoded ${columns}×${rows} source`).toBe(true)
}

function expectRasterBlit(blit: UiBlitArgs | undefined, packet: string | undefined, columns = MAIN_COLUMNS, rows = MAIN_ROWS) {
  if (!blit || !('cells' in blit)) throw new Error('Buddy must update the terminal raster')
  expectRasterPose(blit.cells, packet, columns, rows)
}

async function expectBuddyVisible(ui: Pick<Mounted<'terminal' | 'desktop', 'Pane'>, 'surface' | 'find' | 'findAll' | 'drawn'>) {
  await fixtureClock?.settle()
  if (ui.surface === 'terminal') {
    const drawing = (await ui.findAll({ type: 'Raster' })).find(node => node.key?.startsWith('buddy-raster-'))
    expect(drawing).toBeDefined()
    expect(drawing?.props.columns).toBe(MAIN_COLUMNS)
    expect(drawing?.props.rows).toBe(MAIN_ROWS)
    expectVisibleRaster(drawing?.props.cells)
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
  } else {
    const drawing = await ui.drawn({ in: 'buddy-noConfig' })
    expect(drawing.type).toBe('Svg')
    if (drawing.type !== 'Svg') throw new Error('Buddy must remain a visible desktop pose')
    expect(drawing.props.source).toContain('data:image/webp;base64,')
    expect(drawing.props.width).toBe(144)
    expect(drawing.props.height).toBe(144)
  }
}

async function expectOnlyBuddyPose<P extends 'terminal' | 'desktop'>(ui: Mounted<P, 'Pane'>, state: 'noConfig' | 'fika', frame?: number) {
  await fixtureClock?.settle()
  expect(await ui.find({ key: 'fika-scene' })).toBeUndefined()
  if (ui.surface === 'terminal') {
    const drawings = await ui.findAll({ type: 'Raster' })
    expect(drawings).toHaveLength(1)
    expect(drawings[0]?.key?.startsWith('buddy-raster-')).toBe(true)
    const poses = state === 'fika' ? terminalFika : terminalNoConfig
    const columns = state === 'fika' ? FIKA_COLUMNS : MAIN_COLUMNS
    const rows = state === 'fika' ? FIKA_ROWS : MAIN_ROWS
    if (frame === undefined) expect(poses.some(packet => terminalRaster(packet, columns, rows) === drawings[0]?.props.cells)).toBe(true)
    else expectRasterPose(drawings[0]?.props.cells, poses[state === 'fika' ? Math.floor(frame * FIKA_RASTER_FPS / 30) : frame], columns, rows)
    expect(drawings[0]?.props.columns).toBe(columns)
    expect(drawings[0]?.props.rows).toBe(rows)
    expectVisibleRaster(drawings[0]?.props.cells, columns, rows)
  } else {
    const clients = (await ui.findAll({ type: 'Client' })).filter(client => client.key?.startsWith('buddy-'))
    expect(clients).toHaveLength(1)
    const key = clients[0]?.key
    if (!key) throw new Error('Buddy needs one addressable animation')
    const drawing = await ui.drawn({ in: key })
    expect(drawing.type).toBe('Svg')
    if (drawing.type !== 'Svg') throw new Error('Buddy must draw an HD pose')
    const poses = state === 'fika' ? fika : noConfig
    if (frame === undefined) expect(poses.some(pose => drawing.props.source.includes(pose))).toBe(true)
    else expect(drawing.props.source.includes(poses[frame]!), `Buddy ${state} expected pose ${frame}; current pose ${poses.findIndex(pose => drawing.props.source.includes(pose))}`).toBe(true)
    expect(drawing.props.width).toBe(144)
    expect(drawing.props.height).toBe(144)
  }
}

async function findFikaClient<P extends 'terminal' | 'desktop'>(ui: Mounted<P, 'Pane'>) {
  return (await ui.findAll({ type: 'Client' })).find(client => client.key?.startsWith('buddy-fika-scene-'))
}

describe('Buddy in text terminals', () => {
  test('every state draws colored cells without requiring an image-capable terminal', async ($, on) => {
    const { values } = stubEnvironment(on, true)
    const cases = [
      { percent: 0, turns: 0, cost: 0, working: false },
      { percent: 0, turns: 0, cost: 0, working: true },
      { percent: 0, turns: 1, cost: 0, working: false },
      { percent: 95, turns: 0, cost: 0, working: false },
      { percent: 80, turns: 0, cost: 0, working: false },
      { percent: 0, turns: 0, cost: null, working: false },
    ]
    for (const scenario of cases) {
      values.set('snapshot', { limits: [{ kind: 'five_hour', percentUsed: scenario.percent }], costUsd: scenario.cost })
      values.set('turns', scenario.turns)
      values.set('isWorking', scenario.working)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      await expectBuddyVisible(ui)
      await ui.unmount()
    }
  })

  test('the body remains visible against a dark terminal background', () => {
    // Check the decoded, fitted cells that the terminal actually receives.
    const { visibleCells, colors, luminance } = rasterColors(terminalRaster(terminalNoConfig[0]!, MAIN_COLUMNS, MAIN_ROWS))
    expect(visibleCells).toBeGreaterThan(100)
    expect(colors.has(0x01000000)).toBe(true)
    expect(luminance[Math.floor(luminance.length / 2)]).toBeGreaterThan(75)
    expect(luminance[Math.floor(luminance.length / 4)]).toBeGreaterThan(65)
  })

  test('the portable animation changes once per 100 ms while Fika keeps its own cadence', async ($, on) => {
    const { clock, blits } = fikaEnvironment(on)
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    const buddy = await $.ui.mount({
      plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage',
      props: paneProps(64), viewport: { columns: 180, rows: 50 },
    })
    await expectOnlyBuddyPose(buddy, 'noConfig', 0)
    blits.length = 0
    await clock.advance(99)
    expect(blits.filter(blit => blit.requestId === 'sth-usage')).toHaveLength(0)
    await clock.advance(1)
    expect(blits.filter(blit => blit.requestId === 'sth-usage')).toHaveLength(1)
    expectRasterBlit(blits[blits.length - 1], terminalNoConfig[1])
    await clock.advance(100)
    expect(blits.filter(blit => blit.requestId === 'sth-usage')).toHaveLength(2)
    expectRasterBlit(blits[blits.length - 1], terminalNoConfig[2])
    await buddy.unmount()
  })

  const imageTerminals: ReadonlyArray<Readonly<Record<string, string>>> = [{ TERM_PROGRAM: 'ghostty' }, { TERM: 'xterm-kitty' }]
  for (const variables of imageTerminals) {
    test(`a ${variables.TERM_PROGRAM ?? variables.TERM} terminal uses the original PNG animation`, async ($, on) => {
      const { clock, blits } = fikaEnvironment(on, [], '', variables)
      await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
      const buddy = await $.ui.mount({
        plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      const image = await buddy.find({ type: 'Image' })
      expect(image).toBeDefined()
      expect(image?.props).toMatchObject({ columns: 24, rows: 12, source: { format: 'png' } })
      expect(image?.props.source).toHaveProperty('file', expect.stringContaining('/assets/frames/noConfig/000.png'))
      expect(await buddy.find({ type: 'Raster' })).toBeUndefined()
      blits.length = 0
      await clock.advance(50)
      expect(blits[blits.length - 1]).toMatchObject({ source: { format: 'png', file: expect.stringContaining('/assets/frames/noConfig/001.png') } })
      await buddy.unmount()
    })
  }

  test('tmux uses the readable fallback even when its parent terminal supports images', async ($, on) => {
    fikaEnvironment(on, [], '', { TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-test,1,0' })
    const buddy = await $.ui.mount({
      plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage',
      props: paneProps(64), viewport: { columns: 180, rows: 50 },
    })
    await expectBuddyVisible(buddy)
    await buddy.unmount()
  })

  test('an image protocol refusal switches to colored cells instead of leaving only alt text', async ($, on) => {
    const { clock, blits } = fikaEnvironment(on, [], '', { TERM_PROGRAM: 'ghostty' }, 'Image draws its alt: terminal has no image protocol')
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    const buddy = await $.ui.mount({
      plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage',
      props: paneProps(64), viewport: { columns: 180, rows: 50 },
    })
    expect(await buddy.find({ type: 'Image' })).toBeDefined()
    await clock.advance(50)
    await expectBuddyVisible(buddy)
    await clock.advance(50)
    expect(blits[blits.length - 1]).toHaveProperty('cells')
    await buddy.unmount()
  })
})

describe('Buddy rendering transitions', () => {
  test('image support is tested even when the terminal reports an ordinary TERM name', async ($, on) => {
    const { clock } = fikaEnvironment(on, [], '', { TERM: 'xterm-256color', MOCK_IMAGE_SUPPORT: '1' })
    const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    await clock.settle()
    expect(await buddy.find({ type: 'Image' })).toBeDefined()
    expect(await buddy.find({ type: 'Raster' })).toBeUndefined()
    await buddy.unmount()
  })

  test('a probe before the native drawing is mounted retries on the frame clock', async ($, on) => {
    const { clock, blits, setBlitResponse } = fikaEnvironment(on, [], '', { MOCK_IMAGE_SUPPORT: '1' })
    let first = true
    setBlitResponse(() => {
      if (first) { first = false; return { deny: 'Nothing is mounted at this key yet' } }
      return {}
    })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    await clock.settle()
    expect(await buddy.find({ type: 'Image' })).toBeDefined()
    await clock.advance(50)
    expect(blits.length).toBeGreaterThan(1)
    expect(await buddy.find({ type: 'Image' })).toBeDefined()
    expect(await buddy.find({ type: 'Raster' })).toBeUndefined()
    await buddy.unmount()
  })

  const states = [
    { state: 'ok', percent: 0, turns: 0, cost: 0, working: false },
    { state: 'work', percent: 0, turns: 0, cost: 0, working: true },
    { state: 'done', percent: 0, turns: 1, cost: 0, working: false },
    { state: 'error', percent: 95, turns: 0, cost: 0, working: false },
    { state: 'update', percent: 80, turns: 0, cost: 0, working: false },
    { state: 'noConfig', percent: 0, turns: 0, cost: null, working: false },
  ] as const
  for (const scenario of states) {
    test(`native ${scenario.state} addresses every original pose, including the final pose and loop`, async ($, on) => {
      const { clock, blits } = fikaEnvironment(on, [], '', { MOCK_IMAGE_SUPPORT: '1' })
      const values: Record<string, unknown> = {
        snapshot: { limits: [{ kind: 'five_hour', percentUsed: scenario.percent }], costUsd: scenario.cost },
        turns: scenario.turns, isWorking: scenario.working,
      }
      on('state.get', { plugin: 'sth-usage', key: /^(snapshot|turns|isWorking)$/ }, (_, e) => ({ value: { value: values[e.key], version: 0 } }))
      await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
      const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
      await clock.settle()
      const count = buddyFrames[scenario.state].length
      expect((await buddy.find({ type: 'Image' }))?.props.source).toHaveProperty('file', expect.stringContaining(`/assets/frames/${scenario.state}/000.png`))
      blits.length = 0
      for (let frame = 1; frame <= count; frame += 1) {
        await clock.advance(50)
        const last = blits[blits.length - 1]
        expect(last).toHaveProperty('source', { format: 'png', file: expect.stringContaining(`/assets/frames/${scenario.state}/${String(frame % count).padStart(3, '0')}.png`) })
      }
      expect(blits).toHaveLength(count)
      await buddy.unmount()
    })
  }

  test('native Buddy plays all 270 Fika PNGs for nine seconds and returns to a native Buddy', async ($, on) => {
    const { clock, blits } = fikaEnvironment(on, [], '', { MOCK_IMAGE_SUPPORT: '1', STH_FIKA_PREVIEW: '1' })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await clock.advance(2_000)
    const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    await clock.settle()
    const initialKey = (await buddy.find({ type: 'Image' }))?.key
    blits.length = 0
    await buddy.press({ key: 'fika' })
    await clock.settle()
    const fikaKey = (await buddy.find({ type: 'Image' }))?.key
    expect(fikaKey).toContain('buddy-image-fika-')
    expect(fikaKey).not.toBe(initialKey)
    expect(await buddy.find({ type: 'Raster' })).toBeUndefined()
    for (let frame = 1; frame < 270; frame += 1) {
      await clock.advance(1000 / 30)
      expect(blits[blits.length - 1]).toMatchObject({ key: fikaKey, source: { format: 'png', file: expect.stringContaining(`/assets/fika/fika-${String(frame + 1).padStart(4, '0')}.png`) } })
    }
    const files = new Set(blits.filter(blit => 'source' in blit && 'file' in blit.source && blit.source.file.includes('/assets/fika/')).map(blit => 'source' in blit && 'file' in blit.source ? blit.source.file : ''))
    expect(files.size).toBe(270)
    await clock.advance(32)
    expect(await buddy.find({ type: 'Image' })).toHaveProperty('key', fikaKey)
    await clock.advance(2)
    await clock.settle()
    expect((await buddy.find({ type: 'Image' }))?.key).toBe(initialKey)
    expect(await buddy.find({ type: 'Raster' })).toBeUndefined()
    await buddy.unmount()
  })

  for (const native of [false, true]) {
    test(`a delayed ${native ? 'native image' : 'portable raster'} rejection cannot cancel the following Fika scene`, async ($, on) => {
      const { clock, blits, setBlitResponse } = fikaEnvironment(on, [], '', { STH_FIKA_PREVIEW: '1', ...(native ? { MOCK_IMAGE_SUPPORT: '1' } : {}) })
      await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
      await clock.advance(2_000)
      const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
      await clock.settle()
      let rejectOne = true
      setBlitResponse(async () => {
        if (!rejectOne) return {}
        rejectOne = false
        await clock.sleep(100)
        return { deny: 'The preceding drawing has another type or size' }
      })
      await clock.advance(native ? 50 : 100)
      await buddy.press({ key: 'fika' })
      await clock.settle()
      const drawing = await buddy.find({ type: native ? 'Image' : 'Raster' })
      expect(drawing?.key).toContain(native ? 'buddy-image-fika-' : 'buddy-raster-fika-')
      blits.length = 0
      await clock.advance(200)
      expect(blits.filter(blit => blit.key === drawing?.key).length).toBeGreaterThan(1)
      expect((await buddy.find({ type: native ? 'Image' : 'Raster' }))?.key).toBe(drawing?.key)
      await buddy.unmount()
    })
  }

  test('a refused Fika PNG falls back for that pane and continues through the last portable frame', async ($, on) => {
    const { clock, blits, setBlitResponse } = fikaEnvironment(on, [], '', { MOCK_IMAGE_SUPPORT: '1', STH_FIKA_PREVIEW: '1' })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await clock.advance(2_000)
    const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    await clock.settle()
    expect(await buddy.find({ type: 'Image' })).toBeDefined()
    setBlitResponse(e => 'source' in e ? { deny: 'Image draws its alt: PNG could not be displayed' } : {})
    await buddy.press({ key: 'fika' })
    await clock.settle()
    await expectOnlyBuddyPose(buddy, 'fika', 0)
    const rasterKey = (await buddy.find({ type: 'Raster' }))?.key
    blits.length = 0
    await clock.advance(8_999)
    expect(blits[blits.length - 1]).toMatchObject({ key: rasterKey })
    expectRasterBlit(blits[blits.length - 1], terminalFika[terminalFika.length - 1], FIKA_COLUMNS, FIKA_ROWS)
    expect(blits.filter(blit => 'cells' in blit)).toHaveLength(134)
    await clock.advance(1)
    await expectOnlyBuddyPose(buddy, 'noConfig')
    expect(await buddy.find({ type: 'Image' })).toBeUndefined()
    await buddy.unmount()
  })

  test('a desktop drawing cannot stop the same pane animated on the terminal', async ($, on) => {
    const { clock, blits } = fikaEnvironment(on, [], '', { STH_FIKA_PREVIEW: '1' })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    const terminal = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    await clock.settle()
    const desktop = await $.ui.mount({ plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-usage', props: paneProps(64) })
    blits.length = 0
    await clock.advance(100)
    expect(blits.filter(blit => blit.key.startsWith('buddy-raster-'))).toHaveLength(1)
    await clock.advance(1_900)
    await terminal.press({ key: 'fika' })
    await clock.settle()
    expect(await findFikaClient(desktop)).toBeDefined()
    blits.length = 0
    await clock.advance(67)
    expect(blits[blits.length - 1]).toMatchObject({ key: expect.stringContaining('buddy-raster-fika-') })
    expectRasterBlit(blits[blits.length - 1], terminalFika[1], FIKA_COLUMNS, FIKA_ROWS)
    await terminal.unmount()
    await desktop.unmount()
  })

  for (const size of [{ columns: 20, rows: 14 }, { columns: 10, rows: 8 }, { columns: 64, rows: 8 }]) {
    test(`an inline pane of ${size.columns}×${size.rows} keeps the entire Buddy or offers enlargement`, async ($, on) => {
      const { clock } = fikaEnvironment(on, [], '', { STH_FIKA_PREVIEW: '1' })
      await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
      await clock.advance(2_000)
      const props = { ...paneProps(size.columns), placement: 'inline' as const, scroll: { offset: 0, bodyRows: size.rows } }
      const buddy = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-usage', props, viewport: { columns: size.columns, rows: 24 } })
      await clock.settle()
      const raster = await buddy.find({ type: 'Raster' })
      if (raster) {
        const columns = raster.props.columns as number
        const rows = raster.props.rows as number
        expect(columns).toBeLessThanOrEqual(size.columns - 2)
        expect(rows + 5).toBeLessThanOrEqual(size.rows)
        expectVisibleRaster(raster.props.cells, columns, rows)
        await buddy.press({ key: 'fika' })
        await clock.settle()
        const fikaRaster = await buddy.find({ type: 'Raster' })
        expect(fikaRaster?.props.columns).toBe(columns)
        expect(fikaRaster?.props.rows).toBe(rows)
        expectVisibleRaster(fikaRaster?.props.cells, columns, rows)
      } else {
        expect(await buddy.find({ type: 'Text', text: '[ H ]' })).toBeDefined()
        expect(await buddy.find({ type: 'Button', key: 'buddy-enlarge' })).toBeDefined()
      }
      const caption = await buddy.find({ type: 'Text', text: /^Buddy is (waiting|taking)/ })
      expect(caption?.props.wrap).toBe('truncate-end')
      await buddy.unmount()
    })
  }
})

describe('Buddy desktop animation', () => {
  const cases = [
    { state: 'ok', frames: 80, seconds: 4, percent: 0, turns: 0, cost: 0, working: false },
    { state: 'work', frames: 48, seconds: 2.4, percent: 0, turns: 0, cost: 0, working: true },
    { state: 'done', frames: 38, seconds: 1.9, percent: 0, turns: 1, cost: 0, working: false },
    { state: 'error', frames: 30, seconds: 1.5, percent: 95, turns: 0, cost: 0, working: false },
    { state: 'update', frames: 36, seconds: 1.8, percent: 80, turns: 0, cost: 0, working: false },
    { state: 'noConfig', frames: 72, seconds: 3.6, percent: 0, turns: 0, cost: null, working: false },
  ]

  for (const scenario of cases) {
    test(`${scenario.state} shows every pose at 20 FPS without gaps or overlaps`, async ($, on) => {
      const { values } = stubEnvironment(on, true)
      values.set('snapshot', { limits: [{ kind: 'five_hour', percentUsed: scenario.percent }], costUsd: scenario.cost })
      values.set('turns', scenario.turns)
      values.set('isWorking', scenario.working)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      const scope = { in: `buddy-${scenario.state}` }
      const poses = buddyFrames[scenario.state as keyof typeof buddyFrames]
      expect(poses).toHaveLength(scenario.frames)
      expect(JSON.stringify(await ui.drawn()).length).toBeLessThanOrEqual(262144)
      const checkPose = async (frame: number) => {
        const drawing = await ui.drawn(scope)
        expect(drawing.type).toBe('Svg')
        if (drawing.type !== 'Svg') throw new Error('Buddy must draw one SVG pose')
        expect(drawing.props.source).toContain(poses[frame % poses.length]!)
        expect(drawing.props.source).toContain('viewBox="0 0 384 384"')
        expect(drawing.props.width).toBe(144)
        expect(drawing.props.height).toBe(144)
        expect(drawing.props.alt.trim().length).toBeGreaterThan(0)
        expect(JSON.stringify(drawing).length).toBeLessThanOrEqual(100000)
      }
      await checkPose(0)
      await ui.advance(49)
      await checkPose(0)
      await ui.advance(1)
      await checkPose(1)
      for (let frame = 2; frame <= scenario.frames; frame += 1) {
        await ui.advance(50)
        await checkPose(frame)
      }
      await ui.unmount()
    })
  }
})

function skillsView(isLinked: boolean): SkillsView {
  return {
    isLinked,
    providers: isLinked ? ['github'] : [],
    installed: isLinked ? [{
      resourceName: RESOURCE,
      providerId: 'github',
      status: 'up-to-date',
      isPinned: false,
    }] : [],
    catalog: [{
      catalogId: 'team::guides/typescript',
      providerId: 'github',
      folderName: 'guides',
      name: 'typescript',
      kind: 'skill',
      description: 'Des conventions TypeScript pour le projet.',
    }, {
      catalogId: 'team::guides/accessibility',
      providerId: 'github',
      folderName: 'guides',
      name: 'accessibility',
      kind: 'skill',
      description: 'Des composants utilisables au clavier.',
    }],
    filter: '',
    busy: null,
    message: null,
    isError: false,
    pendingRemoval: null,
  }
}

function stubEnvironment(on: On, isLinked: boolean, variables: Readonly<Record<string, string>> = {}, imageDenial?: string) {
  mock.env(on, { TERM: 'xterm-256color', TERM_PROGRAM: '', TMUX: '', ...variables })
  const calls: string[][] = []
  const blits: UiBlitArgs[] = []
  const values = new Map<string, unknown>([['skills', skillsView(isLinked)]])
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  fixtureClock = clock
  const imagesSupported = /ghostty/i.test(variables.TERM_PROGRAM ?? '') || /kitty/i.test(variables.TERM ?? '') || variables.MOCK_IMAGE_SUPPORT === '1'
  let respondToBlit = (e: UiBlitArgs): Promise<{ deny?: string }> | { deny?: string } =>
    'source' in e && (imageDenial || !imagesSupported)
      ? { deny: imageDenial ?? 'Image draws its alt: terminal has no image protocol' } : {}
  // Keep core reads and writes, including subscriptions, and supply fixtures
  // only until the mod writes a key for the first time.
  on('state.get', { plugin: 'sth-usage' }, async (_, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value !== undefined && result.value.value === undefined && values.has(e.key)) {
      return { value: { value: values.get(e.key), version: result.value.version } }
    }
    return result
  })
  on('state.set', { plugin: 'sth-usage' }, async (_, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value?.isSet) values.set(e.key, e.value)
    return result
  })
  on('fs.read', (_, e) => ({
    value: e.as === 'bytes' ? { base64: PNG } : JSON.stringify({ providers: [{ id: 'github' }] }),
  }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    return {
      value: {
        exitCode: 0,
        stdout: e.argv[1] === 'status' ? '[]' : '{}',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/project' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.blit', async (_, e) => {
    blits.push(e)
    return { value: await respondToBlit(e) }
  })
  return { calls, values, clock, blits, setBlitResponse: (response: typeof respondToBlit) => { respondToBlit = response } }
}

function fikaEnvironment(on: On, initialMessages: SessionMessage[] = [], initialDraft = '', variables: Readonly<Record<string, string>> = {}, imageDenial?: string) {
  const environment = stubEnvironment(on, true, variables, imageDenial)
  let draft = initialDraft
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: {
    startedAt: environment.clock.now(), context: { window: 200_000 }, rateLimits: [],
  } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.messages', () => ({ value: initialMessages }))
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_, e) => {
    draft = e.text
    return { isFilled: true, text: draft, cursor: draft.length }
  })
  // Exercise submission hooks without starting a model turn in the test.
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return environment
}

describe('Fika prompt eligibility', () => {
  test('real prompts count, while commands, command output and tool results do not', () => {
    for (const text of ['', '   ', '/sth-usage', '  /reload-plugins\n']) {
      expect(isPromptText(text)).toBe(false)
    }
    expect(isPromptText('  Explique ce projet  ')).toBe(true)
    expect(isPromptText('Comment utiliser /sth-usage ?')).toBe(true)
    const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
    for (const text of [
      '/sth-usage',
      '<command-name>/reload-plugins</command-name>',
      '<command-message>sth-usage</command-message>',
      '<local-command-stdout>Plugins rechargés.</local-command-stdout>',
      '<local-command-stderr>Commande inconnue.</local-command-stderr>',
      '<local-command-caveat>Messages produits localement.</local-command-caveat>',
    ]) {
      expect(isUserPrompt(user(text))).toBe(false)
    }
    expect(isUserPrompt({ role: 'assistant', text: 'Bonjour', toolUses: [] })).toBe(false)
    expect(isUserPrompt({ ...user('Résultat du shell'), toolResults: [
      { tool_use_id: 'call-1', text: 'Résultat du shell', isError: false },
    ] })).toBe(false)
    expect(isUserPrompt(user('Peux-tu ouvrir le dashboard ?'))).toBe(true)
  })
})

for (const surface of SURFACES) {
  describe(`Buddy Fika on ${surface}`, () => {
    test('preview shows the thought after two seconds and typing still dismisses it permanently', async ($, on) => {
      const { clock, values } = fikaEnvironment(on, [], '', { STH_FIKA_PREVIEW: '1' })
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      const mount = () => $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      await clock.advance(1_999)
      let buddy = await mount()
      await expectBuddyVisible(buddy)
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await buddy.unmount()
      await clock.advance(1)
      buddy = await mount()
      await expectBuddyVisible(buddy)
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeDefined()
      await $.prompt.fill({ text: 'Bonjour Buddy', mode: 'replace', origin: { kind: 'plugin', name: 'test' } })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await expectBuddyVisible(buddy)
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false })
      await $.prompt.fill({ text: '', mode: 'replace', origin: { kind: 'plugin', name: 'test' } })
      await clock.advance(2_000)
      await buddy.redraw()
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await buddy.unmount()
    })

    test('reloading during Fika resumes its pose and preserves the original end time', async ($, on) => {
      const { clock, blits } = fikaEnvironment(on, [], '', { STH_FIKA_PREVIEW: '1' })
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await clock.advance(2_000)
      const mount = () => $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      let buddy = await mount()
      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      await clock.advance(3_000)
      await buddy.unmount()
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      buddy = await mount()
      await expectOnlyBuddyPose(buddy, 'fika', 90)
      blits.length = 0
      await clock.advance(surface === 'terminal' ? 67 : 34)
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses.length).toBeGreaterThan(0)
        expect(poses[poses.length - 1]).toMatchObject({ key: expect.stringContaining('buddy-raster-fika-') })
        expectRasterBlit(poses[poses.length - 1], terminalFika[Math.floor(92 * FIKA_RASTER_FPS / 30)], FIKA_COLUMNS, FIKA_ROWS)
      } else {
        await buddy.advance(34)
        await expectOnlyBuddyPose(buddy, 'fika', 91)
      }
      await clock.advance(surface === 'terminal' ? 5_932 : 5_965)
      expect(await buddy.find({ type: 'Text', text: 'Fika in Stockholm' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeUndefined()
      await clock.advance(1)
      await expectOnlyBuddyPose(buddy, 'noConfig')
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeDefined()
      expect(await findFikaClient(buddy)).toBeUndefined()
      await buddy.unmount()
    })

    test('thought appears only in Buddy and plays one nine-second animation from the start on each click', async ($, on) => {
      const { clock, blits } = fikaEnvironment(on)
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      const mount = (requestId: string) => $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId,
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      let buddy = await mount('sth-usage')
      await expectBuddyVisible(buddy)
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await buddy.unmount()
      await clock.advance(119_999)
      buddy = await mount('sth-usage')
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await buddy.unmount()
      await clock.advance(1)
      buddy = await mount('sth-usage')
      await expectBuddyVisible(buddy)
      expect(await buddy.find({ type: 'Box', key: 'buddy-fika' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeDefined()
      const skills = await mount('sth-skills')
      expect(await skills.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(await skills.find({ text: 'Fika?' })).toBeUndefined()

      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      const firstPlaybackKey = (await findFikaClient(buddy))?.key
      if (surface === 'desktop') expect(firstPlaybackKey).toBeDefined()
      expect(await buddy.find({ type: 'Text', text: 'Fika in Stockholm' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeUndefined()
      expect(await skills.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(await findFikaClient(skills)).toBeUndefined()
      expect(await skills.find({ text: 'Fika in Stockholm' })).toBeUndefined()
      if (surface === 'terminal') {
        await clock.settle()
        expect(await skills.find({ type: 'Raster' })).toBeDefined()
      } else {
        expect(await skills.find({ type: 'Client', key: 'buddy-ok' })).toBeDefined()
      }
      await skills.unmount()

      blits.length = 0
      await clock.advance(surface === 'terminal' ? 67 : 34)
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses.length).toBeGreaterThan(0)
        expect(poses[poses.length - 1]).toMatchObject({ key: expect.stringContaining('buddy-raster-fika-') })
        expectRasterBlit(poses[poses.length - 1], terminalFika[1], FIKA_COLUMNS, FIKA_ROWS)
      } else {
        await buddy.advance(34)
        await expectOnlyBuddyPose(buddy, 'fika', 1)
      }

      blits.length = 0
      await clock.advance(surface === 'terminal' ? 8_932 : 8_965)
      expect(await buddy.find({ type: 'Text', text: 'Fika in Stockholm' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeUndefined()
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses[poses.length - 1]).toMatchObject({ key: expect.stringContaining('buddy-raster-fika-') })
        expectRasterBlit(poses[poses.length - 1], terminalFika[terminalFika.length - 1], FIKA_COLUMNS, FIKA_ROWS)
      } else {
        await buddy.advance(8_933)
        await expectOnlyBuddyPose(buddy, 'fika', 269)
        await buddy.advance(50)
        await expectOnlyBuddyPose(buddy, 'fika', 269)
      }
      await clock.advance(1)
      await expectOnlyBuddyPose(buddy, 'noConfig')
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeDefined()
      expect(await buddy.find({ key: 'fika-scene' })).toBeUndefined()
      expect(await findFikaClient(buddy)).toBeUndefined()
      expect(await buddy.find({ text: 'Fika in Stockholm' })).toBeUndefined()

      await clock.advance(150)
      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      if (surface === 'desktop') {
        const replayKey = (await findFikaClient(buddy))?.key
        expect(replayKey).toBeDefined()
        expect(replayKey).not.toBe(firstPlaybackKey)
        await buddy.advance(34)
        await expectOnlyBuddyPose(buddy, 'fika', 1)
      }
      await buddy.unmount()
    })

    test('resumed user history or a real draft prevents the thought', async ($, on) => {
      const { clock, values } = fikaEnvironment(on, [
        { role: 'user', text: 'Explique ce projet', toolUses: [] },
      ])
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await clock.advance(120_000)
      const buddy = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      await buddy.unmount()
    })

    test('typing removes the thought permanently through erasing and reloading', async ($, on) => {
      const { clock, values } = fikaEnvironment(on)
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await clock.advance(120_000)
      const buddy = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeDefined()
      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      await $.prompt.fill({ text: 'Bonjour Buddy', mode: 'replace', origin: { kind: 'plugin', name: 'test' } })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(await findFikaClient(buddy)).toBeUndefined()
      await expectOnlyBuddyPose(buddy, 'noConfig')
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false, playingUntil: null })
      await $.prompt.fill({ text: '', mode: 'replace', origin: { kind: 'plugin', name: 'test' } })
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await clock.advance(120_000)
      await buddy.redraw()
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false })
      await buddy.unmount()
    })

    test('slash commands leave the thought eligible but submitting a prompt dismisses it', async ($, on) => {
      const { clock, values } = fikaEnvironment(on, [
        { role: 'user', text: '<command-name>/reload-plugins</command-name>', toolUses: [] },
        { role: 'user', text: '<local-command-stdout>Rechargé.</local-command-stdout>', toolUses: [] },
      ], '/sth-usage')
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await $.prompt.fill({ text: '/sth-skills', mode: 'replace', origin: { kind: 'plugin', name: 'test' } })
      await $.prompt.submit({ text: '/sth-usage', wait: false, origin: { kind: 'composer' } })
      await clock.advance(120_000)
      const buddy = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      expect(values.get('fika')).toMatchObject({ hasPrompt: false, ready: true })
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeDefined()
      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      await $.prompt.submit({ text: 'Analyse ce projet', wait: false, origin: { kind: 'composer' } })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(await findFikaClient(buddy)).toBeUndefined()
      await expectOnlyBuddyPose(buddy, 'noConfig')
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false, playingUntil: null })
      await buddy.unmount()
    })

    test('an already written draft prevents the thought before it is submitted', async ($, on) => {
      const { clock, values } = fikaEnvironment(on, [], 'Bonjour')
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      await clock.advance(120_000)
      const buddy = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })
      expect(await buddy.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(values.get('fika')).toMatchObject({ hasPrompt: true, ready: false })
      await buddy.unmount()
    })
  })
}

for (const surface of SURFACES) {
  describe(`STH UI on ${surface}`, () => {
    test('initialisation preserves the selected targets and advanced fields', async ($, on) => {
      const { calls, values } = stubEnvironment(on, false)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills',
        props: paneProps(32), viewport: { columns: 180, rows: 50 },
      })

      expect(await ui.find({ type: 'Input', key: 'init-ref' })).toBeUndefined()
      expect(await ui.find({ type: 'Input', key: 'init-catalog' })).toBeUndefined()
      await ui.select({ key: 'init-provider', value: 'gitlab' })
      await ui.select({ key: 'init-access', value: 'private' })
      await ui.input({ key: 'init-repository', text: 'team/catalog', kind: 'change' })
      await ui.press({ key: 'target-codex' })
      await ui.press({ key: 'init-advanced' })
      await ui.input({ key: 'init-ref', text: 'develop', kind: 'change' })
      await ui.input({ key: 'init-catalog', text: 'catalog/SKILLS.md', kind: 'change' })
      await ui.press({ key: 'init-advanced' })

      expect(await ui.find({ key: 'init-ref' })).toBeUndefined()
      await ui.press({ key: 'init-advanced' })
      expect((await ui.find({ key: 'init-ref' }))?.props.value).toBe('develop')
      expect((await ui.find({ key: 'init-catalog' }))?.props.value).toBe('catalog/SKILLS.md')
      expect(values.get('initDraft')).toMatchObject({
        provider: 'gitlab', repository: 'team/catalog', isPrivate: true,
        ref: 'develop', catalogPath: 'catalog/SKILLS.md', targets: ['claude', 'codex'],
      })

      await ui.press({ key: 'target-codex' })
      expect(values.get('initDraft')).toMatchObject({
        targets: ['claude'],
      })
      expect(calls).toHaveLength(0)
      await ui.unmount()
    })

    test('catalogue filters descriptions and switching back shows installed skills', async ($, on) => {
      const { calls } = stubEnvironment(on, true)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills',
        props: paneProps(64), viewport: { columns: 180, rows: 50 },
      })

      expect(await ui.find({ key: `remove-github-${RESOURCE}` })).toBeDefined()
      await ui.press({ key: 'tab-catalog' })
      expect(await ui.find({ key: `remove-github-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: 'install-github-team::guides/typescript' })).toBeDefined()
      expect(await ui.find({ key: 'install-github-team::guides/accessibility' })).toBeDefined()
      await ui.input({ key: 'filter', text: 'clavier', kind: 'change' })
      expect(await ui.find({ key: 'install-github-team::guides/typescript' })).toBeUndefined()
      expect(await ui.find({ key: 'install-github-team::guides/accessibility' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Des composants utilisables au clavier\./ })).toBeDefined()

      await ui.press({ key: 'tab-installed' })
      expect(await ui.find({ key: `remove-github-${RESOURCE}` })).toBeDefined()
      expect(await ui.find({ key: 'filter' })).toBeUndefined()
      await ui.press({ key: 'tab-catalog' })
      expect((await ui.find({ key: 'filter' }))?.props.value).toBe('clavier')
      expect(calls).toHaveLength(0)
      await ui.unmount()
    })

    test('removal only invokes STH after confirmation and can be cancelled', async ($, on) => {
      const { calls } = stubEnvironment(on, true)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills',
        props: paneProps(32), viewport: { columns: 180, rows: 50 },
      })

      await ui.press({ key: `remove-github-${RESOURCE}` })
      expect(await ui.find({ key: `confirm-github-${RESOURCE}` })).toBeDefined()
      expect(calls).toHaveLength(0)
      await ui.press({ key: `cancel-github-${RESOURCE}` })
      expect(await ui.find({ key: `confirm-github-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: `remove-github-${RESOURCE}` })).toBeDefined()
      expect(calls).toHaveLength(0)

      await ui.press({ key: `remove-github-${RESOURCE}` })
      await ui.press({ key: `confirm-github-${RESOURCE}` })
      expect(calls.map(argv => argv.slice(1))).toEqual([
        ['remove', RESOURCE, '--provider', 'github', '--yes', '--json'],
        ['status', '--json'],
      ])
      expect(await ui.find({ key: `remove-github-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: `confirm-github-${RESOURCE}` })).toBeUndefined()
      await ui.unmount()
    })

    test('usage measures stay single and readable in a narrow right pane', async ($, on) => {
      const { values } = stubEnvironment(on, true)
      values.set('snapshot', {
        limits: [{ kind: 'five_hour', percentUsed: 80 }], costUsd: 0.125,
      })
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(20), viewport: { columns: 180, rows: 50 },
      })

      const quota = await ui.find({ key: 'status-quota-five_hour' })
      expect(quota?.text).toContain('5 h 80 %')
      expect(await ui.findAll({ key: 'status-quota-five_hour' })).toHaveLength(1)
      expect(await ui.findAll({ key: 'workflow-actions' })).toHaveLength(1)
      expect(await ui.find({ key: 'open-doctor' })).toBeUndefined()
      expect(await ui.find({ key: 'open-resume' })).toBeUndefined()
      await ui.redraw(paneProps(64))
      expect(await ui.findAll({ key: 'status-quota-five_hour' })).toHaveLength(1)
      if (surface === 'desktop') {
        const pills = (await ui.findAll({ type: 'Svg' })).filter(image => String(image.props.alt).includes('80 % used'))
        expect(pills).toHaveLength(1)
        expect(pills[0]!.props.width).toBeLessThanOrEqual(180)
      } else {
        expect((await ui.find({ key: 'status-quota-five_hour' }))?.text).toContain('5 h 80 %')
      }
      await ui.unmount()
    })
  })
}
