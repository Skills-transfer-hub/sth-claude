import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { SkillsView } from '../types'

const RESOURCE = 'bundle::skills::algorithmic-art'
const VERSION = 'b9e19e6f44773509fbdd7001d77ff41a49a486c1'
const NEW_VERSION = '97152b9ed3a32532e82092860a55a9f932925cb6'

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
  return { title: 'Skills STH', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
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
  return { values, calls, processRoots, toasts, setRoot: (root: string) => { cwd = root } }
}

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`STH skill operations on ${surface}`, () => {
    for (const operation of ['update', 'init'] as const) {
      test(`a late ${operation} result cannot overwrite skills from a newly selected project`, async ($, on) => {
        let release = () => {}
        let markStarted = () => {}
        const waiting = new Promise<void>(resolve => { release = resolve })
        const started = new Promise<void>(resolve => { markStarted = resolve })
        const nextResource = 'bundle::skills::brand-guidelines'
        const nextStatus = status().map(row => ({ ...row, resource_id: nextResource, resource_name: nextResource }))
        const view = operation === 'init' ? { ...initial(), isLinked: false, providers: [], installed: [] } : initial()
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
        const action = ui.press({ key: operation === 'init' ? 'init-run' : 'update-all' })
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
      expect(toasts.some(text => text.includes('skills à jour'))).toBe(false)
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
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Vérifier les mises à jour')
      await ui.press({ key: 'update-all' })
      expect(calls.map(argv => argv.slice(1))).toEqual([['status', '--json']])
      expect(await ui.find({ type: 'Text', text: /Épinglé/ })).toBeDefined()
      await ui.unmount()
    })

    test('successful updates use the verified status rather than a generic success message', async ($, on) => {
      const { values, calls } = environment(on, initial(), argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status()) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated', resolved_version: VERSION }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: false, message: 'Mise à jour terminée · 1 à jour.' })
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Vérifier les mises à jour')
      expect(calls.map(argv => argv.slice(1))).toEqual([['update', '--fail-on-changes', '--json'], ['status', '--json']])
      await ui.unmount()
    })

    test('an update that leaves an unpinned outdated skill never declares completion', async ($, on) => {
      const { values } = environment(on, initial(), argv => ({ exitCode: 0,
        stdout: argv[1] === 'status' ? JSON.stringify(status('outdated')) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated' }]), stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: 'update-all' })
      expect(values.get('skills')).toMatchObject({ busy: null, isError: true, message: 'Mise à jour exécutée · 1 skill reste à mettre à jour.' })
      expect((await ui.find({ key: 'update-all' }))?.props.label).toBe('Mettre à jour (1)')
      await ui.unmount()
    })

    for (const [reportedStatus, label] of [['modified-locally', 'Modifié localement'], ['unknown-baseline', 'Intégrité non vérifiée']] as const) {
      test(`remaining ${reportedStatus} never counts as a completed update`, async ($, on) => {
        const { values } = environment(on, initial(), argv => ({ exitCode: 0,
          stdout: argv[1] === 'status' ? JSON.stringify(status(reportedStatus)) : JSON.stringify([{ resource_name: RESOURCE, outcome: 'updated' }]), stderr: '' }))
        const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
        await ui.press({ key: 'update-all' })
        expect(values.get('skills')).toMatchObject({ busy: null, isError: true, message: `Mise à jour exécutée · 1 skill à vérifier (${label}).` })
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

    test('confirmed removal of local edits passes the confirmation through to STH', async ($, on) => {
      const { calls } = environment(on, initial('modified-locally'), argv => ({ exitCode: 0, stdout: argv[1] === 'status' ? '[]' : '{}', stderr: '' }))
      const ui = await $.ui.mount({ plugin: 'sth-usage', surface, component: 'Pane', requestId: 'sth-skills', props: pane() })
      await ui.press({ key: `remove-${RESOURCE}` })
      expect(calls).toHaveLength(0)
      expect(await ui.find({ type: 'Text', text: /modifications locales seront retirées/ })).toBeDefined()
      await ui.press({ key: `confirm-${RESOURCE}` })
      expect(calls[0]?.slice(1)).toEqual(['remove', RESOURCE, '--provider', 'default', '--yes', '--json'])
      await ui.unmount()
    })

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
      expect(await ui.find({ type: 'Text', text: 'Version · Non communiquée par le catalogue' })).toBeDefined()
      expect(calls.map(argv => argv.slice(1))).toEqual([['list', '--json']])
      await ui.unmount()
    })
  })
}
