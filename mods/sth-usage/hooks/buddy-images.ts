import type { ImageSource } from 'claude-code'
import { makeDecoder, toBase64 } from './buddy-codec'
import type { Packet } from './buddy-codec'

type Sequence = 'ok' | 'work' | 'done' | 'error' | 'update' | 'noConfig' | 'fika'
const COUNTS: Record<Sequence, number> = { ok: 80, work: 48, done: 38, error: 30, update: 36, noConfig: 72, fika: 270 }
const CHUNK_SIZE = 6
const KEYFRAME_INTERVAL = 30
type ReadFile = (path: string) => Promise<string>
type Exists = (path: string) => Promise<boolean>

/** The release bundle stores the original pixels as lossless temporal deltas.
 * Source checkouts keep using their original PNG files. Each reader retains
 * only one decoded frame, one packet, and one base64 image, never the animation.
 */
export function createBuddyImageReader() {
  const decoder = makeDecoder()
  let packed: boolean | undefined
  let currentSequence: Sequence | undefined
  let currentFrame = -1
  let packet: Packet | undefined
  let source: ImageSource | undefined
  let pending: Promise<unknown> = Promise.resolve()

  async function read(root: string, exists: Exists, readFile: ReadFile, sequence: Sequence, requested: number): Promise<ImageSource> {
    if (!Number.isFinite(requested)) throw new Error('Invalid Buddy frame')
    const frame = ((Math.floor(requested) % COUNTS[sequence]) + COUNTS[sequence]) % COUNTS[sequence]
    if (packed === undefined) packed = await exists(`${root}/assets/buddy-codec/index.json`)
    if (!packed) return { format: 'png', file: sequence === 'fika'
      ? `${root}/assets/fika/fika-${String(frame + 1).padStart(4, '0')}.png`
      : `${root}/assets/frames/${sequence}/${String(frame).padStart(3, '0')}.png` }
    if (currentSequence === sequence && currentFrame === frame && source) return source
    const keyframe = Math.floor(frame / KEYFRAME_INTERVAL) * KEYFRAME_INTERVAL
    if (currentSequence !== sequence || currentFrame > frame || currentFrame < keyframe) {
      decoder.reset()
      currentSequence = sequence
      currentFrame = keyframe - 1
      packet = undefined
      source = undefined
    }
    let rgba: Uint8Array | undefined
    while (currentFrame < frame) {
      const next = currentFrame + 1
      const first = Math.floor(next / CHUNK_SIZE) * CHUNK_SIZE
      if (!packet || packet.sequence !== sequence || packet.firstFrame !== first) {
        packet = JSON.parse(await readFile(`${root}/assets/buddy-codec/${sequence}/${String(first).padStart(4, '0')}.json`)) as Packet
        const size = sequence === 'fika' ? 720 : 384
        if (packet.sequence !== sequence || packet.firstFrame !== first || packet.width !== size || packet.height !== size || !Array.isArray(packet.frames) || packet.frames.length > CHUNK_SIZE) throw new Error('Invalid Buddy frame packet')
      }
      const encoded = packet.frames[next - first]
      if (!encoded || encoded.frame !== next || encoded.kind !== (next % KEYFRAME_INTERVAL === 0 ? 'key' : 'delta')) throw new Error('Missing Buddy frame')
      rgba = decoder.decode(packet, encoded)
      currentFrame = next
    }
    if (!rgba || !packet) throw new Error('Buddy image is unavailable')
    source = { rgba: toBase64(rgba), width: packet.width, height: packet.height }
    return source
  }

  return {
    read(root: string, exists: Exists, readFile: ReadFile, sequence: Sequence, frame: number): Promise<ImageSource> {
      // A render and its animation clock can request the same reader together.
      // Serialize their mutations so a delta always has the right predecessor.
      const result = pending.then(() => read(root, exists, readFile, sequence, frame))
      pending = result.catch(() => { decoder.reset(); currentFrame = -1; currentSequence = undefined; packet = undefined; source = undefined })
      return result
    },
  }
}
