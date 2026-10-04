import { atom, read, update } from 'claude-code'
import type { AgentInfo, ElementTable, EngineInterface, On, Register, RenderInput, SessionContextUsage, SessionRateLimit, Timer } from 'claude-code'
import { panelChrome, paneNavigation } from './presentation'
import { pillSvg, remainingTime, windowElapsed } from './usage-pills'
import type { UsagePill } from './usage-pills'
import type { TokenTotals } from '../types'

const CONTEXT_PANE = 'sth-context'

export type ContextView = {
  context: SessionContextUsage | null
  limits: SessionRateLimit[] | null
  agents: AgentInfo[] | null
  error: string | null
  refreshedAt: number | null
}

export const EMPTY_CONTEXT: ContextView = {
  context: null, limits: null, agents: null, error: null, refreshedAt: null,
}

const contextView = atom({ plugin: 'sth-usage', key: 'contextView' } as const, EMPTY_CONTEXT)

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 h', seven_day: '7 d', seven_day_opus: 'Opus 7 d',
  seven_day_sonnet: 'Sonnet 7 d', spend_limit: 'Budget',
}

const ACTIVE_STATES = ['pending', 'running', 'waiting']

function availableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function activeAgents(view: ContextView): AgentInfo[] | null {
  return view.agents?.filter(agent => ACTIVE_STATES.includes(agent.status)) ?? null
}

export function contextCaption(context: SessionContextUsage | null): string {
  if (!context || !availableNumber(context.tokens)) return 'Context unavailable'
  const window = availableNumber(context.window) && context.window > 0 ? context.window : null
  const percent = availableNumber(context.percent) ? context.percent
    : window === null ? null : context.tokens / window * 100
  const fill = window === null ? compact(context.tokens) : `${compact(context.tokens)}/${compact(window)}`
  return `Context ${fill}${percent === null ? '' : ` · ${Math.round(percent)} %`}`
}

export function quotaCaption(limits: SessionRateLimit[] | null): string {
  const known = limits?.filter(limit => availableNumber(limit.percentUsed)) ?? []
  if (known.length === 0) return 'Quota unavailable'
  return known.map(limit => `${WINDOW_LABELS[limit.kind] ?? limit.kind} ${Math.round(Math.max(0, 100 - limit.percentUsed))} % remaining`).join(' · ')
}

export function statusPills(view: ContextView, totals: TokenTotals, costUsd: number | null, now: number): UsagePill[] {
  const pills: UsagePill[] = []
  for (const limit of view.limits ?? []) {
    if (!availableNumber(limit.percentUsed)) continue
    const reset = remainingTime(limit.resetsAt, now)
    const label = WINDOW_LABELS[limit.kind] ?? limit.kind
    pills.push({
      key: `quota-${limit.kind}`, label, value: `${Math.round(limit.percentUsed)} %${reset ? ` · ${reset}` : ''}`,
      detail: `${label}: ${limit.percentUsed} % used, ${Math.round(Math.max(0, 100 - limit.percentUsed))} % remaining.${reset ? ` Resets in ${reset}. The marker shows elapsed time in this window.` : ''}`,
      tone: 'neutral', percent: limit.percentUsed,
      elapsed: windowElapsed(limit.kind, limit.resetsAt, now),
    })
  }
  if (availableNumber(view.context?.tokens)) {
    const context = view.context!
    const percent = availableNumber(context.percent) ? context.percent
      : context.window > 0 ? context.tokens! / context.window * 100 : undefined
    pills.push({ key: 'context', label: 'Context', value: percent === undefined ? compact(context.tokens!) : `${Math.round(percent)} %`,
      detail: `${contextCaption(context)}. Model context window usage, separate from cumulative tokens.`, tone: 'neutral', percent })
  }
  if ([totals.input, totals.output, totals.cacheRead, totals.cacheWrite].some(value => value > 0)) {
    const source = 'Total responses observed since the mod loaded; earlier history may be missing.'
    pills.push(
      { key: 'tokens-input', label: '↑ Input', value: `~${compact(totals.input + totals.cacheWrite)}`, detail: `Input: ${totals.input} uncached tokens + ${totals.cacheWrite} cache write tokens. ${source}`, tone: 'neutral' },
      { key: 'tokens-output', label: '↓ Output', value: `~${compact(totals.output)}`, detail: `Output: ${totals.output} tokens. ${source}`, tone: 'neutral' },
      { key: 'tokens-cache', label: 'Cache', value: `~${compact(totals.cacheRead)}`, detail: `Cache read: ${totals.cacheRead} tokens. ${source}`, tone: 'neutral' },
    )
  }
  if (availableNumber(costUsd)) pills.push({ key: 'cost', label: 'Cost', value: `$${costUsd.toFixed(costUsd < 1 ? 3 : 2)}`,
    detail: 'Session cost reported by Claude at API rates. This amount is not an additional charge on your subscription.', tone: 'neutral' })
  const agents = activeAgents(view)
  if (agents !== null) pills.push({ key: 'agents', label: 'Agents', value: String(agents.length),
    detail: `${agents.length} active agent${agents.length === 1 ? '' : 's'} (running or waiting).`, tone: 'neutral' })
  return pills
}

