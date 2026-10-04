import type { On, RenderPropsOf, SessionUsage, UiPane } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { detectStack, EMPTY_PROJECT } from '../hooks/project'
import { terminalRaster } from '../hooks/terminal-raster'
import type { ActivityView, ProjectView, SkillsView } from '../types'
import terminalUpdate from '../ui/terminal-frames/update'
import desktopUpdate from '../ui/frames/update'

const DOCS = 'https://github.com/Skills-transfer-hub/sth-releases/blob/main/README.md'
const PACKAGE = JSON.stringify({
  dependencies: { react: '^19.0.0' }, devDependencies: { typescript: '^5.0.0', vitest: '^3.0.0' },
  packageManager: 'pnpm@10.0.0', scripts: { test: 'vitest run' },
})
const USAGE: SessionUsage = {
  startedAt: 1_800_000_000_000,
  context: { tokens: 40_000, window: 200_000, percent: 20 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 25 }],
}

function paneProps(): RenderPropsOf['Pane'] {
  return { title: 'Buddy', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
}

function initialSkills(): SkillsView {
  return {
    isLinked: true, providers: ['github'], busy: null, filter: '', message: null,
    isError: false, pendingRemoval: null,
    installed: [{
      resourceName: 'team::guides/typescript', providerId: 'github', status: 'outdated', isPinned: false,
      installedVersion: '1.4.0', latestVersion: '2.1.0',
    }],
    catalog: [
      { catalogId: 'team::guides/typescript', providerId: 'github', folderName: 'guides', name: 'TypeScript', kind: 'skill', description: 'Conventions TypeScript.', version: '2.1.0' },
      { catalogId: 'team::guides/react', providerId: 'github', folderName: 'guides', name: 'React performance', kind: 'skill', description: 'Améliorer les composants React du projet.', version: '3.2.0' },
      { catalogId: 'team::guides/node', providerId: 'github', folderName: 'guides', name: 'Node.js', kind: 'skill', description: 'Conventions JavaScript pour Node.js.' },
      { catalogId: 'team::guides/python', providerId: 'github', folderName: 'guides', name: 'Python', kind: 'skill', description: 'Conventions Python.', version: '1.0.0' },
    ],
  }
}

function initialActivity(): ActivityView {
  return {
    phase: 'complete', waitingTool: null, objective: 'Ajouter un composant React',
    files: ['src/Card.tsx', 'src/Card.test.tsx'], tests: [{ label: 'pnpm test', status: 'passed', exitCode: 0 }],
    toolErrors: 0, message: null, testsRunning: false, testCommand: { label: 'pnpm test', argv: ['pnpm', 'test', '--run'] },
    last: {
      files: ['src/Card.tsx', 'src/Card.test.tsx'], tests: [{ label: 'pnpm test', status: 'passed', exitCode: 0 }],
      toolErrors: 0, durationMs: 90_000, reason: 'answer', nextStep: 'Relire les modifications.',
    },
    resume: {
      version: 1, savedAt: 1_800_000_000_000, objective: 'Ajouter un composant React',
      files: ['src/Card.tsx', 'src/Card.test.tsx'], tests: [{ label: 'pnpm test', status: 'passed', exitCode: 0 }],
      nextStep: 'Relire les modifications.',
    },
  }
}

function initialProject(): ProjectView {
  return {
    ...EMPTY_PROJECT, ...detectStack({ 'package.json': PACKAGE }), root: '/project',
    cliStatus: 'available', cliVersion: 'STH Alpha 0.2.43', cliBinary: 'sth', linked: true, providerCount: 1,
  }
}

function environment(on: On, initial: Record<string, unknown> = {}, missingSth = false) {
  mock.clock(on, { now: 1_800_000_000_000 })
  const values = new Map<string, unknown>(Object.entries({
    skills: initialSkills(), projectView: initialProject(), activityView: initialActivity(),
    skillsTab: 'installed', fika: { startedAt: null, hasPrompt: true, ready: false, playingUntil: null },
    ...initial,
  }))
  const processes: string[][] = []
  const panes: string[] = []
  const openPanes = new Map<string, UiPane>()
  const paneEvents: string[] = []
  const closes: string[] = []
  const focusRefusals: string[] = []
  const drafts: { text: string; mode: string }[] = []
  const commands: string[] = []
  const writes: string[] = []
  const contextRequests: string[] = []
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
  on('session.root', () => ({ value: '/project' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.usage', (_, e) => {
    contextRequests.push(e.breakdown ?? 'none')
    return { value: USAGE }
  })
  on('agent.list', () => ({ value: [
    { id: 'review', type: 'Review', description: 'Relit les modifications', status: 'running' },
    { id: 'test', type: 'Test', description: 'Tests terminés', status: 'completed' },
  ] }))
  on('env.get', { name: 'TMUX' }, () => ({ value: 'integration-terminal' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    if (e.path === '/project/package.json') return { value: PACKAGE }
    if (e.path === '/project/.sth/project.json') return { value: JSON.stringify({ providers: [{ id: 'github' }] }) }
    throw new Error('ENOENT: no such file')
  })
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('tool.list', () => ({ value: [] }))
  on('process.run', (_, e) => {
    processes.push([...e.argv])
    if (missingSth && e.argv[1] === 'version' && /(?:^|\/)sth(?:\.exe)?$/.test(e.argv[0] ?? '')) return { deny: 'ENOENT: executable not found' }
    return { value: {
      exitCode: 0, stdout: e.argv[1] === 'doctor' ? '[]' : e.argv[1] === 'version' ? 'STH Alpha 0.2.43'
        : e.argv[1] === 'status' ? JSON.stringify([{
          resource_name: 'team::guides/typescript', provider_id: 'github', status: 'up-to-date', pinned: false,
          installed_version: '2.1.0', latest_version: '2.1.0',
        }]) : 'v1',
      stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
    } }
  })
  on('ui.open', (_, e) => {
    panes.push(e.id)
    paneEvents.push(`open:${e.id}`)
    const focused = [...openPanes.values()].find(pane => pane.isFocused)
    // The native host cannot focus a target while another pane owns the keys.
    // Keeping this constraint here exposes an open-without-close regression.
    const grantsFocus = e.focus === true && (!focused || focused.id === e.id)
    if (e.focus && !grantsFocus) focusRefusals.push(e.id)
    const existing = openPanes.get(e.id)
    const isShown = grantsFocus || existing?.isShown === true || ![...openPanes.values()].some(pane => pane.isShown)
    if (isShown) for (const pane of openPanes.values()) pane.isShown = false
    if (grantsFocus) for (const pane of openPanes.values()) pane.isFocused = false
    openPanes.set(e.id, {
      id: e.id, title: e.title ?? e.id, isShown, isPlaced: true,
      isFocused: grantsFocus || existing?.isFocused === true,
    })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [...openPanes.values()].map(pane => ({ ...pane })) }))
  on('ui.close', (_, e) => {
    if (openPanes.delete(e.id)) {
      closes.push(e.id)
      paneEvents.push(`close:${e.id}`)
    }
    return { value: undefined }
  })
  on('ui.blit', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    drafts.push({ text: e.text, mode: e.mode })
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('command.list', () => ({ value: [{ name: 'diff', description: 'Diff', source: 'builtin' }] }))
  on('command.run', { command: 'diff' }, (_, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  return { values, processes, panes, openPanes, paneEvents, closes, focusRefusals, drafts, commands, writes, contextRequests }
}

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`Buddy workflow integration on ${surface}`, () => {
    test('missing STH shows its install guide before offering project initialization', async ($, on) => {
      const skills = { ...initialSkills(), isLinked: false, providers: [], installed: [], catalog: null }
      const { processes, drafts, panes, values } = environment(on, { skills, projectView: { ...EMPTY_PROJECT, cliStatus: 'missing' } }, true)
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: paneProps() })
      expect(await ui.find({ key: 'sth-installation-guide' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'brew install skills-transfer-hub/sth/sth' })).toBeDefined()
      expect(await ui.find({ key: 'init-run' })).toBeUndefined()
      expect(await ui.find({ key: 'init-repository' })).toBeUndefined()
      const links = await ui.findAll({ type: 'Link' })
      expect(links.some(link => link.props.href === DOCS)).toBe(true)
      expect(processes).toHaveLength(0)
      expect(drafts).toHaveLength(0)
      await ui.press({ key: 'sth-check-installation' })
      expect(panes).toEqual(['sth-doctor'])
      expect(values.get('projectView')).toMatchObject({ cliStatus: 'missing', busy: false })
      const doctor = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
      expect(await doctor.find({ key: 'sth-installation-guide' })).toBeDefined()
      expect(await doctor.find({ type: 'Text', text: 'scoop install sth' })).toBeDefined()
      await doctor.press({ key: 'sth-check-installation' })
      expect(values.get('projectView')).toMatchObject({ cliStatus: 'missing', busy: false })
      expect(processes.some(argv => ['install', 'init', 'login', 'test'].includes(argv[1] ?? ''))).toBe(false)
      expect(drafts).toHaveLength(0)
      await doctor.unmount()
      await ui.unmount()
    })

    test('shows catalogue-backed stack recommendations and real installed/latest versions', async ($, on) => {
      const { processes } = environment(on)
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: paneProps() })
      expect(await ui.find({ type: 'Text', text: 'Version · 1.4.0 → 2.1.0' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update available' })).toBeDefined()
      await ui.press({ key: 'tab-catalog' })
      expect(await ui.find({ key: 'recommend-github-team::guides/react' })).toBeDefined()
      expect(await ui.find({ key: 'recommend-github-team::guides/python' })).toBeUndefined()
      expect(await ui.find({ key: 'recommend-github-team::guides/typescript' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /Matches React \(project manifests\)/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Version · 3.2.0' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Version · Not provided by the catalog' })).toBeDefined()
      expect(processes).toHaveLength(0)
      await ui.unmount()
    })

    test('permission state overrides the work pose and exposes the exact tool waiting for approval', async ($, on) => {
      environment(on, { isWorking: true, activityView: { ...initialActivity(), phase: 'permission', waitingTool: 'Bash' } })
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      expect(await ui.find({ type: 'Text', text: 'Buddy is waiting for your permission (Bash)' })).toBeDefined()
      if (surface === 'terminal') {
        const drawing = await ui.find({ type: 'Raster' })
        expect(String(drawing?.key).startsWith('buddy-raster-update-')).toBe(true)
        expect(terminalUpdate.some(packet => terminalRaster(packet, drawing!.props.columns as number, drawing!.props.rows as number) === drawing?.props.cells)).toBe(true)
      } else {
        const client = await ui.find({ key: 'buddy-update', type: 'Client' })
        expect(client?.props.props).toMatchObject({ state: 'update', caption: 'Buddy is waiting for your permission (Bash)' })
        const drawing = await ui.drawn({ in: 'buddy-update' })
        expect(drawing.type).toBe('Svg')
        if (drawing.type !== 'Svg') throw new Error('Buddy must draw the permission pose')
        expect(desktopUpdate.some(frame => drawing.props.source.includes(frame))).toBe(true)
      }
      await ui.unmount()
    })

    test('typed STH commands run their own handlers and doctor performs only diagnostic probes', async ($, on) => {
      const { processes, panes, openPanes, closes, focusRefusals, drafts, writes } = environment(on)
      for (const command of ['sth-doctor', 'sth-activity', 'sth-resume']) {
        await $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 } })
      }
      expect(panes).toEqual(['sth-doctor', 'sth-activity', 'sth-resume'])
      expect([...openPanes.keys()]).toEqual(['sth-resume'])
      expect(closes).toEqual(['sth-doctor', 'sth-activity'])
      expect(focusRefusals).toHaveLength(0)
      expect(processes.some(argv => argv[0] === 'sth' && argv[1] === 'doctor' && argv[2] === '--json')).toBe(true)
      expect(processes.some(argv => ['install', 'init', 'login', 'test'].includes(argv[1] ?? ''))).toBe(false)
      expect(drafts).toHaveLength(0)
      expect(writes).toHaveLength(0)
    })

    test('More and Home replace the focused STH pane without retaining hidden tabs', async ($, on) => {
      const { processes, panes, openPanes, paneEvents, closes, focusRefusals, drafts, writes, contextRequests, values } = environment(on)
      openPanes.set('sth-usage', { id: 'sth-usage', title: 'Buddy · Usage', isPlaced: true, isShown: true, isFocused: true })
      const expectOnlyPane = (id: string) => {
        expect([...openPanes.keys()]).toEqual([id])
        expect(openPanes.get(id)).toMatchObject({ isShown: true, isFocused: true, isPlaced: true })
        expect(focusRefusals).toHaveLength(0)
      }
      let home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      expect(processes).toHaveLength(0)
      expect(contextRequests).toHaveLength(0)
      expect(await home.find({ key: 'nav-section' })).toBeUndefined()
      expect((await home.find({ key: 'nav-more' }))?.type).toBe('Button')
      expect(await home.find({ key: 'open-doctor' })).toBeUndefined()
      await home.press({ key: 'nav-more' })
      expect(await home.find({ key: 'open-doctor' })).toBeDefined()
      expect(await home.find({ key: 'open-context' })).toBeDefined()
      expect(await home.find({ key: 'open-resume' })).toBeDefined()
      await home.press({ key: 'nav-more' })
      expect(await home.find({ key: 'open-doctor' })).toBeUndefined()
      await home.press({ key: 'nav-more' })
      await home.press({ key: 'open-doctor' })
      expectOnlyPane('sth-doctor')
      expect(paneEvents).toEqual(['close:sth-usage', 'open:sth-doctor'])
      expect(processes.filter(argv => argv[0] === 'sth' && argv[1] === 'doctor' && argv[2] === '--json')).toHaveLength(1)
      await home.unmount()

      const doctor = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
      await doctor.press({ key: 'nav-home' })
      expectOnlyPane('sth-usage')
      await doctor.unmount()
      home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      await home.press({ key: 'open-skills' })
      expectOnlyPane('sth-skills')
      expect(processes.filter(argv => argv[0] === 'sth' && argv[1] === 'status' && argv[2] === '--json')).toHaveLength(1)
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, installed: [{ status: 'up-to-date', installedVersion: '2.1.0' }] })
      await home.unmount()

      const skills = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: paneProps() })
      expect(await skills.find({ type: 'Text', text: 'Version · 2.1.0' })).toBeDefined()
      expect(await skills.find({ key: 'tab-installed' })).toBeDefined()
      await skills.press({ key: 'nav-home' })
      expectOnlyPane('sth-usage')
      expect(closes).toContain('sth-skills')
      expect(openPanes.has('sth-skills')).toBe(false)
      await skills.unmount()
      home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      expect(await home.find({ key: 'tab-installed' })).toBeUndefined()
      expect(await home.find({ key: 'session-consumption' })).toBeDefined()
      if (!await home.find({ key: 'open-context' })) await home.press({ key: 'nav-more' })
      await home.press({ key: 'open-context' })
      expectOnlyPane('sth-context')
      expect(contextRequests).toEqual(['summary'])
      await home.unmount()

      const context = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-context', props: paneProps() })
      expect(await context.find({ type: 'Text', text: 'Context 40.0k/200.0k · 20 %' })).toBeDefined()
      expect(await context.find({ type: 'Text', text: 'Remaining quotas' })).toBeUndefined()
      expect(await context.find({ type: 'Text', text: 'Active agents · 1' })).toBeDefined()
      await context.redraw(paneProps())
      expect(contextRequests).toEqual(['summary'])
      await context.press({ key: 'nav-home' })
      expectOnlyPane('sth-usage')
      expect(panes).toEqual(['sth-doctor', 'sth-usage', 'sth-skills', 'sth-usage', 'sth-context', 'sth-usage'])
      expect(paneEvents).toEqual([
        'close:sth-usage', 'open:sth-doctor', 'close:sth-doctor', 'open:sth-usage',
        'close:sth-usage', 'open:sth-skills', 'close:sth-skills', 'open:sth-usage',
        'close:sth-usage', 'open:sth-context', 'close:sth-context', 'open:sth-usage',
      ])
      expect(processes.some(argv => ['install', 'init', 'login', 'test', 'update', 'remove'].includes(argv[1] ?? ''))).toBe(false)
      expect(drafts).toHaveLength(0)
      expect(writes).toHaveLength(0)
      await context.unmount()
    })

    test('opens doctor, turn summary and resume, with drafts requiring an explicit click', async ($, on) => {
      const { processes, panes, openPanes, drafts, commands, writes } = environment(on)
      openPanes.set('sth-usage', { id: 'sth-usage', title: 'Buddy · Usage', isPlaced: true, isShown: true, isFocused: true })
      let home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      expect(drafts).toHaveLength(0)
      await home.press({ key: 'nav-more' })
      await home.press({ key: 'open-doctor' })
      expect(processes.some(argv => argv[0] === 'sth' && argv[1] === 'doctor' && argv[2] === '--json')).toBe(true)
      expect(processes.some(argv => ['install', 'init', 'login', 'test'].includes(argv[1] ?? ''))).toBe(false)
      expect(drafts).toHaveLength(0)
      await home.unmount()
      const doctor = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-doctor', props: paneProps() })
      await doctor.press({ key: 'doctor-tests' })
      expect(drafts[0]?.text).toContain('pnpm run test')
      expect(drafts[0]?.text).toContain('tests that were not run')
      expect(drafts[0]?.mode).toBe('replace')
      await doctor.press({ key: 'nav-home' })
      await doctor.unmount()

      home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      await home.press({ key: 'open-activity' })
      await home.unmount()
      const activity = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-activity', props: paneProps() })
      expect(await activity.find({ type: 'Text', text: '2 changed files' })).toBeDefined()
      expect(await activity.find({ type: 'Text', text: '1 passed' })).toBeDefined()
      await activity.press({ key: 'activity-diff' })
      expect(commands).toEqual(['diff'])
      await activity.press({ key: 'activity-test-draft' })
      expect(drafts[1]?.text).toContain('check their exit codes')
      expect(drafts[1]?.mode).toBe('append')
      await activity.press({ key: 'nav-home' })
      await activity.unmount()

      home = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-usage', props: paneProps() })
      if (!await home.find({ key: 'open-resume' })) await home.press({ key: 'nav-more' })
      await home.press({ key: 'open-resume' })
      expect(panes).toEqual(['sth-doctor', 'sth-usage', 'sth-activity', 'sth-usage', 'sth-resume'])
      expect([...openPanes.keys()]).toEqual(['sth-resume'])
      await home.unmount()
      const resume = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-resume', props: paneProps() })
      expect(await resume.find({ type: 'Text', text: 'Objective' })).toBeDefined()
      expect(await resume.find({ type: 'Text', text: 'Ajouter un composant React' })).toBeDefined()
      expect(drafts).toHaveLength(2)
      await resume.press({ key: 'resume-draft' })
      expect(drafts[2]?.text).toContain('Resume this objective: Ajouter un composant React')
      expect(drafts[2]?.text).toContain("Check the current project state")
      expect(drafts[2]?.mode).toBe('append')
      expect(writes).toHaveLength(0)
      await resume.unmount()
    })
  })
}
