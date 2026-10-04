import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register } from 'claude-code'
import { isPromptText } from './fika'
import { panelChrome, paneNavigation } from './presentation'

export type TestEvidence = {
  label: string
  status: 'passed' | 'failed' | 'unknown'
  exitCode: number | null
}

export type ActivitySummary = {
  files: string[]
  tests: TestEvidence[]
  toolErrors: number
  durationMs: number
  reason: string
  nextStep: string
}

export type ResumeSummary = {
  version: 1
  savedAt: number
  objective: string
  files: string[]
  tests: TestEvidence[]
  nextStep: string
}

export type TestCommand = { label: string; argv: string[] }

export type ActivityView = {
  phase: 'ready' | 'working' | 'permission' | 'error' | 'complete' | 'interrupted'
  waitingTool: string | null
  objective: string
  files: string[]
  tests: TestEvidence[]
  toolErrors: number
  last: ActivitySummary | null
  resume: ResumeSummary | null
  message: string | null
  testsRunning: boolean
  testCommand: TestCommand | null
}

export const ACTIVITY_PANE = 'sth-activity'
export const RESUME_PANE = 'sth-resume'
export const RESUME_FILE = '.sth/buddy-session.json'
const MAX_FILES = 40
const MAX_TESTS = 12
const MAX_RESUME_BYTES = 16_384
const EMPTY: ActivityView = {
  phase: 'ready', waitingTool: null, objective: '', files: [], tests: [], toolErrors: 0,
  last: null, resume: null, message: null, testsRunning: false, testCommand: null,
}

export const activityView = atom({ plugin: 'sth-usage', key: 'activityView' } as const, EMPTY)

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined
}

// Save a short objective, never command output, tool arguments or the transcript.
export function safeObjective(text: string): string {
  return text
    .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|github_pat_[\w]{8,}|xox[baprs]-[\w-]{8,})\b/g, '[redacted]')
    .replace(/\b(?:Bearer\s+|(?:api[_-]?key|token|password|secret|mot de passe)\s*[:=]\s*)[^\s,;]+/gi, '[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[link]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function safeProjectPath(path: unknown, cwd: string): string | null {
  if (typeof path !== 'string' || path.length > 512 || /[\u0000-\u001f\u007f]/.test(path)) return null
  const normalized = path.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  const relative = normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : normalized.replace(/^\.\//, '')
  if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) return null
  if (/(^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|id_(?:rsa|ed25519)|secrets?)(\/|$)|\.(?:pem|p12|pfx|key)$/i.test(relative)) return null
  return relative.slice(0, 240)
}

function uniqueFiles(files: readonly unknown[], cwd: string): string[] {
  return [...new Set(files.map(path => safeProjectPath(path, cwd)).filter((path): path is string => path !== null))].slice(0, MAX_FILES)
}

