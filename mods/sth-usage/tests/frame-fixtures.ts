import type { RasterPose } from '../hooks/frame-sheets'

/** Synthetic frame sheets in the shipped formats, built here independently of
 * hooks/frame-sheets.ts. Tests cannot read the plugin's files; they serve these
 * through their fs.read stubs instead. Real sheets are checked against the
 * original poses by tools/test_directory_packaging.py.
 */
const DESKTOP_COUNTS = { ok: 80, work: 48, done: 38, error: 30, update: 36, noConfig: 72, fika: 270 } as const
const RASTER_COUNTS = { ok: 40, work: 24, done: 19, error: 15, update: 18, noConfig: 36, fika: 135 } as const
export type FixtureSequence = keyof typeof DESKTOP_COUNTS
const SIZE = 96

function u32le(value: number): number[] { return [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255] }
function u32be(value: number): number[] { return u32le(value).reverse() }
function u24(value: number): number[] { return u32le(value).slice(0, 3) }
function text(value: string): number[] { return [...value].map(character => character.charCodeAt(0)) }
function base64(bytes: ArrayLike<number>): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
  return btoa(binary)
}

function riffChunk(kind: string, payload: number[]): number[] {
  return [...text(kind), ...u32le(payload.length), ...payload, ...(payload.length & 1 ? [0] : [])]
}
function riff(chunks: number[][]): number[] {
  const body = [...text('WEBP'), ...chunks.flat()]
  return [...text('RIFF'), ...u32le(body.length), ...body]
}
const VP8X = (flags: number) => riffChunk('VP8X', [flags, 0, 0, 0, ...u24(383), ...u24(383)])

// Payload lengths vary with the index, so odd chunks exercise RIFF padding.
function stillChunks(sequence: string, index: number): number[][] {
  return [riffChunk('ALPH', text(`alpha ${sequence} ${index}`)), riffChunk('VP8 ', text(`vp8 ${sequence} pose ${index * 7}`))]
}

const desktop = new Map<FixtureSequence, string[]>()
/** The still WebP poses a desktop sheet must reproduce, base64. */
export function desktopFixture(sequence: FixtureSequence): string[] {
  let poses = desktop.get(sequence)
  if (!poses) {
    poses = Array.from({ length: DESKTOP_COUNTS[sequence] }, (_, index) => base64(riff([VP8X(0x10), ...stillChunks(sequence, index)])))
    desktop.set(sequence, poses)
  }
  return poses
}

function webpSheet(sequence: FixtureSequence): string {
  const frames = Array.from({ length: DESKTOP_COUNTS[sequence] }, (_, index) =>
    riffChunk('ANMF', [...u24(0), ...u24(0), ...u24(383), ...u24(383), ...u24(50), 0x02, ...stillChunks(sequence, index).flat()]))
  return base64(riff([VP8X(0x12), riffChunk('ANIM', [0, 0, 0, 0, 0, 0]), ...frames]))
}

// A distinct, colorful disc per pose; corners stay transparent.
function rasterRgba(sequence: FixtureSequence, index: number): Uint8Array {
  const seed = text(sequence).reduce((sum, value) => sum + value, 0) + index * 37
  const rgba = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if ((x - 47.5) ** 2 + (y - 47.5) ** 2 > 44 ** 2) continue
      rgba.set([(x * 2 + seed) & 255, (y * 2 + seed * 3) & 255, (x + y + seed * 5) & 255, 255], (y * SIZE + x) * 4)
    }
  }
  return rgba
}

const raster = new Map<FixtureSequence, RasterPose[]>()
/** The poses a terminal sheet must decode to. Keys differ from the plugin's, so
 * the raster cache can never hand a test the plugin's own result. */
export function rasterFixture(sequence: FixtureSequence): RasterPose[] {
  let poses = raster.get(sequence)
  if (!poses) {
    poses = Array.from({ length: RASTER_COUNTS[sequence] }, (_, index) =>
      ({ key: `fixture:${sequence}:${index}`, width: SIZE, height: SIZE, rgba: rasterRgba(sequence, index) }))
    raster.set(sequence, poses)
  }
  return poses
}

const CRC = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1
  return value >>> 0
})
function pngChunk(kind: string, payload: number[]): number[] {
  let crc = 0xffffffff
  for (const byte of [...text(kind), ...payload]) crc = CRC[(crc ^ byte) & 255]! ^ crc >>> 8
  return [...u32be(payload.length), ...text(kind), ...payload, ...u32be((crc ^ 0xffffffff) >>> 0)]
}
// Stored (uncompressed) deflate blocks: no compressor is needed to make a valid stream.
function zlibStored(data: Uint8Array): number[] {
  const out = [0x78, 0x01]
  for (let start = 0; start < data.length; start += 65_535) {
    const block = data.subarray(start, start + 65_535)
    out.push(start + 65_535 >= data.length ? 1 : 0, block.length & 255, block.length >>> 8, ~block.length & 255, ~block.length >>> 8 & 255)
    for (const byte of block) out.push(byte)
  }
  let a = 1, b = 0
  for (const byte of data) { a = (a + byte) % 65_521; b = (b + a) % 65_521 }
  return [...out, ...u32be((b << 16 | a) >>> 0)]
}

function pngSheet(sequence: FixtureSequence): string {
  const chunks = [pngChunk('IHDR', [...u32be(SIZE), ...u32be(SIZE), 8, 6, 0, 0, 0]), pngChunk('acTL', [...u32be(RASTER_COUNTS[sequence]), ...u32be(0)])]
  let order = 0
  rasterFixture(sequence).forEach((pose, index) => {
    const rows = new Uint8Array(SIZE * (1 + SIZE * 4))
    for (let row = 0; row < SIZE; row += 1) rows.set(pose.rgba.subarray(row * SIZE * 4, (row + 1) * SIZE * 4), row * (1 + SIZE * 4) + 1)
    chunks.push(pngChunk('fcTL', [...u32be(order++), ...u32be(SIZE), ...u32be(SIZE), ...u32be(0), ...u32be(0), 0, 100, 3, 232, 0, 0]))
    chunks.push(index ? pngChunk('fdAT', [...u32be(order++), ...zlibStored(rows)]) : pngChunk('IDAT', zlibStored(rows)))
  })
  return base64([137, 80, 78, 71, 13, 10, 26, 10, ...chunks.flat(), ...pngChunk('IEND', [])])
}

const sheets = new Map<string, string>()
/** The base64 contents of a frame sheet path the plugin reads, else undefined. */
export function sheetFixture(path: string): string | undefined {
  const match = /\/assets\/(desktop|terminal)\/(ok|work|done|error|update|noConfig|fika)\.(webp|png)$/.exec(path)
  if (!match || (match[1] === 'desktop') !== (match[3] === 'webp')) return undefined
  let sheet = sheets.get(path)
  if (!sheet) {
    const sequence = match[2] as FixtureSequence
    sheet = match[1] === 'desktop' ? webpSheet(sequence) : pngSheet(sequence)
    sheets.set(path, sheet)
  }
  return sheet
}
