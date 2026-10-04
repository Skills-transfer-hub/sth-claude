import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { CatalogSkill, SkillsView } from '../types'

const RESOURCE = 'bundle::skills::algorithmic-art'
const VERSION = 'b9e19e6f44773509fbdd7001d77ff41a49a486c1'
const NEW_VERSION = '97152b9ed3a32532e82092860a55a9f932925cb6'
const CATALOG_SKILL: CatalogSkill = {
  catalogId: RESOURCE, providerId: 'default', folderName: 'skills', name: 'algorithmic-art',
  kind: 'skill', description: 'Local catalog fixture', version: VERSION,
}
const INSTALL_KEY = `install-default-${RESOURCE}`
const REMOVE_KEY = `remove-default-${RESOURCE}`
const CONFIRM_KEY = `confirm-default-${RESOURCE}`

function status(status = 'up-to-date', pinned = false) {
  return [{ resource_id: RESOURCE, resource_name: RESOURCE, provider_id: 'default', installed_version: VERSION,
    latest_version: status === 'outdated' ? NEW_VERSION : VERSION, status, pinned }]
}

function initial(statusValue = 'outdated', pinned = false): SkillsView {
  return { isLinked: true, providers: ['default'], catalog: null, filter: '', busy: null, message: null,
    isError: false, pendingRemoval: null, installed: [{ resourceName: RESOURCE, providerId: 'default',
      status: statusValue, isPinned: pinned, installedVersion: VERSION, latestVersion: NEW_VERSION }] }
}

