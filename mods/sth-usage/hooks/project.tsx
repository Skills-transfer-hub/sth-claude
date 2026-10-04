import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register, RenderInput } from 'claude-code'
import type { CatalogSkill } from '../types'
import { panelChrome, paneNavigation } from './presentation'

export type ProjectView = {
  root: string
  stack: string[]
  evidence: string[]
  testCommands: string[]
  dependencies: { name: string; available: boolean; version: string | null; action: string | null }[]
  cliStatus: 'unknown' | 'available' | 'missing'
  cliVersion: string | null
  cliBinary: string | null
  linked: boolean
  providerCount: number
  checks: { name: string; status: 'pass' | 'fail' | 'skip'; detail: string; action: string | null }[]
  mcp: { name: string; status: 'available' | 'error'; tools: number; message: string | null }[]
  busy: boolean
  checkedAt: number | null
  message: string | null
}

export const EMPTY_PROJECT: ProjectView = {
  root: '', stack: [], evidence: [], testCommands: [], dependencies: [],
  cliStatus: 'unknown', cliVersion: null, cliBinary: null, linked: false, providerCount: 0,
  checks: [], mcp: [], busy: false, checkedAt: null, message: null,
}

export const projectView = atom({ plugin: 'sth-usage', key: 'projectView' } as const, EMPTY_PROJECT)
const PANE = 'sth-doctor'
const DOCS = 'https://github.com/Skills-transfer-hub/sth-releases/blob/main/README.md'
const RELEASES = 'https://github.com/Skills-transfer-hub/sth-releases/releases/latest'
const STH_BINARIES = ['sth', 'sth.exe', '/opt/homebrew/bin/sth', '/usr/local/bin/sth', '/home/linuxbrew/.linuxbrew/bin/sth']

