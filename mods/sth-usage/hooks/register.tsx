import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, Timer } from 'claude-code'
import { isPromptText, isUserPrompt } from './fika'
import { terminalRaster } from './terminal-raster'
import { EMPTY_CONTEXT, registerContext, statusPills, usagePillElement } from './context'
import { activityCaption, activityBuddyState, registerActivity } from './activity'
import { EMPTY_PROJECT, rankSkills, registerProject } from './project'
import { panelChrome, paneNavigation } from './presentation'
import { PLUGIN_VERSION } from './version'
import { createBuddyImageReader } from './buddy-images'
import { prepareBuddyAssets } from './buddy-assets'
import terminalOk from '../ui/terminal-frames/ok'
import terminalWork from '../ui/terminal-frames/work'
import terminalDone from '../ui/terminal-frames/done'
import terminalError from '../ui/terminal-frames/error'
import terminalUpdate from '../ui/terminal-frames/update'
import terminalNoConfig from '../ui/terminal-frames/noConfig'
import { COLUMNS as BUDDY_COLUMNS, ROWS as BUDDY_ROWS, FPS as TERMINAL_BUDDY_FPS } from '../ui/terminal-frames/settings'
import terminalFika, { DURATION_MS as FIKA_DURATION_MS, FPS as FIKA_RASTER_FPS, COLUMNS as FIKA_COLUMNS, ROWS as FIKA_ROWS } from '../ui/terminal-frames/fika/index'

import type {
  CatalogSkill,
  ActivityView,
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
  ok: 'Buddy is ready',
  work: 'Buddy is working…',
  done: 'Buddy has finished the turn',
  update: 'Buddy is watching the limits',
  error: 'Buddy is slowing down: limit approaching',
  noConfig: 'Buddy is waiting for the first turn',
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour window',
  seven_day: 'Week (7 d)',
  seven_day_opus: 'Opus week',
  seven_day_sonnet: 'Sonnet week',
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
const moreMenuOpen = atom({ plugin: 'sth-usage', key: 'moreMenuOpen' } as const, false)

// The mod compiler resolves state references within each hooks file.
const activityView = atom({ plugin: 'sth-usage', key: 'activityView' } as const, {
  phase: 'ready', waitingTool: null, objective: '', files: [], tests: [], toolErrors: 0,
  last: null, resume: null, message: null, testsRunning: false, testCommand: null,
} satisfies ActivityView)
const projectView = atom({ plugin: 'sth-usage', key: 'projectView' } as const, EMPTY_PROJECT)
const contextView = atom({ plugin: 'sth-usage', key: 'contextView' } as const, EMPTY_CONTEXT)

const FIKA_DELAY_MS = 120_000
const FIKA_HD_FPS = 30
const FIKA_HD_FRAME_COUNT = 270
const INITIAL: FikaEligibility = { startedAt: null, hasPrompt: false, ready: false, playingUntil: null }
export const fikaEligibility = atom({ plugin: 'sth-usage', key: 'fika' } as const, INITIAL)
let monitor: Timer | undefined
let fikaEnd: Timer | undefined
let fikaAnimation: Timer | undefined


async function recordPrompt($: EngineInterface, text: string): Promise<void> {
  if (!isPromptText(text) || (await read($, fikaEligibility)).hasPrompt) return
  queuedFika = false
  await update($, fikaEligibility, previous => ({ ...previous, hasPrompt: true, ready: false, playingUntil: null }))
  monitor?.cancel()
  fikaEnd?.cancel()
  fikaAnimation?.cancel()
  $.ui.invalidate('ui.render')
}

function armFikaPlayback($: EngineInterface, remainingMs: number): void {
  fikaEnd?.cancel()
  fikaAnimation?.cancel()
  fikaAnimation = $.clock.every(1000 / FIKA_HD_FPS, () => animateTerminalFika($))
  fikaEnd = $.clock.after(remainingMs, async () => {
    fikaAnimation?.cancel()
    await update($, fikaEligibility, previous => ({ ...previous, playingUntil: null }))
    $.ui.invalidate('ui.render')
  })
}

async function playFika($: EngineInterface, terminal = true): Promise<void> {
  const eligibility = await read($, fikaEligibility)
  if (!eligibility.ready || eligibility.hasPrompt) return
  // A first HD installation must finish before its nine-second clock starts.
  // Desktop and terminals without an image protocol use their bundled frames.
  if (terminal && [...terminalBuddies.values()].some(entry => entry.image && entry.preparing)) {
    queuedFika = true
    startBuddyAssetPreparation($)
    $.ui.toast('Preparing Buddy HD. Fika will start when the download is ready.')
    return
  }
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
      .map(limit => `${limit.kind === 'five_hour' ? '5h' : limit.kind === 'seven_day' ? '7d' : windowLabel(limit.kind)} ${Math.round(limit.percentUsed)}%`)
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
        $.ui.toast(`Buddy: ${windowLabel(limit.kind)} at ${Math.round(limit.percentUsed)} %`)
      }
    }
  }
  if (fresh.length > 0) {
    await update($, alerted, list => [...list, ...fresh].slice(-50))
  }
}

const BUDDY_FRAME_MS = 50

type TerminalBuddy = {
  state: BuddyState; fikaStartedAt: number | null; image: boolean;
  key: string; columns: number; rows: number;
  lastFrame: number;
  images: ReturnType<typeof createBuddyImageReader>;
  blitting?: boolean;
  preparing?: boolean;
  probed?: boolean;
}
const terminalBuddies = new Map<string, TerminalBuddy>()
const imageFallbacks = new Set<string>()
let imageTerminal: boolean | null = null
let buddyAnimation: Timer | undefined
const terminalFrames = {
  ok: terminalOk, work: terminalWork, done: terminalDone,
  error: terminalError, update: terminalUpdate, noConfig: terminalNoConfig,
}
let buddyTick = 0
let queuedFika = false
let imageProtocolConfirmed = false
let assetConfig: Promise<void> | undefined
let assetConfigFailed = false
let assetManifest: unknown
let assetIndexText = ''
let assetRoot: string | undefined
let assetPhase: 'local' | 'idle' | 'preparing' | 'ready' | 'error' = 'local'
let assetPercent = 0
let assetTask: Promise<void> | undefined

async function inspectBuddyAssets($: EngineInterface): Promise<void> {
  if (!assetConfig) assetConfig = (async () => {
    assetConfigFailed = false
    const path = `${$.plugin.root}/assets/buddy-codec/remote.json`
    if (!await $.fs.exists(path)) return
    assetPhase = 'idle'
    assetIndexText = await $.fs.read(path)
    assetManifest = JSON.parse(assetIndexText)
  })().catch(() => { assetConfigFailed = true; assetPhase = 'error' })
  await assetConfig
}

