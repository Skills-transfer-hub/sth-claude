/** Download immutable pixel data once, then give the existing renderer a local
 * plugin-shaped root. This module has no host access: its caller supplies IO.
 * No remote source is imported or executed, and playback never uses the network.
 */
export type BuddyAssetIO = {
  root: string
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  fetchText: (url: string) => Promise<{ ok: boolean; status: number; text: string }>
}
export type BuddyAssetProgress = {
  phase: 'checking' | 'downloading' | 'ready'
  completed: number
  total: number
  bytes: number
  totalBytes: number
}

type Chunk = { path: string; firstFrame: number; frameCount: number; bytes: number; sha256: string }
type Entry = { sequence: string; size: number; chunk: Chunk }
type ValidManifest = { id: string; baseUrl: string; index: string; entries: Entry[]; totalBytes: number }
const COUNTS: Record<string, number> = { ok: 80, work: 48, done: 38, error: 30, update: 36, noConfig: 72, fika: 270 }
const HASH = /^[a-f0-9]{64}$/
const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const REMOTE = /^https:\/\/raw\.githubusercontent\.com\/Skills-transfer-hub\/sth-claude\/[a-f0-9]{40}\/mods\/sth-usage\/assets\/buddy-codec\/$/
const PACKET_LIMIT = 4 * 1024 * 1024
const TOTAL_LIMIT = 64 * 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Buddy asset manifest')
  return value as Record<string, unknown>
}

// The builder uses sorted compact ASCII JSON and a final newline. Asset indexes
// contain ASCII metadata only; sorting recursively reproduces that exact input.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function validateManifest(value: unknown, indexText: string): Promise<ValidManifest> {
  if (indexText.length > 256 * 1024 || /[^\x00-\x7f]/.test(indexText)) throw new Error('Invalid Buddy asset index size or encoding')
  // Copy from the serialized input, so a caller cannot mutate a validated plan.
  const manifest = record(JSON.parse(indexText))
  if (canonical(manifest) !== canonical(value)) throw new Error('Buddy asset manifest does not match its index')
  const remote = record(manifest.remote)
  if (typeof remote.baseUrl !== 'string' || !REMOTE.test(remote.baseUrl) || typeof remote.id !== 'string' || !HASH.test(remote.id)) {
    throw new Error('Buddy assets require an immutable STH source')
  }
  if (manifest.format !== 'sth-rgba-delta-v1' || manifest.codec !== 'zlib-rgba-subtract' || manifest.keyframeInterval !== 30) {
    throw new Error('Unsupported Buddy asset format')
  }
  const sequences = record(manifest.sequences)
  if (Object.keys(sequences).sort().join(',') !== Object.keys(COUNTS).sort().join(',')) throw new Error('Invalid Buddy animation sequences')
  const entries: Entry[] = []
  let totalBytes = 0
  for (const sequence of Object.keys(COUNTS)) {
    const info = record(sequences[sequence]), count = COUNTS[sequence]!, size = sequence === 'fika' ? 720 : 384
    if (info.width !== size || info.height !== size || info.frameCount !== count || info.chunkSize !== 6 || info.keyframeInterval !== 30 ||
        typeof info.rgbaSha256 !== 'string' || !HASH.test(info.rgbaSha256) || info.decodedRgbaSha256 !== info.rgbaSha256 ||
        !Array.isArray(info.chunks) || info.chunks.length !== Math.ceil(count / 6)) throw new Error(`Invalid Buddy sequence: ${sequence}`)
    for (let i = 0; i < info.chunks.length; i++) {
      const input = record(info.chunks[i]), firstFrame = i * 6, path = `${sequence}/${String(firstFrame).padStart(4, '0')}.json`
      if (input.path !== path || input.firstFrame !== firstFrame || input.frameCount !== Math.min(6, count - firstFrame) ||
          typeof input.bytes !== 'number' || !Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes >= PACKET_LIMIT ||
          typeof input.sha256 !== 'string' || !HASH.test(input.sha256)) throw new Error(`Invalid Buddy packet: ${path}`)
      totalBytes += input.bytes
      if (totalBytes > TOTAL_LIMIT) throw new Error('Buddy assets exceed the download limit')
      entries.push({ sequence, size, chunk: { path, firstFrame, frameCount: input.frameCount as number, bytes: input.bytes, sha256: input.sha256 } })
    }
  }
  const { remote: _remote, ...local } = manifest
  const index = canonical(local) + '\n'
  if (await sha256(index) !== remote.id) throw new Error('Buddy asset index checksum mismatch')
  return { id: remote.id, baseUrl: remote.baseUrl, index, entries, totalBytes }
}

