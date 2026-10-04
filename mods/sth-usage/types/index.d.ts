export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type LimitWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type UsageSnapshot = {
  limits: LimitWindow[]
  costUsd: number | null
}

export type InstalledSkill = {
  resourceName: string
  providerId: string
  status: string
  isPinned: boolean
  installedVersion?: string
  latestVersion?: string
}

export type CatalogSkill = {
  catalogId: string
  providerId: string
  folderName: string
  name: string
  kind: string
  description: string
  version?: string
}

export type SkillsView = {
  isLinked: boolean
  providers: string[]
  installed: InstalledSkill[]
  catalog: CatalogSkill[] | null
  filter: string
  busy: string | null
  message: string | null
  isError: boolean
  pendingRemoval: string | null
}

export type InitDraft = {
  provider: string
  repository: string
  ref: string
  catalogPath: string
  targets: string[]
  isPrivate: boolean
}

export type FikaEligibility = {
  startedAt: number | null
  hasPrompt: boolean
  ready: boolean
  playingUntil: number | null
}

export type TestEvidence = {
  label: string
  status: 'passed' | 'failed' | 'unknown'
  exitCode: number | null
}

export type ActivitySummary = {
  files: string[]
  tests: TestEvidence[]
  toolErrors: number
  durationMs: number
  reason: string
  nextStep: string
}

export type ResumeSummary = {
  version: 1
  savedAt: number
  objective: string
  files: string[]
  tests: TestEvidence[]
  nextStep: string
}

export type ActivityView = {
  phase: 'ready' | 'working' | 'permission' | 'error' | 'complete' | 'interrupted'
  waitingTool: string | null
  objective: string
  files: string[]
  tests: TestEvidence[]
  toolErrors: number
  last: ActivitySummary | null
  resume: ResumeSummary | null
  message: string | null
  testsRunning: boolean
  testCommand: { label: string; argv: string[] } | null
}

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

declare module 'claude-code' {
  interface PluginState {
    'sth-usage': {
      tokens: TokenTotals
      turns: number
      isWorking: boolean
      snapshot: UsageSnapshot
      alerted: string[]
      skills: SkillsView
      initDraft: InitDraft
      initAdvanced: boolean
      skillsTab: 'installed' | 'catalog'
      fika: FikaEligibility
      contextView: {
        context: SessionContextUsage | null
        limits: SessionRateLimit[] | null
        agents: AgentInfo[] | null
        error: string | null
        refreshedAt: number | null
      }
      activityView: ActivityView
      projectView: ProjectView
    }
  }
}