function startBuddyAssetPreparation($: EngineInterface): void {
  if (assetTask || assetPhase === 'local' || assetPhase === 'ready' || !imageProtocolConfirmed) return
  assetPhase = 'preparing'
  assetPercent = 0
  assetTask = (async () => {
    if (assetConfigFailed) {
      assetConfig = undefined
      await inspectBuddyAssets($)
      assetPhase = 'preparing'
    }
    if (!assetManifest || typeof assetManifest !== 'object' || !('remote' in assetManifest) || assetConfigFailed) throw new Error('Invalid bundled Buddy asset index')
    // Assets are shared across projects and plugin updates, outside the plugin
    // install directory. No project contents or credentials enter this request.
    const local = await $.env.get('LOCALAPPDATA')
    const home = local || await $.env.get('HOME') || await $.env.get('USERPROFILE')
    if (!home || !/^(?:[A-Za-z]:[\\/]|\/)/.test(home) || home.startsWith('//') || home.startsWith('\\\\')) throw new Error('No local asset cache directory')
    const cache = `${home.replace(/[\\/]$/, '')}/${local ? 'STH/Buddy' : '.cache/sth-buddy'}`
    assetRoot = await prepareBuddyAssets(assetManifest, assetIndexText, cache, {
      root: $.plugin.root,
      read: path => $.fs.read(path),
      write: (path, text) => $.fs.write(path, text),
      fetchText: async url => {
        let timeout: Timer | undefined
        try {
          return await Promise.race([
            $.http.fetch(url, { method: 'GET' }),
            new Promise<never>((resolveTimeout, reject) => {
              timeout = $.clock.after(30_000, () => { reject(new Error('Buddy asset download timed out')) })
            }),
          ])
        } finally { timeout?.cancel() }
      },
    }, progress => {
      const percent = Math.floor(progress.completed * 100 / Math.max(1, progress.total))
      if (Math.floor(percent / 5) !== Math.floor(assetPercent / 5)) {
        assetPercent = percent
        $.ui.invalidate('ui.render')
      }
    })
    assetPhase = 'ready'
    assetPercent = 100
    for (const entry of terminalBuddies.values()) entry.images = createBuddyImageReader()
    $.ui.invalidate('ui.render')
    if (queuedFika) {
      queuedFika = false
      // Clear the preparation flag before starting the clock; the next render
      // recreates each entry against the fully verified local cache.
      for (const entry of terminalBuddies.values()) entry.preparing = false
      await playFika($)
    }
  })().catch(error => {
    assetPhase = 'error'
    queuedFika = false
    $.ui.log(`Buddy HD preparation failed: ${String(error)}`, { to: 'debug' })
    $.ui.invalidate('ui.render')
  }).finally(() => { assetTask = undefined })
}

function buddyCells(state: BuddyState, tick: number): string {
  const frames = terminalFrames[state]
  return frames[Math.floor(tick * BUDDY_FRAME_MS * TERMINAL_BUDDY_FPS / 1000) % frames.length]!
}

async function terminalHasImages($: EngineInterface): Promise<boolean> {
  if (imageTerminal !== null) return imageTerminal
  try {
    // A terminal name does not establish image support. Try once, then let
    // the host's Image/blit result select the portable fallback.
    imageTerminal = !(await $.env.get('TMUX'))
  } catch { imageTerminal = false }
  return imageTerminal
}

function compactBuddyHeader(e: RenderInput<'Pane'>): boolean {
  return e.surface === 'terminal' || e.props.scroll.bodyRows < 26 || e.props.bodyColumns < 36
}

function fitBuddy(e: RenderInput<'Pane'>, columns: number, rows: number, thought: boolean) {
  const reserve = thought ? compactBuddyHeader(e) ? 5 : 9 : 3
  const availableRows = Math.max(1, e.props.scroll.bodyRows - reserve)
  const availableColumns = Math.max(1, e.props.bodyColumns - 2)
  const scale = Math.min(1, availableColumns / columns, availableRows / rows)
  return { columns: Math.max(1, Math.floor(columns * scale)), rows: Math.max(1, Math.floor(rows * scale)) }
}

function terminalBlitResult($: EngineInterface, requestId: string, entry: TerminalBuddy, denial: string | undefined): void {
  // A reply from the preceding pose must not remove the new animation.
  if (!denial || terminalBuddies.get(requestId) !== entry) return
  // A just-created drawing can be measured after the probe. Retry on the
  // regular frame clock instead of dropping its animation before mounting.
  if (/not mounted|nothing.*mounted|no.*mounted/i.test(denial)) return
  terminalBuddies.delete(requestId)
  if (entry.image) {
    imageFallbacks.add(requestId)
    $.ui.invalidate('ui.render')
  }
}

// SDK calls stay in this hook module for Claude's static capability audit.
function readBuddyImage($: EngineInterface, images: ReturnType<typeof createBuddyImageReader>, sequence: BuddyState | 'fika', frame: number) {
  return images.read(assetRoot ?? $.plugin.root, path => $.fs.exists(path), path => $.fs.read(path), sequence, frame)
}

function blitBuddy($: EngineInterface, requestId: string, entry: TerminalBuddy, frame: number): void {
  if (terminalBuddies.get(requestId) !== entry || entry.blitting) return
  if (entry.preparing) {
    if (entry.probed) return
    entry.probed = true
    void $.ui.blit({ requestId, key: entry.key, source: { format: 'png', file: `${$.plugin.root}/assets/bootstrap/${entry.state}.png` }, columns: entry.columns, rows: entry.rows })
      .then(result => {
        if (terminalBuddies.get(requestId) !== entry) return
        if (result.deny) {
          entry.probed = false
          terminalBlitResult($, requestId, entry, result.deny)
        } else {
          imageProtocolConfirmed = true
          if (assetPhase === 'idle') startBuddyAssetPreparation($)
        }
      }).catch(() => { entry.probed = false })
    return
  }
  const fika = entry.fikaStartedAt !== null
  entry.lastFrame = fika && !entry.image ? Math.floor(frame * FIKA_RASTER_FPS / FIKA_HD_FPS) : frame
  if (entry.image) {
    entry.blitting = true
    void readBuddyImage($, entry.images, fika ? 'fika' : entry.state, frame)
      .then(async source => {
        if (terminalBuddies.get(requestId) !== entry) return
        const result = await $.ui.blit({ requestId, key: entry.key, source, columns: entry.columns, rows: entry.rows })
        terminalBlitResult($, requestId, entry, result.deny)
      })
      .catch(() => {
        if (terminalBuddies.get(requestId) !== entry) return
        if (assetPhase === 'local') terminalBlitResult($, requestId, entry, 'Buddy image could not be loaded')
        else {
          // A damaged/missing cache is repairable. It must never permanently
          // change a capable terminal to the lower-resolution fallback.
          assetRoot = undefined
          assetPhase = 'error'
          $.ui.invalidate('ui.render')
        }
      })
      .finally(() => { entry.blitting = false })
  } else {
    const cells = fika ? terminalFika[Math.min(terminalFika.length - 1, Math.floor(frame * FIKA_RASTER_FPS / FIKA_HD_FPS))]! : buddyCells(entry.state, frame)
    void $.ui.blit({ requestId, key: entry.key, cells: terminalRaster(cells, entry.columns, entry.rows), columns: entry.columns, rows: entry.rows })
      .then(result => terminalBlitResult($, requestId, entry, result.deny))
  }
}

