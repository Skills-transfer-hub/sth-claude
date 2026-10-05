import { STH_FONTS, STH_OKLCH, STH_RADII, STH_UI } from './sth-theme'

export type UsagePill = {
  key: string
  label: string
  value: string
  detail: string
  tone: 'neutral' | 'destructive'
  percent?: number
  /** Fraction of the quota window already elapsed, from 0 to 1. */
  elapsed?: number
}

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => XML_ENTITIES[character]!)
}

function clamp(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, value))
}

function shortLabel(label: string, maximum: number): string {
  const characters = Array.from(label)
  return characters.length <= maximum ? label : `${characters.slice(0, maximum - 1).join('')}…`
}

/** Each source is a self-contained SVG, suitable for the desktop Svg element. */
export function pillSvg(pill: UsagePill, compact = false): { source: string, width: number, height: number } {
  const maximumWidth = compact ? 180 : 270
  const height = compact ? 32 : 36
  const labelFont = compact ? 10 : 12
  const valueFont = 12
  const label = shortLabel(pill.label, compact ? 8 : 12)
  const labelWidth = Math.ceil(Array.from(label).length * labelFont * 0.62)
  const valueLength = Array.from(pill.value).length
  const naturalValueWidth = Math.ceil(valueLength * valueFont * 0.62)
  const percent = typeof pill.percent === 'number' && Number.isFinite(pill.percent)
    ? clamp(pill.percent, 100) : undefined
  const elapsed = typeof pill.elapsed === 'number' && Number.isFinite(pill.elapsed)
    ? clamp(pill.elapsed, 1) : undefined
  // Give the actual value priority; narrower surfaces can omit the miniature bar.
  const barWidth = percent !== undefined && labelWidth + naturalValueWidth + 72 <= maximumWidth ? 36 : 0
  const barSpace = barWidth ? barWidth + 12 : 0
  const valueX = 12 + labelWidth + 12 + barSpace
  const width = Math.min(maximumWidth, Math.max(76, valueX + naturalValueWidth + 12))
  const availableValueWidth = width - valueX - 12
  const fittedValue = naturalValueWidth > availableValueWidth
    ? ` textLength="${availableValueWidth}" lengthAdjust="spacingAndGlyphs"` : ''
  const baseline = height / 2 + 4
  const barX = 12 + labelWidth + 12
  const barY = height / 2 - 2
  const destructive = pill.tone === 'destructive'
  const semanticClass = destructive ? ' destructive' : ''
  const progress = barWidth && percent !== undefined ? `
  <rect class="track" x="${barX}" y="${barY}" width="${barWidth}" height="4" rx="2"/>
  ${percent > 0 ? `<rect class="progress${semanticClass}" x="${barX}" y="${barY}" width="${(barWidth * percent / 100).toFixed(2)}" height="4" rx="2"/>` : ''}
  ${elapsed !== undefined ? `<path class="elapsed" d="M${(barX + barWidth * elapsed).toFixed(2)} ${barY - 4}v12"/>` : ''}` : ''
  // Declare sRGB first for native SVG renderers; supporting renderers use the
  // exact canonical OKLch role. Labels and values use separate DS font families.
  const theme = (mode: 'light' | 'dark') => {
    const fallback = STH_UI[mode]
    const exact = STH_OKLCH[mode]
    const color = (property: string, role: keyof typeof fallback) => `${property}:${fallback[role]};${property}:${exact[role]}`
    return `.surface{${color('fill', 'card')};${color('stroke', 'border')}}
    .label{${color('fill', 'mutedForeground')}}.value{${color('fill', 'foreground')}}
    .track{${color('fill', 'muted')}}.progress{${color('fill', 'primary')}}
    .elapsed{${color('stroke', 'mutedForeground')}}.destructive{${color('fill', 'destructive')}}`
  }
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(pill.detail)}">
  <title>${xml(pill.detail)}</title>
  <style>
    .label{font-family:${STH_FONTS.sans}}.value{font-family:${STH_FONTS.mono};font-variant-numeric:tabular-nums}
    .elapsed{stroke-width:1;stroke-linecap:round}
    ${theme('light')}
    @media(prefers-color-scheme:dark){${theme('dark')}}
  </style>
  <rect class="surface" x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="${STH_RADII.badge}"/>
  <text class="label" x="12" y="${baseline}" font-size="${labelFont}" font-weight="500">${xml(label)}</text>${progress}
  <text class="value${semanticClass}" x="${valueX}" y="${baseline}" font-size="${valueFont}" font-weight="600"${fittedValue}>${xml(pill.value)}</text>
</svg>`
  return { source, width, height }
}

/** Compact time until reset; missing or malformed timestamps must not invent a reset. */
export function remainingTime(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt || !Number.isFinite(nowMs)) return ''
  const resetMs = Date.parse(resetsAt)
  if (!Number.isFinite(resetMs)) return ''
  const remainingMinutes = Math.max(0, Math.ceil((resetMs - nowMs) / 60_000))
  const days = Math.floor(remainingMinutes / 1440)
  const hours = Math.floor(remainingMinutes % 1440 / 60)
  const minutes = remainingMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return remainingMinutes > 0 ? `${minutes}m` : '0 min'
}

/** Only the API's named five-hour and seven-day windows have a known duration. */
export function windowElapsed(kind: string, resetsAt: string | undefined, nowMs: number): number | undefined {
  const duration = kind === 'five_hour' ? 5 * 60 * 60_000
    : kind === 'seven_day' || kind.startsWith('seven_day_') ? 7 * 24 * 60 * 60_000 : undefined
  if (!duration || !resetsAt || !Number.isFinite(nowMs)) return undefined
  const resetMs = Date.parse(resetsAt)
  return Number.isFinite(resetMs) ? clamp(1 - (resetMs - nowMs) / duration, 1) : undefined
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (absolute >= 999_950) return `${sign}${(absolute / 1_000_000).toFixed(2)}M`
  if (absolute >= 999.5) return `${sign}${(absolute / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}