export function testLabel(command: string): string | null {
  // Recognize an actual invocation, not echoing test output or a mention of tests.
  const source = command.trim().replace(/^(?:[A-Za-z_][\w]*=[^\s]+\s+)*/, '')
  const match = source.match(/(?:^|(?:&&|;|\n)\s*)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test(?::[\w-]+)?|vitest|jest)|(?:npx|pnpm\s+exec|bunx)\s+(?:vitest|jest)|(?:python[\d.]*\s+-m\s+)?pytest|go\s+test|cargo\s+test|claude\s+plugin\s+test)(?=\s|$)/i)
  if (!match) return null
  return match[0].replace(/^(?:&&|;|\n)\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

export function testEvidence(label: string, value: unknown, command?: string): TestEvidence {
  const result = record(value)
  const code = result?.exitCode
  const invocation = command?.indexOf(label) ?? -1
  const masked = command !== undefined && (invocation < 0 || /[;|\n]|&&/.test(command.slice(invocation + label.length)))
  const exitCode = typeof code === 'number' && Number.isInteger(code) && !result?.interrupted && !result?.backgroundTaskId && !masked ? code : null
  return { label: label.slice(0, 64), exitCode,
    status: exitCode === null ? 'unknown' : exitCode === 0 ? 'passed' : 'failed' }
}

export function testsCaption(tests: readonly TestEvidence[]): string {
  if (tests.length === 0) return 'Tests not run'
  const passed = tests.filter(test => test.status === 'passed').length
  const failed = tests.filter(test => test.status === 'failed').length
  const unknown = tests.filter(test => test.status === 'unknown').length
  return [passed && `${passed} passed`, failed && `${failed} failed`,
    unknown && `${unknown} unverified result${unknown > 1 ? 's' : ''}`].filter(Boolean).join(' · ')
}

export function activityCaption(view: ActivityView): string | null {
  if (view.phase === 'working') return 'Buddy is working…'
  if (view.phase === 'complete') return 'Buddy is done'
  if (view.phase === 'permission') return `Buddy is waiting for your permission${view.waitingTool ? ` (${view.waitingTool})` : ''}`
  if (view.phase === 'error') return 'Buddy needs attention after an error'
  if (view.phase === 'interrupted') return 'Buddy is waiting to resume after an interruption'
  return null
}

export function activityBuddyState(view: ActivityView): 'update' | 'error' | null {
  if (view.phase === 'permission' || view.phase === 'interrupted') return 'update'
  return view.phase === 'error' ? 'error' : null
}

function nextStep(summary: Pick<ActivitySummary, 'tests' | 'toolErrors' | 'reason'>): string {
  if (summary.reason === 'aborted') return 'Review the summary before resuming the interrupted work.'
  if (summary.toolErrors || summary.reason === 'error' || summary.reason === 'refusal') return 'Review the reported errors before continuing.'
  const latest = latestTests(summary.tests)
  if (latest.some(test => test.status === 'failed')) return 'Review the failed tests, then run them again.'
  if (!latest.length || latest.some(test => test.status === 'unknown')) return 'Run the tests and check their exit codes.'
  return 'Review the changes before continuing.'
}

function latestTests(tests: readonly TestEvidence[]): TestEvidence[] {
  const latest = new Map<string, TestEvidence>()
  for (const test of tests) latest.set(test.label, test)
  return [...latest.values()]
}

export function parseResume(text: string, cwd: string): ResumeSummary | null {
  if (text.length > MAX_RESUME_BYTES) return null
  try {
    const data = record(JSON.parse(text))
    if (!data || data.version !== 1 || typeof data.savedAt !== 'number' || !Number.isFinite(data.savedAt) ||
      typeof data.objective !== 'string' || !Array.isArray(data.files) || !Array.isArray(data.tests) || typeof data.nextStep !== 'string') return null
    const tests: TestEvidence[] = []
    for (const value of data.tests.slice(0, MAX_TESTS)) {
      const test = record(value)
      if (!test || typeof test.label !== 'string' || !['passed', 'failed', 'unknown'].includes(String(test.status))) return null
      tests.push(testEvidence(safeObjective(test.label).slice(0, 64), { exitCode: test.exitCode }))
    }
    return { version: 1, savedAt: data.savedAt, objective: safeObjective(data.objective),
      files: uniqueFiles(data.files, cwd), tests, nextStep: safeObjective(data.nextStep) }
  } catch { return null }
}

export function resumeDraft(resume: ResumeSummary): string {
  return `Resume this objective: ${resume.objective}\n\nSaved summary to review:\nFiles: ${resume.files.join(', ') || 'no files observed'}.\nTests: ${testsCaption(resume.tests)}.\nNext step: ${resume.nextStep}\nCheck the current project state before continuing.`
}

async function quietly($: EngineInterface, work: () => Promise<unknown>): Promise<void> {
  try { await work() } catch {
    try { $.ui.log('Buddy: summary unavailable for this event.', { to: 'debug' }) } catch { /* observation must not change the chain */ }
  }
}

async function readSmall($: EngineInterface, path: string, maxBytes = MAX_RESUME_BYTES): Promise<string | null> {
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.size > maxBytes || stat.isLink) return null
    return await $.fs.read(path)
  } catch { return null }
}

