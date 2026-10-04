import type { AgentInfo, On, RenderPropsOf, SessionUsage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { contextCaption, quotaCaption } from '../hooks/context'
import type { ContextView } from '../hooks/context'

function bandProps(hasSurvey = false): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey, isWorking: false, maxRows: 12, bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 12 }, view: {},
  }
}

function paneProps(): RenderPropsOf['Pane'] {
  return {
    title: 'Buddy · Contexte', isFocused: true, bodyColumns: 70,
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
  { id: 'a', type: 'Explore', description: 'Inspecte le projet', status: 'running' },
  { id: 'b', type: 'Review', description: 'Attend une permission', status: 'waiting' },
  { id: 'c', type: 'Test', description: 'Tests finis', status: 'completed' },
]

function environment(on: On, initial: ContextView | null = null) {
  mock.clock(on, { now: 2000 })
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
    return { value: USAGE }
  })
  on('agent.list', () => ({ value: AGENTS }))
  on('ui.open', (_, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { values, requests, panes, unavailable: () => { unavailable = true } }
}

describe('Context reading availability', () => {
  test('missing readings stay unavailable and real zero stays visible', () => {
    expect(contextCaption(null)).toBe('Contexte indisponible')
    expect(contextCaption({ window: 200_000 })).toBe('Contexte indisponible')
    expect(contextCaption({ window: 200_000, tokens: 0, percent: 0 })).toBe('Contexte 0/200.0k · 0 %')
    expect(quotaCaption(null)).toBe('Quota indisponible')
    expect(quotaCaption([])).toBe('Quota indisponible')
    expect(quotaCaption([{ kind: 'five_hour', percentUsed: 110 }])).toBe('5 h 0 % restants')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`Context bar on ${surface}`, () => {
    test('shows unavailable readings before a first measurement and yields to a survey', async ($, on) => {
      const { requests } = environment(on)
      const ui = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'AbovePrompt', requestId: 'above', props: bandProps(),
      })
      const button = await ui.find({ key: 'context-open' })
      expect(button?.props.label).toContain('Contexte indisponible')
      expect(button?.props.label).toContain('Quota indisponible')
      expect(button?.props.label).toContain('Agents indisponibles')
      expect(requests).toHaveLength(0)
      await ui.redraw(bandProps(true))
      expect(await ui.find({ key: 'context-open' })).toBeUndefined()
      await ui.unmount()
    })

    test('opens the real summary and counts running and waiting agents without completed agents', async ($, on) => {
      const { requests, panes } = environment(on)
      const band = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'AbovePrompt', requestId: 'above', props: bandProps(),
      })
      await band.press({ key: 'context-open' })
      expect(panes).toEqual(['sth-context'])
      expect(requests).toEqual(['summary'])
      expect((await band.find({ key: 'context-open' }))?.props.label).toContain('2 agents actifs')
      expect((await band.find({ key: 'context-open' }))?.props.label).toContain('77 % restants')
      const pane = await $.ui.mount({
        plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-context', props: paneProps(),
      })
      expect(await pane.find({ type: 'Text', text: 'System prompt' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'System tools' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Messages' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /sth · 1\/2 tools chargés · 1.0k tokens/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /CLAUDE.md/ })).toBeDefined()
      await pane.redraw(paneProps())
      expect(requests).toEqual(['summary'])
      await pane.unmount()
      await band.unmount()
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
      expect(await pane.find({ type: 'Text', text: 'Contexte indisponible' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Le relevé du contexte est indisponible/ })).toBeDefined()
      await pane.unmount()
    })
  })
}
