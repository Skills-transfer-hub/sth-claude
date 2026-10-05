import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import {
  ACTIVITY_PANE, RESUME_FILE, RESUME_PANE, parseResume, safeObjective, safeProjectPath,
  testEvidence, testLabel, testsCaption, activityCaption,
} from '../hooks/activity'
import type { ActivityView, ResumeSummary } from '../hooks/activity'

const ROOT = '/project'
const PATCH = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }]

function paneProps(): RenderPropsOf['Pane'] {
  return { title: 'Buddy', isFocused: true, bodyColumns: 70, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {} }
}

function bandProps(hasSurvey = false, isWorking = false): RenderPropsOf['AbovePrompt'] {
  return { hasSurvey, isWorking, maxRows: 12, bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

function environment(on: On, files: Record<string, string> = {}, links: { parent?: boolean; target?: boolean } = {}, processCodes: number[] = []) {
  const values = new Map<string, unknown>()
  const writes: { path: string; text: string }[] = []
  const logs: string[] = []
  const toasts: string[] = []
  const drafts: string[] = []
  const commands: string[] = []
  const panes: string[] = []
  const processes: string[][] = []
  const processRoots: (string | undefined)[] = []
  let currentRoot = ROOT
  const fixture = (path: string) => Object.keys(files).find(key => path === key || path.endsWith('/' + key))
  const hasParent = links.parent || Object.keys(files).some(path => path.startsWith('.sth/'))
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('state.set', { plugin: 'sth-usage' }, async (_, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) values.set(e.key, e.value)
    return result
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: currentRoot }))
  on('session.root', () => ({ value: currentRoot }))
  on('classic.CwdChanged', () => ({}))
  on('tool.list', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: clock.now(), context: { window: 200_000 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: [] }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: fixture(e.path) !== undefined }))
  on('fs.stat', (_, e) => {
    if (e.path === ROOT || e.path === currentRoot) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
    if (e.path === ROOT + '/.sth' && hasParent) return { value: {
      kind: 'dir', size: 0, mtimeMs: 0, isLink: Boolean(links.parent), realPath: links.parent ? '/outside' : ROOT + '/.sth',
    } }
    const key = fixture(e.path)
    if (key === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: files[key]!.length, mtimeMs: 0,
      isLink: key === RESUME_FILE && Boolean(links.target), realPath: key === RESUME_FILE && links.target ? '/outside/private.json' : key.startsWith('/') ? key : ROOT + '/' + key } }
  })
  on('fs.list', (_, e) => ({ value: e.path === ROOT
    ? hasParent ? [{ name: '.sth', kind: 'dir', size: 0, mtimeMs: 0, isLink: Boolean(links.parent) }] : []
    : e.path === ROOT + '/.sth' ? Object.keys(files).filter(path => path.startsWith('.sth/')).map(path => ({
      name: path.slice(5), kind: 'file', size: files[path]!.length, mtimeMs: 0, isLink: path === RESUME_FILE && Boolean(links.target),
    })) : [] }))
  on('fs.read', (_, e) => {
    const key = fixture(e.path)
    if (key === undefined) throw new Error('ENOENT')
    return { value: files[key]! }
  })
  on('fs.write', (_, e) => { writes.push({ path: e.path, text: e.text }); return { value: undefined } })
  on('ui.log', (_, e) => { logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', (_, e) => { panes.push(e.id); return { value: { isPlaced: true } } })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [
    { type: 'Text', props: {}, children: ['Contenu existant'] },
  ] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('command.list', () => ({ value: [{ name: 'diff', description: 'Diff', source: 'builtin' }] }))
  on('command.run', (_, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('prompt.fill', (_, e) => {
    drafts.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PreToolUse', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('tool.check', () => ({ decision: 'ask', reason: 'Confirm before execution' }))
  on('process.run', (_, e) => {
    processes.push([...e.argv])
    processRoots.push(e.init?.cwd)
    return { value: { exitCode: testLabel(e.argv.join(' ')) ? processCodes.shift() ?? 0 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { values, writes, logs, toasts, drafts, commands, processes, processRoots, panes, setRoot: (root: string) => { currentRoot = root },
    view: () => values.get('activityView') as ActivityView }
}

function latch() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function controlledCalls($: Engine, on: On) {
  let executions = 0
  const calls = new Map<string, { checked: ReturnType<typeof latch>; finish: ReturnType<typeof latch>;
    input: unknown; decision: 'allow' | 'ask' | 'deny'; agentId?: string; deny?: string; throws?: boolean }>()
  on('tool.check', { tool: 'Bash' }, (_, e) => ({
    decision: (e.tool_use_id ? calls.get(e.tool_use_id)?.decision : undefined) ?? 'ask',
    reason: 'Confirm before execution',
  }))
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    executions++
    const call = calls.get(e.tool_use_id)!
    expect(e.agentId).toBe(call.agentId)
    await $.tool.check({ tool: 'Bash', input: call.input, tool_use_id: e.tool_use_id })
    call.checked.release()
    await call.finish.promise
    if (call.throws) throw new Error('Existing tool implementation failed')
    return call.deny ? { deny: call.deny } : { result: { stdout: e.command, stderr: '', interrupted: false } }
  })
  return {
    executions: () => executions,
    async start(id: string, command: string, options: { input?: unknown; agentId?: string; decision?: 'allow' | 'ask' | 'deny'; deny?: string; throws?: boolean } = {}) {
      const call = { checked: latch(), finish: latch(), input: options.input ?? { command },
        decision: options.decision ?? 'ask', agentId: options.agentId, deny: options.deny, throws: options.throws }
      calls.set(id, call)
      // The test engine raises the full event, including the agent loop. Its
      // tool.call overload retains the narrower production-call declaration.
      const event = { tool: 'Bash' as const, tool_use_id: id, command, agentId: options.agentId }
      const result = $.tool.call(event)
      await call.checked.promise
      return { result, finish: call.finish.release }
    },
    request(command: string, options: { input?: unknown; agentId?: string } = {}) {
      return $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: options.input ?? { command }, agent_id: options.agentId })
    },
  }
}

describe('Evidence and bounded resume data', () => {
  test('test results require a real exit code rather than reassuring output', () => {
    expect(testEvidence('npm test', { stdout: 'all tests passed' })).toMatchObject({ status: 'unknown', exitCode: null })
    expect(testEvidence('npm test', { exitCode: 0 })).toMatchObject({ status: 'passed', exitCode: 0 })
    expect(testEvidence('npm test', { exitCode: 1 })).toMatchObject({ status: 'failed', exitCode: 1 })
    expect(testEvidence('npm test', { exitCode: 0, interrupted: true })).toMatchObject({ status: 'unknown', exitCode: null })
    expect(testEvidence('npm test', { exitCode: 0, backgroundTaskId: 'background' })).toMatchObject({ status: 'unknown' })
    for (const command of ['npm test || true', 'npm test; echo done', 'npm test && echo done']) {
      expect(testEvidence('npm test', { exitCode: 0 }, command)).toMatchObject({ status: 'unknown', exitCode: null })
    }
    expect(testsCaption([])).toBe('Tests not run')
    expect(testLabel('npm test -- --run')).toBe('npm test')
    expect(testLabel('cd repo && python3 -m pytest -q')).toBe('python3 -m pytest')
    expect(testLabel('echo "npm test passed"')).toBeNull()
  })

  test('resume strips common credentials, secret files, traversal and oversized data', () => {
    expect(safeObjective('Fix token=abc123 password=hidden sk-1234567890abcdef https://example.com?key=hidden')).not.toContain('abc123')
    expect(safeObjective('Fix token=abc123 password=hidden sk-1234567890abcdef https://example.com?key=hidden')).not.toContain('hidden')
    expect(safeProjectPath('/project/src/app.ts', ROOT)).toBe('src/app.ts')
    for (const path of ['../other.ts', '/outside/file.ts', '.env.local', 'keys/private.pem', 'secrets/token.txt']) {
      expect(safeProjectPath(path, ROOT)).toBeNull()
    }
    const resume = parseResume(JSON.stringify({ version: 1, savedAt: 10, objective: 'Fix token=hidden',
      files: ['src/app.ts', 'src/app.ts', '.env'], tests: [], nextStep: 'Exécuter les tests.' }), ROOT)
    expect(resume?.files).toEqual(['src/app.ts'])
    expect(resume?.objective).not.toContain('hidden')
    expect(parseResume('x'.repeat(16_385), ROOT)).toBeNull()
    expect(parseResume('{"version":2}', ROOT)).toBeNull()
  })
})

describe('Activity observes the existing chain', () => {
  test('only effective writes count, paths are unique and model verdicts prove no tests', async ($, on) => {
    const env = environment(on)
    on('tool.call', { tool: 'Edit' }, (_, e) => ({ result: {
      filePath: e.file_path, oldString: e.old_string, newString: e.new_string,
      originalFile: 'old', structuredPatch: PATCH, userModified: false, replaceAll: false,
      ...(e.file_path.includes('staged') ? { staged: true } : {}),
    } }))
    on('tool.call', { tool: 'Write' }, (_, e) => ({ result: {
      type: 'update', filePath: e.file_path, content: e.content, originalFile: e.content, structuredPatch: [],
    } }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false,
      bashEditDiff: { files: [{ filePath: '/project/src/shell.ts', hunks: PATCH }], moreFiles: 0 },
    } }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.prompt.submit({ text: 'Corriger le projet', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Corriger le projet', turnId: 'turn-1' })
    for (const path of ['/project/src/app.ts', '/project/src/app.ts', '/project/src/staged.ts']) {
      await $.tool.call({ tool: 'Edit', tool_use_id: `edit-${path}`, file_path: path, old_string: 'old', new_string: 'new' })
    }
    await $.tool.call({ tool: 'Write', tool_use_id: 'write-unchanged', file_path: '/project/unchanged.ts', content: 'same' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'shell-edit', command: 'sed -i x src/shell.ts' })
    const result = await $.turn.complete({ answer: 'Everything passed, including tests.', durationMs: 2_000,
      turnId: 'turn-1', isAborted: false, reason: 'answer' })
    expect(result.text).toBe('Everything passed, including tests.')
    expect(env.view().last?.files).toEqual(['src/app.ts', 'src/shell.ts'])
    expect(env.view().last?.tests).toEqual([])
    expect(activityCaption(env.view())).toBe('Buddy is done')
    expect(env.processes.filter(argv => testLabel(argv.join(' ')))).toEqual([])
    expect(env.toasts).toEqual([])
    expect(env.writes.find(write => write.path.endsWith(RESUME_FILE))?.text).not.toContain('Everything passed')
    expect(env.view().objective).toBe('Corriger le projet')
  })

  test('permissions and tool errors preserve verdicts and clear waiting state on completion', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Run tests', turnId: 'turn-2' })
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'bash-2' })
    expect(verdict).toEqual({ decision: 'ask', reason: 'Confirm before execution' })
    const pending = await calls.start('bash-2', 'npm test', { deny: 'Existing policy refuses this command' })
    expect(env.view().phase).toBe('working')
    await calls.request('npm test')
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    pending.finish()
    const result = await pending.result
    expect(result).toEqual({ deny: 'Existing policy refuses this command' })
    expect(env.view()).toMatchObject({ phase: 'error', waitingTool: null, toolErrors: 1 })
    expect(env.view().tests).toEqual([])
    await $.turn.complete({ answer: '', durationMs: 10_000, turnId: 'turn-2', isAborted: true, reason: 'aborted' })
    expect(env.view().phase).toBe('interrupted')
    expect(env.toasts).toEqual([])
  })

  test('permission queries without a real call do not put Buddy into waiting state', async ($, on) => {
    const env = environment(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Work', turnId: 'query-turn' })
    expect(activityCaption(env.view())).toBe('Buddy is working…')
    await $.tool.check({ tool: 'Bash', input: { command: 'npm test' } })
    expect(env.view().phase).toBe('working')
  })

  for (const decision of ['allow', 'ask', 'deny'] as const) {
    test(`permission observation preserves the complete ${decision} verdict and checks exactly once`, async ($, on) => {
      const original = { decision, reason: 'The existing policy decides', rule: 'Bash(npm test)', hook: 'PreToolUse' }
      let checks = 0
      on('tool.check', { tool: 'Bash' }, () => { checks++; return original })
      const env = environment(on)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await $.turn.start({ text: 'Check tests', turnId: `permission-${decision}` })
      const returned = await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: `permission-${decision}` })
      expect(returned).toEqual(original)
      expect(checks).toBe(1)
      // A check can still be settled automatically. Only a real request marks
      // Buddy as waiting; queries and verdict observation are no longer used.
      expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
      expect(original).toEqual({ decision, reason: 'The existing policy decides', rule: 'Bash(npm test)', hook: 'PreToolUse' })
    })
  }

  test('a rejected permission check stays rejected and does not invent a waiting state', async ($, on) => {
    let checks = 0
    on('tool.check', { tool: 'Bash' }, () => { checks++; throw new Error('Permission policy unavailable') })
    const env = environment(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Check tests', turnId: 'permission-error' })
    // The host wraps a failing continuation in HooksError; no verdict may be
    // synthesized from that failure, regardless of the wrapper's wording.
    await expect($.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'permission-error' })).rejects.toThrow()
    expect(checks).toBe(1)
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  for (const failed of [false, true]) {
    test(`an unrelated parallel ${failed ? 'denial' : 'completion'} cannot clear a real permission request`, async ($, on) => {
      const env = environment(on)
      const calls = controlledCalls($, on)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await $.turn.start({ text: 'Parallel work', turnId: 'parallel' })
      const requested = await calls.start('requested', 'needs permission')
      const unrelated = await calls.start('unrelated', 'already allowed', { decision: failed ? 'deny' : 'allow', deny: failed ? 'Policy denial' : undefined })
      await calls.request('needs permission')
      unrelated.finish()
      await unrelated.result
      // Preserve the existing error precedence, while retaining the pending
      // request internally and its waitingTool in the view.
      expect(env.view()).toMatchObject({ phase: failed ? 'error' : 'permission', waitingTool: 'Bash', toolErrors: Number(failed) })
      requested.finish()
      await requested.result
      expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    })
  }

  test('two distinct requests remain waiting until both corresponding calls complete', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Parallel requests', turnId: 'two-requests' })
    const first = await calls.start('first', 'first request')
    const second = await calls.start('second', 'second request')
    await calls.request('first request')
    await calls.request('second request')
    first.finish()
    await first.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    second.finish()
    await second.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  for (const requestCount of [1, 2]) {
    for (const requestedFinishesFirst of [true, false]) {
      test(`identical inputs with ${requestCount} request(s), requested call finishes ${requestedFinishesFirst ? 'first' : 'last'}, conservatively wait for both`, async ($, on) => {
        const env = environment(on)
        const calls = controlledCalls($, on)
        await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
        await $.turn.start({ text: 'Identical calls', turnId: 'identical' })
        const first = await calls.start('first', 'same command')
        const second = await calls.start('second', 'same command', { decision: requestCount === 2 ? 'ask' : 'allow' })
        await calls.request('same command')
        if (requestCount === 2) await calls.request('same command')
        const ordered = requestedFinishesFirst ? [first, second] : [second, first]
        ordered[0]!.finish()
        await ordered[0]!.result
        // With one request and its true call already complete, this is the
        // explicit tradeoff: the id-less event cannot distinguish that case
        // from the other identical call still awaiting permission.
        expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
        ordered[1]!.finish()
        await ordered[1]!.result
        expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
      })
    }
  }

  test('rewritten final inputs and reordered object keys correlate with the checked call', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Rewritten calls', turnId: 'rewritten' })
    const requested = await calls.start('rewritten', 'original command', { input: { command: 'rewritten command', details: { z: 1, a: [2, 3] } } })
    const other = await calls.start('other', 'original command', { decision: 'allow' })
    await calls.request('', { input: { details: { a: [2, 3], z: 1 }, command: 'rewritten command' } })
    other.finish()
    await other.result
    expect(env.view().phase).toBe('permission')
    requested.finish()
    await requested.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('passive input storage leaves deeply frozen event inputs unchanged through request and completion', async ($, on) => {
    const checkedInputs: unknown[] = []
    on('tool.check', { tool: 'Bash' }, (_, e, next) => {
      checkedInputs.push(e.input)
      return next(e)
    })
    const env = environment(on)
    const calls = controlledCalls($, on)
    const input = Object.freeze({ command: 'immutable command', details: Object.freeze({
      mode: 'read', values: Object.freeze([1, Object.freeze({ label: 'original' })]),
    }) })
    const original = JSON.stringify(input)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Observe immutable input', turnId: 'immutable-input' })
    const pending = await calls.start('immutable', input.command, { input })
    expect(checkedInputs).toEqual([input])
    expect(JSON.stringify(input)).toBe(original)
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.details.values)).toBe(true)
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    await calls.request(input.command, { input: {
      details: { values: [1, { label: 'original' }], mode: 'read' }, command: input.command,
    } })
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    pending.finish()
    await pending.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    expect(JSON.stringify(input)).toBe(original)
    expect(JSON.stringify(checkedInputs[0])).toBe(original)
    expect(calls.executions()).toBe(1)
    expect(env.logs.some(log => log.includes('summary unavailable'))).toBe(false)
  })

  test('subagent checks, requests, notifications and completions do not change main waiting state', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Main work', turnId: 'main' })
    const agent = await calls.start('agent-call', 'same command', { agentId: 'worker' })
    await calls.request('same command', { agentId: 'worker' })
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Permission needed', agent_id: 'worker' })
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    const main = await calls.start('main-call', 'same command')
    await calls.request('same command')
    main.finish()
    await main.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    agent.finish()
    await agent.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('an unmatched request conservatively retains every same-tool candidate', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Unmatched input', turnId: 'unmatched-input' })
    const requested = await calls.start('requested', 'observed input')
    const other = await calls.start('other', 'unrelated same tool', { decision: 'allow' })
    // tool.check input is pinned. This exercises the defensive unmatched
    // fallback, not an assertion that another hook may rewrite that input.
    await calls.request('unmatched event input')
    requested.finish()
    await requested.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    other.finish()
    await other.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('large checked input stays transient and is not written into the activity or resume', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Large input', turnId: 'large-input' })
    const content = 'sensitive-tool-input-'.repeat(100_000)
    const pending = await calls.start('large', 'command', { input: { command: 'command', content } })
    await calls.request('command', { input: { content, command: 'command' } })
    expect(env.view().phase).toBe('permission')
    pending.finish()
    await pending.result
    await $.turn.complete({ turnId: 'large-input', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
    expect(JSON.stringify(env.view())).not.toContain('sensitive-tool-input')
    expect(JSON.stringify(env.writes)).not.toContain('sensitive-tool-input')
    expect(JSON.stringify(env.logs)).not.toContain('sensitive-tool-input')
  })

  test('a comparison budget exhaustion retains possible candidates without blocking or choosing an id', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Complex input', turnId: 'complex-input' })
    const details = Array.from({ length: 9000 }, (value, index) => index)
    const requested = await calls.start('complex', 'complex input', { input: { command: 'complex input', details } })
    const other = await calls.start('other', 'complex input', { decision: 'allow', input: { command: 'complex input', details: [...details] } })
    await calls.request('', { input: { command: 'complex input', details: [...details] } })
    requested.finish()
    await requested.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    other.finish()
    await other.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('an exact candidate does not exclude another candidate when the shared comparison budget runs out', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Mixed comparison results', turnId: 'mixed-comparison' })
    const details = Array.from({ length: 5000 }, (value, index) => index)
    // The first comparison fits within 8192 nodes; the second cannot finish
    // within the remaining shared budget. Neither may be discarded.
    const exact = await calls.start('exact', 'same command', { decision: 'allow', input: { command: 'same command', details } })
    const uncertain = await calls.start('uncertain', 'same command', { input: { command: 'same command', details: [...details] } })
    await calls.request('', { input: { command: 'same command', details: [...details] } })
    exact.finish()
    await exact.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    uncertain.finish()
    await uncertain.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('a denied continuation leaves other requests tracked and is executed only once', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Concurrent failure', turnId: 'concurrent-throw' })
    const requested = await calls.start('requested', 'still pending')
    const failing = await calls.start('failing', 'throws', { throws: true })
    await calls.request('still pending')
    await calls.request('throws')
    const rejected = expect(failing.result).rejects.toThrow()
    failing.finish()
    await rejected
    expect(calls.executions()).toBe(2)
    expect(env.view()).toMatchObject({ phase: 'error', waitingTool: 'Bash' })
    const allowed = await calls.start('allowed', 'another allowed call', { decision: 'allow' })
    allowed.finish()
    await allowed.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    requested.finish()
    await requested.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  test('unmatched requests remain until turn end and later session events cannot revive them without a turn', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Unmatched request', turnId: 'unmatched' })
    await calls.request('call not observed')
    const unrelated = await calls.start('unrelated', 'unrelated command')
    unrelated.finish()
    await unrelated.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    await $.turn.complete({ turnId: 'unmatched', answer: '', durationMs: 1, isAborted: true, reason: 'aborted' })
    await calls.request('late request')
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Late notification' })
    expect(env.view()).toMatchObject({ phase: 'interrupted', waitingTool: null })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await calls.request('stale session request')
    expect(env.view()).toMatchObject({ phase: 'ready', waitingTool: null })
  })

  test('id-less sandbox notifications conservatively include every active main call', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Network permission', turnId: 'network' })
    const first = await calls.start('network', 'network request')
    const second = await calls.start('other', 'other command', { decision: 'allow' })
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Permission needed' })
    second.finish()
    await second.result
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'tool' })
    first.finish()
    await first.result
    const identified = await calls.start('identified', 'known request')
    const unrelated = await calls.start('unrelated', 'unrelated command', { decision: 'allow' })
    await calls.request('known request')
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Permission needed' })
    identified.finish()
    await identified.result
    // The notification could describe a second sandbox request, so it cannot
    // safely be discarded merely because another request is already known.
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'tool' })
    unrelated.finish()
    await unrelated.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  for (const reset of ['abort', 'new-turn', 'project'] as const) {
    test(`${reset} clears requests and ignores a late completion even when the call id is reused`, async ($, on) => {
      const env = environment(on)
      const calls = controlledCalls($, on)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await $.turn.start({ text: 'Old work', turnId: 'old' })
      const old = await calls.start('reused', 'old command')
      await calls.request('old command')
      if (reset === 'abort') {
        await $.turn.complete({ turnId: 'old', answer: '', durationMs: 10, isAborted: true, reason: 'aborted' })
        expect(env.view()).toMatchObject({ phase: 'interrupted', waitingTool: null })
      } else if (reset === 'project') {
        await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: '/next', cwd: '/next' })
        expect(env.view()).toMatchObject({ phase: 'ready', waitingTool: null })
      }
      await $.turn.start({ text: 'New work', turnId: 'new' })
      const fresh = await calls.start('reused', 'new command')
      await calls.request('new command')
      old.finish()
      await old.result
      expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
      fresh.finish()
      await fresh.result
      expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
    })
  }

  test('a rejected tool continuation stays rejected and clears its waiting candidate', async ($, on) => {
    const env = environment(on)
    const calls = controlledCalls($, on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Failing call', turnId: 'throwing' })
    const pending = await calls.start('failure', 'command', { throws: true })
    await calls.request('command')
    const rejected = expect(pending.result).rejects.toThrow()
    pending.finish()
    await rejected
    expect(calls.executions()).toBe(1)
    expect(env.view()).toMatchObject({ phase: 'error', waitingTool: null })
    // No invented permission decision or retry: a later allowed call can run.
    const following = await calls.start('following', 'later command')
    following.finish()
    await following.result
    expect(env.view()).toMatchObject({ phase: 'working', waitingTool: null })
  })

  for (const original of [
    { decision: { behavior: 'allow' as const, updatedInput: { command: 'edited by the existing hook' }, updatedPermissions: [{ type: 'setMode' as const, mode: 'default' as const, destination: 'session' as const }] } },
    { decision: { behavior: 'deny' as const, message: 'Existing hook refuses the call', interrupt: true as const } },
  ]) {
    test(`PermissionRequest ${original.decision.behavior} metadata remains unchanged`, async ($, on) => {
      let requests = 0
      on('classic.PermissionRequest', { tool_name: 'Bash' }, () => { requests++; return original })
      const env = environment(on)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await $.turn.start({ text: 'Existing hook', turnId: 'classic-verdict' })
      const returned = await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'command' } })
      expect(returned).toEqual(original)
      expect(requests).toBe(1)
      expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    })
  }

  test('only a long main turn emits one toast', async ($, on) => {
    const env = environment(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Test', turnId: 'turn-3' })
    await $.turn.complete({ answer: 'agent', durationMs: 120_000, agentId: 'agent-1', turnId: 'agent-turn', isAborted: false, reason: 'answer' })
    expect(env.toasts).toEqual([])
    await $.turn.complete({ answer: 'done', durationMs: 60_000, turnId: 'turn-3', isAborted: false, reason: 'answer' })
    expect(env.toasts).toHaveLength(1)
  })

  test('a new turn clears the preceding view while the saved session retains observed paths', async ($, on) => {
    const env = environment(on)
    on('tool.call', { tool: 'Write' }, (_, e) => ({ result: {
      type: 'create', filePath: e.file_path, content: e.content, originalFile: null, structuredPatch: PATCH,
    } }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'First', turnId: 'first' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'write-old', file_path: ROOT + '/old.ts', content: 'old' })
    await $.turn.complete({ answer: '', durationMs: 1, turnId: 'first', isAborted: false, reason: 'answer' })
    expect(env.view().last?.files).toEqual(['old.ts'])
    await $.turn.start({ text: 'Second', turnId: 'second' })
    expect(env.view().last).toBeNull()
    await $.tool.call({ tool: 'Write', tool_use_id: 'write-new', file_path: ROOT + '/new.ts', content: 'new' })
    const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE,
      surface: 'terminal', props: paneProps(), viewport: { columns: 180, rows: 50 } })
    expect(await ui.find({ text: 'old.ts' })).toBeUndefined()
    expect(await ui.find({ text: 'new.ts' })).toBeDefined()
    await ui.unmount()
    await $.turn.complete({ answer: '', durationMs: 1, turnId: 'second', isAborted: false, reason: 'answer' })
    expect(env.view().resume?.files).toEqual(['old.ts', 'new.ts'])
  })

  test('tests are unavailable while an errored main turn is still running', async ($, on) => {
    const env = environment(on, { 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }) })
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'Denied' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Work', turnId: 'active' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'error', command: 'false' })
    expect(env.view().phase).toBe('error')
    const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE,
      surface: 'terminal', props: paneProps(), viewport: { columns: 180, rows: 50 } })
    expect(await ui.find({ key: 'activity-run-tests' })).toBeUndefined()
    expect(env.processes.filter(argv => testLabel(argv.join(' ')))).toEqual([])
    await ui.unmount()
  })

  test('failed process tests require an action and a successful rerun clears that failure', {
    plugins: [{
      name: 'observed-test-process',
      register(on) {
        on('command.run', { command: 'observed-process-test' }, async $ => {
          const result = await $.process.run(['npm', 'test'], { cwd: await $.session.cwd() })
          return { text: '', exitCode: result.exitCode }
        })
      },
    }],
  }, async ($, on) => {
    const env = environment(on, { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) }, {}, [1, 0])
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Verify', turnId: 'failed-tests' })
    await $.command.run({ command: 'observed-process-test', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 } })
    await $.turn.complete({ answer: '', durationMs: 60_000, turnId: 'failed-tests', isAborted: false, reason: 'answer' })
    expect(env.view().phase).toBe('error')
    expect(env.view().last?.nextStep).toContain('failed tests')
    expect(env.toasts).toEqual(['Buddy needs attention. The summary is ready.'])
    const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE, surface: 'terminal', props: paneProps() })
    await ui.press({ key: 'activity-run-tests' })
    expect(env.view().phase).toBe('complete')
    expect(env.view().last?.nextStep).toBe('Review the changes before continuing.')
    expect(env.view().tests.map(test => test.status)).toEqual(['failed', 'passed'])
    expect(env.view().resume?.nextStep).toBe('Review the changes before continuing.')
    await ui.unmount()
  })

  test('directory changes reset evidence and execute tests and save summaries in the new project', async ($, on) => {
    const nextRoot = '/next'
    const env = environment(on, {
      [ROOT + '/package.json']: JSON.stringify({ scripts: { test: 'jest' } }),
      [nextRoot + '/package.json']: JSON.stringify({ scripts: { test: 'vitest' } }),
      [nextRoot + '/pnpm-lock.yaml']: '',
    })
    on('tool.call', { tool: 'Write' }, (_, e) => ({ result: { type: 'create', filePath: e.file_path, content: e.content, originalFile: null, structuredPatch: PATCH } }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Old work', turnId: 'old-project-turn' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'old-project-file', file_path: ROOT + '/old.ts', content: 'old' })
    env.setRoot(nextRoot)
    await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: nextRoot, cwd: nextRoot })
    expect(env.view()).toMatchObject({ phase: 'ready', files: [], last: null, testCommand: { label: 'pnpm test', argv: ['pnpm', 'test', '--run'] } })
    await $.turn.complete({ answer: '', durationMs: 1, turnId: 'old-project-turn', isAborted: false, reason: 'answer' })
    expect(env.writes).toEqual([])
    await $.turn.start({ text: 'New work', turnId: 'new-project-turn' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'new-project-file', file_path: nextRoot + '/new.ts', content: 'new' })
    await $.turn.complete({ answer: '', durationMs: 1, turnId: 'new-project-turn', isAborted: false, reason: 'answer' })
    expect(env.view().resume?.files).toEqual(['new.ts'])
    expect(env.writes.every(write => write.path === nextRoot + '/' + RESUME_FILE)).toBe(true)
    const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE, surface: 'terminal', props: paneProps() })
    await ui.press({ key: 'activity-run-tests' })
    expect(env.processes[env.processes.length - 1]).toEqual(['pnpm', 'test', '--run'])
    expect(env.processRoots[env.processRoots.length - 1]).toBe(nextRoot)
    await ui.unmount()
  })

  for (const links of [{ parent: true }, { target: true }]) {
    test(`summary persistence refuses a linked ${links.parent ? 'parent directory' : 'target file'}`, async ($, on) => {
      const env = environment(on, { [RESUME_FILE]: '{}' }, links)
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await $.turn.start({ text: 'Work', turnId: 'save-unsafe' })
      await $.turn.complete({ answer: '', durationMs: 1, turnId: 'save-unsafe', isAborted: false, reason: 'answer' })
      expect(env.writes).toEqual([])
      expect(env.view().message).toBe('Resume summary could not be saved.')
    })
  }
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`Activity actions on ${surface}`, () => {
    test('a completed turn leaves the prompt unchanged and keeps actions in its pane', async ($, on) => {
      const env = environment(on)
      on('tool.call', { tool: 'Write' }, (_, e) => ({ result: {
        type: 'create', filePath: e.file_path, content: e.content, originalFile: null, structuredPatch: PATCH,
      } }))
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      await $.turn.start({ text: 'Change', turnId: 'band-turn' })
      await $.tool.call({ tool: 'Write', tool_use_id: 'band-write', file_path: ROOT + '/app.ts', content: 'new' })
      await $.turn.complete({ answer: '', durationMs: 1, turnId: 'band-turn', isAborted: false, reason: 'answer' })
      const band = await $.ui.mount({ plugin: 'sth-usage', component: 'AbovePrompt', requestId: 'above-activity',
        surface, props: bandProps(), viewport: { columns: 180, rows: 50 } })
      expect(await band.find({ type: 'Text', text: 'Contenu existant' })).toBeDefined()
      expect(await band.find({ key: 'activity-band' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: '1 changed file · Tests not run' })).toBeUndefined()
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      expect(env.drafts).toEqual([])
      await $.command.run({ command: 'sth-activity', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 } })
      expect(env.panes).toContain(ACTIVITY_PANE)
      const pane = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE,
        surface, props: paneProps(), viewport: { columns: 180, rows: 50 } })
      expect(await pane.find({ type: 'Text', text: 'Turn summary' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '1 changed file' })).toBeDefined()
      await pane.press({ key: 'activity-diff' })
      expect(env.commands).toContain('diff')
      await pane.press({ key: 'activity-test-draft' })
      expect(env.drafts).toHaveLength(1)
      expect(env.drafts[0]).toContain('exit codes')
      await pane.unmount()
      await band.redraw(bandProps(true))
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: 'Contenu existant' })).toBeDefined()
      await band.redraw(bandProps(false, true))
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: 'Contenu existant' })).toBeDefined()
      await band.redraw(bandProps())
      await $.turn.start({ text: 'Next', turnId: 'band-next' })
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: 'Contenu existant' })).toBeDefined()
      await band.unmount()
    })

    test('a saved session leaves the prompt unchanged and opens through its command', async ($, on) => {
      const saved: ResumeSummary = { version: 1, savedAt: 100, objective: 'Terminer la tâche',
        files: ['app.ts'], tests: [], nextStep: 'Exécuter les tests.' }
      const env = environment(on, { [RESUME_FILE]: JSON.stringify(saved) })
      let submitted = 0
      on('prompt.submit', { origin: { kind: 'plugin' } }, () => { submitted++; return { text: '' } })
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      const band = await $.ui.mount({ plugin: 'sth-usage', component: 'AbovePrompt', requestId: 'above-resume',
        surface, props: bandProps(), viewport: { columns: 180, rows: 50 } })
      expect(await band.find({ type: 'Text', text: 'Contenu existant' })).toBeDefined()
      expect(await band.find({ key: 'activity-band' })).toBeUndefined()
      expect(await band.find({ type: 'Button' })).toBeUndefined()
      await $.command.run({ command: 'sth-resume', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 } })
      expect(env.panes).toContain(RESUME_PANE)
      expect(env.drafts).toEqual([])
      expect(submitted).toBe(0)
      await band.unmount()
    })

    test('resume loads without submission and only the explicit button fills a draft', async ($, on) => {
      const saved: ResumeSummary = { version: 1, savedAt: 100, objective: 'Corriger le bug',
        files: ['src/app.ts'], tests: [], nextStep: 'Exécuter les tests.' }
      const env = environment(on, { [RESUME_FILE]: JSON.stringify(saved) })
      let submissions = 0
      on('prompt.submit', { origin: { kind: 'plugin' } }, () => { submissions++; return { text: '' } })
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      expect(env.view().resume).toEqual(saved)
      expect(env.drafts).toEqual([])
      const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: RESUME_PANE,
        surface, props: paneProps(), viewport: { columns: 180, rows: 50 } })
      expect(await ui.find({ type: 'Button', key: 'resume-draft' })).toBeDefined()
      await ui.press({ key: 'resume-draft' })
      expect(env.drafts).toHaveLength(1)
      expect(env.drafts[0]).toContain('Corriger le bug')
      expect(submissions).toBe(0)
      await ui.unmount()
    })

    test('diff delegates to the builtin command and test execution needs a button press', async ($, on) => {
      const env = environment(on, { 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }) })
      await $.session.start({ cwd: ROOT, surface, isInteractive: true })
      expect(env.processes.filter(argv => testLabel(argv.join(' ')))).toEqual([])
      const ui = await $.ui.mount({ plugin: 'sth-usage', component: 'Pane', requestId: ACTIVITY_PANE,
        surface, props: paneProps(), viewport: { columns: 180, rows: 50 } })
      await ui.press({ key: 'activity-diff' })
      expect(env.commands).toContain('diff')
      await ui.press({ key: 'activity-run-tests' })
      expect(env.processes.filter(argv => testLabel(argv.join(' ')))).toEqual([['npm', 'test', '--', '--run']])
      expect(env.view().tests[0]).toMatchObject({ status: 'passed', exitCode: 0 })
      expect(env.view().testsRunning).toBe(false)
      expect(env.view().resume?.tests[0]).toMatchObject({ status: 'passed', exitCode: 0 })
      const persisted = env.writes.filter(write => write.path.endsWith(RESUME_FILE)).at(-1)
      expect(persisted).toBeDefined()
      expect(JSON.parse(persisted!.text).tests[0]).toMatchObject({ status: 'passed', exitCode: 0 })
      await ui.unmount()
    })
  })
}
