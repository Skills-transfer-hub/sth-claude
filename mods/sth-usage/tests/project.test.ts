import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { detectStack, doctorSummary, EMPTY_PROJECT, parseDoctorChecks, rankSkills } from '../hooks/project'
import type { ProjectView } from '../hooks/project'
import type { CatalogSkill } from '../types'

const DOCTOR_OUTPUT = JSON.stringify([
  { name: 'Project configuration', status: 'fail', detail: 'no provider configured', next_action: 'Run `sth init` to register at least one provider.' },
  { name: 'License expiry', status: 'skip', detail: 'no license cache (run `sth login`)', next_action: '' },
])

describe('Project evidence and skill recommendations', () => {
  test('detects declared frameworks and actual test scripts without executing them', () => {
    const detected = detectStack({
      'package.json': JSON.stringify({ dependencies: { react: '^19', next: '16' }, devDependencies: { typescript: '5', vitest: '3' }, packageManager: 'pnpm@10', scripts: { test: 'vitest run', 'test:e2e': 'playwright test', lint: 'eslint', 'test;rm': 'anything' } }),
    })
    expect(detected.stack).toContain('Next.js')
    expect(detected.stack).toContain('TypeScript')
    expect(detected.testCommands).toEqual(['pnpm run test', 'pnpm run test:e2e'])
    expect(detected.evidence).toEqual(['package.json'])
    expect(detectStack({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }).testCommands).toEqual([])
  })

  test('detects Python, Go, Rust and Unity from specific manifests', () => {
    const detected = detectStack({ 'pyproject.toml': '[project]\ndependencies = ["fastapi", "pytest"]', 'go.mod': 'module example', 'Cargo.toml': '[package]\nname = "example"', 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000' })
    expect(detected.stack).toEqual(['Python', 'FastAPI', 'pytest', 'Rust', 'Go', 'Unity'])
    expect(detected.testCommands).toEqual(['python -m pytest', 'cargo test', 'go test ./...'])
    expect(detectStack({ 'package.json': '{ malformed' }).stack).toEqual([])
  })

  test('matches only real catalog entries and preserves their data', () => {
    const catalog: CatalogSkill[] = [
      { catalogId: 'ts', providerId: 'team', folderName: 'guides', name: 'TypeScript', kind: 'skill', description: 'Conventions TypeScript et React' },
      { catalogId: 'rust', providerId: 'team', folderName: 'guides', name: 'Rust', kind: 'skill', description: 'Cargo workflows' },
      { catalogId: 'ongoing', providerId: 'team', folderName: 'ongoing', name: 'Goals', kind: 'skill', description: 'Ongoing planning' },
    ]
    const view = { ...EMPTY_PROJECT, stack: ['TypeScript', 'React'] }
    const rows = rankSkills(catalog, view)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.skill).toBe(catalog[0])
    expect(rows[0]?.score).toBe(2)
    expect(rows[0]?.reason).toContain('TypeScript, React')
    expect(rankSkills(catalog, { ...EMPTY_PROJECT, stack: ['Go'] })).toEqual([])
    expect(rankSkills(catalog, EMPTY_PROJECT)).toEqual([])
  })

  test('finds the mod test command without requiring a Node package', () => {
    const detected = detectStack({ 'tsconfig.json': '{}', '.claude-plugin/plugin.json': '{"name":"sth-usage"}' })
    expect(detected.stack).toEqual(['TypeScript', 'Claude Code'])
    expect(detected.testCommands).toEqual(['claude plugin test .'])
    expect(detectStack({ '.claude-plugin/plugin.json': '{}' }).testCommands).toEqual([])
  })

  test('parses the installed CLI JSON even when doctor fails, and rejects unknown statuses', () => {
    const rows = parseDoctorChecks(DOCTOR_OUTPUT)
    expect(rows?.[0]?.status).toBe('fail')
    expect(rows?.[0]?.action).toContain('sth init')
    expect(rows?.[1]?.action).toBeNull()
    expect(parseDoctorChecks('[{"name":"x","status":"ready"}]')).toBeNull()
    expect(parseDoctorChecks('not JSON')).toBeNull()
    expect(parseDoctorChecks('[null]')).toBeNull()
  })
})

function environment(on: On, processStatus: 'available' | 'missing' | 'unsupported') {
  const calls: readonly string[][] = []
  const recorded = calls as string[][]
  const reads: string[] = []
  let view: ProjectView = { ...EMPTY_PROJECT }
  let root = '/project'
  mock.clock(on, { now: 1_800_000_000_000 })
  on('state.set', { plugin: 'sth-usage', key: 'projectView' }, async (_, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) view = e.value
    return result
  })
  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('classic.CwdChanged', () => ({}))
  on('fs.exists', () => ({ value: false }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    reads.push(e.path)
    if (e.path === '/project/package.json') return { value: JSON.stringify({ devDependencies: { vitest: '3' }, scripts: { test: 'vitest run' } }) }
    if (e.path === '/project/.sth/project.json') return { value: JSON.stringify({ providers: [{ id: 'team', token: 'never display this' }] }) }
    return { deny: 'ENOENT: no such file' }
  })
  on('tool.list', () => ({ value: [{ name: 'mcp__sth__library_search', description: 'Search', mcp: true }, { name: 'Read', description: 'Read', mcp: false }] }))
  on('process.run', (_, e) => {
    recorded.push([...e.argv])
    if (processStatus === 'missing') return { deny: 'ENOENT: executable not found' }
    if (processStatus === 'unsupported') return { deny: 'process.run is unavailable on this desktop host' }
    return { value: { exitCode: e.argv[1] === 'doctor' ? 1 : 0, stdout: e.argv[1] === 'doctor' ? DOCTOR_OUTPUT : e.argv[1] === 'version' ? 'STH Alpha 0.2.43\ndev with Buddy' : 'v1', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }))
  return { calls, reads, view: () => view, setRoot: (value: string) => { root = value } }
}

describe('Read-only project diagnosis', () => {
  test('uses version probes and doctor argv, never executes tests or reads credentials', async ($, on) => {
    const env = environment(on, 'available')
    const { calls, reads } = env
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
    await ui.press({ key: 'doctor-refresh' })
    const view = env.view()
    expect(view.cliStatus).toBe('available')
    expect(view.cliVersion).toBe('STH Alpha 0.2.43')
    expect(view.linked).toBe(true)
    expect(view.checks[0]?.status).toBe('fail')
    expect(view.mcp).toEqual([{ name: 'sth', status: 'available', tools: 1, message: null }])
    expect(calls).toEqual([['sth', 'version'], ['git', '--version'], ['node', '--version'], ['npm', '--version'], ['sth', 'doctor', '--json']])
    expect(reads.some(file => /\.env|credential|secret/.test(file))).toBe(false)
    expect(doctorSummary(view)).not.toContain('never display this')
    expect(doctorSummary(view)).toContain('non exécutés')
    await ui.unmount()
  })

  test('distinguishes a missing binary from unsupported host execution', async ($, on) => {
    const env = environment(on, 'unsupported')
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'desktop', component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
    await ui.press({ key: 'doctor-refresh' })
    const view = env.view()
    expect(view.cliStatus).toBe('unknown')
    expect(view.cliBinary).toBeNull()
    expect(view.busy).toBe(false)
    await ui.unmount()
  })

  test('a directory change clears diagnostics and stack data from the previous project', async ($, on) => {
    const env = environment(on, 'available')
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface: 'terminal', component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
    await ui.press({ key: 'doctor-refresh' })
    expect(env.view().dependencies.length).toBeGreaterThan(0)
    expect(env.view().checks.length).toBeGreaterThan(0)
    env.setRoot('/next')
    await $.classic.CwdChanged({ old_cwd: '/project', new_cwd: '/next', cwd: '/next' })
    expect(env.view()).toMatchObject({ root: '/next', stack: [], evidence: [], testCommands: [], dependencies: [], checks: [], linked: false, busy: false })
    await ui.unmount()
  })
})

function paneProps(): RenderPropsOf['Pane'] {
  return { title: 'Diagnostic', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`missing STH shows verified install commands and refresh without installation (${surface})`, async ($, on) => {
    const env = environment(on, 'missing')
    const { calls } = env
    const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-doctor', props: paneProps(), viewport: { columns: 180, rows: 70 } })
    await ui.press({ key: 'doctor-refresh' })
    expect(env.view().cliStatus).toBe('missing')
    expect(await ui.find({ key: 'sth-installation-guide' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'brew install skills-transfer-hub/sth/sth' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'scoop install sth' })).toBeDefined()
    expect(await ui.find({ key: 'sth-check-installation' })).toBeDefined()
    expect(calls.some(argv => ['install', 'init', 'login', 'test'].includes(argv[1] ?? ''))).toBe(false)
    await ui.unmount()
  })
}