async function detectTests($: EngineInterface, root: string): Promise<TestCommand | null> {
  const source = await readSmall($, projectFile('package.json', root), 65_536)
  if (source) {
    try {
      const scripts = record(record(JSON.parse(source))?.scripts)
      const test = scripts?.test
      if (typeof test === 'string' && test.trim() && !/no test specified/i.test(test)) {
        let manager = 'npm'
        if (await $.fs.exists(projectFile('pnpm-lock.yaml', root))) manager = 'pnpm'
        else if (await $.fs.exists(projectFile('bun.lock', root)) || await $.fs.exists(projectFile('bun.lockb', root))) manager = 'bun'
        else if (await $.fs.exists(projectFile('yarn.lock', root))) manager = 'yarn'
        const argv = [manager, 'test']
        if (/\bvitest\b/.test(test) && !/\b(?:run|--run)\b/.test(test)) argv.push(...(manager === 'npm' ? ['--', '--run'] : ['--run']))
        else if (/\bjest\b/.test(test)) argv.push(...(manager === 'npm' ? ['--', '--watch=false'] : ['--watch=false']))
        return { label: `${manager} test`, argv }
      }
    } catch { /* malformed package files do not invent a test command */ }
  }
  return await $.fs.exists(projectFile('.claude-plugin/plugin.json', root)) ? { label: 'claude plugin test', argv: ['claude', 'plugin', 'test', '.'] } : null
}

let cwd = ''
let activityEpoch = 0
let turnId: string | null = null
let notifiedTurn: string | null = null
const permissions = new Set<string>()
const toolAgents = new Map<string, string | undefined>()
let sessionFiles: string[] = []
let sessionTests: TestEvidence[] = []

function projectFile(path: string, root = cwd): string { return `${root.replace(/\/$/, '')}/${path}` }

async function addTests($: EngineInterface, evidence: TestEvidence): Promise<void> {
  await update($, activityView, view => ({ ...view, tests: [...view.tests, evidence].slice(-MAX_TESTS) }))
}

async function markPermission($: EngineInterface, tool: string, id?: string): Promise<void> {
  if (id) permissions.add(id)
  await update($, activityView, view => ({ ...view, phase: 'permission' as const, waitingTool: tool.slice(0, 48) }))
}

async function saveResume($: EngineInterface, resume: ResumeSummary): Promise<void> {
  const epoch = activityEpoch
  const projectRoot = cwd
  try {
    const serialized = JSON.stringify(resume)
    if (new TextEncoder().encode(serialized).length > MAX_RESUME_BYTES) throw new Error('summary too large')
    const root = await $.fs.stat(projectRoot, { resolve: true })
    if (root.kind !== 'dir' || !root.realPath) throw new Error('project root unavailable')
    const realRoot = root.realPath.replace(/\/$/, '')
    // Directory entries also reveal dangling links, which exists() can miss.
    const parentEntry = (await $.fs.list(projectRoot)).find(entry => entry.name === '.sth')
    if (parentEntry) {
      if (parentEntry.isLink || parentEntry.kind !== 'dir') throw new Error('unsafe summary directory')
      const parent = await $.fs.stat(projectFile('.sth', projectRoot), { resolve: true })
      if (parent.isLink || parent.kind !== 'dir' || parent.realPath !== `${realRoot}/.sth`) throw new Error('unsafe summary directory')
      const targetEntry = (await $.fs.list(projectFile('.sth', projectRoot))).find(entry => entry.name === 'buddy-session.json')
      if (targetEntry) {
        if (targetEntry.isLink || targetEntry.kind !== 'file') throw new Error('unsafe summary file')
        const target = await $.fs.stat(projectFile(RESUME_FILE, projectRoot), { resolve: true })
        if (target.isLink || target.kind !== 'file' || target.realPath !== `${realRoot}/${RESUME_FILE}`) throw new Error('unsafe summary file')
      }
    }
    // fs.write creates missing parent directories; no separate host command.
    if (epoch === activityEpoch) await $.fs.write(projectFile(RESUME_FILE, projectRoot), serialized)
  } catch {
    await update($, activityView, view => epoch !== activityEpoch ? view : { ...view, message: 'Resume summary could not be saved.' })
  }
}

