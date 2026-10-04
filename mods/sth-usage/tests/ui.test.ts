import type { On, RenderPropsOf, SessionMessage, UiBlitArgs } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { isPromptText, isUserPrompt } from '../hooks/fika'
import type { SkillsView } from '../types'
import ok from '../ui/frames/ok'
import work from '../ui/frames/work'
import done from '../ui/frames/done'
import error from '../ui/frames/error'
import update from '../ui/frames/update'
import noConfig from '../ui/frames/noConfig'
import fika from '../ui/frames/fika/index'
import terminalFika from '../ui/terminal-frames/fika/index'
import terminalNoConfig from '../ui/terminal-frames/noConfig'

const buddyFrames = { ok, work, done, error, update, noConfig }

const SURFACES = ['terminal', 'desktop'] as const
const RESOURCE = 'team::guides/review'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mEAAAAASUVORK5CYII='

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

function expectVisibleRaster(cells: unknown) {
  if (typeof cells !== 'string') throw new Error('Buddy must provide terminal cells')
  const bytes = Uint8Array.from(atob(cells), character => character.charCodeAt(0))
  expect(bytes.length).toBe(24 * 12 * 12)
  const view = new DataView(bytes.buffer)
  let visibleCells = 0
  const colors = new Set<number>()
  for (let offset = 0; offset < bytes.length; offset += 12) {
    if (view.getUint32(offset, true) !== 0x20) visibleCells += 1
    colors.add(view.getUint32(offset + 4, true))
    colors.add(view.getUint32(offset + 8, true))
  }
  expect(visibleCells).toBeGreaterThan(20)
  expect(colors.size).toBeGreaterThan(10)
}

async function expectBuddyVisible(ui: Pick<Mounted<'terminal' | 'desktop', 'Pane'>, 'surface' | 'find' | 'drawn'>) {
  if (ui.surface === 'terminal') {
    const drawing = await ui.find({ type: 'Raster', key: 'buddy' })
    expect(drawing).toBeDefined()
    expect(drawing?.props.columns).toBe(24)
    expect(drawing?.props.rows).toBe(12)
    expectVisibleRaster(drawing?.props.cells)
    expect(await ui.find({ type: 'Image', key: 'buddy' })).toBeUndefined()
  } else {
    const drawing = await ui.drawn({ in: 'buddy-noConfig' })
    expect(drawing.type).toBe('Svg')
    if (drawing.type !== 'Svg') throw new Error('Buddy must remain a visible desktop pose')
    expect(drawing.props.source).toContain('data:image/webp;base64,')
    expect(drawing.props.width).toBe(144)
    expect(drawing.props.height).toBe(144)
  }
}

