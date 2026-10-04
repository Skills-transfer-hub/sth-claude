import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

// Rebuild with Node 22+: node tools/preview_usage_pills.mjs [path/to/design-system]
// Sources are copied, never modified. The right panel uses the production SVG renderer.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'previews/usage-band')
const designSystem = resolve(process.argv[2] ?? join(root, '../../../design-system'))
const source = await readFile(join(root, 'hooks/usage-pills.ts'), 'utf8')
const themeSource = await readFile(join(root, 'hooks/sth-theme.ts'), 'utf8')
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString('base64')}`
const { pillSvg } = await import(moduleUrl(source.replace("'./sth-theme'", JSON.stringify(moduleUrl(themeSource)))))

await mkdir(join(output, 'ds/tokens'), { recursive: true })
await copyFile(join(root, 'assets/frames/ok/000.png'), join(output, 'buddy-original.png'))
await copyFile(join(designSystem, 'styles.css'), join(output, 'ds/styles.css'))
for (const file of ['colors.css', 'typography.css', 'spacing.css', 'fonts.css', 'base.css']) {
  await copyFile(join(designSystem, 'tokens', file), join(output, 'ds/tokens', file))
}
const componentStyles = []
for (const component of ['Button', 'Badge', 'Card']) {
  const componentSource = await readFile(join(designSystem, 'components/core', `${component}.jsx`), 'utf8')
  const css = componentSource.match(/const CSS = `([\s\S]*?)`;/)?.[1]
  if (!css) throw new Error(`Missing CSS in ${component}.jsx`)
  componentStyles.push(`/* Copied from STH ${component}.jsx. */\n${css}`)
}
await writeFile(join(output, 'ds/components.css'), componentStyles.join('\n'))

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const pill = (key, label, value, detail, percent, elapsed, tone = 'neutral') => ({ key, label, value, detail, percent, elapsed, tone })
const standard = [
  pill('5h', '5 h', '20% · 2h 40m', 'Example: 5-hour window, 20% used, 80% remaining. Resets in 2 h 40 min.', 20, 0.467),
  pill('7d', '7 d', '58% · 1d 7h', 'Example: 7-day window, 58% used, 42% remaining. Resets in 1 d 7 h.', 58, 0.816),
  pill('context', 'Context', '32%', 'Example: 64,000 tokens in a 200,000-token window.', 32),
  pill('input', 'Input', '~15.6k', 'Example: 15,600 received and cache-write tokens observed by the mod.'),
  pill('output', 'Output', '~3.0k', 'Example: 3,000 generated tokens observed by the mod.'),
  pill('cache', 'Cache', '~954.2k', 'Example: 954,200 cache-read tokens observed by the mod.'),
  pill('cost', 'Cost', '$4.32', 'Example: session cost estimated at API rates, separate from subscription billing.'),
  pill('agents', 'Agents', '2', 'Example: 2 active agents, running or waiting.'),
]
const scenarios = {
  standard,
  near: [pill('5h', '5 h', '92% · 18m', 'Example: 5-hour window near the limit, 92% used. Resets in 18 min.', 92, 0.94), ...standard.slice(1)],
  full: [pill('5h', '5 h', '100% · 12m', 'Example: 5-hour quota reached. Resets in 12 min.', 100, 0.96), ...standard.slice(1)],
}

function renderPill(item, theme, compact = false) {
  const { source, width, height } = pillSvg(item, compact)
  // Preview the renderer's two real palettes regardless of the viewer's OS theme.
  // Everything else, including the accessible SVG title, is emitted unchanged.
  const forcedSource = source.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, theme === 'dark' ? '@media all' : '@media not all')
  const document = `<!doctype html><html lang="en" class="${theme === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><link rel="stylesheet" href="./ds/styles.css"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;color-scheme:${theme}}svg{display:block}</style></head><body>${forcedSource}</body></html>`
  return `<iframe class="usage-pill" title="${escape(item.detail)}" width="${width}" height="${height}" style="color-scheme:${theme}" srcdoc="${escape(document)}"></iframe>`
}

const variants = []
for (const theme of ['light', 'dark']) {
  for (const [scenario, items] of Object.entries(scenarios)) {
    for (const compact of [false, true]) {
      const markup = `<p class="small-label">Claude quotas</p><div class="quota-metrics">${items.slice(0, 2).map(item => renderPill(item, theme, compact)).join('')}</div><div class="metric-divider"></div><p class="small-label">Session</p><div class="session-metrics">${items.slice(2).map(item => renderPill(item, theme, compact)).join('')}</div>`
      variants.push(`<template id="metrics-${theme}-${scenario}-${compact ? 'compact' : 'standard'}">${markup}</template>`)
    }
  }
}
const template = await readFile(join(output, 'template.html'), 'utf8')
const manifest = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'))
const html = template.replace('{{METRIC_VARIANTS}}', variants.join('\n')).replaceAll('{{PLUGIN_VERSION}}', escape(manifest.version))
await writeFile(join(output, 'index.html'), html.replace(/[\t ]+$/gm, ''))
console.log(`Built ${pathToFileURL(join(output, 'index.html')).href} from hooks/usage-pills.ts and STH design-system sources.`)