async function recordManualTests($: EngineInterface, evidence: TestEvidence, message: string): Promise<void> {
  const epoch = activityEpoch
  const before = await read($, activityView)
  if (epoch !== activityEpoch) return
  sessionFiles = uniqueFiles([...sessionFiles, ...(before.resume?.files ?? [])], cwd)
  sessionTests = [...(sessionTests.length ? sessionTests: before.resume?.tests ?? []), evidence].slice(-MAX_TESTS)
  const savedAt = await $.clock.now()
  if (epoch !== activityEpoch) return
  await update($, activityView, current => {
    if (epoch !== activityEpoch) return current
    const tests = [...current.tests, evidence].slice(-MAX_TESTS)
    const last = current.last ? { ...current.last, tests, nextStep: nextStep({ ...current.last, tests }) } : null
    const resume: ResumeSummary = { version: 1, savedAt, objective: current.objective || current.resume?.objective || '',
      files: sessionFiles, tests: sessionTests,
      nextStep: last?.nextStep ?? nextStep({ tests, toolErrors: current.toolErrors, reason: 'answer' }) }
    const failed = latestTests(tests).some(test => test.status === 'failed')
    const recovered = evidence.status === 'passed' && !failed && !current.toolErrors && (!last || last.reason === 'answer')
    return { ...current, tests, last, resume, phase: failed ? 'error' as const : recovered ? 'complete' as const : current.phase, message }
  })
  const resume = (await read($, activityView)).resume
  if (resume && epoch === activityEpoch) await saveResume($, resume)
}

async function openDiff($: EngineInterface): Promise<void> {
  try {
    const available = (await $.command.list()).some(command => command.name === 'diff')
    if (!available) {
      await update($, activityView, view => ({ ...view, message: 'The /diff command is unavailable in this version.' }))
      return
    }
    await $.command.run({ command: 'diff' })
  } catch {
    await update($, activityView, view => ({ ...view, message: 'Unable to open the diff.' }))
  }
}

async function openActivity($: EngineInterface): Promise<void> {
  await $.ui.open({ id: ACTIVITY_PANE, title: 'Turn summary', focus: true })
}

async function openResume($: EngineInterface): Promise<void> {
  await $.ui.open({ id: RESUME_PANE, title: 'Resume with Buddy', focus: true })
}

async function prepareVerification($: EngineInterface): Promise<void> {
  const result = await $.prompt.fill({ text: '\nRun the tests relevant to this turn’s changes and check their exit codes.', mode: 'append' })
  if (!result.isFilled) await update($, activityView, current => ({ ...current, message: 'The draft is unavailable.' }))
}

async function runTests($: EngineInterface): Promise<void> {
  const view = await read($, activityView)
  if (!view.testCommand || view.testsRunning || turnId !== null) return
  await update($, activityView, current => ({ ...current, testsRunning: true, message: null }))
  const testRoot = cwd
  const epoch = activityEpoch
  try {
    const result = await $.process.run(view.testCommand.argv, { cwd: testRoot, timeoutMs: 120_000 })
    if (epoch !== activityEpoch) return
    const evidence = testEvidence(view.testCommand.label, result)
    await recordManualTests($, evidence, `${view.testCommand.label} : ${testsCaption([evidence])} (code ${result.exitCode}).`)
  } catch {
    if (epoch !== activityEpoch) return
    await recordManualTests($, testEvidence(view.testCommand.label, { interrupted: true }),
      'Tests unverified: execution was unavailable or interrupted.')
  } finally {
    await update($, activityView, current => epoch !== activityEpoch ? current : { ...current, testsRunning: false })
  }
}

