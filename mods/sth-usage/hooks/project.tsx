import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register, RenderInput } from 'claude-code'
import type { CatalogSkill } from '../types'

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
    .replace(/\b(?:sk-|lsk_live_|gh[pousr]_|glpat-)[A-Za-z0-9_-]+/g, '[secret masqué]')
    .replace(/(https?:\/\/)[^\s/]+:[^\s/@]+@/g, '$1[identifiants masqués]@')
    .replace(/\b((?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*[=:]\s*)[^\s,;]+/gi, '$1[secret masqué]')
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
    return { skill, reason: matches.length ? `Adapté à ${matches.join(', ')} (manifestes du projet)` : '', score: matches.length }
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
      action: result.exitCode === 0 ? null : `Vérifier ${name} et son accès depuis le terminal de Claude Code.`,
    }
  } catch {
    return { name, available: false, version: null, action: `Installer ${name} ou vérifier son PATH, puis relancer /sth-doctor.` }
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
            else message = 'Cette version de STH ne fournit pas un diagnostic JSON reconnu. Préparer un prompt pour examiner sth doctor.'
          } catch { message = 'Diagnostic STH indisponible ou délai dépassé. Relancer /sth-doctor après vérification du terminal et du réseau.' }
        }
      }
      const previous = await read($, projectView)
      const mcp = await availableMcp($, previous.root === root ? previous.mcp : [])
      await setProject($, {
        root, ...detected, ...cli, linked: providers.length > 0, providerCount: providers.length,
        dependencies, checks, mcp, message, busy: false, checkedAt: await $.clock.now(),
      }, epoch)
    } catch {
      await setProject($, { busy: false, message: 'Impossible de lire le projet. Vérifier son dossier et les permissions du terminal.' }, epoch)
    }
    return read($, projectView)
  })()
  try { return await pending } finally { pending = null; pendingFull = false }
}

function externalLink($: EngineInterface, e: RenderInput<'Pane'>, href: string, label: string) {
  const { Link, Text } = $.ui.resolve(e)
  return e.surface === 'terminal'
    ? <Link href={href}><Text color="blue" underline>{label}</Text></Link>
    : <Link href={href} label={label} />
}

export function InstallationGuide($: EngineInterface, e: RenderInput<'Pane'>, view: ProjectView) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box key="sth-installation-guide" flexDirection="column" gap={1}>
      <Text bold>Installer STH</Text>
      <Text>1. Dans votre terminal, choisissez votre système :</Text>
      <Text bold>macOS / Linux avec Homebrew</Text>
      <Text>brew install skills-transfer-hub/sth/sth</Text>
      <Text bold>Windows avec Scoop</Text>
      <Text>scoop bucket add sth https://github.com/Skills-transfer-hub/scoop-sth</Text>
      <Text>scoop install sth</Text>
      <Text dimColor>Autres gestionnaires Windows : winget install STH.STH · choco install sth</Text>
      <Text>Sans gestionnaire : télécharger l'archive de votre système, vérifier SHA256SUMS et ajouter sth au PATH.</Text>
      {externalLink($, e, RELEASES, 'Télécharger STH (releases officielles)')}
      <Text>2. Vérifier : sth version</Text>
      <Text>3. Dans votre projet : sth init, puis /sth-doctor dans Claude Code.</Text>
      <Text dimColor>Si le binaire reste invisible, redémarrer le terminal de Claude Code pour recharger le PATH.</Text>
      {externalLink($, e, DOCS, "Documentation officielle d'installation")}
      {view.busy ? <Text dimColor>Vérification…</Text> : <Button key="sth-check-installation" label="Re-vérifier l'installation" onPress={() => refreshProject($, true).then(() => undefined)} />}
    </Box>
  )
}

export const renderInstallationGuide = InstallationGuide

async function prepareDraft($: EngineInterface, text: string): Promise<void> {
  const result = await $.prompt.fill({ text, mode: 'replace' })
  $.ui.toast(result.isFilled ? 'Brouillon préparé : relisez-le avant de l’envoyer.' : 'Brouillon indisponible sur cette surface.')
}

export function doctorSummary(view: ProjectView): string {
  return [
    `Projet : ${view.root || 'indisponible'}`,
    `Stack : ${view.stack.join(', ') || 'aucun manifeste reconnu'}`,
    `Tests disponibles (non exécutés) : ${view.testCommands.join(' ; ') || 'aucune commande détectée'}`,
    `STH : ${view.cliStatus === 'missing' ? 'absent' : view.cliVersion ?? 'version non vérifiée'}`,
    `Projet STH : ${view.linked ? `${view.providerCount} provider(s)` : 'à configurer avec sth init'}`,
    ...view.dependencies.map(dep => `${dep.name} : ${dep.available ? dep.version ?? 'disponible' : 'indisponible'}${dep.action ? ` · ${dep.action}` : ''}`),
    ...view.checks.map(check => `${check.status} · ${check.name} : ${check.detail}${check.action ? ` · ${check.action}` : ''}`),
    `MCP : ${view.mcp.length ? view.mcp.map(server => `${safeDiagnosticText(server.name)} (${server.tools} outils, ${server.status === 'error' ? 'erreur observée' : 'disponibles'})`).join(', ') : 'aucun outil MCP exposé'}`,
    'MCP : état déduit des outils exposés et des appels observés ; les connexions sans outils ne sont pas vérifiées.',
    ...(view.message ? [view.message] : []),
  ].join('\n')
}

