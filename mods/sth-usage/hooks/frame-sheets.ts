import { unzlibSync } from './vendor/inflate.js'
import { toBase64 } from './buddy-codec'

/** Buddy's frame sheets, one image file per animation (see tools/frame_sheets.py).
 * Desktop sheets are animated WebP: each frame is rebuilt into the exact still
 * pose it was made from, without decoding a pixel. Terminal sheets are animated
 * PNG: each 96 x 96 RGBA pose is its own zlib stream, inflated when drawn.
 */
export const RASTER_SIZE = 96
// Portable quadrant drawing: Buddy's states at 10 FPS, Fika at 15 FPS for nine seconds.
export const RASTER_COLUMNS = 48
export const RASTER_ROWS = 24
export const RASTER_FPS = 10
export const FIKA_RASTER_FPS = 15
export const FIKA_DURATION_MS = 9_000

export type RasterSheet = { name: string; frames: Uint8Array[] }
export type RasterPose = { key: string; width: number; height: number; rgba: Uint8Array }

const ALPHA = 0x10, ANIMATION = 0x02, REPLACE = 0x02
const STILL_HEADER = [87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, ALPHA, 0, 0, 0] // WEBP, VP8X (10 bytes), alpha
const PNG = [137, 80, 78, 71, 13, 10, 26, 10]
const RASTER_HEADER = [0, 0, 0, RASTER_SIZE, 0, 0, 0, RASTER_SIZE, 8, 6, 0, 0, 0] // 8-bit RGBA, not interlaced

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function riffChunks(bytes: Uint8Array, offset: number): { kind: string; start: number; end: number }[] {
  const chunks = [], data = view(bytes)
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated WebP chunk')
    const start = offset + 8, end = start + data.getUint32(offset + 4, true)
    if (end > bytes.length) throw new Error('Truncated WebP chunk')
    chunks.push({ kind: ascii(bytes, offset), start, end })
    offset = end + ((end - start) & 1)
  }
  if (offset !== bytes.length) throw new Error('WebP chunk padding runs past the sheet')
  return chunks
}

/** Every pose of an animated WebP sheet, as base64 still WebP files. */
export function webpPoses(bytes: Uint8Array): string[] {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WEBP' || view(bytes).getUint32(4, true) !== bytes.length - 8) {
    throw new Error('Invalid WebP sheet')
  }
  const [header, animation, ...frames] = riffChunks(bytes, 12)
  if (header?.kind !== 'VP8X' || header.end - header.start !== 10 || bytes[header.start] !== (ALPHA | ANIMATION) ||
      animation?.kind !== 'ANIM' || !frames.length) throw new Error('Expected an animated WebP sheet with alpha')
  const canvas = bytes.subarray(header.start + 4, header.end)
  return frames.map((frame, index) => {
    const data = bytes.subarray(frame.start + 16, frame.end)
    if (frame.kind !== 'ANMF' || frame.end - frame.start < 16 || bytes.subarray(frame.start, frame.start + 6).some(Boolean) ||
        bytes.subarray(frame.start + 6, frame.start + 12).some((value, at) => value !== canvas[at]) || bytes[frame.start + 15] !== REPLACE ||
        riffChunks(data, 0).map(chunk => chunk.kind).join() !== 'ALPH,VP8 ') throw new Error(`Invalid WebP sheet frame ${index}`)
    const still = new Uint8Array(30 + data.length)
    still.set([82, 73, 70, 70]) // RIFF
    view(still).setUint32(4, still.length - 8, true)
    still.set(STILL_HEADER, 8)
    still.set(canvas, 24)
    still.set(data, 30)
    return toBase64(still)
  })
}

/** Splits an animated PNG raster sheet into its poses' zlib streams. */
export function rasterSheet(bytes: Uint8Array, name: string): RasterSheet {
  if (PNG.some((value, index) => bytes[index] !== value)) throw new Error('Invalid PNG sheet')
  const data = view(bytes), kinds: string[] = [], frames: Uint8Array[][] = []
  let offset = 8, count = -1, sequence = 0
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk')
    const kind = ascii(bytes, offset + 4), start = offset + 8, end = start + data.getUint32(offset)
    if (end + 4 > bytes.length) throw new Error('Truncated PNG chunk')
    offset = end + 4 // Packaging checks every shipped byte; chunk CRCs add nothing here.
    kinds.push(kind)
    if (kind === 'IHDR') {
      if (end - start !== 13 || RASTER_HEADER.some((value, index) => bytes[start + index] !== value)) throw new Error('Raster sheets are 96 x 96 RGBA')
    } else if (kind === 'acTL') {
      count = data.getUint32(start)
    } else if (kind === 'fcTL') {
      if (end - start !== 26 || data.getUint32(start) !== sequence++ || data.getUint32(start + 4) !== RASTER_SIZE ||
          data.getUint32(start + 8) !== RASTER_SIZE || data.getUint32(start + 12) || data.getUint32(start + 16) ||
          bytes[start + 24] || bytes[start + 25]) throw new Error('Raster frames must cover and replace the whole canvas in order')
      frames.push([])
    } else if (kind === 'IDAT' || kind === 'fdAT') {
      const parts = frames[frames.length - 1]
      if (!parts || (kind === 'IDAT') !== (frames.length === 1)) throw new Error('Raster frame data is out of order')
      if (kind === 'fdAT' && data.getUint32(start) !== sequence++) throw new Error('Raster frame data is out of sequence')
      parts.push(bytes.subarray(kind === 'fdAT' ? start + 4 : start, end))
    } else if (kind !== 'IEND') {
      throw new Error(`Unexpected PNG chunk in a raster sheet: ${kind}`)
    }
  }
  if (kinds[0] !== 'IHDR' || kinds[1] !== 'acTL' || kinds[kinds.length - 1] !== 'IEND' || !frames.length || count !== frames.length) {
    throw new Error('Invalid raster sheet')
  }
  return {
    name,
    frames: frames.map(parts => {
      const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
      parts.reduce((at, part) => { joined.set(part, at); return at + part.length }, 0)
      return joined
    }),
  }
}

/** Inflates one pose: rows of PNG filter 0, alpha 0 (transparent) or 255. */
export function rasterPose(sheet: RasterSheet, index: number): RasterPose {
  const data = sheet.frames[index]
  if (!data) throw new Error('Missing Buddy raster pose')
  const stride = 1 + RASTER_SIZE * 4
  const raw: Uint8Array = unzlibSync(data, { out: new Uint8Array(RASTER_SIZE * stride + 1) })
  if (raw.length !== RASTER_SIZE * stride) throw new Error('Invalid Buddy raster pose size')
  const rgba = new Uint8Array(RASTER_SIZE * RASTER_SIZE * 4)
  for (let row = 0; row < RASTER_SIZE; row += 1) {
    if (raw[row * stride]) throw new Error('Buddy raster rows must use PNG filter 0')
    rgba.set(raw.subarray(row * stride + 1, (row + 1) * stride), row * RASTER_SIZE * 4)
  }
  return { key: `${sheet.name}:${index}`, width: RASTER_SIZE, height: RASTER_SIZE, rgba }
}