function pane(): RenderPropsOf['Pane'] {
  return { title: 'STH', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
}

function catalogView(): SkillsView {
  return { ...initial(), installed: [], catalog: [CATALOG_SKILL] }
}

type ProcessValue = { exitCode: number; stdout: string; stderr: string }
type ProcessResult = ProcessValue | { deny: string }

function environment(on: On, view = initial(), response: (argv: readonly string[], index: number) => ProcessResult | Promise<ProcessResult> = () => ({ exitCode: 0, stdout: JSON.stringify(status()), stderr: '' })) {
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.env(on, { TERM_PROGRAM: '', TERM: 'xterm-256color', TMUX: '' })
  const values = new Map<string, unknown>([['skills', view], ['fika', { startedAt: null, hasPrompt: true, ready: false, playingUntil: null }]])
  const calls: string[][] = []
  const processRoots: (string | undefined)[] = []
  const toasts: string[] = []
  let cwd = '/project'
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: cwd }))
  on('classic.CwdChanged', () => ({}))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => e.path.endsWith('/.sth/project.json') ? { value: '{"providers":[{"id":"default"}]}' } : { deny: 'ENOENT: no such file' })
  on('tool.list', () => ({ value: [] }))
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
  on('process.run', async (_, e) => {
    calls.push([...e.argv])
    processRoots.push(e.init?.cwd)
    const result = await response(e.argv, calls.length)
    return 'deny' in result ? result : { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  return { values, calls, processRoots, toasts, setRoot: (root: string) => { cwd = root } }
}

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`STH skill operations on ${surface}`, () => {
    for (const operation of ['update', 'init', 'install', 'remove'] as const) {
      test(`a late ${operation} result cannot overwrite skills from a newly selected project`, async ($, on) => {
        let release = () => {}
        let markStarted = () => {}
        const waiting = new Promise<void>(resolve => { release = resolve })
        const started = new Promise<void>(resolve => { markStarted = resolve })
        const nextResource = 'bundle::skills::brand-guidelines'
        const nextStatus = status().map(row => ({ ...row, resource_id: nextResource, resource_name: nextResource }))
        const view = operation === 'init' ? { ...initial(), isLinked: false, providers: [], installed: [] }
          : operation === 'install' ? catalogView() : initial()
        const env = environment(on, view, async argv => {
          if (argv[1] === operation) {
            markStarted()
            await waiting
            return { exitCode: 0, stdout: operation === 'init' ? 'Projet initialisé.' : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated' }]), stderr: '' }
          }
          return { exitCode: 0, stdout: argv[1] === 'status' ? JSON.stringify(nextStatus) : '', stderr: '' }
        })
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        if (operation === 'init') await ui.input({ key: 'init-repository', text: 'Grandpied33/skills', kind: 'change' })
        if (operation === 'install') await ui.press({ key: 'tab-catalog' })
        if (operation === 'remove') await ui.press({ key: REMOVE_KEY })
        const action = ui.press({ key: operation === 'init' ? 'init-run' : operation === 'install' ? INSTALL_KEY
          : operation === 'remove' ? CONFIRM_KEY : 'update-all' })
        await started
        env.setRoot('/next')
        await $.classic.CwdChanged({ old_cwd: '/project', new_cwd: '/next', cwd: '/next' })
        expect(env.values.get('skills')).toMatchObject({ busy: null, catalog: null, filter: '', message: null, isError: false, installed: [{ resourceName: nextResource }] })
        release()
        await action
        expect(env.values.get('skills')).toMatchObject({ busy: null, message: null, isError: false, installed: [{ resourceName: nextResource }] })
        expect(env.calls.filter(argv => argv[1] === operation)).toHaveLength(1)
        const operationIndex = env.calls.findIndex(argv => argv[1] === operation)
        expect(env.processRoots[operationIndex]).toBe('/project')
        const statusIndex = env.calls.findIndex(argv => argv[1] === 'status')
        expect(env.processRoots[statusIndex]).toBe('/next')
        expect(env.toasts).toHaveLength(0)
        await ui.unmount()
      })
    }

    test('update preserves failed verification instead of announcing skills are current', async ($, on) => {
      const { values, calls, toasts } = environment(on, initial(), argv => argv[1] === 'status'
        ? { exitCode: 1, stdout: '{"error":"network error fetching latest versions","code":1}', stderr: '' }
        : { exitCode: 0, stdout: JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated', resolved_version: NEW_VERSION }]), stderr: '' })
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(calls.map(argv => argv.slice(1))).toEqual([['update', '--fail-on-changes', '--json'], ['status', '--json']])
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true })
      expect((values.get('skills') as SkillsView).message).toContain('network error fetching latest versions')
      expect(toasts.some(text => text.includes('skills up to date'))).toBe(false)
      await ui.unmount()
    })

    test('refresh success clears an earlier error and uses the real CLI version fields', async ($, on) => {
      const view = { ...initial(), message: 'Ancien problème réseau', isError: true }
      const { values, calls } = environment(on, view)
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'refresh' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, message: null,
        installed: [{ resourceName: RESOURCE, providerId: 'default', status: 'up-to-date', isPinned: false, installedVersion: VERSION, latestVersion: VERSION }] })
      expect(calls.map(argv => argv.slice(1))).toEqual([['status', '--json']])
      await ui.unmount()
    })

    test('pinned outdated resources are checked without attempting an update', async ($, on) => {
      const { calls } = environment(on, initial('outdated', true), () => ({ exitCode: 0, stdout: JSON.stringify(status('outdated', true)), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Check for updates')
      await ui.press({ key: 'update-all' })
      expect(calls.map(argv => argv.slice(1))).toEqual([['status', '--json']])
      expect(await ui.find({ type: 'Text', text: /Pinned/ })).toBeDefined()
      await ui.unmount()
    })

    test('successful updates use the verified status rather than a generic success message', async ($, on) => {
      const { values, calls } = environment(on, initial(), argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status()) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated', resolved_version: VERSION }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, message: 'Update complete · 1 up to date.' })
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Check for updates')
      expect(calls.map(argv => argv.slice(1))).toEqual([['update', '--fail-on-changes', '--json'], ['status', '--json']])
      await ui.unmount()
    })

    test('an update that leaves an unpinned outdated skill never declares completion', async ($, on) => {
      const { values } = environment(on, initial(), argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status('outdated')) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated' }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true, message: 'Update command completed · 1 skill still needs an update.' })
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Update (1)')
      await ui.unmount()
    })

    for (const [reportedStatus, label] of [['modified-locally', 'Locally modified'], ['unknown-baseline', 'Integrity not verified']] as const) {
      test(`remaining ${reportedStatus} never counts as a completed update`, async ($, on) => {
        const { values } = environment(on, initial(), argv => ({ exitCode: 0,
          stdout: argv[1] === 'status' ? JSON.stringify(status(reportedStatus)) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated' }]), stderr: '' }))
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: 'update-all' })
        expect(values.get('skills')).toMatchObject({ busy: null, isError: true, message: `Update command completed · 1 skill to verify (${label}).` })
        await ui.unmount()
      })
    }

    test('a timeout never retries an update using another installed binary', async ($, on) => {
      const { values, calls } = environment(on, initial(), argv => argv[1] === 'update'
        ? { deny: 'process timed out after 300000 ms' }
        : { exitCode: 0, stdout: JSON.stringify(status('outdated')), stderr: '' })
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(calls.filter(argv => argv[1] === 'update')).toHaveLength(1)
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true })
      expect((values.get('skills') as SkillsView).message).toContain('timed out')
      await ui.unmount()
    })

    test('an unavailable cached executable falls back and preserves the current error state', async ($, on) => {
      const { values, calls } = environment(on, initial(), (argv, index) => index > 1 && argv[0] === 'sth'
        ? { deny: 'ENOENT: executable not found' }
        : { exitCode: 0, stdout: JSON.stringify(status()), stderr: '' })
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'refresh' })
      await ui.press({ key: 'refresh' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false })
      expect(calls.some(argv => argv[0] === '/opt/homebrew/bin/sth')).toBe(true)
      await ui.unmount()
    })

    test('STH refusal protects local edits even after explicit removal confirmation', async ($, on) => {
      const { calls, values, toasts } = environment(on, initial('modified-locally'), argv => argv[1] === 'status'
        ? { exitCode: 0, stdout: JSON.stringify(status('modified-locally')), stderr: '' }
        : { exitCode: 1, stdout: JSON.stringify({ error: 'resource has local modifications; restore the original file before retrying' }), stderr: '' })
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: REMOVE_KEY })
      expect(calls).toHaveLength(0)
      expect(await ui.find({ type: 'Text', text: /STH protects local changes/ })).toBeDefined()
      await ui.press({ key: CONFIRM_KEY })
      expect(calls[0]?.slice(1)).toEqual(['remove', RESOURCE, '--provider', 'default', '--yes', '--json'])
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true, installed: [{ resourceName: RESOURCE, status: 'modified-locally' }] })
      expect((values.get('skills') as SkillsView).message).toContain('local modifications')
      expect(toasts.some(text => text.endsWith('algorithmic-art removed'))).toBe(false)
      await ui.unmount()
    })

    test('installation is verified against the requested provider and resource before reporting success', async ($, on) => {
      const { values, calls } = environment(on, catalogView(), argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status()) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'installed' }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'tab-catalog' })
      await ui.press({ key: INSTALL_KEY })
      expect(calls.map(argv => argv.slice(1))).toEqual([
        ['install', 'skills/algorithmic-art', '--provider', 'default', '--json'], ['status', '--json'],
      ])
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, message: 'algorithmic-art installed',
        installed: [{ resourceName: RESOURCE, providerId: 'default', status: 'up-to-date' }] })
      expect(await ui.find({ key: INSTALL_KEY })).toBeUndefined()
      await ui.press({ key: 'tab-installed' })
      expect(await ui.find({ key: REMOVE_KEY })).toBeDefined()
      await ui.unmount()
    })

    for (const scenario of [
      { name: 'absent', rows: [] },
      { name: 'reported only by another provider', rows: status().map(row => ({ ...row, provider_id: 'other' })) },
      { name: 'missing on disk', rows: status('missing') },
      { name: 'with an unknown integrity baseline', rows: status('unknown-baseline') },
      { name: 'healthy in one target but missing in another', rows: [...status(), ...status('missing')] },
    ]) {
      test(`installation cannot report success when the requested skill is ${scenario.name}`, async ($, on) => {
        const { values, toasts } = environment(on, catalogView(), argv => ({ exitCode: 0,
          stdout: argv[1] === 'status' ? JSON.stringify(scenario.rows) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'installed' }]), stderr: '' }))
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: 'tab-catalog' })
        await ui.press({ key: INSTALL_KEY })
        expect(values.get('skills')).toMatchObject({ busy: null, isError: true })
        expect((values.get('skills') as SkillsView).message).toContain('Installation not verified')
        expect(toasts.some(text => text === 'STH: algorithmic-art installed')).toBe(false)
        await ui.unmount()
      })
    }

    for (const otherProviderRemains of [false, true]) {
      test(`removal verifies only the requested provider (${otherProviderRemains ? 'other provider remains' : 'requested provider remains'})`, async ($, on) => {
        const rows = status().map(row => ({ ...row, provider_id: otherProviderRemains ? 'other' : 'default' }))
        const { values, calls } = environment(on, initial('up-to-date'), argv => ({ exitCode: 0,
          stdout: argv[1] === 'status' ? JSON.stringify(rows) : '{}', stderr: '' }))
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: REMOVE_KEY })
        expect(calls).toHaveLength(0)
        await ui.press({ key: CONFIRM_KEY })
        expect(calls.map(argv => argv.slice(1))).toEqual([
          ['remove', RESOURCE, '--provider', 'default', '--yes', '--json'], ['status', '--json'],
        ])
        expect(values.get('skills')).toMatchObject({ busy: null, isError: !otherProviderRemains })
        const message = (values.get('skills') as SkillsView).message
        if (otherProviderRemains) expect(message).toBe('skills/algorithmic-art removed')
        else expect(message).toContain('still installed')
        await ui.unmount()
      })
    }

    test('provider-qualified confirmation cannot remove the same-named skill from another provider', async ($, on) => {
      const view = { ...initial('up-to-date'), providers: ['default', 'other'], installed: [
        ...initial('up-to-date').installed, { ...initial('up-to-date').installed[0]!, providerId: 'other', isPinned: true },
      ] }
      const { calls, values } = environment(on, view, argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status().map(row => ({ ...row, provider_id: 'other', pinned: true }))) : '{}', stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: REMOVE_KEY })
      expect(values.get('skills')).toMatchObject({ pendingRemoval: `default:${RESOURCE}` })
      expect(await ui.find({ key: CONFIRM_KEY })).toBeDefined()
      expect(await ui.find({ key: `confirm-other-${RESOURCE}` })).toBeUndefined()
      expect(await ui.find({ key: `remove-other-${RESOURCE}` })).toBeDefined()
      await ui.press({ key: `cancel-default-${RESOURCE}` })
      expect(calls).toHaveLength(0)
      expect(values.get('skills')).toMatchObject({ pendingRemoval: null })
      await ui.press({ key: REMOVE_KEY })
      await ui.press({ key: CONFIRM_KEY })
      expect(calls.filter(argv => argv[1] === 'remove')).toEqual([['sth', 'remove', RESOURCE, '--provider', 'default', '--yes', '--json']])
      expect(values.get('skills')).toMatchObject({ isError: false, installed: [{ resourceName: RESOURCE, providerId: 'other', isPinned: true }] })
      await ui.unmount()
    })

    for (const operation of ['install', 'remove'] as const) {
      test(`a failed verification after ${operation} preserves the previous installed list`, async ($, on) => {
        const view = operation === 'install' ? catalogView() : initial('up-to-date')
        const { values } = environment(on, view, argv => argv[1] === 'status'
          ? { exitCode: 1, stdout: JSON.stringify({ error: 'status unavailable' }), stderr: '' }
          : { exitCode: 0, stdout: '{}', stderr: '' })
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: operation === 'install' ? 'tab-catalog' : REMOVE_KEY })
        await ui.press({ key: operation === 'install' ? INSTALL_KEY : CONFIRM_KEY })
        expect(values.get('skills')).toMatchObject({ busy: null, isError: true, installed: view.installed })
        expect((values.get('skills') as SkillsView).message).toContain('status not verified')
        await ui.unmount()
      })

      test(`two ${operation} clicks start only one mutation`, async ($, on) => {
        let release = () => {}
        let markStarted = () => {}
        const waiting = new Promise<void>(resolve => { release = resolve })
        const started = new Promise<void>(resolve => { markStarted = resolve })
        const view = operation === 'install' ? catalogView() : initial('up-to-date')
        const { calls, values } = environment(on, view, async argv => {
          if (argv[1] === operation) {
            markStarted()
            await waiting
            return { exitCode: 0, stdout: '{}', stderr: '' }
          }
          return { exitCode: 0, stdout: operation === 'install' ? JSON.stringify(status()) : '[]', stderr: '' }
        })
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: operation === 'install' ? 'tab-catalog' : REMOVE_KEY })
        const key = operation === 'install' ? INSTALL_KEY : CONFIRM_KEY
        const clicks = Promise.allSettled([ui.press({ key }), ui.press({ key })])
        await started
        expect(calls.filter(argv => argv[1] === operation)).toHaveLength(1)
        release()
        const results = await clicks
        expect(results.some(result => result.status === 'fulfilled')).toBe(true)
        expect(calls.filter(argv => argv[1] === operation)).toHaveLength(1)
        expect(calls.filter(argv => argv[1] === 'status')).toHaveLength(1)
        expect(values.get('skills')).toMatchObject({ busy: null, isError: false })
        await ui.unmount()
      })
    }

    test('malformed status rows are reported instead of replacing the installed list', async ($, on) => {
      const { values } = environment(on, initial(), () => ({ exitCode: 0, stdout: '[{"status":"up-to-date"}]', stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'refresh' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true, installed: [{ resourceName: RESOURCE }] })
      await ui.unmount()
    })

    test('a successful catalogue load clears errors and does not invent versions', async ($, on) => {
      const view = { ...initial(), message: 'Échec de chargement précédent', isError: true }
      const { values, calls } = environment(on, view, () => ({ exitCode: 0, stdout: JSON.stringify([{ catalog_id: 'bundle::skills::canvas-design', provider_id: 'default', resource_type: 'bundle', name: 'canvas-design', folder_name: 'skills', source_path: 'skills/canvas-design/SKILL.md', description: 'Create beautiful visual art.', artifact_kind: 'skill' }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'tab-catalog' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, message: null })
      expect(await ui.find({ key: 'install-default-bundle::skills::canvas-design' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Version · Not provided by the catalog' })).toBeDefined()
      expect(calls.map(argv => argv.slice(1))).toEqual([['list', '--json']])
      await ui.unmount()
    })
  })
}
