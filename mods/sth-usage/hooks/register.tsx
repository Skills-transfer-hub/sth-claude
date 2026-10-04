import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, Timer } from 'claude-code'
import { isPromptText, isUserPrompt } from './fika'
import terminalOk from '../ui/terminal-frames/ok'
import terminalWork from '../ui/terminal-frames/work'
import terminalDone from '../ui/terminal-frames/done'
import terminalError from '../ui/terminal-frames/error'
import terminalUpdate from '../ui/terminal-frames/update'
import terminalNoConfig from '../ui/terminal-frames/noConfig'
import terminalFika, { DURATION_MS as FIKA_DURATION_MS, FPS as FIKA_FPS } from '../ui/terminal-frames/fika/index'

import type {
  CatalogSkill,
  FikaEligibility,
  InitDraft,
  InstalledSkill,
  LimitWindow,
  SkillsView,
  TokenTotals,
  UsageSnapshot,
} from '../types'

const PANE = 'sth-usage'
const SKILLS_PANE = 'sth-skills'
const PROJECT_FILE = '.sth/project.json'
const STH_CANDIDATES = ['sth', '/opt/homebrew/bin/sth', '/usr/local/bin/sth']
const CATALOG_ROWS = 12
const INIT_PROVIDERS = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'azure-devops', label: 'Azure DevOps' },
  { id: 'bitbucket', label: 'Bitbucket' },
]
const INIT_TARGETS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'antigravity', label: 'Antigravity' },
]
const TOKENS_HIDDEN_DURING_INIT: Record<string, string> = {
  STH_TOKEN: '',
  GITHUB_TOKEN: '',
  GITLAB_TOKEN: '',
  AZURE_DEVOPS_EXT_PAT: '',
  AZURE_DEVOPS_TOKEN: '',
  BITBUCKET_TOKEN: '',
}
const STH_SITE = 'https://www.skillsth.com/'
const ALERT_THRESHOLDS = [80, 95]

type BuddyState = 'ok' | 'work' | 'done' | 'update' | 'error' | 'noConfig'

const BUDDY_CAPTIONS: Record<BuddyState, string> = {
  ok: 'Buddy est prêt',
  work: 'Buddy travaille…',
  done: 'Buddy a fini le tour',
  update: 'Buddy surveille les limites',
  error: 'Buddy freine : limite proche',
  noConfig: 'Buddy attend le premier tour',
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Fenêtre 5 h',
  seven_day: 'Semaine (7 j)',
  seven_day_opus: 'Semaine Opus',
  seven_day_sonnet: 'Semaine Sonnet',
  spend_limit: 'Budget',
}

const EMPTY_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const EMPTY_SNAPSHOT: UsageSnapshot = { limits: [], costUsd: null }

