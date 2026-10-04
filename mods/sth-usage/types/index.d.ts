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
}

export type CatalogSkill = {
  catalogId: string
  providerId: string
  folderName: string
  name: string
  kind: string
  description: string
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
    }
  }
}