async function buddyElement(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  requestId: string,
  state: BuddyState,
  caption: string,
  fikaStartedAt: number | null = null,
  thought = false,
) {
  const fikaFrame = fikaStartedAt === null ? null : Math.min(
    FIKA_HD_FRAME_COUNT - 1,
    Math.max(0, Math.floor((await $.clock.now() - fikaStartedAt) * FIKA_HD_FPS / 1000 + 0.005)),
  )
  if (e.surface === 'terminal') {
    const { Raster, Image, Box, Text, Button } = $.ui.resolve(e)
    const image = !imageFallbacks.has(requestId) && await terminalHasImages($)
    const sourceColumns = image ? 24 : fikaFrame !== null ? FIKA_COLUMNS : BUDDY_COLUMNS
    const sourceRows = image ? 12 : fikaFrame !== null ? FIKA_ROWS : BUDDY_ROWS
    const size = fitBuddy(e, sourceColumns, sourceRows, thought)
    if (!image && (size.columns < 16 || size.rows < 8)) {
      terminalBuddies.delete(requestId)
      return <Box key="buddy-compact" flexDirection="column" alignItems="center">
        <Text bold>[ H ]</Text>
        <Button key="buddy-enlarge" label="Enlarge" plain onPress={() => $.ui.open({ id: requestId, rows: 36, columns: 50, focus: true })} />
      </Box>
    }
    const key = `buddy-${image ? 'image' : 'raster'}-${fikaFrame !== null ? `fika-${fikaStartedAt}` : state}-${size.columns}x${size.rows}`
    const lastFrame = fikaFrame === null ? buddyTick : image ? fikaFrame : Math.floor(fikaFrame * FIKA_RASTER_FPS / FIKA_HD_FPS)
    const images = terminalBuddies.get(requestId)?.images ?? createBuddyImageReader()
    const entry: TerminalBuddy = { state, fikaStartedAt, image, key, ...size, lastFrame, images }
    terminalBuddies.set(requestId, entry)
    if (image) {
      await inspectBuddyAssets($)
      if (assetPhase !== 'local' && assetPhase !== 'ready') {
        entry.preparing = true
        $.clock.after(0, () => blitBuddy($, requestId, entry, 0))
        return <Box key="buddy-preparation" flexDirection="column" alignItems="center">
          <Image key={key} source={{ format: 'png', file: `${$.plugin.root}/assets/bootstrap/${state}.png` }} columns={size.columns} rows={size.rows} alt={caption} />
          <Text dimColor>{assetPhase === 'error' ? 'Buddy HD could not be prepared.' : `Preparing Buddy HD… ${assetPercent}%`}</Text>
          {assetPhase === 'error' && <Button key="buddy-assets-retry" label="Retry download" onPress={() => startBuddyAssetPreparation($)} />}
        </Box>
      }
      let source
      try { source = await readBuddyImage($, images, fikaFrame !== null ? 'fika' : state, fikaFrame ?? buddyTick) }
      catch {
        if (terminalBuddies.get(requestId) !== entry) {
          $.ui.invalidate('ui.render')
          return null
        }
        if (assetPhase !== 'local') {
          assetRoot = undefined
          assetPhase = 'error'
          return buddyElement($, e, requestId, state, caption, fikaStartedAt, thought)
        }
        imageFallbacks.add(requestId)
        return buddyElement($, e, requestId, state, caption, fikaStartedAt, thought)
      }
      if (terminalBuddies.get(requestId) !== entry) return null
      // Probe after mounting, including panes drawn before session.start in a
      // host. Unsupported protocols recover without waiting for a model turn.
      $.clock.after(0, () => blitBuddy($, requestId, entry, fikaFrame ?? buddyTick))
      return <Image key={key} source={source} columns={size.columns} rows={size.rows} alt={caption} />
    }
    return (
      <Raster
        key={key}
        cells={terminalRaster(fikaFrame === null ? buddyCells(state, buddyTick) : terminalFika[Math.floor(fikaFrame * FIKA_RASTER_FPS / FIKA_HD_FPS)]!, size.columns, size.rows)}
        columns={size.columns}
        rows={size.rows}
      />
    )
  }
  if (e.surface === 'desktop') {
    if (fikaFrame !== null) {
      return $.ui.resolve(e).Client({ module: '../ui/fika.ts', key: `buddy-fika-scene-${fikaStartedAt}`, props: { startFrame: fikaFrame, caption } })
    }
    return $.ui.resolve(e).Client({ module: '../ui/buddy.ts', key: `buddy-${state}`, props: { state, caption } })
  }
  const { Text } = $.ui.resolve(e)
  return <Text>{caption}</Text>
}

function animateTerminalBuddies($: EngineInterface): void {
  buddyTick += 1
  for (const [requestId, entry] of terminalBuddies) {
    if (entry.fikaStartedAt !== null) continue
    if (!entry.image && buddyTick % Math.round(1000 / TERMINAL_BUDDY_FPS / BUDDY_FRAME_MS)) continue
    blitBuddy($, requestId, entry, buddyTick)
  }
}

async function animateTerminalFika($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const [requestId, entry] of terminalBuddies) {
    if (entry.fikaStartedAt === null) continue
    const frame = Math.min(FIKA_HD_FRAME_COUNT - 1, Math.max(0, Math.round((now - entry.fikaStartedAt) * FIKA_HD_FPS / 1000)))
    const pose = entry.image ? frame : Math.floor(frame * FIKA_RASTER_FPS / FIKA_HD_FPS)
    if (pose === entry.lastFrame) continue
    blitBuddy($, requestId, entry, frame)
  }
}

function dashboardLink($: EngineInterface, e: RenderInput<'Pane'>, label = 'STH dashboard') {
  const { Box, Text, Link } = $.ui.resolve(e)
  if (e.surface === 'terminal') {
    return (
      <Box flexDirection="column">
        <Link href={STH_SITE}>
          <Text bold underline>↗ Open the STH dashboard</Text>
        </Link>
        <Text dimColor>skillsth.com · external link</Text>
      </Box>
    )
  }
  return <Link href={STH_SITE} label={label} />
}

