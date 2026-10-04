import type { AgentInfo, On, RenderPropsOf, SessionUsage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { contextCaption, quotaCaption, statusPills } from '../hooks/context'
import type { ContextView } from '../hooks/context'
import { pillSvg, remainingTime, windowElapsed } from '../hooks/usage-pills'

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const NO_CONTEXT: ContextView = { context: null, limits: null, agents: null, error: null, refreshedAt: null }

function bandProps(hasSurvey = false): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey, isWorking: false, maxRows: 12, bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 12 }, view: {},
  }
}

function paneProps(): RenderPropsOf['Pane'] {
  return {
    title: 'Buddy · Context', isFocused: true, bodyColumns: 70,
    placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {},
  }
}

const USAGE: SessionUsage = {
  startedAt: 1000,
  context: {
    tokens: 40_000, window: 200_000, percent: 20,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 1000, color: 'promptBorder', kind: 'used', isDeferred: false },
        { name: 'System tools', tokens: 3000, color: 'promptBorder', kind: 'used', isDeferred: false },
        { name: 'MCP tools', tokens: 1000, color: 'promptBorder', kind: 'used', isDeferred: false },
        { name: 'Messages', tokens: 38_000, color: 'promptBorder', kind: 'used', isDeferred: false },
        { name: 'Free space', tokens: 100_000, color: 'inactive', kind: 'free', isDeferred: false },
      ],
      totalTokens: 43_000, maxTokens: 180_000, rawMaxTokens: 180_000,
      autocompactSource: 'auto', percentage: 24, gridRows: [], model: 'Sonnet',
      memoryFiles: [{ path: '/project/CLAUDE.md', type: 'Project', tokens: 300 }],
      mcpTools: [
        { name: 'mcp__sth__list', serverName: 'sth', tokens: 1000, isLoaded: true },
        { name: 'mcp__sth__save', serverName: 'sth', tokens: 500, isLoaded: false },
      ],
      agents: [], isAutoCompactEnabled: true, autoCompactThreshold: 170_000, apiUsage: null,
    },
  },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23.5 }],
}

const AGENTS: AgentInfo[] = [
  { id: 'a', type: 'Explore', description: 'Inspect the project', status: 'running' },
  { id: 'b', type: 'Review', description: 'Waiting for permission', status: 'waiting' },
  { id: 'c', type: 'Test', description: 'Tests finished', status: 'completed' },
]

