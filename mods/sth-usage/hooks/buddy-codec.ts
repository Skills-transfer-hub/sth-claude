import { unzlibSync } from './vendor/inflate.js'

export type Frame = { frame: number; kind: 'key' | 'delta'; data: string; sha256: string }
export type Packet = { format: 'sth-rgba-delta-v1'; sequence: string; width: number; height: number; firstFrame: number; frames: Frame[] }

export function fromBase64(value: string): Uint8Array {
  const bytes = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array }
  if (bytes.fromBase64) return bytes.fromBase64(value)
  const binary = atob(value)
  const output = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i)
  return output
}

export function toBase64(value: Uint8Array): string {
  const bytes = value as Uint8Array & { toBase64?: () => string }
  if (bytes.toBase64) return bytes.toBase64()
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += 0x8000) chunks.push(String.fromCharCode(...value.subarray(i, i + 0x8000)))
  return btoa(chunks.join(''))
}

// fflate's sync decoder does not verify its zlib Adler checksum itself.
function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(bytes.length, start + 5552)
    for (let i = start; i < end; i++) { a += bytes[i]!; b += a }
    a %= 65521; b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** One prior frame and one temporary inflate buffer; no unbounded frame cache. */
export function makeDecoder() {
  let previous: Uint8Array | null = null
  let sequence = '', frameNumber = -1, width = 0, height = 0
  return {
    decode(packet: Packet, frame: Frame): Uint8Array {
      const size = packet.width * packet.height * 4
      if (packet.format !== 'sth-rgba-delta-v1' || !Number.isInteger(size) || size < 4 || size > 2 * 1024 * 1024) throw new Error('Invalid RGBA dimensions')
      const sequential = sequence === packet.sequence && width === packet.width && height === packet.height && frameNumber + 1 === frame.frame
      if (frame.kind !== 'key' && (!sequential || !previous)) throw new Error('Missing delta predecessor; seek from a keyframe')
      const compressed = fromBase64(frame.data)
      if (compressed.length < 6 || compressed.length > 512 * 1024) throw new Error('Invalid compressed frame size')
      const inflated: Uint8Array = unzlibSync(compressed, { out: new Uint8Array(size + 1) })
      if (inflated.length !== size) throw new Error('Unexpected decoded frame size')
      const tail = compressed.length - 4
      const expectedAdler = ((compressed[tail]! << 24) | (compressed[tail + 1]! << 16) | (compressed[tail + 2]! << 8) | compressed[tail + 3]!) >>> 0
      if (adler32(inflated) !== expectedAdler) throw new Error('Corrupt frame checksum')
      if (frame.kind === 'key') previous = inflated
      else for (let i = 0; i < size; i++) previous![i] = (previous![i]! + inflated[i]!) & 255
      sequence = packet.sequence; frameNumber = frame.frame; width = packet.width; height = packet.height
      return previous!
    },
    reset() { previous = null; sequence = ''; frameNumber = -1; width = 0; height = 0 },
    get cachedBytes() { return previous?.byteLength ?? 0 },
  }
}