function sthInstallationGuide($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text, Link } = $.ui.resolve(e)
  const { Button } = panelChrome($.ui.resolve(e), e)
  const docs = 'https://github.com/Skills-transfer-hub/sth-releases/blob/main/README.md'
  return (
    <Box key="sth-installation-guide" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
      <Text bold>Install STH</Text>
      <Text>The STH CLI was not found. Install it in your terminal, then check that it is available.</Text>
      <Text bold>macOS / Linux with Homebrew</Text>
      <Text>brew install skills-transfer-hub/sth/sth</Text>
      <Text bold>Windows with Scoop</Text>
      <Text>scoop bucket add sth https://github.com/Skills-transfer-hub/scoop-sth</Text>
      <Text>scoop install sth</Text>
      <Text dimColor>Windows alternative: winget install STH.STH</Text>
      <Text bold>Verify</Text>
      <Text>sth version</Text>
      <Text dimColor>Without a package manager: download the archive for your system from the official releases, add the binary to PATH, then reopen your terminal.</Text>
      {e.surface === 'terminal' ? <Link href={docs}><Text underline>STH installation guide</Text></Link> : <Link href={docs} label="STH installation guide" />}
      <Button key="sth-check-installation" label="Check installation" onPress={() => $.ui.open({ id: 'sth-doctor', title: 'Buddy · Diagnostics', focus: true })} />
    </Box>
  )
}