async function expectOnlyBuddyPose(ui: Mounted<'terminal' | 'desktop', 'Pane'>, state: 'noConfig' | 'fika', frame?: number) {
  expect(await ui.find({ key: 'fika-scene' })).toBeUndefined()
  if (ui.surface === 'terminal') {
    const drawings = await ui.findAll({ type: 'Raster' })
    expect(drawings).toHaveLength(1)
    expect(drawings[0]?.key).toBe('buddy')
    const poses = state === 'fika' ? terminalFika : terminalNoConfig
    if (frame === undefined) expect(poses.includes(drawings[0]?.props.cells as string)).toBe(true)
    else expect(drawings[0]?.props.cells).toBe(poses[frame])
    expectVisibleRaster(drawings[0]?.props.cells)
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

async function findFikaClient(ui: Mounted<'terminal' | 'desktop', 'Pane'>) {
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

function stubEnvironment(on: On, isLinked: boolean) {
  const calls: string[][] = []
  const blits: UiBlitArgs[] = []
  const values = new Map<string, unknown>([['skills', skillsView(isLinked)]])
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.blit', (_, e) => {
    blits.push(e)
    return { value: {} }
  })
  return { calls, values, clock, blits }
}

function fikaEnvironment(on: On, initialMessages: SessionMessage[] = [], initialDraft = '', variables: Readonly<Record<string, string>> = {}) {
  const environment = stubEnvironment(on, true)
  mock.env(on, variables)
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
      await clock.advance(34)
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses.length).toBeGreaterThan(0)
        expect(poses[poses.length - 1]).toMatchObject({ key: 'buddy', cells: terminalFika[91] })
      } else {
        await buddy.advance(34)
        await expectOnlyBuddyPose(buddy, 'fika', 91)
      }
      await clock.advance(5_965)
      expect(await buddy.find({ type: 'Text', text: 'Fika à Stockholm' })).toBeDefined()
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
      expect(await skills.find({ text: 'Fika ?' })).toBeUndefined()

      await buddy.press({ key: 'fika' })
      await expectOnlyBuddyPose(buddy, 'fika', 0)
      const firstPlaybackKey = (await findFikaClient(buddy))?.key
      if (surface === 'desktop') expect(firstPlaybackKey).toBeDefined()
      expect(await buddy.find({ type: 'Text', text: 'Fika à Stockholm' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeUndefined()
      expect(await skills.find({ key: 'buddy-fika' })).toBeUndefined()
      expect(await findFikaClient(skills)).toBeUndefined()
      expect(await skills.find({ text: 'Fika à Stockholm' })).toBeUndefined()
      if (surface === 'terminal') {
        expect(await skills.find({ type: 'Raster', key: 'buddy' })).toBeDefined()
      } else {
        expect(await skills.find({ type: 'Client', key: 'buddy-ok' })).toBeDefined()
      }
      await skills.unmount()

      blits.length = 0
      await clock.advance(34)
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses.length).toBeGreaterThan(0)
        expect(poses[poses.length - 1]).toMatchObject({ key: 'buddy', cells: terminalFika[1] })
      } else {
        await buddy.advance(34)
        await expectOnlyBuddyPose(buddy, 'fika', 1)
      }

      blits.length = 0
      await clock.advance(8_965)
      expect(await buddy.find({ type: 'Text', text: 'Fika à Stockholm' })).toBeDefined()
      expect(await buddy.find({ type: 'Button', key: 'fika' })).toBeUndefined()
      if (surface === 'terminal') {
        const poses = blits.filter(blit => blit.requestId === 'sth-usage')
        expect(poses[poses.length - 1]).toMatchObject({ key: 'buddy', cells: terminalFika[269] })
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
      expect(await buddy.find({ text: 'Fika à Stockholm' })).toBeUndefined()

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

      expect(await ui.find({ key: `remove-${RESOURCE}` })).toBeDefined()
      await ui.press({ key: 'tab-catalog' })
      expect(await ui.find({ key: `remove-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: 'install-github-team::guides/typescript' })).toBeDefined()
      expect(await ui.find({ key: 'install-github-team::guides/accessibility' })).toBeDefined()
      await ui.input({ key: 'filter', text: 'clavier', kind: 'change' })
      expect(await ui.find({ key: 'install-github-team::guides/typescript' })).toBeUndefined()
      expect(await ui.find({ key: 'install-github-team::guides/accessibility' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Des composants utilisables au clavier\./ })).toBeDefined()

      await ui.press({ key: 'tab-installed' })
      expect(await ui.find({ key: `remove-${RESOURCE}` })).toBeDefined()
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

      await ui.press({ key: `remove-${RESOURCE}` })
      expect(await ui.find({ key: `confirm-${RESOURCE}` })).toBeDefined()
      expect(calls).toHaveLength(0)
      await ui.press({ key: `cancel-${RESOURCE}` })
      expect(await ui.find({ key: `confirm-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: `remove-${RESOURCE}` })).toBeDefined()
      expect(calls).toHaveLength(0)

      await ui.press({ key: `remove-${RESOURCE}` })
      await ui.press({ key: `confirm-${RESOURCE}` })
      expect(calls.map(argv => argv.slice(1))).toEqual([
        ['remove', RESOURCE, '--provider', 'github', '--json'],
        ['status', '--json'],
      ])
      expect(await ui.find({ key: `remove-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: `confirm-${RESOURCE}` })).toBeUndefined()
      await ui.unmount()
    })

    test('usage bars fit the pane independently of the wider viewport', async ($, on) => {
      const { values } = stubEnvironment(on, true)
      values.set('snapshot', {
        limits: [{ kind: 'five_hour', percentUsed: 80 }], costUsd: 0.125,
      })
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage',
        props: paneProps(20), viewport: { columns: 180, rows: 50 },
      })

      const narrowBars = await ui.findAll({ type: 'Text', text: /^[█░]+$/ })
      expect(narrowBars).toHaveLength(1)
      expect(narrowBars[0]!.text.length).toBeLessThanOrEqual(20)
      await ui.redraw(paneProps(64))
      const wideBars = await ui.findAll({ type: 'Text', text: /^[█░]+$/ })
      expect(wideBars).toHaveLength(1)
      expect(wideBars[0]!.text.length).toBeGreaterThan(narrowBars[0]!.text.length)
      await ui.unmount()
    })
  })
}