async function verifyPacket(text: string, entry: Entry): Promise<void> {
  // The character bound avoids encoding an unexpectedly enormous response.
  if (text.length >= PACKET_LIMIT || new TextEncoder().encode(text).byteLength !== entry.chunk.bytes || await sha256(text) !== entry.chunk.sha256) {
    throw new Error(`Buddy asset checksum mismatch: ${entry.chunk.path}`)
  }
  const packet = record(JSON.parse(text))
  if (packet.format !== 'sth-rgba-delta-v1' || packet.sequence !== entry.sequence || packet.width !== entry.size || packet.height !== entry.size ||
      packet.firstFrame !== entry.chunk.firstFrame || packet.keyframeInterval !== 30 || !Array.isArray(packet.frames) || packet.frames.length !== entry.chunk.frameCount) {
    throw new Error(`Invalid Buddy pixel packet: ${entry.chunk.path}`)
  }
  for (let i = 0; i < packet.frames.length; i++) {
    const frame = record(packet.frames[i]), number = entry.chunk.firstFrame + i
    if (frame.frame !== number || frame.kind !== (number % 30 === 0 ? 'key' : 'delta') || typeof frame.sha256 !== 'string' || !HASH.test(frame.sha256) ||
        typeof frame.data !== 'string' || frame.data.length < 8 || frame.data.length > 699052 || frame.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)) {
      throw new Error(`Invalid Buddy pixel frame: ${entry.chunk.path}`)
    }
  }
}

function generationFromPointer(text: string, id: string): string {
  const pointer = record(JSON.parse(text))
  if (pointer.id !== id || typeof pointer.generation !== 'string' || !GENERATION.test(pointer.generation)) throw new Error('Invalid Buddy cache pointer')
  return pointer.generation
}

/** A local source checkout or self-contained release keeps its original root.
 * A hosted release becomes ready only after all seven animations are verified.
 * Failed and simultaneous downloads cannot overwrite a completed generation.
 */
export async function prepareBuddyAssets(
  manifest: unknown, indexText: string, cacheBase: string, io: BuddyAssetIO,
  onProgress?: (progress: BuddyAssetProgress) => void,
): Promise<string> {
  if (!manifest || typeof manifest !== 'object' || !('remote' in manifest)) return io.root
  const plan = await validateManifest(manifest, indexText)
  if (!cacheBase || cacheBase.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(cacheBase)) throw new Error('Invalid Buddy cache directory')
  const base = `${cacheBase.replace(/[\\/]+$/, '')}/${plan.id}`, pointerPath = `${base}/ready.json`
  const report = (phase: BuddyAssetProgress['phase'], completed: number, bytes: number) => {
    // Progress is informational and cannot invalidate already verified pixels.
    try { onProgress?.({ phase, completed, total: plan.entries.length, bytes, totalBytes: plan.totalBytes }) } catch { /* Ignore UI-only failures. */ }
  }
  report('checking', 0, 0)
  try {
    const generation = generationFromPointer(await io.read(pointerPath), plan.id), root = `${base}/${generation}`
    if (await io.read(`${root}/assets/buddy-codec/index.json`) !== plan.index) throw new Error('Incomplete Buddy asset cache')
    let checked = 0, bytes = 0, next = 0, invalid: unknown
    const check = async () => {
      while (next < plan.entries.length && !invalid) {
        const entry = plan.entries[next++]!
        try {
          await verifyPacket(await io.read(`${root}/assets/buddy-codec/${entry.chunk.path}`), entry)
          report('checking', ++checked, bytes += entry.chunk.bytes)
        } catch (error) { invalid = error || new Error('Incomplete Buddy asset cache') }
      }
    }
    await Promise.all(Array.from({ length: 4 }, check))
    if (invalid) throw invalid
    report('ready', checked, bytes)
    return root
  } catch { /* A missing, truncated or stale cache is repaired in a new generation. */ }

  const root = `${base}/${crypto.randomUUID()}`
  let next = 0, completed = 0, bytes = 0, failed: unknown
  report('downloading', 0, 0)
  async function worker(): Promise<void> {
    while (next < plan.entries.length && !failed) {
      const entry = plan.entries[next++]!
      try {
        const response = await io.fetchText(plan.baseUrl + entry.chunk.path)
        if (!response.ok || response.status < 200 || response.status >= 300) throw new Error(`Buddy asset download failed (${response.status}): ${entry.chunk.path}`)
        await verifyPacket(response.text, entry)
        const path = `${root}/assets/buddy-codec/${entry.chunk.path}`
        await io.write(path, response.text)
        // fs.write is not atomic. Never publish a partial or failed disk write.
        await verifyPacket(await io.read(path), entry)
        report('downloading', ++completed, bytes += entry.chunk.bytes)
      } catch (error) { failed = error || new Error('Buddy asset preparation failed') }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (failed) throw failed
  const indexPath = `${root}/assets/buddy-codec/index.json`
  await io.write(indexPath, plan.index)
  if (await io.read(indexPath) !== plan.index) throw new Error('Incomplete Buddy cache index write')
  await io.write(pointerPath, JSON.stringify({ id: plan.id, generation: root.slice(base.length + 1) }))
  // Another session can be writing this advisory pointer at the same time.
  // Each caller already owns a fully verified generation. A partial pointer
  // merely causes a cache repair on the next launch; it cannot select bad pixels.
  report('ready', completed, bytes)
  return root
}