export function usagePillElement(elements: ElementTable, e: RenderInput<'Pane'>, pill: UsagePill) {
  const { Box, Text } = elements
  const compactPill = e.props.bodyColumns < 70
  if (e.surface === 'desktop' && 'Svg' in elements && e.props.bodyColumns >= 24) {
    const { Svg } = elements
    return <Box key={`status-${pill.key}`} flexShrink={0}>
      <Svg {...pillSvg(pill, compactPill)} alt={pill.detail} isInteractive />
    </Box>
  }
  const progress = pill.percent === undefined || !Number.isFinite(pill.percent) || compactPill ? ''
    : ' ' + '━'.repeat(Math.round(Math.min(100, Math.max(0, pill.percent)) / 25)) + '─'.repeat(4 - Math.round(Math.min(100, Math.max(0, pill.percent)) / 25))
  return <Box key={`status-${pill.key}`} flexShrink={1} minWidth={0}>
    <Text><Text dimColor>{`${pill.label} `}</Text><Text bold>{pill.value}{progress}</Text></Text>
  </Box>
}

async function changeContext($: EngineInterface, change: Partial<ContextView>): Promise<void> {
  await update($, contextView, view => ({ ...view, ...change }))
  $.ui.invalidate('ui.render')
}

async function refreshAgents($: EngineInterface): Promise<void> {
  try {
    await changeContext($, { agents: await $.agent.list() })
  } catch {
    await changeContext($, { agents: null })
  }
}

/** Local summary estimates only: never invoke the paid full token-count API. */
async function refreshContext($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    await changeContext($, {
      context: usage.context,
      limits: usage.rateLimits,
      error: null,
      refreshedAt: await $.clock.now(),
    })
  } catch {
    // Do not leave a previous reading looking current after an unavailable op.
    await changeContext($, {
      context: null, limits: null, refreshedAt: null,
      error: 'Context reading is unavailable. Try again after a turn.',
    })
  }
}

// The hooks runtime traces $ only through functions declared at module scope.
// A burst shares one local read; normal render ticks never call usage().
let pendingRefresh: Promise<void> | null = null
let usageClock: Timer | undefined

function measuredContext($: EngineInterface): Promise<void> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = refreshContext($).finally(() => { pendingRefresh = null })
  return pendingRefresh
}

async function openContext($: EngineInterface): Promise<void> {
  await $.ui.open({ id: CONTEXT_PANE, title: 'Buddy · Context', focus: true })
  await Promise.all([measuredContext($), refreshAgents($)])
}