async function resetProjectActivity($: EngineInterface, root: string): Promise<void> {
  const epoch = ++activityEpoch
  cwd = root
  turnId = null
  notifiedTurn = null
  permissions.clear()
  toolAgents.clear()
  sessionFiles = []
  sessionTests = []
  await quietly($, async () => {
    const saved = await readSmall($, projectFile(RESUME_FILE, root))
    const resume = saved === null ? null : parseResume(saved, root)
    const testCommand = await detectTests($, root)
    await update($, activityView, current => epoch !== activityEpoch ? current : { ...EMPTY, resume, testCommand })
  })
}

export function registerActivity(on: On): void {

  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    const result = await next(e)
    await resetProjectActivity($, e.cwd)
    await quietly($, async () => {
      await $.command.register({ name: ACTIVITY_PANE, description: 'Summary of observed files and tests' })
      await $.command.register({ name: RESUME_PANE, description: 'View the previous session summary' })
    })
    return result
  })

  on('classic.CwdChanged', { hook_event_name: 'CwdChanged' }, async ($, e, next) => {
    await resetProjectActivity($, e.new_cwd)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('prompt.submit', { origin: { kind: /^(composer|bridge|sdk)$/ } }, async ($, e, next) => {
    const result = await next(e)
    if (['composer', 'bridge', 'sdk'].includes(e.origin.kind) && isPromptText(e.text)) {
      await quietly($, async () => {
        await update($, activityView, view => ({ ...view, objective: view.objective || safeObjective(e.text) }))
      })
    }
    return result
  })

  on('turn.start', { turnId: /^/ }, async ($, e, next) => {
    turnId = e.turnId
    permissions.clear()
    await quietly($, async () => {
      await update($, activityView, view => ({ ...view, phase: 'working' as const, waitingTool: null,
        files: [], tests: [], toolErrors: 0, last: null, message: null }))
    })
    return await next(e)
  })

  on('tool.check', { tool: /^/ }, async ($, e, next) => {
    const result = await next(e)
    if (turnId && e.tool_use_id && !toolAgents.get(e.tool_use_id) && result.decision === 'ask') {
      await quietly($, () => markPermission($, e.tool, e.tool_use_id))
    }
    return result
  })

  on('classic.PermissionRequest', { hook_event_name: 'PermissionRequest' }, async ($, e, next) => {
    if (!e.agent_id && turnId) await quietly($, () => markPermission($, e.tool_name))
    return await next(e)
  })

  on('classic.Notification', { notification_type: 'permission_prompt' }, async ($, e, next) => {
    if (!e.agent_id && turnId && e.notification_type === 'permission_prompt') await quietly($, () => markPermission($, 'tool'))
    return await next(e)
  })

  on('tool.call', { tool: /^/ }, async ($, e, next) => {
    const observedTurn = turnId
    toolAgents.set(e.tool_use_id, e.agentId)
    // next runs the existing permission flow and tool exactly once.
    const result = await next(e)
    toolAgents.delete(e.tool_use_id)
    if (!observedTurn || observedTurn !== turnId) return result
    await quietly($, async () => {
      const value = record(result.result)
      const failed = Boolean(result.deny || result.isError)
      let changed: unknown[] = []
      if (!failed && value && value.staged !== true) {
        if (e.tool === 'Edit' && Array.isArray(value.structuredPatch) && value.structuredPatch.length) changed = [value.filePath]
        if (e.tool === 'Write' && (value.type === 'create' ||
          (typeof value.content === 'string' && typeof value.originalFile === 'string' && value.content !== value.originalFile) ||
          (Array.isArray(value.structuredPatch) && value.structuredPatch.length))) changed = [value.filePath]
        if (e.tool === 'Bash') {
          const diff = record(value.bashEditDiff)
          // A shared snapshot cannot attribute a concurrent worker's edits to this call.
          if (diff && !diff.shared && !diff.unavailable && !diff.skipped) {
            changed = Array.isArray(diff.changedFiles) ? diff.changedFiles :
              Array.isArray(diff.files) ? diff.files.map(file => record(file)?.filePath) : []
          }
        }
      }
      const label = e.tool === 'Bash' ? testLabel(e.command) : null
      if (label && !result.deny) await addTests($, testEvidence(label, value, e.tool === 'Bash' ? e.command : undefined))
      if (!e.agentId) permissions.delete(e.tool_use_id)
      await update($, activityView, view => ({ ...view,
        files: uniqueFiles([...view.files, ...changed], cwd),
        toolErrors: view.toolErrors + Number(failed),
        phase: (e.agentId ? view.phase : failed ? 'error' : permissions.size ? 'permission' : 'working') as ActivityView['phase'],
        waitingTool: e.agentId || permissions.size ? view.waitingTool : null,
      }))
    })
    return result
  })

  // This event supplies actual exit codes, unlike this build's Bash result.
  on('process.run', { argv: /^/ }, async ($, e, next) => {
    const observedTurn = turnId
    const result = await next(e)
    const label = testLabel(e.argv.join(' '))
    if (observedTurn && observedTurn === turnId && label && result.value) {
      await quietly($, () => addTests($, testEvidence(label, result.value)))
    }
    return result
  })

  on('turn.complete', { turnId: /^/ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.turnId !== turnId) return result
    turnId = null
    permissions.clear()
    const epoch = activityEpoch
    await quietly($, async () => {
      const view = await read($, activityView)
      if (epoch !== activityEpoch) return
      const last: ActivitySummary = { files: view.files, tests: view.tests, toolErrors: view.toolErrors,
        durationMs: e.durationMs, reason: e.reason, nextStep: '' }
      last.nextStep = nextStep(last)
      sessionFiles = uniqueFiles([...sessionFiles, ...view.files], cwd)
      sessionTests = [...sessionTests, ...view.tests].slice(-MAX_TESTS)
      const resume: ResumeSummary = { version: 1, savedAt: await $.clock.now(), objective: view.objective,
        files: sessionFiles, tests: sessionTests, nextStep: last.nextStep }
      if (epoch !== activityEpoch) return
      const failedTests = latestTests(view.tests).some(test => test.status === 'failed')
      await update($, activityView, current => epoch !== activityEpoch ? current : ({ ...current, last, resume, waitingTool: null,
        phase: (e.reason === 'aborted' ? 'interrupted' : e.reason !== 'answer' || view.toolErrors || failedTests ? 'error' : 'complete') as ActivityView['phase'] }))
      if (epoch !== activityEpoch) return
      const line = `Summary: ${view.files.length} file${view.files.length > 1 ? 's' : ''} · ${testsCaption(view.tests)}${view.toolErrors ? ` · ${view.toolErrors} tool error${view.toolErrors > 1 ? 's' : ''}` : ''}`
      $.ui.log(`${line} · /${ACTIVITY_PANE}`)
      if (e.durationMs >= 60_000 && notifiedTurn !== e.turnId) {
        notifiedTurn = e.turnId
        $.ui.toast(e.reason === 'answer' && !view.toolErrors && !failedTests ? 'Buddy is done. The summary is ready.' : 'Buddy needs attention. The summary is ready.')
      }
      await saveResume($, resume)
    })
    return result
  })

  on('command.run', { command: 'sth-activity' }, async $ => {
    await openActivity($)
    return { text: '' }
  })
  on('command.run', { command: 'sth-resume' }, async $ => {
    await openResume($)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane', requestId: ACTIVITY_PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const { Page, Card, Button, Toolbar } = panelChrome($.ui.resolve(e), e)
    const view = await read($, activityView)
    const summary = view.last
    const files = summary?.files ?? view.files
    const tests = summary?.tests ?? view.tests
    return <Page>
      {paneNavigation($.ui.resolve(e), e, 'activity', pane => $.ui.open(pane))}
      <Text bold>Turn summary</Text>
      <Text>{activityCaption(view) ?? (view.phase === 'working' ? 'Buddy is working…' : 'Actions observed in this turn')}</Text>
      {summary && <Card>
        <Text bold>Next step</Text>
        <Text>{summary.nextStep}</Text>
      </Card>}
      <Card>
        <Text bold>{files.length} changed file{files.length > 1 ? 's' : ''}</Text>
        {!files.length && <Text dimColor>No file writes observed.</Text>}
        {files.map(path => <Text key={`file-${path}`}>{path}</Text>)}
        {files.length === MAX_FILES && <Text dimColor>Showing the first 40 paths.</Text>}
        <Toolbar><Button key="activity-diff" variant="primary" onPress={() => openDiff($)}>View diff</Button></Toolbar>
        <Text dimColor>The diff may include changes made before this turn.</Text>
      </Card>
      <Card>
        <Text bold>Verification</Text>
        <Text>{testsCaption(tests)}</Text>
        {tests.map((test, index) => <Text key={`test-${index}`} color={test.status === 'failed' ? 'red' : undefined}>{test.label} : {test.status === 'passed' ? 'passed' : test.status === 'failed' ? 'failed' : 'unverified result'}{test.exitCode === null ? '' : ` (code ${test.exitCode})`}</Text>)}
        {Boolean(summary?.toolErrors ?? view.toolErrors) && <Text color="red">{summary?.toolErrors ?? view.toolErrors} tool error(s)</Text>}
        <Toolbar>
          {view.testCommand && !view.testsRunning && turnId === null && <Button key="activity-run-tests" onPress={() => runTests($)}>{`Run ${view.testCommand.label}`}</Button>}
          <Button key="activity-test-draft" onPress={() => prepareVerification($)}>Prepare tests</Button>
          {view.testsRunning && <Text dimColor>Tests running…</Text>}
        </Toolbar>
      </Card>
      {view.message && <Text dimColor>{view.message}</Text>}
    </Page>
  })

  on('ui.render', { component: 'Pane', requestId: RESUME_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { Page, Card, Button, Toolbar } = panelChrome($.ui.resolve(e), e)
    const view = await read($, activityView)
    const saved = view.resume
    return <Page>
      {paneNavigation($.ui.resolve(e), e, 'resume', pane => $.ui.open(pane))}
      <Text bold>Resume summary</Text>
      {!saved ? <Card><Text dimColor>No summary saved for this project.</Text></Card> : <Box flexDirection="column" gap={1}>
        <Card>
          <Text bold>Objective</Text>
          <Text>{saved.objective || 'No user prompt observed.'}</Text>
        </Card>
        <Card>
          <Text bold>Next step</Text>
          <Text>{saved.nextStep}</Text>
          <Toolbar><Button key="resume-draft" variant="primary" onPress={async () => {
            const result = await $.prompt.fill({ text: `\n${resumeDraft(saved)}`, mode: 'append' })
            await update($, activityView, current => ({ ...current, message: result.isFilled
              ? 'Summary added to the draft. Review it before sending.' : 'The draft is unavailable.' }))
          }}>Add to draft</Button></Toolbar>
          <Text dimColor>Review the summary before sending your message.</Text>
        </Card>
        <Card>
          <Text bold>Observed files</Text>
          {!saved.files.length && <Text dimColor>No files observed.</Text>}
          {saved.files.map(path => <Text key={`resume-${path}`}>{path}</Text>)}
          <Text>{testsCaption(saved.tests)}</Text>
        </Card>
      </Box>}
      {view.message && <Text dimColor>{view.message}</Text>}
    </Page>
  })
}

export const register: Register = on => { registerActivity(on) }