function fikaThought($: EngineInterface, e: RenderInput<'Pane'>, visible: boolean, playing: boolean) {
  if (!visible || (e.surface !== 'terminal' && e.surface !== 'desktop')) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  if (compactBuddyHeader(e)) return <Box key="buddy-fika" alignItems="center">
    {playing ? <Text wrap="truncate-end">Fika in Stockholm</Text> : <Button key="fika" label="Fika?" plain onPress={() => playFika($, e.surface === 'terminal')} />}
  </Box>
  return (
    <Box key="buddy-fika" flexDirection="column" alignItems="center">
      <Box borderStyle="round" borderDimColor paddingX={1}>
        {playing
          ? <Text>Fika in Stockholm</Text>
          : <Button key="fika" label="Fika?" plain onPress={() => playFika($, e.surface === 'terminal')} />}
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
let skillsEpoch = 0
let skillsOperationEpoch: number | null = null

type SthRun = { isOk: boolean; stdout: string; stderr: string }

type SthInput = { stdin?: string; env?: Record<string, string>; cwd?: string }

async function runSth(
  $: EngineInterface,
  args: string[],
  timeoutMs: number,
  input: SthInput = {},
): Promise<SthRun> {
  const candidates = sthBinary ? [sthBinary, ...STH_CANDIDATES.filter(candidate => candidate !== sthBinary)] : STH_CANDIDATES
  let lastFailure = 'sth not found (PATH, /opt/homebrew/bin, /usr/local/bin)'
  for (const candidate of candidates) {
    try {
      const result = await $.process.run([candidate, ...args], {
        stdin: input.stdin ?? '',
        env: input.env,
        cwd: input.cwd,
        timeoutMs,
      })
      sthBinary = candidate
      return { isOk: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr }
    } catch (failure) {
      lastFailure = String(failure)
      // A timeout or permission error may happen after a mutation started.
      // Only a missing executable is safe to retry through another path.
      if (!/\bENOENT\b|executable not found|command not found|cannot find.*executable/i.test(lastFailure)) break
      if (candidate === sthBinary) sthBinary = null
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

function statusSeverity(status: string): number {
  if (status === 'up-to-date') return 0
  if (status === 'outdated') return 1
  return status === 'missing' ? 3 : 2
}

function skillStatus(status: string): string {
  if (status === 'up-to-date') return 'Up to date'
  if (status === 'outdated') return 'Update available'
  if (status.includes('modified')) return 'Locally modified'
  if (status === 'missing') return 'Missing file'
  if (status === 'unknown-baseline') return 'Integrity not verified'
  return status
}

async function showSkillsTab($: EngineInterface, tab: 'installed' | 'catalog'): Promise<void> {
  await update($, skillsTab, () => tab)
  $.ui.invalidate('ui.render')
  const view = await read($, skills)
  if (tab === 'catalog' && view.catalog === null && view.busy === null) await loadCatalog($)
}

async function setSkills($: EngineInterface, change: Partial<SkillsView>, epoch?: number): Promise<void> {
  await update($, skills, view => epoch !== undefined && epoch !== skillsEpoch ? view : { ...view, ...change })
  $.ui.invalidate('ui.render')
}

async function detectProject($: EngineInterface): Promise<boolean> {
  const epoch = skillsEpoch
  try {
    const root = await $.session.cwd()
    if (epoch !== skillsEpoch) return false
    const project = parseJson<{ providers?: { id: string }[] }>(await $.fs.read(`${root.replace(/[\\/]$/, '')}/${PROJECT_FILE}`))
    if (epoch !== skillsEpoch) return false
    if (!project || !Array.isArray(project.providers) || !project.providers.some(provider => typeof provider?.id === 'string')) {
      await setSkills($, { isLinked: false, providers: [] }, epoch)
      return false
    }
    await setSkills($, {
      isLinked: true,
      providers: (project?.providers ?? []).map(provider => provider.id),
    }, epoch)
    return true
  } catch {
    await setSkills($, { isLinked: false, providers: [] }, epoch)
    return false
  }
}

async function refreshInstalled($: EngineInterface, duringAction = false): Promise<boolean> {
  const epoch = skillsEpoch
  if (!duringAction && skillsOperationEpoch === epoch) return false
  if (!duringAction) {
    skillsOperationEpoch = epoch
    await setSkills($, { busy: 'Checking skills…', message: null, isError: false }, epoch)
  }
  try {
    const root = await $.session.cwd()
    if (epoch !== skillsEpoch) return false
    const result = await runSth($, ['status', '--json'], 60_000, { cwd: root })
    if (epoch !== skillsEpoch) return false
    const rows = parseJson<
      { resource_name: string; provider_id: string; status: string; pinned: boolean; installed_version?: string; latest_version?: string }[]
    >(result.stdout)
    if (!result.isOk || !Array.isArray(rows)) {
      await setSkills($, { message: failureText(result, 'sth status failed'), isError: true }, epoch)
      return false
    }
    if (rows.some(row => !row || typeof row.resource_name !== 'string' || typeof row.provider_id !== 'string' || typeof row.status !== 'string' || typeof row.pinned !== 'boolean')) {
      await setSkills($, { message: 'Invalid sth status response: the installed skills list has been preserved.', isError: true }, epoch)
      return false
    }
    const installed: InstalledSkill[] = rows.map(row => ({
      resourceName: row.resource_name,
      providerId: row.provider_id,
      status: row.status,
      isPinned: row.pinned,
      installedVersion: typeof row.installed_version === 'string' ? row.installed_version : undefined,
      latestVersion: typeof row.latest_version === 'string' ? row.latest_version : undefined,
    }))
    const byResource = new Map<string, InstalledSkill>()
    for (const skill of installed) {
      const identity = `${skill.providerId}:${skill.resourceName}`
      const previous = byResource.get(identity)
      if (!previous) byResource.set(identity, skill)
      else byResource.set(identity, {
        ...previous,
        status: statusSeverity(skill.status) > statusSeverity(previous.status) ? skill.status : previous.status,
        isPinned: previous.isPinned || skill.isPinned,
        installedVersion: previous.installedVersion === skill.installedVersion ? skill.installedVersion : undefined,
        latestVersion: previous.latestVersion === skill.latestVersion ? skill.latestVersion : undefined,
      })
    }
    await setSkills($, { installed: [...byResource.values()], message: null, isError: false }, epoch)
    return true
  } finally {
    if (!duringAction) {
      await setSkills($, { busy: null }, epoch)
      if (skillsOperationEpoch === epoch) skillsOperationEpoch = null
    }
  }
}

async function loadCatalog($: EngineInterface): Promise<void> {
  const epoch = skillsEpoch
  if (skillsOperationEpoch === epoch) return
  skillsOperationEpoch = epoch
  try {
    const root = await $.session.cwd()
    if (epoch !== skillsEpoch) return
    await setSkills($, { busy: 'Loading catalog…', message: null, isError: false }, epoch)
    if (epoch !== skillsEpoch) return
    const result = await runSth($, ['list', '--json'], 120_000, { cwd: root })
    if (epoch !== skillsEpoch) return
    const rows = parseJson<
      {
        catalog_id: string
        provider_id: string
        folder_name: string
        name: string
        artifact_kind?: string
        resource_type: string
        description?: string
        version?: string
        resolved_version?: string
      }[]
    >(result.stdout)
    if (!result.isOk || !Array.isArray(rows)) {
      await setSkills($, { busy: null, message: failureText(result, 'sth list failed'), isError: true }, epoch)
      return
    }
    if (rows.some(row => !row || typeof row.catalog_id !== 'string' || typeof row.provider_id !== 'string' || typeof row.folder_name !== 'string' || typeof row.name !== 'string')) {
      await setSkills($, { busy: null, message: 'This version of STH does not provide the remote catalog as JSON. Update STH, then try again.', isError: true }, epoch)
      return
    }
    const catalog: CatalogSkill[] = rows.map(row => ({
      catalogId: row.catalog_id,
      providerId: row.provider_id,
      folderName: row.folder_name,
      name: row.name,
      kind: row.artifact_kind ?? row.resource_type,
      description: row.description ?? '',
      version: typeof row.version === 'string' ? row.version : typeof row.resolved_version === 'string' ? row.resolved_version : undefined,
    }))
    await setSkills($, { catalog, message: null, isError: false }, epoch)
  } finally {
    await setSkills($, { busy: null }, epoch)
    if (skillsOperationEpoch === epoch) skillsOperationEpoch = null
  }
}

async function runSkillAction(
  $: EngineInterface,
  busyText: string,
  args: string[],
  successText: string,
  expected?: { kind: 'install' | 'remove'; providerId: string; resourceName: string },
): Promise<void> {
  const epoch = skillsEpoch
  if (skillsOperationEpoch === epoch) return
  skillsOperationEpoch = epoch
  try {
    const root = await $.session.cwd()
    if (epoch !== skillsEpoch) return
    await setSkills($, { busy: busyText, message: null, isError: false, pendingRemoval: null }, epoch)
    if (epoch !== skillsEpoch) return
    const result = await runSth($, args, 300_000, { cwd: root })
    if (epoch !== skillsEpoch) return
    const verified = await refreshInstalled($, true)
    if (epoch !== skillsEpoch) return
    const refreshed = await read($, skills)
    if (epoch !== skillsEpoch) return
    let message = result.isOk ? successText : failureText(result, 'failed')
    let isError = !result.isOk
    if (!verified) {
      const verificationError = refreshed.message ?? 'skill status unavailable'
      message = result.isOk ? `Command completed; status not verified: ${verificationError}` : `${message} · Status not verified: ${verificationError}`
      isError = true
    } else if (result.isOk && expected) {
      const installed = refreshed.installed.find(skill => skill.providerId === expected.providerId && skill.resourceName === expected.resourceName)
      if (expected.kind === 'install' && installed?.status !== 'up-to-date') {
        message = `Installation not verified: ${skillLabel(expected.resourceName)} ${installed ? `has status ${skillStatus(installed.status)}` : 'is absent from the installed list'}.`
        isError = true
      } else if (expected.kind === 'remove' && installed) {
        message = `Removal not verified: ${skillLabel(expected.resourceName)} is still installed.`
        isError = true
      }
    } else if (result.isOk && args[0] === 'update') {
      const outdated = refreshed.installed.filter(skill => skill.status === 'outdated' && !skill.isPinned).length
      const unresolved = refreshed.installed.filter(skill => skill.status !== 'up-to-date' && !skill.isPinned)
      const pinned = refreshed.installed.filter(skill => skill.isPinned).length
      const current = refreshed.installed.filter(skill => skill.status === 'up-to-date').length
      message = outdated > 0
        ? `Update command completed · ${outdated} skill${outdated > 1 ? 's still need' : ' still needs'} an update.`
        : unresolved.length > 0
        ? `Update command completed · ${unresolved.length} skill${unresolved.length > 1 ? 's' : ''} to verify (${[...new Set(unresolved.map(skill => skillStatus(skill.status)))].join(', ')}).`
        : `Update complete · ${current} up to date${pinned ? ` · ${pinned} pinned` : ''}.`
      isError = unresolved.length > 0
    }
    await setSkills($, { message, isError }, epoch)
    if (epoch === skillsEpoch) $.ui.toast(`STH: ${message}`)
  } finally {
    await setSkills($, { busy: null }, epoch)
    if (skillsOperationEpoch === epoch) skillsOperationEpoch = null
  }
}

async function installSkill($: EngineInterface, skill: CatalogSkill): Promise<void> {
  await runSkillAction(
    $,
    `Installing ${skill.folderName}/${skill.name}…`,
    ['install', `${skill.folderName}/${skill.name}`, '--provider', skill.providerId, '--json'],
    `${skill.name} installed`,
    { kind: 'install', providerId: skill.providerId, resourceName: skill.catalogId },
  )
}

async function removeSkill($: EngineInterface, skill: InstalledSkill): Promise<void> {
  await runSkillAction(
    $,
    `Removing ${skillLabel(skill.resourceName)}…`,
    ['remove', skill.resourceName, '--provider', skill.providerId, '--yes', '--json'],
    `${skillLabel(skill.resourceName)} removed`,
    { kind: 'remove', providerId: skill.providerId, resourceName: skill.resourceName },
  )
}

async function updateAllSkills($: EngineInterface): Promise<void> {
  await runSkillAction($, 'Updating skills…', ['update', '--fail-on-changes', '--json'], 'Update command completed')
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
  const epoch = skillsEpoch
  if (skillsOperationEpoch === epoch) return
  skillsOperationEpoch = epoch
  try {
    const root = await $.session.cwd()
    const draft = await read($, initDraft)
    if (epoch !== skillsEpoch) return
    if (draft.repository.trim() === '' || draft.targets.length === 0) {
      await setSkills($, { message: 'Enter a repository and select at least one assistant.', isError: true }, epoch)
      return
    }
    await setSkills($, { busy: `sth init: ${draft.provider} ${draft.repository.trim()}…`, message: null, isError: false }, epoch)
    if (epoch !== skillsEpoch) return
    const result = await runSth($, ['init', '--no-cloud-prompt'], 180_000, {
      stdin: initScript(draft),
      env: TOKENS_HIDDEN_DURING_INIT,
      cwd: root,
    })
    if (epoch !== skillsEpoch) return
    const isLinked = await detectProject($)
    if (epoch !== skillsEpoch) return
    const verified = isLinked ? await refreshInstalled($, true) : false
    if (epoch !== skillsEpoch) return
    const refreshed = await read($, skills)
    if (epoch !== skillsEpoch) return
    const saved = readableLines(result.stdout).filter(line => line.startsWith('✓'))
    await setSkills($, {
      message: isLinked && !verified ? `Project linked; status not verified: ${refreshed.message ?? 'unavailable'}` : isLinked
        ? saved.join(' · ') || 'Project linked to STH.'
        : readableLines(`${result.stdout}\n${result.stderr}`).slice(-1)[0] ?? 'sth init failed',
      isError: !isLinked || !verified,
    }, epoch)
    if (epoch === skillsEpoch) $.ui.toast(isLinked ? 'STH: project initialized' : 'STH: sth init failed')
  } finally {
    await setSkills($, { busy: null }, epoch)
    if (skillsOperationEpoch === epoch) skillsOperationEpoch = null
  }
}

async function refreshLinkedProject($: EngineInterface): Promise<void> {
  if (await detectProject($)) await refreshInstalled($)
}

async function resetSkillsProject($: EngineInterface): Promise<void> {
  const epoch = skillsEpoch
  await setSkills($, { ...EMPTY_SKILLS }, epoch)
  await update($, skillsTab, () => 'installed')
  await update($, initDraft, () => ({ ...DEFAULT_INIT_DRAFT, targets: [...DEFAULT_INIT_DRAFT.targets] }))
  await update($, initAdvanced, () => false)
  if (epoch === skillsEpoch) await refreshLinkedProject($)
}

async function openSkillsPane($: EngineInterface): Promise<boolean> {
  const isLinked = await detectProject($)
  await $.ui.open({ id: SKILLS_PANE, title: 'Buddy · STH', rows: 36, columns: 50, focus: true })
  if (isLinked) await refreshInstalled($)
  return isLinked
}

async function closeOtherPanes($: EngineInterface, target: string): Promise<void> {
  for (const pane of await $.ui.panes()) {
    if (pane.id !== target && /^sth-(usage|skills|activity|context|doctor|resume)$/.test(pane.id)) {
      await $.ui.close({ id: pane.id })
    }
  }
  await update($, moreMenuOpen, () => false)
}

export const register: Register = on => {
  registerContext(on)
  registerActivity(on)
  registerProject(on)

  on('ui.open', { id: /^sth-(usage|skills|activity|context|doctor|resume)$/ }, async ($, e, next) => {
    await closeOtherPanes($, e.id)
    // Closing the source returns the keyboard before the host considers focus.
    return next({ ...e, title: e.id === SKILLS_PANE ? 'Buddy · STH' : e.title })
  })
  on('ui.press', { plugin: 'sth-usage', element: /^(nav-home|open-skills|open-activity|open-context|open-doctor|open-resume|doctor-configure|sth-check-installation)$/ }, async ($, e, next) => {
    const targets: Record<string, string> = {
      'nav-home': PANE, 'open-skills': SKILLS_PANE, 'doctor-configure': SKILLS_PANE,
      'open-activity': 'sth-activity', 'open-context': 'sth-context',
      'open-doctor': 'sth-doctor', 'sth-check-installation': 'sth-doctor', 'open-resume': 'sth-resume',
    }
    await closeOtherPanes($, targets[e.element]!)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await startFika($)
    await $.command.register({
      name: 'sth-usage',
      description: 'Open the Buddy / STH session panel',
    })
    await $.command.register({
      name: 'sth-skills',
      description: 'Manage STH project skills: install, remove, update',
    })
    void $.ui.open({ id: PANE, title: 'Buddy · Usage', rows: 36, columns: 50 })
    buddyAnimation?.cancel()
    buddyAnimation = $.clock.every(BUDDY_FRAME_MS, () => animateTerminalBuddies($))
    void refreshSnapshot($)
    void refreshLinkedProject($)

    return next(e)
  })

  on('classic.CwdChanged', { old_cwd: /^/ }, async ($, e, next) => {
    skillsEpoch += 1
    skillsOperationEpoch = null
    await resetSkillsProject($)
    return next(e)
  })

  on('command.run', { command: 'sth-usage' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Buddy · Usage', rows: 36, columns: 50, focus: true })
    const current = await refreshSnapshot($)
    const totals = await read($, tokens)

    return { text: statusText(current, totals) }
  })

  on('ui.close', { id: /^sth-(usage|skills)$/ }, async (_, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) terminalBuddies.delete(e.id)
    return result
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
        ? 'STH panel opened.'
        : 'This project is not linked to STH (no .sth/project.json): run `sth init`.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: SKILLS_PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Skills Transfer Hub</Text>
          <Text>Manage this project’s skills in Claude Code on desktop or in the terminal.</Text>
          {dashboardLink($, e)}
        </Box>
      )
    }
    const { Box, Text, Input, Select } = $.ui.resolve(e)
    const { Page, Card, Toolbar, Button } = panelChrome($.ui.resolve(e), e)
    const view = await read($, skills)
    const project = await read($, projectView)
    const tab = await read($, skillsTab)
    const state = skillsBuddyState(view)
    const buddy = await buddyElement($, e, SKILLS_PANE, state, BUDDY_CAPTIONS[state])
    const isBusy = view.busy !== null
    const narrow = e.props.bodyColumns < 44
    const header = (
      <Box key="skills-header" flexDirection="column" gap={1} alignItems="center">
        {buddy}
        <Box flexDirection="column" alignItems="center">
          <Text bold>Buddy · STH</Text>
          <Text dimColor>{isBusy ? 'Buddy is working…' : view.isLinked ? 'Buddy is watching over your skills.' : 'Buddy is waiting for your catalog.'}</Text>
        </Box>
      </Box>
    )
    const feedback = (
      <Box flexDirection="column">
        {view.busy !== null && <Text>{view.busy}</Text>}
        {view.message !== null && <Text color={view.isError ? 'red' : undefined}>{view.message}</Text>}
      </Box>
    )
    const footer = <Box marginTop={1}>{dashboardLink($, e)}</Box>

    if (project.cliStatus === 'missing') {
      return <Page>{header}{paneNavigation($.ui.resolve(e), e, SKILLS_PANE, pane => $.ui.open(pane))}{sthInstallationGuide($, e)}{footer}</Page>
    }

    if (!view.isLinked) {
      const draft = await read($, initDraft)
      const advanced = await read($, initAdvanced)
      return (
        <Page>
          {header}
          {paneNavigation($.ui.resolve(e), e, SKILLS_PANE, pane => $.ui.open(pane))}
          {feedback}
          <Card>
            <Text bold>1. Choose a catalog</Text>
            <Select
              key="init-provider"
              label="Provider"
              options={INIT_PROVIDERS.map(provider => ({ value: provider.id, label: provider.label }))}
              value={draft.provider}
              onSelect={value => (isBusy ? undefined : setInitDraft($, { provider: value }))}
            />
            <Input
              key="init-repository"
              label="Repository: "
              placeholder="organization/catalog or URL"
              value={draft.repository}
              autoFocus
              submitLabel="confirm"
              onInput={value => (isBusy ? undefined : setInitDraft($, { repository: value }))}
              onSubmit={value => (isBusy ? undefined : setInitDraft($, { repository: value }))}
            />
            <Select
              key="init-access"
              label="Access"
              options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]}
              value={draft.isPrivate ? 'private' : 'public'}
              onSelect={value => (isBusy ? undefined : setInitDraft($, { isPrivate: value === 'private' }))}
            />
            {draft.isPrivate && (
              <Text dimColor>Use the Git credentials or provider token configured in your environment.</Text>
            )}
            <Button
              key="init-advanced"
              label={advanced ? 'Hide advanced options' : 'Advanced options'}
              plain
              dimColor
              onPress={() => toggleInitAdvanced($)}
            />
            {advanced && (
              <Box flexDirection="column" gap={1}>
                <Input
                  key="init-ref"
                  label="Branch: "
                  value={draft.ref}
                  onInput={value => (isBusy ? undefined : setInitDraft($, { ref: value }))}
                  onSubmit={value => (isBusy ? undefined : setInitDraft($, { ref: value }))}
                />
                <Input
                  key="init-catalog"
                  label="Catalog file: "
                  value={draft.catalogPath}
                  onInput={value => (isBusy ? undefined : setInitDraft($, { catalogPath: value }))}
                  onSubmit={value => (isBusy ? undefined : setInitDraft($, { catalogPath: value }))}
                />
              </Box>
            )}
          </Card>
          <Card>
            <Text bold>2. Choose assistants</Text>
            <Text dimColor>Skills will be available to:</Text>
            <Toolbar>
              {INIT_TARGETS.map(target => (
                <Button
                  key={`target-${target.id}`}
                  label={`${draft.targets.includes(target.id) ? '✓ ' : ''}${target.label}`}
                  variant={draft.targets.includes(target.id) ? 'primary' : 'secondary'}
                  onPress={() => (isBusy ? undefined : toggleInitTarget($, target.id))}
                />
              ))}
            </Toolbar>
          </Card>
          {!isBusy && (
            <Toolbar>
              <Button key="init-run" label="Link this project" variant="primary" onPress={() => initProject($)} />
              <Button key="recheck" label="Already configured?" dimColor onPress={() => openSkillsPane($)} />
            </Toolbar>
          )}
          {footer}
        </Page>
      )
    }

    const installedKeys = new Set(view.installed.map(skill => `${skill.providerId}:${skill.resourceName}`))
    const needle = view.filter.trim().toLowerCase()
    const available = (view.catalog ?? [])
      .filter(skill => !installedKeys.has(`${skill.providerId}:${skill.catalogId}`))
    const matches = available.filter(skill => needle === '' || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
    const recommendations = rankSkills(available, project).slice(0, 3)
    const outdatedCount = view.installed.filter(skill => skill.status === 'outdated' && !skill.isPinned).length

    return (
      <Page>
        {header}
        {paneNavigation($.ui.resolve(e), e, SKILLS_PANE, pane => $.ui.open(pane))}
        <Text dimColor>Sources · {view.providers.join(', ') || 'No sources'}</Text>
        <Text dimColor>Stack · {project.stack.join(', ') || 'Not detected'}</Text>
        <Toolbar>
          <Button
            key="tab-installed"
            label={`${tab === 'installed' ? '✓ ' : ''}Installed (${view.installed.length})`}
            variant={tab === 'installed' ? 'primary' : 'secondary'}
            hotkey="1"
            onPress={() => showSkillsTab($, 'installed')}
          />
          <Button
            key="tab-catalog"
            label={tab === 'catalog' ? '✓ Catalog' : 'Catalog'}
            variant={tab === 'catalog' ? 'primary' : 'secondary'}
            hotkey="2"
            onPress={() => showSkillsTab($, 'catalog')}
          />
        </Toolbar>
        {feedback}
        {tab === 'installed' ? (
          <Box flexDirection="column" gap={1}>
            {view.installed.length === 0 ? (
              <Card>
                <Text bold>Your first skill is waiting.</Text>
                <Text dimColor>Browse the catalog to add it to this project.</Text>
                {!isBusy && <Button key="browse-empty" label="Browse catalog" variant="primary" onPress={() => showSkillsTab($, 'catalog')} />}
              </Card>
            ) : (
              <Box flexDirection="column" gap={1}>
                {!isBusy && (
                  <Toolbar>
                    <Button
                      key="update-all"
                      label={outdatedCount > 0 ? `Update (${outdatedCount})` : 'Check for updates'}
                      variant={outdatedCount > 0 ? 'primary' : 'secondary'}
                      onPress={() => outdatedCount > 0 ? updateAllSkills($) : refreshInstalled($)}
                    />
                    <Button key="refresh" label="Refresh" dimColor onPress={() => refreshInstalled($)} />
                  </Toolbar>
                )}
                {view.installed.map(skill => (
                  <Box key={`installed-${skill.providerId}-${skill.resourceName}`} flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
                    <Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={1}>
                      <Box flexDirection="column" flexGrow={1} minWidth={0}>
                        <Text bold>{skillLabel(skill.resourceName)}</Text>
                        <Text dimColor>{skill.providerId}{skill.isPinned ? ' · Pinned' : ''}</Text>
                        <Text >{skillStatus(skill.status)}</Text>
                        <Text dimColor>Version · {skill.installedVersion || 'Not provided'}{skill.latestVersion && skill.latestVersion !== skill.installedVersion ? ` → ${skill.latestVersion}` : ''}</Text>
                      </Box>
                      {!isBusy && view.pendingRemoval !== `${skill.providerId}:${skill.resourceName}` && (
                        <Button
                          key={`remove-${skill.providerId}-${skill.resourceName}`}
                          label="Remove"
                          plain
                          dimColor
                          onPress={() => setSkills($, { pendingRemoval: `${skill.providerId}:${skill.resourceName}` })}
                        />
                      )}
                    </Box>
                    {!isBusy && view.pendingRemoval === `${skill.providerId}:${skill.resourceName}` && (
                      <Box flexDirection="column" gap={1} marginTop={1}>
                        <Text>Remove {skillLabel(skill.resourceName)} from this project?</Text>
                        {skill.status.includes('modified') && <Text color="red">STH protects local changes. Back them up and restore the original file before removing this skill.</Text>}
                        <Toolbar>
                          <Button key={`cancel-${skill.providerId}-${skill.resourceName}`} label="Keep" variant="primary" onPress={() => setSkills($, { pendingRemoval: null })} />
                          <Button key={`confirm-${skill.providerId}-${skill.resourceName}`} label="Confirm removal" onPress={() => removeSkill($, skill)} />
                        </Toolbar>
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {needle === '' && recommendations.length > 0 && (
              <Box key="recommendations" flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
                <Text bold>Recommended for this project</Text>
                {recommendations.map(({ skill, reason }) => (
                  <Box key={`recommend-${skill.providerId}-${skill.catalogId}`} flexDirection="column">
                    <Text bold>{skill.name}</Text>
                    <Text dimColor>{reason}</Text>
                    {skill.description !== '' && <Text>{skill.description}</Text>}
                    <Text dimColor>Version · {skill.version || 'Not provided by the catalog'}</Text>
                    {!isBusy && <Button key={`recommend-install-${skill.providerId}-${skill.catalogId}`} label="Install" variant="primary" onPress={() => installSkill($, skill)} />}
                  </Box>
                ))}
              </Box>
            )}
            <Input
              key="filter"
              label="Search: "
              placeholder="name or description"
              value={view.filter}
              autoFocus
              submitLabel="search"
              onInput={value => setSkills($, { filter: value })}
              onSubmit={value => setSkills($, { filter: value })}
            />
            {view.catalog === null ? (
              !isBusy && <Button key="load-catalog" label="Load catalog" variant="primary" onPress={() => loadCatalog($)} />
            ) : (
              <Box flexDirection="column" gap={1}>
                <Text dimColor>{matches.length} skill{matches.length !== 1 ? 's' : ''} available</Text>
                {matches.length === 0 && (
                  <Text dimColor>{needle ? 'No results. Try another search term.' : view.catalog.length === 0 ? 'This catalog has no skills.' : 'All catalog skills are installed.'}</Text>
                )}
                {matches.slice(0, CATALOG_ROWS).map(skill => (
                  <Box key={`catalog-${skill.providerId}-${skill.catalogId}`} flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1}>
                    <Box flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" gap={1}>
                      <Box flexDirection="column" flexGrow={1} minWidth={0}>
                        <Text bold>{skill.name}</Text>
                        <Text dimColor>{skill.folderName} · {skill.kind} · {skill.providerId}</Text>
                      </Box>
                      {!isBusy && (
                        <Button key={`install-${skill.providerId}-${skill.catalogId}`} label="Install" variant="primary" onPress={() => installSkill($, skill)} />
                      )}
                    </Box>
                    {skill.description !== '' && <Text dimColor>{skill.description}</Text>}
                    <Text dimColor>Version · {skill.version || 'Not provided by the catalog'}</Text>
                  </Box>
                ))}
                {matches.length > CATALOG_ROWS && <Text dimColor>{CATALOG_ROWS} results shown. Refine your search to see more.</Text>}
              </Box>
            )}
          </Box>
        )}
        {footer}
      </Page>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const { Page, Card, Button } = panelChrome($.ui.resolve(e), e)
    const moreOpen = await read($, moreMenuOpen)
    const current = await read($, snapshot)
    const skillsView = await read($, skills)
    const totals = await read($, tokens)
    const turnCount = await read($, turns)
    const activity = await read($, activityView)
    const context = await read($, contextView)
    const working = (await read($, isWorking)) || skillsView.busy !== null
    const fika = await read($, fikaEligibility)
    const showFika = fika.ready && !fika.hasPrompt && !working &&
      (e.surface === 'terminal' || e.surface === 'desktop')
    const state = activityBuddyState(activity) ?? buddyState(working, current, turnCount)
    const nowMs = await $.clock.now()
    const playingFika = showFika && fika.playingUntil != null && fika.playingUntil > nowMs
    const caption = playingFika ? 'Buddy is taking a fika break in Stockholm' : activityCaption(activity) ?? BUDDY_CAPTIONS[state]
    const buddy = await buddyElement($, e, PANE, state, caption,
      playingFika ? fika.playingUntil! - FIKA_DURATION_MS : null, showFika)
    const pills = statusPills({ ...context, limits: current.limits }, totals, current.costUsd, nowMs)

    return (
      <Page>
        <Box key="usage-header" flexDirection="column" gap={1} alignItems="center">
          {fikaThought($, e, showFika, playingFika)}
          {buddy}
          <Box flexDirection="column" alignItems="center">
            <Text bold>Buddy</Text>
            <Text key="buddy-caption" dimColor wrap="truncate-end">{caption}</Text>
          </Box>
        </Box>
        <Box key="workflow-actions" flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
          <Button key="open-skills" label="STH" variant="primary" onPress={() => openSkillsPane($)} />
          <Button key="open-activity" label="Summary" onPress={() => $.ui.open({ id: 'sth-activity', title: 'Buddy · Summary', focus: true })} />
          <Button key="nav-more" label={moreOpen ? 'Less ↑' : 'More ↓'} hotkey="m" onPress={async () => {
            await update($, moreMenuOpen, current => !current)
            $.ui.invalidate('ui.render')
          }} />
        </Box>
        {moreOpen && <Box key="more-menu" flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="open-context" label="Context" onPress={() => $.ui.open({ id: 'sth-context', title: 'Buddy · Context', rows: 36, columns: 50, focus: true })} />
          <Button key="open-doctor" label="Diagnostics" onPress={() => $.ui.open({ id: 'sth-doctor', title: 'Buddy · Diagnostics', rows: 36, columns: 50, focus: true })} />
          <Button key="open-resume" label="Resume" onPress={() => $.ui.open({ id: 'sth-resume', title: 'Buddy · Resume', rows: 36, columns: 50, focus: true })} />
        </Box>}

        <Card key="session-consumption">
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
            <Text bold>Usage</Text>
            <Text dimColor>{turnCount} turn{turnCount !== 1 ? 's' : ''}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {pills.map(pill => usagePillElement(elements, e, pill))}
          </Box>
          {current.limits.length === 0 && <Text dimColor>Quotas are unavailable for this session.</Text>}
          {context.context?.tokens == null && <Text dimColor>Context is available after the first response.</Text>}
          {pills.some(pill => pill.key.startsWith('tokens-')) && <Text dimColor>~ Tokens observed since the mod loaded.</Text>}
        </Card>
        {dashboardLink($, e, 'Open the STH dashboard')}
        <Text key="plugin-version" dimColor>STH v{PLUGIN_VERSION}</Text>
      </Page>
    )
  })
}