export function safeDiagnosticText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\b(?:sk-|lsk_live_|gh[pousr]_|glpat-)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/]+:[^\s/@]+@/g, '$1[credentials hidden]@')
    .replace(/\b((?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 800)
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try { return object(JSON.parse(text)) } catch { return null }
}

export function parseDoctorChecks(text: string): ProjectView['checks'] | null {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  const rows = Array.isArray(parsed) ? parsed : object(parsed)?.checks
  if (!Array.isArray(rows)) return null
  const result: ProjectView['checks'] = []
  for (const value of rows) {
    const row = object(value)
    if (!row || typeof row.name !== 'string' || !['pass', 'fail', 'skip'].includes(String(row.status))) return null
    result.push({
      name: safeDiagnosticText(row.name), status: row.status as 'pass' | 'fail' | 'skip',
      detail: safeDiagnosticText(row.detail),
      action: safeDiagnosticText(row.next_action ?? row.remediation) || null,
    })
  }
  return result
}

type ManifestFiles = Partial<Record<'package.json' | 'pyproject.toml' | 'requirements.txt' | 'Cargo.toml' | 'go.mod' | 'ProjectSettings/ProjectVersion.txt' | 'tsconfig.json' | '.claude-plugin/plugin.json', string>>

/** Only manifest evidence is used; this never reads secrets or executes project scripts. */
export function detectStack(files: ManifestFiles, names: readonly string[] = []): Pick<ProjectView, 'stack' | 'evidence' | 'testCommands'> {
  const stack = new Set<string>()
  const evidence: string[] = []
  const testCommands: string[] = []
  const packageJson = parseObject(files['package.json'] ?? null)
  if (packageJson) {
    stack.add('Node.js')
    evidence.push('package.json')
    const dependencies = { ...object(packageJson.dependencies), ...object(packageJson.devDependencies) }
    const frameworks: Record<string, string> = {
      typescript: 'TypeScript', react: 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt',
      svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit', express: 'Express', '@nestjs/core': 'NestJS',
      vitest: 'Vitest', jest: 'Jest', '@playwright/test': 'Playwright', tailwindcss: 'Tailwind CSS',
      '@supabase/supabase-js': 'Supabase', '@prisma/client': 'Prisma',
    }
    for (const [name, label] of Object.entries(frameworks)) {
      if (name in dependencies) stack.add(label)
    }
    const declaredManager = typeof packageJson.packageManager === 'string' ? packageJson.packageManager.split('@')[0] : ''
    const manager = ['npm', 'pnpm', 'yarn', 'bun'].includes(declaredManager ?? '') ? declaredManager
      : names.includes('pnpm-lock.yaml') ? 'pnpm'
      : names.includes('bun.lock') || names.includes('bun.lockb') ? 'bun'
      : names.includes('yarn.lock') ? 'yarn' : 'npm'
    for (const [name, command] of Object.entries(object(packageJson.scripts) ?? {})) {
      if (typeof command !== 'string' || !/^test(?::[A-Za-z0-9_-]+)*$/.test(name)) continue
      if (/\b(?:echo\s+["']?Error: no test specified|exit\s+1)\b/.test(command)) continue
      testCommands.push(`${manager} run ${name}`)
    }
  }
  if (files['tsconfig.json']) {
    stack.add('TypeScript')
    evidence.push('tsconfig.json')
  }
  const python = [files['pyproject.toml'], files['requirements.txt']].filter(Boolean).join('\n')
  if (python) {
    stack.add('Python')
    if (files['pyproject.toml']) evidence.push('pyproject.toml')
    if (files['requirements.txt']) evidence.push('requirements.txt')
    for (const [pattern, label] of [[/\bfastapi\b/i, 'FastAPI'], [/\bdjango\b/i, 'Django'], [/\bflask\b/i, 'Flask'], [/\bpytest\b/i, 'pytest']] as const) {
      if (pattern.test(python)) stack.add(label)
    }
    if (stack.has('pytest')) testCommands.push('python -m pytest')
  }
  if (files['Cargo.toml']) { stack.add('Rust'); evidence.push('Cargo.toml'); testCommands.push('cargo test') }
  if (files['go.mod']) { stack.add('Go'); evidence.push('go.mod'); testCommands.push('go test ./...') }
  if (files['ProjectSettings/ProjectVersion.txt']) { stack.add('Unity'); evidence.push('ProjectSettings/ProjectVersion.txt') }
  const plugin = parseObject(files['.claude-plugin/plugin.json'] ?? null)
  if (typeof plugin?.name === 'string' && plugin.name.trim()) {
    stack.add('Claude Code')
    evidence.push('.claude-plugin/plugin.json')
    testCommands.push('claude plugin test .')
  }
  return { stack: [...stack], evidence, testCommands: [...new Set(testCommands)] }
}

const MATCH_TERMS: Record<string, string[]> = {
  'Node.js': ['node', 'nodejs', 'node.js', 'javascript'], TypeScript: ['typescript', 'tsx'],
  React: ['react', 'jsx'], 'Next.js': ['nextjs', 'next.js', 'next'], Vue: ['vue'], Nuxt: ['nuxt'],
  Svelte: ['svelte'], SvelteKit: ['sveltekit', 'svelte'], Express: ['express'], NestJS: ['nestjs', 'nest'],
  Vitest: ['vitest', 'testing', 'tests'], Jest: ['jest', 'testing', 'tests'], Playwright: ['playwright', 'e2e'],
  'Tailwind CSS': ['tailwind'], Supabase: ['supabase', 'postgres'], Prisma: ['prisma'], Python: ['python'],
  FastAPI: ['fastapi'], Django: ['django'], Flask: ['flask'], pytest: ['pytest', 'testing', 'tests'],
  Go: ['golang', 'go'], Rust: ['rust', 'cargo'], Unity: ['unity', 'csharp', 'c#'], 'Claude Code': ['claude', 'claudecode'],
}

export function rankSkills(catalog: readonly CatalogSkill[], view: ProjectView): { skill: CatalogSkill; reason: string; score: number }[] {
  return catalog.map(skill => {
    const terms = `${skill.name} ${skill.folderName} ${skill.description}`.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean)
    const matches = view.stack.filter(stack => (MATCH_TERMS[stack] ?? [stack.toLowerCase()]).some(term => terms.includes(term)))
    return { skill, reason: matches.length ? `Matches ${matches.join(', ')} (project manifests)` : '', score: matches.length }
  }).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, 4)
}

function joinRoot(root: string, file: string): string { return `${root.replace(/[\\/]$/, '')}/${file}` }

async function manifest($: EngineInterface, root: string, file: string): Promise<string | null> {
  try { return await $.fs.read(joinRoot(root, file)) } catch { return null }
}

async function probe($: EngineInterface, name: string, argv: readonly string[], root: string): Promise<ProjectView['dependencies'][number]> {
  try {
    const result = await $.process.run(argv, { cwd: root, timeoutMs: 5_000 })
    return {
      name, available: result.exitCode === 0,
      version: result.exitCode === 0 ? safeDiagnosticText(result.stdout || result.stderr).split('\n')[0]?.slice(0, 160) || null : null,
      action: result.exitCode === 0 ? null : `Check ${name} and its availability in the Claude Code terminal.`,
    }
  } catch {
    return { name, available: false, version: null, action: `Install ${name} or check its PATH, then run /sth-doctor again.` }
  }
}

async function detectCli($: EngineInterface, root: string): Promise<Pick<ProjectView, 'cliStatus' | 'cliVersion' | 'cliBinary'>> {
  let inaccessible = false
  for (const candidate of STH_BINARIES) {
    try {
      const result = await $.process.run([candidate, 'version'], { cwd: root, timeoutMs: 5_000 })
      return { cliStatus: 'available', cliBinary: candidate, cliVersion: result.exitCode === 0 ? safeDiagnosticText(result.stdout).split('\n')[0] || null : null }
    } catch (failure) {
      // A desktop host may not support process.run. Only an explicit missing
      // executable is evidence that STH is absent; other failures remain unknown.
      if (!/ENOENT|not found|no such file|cannot find|introuvable/i.test(String(failure))) inaccessible = true
    }
  }
  return { cliStatus: inaccessible ? 'unknown' : 'missing', cliBinary: null, cliVersion: null }
}

function serverName(tool: string): string | null {
  const match = /^mcp__(.+?)__/.exec(tool)
  return match?.[1] ?? null
}

async function availableMcp($: EngineInterface, previous: ProjectView['mcp']): Promise<ProjectView['mcp']> {
  try {
    const counts = new Map<string, number>()
    for (const tool of await $.tool.list()) {
      const name = tool.mcp ? serverName(tool.name) : null
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const rows: ProjectView['mcp'] = [...counts].map(([name, tools]) => {
      const failure = previous.find(row => row.name === name && row.status === 'error')
      return { name, tools, status: failure ? 'error' : 'available', message: failure?.message ?? null }
    })
    for (const row of previous) if (row.status === 'error' && !counts.has(row.name)) rows.push({ ...row, tools: 0 })
    return rows
  } catch { return previous }
}

async function setProject($: EngineInterface, changes: Partial<ProjectView>, epoch?: number): Promise<void> {
  await update($, projectView, previous => epoch !== undefined && epoch !== projectEpoch ? previous : { ...previous, ...changes })
  $.ui.invalidate('ui.render')
}

let pending: Promise<ProjectView> | null = null
let pendingFull = false
let projectEpoch = 0

export async function refreshProject($: EngineInterface, full = true): Promise<ProjectView> {
  if (pending) {
    const wasFull = pendingFull
    const result = await pending
    return full && !wasFull ? refreshProject($, true) : result
  }
  const epoch = projectEpoch
  pendingFull = full
  pending = (async () => {
    await setProject($, { busy: true, message: null }, epoch)
    try {
      const root = await $.session.root()
      const keys = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'ProjectSettings/ProjectVersion.txt', 'tsconfig.json', '.claude-plugin/plugin.json'] as const
      const values = await Promise.all(keys.map(file => manifest($, root, file)))
      const files: ManifestFiles = {}
      keys.forEach((key, index) => { if (values[index] !== null) files[key] = values[index]! })
      let names: string[] = []
      try { names = (await $.fs.list(root)).map(entry => entry.name) } catch { /* manifest evidence still works */ }
      const detected = detectStack(files, names)
      const cli = await detectCli($, root)
      const config = parseObject(await manifest($, root, '.sth/project.json'))
      const providers = Array.isArray(config?.providers) ? config.providers.filter(provider => typeof object(provider)?.id === 'string') : []
      let checks: ProjectView['checks'] = []
      let message: string | null = null
      let dependencies: ProjectView['dependencies'] = []
      if (full) {
        const commands: { name: string; argv: readonly string[] }[] = [{ name: 'Git', argv: ['git', '--version'] }]
        if (detected.stack.includes('Node.js')) {
          commands.push({ name: 'Node.js', argv: ['node', '--version'] })
          const manager = detected.testCommands[0]?.split(' ')[0] ?? (names.includes('pnpm-lock.yaml') ? 'pnpm' : names.includes('yarn.lock') ? 'yarn' : names.some(name => name.startsWith('bun.lock')) ? 'bun' : 'npm')
          commands.push({ name: manager, argv: [manager, '--version'] })
        }
        if (detected.stack.includes('Python')) commands.push({ name: 'Python', argv: ['python3', '--version'] })
        if (detected.stack.includes('Rust')) commands.push({ name: 'Cargo', argv: ['cargo', '--version'] })
        if (detected.stack.includes('Go')) commands.push({ name: 'Go', argv: ['go', 'version'] })
        if (detected.stack.includes('Claude Code')) commands.push({ name: 'Claude Code', argv: ['claude', '--version'] })
        dependencies = await Promise.all(commands.map(command => probe($, command.name, command.argv, root)))
        if (detected.stack.includes('Python')) {
          const pythonIndex = dependencies.findIndex(dep => dep.name === 'Python')
          const python3 = dependencies[pythonIndex]
          if (python3?.available) detected.testCommands = detected.testCommands.map(command => command.replace(/^python /, 'python3 '))
          else if (pythonIndex >= 0) dependencies[pythonIndex] = await probe($, 'Python', ['python', '--version'], root)
        }
        if (cli.cliBinary) {
          try {
            const result = await $.process.run([cli.cliBinary, 'doctor', '--json'], { cwd: root, timeoutMs: 30_000 })
            const parsed = parseDoctorChecks(result.stdout)
            if (parsed) checks = parsed
            else message = 'This STH version does not provide a recognized JSON diagnostic. Prepare a prompt to inspect sth doctor.'
          } catch { message = 'STH diagnostics are unavailable or timed out. Check the terminal and network, then run /sth-doctor again.' }
        }
      }
      const previous = await read($, projectView)
      const mcp = await availableMcp($, previous.root === root ? previous.mcp : [])
      await setProject($, {
        root, ...detected, ...cli, linked: providers.length > 0, providerCount: providers.length,
        dependencies, checks, mcp, message, busy: false, checkedAt: await $.clock.now(),
      }, epoch)
    } catch {
      await setProject($, { busy: false, message: 'Unable to read the project. Check its directory and terminal permissions.' }, epoch)
    }
    return read($, projectView)
  })()
  try { return await pending } finally { pending = null; pendingFull = false }
}

function externalLink($: EngineInterface, e: RenderInput<'Pane'>, href: string, label: string) {
  const { Link, Text } = $.ui.resolve(e)
  return e.surface === 'terminal'
    ? <Link href={href}><Text underline>{label}</Text></Link>
    : <Link href={href} label={label} />
}

export function InstallationGuide($: EngineInterface, e: RenderInput<'Pane'>, view: ProjectView) {
  const { Box, Text } = $.ui.resolve(e)
  const { Card, Button, Toolbar } = panelChrome($.ui.resolve(e), e)
  return (
    <Card key="sth-installation-guide">
      <Text bold>Install STH</Text>
      <Text dimColor>1. Copy the appropriate command into your terminal.</Text>
      <Box flexDirection="column">
        <Text bold>macOS / Linux with Homebrew</Text>
        <Text>brew install skills-transfer-hub/sth/sth</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold>Windows with Scoop</Text>
        <Text>scoop bucket add sth https://github.com/Skills-transfer-hub/scoop-sth</Text>
        <Text>scoop install sth</Text>
        <Text dimColor>Other Windows package managers: winget install STH.STH · choco install sth</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor>Without a package manager: download the archive, verify SHA256SUMS and add sth to PATH.</Text>
        {externalLink($, e, RELEASES, 'Download STH (official releases)')}
      </Box>
      <Box flexDirection="column">
        <Text>2. Verify the installation: sth version</Text>
        <Text>3. In your project: sth init, then /sth-doctor in Claude Code.</Text>
        <Text dimColor>Still unable to find STH? Restart the Claude Code terminal to reload PATH.</Text>
      </Box>
      <Toolbar>
        {view.busy ? <Text dimColor>Checking…</Text> : <Button key="sth-check-installation" label="Check installation again" onPress={() => refreshProject($, true).then(() => undefined)} />}
        {externalLink($, e, DOCS, "Official installation guide")}
      </Toolbar>
    </Card>
  )
}

export const renderInstallationGuide = InstallationGuide

async function prepareDraft($: EngineInterface, text: string): Promise<void> {
  const result = await $.prompt.fill({ text, mode: 'replace' })
  $.ui.toast(result.isFilled ? 'Draft prepared: review it before sending.' : 'Draft unavailable on this surface.')
}

export function doctorSummary(view: ProjectView): string {
  return [
    `Project: ${view.root || 'unavailable'}`,
    `Stack: ${view.stack.join(', ') || 'no recognized manifest'}`,
    `Available tests (not run): ${view.testCommands.join(' ; ') || 'no command detected'}`,
    `STH: ${view.cliStatus === 'missing' ? 'missing' : view.cliVersion ?? 'unverified version'}`,
    `STH project: ${view.linked ? `${view.providerCount} provider(s)` : 'configure with sth init'}`,
    ...view.dependencies.map(dep => `${dep.name} : ${dep.available ? dep.version ?? 'available' : 'unavailable'}${dep.action ? ` · ${dep.action}` : ''}`),
    ...view.checks.map(check => `${check.status} · ${check.name} : ${check.detail}${check.action ? ` · ${check.action}` : ''}`),
    `MCP: ${view.mcp.length ? view.mcp.map(server => `${safeDiagnosticText(server.name)} (${server.tools} tools, ${server.status === 'error' ? 'observed error' : 'available'})`).join(', ') : 'no exposed MCP tools'}`,
    'MCP: status inferred from exposed tools and observed calls; connections without tools are unverified.',
    ...(view.message ? [view.message] : []),
  ].join('\n')
}

export function registerProject(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.command.register({ name: 'sth-doctor', description: 'Project, STH and MCP tool diagnostics; tests are not run' })
    void refreshProject($, false)
    return next(e)
  })
  on('classic.CwdChanged', { new_cwd: /^/ }, async ($, e, next) => {
    projectEpoch += 1
    const result = await next(e)
    // Wait out the previous project's read before replacing it. A quick read
    // clears dependencies/checks that belonged to the old directory.
    if (pending) await pending
    await refreshProject($, false)
    return result
  })
  on('command.run', { command: 'sth-doctor' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Buddy · Diagnostics', focus: true })
    return { text: doctorSummary(await refreshProject($, true)) }
  })
  on('ui.press', { plugin: 'sth-usage', element: /^(open-doctor|skills-doctor|sth-check-installation)$/, requestId: /^(sth-usage|sth-skills)$/ }, async ($, e, next) => {
    const result = await next(e)
    await refreshProject($, true)
    return result
  })
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const name = serverName(e.tool)
    try {
      const result = await next(e)
      if (name) {
        const nested = 'result' in result ? object(result.result) : null
        const isError = Boolean(result.deny || result.isError || nested?.isError)
        await update($, projectView, view => {
          const old = view.mcp.find(row => row.name === name)
          const row: ProjectView['mcp'][number] = { name, tools: old?.tools ?? 0, status: isError ? 'error' : 'available', message: isError ? 'The last call reported an error. Check /mcp and retry the call.' : null }
          return { ...view, mcp: [...view.mcp.filter(row => row.name !== name), row] }
        })
        $.ui.invalidate('ui.render')
      }
      return result
    } catch (failure) {
      if (name) {
        await update($, projectView, view => ({ ...view, mcp: [...view.mcp.filter(row => row.name !== name), { name, tools: view.mcp.find(row => row.name === name)?.tools ?? 0, status: 'error' as const, message: 'The last MCP call failed. Check /mcp.' }] }))
        $.ui.invalidate('ui.render')
      }
      throw failure
    }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, projectView)
    const { Box, Text } = $.ui.resolve(e)
    const { Page, Card, Button, Toolbar } = panelChrome($.ui.resolve(e), e)
    return (
      <Page>
        {paneNavigation($.ui.resolve(e), e, PANE, pane => $.ui.open(pane))}
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
          <Box flexDirection="column">
            <Text bold>Project diagnostics</Text>
            <Text dimColor>Check the environment and prepare the next steps.</Text>
          </Box>
          <Toolbar>
            {view.busy ? <Text dimColor>Checking…</Text> : <Button key="doctor-refresh" label="Refresh diagnostics" variant="primary" onPress={() => refreshProject($, true).then(() => undefined)} />}
          </Toolbar>
        </Box>
        {view.message ? <Text>{view.message}</Text> : null}
        <Card>
          <Text bold>Project</Text>
          <Box flexDirection="column">
            <Text dimColor>{view.root || 'Reading project…'}</Text>
            <Text>Stack: {view.stack.join(' · ') || 'no recognized manifest'}</Text>
            <Text dimColor>Sources: {view.evidence.join(', ') || 'to verify'}</Text>
          </Box>
        </Card>
        {view.cliStatus === 'missing' ? InstallationGuide($, e, view) : (
          <Card>
            <Text bold>STH connection</Text>
            <Box flexDirection="column">
              <Text>STH: {view.cliVersion ?? (view.cliStatus === 'unknown' ? 'access to verify' : 'unverified version')}</Text>
              <Text>{view.linked ? `${view.providerCount} configured provider(s)` : 'STH project needs setup'}</Text>
            </Box>
            {!view.linked ? <Button key="doctor-configure" label="Set up STH" onPress={() => $.ui.open({ id: 'sth-skills', title: 'Buddy · STH', focus: true }).then(() => undefined)} /> : null}
          </Card>
        )}
        <Card>
          <Text bold>Dependencies</Text>
          {!view.dependencies.length ? <Text dimColor>Refresh diagnostics to check the project binaries.</Text> : null}
          <Box flexDirection="column">
            {view.dependencies.map(dep => <Box key={`dependency-${dep.name}`} flexDirection="column">
              <Text>{dep.name} : {dep.available ? dep.version ?? 'available' : 'unavailable'}</Text>
              {dep.action ? <Text dimColor>{dep.action}</Text> : null}
            </Box>)}
          </Box>
        </Card>
        {view.checks.length > 0 && <Card>
          <Text bold>STH checks</Text>
          {view.checks.map((check, index) => <Box key={`check-${index}`} flexDirection="column">
            <Text color={check.status === 'fail' ? 'red' : undefined}>{check.status === 'pass' ? 'OK' : check.status === 'fail' ? 'Needs attention' : 'Unverified'} · {check.name}</Text>
            <Text>{check.detail}</Text>
            {check.action ? <Text dimColor>{check.action}</Text> : null}
            {check.status === 'fail' ? <Button key={`remedy-${index}`} label="Prepare diagnostics" onPress={() => prepareDraft($, `STH diagnostics report: ${check.name}. Details: ${check.detail}. CLI suggestion: ${check.action ?? 'none'}. Review the issue and suggest a fix before any destructive action or installation.`)} /> : null}
          </Box>)}
        </Card>}
        <Card>
          <Text bold>Tests · not run by diagnostics</Text>
          <Box flexDirection="column">
            {view.testCommands.length ? view.testCommands.map(command => <Text key={`test-${command}`}>{command}</Text>) : <Text dimColor>No test command found in the manifests.</Text>}
          </Box>
          <Button key="doctor-tests" label="Prepare a verification prompt" onPress={() => prepareDraft($, `Verify the project changes. ${view.testCommands.length ? `The manifests list: ${view.testCommands.join(' ; ')}. Choose appropriate checks and explain the results.` : 'First identify appropriate checks for the project and explain which ones you can run.'} Explicitly report any tests that were not run.`)} />
        </Card>
        <Card>
          <Text bold>MCP tools</Text>
          <Box flexDirection="column">
            {view.mcp.length ? view.mcp.map(server => <Box key={`mcp-${server.name}`} flexDirection="column">
              <Text color={server.status === 'error' ? 'red' : undefined}>{safeDiagnosticText(server.name)} : {server.tools} exposed tools{server.status === 'error' ? ' · observed error' : ''}</Text>
              {server.message ? <Text dimColor>{server.message}</Text> : null}
            </Box>) : <Text dimColor>No exposed MCP tools in this session.</Text>}
          </Box>
          <Text dimColor>Status based on exposed tools and observed calls. Connections without tools are unverified.</Text>
          <Button key="doctor-mcp" label="Prepare MCP diagnostics" onPress={() => prepareDraft($, 'Review the MCP errors observed in this session and explain how to check the connections in /mcp. Suggest any necessary fixes.')} />
        </Card>
      </Page>
    )
  })
}

export const register: Register = on => registerProject(on)
