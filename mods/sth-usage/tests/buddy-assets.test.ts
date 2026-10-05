import { describe, expect, test } from 'claude-code/testing'
import { prepareBuddyAssets } from '../hooks/buddy-assets'
import type { BuddyAssetIO, BuddyAssetProgress } from '../hooks/buddy-assets'

const COUNTS = { ok: 80, work: 48, done: 38, error: 30, update: 36, noConfig: 72, fika: 270 }
const BASE_URL = `https://raw.githubusercontent.com/Skills-transfer-hub/sth-claude/${'a'.repeat(40)}/mods/sth-usage/assets/buddy-codec/`
const CACHE = '/buddy-cache'
type Chunk = { path: string; firstFrame: number; frameCount: number; bytes: number; sha256: string }
type Sequence = { width: number; height: number; frameCount: number; chunkSize: number; keyframeInterval: number; rgbaSha256: string; decodedRgbaSha256: string; chunks: Chunk[] }
type Manifest = { format: string; codec: string; keyframeInterval: number; sequences: Record<string, Sequence>; remote: { baseUrl: string; id: string } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
async function hash(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('')
}
async function fixture() {
  const packets = new Map<string, string>(), sequences: Record<string, Sequence> = {}
  for (const [name, count] of Object.entries(COUNTS)) {
    const size = name === 'fika' ? 720 : 384, chunks: Chunk[] = []
    for (let first = 0; first < count; first += 6) {
      const path = `${name}/${String(first).padStart(4, '0')}.json`, frameCount = Math.min(6, count - first)
      // Small deterministic data tests transport and cache integrity. Real pixel
      // decoding is covered independently by buddy-codec.test.ts.
      const text = JSON.stringify({ format: 'sth-rgba-delta-v1', sequence: name, width: size, height: size, firstFrame: first, keyframeInterval: 30,
        frames: Array.from({ length: frameCount }, (_, offset) => ({ frame: first + offset, kind: (first + offset) % 30 === 0 ? 'key' : 'delta', data: 'eJwDAAAAAAE=', sha256: 'b'.repeat(64) })) })
      packets.set(BASE_URL + path, text)
      chunks.push({ path, firstFrame: first, frameCount, bytes: text.length, sha256: await hash(text) })
    }
    sequences[name] = { width: size, height: size, frameCount: count, chunkSize: 6, keyframeInterval: 30, rgbaSha256: 'c'.repeat(64), decodedRgbaSha256: 'c'.repeat(64), chunks }
  }
  const original = { format: 'sth-rgba-delta-v1', codec: 'zlib-rgba-subtract', keyframeInterval: 30, sequences }
  const manifest: Manifest = { ...original, remote: { baseUrl: BASE_URL, id: await hash(canonical(original) + '\n') } }
  return { packets, manifest, indexText: canonical(manifest) + '\n' }
}

function memoryIO(packets: Map<string, string>) {
  const files = new Map<string, string>(), fetches: string[] = [], writes: string[] = []
  let offline = false, active = 0, maximumActive = 0
  const io: BuddyAssetIO = {
    root: '/source-plugin',
    read: async path => { const text = files.get(path); if (text === undefined) throw new Error('ENOENT'); return text },
    write: async (path, text) => { writes.push(path); files.set(path, text) },
    fetchText: async url => {
      fetches.push(url)
      if (offline) throw new Error('Network unavailable')
      active++; maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active--
      const text = packets.get(url)
      return { ok: text !== undefined, status: text === undefined ? 404 : 200, text: text ?? 'Not found' }
    },
  }
  return { io, files, fetches, writes, setOffline: (value: boolean) => { offline = value }, get maximumActive() { return maximumActive } }
}

describe('Buddy immutable asset preparation', () => {
  test('source checkouts and self-contained bundles keep their local root without IO', async () => {
    const memory = memoryIO(new Map())
    expect(await prepareBuddyAssets(undefined, '', CACHE, memory.io)).toBe('/source-plugin')
    expect(await prepareBuddyAssets({ format: 'sth-rgba-delta-v1' }, '{}', CACHE, memory.io)).toBe('/source-plugin')
    expect(memory.fetches).toHaveLength(0)
    expect(memory.writes).toHaveLength(0)
  })

  test('downloads every original packet with four workers and publishes readiness last', async () => {
    const data = await fixture(), memory = memoryIO(data.packets), progress: BuddyAssetProgress[] = []
    const root = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io, value => { progress.push(value) })
    expect(memory.fetches.length).toBe(97)
    expect(memory.maximumActive).toBe(4)
    for (const [url, text] of data.packets) expect(memory.files.get(`${root}/assets/buddy-codec/${url.slice(BASE_URL.length)}`)).toBe(text)
    expect(memory.writes.slice(-2)).toEqual([`${root}/assets/buddy-codec/index.json`, `${CACHE}/${data.manifest.remote.id}/ready.json`])
    const last = progress[progress.length - 1]!
    expect(last.phase).toBe('ready')
    expect(last.completed).toBe(last.total)
    expect(last.bytes).toBe(last.totalBytes)
  })

  test('warm startup verifies the entire cache and works with no network', async () => {
    const data = await fixture(), memory = memoryIO(data.packets)
    const first = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    const requests = memory.fetches.length, writes = memory.writes.length
    memory.setOffline(true)
    expect(await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)).toBe(first)
    expect(memory.fetches).toHaveLength(requests)
    expect(memory.writes).toHaveLength(writes)
  })

  test('cold offline startup fails clearly and never marks incomplete pixels ready', async () => {
    const data = await fixture(), memory = memoryIO(data.packets)
    memory.setOffline(true)
    await expect(prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)).rejects.toThrow('Network unavailable')
    expect(memory.files.has(`${CACHE}/${data.manifest.remote.id}/ready.json`)).toBe(false)
    expect(memory.fetches.length <= 4).toBe(true)
  })

  test('404s stop the download without publishing a cache', async () => {
    const data = await fixture(), memory = memoryIO(data.packets)
    data.packets.delete(BASE_URL + 'ok/0000.json')
    await expect(prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)).rejects.toThrow('404')
    expect(memory.files.has(`${CACHE}/${data.manifest.remote.id}/ready.json`)).toBe(false)
  })

  test('a same-length altered response fails SHA-256 before being stored', async () => {
    const data = await fixture(), memory = memoryIO(data.packets), url = BASE_URL + 'ok/0000.json'
    data.packets.set(url, data.packets.get(url)!.replace('eJwD', 'eJwE'))
    await expect(prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)).rejects.toThrow('checksum mismatch')
    expect(memory.writes.some(path => path.endsWith('/ok/0000.json'))).toBe(false)
    expect(memory.files.has(`${CACHE}/${data.manifest.remote.id}/ready.json`)).toBe(false)
  })

  test('a partial disk write is detected and a later retry repairs into a fresh generation', async () => {
    const data = await fixture(), memory = memoryIO(data.packets), write = memory.io.write
    memory.io.write = async (path, text) => write(path, path.endsWith('/ok/0000.json') ? text.slice(0, -1) : text)
    await expect(prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)).rejects.toThrow('checksum mismatch')
    expect(memory.files.has(`${CACHE}/${data.manifest.remote.id}/ready.json`)).toBe(false)
    const failedPath = memory.writes.find(path => path.endsWith('/ok/0000.json'))!
    memory.io.write = write
    const root = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    expect(failedPath.startsWith(root + '/')).toBe(false)
    expect(memory.files.get(`${root}/assets/buddy-codec/ok/0000.json`)).toBe(data.packets.get(BASE_URL + 'ok/0000.json'))
  })

  test('a corrupted warm cache is never used and is rebuilt without changing the old generation', async () => {
    const data = await fixture(), memory = memoryIO(data.packets)
    const oldRoot = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    memory.files.set(`${oldRoot}/assets/buddy-codec/fika/0264.json`, '{}')
    const root = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    expect(root === oldRoot).toBe(false)
    expect(memory.files.get(`${oldRoot}/assets/buddy-codec/fika/0264.json`)).toBe('{}')
    expect(memory.fetches).toHaveLength(194)
  })

  test('simultaneous sessions publish separate complete generations and reuse either pointer offline', async () => {
    const data = await fixture(), memory = memoryIO(data.packets)
    const roots = await Promise.all([prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io), prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)])
    expect(roots[0] === roots[1]).toBe(false)
    for (const root of roots) for (const url of data.packets.keys()) expect(memory.files.has(`${root}/assets/buddy-codec/${url.slice(BASE_URL.length)}`)).toBe(true)
    memory.setOffline(true)
    const warmRoot = await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    expect(roots.includes(warmRoot)).toBe(true)
    expect(memory.fetches).toHaveLength(194)
  })

  test('a ready pointer cannot redirect reads outside its generation directory', async () => {
    const data = await fixture(), memory = memoryIO(data.packets), reads: string[] = [], read = memory.io.read
    memory.files.set(`${CACHE}/${data.manifest.remote.id}/ready.json`, JSON.stringify({ id: data.manifest.remote.id, generation: '../../outside' }))
    memory.io.read = async path => { reads.push(path); return read(path) }
    await prepareBuddyAssets(data.manifest, data.indexText, CACHE, memory.io)
    expect(reads.some(path => path.includes('..'))).toBe(false)
  })

  for (const [name, change] of [
    ['mutable branch URL', (m: Manifest) => { m.remote.baseUrl = BASE_URL.replace('a'.repeat(40), 'main') }],
    ['different host', (m: Manifest) => { m.remote.baseUrl = BASE_URL.replace('raw.githubusercontent.com', 'example.com') }],
    ['URL query', (m: Manifest) => { m.remote.baseUrl += '?x=' }],
    ['path traversal', (m: Manifest) => { m.sequences.ok!.chunks[0]!.path = '../evil.json' }],
    ['missing sequence', (m: Manifest) => { delete m.sequences.fika }],
    ['wrong dimensions', (m: Manifest) => { m.sequences.ok!.width = 720 }],
    ['missing frames', (m: Manifest) => { m.sequences.fika!.frameCount = 269 }],
    ['packet too large', (m: Manifest) => { m.sequences.ok!.chunks[0]!.bytes = 4 * 1024 * 1024 }],
    ['total too large', (m: Manifest) => { for (const s of Object.values(m.sequences)) for (const c of s.chunks) c.bytes = 1024 * 1024 }],
    ['index checksum', (m: Manifest) => { m.remote.id = 'd'.repeat(64) }],
  ] as const) {
    test(`rejects ${name} before any network or disk write`, async () => {
      const data = await fixture(), memory = memoryIO(data.packets)
      change(data.manifest)
      await expect(prepareBuddyAssets(data.manifest, canonical(data.manifest) + '\n', CACHE, memory.io)).rejects.toThrow()
      expect(memory.fetches).toHaveLength(0)
      expect(memory.writes).toHaveLength(0)
    })
  }
})