export function registerProject(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    await $.command.register({ name: 'sth-doctor', description: 'Diagnostic du projet, de STH et des outils MCP ; tests non exécutés' })
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
    await $.ui.open({ id: PANE, title: 'Buddy · Diagnostic', focus: true })
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
          const row: ProjectView['mcp'][number] = { name, tools: old?.tools ?? 0, status: isError ? 'error' : 'available', message: isError ? 'Le dernier appel a signalé une erreur. Vérifier /mcp et relancer cet appel.' : null }
          return { ...view, mcp: [...view.mcp.filter(row => row.name !== name), row] }
        })
        $.ui.invalidate('ui.render')
      }
      return result
    } catch (failure) {
      if (name) {
        await update($, projectView, view => ({ ...view, mcp: [...view.mcp.filter(row => row.name !== name), { name, tools: view.mcp.find(row => row.name === name)?.tools ?? 0, status: 'error' as const, message: 'Le dernier appel MCP a échoué. Vérifier /mcp.' }] }))
        $.ui.invalidate('ui.render')
      }
      throw failure
    }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, projectView)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Diagnostic du projet</Text>
        <Text dimColor>{view.root || 'Lecture du projet…'}</Text>
        <Text>Stack : {view.stack.join(' · ') || 'aucun manifeste reconnu'}</Text>
        <Text dimColor>Sources : {view.evidence.join(', ') || 'à vérifier'}</Text>
        {view.busy ? <Text dimColor>Diagnostic…</Text> : <Button key="doctor-refresh" label="Actualiser le diagnostic" onPress={() => refreshProject($, true).then(() => undefined)} />}
        {view.message ? <Text color="yellow">{view.message}</Text> : null}
        {view.cliStatus === 'missing' ? InstallationGuide($, e, view) : (
          <Box flexDirection="column">
            <Text>STH : {view.cliVersion ?? (view.cliStatus === 'unknown' ? 'accès à vérifier' : 'version non vérifiée')}</Text>
            <Text>{view.linked ? `${view.providerCount} provider(s) configuré(s)` : 'Projet STH à configurer'}</Text>
            {!view.linked ? <Button key="doctor-configure" label="Configurer STH" onPress={() => $.ui.open({ id: 'sth-skills', title: 'Buddy · Skills', focus: true }).then(() => undefined)} /> : null}
          </Box>
        )}
        <Text bold>Dépendances</Text>
        {!view.dependencies.length ? <Text dimColor>Lancez le diagnostic pour vérifier les binaires du projet.</Text> : null}
        {view.dependencies.map(dep => <Box key={`dependency-${dep.name}`} flexDirection="column">
          <Text color={dep.available ? 'green' : 'yellow'}>{dep.name} : {dep.available ? dep.version ?? 'disponible' : 'indisponible'}</Text>
          {dep.action ? <Text dimColor>{dep.action}</Text> : null}
        </Box>)}
        <Text bold>Tests · non exécutés par le diagnostic</Text>
        {view.testCommands.length ? view.testCommands.map(command => <Text key={`test-${command}`}>{command}</Text>) : <Text dimColor>Aucune commande de test détectée dans les manifestes.</Text>}
        <Button key="doctor-tests" label="Préparer un prompt de vérification" onPress={() => prepareDraft($, `Vérifie les changements du projet. ${view.testCommands.length ? `Les manifestes proposent : ${view.testCommands.join(' ; ')}. Choisis les vérifications adaptées et explique les résultats.` : 'Identifie d’abord les vérifications adaptées au projet et explique lesquelles tu peux lancer.'} Signale explicitement les tests non exécutés.`)} />
        {view.checks.map((check, index) => <Box key={`check-${index}`} flexDirection="column">
          <Text color={check.status === 'fail' ? 'yellow' : check.status === 'pass' ? 'green' : undefined}>{check.status === 'pass' ? 'OK' : check.status === 'fail' ? 'À corriger' : 'Non vérifié'} · {check.name}</Text>
          <Text>{check.detail}</Text>
          {check.action ? <Text dimColor>{check.action}</Text> : null}
          {check.status === 'fail' ? <Button key={`remedy-${index}`} label="Préparer un diagnostic" onPress={() => prepareDraft($, `Le diagnostic STH signale : ${check.name}. Détail : ${check.detail}. Proposition du CLI : ${check.action ?? 'aucune'}. Examine le problème et propose une correction avant toute action destructive ou installation.`)} /> : null}
        </Box>)}
        <Text bold>Outils MCP</Text>
        {view.mcp.length ? view.mcp.map(server => <Box key={`mcp-${server.name}`} flexDirection="column">
          <Text color={server.status === 'error' ? 'yellow' : undefined}>{safeDiagnosticText(server.name)} : {server.tools} outils exposés{server.status === 'error' ? ' · erreur observée' : ''}</Text>
          {server.message ? <Text dimColor>{server.message}</Text> : null}
        </Box>) : <Text dimColor>Aucun outil MCP exposé dans cette session.</Text>}
        <Text dimColor>Ces états reflètent les outils exposés et les appels observés. Les connexions sans outils ne sont pas vérifiées.</Text>
        <Button key="doctor-mcp" label="Préparer un diagnostic MCP" onPress={() => prepareDraft($, 'Examine les erreurs MCP observées dans cette session et explique comment vérifier les connexions dans /mcp. Propose les corrections nécessaires.')} />
      </Box>
    )
  })
}

export const register: Register = on => registerProject(on)
