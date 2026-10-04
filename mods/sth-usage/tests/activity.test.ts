import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
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
    on('tool.call', { tool: 'Bash' }, () => ({ deny: 'Existing policy refuses this command' }))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'Run tests', turnId: 'turn-2' })
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'bash-2' })
    expect(verdict).toEqual({ decision: 'ask', reason: 'Confirm before execution' })
    expect(env.view()).toMatchObject({ phase: 'permission', waitingTool: 'Bash' })
    const result = await $.tool.call({ tool: 'Bash', tool_use_id: 'bash-2', command: 'npm test' })
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