const tokens = atom({ plugin: 'sth-usage', key: 'tokens' } as const, EMPTY_TOKENS)
const turns = atom({ plugin: 'sth-usage', key: 'turns' } as const, 0)
const isWorking = atom({ plugin: 'sth-usage', key: 'isWorking' } as const, false)
const snapshot = atom({ plugin: 'sth-usage', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
const alerted = atom({ plugin: 'sth-usage', key: 'alerted' } as const, [])

const EMPTY_SKILLS: SkillsView = {
  isLinked: false,
  providers: [],
  installed: [],
  catalog: null,
  filter: '',
  busy: null,
  message: null,
  isError: false,
  pendingRemoval: null,
}

const skills = atom({ plugin: 'sth-usage', key: 'skills' } as const, EMPTY_SKILLS)

const DEFAULT_INIT_DRAFT: InitDraft = {
  provider: 'github',
  repository: '',
  ref: 'main',
  catalogPath: 'SKILLS.md',
  targets: ['claude'],
  isPrivate: false,
}

const initDraft = atom({ plugin: 'sth-usage', key: 'initDraft' } as const, DEFAULT_INIT_DRAFT)
const initAdvanced = atom({ plugin: 'sth-usage', key: 'initAdvanced' } as const, false)
const skillsTab = atom({ plugin: 'sth-usage', key: 'skillsTab' } as const, 'installed')

const FIKA_DELAY_MS = 120_000
const INITIAL: FikaEligibility = { startedAt: null, hasPrompt: false, ready: false, playingUntil: null }
export const fikaEligibility = atom({ plugin: 'sth-usage', key: 'fika' } as const, INITIAL)
let monitor: Timer | undefined
let fikaEnd: Timer | undefined
let fikaAnimation: Timer | undefined


async function recordPrompt($: EngineInterface, text: string): Promise<void> {
  if (!isPromptText(text) || (await read($, fikaEligibility)).hasPrompt) return
  await update($, fikaEligibility, previous => ({ ...previous, hasPrompt: true, ready: false, playingUntil: null }))
  monitor?.cancel()
  fikaEnd?.cancel()
  fikaAnimation?.cancel()
  $.ui.invalidate('ui.render')
}

function armFikaPlayback($: EngineInterface, remainingMs: number): void {
  fikaEnd?.cancel()
  fikaAnimation?.cancel()
  fikaAnimation = $.clock.every(1000 / FIKA_FPS, () => animateTerminalFika($))
  fikaEnd = $.clock.after(remainingMs, async () => {
    fikaAnimation?.cancel()
    await update($, fikaEligibility, previous => ({ ...previous, playingUntil: null }))
    $.ui.invalidate('ui.render')
  })
}

async function playFika($: EngineInterface): Promise<void> {
  const eligibility = await read($, fikaEligibility)
  if (!eligibility.ready || eligibility.hasPrompt) return
  const now = await $.clock.now()
  await update($, fikaEligibility, previous => ({
    ...previous, playingUntil: previous.hasPrompt ? null : now + FIKA_DURATION_MS,
  }))
  armFikaPlayback($, FIKA_DURATION_MS)
  $.ui.invalidate('ui.render')
}

async function startFika($: EngineInterface): Promise<void> {
  monitor?.cancel()
  fikaEnd?.cancel()
  fikaAnimation?.cancel()
  if ((await read($, fikaEligibility)).hasPrompt) return
  const [messages, draft, now, preview] = await Promise.all([
    $.session.messages(), $.prompt.read(), $.clock.now(), $.env.get('STH_FIKA_PREVIEW'),
  ])
  const delay = preview === '1' ? 2000 : FIKA_DELAY_MS
  const hasPrompt = messages.some(isUserPrompt) || isPromptText(draft.text)
  await update($, fikaEligibility, previous => ({
    ...previous,
    startedAt: previous.startedAt ?? now,
    hasPrompt: previous.hasPrompt || hasPrompt,
    ready: previous.ready && !hasPrompt,
    playingUntil: hasPrompt || (previous.playingUntil !== null && previous.playingUntil <= now)
      ? null : previous.playingUntil,
  }))
  const eligibility = await read($, fikaEligibility)
  if (eligibility.hasPrompt) return
  if (eligibility.playingUntil !== null) armFikaPlayback($, eligibility.playingUntil - now)
  monitor = $.clock.every(1000, async () => {
    const eligibility = await read($, fikaEligibility)
    if (eligibility.hasPrompt) {
      monitor?.cancel()
      return
    }
    // The composer can mount after session.start, or be filled by another UI.
    const currentDraft = await $.prompt.read()
    if (isPromptText(currentDraft.text)) {
      await recordPrompt($, currentDraft.text)
      monitor?.cancel()
      return
    }
    const now = await $.clock.now()
    if (eligibility.playingUntil != null && eligibility.playingUntil <= now) {
      await update($, fikaEligibility, previous => ({ ...previous, playingUntil: null }))
      $.ui.invalidate('ui.render')
    }
    if (!eligibility.ready && eligibility.startedAt !== null &&
        now - eligibility.startedAt >= delay) {
      await update($, fikaEligibility, previous => ({ ...previous, ready: !previous.hasPrompt }))
      $.ui.invalidate('ui.render')
    }
  })
}

function windowLabel(kind: string): string {
  return WINDOW_LABELS[kind] ?? kind
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`
}

function progressBar(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function limitColor(percent: number): string | undefined {
  if (percent >= 90) return 'red'
  if (percent >= 75) return 'yellow'
  return 'green'
}

function resetIn(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt) return ''
  const remainingMinutes = Math.max(0, Math.round((Date.parse(resetsAt) - nowMs) / 60_000))
  const days = Math.floor(remainingMinutes / 1440)
  const hours = Math.floor((remainingMinutes % 1440) / 60)
  const minutes = remainingMinutes % 60
  if (days > 0) return `reset dans ${days} j ${hours} h`
  if (hours > 0) return `reset dans ${hours} h ${String(minutes).padStart(2, '0')}`
  return `reset dans ${minutes} min`
}

function highestPercent(limits: LimitWindow[]): number {
  return limits.reduce((highest, limit) => Math.max(highest, limit.percentUsed), 0)
}

function buddyState(working: boolean, current: UsageSnapshot, turnCount: number): BuddyState {
  const highest = highestPercent(current.limits)
  if (working) return 'work'
  if (highest >= 90) return 'error'
  if (highest >= 75) return 'update'
  if (turnCount === 0 && current.costUsd === null) return 'noConfig'
  return turnCount > 0 ? 'done' : 'ok'
}

function statusText(current: UsageSnapshot, totals: TokenTotals): string {
  if (current.limits.length > 0) {
    const windows = current.limits
      .map(limit => `${limit.kind === 'five_hour' ? '5h' : limit.kind === 'seven_day' ? '7j' : windowLabel(limit.kind)} ${Math.round(limit.percentUsed)}%`)
      .join(' · ')
    return `Buddy ${windows}`
  }
  const cost = current.costUsd === null ? '' : `${usd(current.costUsd)} · `
  return `Buddy ${cost}${compactNumber(totals.input + totals.cacheRead + totals.cacheWrite)}↓ ${compactNumber(totals.output)}↑`
}

async function refreshSnapshot($: EngineInterface): Promise<UsageSnapshot> {
  const usage = await $.session.usage()
  const current: UsageSnapshot = {
    limits: usage.rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt,
    })),
    costUsd: usage.cost?.usd ?? null,
  }
  await update($, snapshot, () => current)
  $.ui.status(statusText(current, await read($, tokens)))
  return current
}

async function alertOnThresholds($: EngineInterface, current: UsageSnapshot): Promise<void> {
  const already = await read($, alerted)
  const fresh: string[] = []
  for (const limit of current.limits) {
    for (const threshold of ALERT_THRESHOLDS) {
      const alertKey = `${limit.kind}:${limit.resetsAt ?? ''}:${threshold}`
      if (limit.percentUsed >= threshold && !already.includes(alertKey)) {
        fresh.push(alertKey)
        $.ui.toast(`Buddy : ${windowLabel(limit.kind)} à ${Math.round(limit.percentUsed)} %`)
      }
    }
  }
  if (fresh.length > 0) {
    await update($, alerted, list => [...list, ...fresh].slice(-50))
  }
}

const BUDDY_FRAME_MS = 50

type TerminalBuddy = { state: BuddyState; fikaStartedAt: number | null }
const terminalBuddies = new Map<string, TerminalBuddy>()
const terminalFrames = {
  ok: terminalOk, work: terminalWork, done: terminalDone,
  error: terminalError, update: terminalUpdate, noConfig: terminalNoConfig,
}
let buddyTick = 0

function buddyCells(state: BuddyState, tick: number): string {
  const frames = terminalFrames[state]
  return frames[tick % frames.length]!
}

async function buddyElement(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  requestId: string,
  state: BuddyState,
  caption: string,
  fikaStartedAt: number | null = null,
) {
  const fikaFrame = fikaStartedAt === null ? null : Math.min(
    terminalFika.length - 1,
    Math.max(0, Math.floor((await $.clock.now() - fikaStartedAt) * FIKA_FPS / 1000 + 0.0001)),
  )
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    terminalBuddies.set(requestId, { state, fikaStartedAt })
    return (
      <Raster
        key="buddy"
        cells={fikaFrame === null ? buddyCells(state, buddyTick) : terminalFika[fikaFrame]!}
        columns={24}
        rows={12}
      />
    )
  }
  terminalBuddies.delete(requestId)
  if (e.surface === 'desktop') {
    const { Client } = $.ui.resolve(e)
    if (fikaFrame !== null) {
      return <Client key={`buddy-fika-scene-${fikaStartedAt}`} module="../ui/fika.ts" props={{ startFrame: fikaFrame, caption }} />
    }
    return (
      <Client key={`buddy-${state}`} module="../ui/buddy.ts" props={{ state, caption }} />
    )
  }
  const { Text } = $.ui.resolve(e)
  return <Text>{caption}</Text>
}

function animateTerminalBuddies($: EngineInterface): void {
  buddyTick += 1
  for (const [requestId, { state, fikaStartedAt }] of terminalBuddies) {
    if (fikaStartedAt !== null) continue
    void $.ui
      .blit({ requestId, key: 'buddy', cells: buddyCells(state, buddyTick) })
      .then(result => {
        if ('deny' in result && result.deny) terminalBuddies.delete(requestId)
      })
  }
}

async function animateTerminalFika($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const [requestId, { fikaStartedAt }] of terminalBuddies) {
    if (fikaStartedAt === null) continue
    const frame = Math.min(terminalFika.length - 1, Math.max(0, Math.round((now - fikaStartedAt) * FIKA_FPS / 1000)))
    void $.ui.blit({ requestId, key: 'buddy', cells: terminalFika[frame]! }).then(result => {
      if ('deny' in result && result.deny) terminalBuddies.delete(requestId)
    })
  }
}

function dashboardLink($: EngineInterface, e: RenderInput<'Pane'>, label = 'Dashboard STH') {
  const { Box, Text, Link } = $.ui.resolve(e)
  if (e.surface === 'terminal') {
    return (
      <Box flexDirection="column">
        <Link href={STH_SITE}>
          <Text color="blue" bold underline>↗ Ouvrir le dashboard STH</Text>
        </Link>
        <Text dimColor>skillsth.com · lien externe</Text>
      </Box>
    )
  }
  return <Link href={STH_SITE} label={label} />
}

function fikaThought($: EngineInterface, e: RenderInput<'Pane'>, visible: boolean, playing: boolean) {
  if (!visible || (e.surface !== 'terminal' && e.surface !== 'desktop')) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box key="buddy-fika" flexDirection="column" alignItems="center">
      <Box borderStyle="round" borderDimColor paddingX={1}>
        {playing
          ? <Text>Fika à Stockholm</Text>
          : <Button key="fika" label="Fika ?" plain onPress={() => playFika($)} />}
      </Box>
      <Text dimColor>•</Text>
      <Text dimColor>·</Text>
    </Box>
  )
}

function skillsBuddyState(view: SkillsView): BuddyState {
  if (view.busy !== null) return 'work'
  if (view.message !== null) return view.isError ? 'error' : 'done'
  return view.isLinked ? 'ok' : 'noConfig'
}

let sthBinary: string | null = null

type SthRun = { isOk: boolean; stdout: string; stderr: string }

type SthInput = { stdin?: string; env?: Record<string, string> }

async function runSth(
  $: EngineInterface,
  args: string[],
  timeoutMs: number,
  input: SthInput = {},
): Promise<SthRun> {
  const candidates = sthBinary ? [sthBinary] : STH_CANDIDATES
  let lastFailure = 'sth introuvable (PATH, /opt/homebrew/bin, /usr/local/bin)'
  for (const candidate of candidates) {
    try {
      const result = await $.process.run([candidate, ...args], {
        stdin: input.stdin ?? '',
        env: input.env,
        timeoutMs,
      })
      sthBinary = candidate
      return { isOk: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr }
    } catch (failure) {
      lastFailure = String(failure)
    }
  }
  return { isOk: false, stdout: '', stderr: lastFailure }
}

function parseJson<Shape>(text: string): Shape | null {
  try {
    return JSON.parse(text) as Shape
  } catch {
    return null
  }
}

function lastLine(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  return lines[lines.length - 1] ?? ''
}

function failureText(result: SthRun, fallback: string): string {
  const reported = parseJson<{ error?: string }>(result.stdout)
  return reported?.error ?? (lastLine(result.stderr) || lastLine(result.stdout) || fallback)
}

function skillLabel(resourceName: string): string {
  return resourceName.split('::').slice(1).join('/') || resourceName
}

function statusColor(status: string): string | undefined {
  if (status === 'up-to-date') return 'green'
  if (status === 'outdated') return 'yellow'
  if (status.includes('modified')) return 'magenta'
  return undefined
}

function skillStatus(status: string): string {
  if (status === 'up-to-date') return 'À jour'
  if (status === 'outdated') return 'Mise à jour disponible'
  if (status.includes('modified')) return 'Modifié localement'
  if (status === 'missing') return 'Fichier manquant'
  return status
}

async function showSkillsTab($: EngineInterface, tab: 'installed' | 'catalog'): Promise<void> {
  await update($, skillsTab, () => tab)
  $.ui.invalidate('ui.render')
  const view = await read($, skills)
  if (tab === 'catalog' && view.catalog === null && view.busy === null) await loadCatalog($)
}

async function setSkills($: EngineInterface, change: Partial<SkillsView>): Promise<void> {
  await update($, skills, view => ({ ...view, ...change }))
  $.ui.invalidate('ui.render')
}

async function detectProject($: EngineInterface): Promise<boolean> {
  try {
    const project = parseJson<{ providers?: { id: string }[] }>(await $.fs.read(PROJECT_FILE))
    await setSkills($, {
      isLinked: true,
      providers: (project?.providers ?? []).map(provider => provider.id),
    })
    return true
  } catch {
    await setSkills($, { isLinked: false, providers: [] })
    return false
  }
}

async function refreshInstalled($: EngineInterface): Promise<void> {
  const result = await runSth($, ['status', '--json'], 60_000)
  const rows = parseJson<
    { resource_name: string; provider_id: string; status: string; pinned: boolean }[]
  >(result.stdout)
  if (!result.isOk || rows === null) {
    await setSkills($, { message: failureText(result, 'sth status a échoué'), isError: true })
    return
  }
  const installed: InstalledSkill[] = rows.map(row => ({
    resourceName: row.resource_name,
    providerId: row.provider_id,
    status: row.status,
    isPinned: row.pinned,
  }))
  await setSkills($, { installed })
}

async function loadCatalog($: EngineInterface): Promise<void> {
  await setSkills($, { busy: 'Chargement du catalogue…', message: null })
  const result = await runSth($, ['list', '--json'], 120_000)
  const rows = parseJson<
    {
      catalog_id: string
      provider_id: string
      folder_name: string
      name: string
      artifact_kind?: string
      resource_type: string
      description?: string
    }[]
  >(result.stdout)
  if (!result.isOk || rows === null) {
    await setSkills($, { busy: null, message: failureText(result, 'sth list a échoué'), isError: true })
    return
  }
  const catalog: CatalogSkill[] = rows.map(row => ({
    catalogId: row.catalog_id,
    providerId: row.provider_id,
    folderName: row.folder_name,
    name: row.name,
    kind: row.artifact_kind ?? row.resource_type,
    description: row.description ?? '',
  }))
  await setSkills($, { busy: null, catalog })
}

async function runSkillAction(
  $: EngineInterface,
  busyText: string,
  args: string[],
  successText: string,
): Promise<void> {
  await setSkills($, { busy: busyText, message: null, pendingRemoval: null })
  const result = await runSth($, args, 300_000)
  await refreshInstalled($)
  await setSkills($, {
    busy: null,
    message: result.isOk ? successText : failureText(result, 'échec'),
    isError: !result.isOk,
  })
  $.ui.toast(result.isOk ? `STH : ${successText}` : `STH : échec — ${busyText}`)
}

async function installSkill($: EngineInterface, skill: CatalogSkill): Promise<void> {
  await runSkillAction(
    $,
    `Installation de ${skill.folderName}/${skill.name}…`,
    ['install', `${skill.folderName}/${skill.name}`, '--provider', skill.providerId, '--json'],
    `${skill.name} installé`,
  )
}

async function removeSkill($: EngineInterface, skill: InstalledSkill): Promise<void> {
  await runSkillAction(
    $,
    `Retrait de ${skillLabel(skill.resourceName)}…`,
    ['remove', skill.resourceName, '--provider', skill.providerId, '--json'],
    `${skillLabel(skill.resourceName)} retiré`,
  )
}

async function updateAllSkills($: EngineInterface): Promise<void> {
  await runSkillAction($, 'Mise à jour des skills…', ['update', '--json'], 'skills à jour')
}

function readableLines(text: string): string[] {
  return text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^[│╭╰❯↑]/.test(line))
}

function initScript(draft: InitDraft): string {
  const answers = [
    draft.provider,
    draft.repository.trim(),
    draft.ref.trim(),
    draft.catalogPath.trim(),
    draft.targets.join(','),
    draft.isPrivate ? 'private' : 'public',
    ...(draft.isPrivate ? ['n', ''] : []),
    'y',
  ]
  return `${answers.join('\n')}\n`
}

async function setInitDraft($: EngineInterface, change: Partial<InitDraft>): Promise<void> {
  await update($, initDraft, draft => ({ ...draft, ...change }))
  $.ui.invalidate('ui.render')
}

async function toggleInitAdvanced($: EngineInterface): Promise<void> {
  await update($, initAdvanced, value => !value)
  $.ui.invalidate('ui.render')
}

async function toggleInitTarget($: EngineInterface, target: string): Promise<void> {
  await update($, initDraft, draft => ({
    ...draft,
    targets: draft.targets.includes(target)
      ? draft.targets.filter(selected => selected !== target)
      : [...draft.targets, target],
  }))
  $.ui.invalidate('ui.render')
}

async function initProject($: EngineInterface): Promise<void> {
  const draft = await read($, initDraft)
  if (draft.repository.trim() === '' || draft.targets.length === 0) {
    await setSkills($, { message: 'Renseigne le dépôt et au moins une cible.', isError: true })
    return
  }
  await setSkills($, { busy: `sth init : ${draft.provider} ${draft.repository.trim()}…`, message: null })
  const result = await runSth($, ['init', '--no-cloud-prompt'], 180_000, {
    stdin: initScript(draft),
    env: TOKENS_HIDDEN_DURING_INIT,
  })
  const isLinked = await detectProject($)
  if (isLinked) await refreshInstalled($)
  const saved = readableLines(result.stdout).filter(line => line.startsWith('✓'))
  await setSkills($, {
    busy: null,
    message: isLinked
      ? saved.join(' · ') || 'Projet relié à STH.'
      : readableLines(`${result.stdout}\n${result.stderr}`).slice(-1)[0] ?? 'sth init a échoué',
    isError: !isLinked,
  })
  $.ui.toast(isLinked ? 'STH : projet initialisé' : 'STH : échec de sth init')
}

async function refreshLinkedProject($: EngineInterface): Promise<void> {
  if (await detectProject($)) await refreshInstalled($)
}

async function openSkillsPane($: EngineInterface): Promise<boolean> {
  const isLinked = await detectProject($)
  await $.ui.open({ id: SKILLS_PANE, title: 'Buddy · Skills' })
  if (isLinked) await refreshInstalled($)
  return isLinked
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await startFika($)
    await $.command.register({
      name: 'sth-usage',
      description: 'Ouvre le panneau de suivi de session Buddy / STH',
    })
    await $.command.register({
      name: 'sth-skills',
      description: 'Pilote les skills STH du projet : installer, retirer, mettre à jour',
    })
    void $.ui.open({ id: PANE, title: 'Buddy · Consommation' })
    void $.clock.every(BUDDY_FRAME_MS, () => animateTerminalBuddies($))
    void refreshSnapshot($)
    void refreshLinkedProject($)

    return next(e)
  })

  on('command.run', { command: 'sth-usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Buddy · Consommation' })
    const current = await refreshSnapshot($)
    const totals = await read($, tokens)

    return { text: statusText(current, totals) }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true)

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    await recordPrompt($, result.text)
    return result
  })

  on('prompt.fill', async ($, e, next) => {
    const result = await next(e)
    if (result.isFilled) await recordPrompt($, e.text)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await recordPrompt($, e.text)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const usage = e.usage
    if (usage) {
      await update($, tokens, totals => ({
        input: totals.input + usage.input_tokens,
        output: totals.output + usage.output_tokens,
        cacheRead: totals.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: totals.cacheWrite + usage.cache_creation_input_tokens,
      }))
    }
    if (e.agentId === undefined) {
      await update($, turns, count => count + 1)
      await update($, isWorking, () => false)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const current = await refreshSnapshot($)
    await alertOnThresholds($, current)

    return next(e)
  })

  on('command.run', { command: 'sth-skills' }, async $ => {
    const isLinked = await openSkillsPane($)

    return {
      text: isLinked
        ? 'Panneau Skills STH ouvert.'
        : 'Ce projet n’est pas relié à STH (pas de .sth/project.json) : lance `sth init`.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: SKILLS_PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Skills Transfer Hub</Text>
          <Text>Gère les skills de ce projet dans Claude Code sur desktop ou dans le terminal.</Text>
          {dashboardLink($, e)}
        </Box>
      )
    }
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const view = await read($, skills)
    const tab = await read($, skillsTab)
    const state = skillsBuddyState(view)
    const buddy = await buddyElement($, e, SKILLS_PANE, state, BUDDY_CAPTIONS[state])
    const isBusy = view.busy !== null
    const narrow = e.props.bodyColumns < 44
    const header = (
      <Box key="skills-header" flexDirection="column" gap={1} alignItems="center">
        {buddy}
        <Box flexDirection="column" alignItems="center">
          <Text bold>Buddy · Tes skills</Text>
          <Text dimColor>{isBusy ? 'Buddy travaille…' : view.isLinked ? 'Buddy veille sur tes skills.' : 'Buddy attend ton catalogue.'}</Text>
        </Box>
      </Box>
    )
    const feedback = (
      <Box flexDirection="column">
        {view.busy !== null && <Text>{view.busy}</Text>}
        {view.message !== null && <Text color={view.isError ? 'red' : 'green'}>{view.message}</Text>}
      </Box>
    )
    const footer = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button
          key="back-usage"
          label="Consommation"
          plain
          dimColor
          onPress={() => $.ui.open({ id: PANE, title: 'Buddy · Consommation', focus: true })}
        />
        {dashboardLink($, e)}
      </Box>
    )

    if (!view.isLinked) {
      const draft = await read($, initDraft)
      const advanced = await read($, initAdvanced)
      return (
        <Box flexDirection="column" gap={1} paddingX={1}>
          {header}
          {feedback}
          <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
            <Text bold>1. Choisir un catalogue</Text>
            <Select
              key="init-provider"
              label="Hébergeur : "
              options={INIT_PROVIDERS.map(provider => ({ value: provider.id, label: provider.label }))}
              value={draft.provider}
              onSelect={value => (isBusy ? undefined : setInitDraft($, { provider: value }))}
            />
            <Input
              key="init-repository"
              label="Dépôt : "
              placeholder="organisation/catalogue ou URL"
              value={draft.repository}
              autoFocus
              submitLabel="valider"
              onInput={value => (isBusy ? undefined : setInitDraft($, { repository: value }))}
              onSubmit={value => (isBusy ? undefined : setInitDraft($, { repository: value }))}
            />
            <Select
              key="init-access"
              label="Accès : "
              options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Privé' }]}
              value={draft.isPrivate ? 'private' : 'public'}
              onSelect={value => (isBusy ? undefined : setInitDraft($, { isPrivate: value === 'private' }))}
            />
            {draft.isPrivate && (
              <Text dimColor>Utilise les identifiants Git ou le token de ton hébergeur configuré dans ton environnement.</Text>
            )}
            <Button
              key="init-advanced"
              label={advanced ? 'Masquer les options avancées' : 'Options avancées'}
              plain
              dimColor
              onPress={() => toggleInitAdvanced($)}
            />
            {advanced && (
              <Box flexDirection="column" gap={1}>
                <Input
                  key="init-ref"
                  label="Branche : "
                  value={draft.ref}
                  onInput={value => (isBusy ? undefined : setInitDraft($, { ref: value }))}
                  onSubmit={value => (isBusy ? undefined : setInitDraft($, { ref: value }))}
                />
                <Input
                  key="init-catalog"
                  label="Fichier catalogue : "
                  value={draft.catalogPath}
                  onInput={value => (isBusy ? undefined : setInitDraft($, { catalogPath: value }))}
                  onSubmit={value => (isBusy ? undefined : setInitDraft($, { catalogPath: value }))}
                />
              </Box>
            )}
          </Box>
          <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
            <Text bold>2. Choisir les assistants</Text>
            <Text dimColor>Les skills seront disponibles pour :</Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {INIT_TARGETS.map(target => (
                <Button
                  key={`target-${target.id}`}
                  label={`${draft.targets.includes(target.id) ? '✓ ' : ''}${target.label}`}
                  variant={draft.targets.includes(target.id) ? 'primary' : 'secondary'}
                  onPress={() => (isBusy ? undefined : toggleInitTarget($, target.id))}
                />
              ))}
            </Box>
          </Box>
          {!isBusy && (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Button key="init-run" label="Relier ce projet" variant="primary" onPress={() => initProject($)} />
              <Button key="recheck" label="Déjà configuré ?" dimColor onPress={() => openSkillsPane($)} />
            </Box>
          )}
          {footer}
        </Box>
      )
    }

    const installedKeys = new Set(view.installed.map(skill => `${skill.providerId}:${skill.resourceName}`))
    const needle = view.filter.trim().toLowerCase()
    const available = (view.catalog ?? [])
      .filter(skill => !installedKeys.has(`${skill.providerId}:${skill.catalogId}`))
    const matches = available.filter(skill => needle === '' || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
    const outdatedCount = view.installed.filter(skill => skill.status === 'outdated').length

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {header}
        <Text dimColor>Sources · {view.providers.join(', ') || 'Aucune source'}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button
            key="tab-installed"
            label={`Installés (${view.installed.length})`}
            variant={tab === 'installed' ? 'primary' : 'secondary'}
            hotkey="1"
            onPress={() => showSkillsTab($, 'installed')}
          />
          <Button
            key="tab-catalog"
            label="Catalogue"
            variant={tab === 'catalog' ? 'primary' : 'secondary'}
            hotkey="2"
            onPress={() => showSkillsTab($, 'catalog')}
          />
        </Box>
        {feedback}
        {tab === 'installed' ? (
          <Box flexDirection="column" gap={1}>
            {view.installed.length === 0 ? (
              <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor padding={1}>
                <Text bold>Ton premier skill t’attend.</Text>
                <Text dimColor>Parcours le catalogue pour l’ajouter à ce projet.</Text>
                {!isBusy && <Button key="browse-empty" label="Parcourir le catalogue" variant="primary" onPress={() => showSkillsTab($, 'catalog')} />}
              </Box>
            ) : (
              <Box flexDirection="column" gap={1}>
                {!isBusy && (
                  <Box flexDirection="row" flexWrap="wrap" gap={1}>
                    <Button
                      key="update-all"
                      label={outdatedCount > 0 ? `Mettre à jour (${outdatedCount})` : 'Vérifier les mises à jour'}
                      variant={outdatedCount > 0 ? 'primary' : 'secondary'}
                      onPress={() => updateAllSkills($)}
                    />
                    <Button key="refresh" label="Actualiser" dimColor onPress={() => refreshInstalled($)} />
                  </Box>
                )}
                {view.installed.map(skill => (
                  <Box key={`installed-${skill.providerId}-${skill.resourceName}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                    <Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={narrow ? 0 : 1}>
                      <Box flexDirection="column" flexGrow={1} minWidth={0}>
                        <Text bold>{skillLabel(skill.resourceName)}</Text>
                        <Text dimColor>{skill.providerId}{skill.isPinned ? ' · Épinglé' : ''}</Text>
                        <Text color={statusColor(skill.status)}>{skillStatus(skill.status)}</Text>
                      </Box>
                      {!isBusy && view.pendingRemoval !== skill.resourceName && (
                        <Button
                          key={`remove-${skill.resourceName}`}
                          label="Retirer"
                          plain
                          dimColor
                          onPress={() => setSkills($, { pendingRemoval: skill.resourceName })}
                        />
                      )}
                    </Box>
                    {!isBusy && view.pendingRemoval === skill.resourceName && (
                      <Box flexDirection="column" gap={1} marginTop={1}>
                        <Text>Retirer {skillLabel(skill.resourceName)} de ce projet ?</Text>
                        <Box flexDirection="row" flexWrap="wrap" gap={1}>
                          <Button key={`cancel-${skill.resourceName}`} label="Garder" onPress={() => setSkills($, { pendingRemoval: null })} />
                          <Button key={`confirm-${skill.resourceName}`} label="Confirmer le retrait" onPress={() => removeSkill($, skill)} />
                        </Box>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Input
              key="filter"
              label="Rechercher : "
              placeholder="nom ou description"
              value={view.filter}
              autoFocus
              submitLabel="rechercher"
              onInput={value => setSkills($, { filter: value })}
              onSubmit={value => setSkills($, { filter: value })}
            />
            {view.catalog === null ? (
              !isBusy && <Button key="load-catalog" label="Charger le catalogue" onPress={() => loadCatalog($)} />
            ) : (
              <Box flexDirection="column" gap={1}>
                <Text dimColor>{matches.length} skill{matches.length > 1 ? 's' : ''} disponible{matches.length > 1 ? 's' : ''}</Text>
                {matches.length === 0 && (
                  <Text dimColor>{needle ? 'Aucun résultat. Essaie un autre terme.' : view.catalog.length === 0 ? 'Ce catalogue ne contient aucun skill.' : 'Tous les skills du catalogue sont installés.'}</Text>
                )}
                {matches.slice(0, CATALOG_ROWS).map(skill => (
                  <Box key={`catalog-${skill.providerId}-${skill.catalogId}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                    <Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={narrow ? 0 : 1}>
                      <Box flexDirection="column" flexGrow={1} minWidth={0}>
                        <Text bold>{skill.name}</Text>
                        <Text dimColor>{skill.folderName} · {skill.kind} · {skill.providerId}</Text>
                      </Box>
                      {!isBusy && (
                        <Button key={`install-${skill.providerId}-${skill.catalogId}`} label="Installer" onPress={() => installSkill($, skill)} />
                      )}
                    </Box>
                    {skill.description !== '' && <Text dimColor>{skill.description}</Text>}
                  </Box>
                ))}
                {matches.length > CATALOG_ROWS && <Text dimColor>{CATALOG_ROWS} résultats affichés. Affine ta recherche pour voir les autres.</Text>}
              </Box>
            )}
          </Box>
        )}
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, snapshot)
    const skillsView = await read($, skills)
    const totals = await read($, tokens)
    const turnCount = await read($, turns)
    const working = (await read($, isWorking)) || skillsView.busy !== null
    const fika = await read($, fikaEligibility)
    const showFika = fika.ready && !fika.hasPrompt && !working &&
      (e.surface === 'terminal' || e.surface === 'desktop')
    const state = buddyState(working, current, turnCount)
    const nowMs = await $.clock.now()
    const playingFika = showFika && fika.playingUntil != null && fika.playingUntil > nowMs
    const caption = playingFika ? 'Buddy fait une fika à Stockholm' : BUDDY_CAPTIONS[state]
    const barWidth = Math.max(4, Math.min(32, e.props.bodyColumns - 6))
    const buddy = await buddyElement($, e, PANE, state, caption,
      playingFika ? fika.playingUntil! - FIKA_DURATION_MS : null)
    const outdated = skillsView.installed.filter(skill => skill.status === 'outdated').length

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box key="usage-header" flexDirection="column" gap={1} alignItems="center">
          {fikaThought($, e, showFika, playingFika)}
          {buddy}
          <Box flexDirection="column" alignItems="center">
            <Text bold>Buddy</Text>
            <Text dimColor>{caption}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
          <Text bold>Abonnement Claude</Text>
          {current.limits.length === 0 && <Text dimColor>Aucune limite communiquée pour cette session.</Text>}
          {current.limits.map(limit => (
            <Box key={`limit-${limit.kind}`} flexDirection="column">
              <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
                <Text>{windowLabel(limit.kind)}</Text>
                <Text bold color={limitColor(limit.percentUsed)}>{Math.round(limit.percentUsed)} %</Text>
              </Box>
              <Text key={`bar-${limit.kind}`} color={limitColor(limit.percentUsed)}>{progressBar(limit.percentUsed, barWidth)}</Text>
              <Text dimColor>{resetIn(limit.resetsAt, nowMs).replace('reset dans', 'Réinitialisation dans')}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
            <Text bold>Cette session</Text>
            <Text dimColor>{turnCount} tour{turnCount > 1 ? 's' : ''}</Text>
          </Box>
          {current.costUsd !== null && (
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text dimColor>Coût estimé</Text>
              <Text bold>{usd(current.costUsd)}</Text>
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
            <Text dimColor>Tokens reçus</Text>
            <Text>{compactNumber(totals.input)}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
            <Text dimColor>Tokens générés</Text>
            <Text>{compactNumber(totals.output)}</Text>
          </Box>
          <Text dimColor>Cache · {compactNumber(totals.cacheRead)} lu / {compactNumber(totals.cacheWrite)} écrit</Text>
        </Box>
        <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
          <Text bold>Skills du projet</Text>
          <Text dimColor>
            {skillsView.isLinked
              ? `${skillsView.installed.length} installé${skillsView.installed.length > 1 ? 's' : ''}${outdated > 0 ? ` · ${outdated} à mettre à jour` : ''}`
              : 'Relie un catalogue pour retrouver tes skills ici.'}
          </Text>
          <Button
            key={skillsView.isLinked ? 'open-skills' : 'open-init'}
            label={skillsView.isLinked ? 'Gérer les skills' : 'Configurer STH'}
            variant="primary"
            onPress={() => openSkillsPane($)}
          />
        </Box>
        {dashboardLink($, e, 'Ouvrir le dashboard STH')}
      </Box>
    )
  })
}
