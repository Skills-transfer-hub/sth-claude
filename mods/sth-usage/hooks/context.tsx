import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

const CONTEXT_PANE = 'sth-context'

export type ContextView = {
  context: SessionContextUsage | null
  limits: SessionRateLimit[] | null
  agents: AgentInfo[] | null
  error: string | null
  refreshedAt: number | null
}

const EMPTY_CONTEXT: ContextView = {
  context: null, limits: null, agents: null, error: null, refreshedAt: null,
}

const contextView = atom({ plugin: 'sth-usage', key: 'contextView' } as const, EMPTY_CONTEXT)

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5 h', seven_day: '7 j', seven_day_opus: 'Opus 7 j',
  seven_day_sonnet: 'Sonnet 7 j', spend_limit: 'Budget',
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
  if (!context || !availableNumber(context.tokens)) return 'Contexte indisponible'
  const window = availableNumber(context.window) && context.window > 0 ? context.window : null
  const percent = availableNumber(context.percent) ? context.percent
    : window === null ? null : context.tokens / window * 100
  const fill = window === null ? compact(context.tokens) : `${compact(context.tokens)}/${compact(window)}`
  return `Contexte ${fill}${percent === null ? '' : ` · ${Math.round(percent)} %`}`
}

export function quotaCaption(limits: SessionRateLimit[] | null): string {
  const known = limits?.filter(limit => availableNumber(limit.percentUsed)) ?? []
  if (known.length === 0) return 'Quota indisponible'
  return known.map(limit => `${WINDOW_LABELS[limit.kind] ?? limit.kind} ${Math.round(Math.max(0, 100 - limit.percentUsed))} % restants`).join(' · ')
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
      error: 'Le relevé du contexte est indisponible. Réessaie après un tour.',
    })
  }
}

// The hooks runtime traces $ only through functions declared at module scope.
// A burst shares one local read; normal render ticks never call usage().
let pendingRefresh: Promise<void> | null = null

function measuredContext($: EngineInterface): Promise<void> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = refreshContext($).finally(() => { pendingRefresh = null })
  return pendingRefresh
}

async function openContext($: EngineInterface): Promise<void> {
  await $.ui.open({ id: CONTEXT_PANE, title: 'Buddy · Contexte', focus: true })
  await Promise.all([measuredContext($), refreshAgents($)])
}

export function registerContext(on: On): void {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'sth-context', description: 'Ouvre le contexte Claude, les quotas restants et les agents actifs' })
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
    return { text: 'Panneau de contexte Buddy ouvert.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const original = await next(e)
    if (e.props.hasSurvey) return original
    const { Box, Button } = $.ui.resolve(e)
    const view = await read($, contextView)
    const agents = activeAgents(view)
    const agentCaption = agents === null ? 'Agents indisponibles' : `${agents.length} agent${agents.length > 1 ? 's' : ''} actif${agents.length > 1 ? 's' : ''}`
    return (
      <Box flexDirection="column">
        {original}
        <Button
          key="context-open"
          label={`${contextCaption(view.context)} · ${quotaCaption(view.limits)} · ${agentCaption}`}
          plain
          onPress={() => openContext($)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
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
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
          <Text bold>{contextCaption(context)}</Text>
          <Button key="context-refresh" label="Actualiser" onPress={() => Promise.all([measuredContext($), refreshAgents($)]).then(() => {})} />
        </Box>
        {view.error && <Text color="yellow">{view.error}</Text>}
        {!availableNumber(context?.tokens) && <Text dimColor>Le remplissage sera connu après la première réponse du modèle, ou après la prochaine réponse suivant une compaction.</Text>}
        <Text bold>Quotas restants</Text>
        <Text>{quotaCaption(view.limits)}</Text>
        {view.limits?.map(limit => limit.resetsAt && (
          <Text key={`context-reset-${limit.kind}`} dimColor>{WINDOW_LABELS[limit.kind] ?? limit.kind} · réinitialisation {limit.resetsAt}</Text>
        ))}
        <Text bold>Système, tools, MCP et messages</Text>
        {breakdown ? (
          <Box flexDirection="column">
            <Text dimColor>Estimations locales de Claude · {breakdown.model}</Text>
            <Text dimColor>Fenêtre de compaction : {compact(breakdown.rawMaxTokens)} tokens · {Math.round(breakdown.percentage)} % estimés</Text>
            {breakdown.categories.map((category, index) => (
              <Box key={`context-category-${index}`} flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
                <Text>{category.name}{category.kind === 'deferred' ? ' (chargés à la demande, hors total)' : ''}</Text>
                <Text>{compact(category.tokens)} tokens</Text>
              </Box>
            ))}
            {breakdown.autoCompactThreshold !== undefined && <Text dimColor>Compaction automatique à {compact(breakdown.autoCompactThreshold)} tokens.</Text>}
            {!breakdown.isAutoCompactEnabled && <Text dimColor>Compaction automatique désactivée.</Text>}
          </Box>
        ) : <Text dimColor>Détail indisponible. Actualise après un tour.</Text>}
        {breakdown && (
          <Box flexDirection="column" gap={1}>
            <Text bold>MCP</Text>
            {mcpServers.size === 0 && <Text dimColor>Aucun schéma MCP dans ce relevé.</Text>}
            {[...mcpServers.entries()].map(([name, server]) => (
              <Text key={`context-mcp-${name}`}>{name} · {server.loaded}/{server.total} tools chargés · {compact(server.tokens)} tokens dans le contexte</Text>
            ))}
            <Text bold>Fichiers mémoire</Text>
            {breakdown.memoryFiles.length === 0 && <Text dimColor>Aucun fichier mémoire dans ce relevé.</Text>}
            {breakdown.memoryFiles.map((file, index) => (
              <Text key={`context-memory-${index}`}>{file.path} · {file.type} · {compact(file.tokens)} tokens</Text>
            ))}
          </Box>
        )}
        <Text bold>Agents actifs{agents === null ? '' : ` · ${agents.length}`}</Text>
        {agents === null ? <Text dimColor>Liste indisponible.</Text>
          : agents.length === 0 ? <Text dimColor>Aucun agent actif.</Text>
          : agents.map(agent => <Text key={`context-agent-${agent.id}`}>{agent.name ?? agent.type} · {agent.status} · {agent.description}</Text>)}
      </Box>
    )
  })
}

export const register: Register = on => { registerContext(on) }