export function registerContext(on: On): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'sth-context', description: 'Open Claude context details and active agents' })
    usageClock?.cancel()
    usageClock = $.clock.every(30_000, () => $.ui.invalidate('ui.render'))
    await Promise.all([measuredContext($), refreshAgents($)])
    return result
  })

  on('session.measure', { changed: /./ }, async ($, e, next) => {
    // The event already carries the live reading. Re-estimate categories only
    // when the context changes, not whenever cost or quotas move.
    await update($, contextView, view => ({
      ...view,
      context: e.changed.includes('context') ? e.context
        : { ...e.context, breakdown: view.context?.breakdown },
      limits: e.rateLimits,
      error: null,
    }))
    $.ui.invalidate('ui.render')
    if (e.changed.includes('context')) await measuredContext($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await refreshAgents($)
    return result
  })

  on('turn.start', { turnId: /./ }, async ($, e, next) => {
    const result = await next(e)
    await refreshAgents($)
    return result
  })

  on('turn.complete', { turnId: /./ }, async ($, e, next) => {
    const result = await next(e)
    await refreshAgents($)
    return result
  })

  on('command.run', { command: 'sth-context' }, async $ => {
    await openContext($)
    return { text: 'Buddy context pane opened.' }
  })

  on('ui.press', { plugin: 'sth-usage', element: 'open-context' }, async ($, e, next) => {
    const result = await next(e)
    await Promise.all([measuredContext($), refreshAgents($)])
    return result
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { Page, Card, Button, Toolbar } = panelChrome($.ui.resolve(e), e)
    const view = await read($, contextView)
    const context = view.context
    const breakdown = context?.breakdown
    const agents = activeAgents(view)
    const mcpServers = new Map<string, { tokens: number; loaded: number; total: number }>()
    for (const tool of breakdown?.mcpTools ?? []) {
      const server = mcpServers.get(tool.serverName) ?? { tokens: 0, loaded: 0, total: 0 }
      server.tokens += tool.isLoaded ? tool.tokens : 0
      server.loaded += tool.isLoaded ? 1 : 0
      server.total += 1
      mcpServers.set(tool.serverName, server)
    }
    return (
      <Page>
        {paneNavigation($.ui.resolve(e), e, CONTEXT_PANE, pane => $.ui.open(pane))}
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
          <Box flexDirection="column">
            <Text bold>Session context</Text>
            <Text dimColor>Context details and active agents.</Text>
          </Box>
          <Toolbar>
            <Button key="context-refresh" label="Refresh" variant="primary" onPress={() => Promise.all([measuredContext($), refreshAgents($)]).then(() => {})} />
          </Toolbar>
        </Box>
        {view.error && <Text color="error">{view.error}</Text>}
        <Card>
          <Text bold>{contextCaption(context)}</Text>
          {!availableNumber(context?.tokens) && <Text dimColor>Available after the first response, or the next response after compaction.</Text>}
          {breakdown && <Text dimColor>{breakdown.model} · compaction window {compact(breakdown.rawMaxTokens)} tokens · {Math.round(breakdown.percentage)} % estimated</Text>}
        </Card>
        <Card>
          <Text bold>System, tools, MCP and messages</Text>
          {breakdown ? (
            <Box flexDirection="column">
              <Text dimColor>Local estimates from Claude</Text>
              {breakdown.categories.map((category, index) => (
                <Box key={`context-category-${index}`} flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
                  <Text>{category.name}{category.kind === 'deferred' ? ' (loaded on demand, excluded from total)' : ''}</Text>
                  <Text>{compact(category.tokens)} tokens</Text>
                </Box>
              ))}
              {breakdown.autoCompactThreshold !== undefined && <Text dimColor>Automatic compaction at {compact(breakdown.autoCompactThreshold)} tokens.</Text>}
              {!breakdown.isAutoCompactEnabled && <Text dimColor>Automatic compaction disabled.</Text>}
            </Box>
          ) : <Text dimColor>Details unavailable. Refresh after a turn.</Text>}
        </Card>
        {breakdown && (
          <Card>
            <Text bold>MCP</Text>
            <Box flexDirection="column">
              {mcpServers.size === 0 && <Text dimColor>No MCP schemas in this reading.</Text>}
              {[...mcpServers.entries()].map(([name, server]) => (
                <Text key={`context-mcp-${name}`}>{name} · {server.loaded}/{server.total} tools loaded · {compact(server.tokens)} tokens in context</Text>
              ))}
            </Box>
            <Text bold>Memory files</Text>
            <Box flexDirection="column">
              {breakdown.memoryFiles.length === 0 && <Text dimColor>No memory files in this reading.</Text>}
              {breakdown.memoryFiles.map((file, index) => (
                <Text key={`context-memory-${index}`}>{file.path} · {file.type} · {compact(file.tokens)} tokens</Text>
              ))}
            </Box>
          </Card>
        )}
        <Card>
          <Text bold>Active agents{agents === null ? '' : ` · ${agents.length}`}</Text>
          <Box flexDirection="column">
            {agents === null ? <Text dimColor>List unavailable.</Text>
              : agents.length === 0 ? <Text dimColor>No active agents.</Text>
              : agents.map(agent => <Text key={`context-agent-${agent.id}`}>{agent.name ?? agent.type} · {agent.status} · {agent.description}</Text>)}
          </Box>
        </Card>
      </Page>
    )
  })
}

export const register: Register = on => { registerContext(on) }