function environment(on: On, initial: ContextView | null = null, usage = USAGE) {
  const clock = mock.clock(on, { now: 2000 })
  const values = new Map<string, unknown>(initial ? [['contextView', initial]] : [])
  const requests: string[] = []
  const panes: string[] = []
  let unavailable = false
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
  on('session.usage', (_, e) => {
    requests.push(e.breakdown ?? 'none')
    if (unavailable && e.breakdown === 'summary') return { deny: 'Reading unavailable' }
    return { value: usage }
  })
  on('agent.list', () => ({ value: AGENTS }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['Native composer interface'] }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { values, requests, panes, clock, unavailable: () => { unavailable = true } }
}

describe('Context reading availability', () => {
  test('missing readings stay unavailable and real zero stays visible', () => {
    expect(contextCaption(null)).toBe('Context unavailable')
    expect(contextCaption({ window: 200_000 })).toBe('Context unavailable')
    expect(contextCaption({ window: 200_000, tokens: 0, percent: 0 })).toBe('Context 0/200.0k · 0 %')
    expect(quotaCaption(null)).toBe('Quota unavailable')
    expect(quotaCaption([])).toBe('Quota unavailable')
    expect(quotaCaption([{ kind: 'five_hour', percentUsed: 110 }])).toBe('5 h 0 % remaining')
  })

  test('pills omit unknown readings but retain measured zero context, quota, cost and agents', () => {
    expect(statusPills(NO_CONTEXT, NO_TOKENS, null, 2000)).toEqual([])
    const pills = statusPills({ ...NO_CONTEXT,
      context: { window: 200_000, tokens: 0, percent: 0 },
      limits: [{ kind: 'five_hour', percentUsed: 0 }], agents: [],
    }, NO_TOKENS, 0, 2000)
    expect(pills.map(pill => pill.key)).toEqual(['quota-five_hour', 'context', 'cost', 'agents'])
    expect(pills.find(pill => pill.key === 'quota-five_hour')).toMatchObject({ value: '0 %', percent: 0 })
    expect(pills.find(pill => pill.key === 'context')).toMatchObject({ value: '0 %', percent: 0 })
    expect(pills.find(pill => pill.key === 'cost')?.value).toBe('$0.000')
    expect(pills.find(pill => pill.key === 'agents')?.value).toBe('0')
  })

  test('observed input includes cache writes and stays distinct from cache reads and context', () => {
    const pills = statusPills({ ...NO_CONTEXT, context: USAGE.context },
      { input: 100, cacheWrite: 900, output: 200, cacheRead: 8000 }, null, 2000)
    expect(pills.find(pill => pill.key === 'tokens-input')).toMatchObject({ value: '~1.0k' })
    expect(pills.find(pill => pill.key === 'tokens-input')?.detail).toContain('100 uncached tokens + 900 cache write tokens')
    expect(pills.find(pill => pill.key === 'tokens-output')?.value).toBe('~200')
    expect(pills.find(pill => pill.key === 'tokens-cache')?.value).toBe('~8.0k')
    expect(pills.find(pill => pill.key === 'context')?.value).toBe('20 %')
    expect(pills.find(pill => pill.key === 'tokens-input')?.detail).toContain('earlier history may be missing')
  })

  test('invalid quota readings and reset timestamps cannot produce a fabricated countdown or NaN', () => {
    const pills = statusPills({ ...NO_CONTEXT, limits: [
      { kind: 'five_hour', percentUsed: 25, resetsAt: 'invalid-date' },
      { kind: 'seven_day', percentUsed: Number.NaN },
      { kind: 'seven_day_opus', percentUsed: Number.POSITIVE_INFINITY },
      { kind: 'seven_day_sonnet', percentUsed: -1 },
    ] }, NO_TOKENS, Number.NaN, 2000)
    expect(pills).toHaveLength(1)
    expect(pills[0]).toMatchObject({ key: 'quota-five_hour', value: '25 %' })
    expect(pills[0]?.elapsed).toBeUndefined()
    expect(pills[0]?.detail).not.toContain('Reset')
    expect(JSON.stringify(pills)).not.toContain('NaN')
    expect(remainingTime('invalid-date', 2000)).toBe('')
    expect(remainingTime('2026-10-04T12:00:00.000Z', Number.NaN)).toBe('')
    expect(windowElapsed('five_hour', 'invalid-date', 2000)).toBeUndefined()
    expect(windowElapsed('spend_limit', '2026-10-04T12:00:00.000Z', 2000)).toBeUndefined()
  })

  test('SVG titles and labels escape external names without inserting markup', () => {
    const { source } = pillSvg({ key: 'external', label: 'A&B <x>', value: '1 < 2',
      detail: 'Quota "team" <script>&\'test\'', tone: 'neutral', percent: Number.NaN, elapsed: Number.NaN })
    expect(source).toContain('<title>Quota &quot;team&quot; &lt;script&gt;&amp;&apos;test&apos;</title>')
    expect(source).toContain('A&amp;B &lt;x&gt;')
    expect(source).toContain('1 &lt; 2')
    expect(source).not.toContain('<script>')
    expect(source).not.toContain('NaN')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`Context pane on ${surface}`, () => {
    test('leaves the original composer surface unchanged, including during surveys', async ($, on) => {
      const { requests } = environment(on)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'AbovePrompt', requestId: 'above', props: bandProps(),
      })
      expect(await ui.find({ type: 'Text', text: 'Native composer interface' })).toBeDefined()
      expect(await ui.find({ key: 'context-open' })).toBeUndefined()
      expect(await ui.find({ key: 'context-status' })).toBeUndefined()
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
      expect(requests).toHaveLength(0)
      await ui.redraw(bandProps(true))
      expect(await ui.find({ type: 'Text', text: 'Native composer interface' })).toBeDefined()
      expect(await ui.find({ key: 'context-open' })).toBeUndefined()
      await ui.unmount()
    })

    test('opens the real summary and counts running and waiting agents without completed agents', async ($, on) => {
      const { requests, panes } = environment(on)
      await $.command.run({
        command: 'sth-context', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 },
      })
      expect(panes).toEqual(['sth-context'])
      expect(requests).toEqual(['summary'])
      const pane = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-context', props: paneProps(),
      })
      expect(await pane.find({ type: 'Text', text: 'System prompt' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'System tools' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Messages' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /sth · 1\/2 tools loaded · 1.0k tokens/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /CLAUDE.md/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Remaining quotas' })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: 'Active agents · 2' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Explore · running · Inspect the project' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Review · waiting · Waiting for permission' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Tests finished/ })).toBeUndefined()
      await pane.redraw(paneProps())
      expect(requests).toEqual(['summary'])
      await pane.unmount()
    })

    test('the 30-second timer refreshes reset countdowns without another usage reading', async ($, on) => {
      const { clock, requests } = environment(on, null, { ...USAGE,
        rateLimits: [{ kind: 'five_hour', percentUsed: 25, resetsAt: new Date(92_000).toISOString() }],
      })
      mock.env(on, {})
      on('session.start', (_, e) => ({ cwd: e.cwd }))
      on('command.register', (_, e) => ({ value: { command: e.name } }))
      on('session.root', () => ({ value: '/project' }))
      on('session.cwd', () => ({ value: '/project' }))
      on('session.messages', () => ({ value: [{ role: 'user', text: 'Session in progress', toolUses: [] }] }))
      on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
      on('fs.read', () => ({ deny: 'ENOENT: no such file' }))
      on('fs.list', () => ({ value: [] }))
      on('process.run', () => ({ deny: 'ENOENT: executable not found' }))
      on('tool.list', () => ({ value: [] }))
      await $.session.start({ cwd: '/project', surface, isInteractive: true })
      const home = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps(),
      })
      const before = await home.find({ key: 'status-quota-five_hour' })
      if (surface === 'desktop') expect((await home.findAll({ type: 'Svg' })).some(image => String(image.props.alt).includes('Resets in 2m'))).toBe(true)
      else expect(before?.text).toContain('2m')
      const previousRequests = [...requests]
      expect(previousRequests.filter(request => request === 'summary')).toHaveLength(1)
      await clock.advance(30_000)
      const after = await home.find({ key: 'status-quota-five_hour' })
      if (surface === 'desktop') expect((await home.findAll({ type: 'Svg' })).some(image => String(image.props.alt).includes('Resets in 1m'))).toBe(true)
      else expect(after?.text).toContain('1m')
      expect(requests).toEqual(previousRequests)
      await home.unmount()
    })

    test('retains categories during quota-only measurements without re-counting context', async ($, on) => {
      const { requests, values } = environment(on, {
        context: USAGE.context, limits: USAGE.rateLimits, agents: AGENTS, error: null, refreshedAt: 2000,
      })
      await $.session.measure({
        context: { tokens: 40_000, window: 200_000, percent: 20 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 80 }], changed: ['rateLimits'],
      })
      expect(requests.filter(request => request === 'summary')).toHaveLength(0)
      expect(values.get('contextView')).toMatchObject({
        context: { breakdown: { model: 'Sonnet' } }, limits: [{ kind: 'five_hour', percentUsed: 80 }],
      })
      const pane = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-context', props: paneProps(),
      })
      expect(await pane.find({ type: 'Text', text: 'System prompt' })).toBeDefined()
      await pane.unmount()
    })

    test('clears stale readings when a summary becomes unavailable', async ($, on) => {
      const { values, unavailable } = environment(on, {
        context: USAGE.context, limits: USAGE.rateLimits, agents: AGENTS, error: null, refreshedAt: 2000,
      })
      unavailable()
      const pane = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-context', props: paneProps(),
      })
      await pane.press({ key: 'context-refresh' })
      expect(values.get('contextView')).toMatchObject({ context: null, limits: null, refreshedAt: null })
      expect(await pane.find({ type: 'Text', text: 'Context unavailable' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Context reading is unavailable/ })).toBeDefined()
      await pane.unmount()
    })
  })
}
