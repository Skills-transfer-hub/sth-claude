import type { JsonValue } from 'claude-code'

/** Desktop poses come from the hooks module, which reads them from the plugin's
 * frame sheets: a client asks for the first pose it lacks, ahead of playback,
 * and keeps every pose it receives for the life of the drawing thread.
 */
export type PoseBatch = { sequence: string; first: number; poses: string[] }

const received = new Map<string, string[]>()
const asked = new Map<string, { first: number; tick: number }>()
// An unanswered ask (a dropped post) is repeated after about a second.
const RETRY_TICKS = 20

export function posesFor(sequence: string, batch: PoseBatch | undefined): string[] {
  let poses = received.get(sequence)
  if (!poses) received.set(sequence, poses = [])
  if (batch?.sequence === sequence && Number.isInteger(batch.first) && Array.isArray(batch.poses)) {
    batch.poses.forEach((pose, offset) => { if (typeof pose === 'string') poses![batch.first + offset] = pose })
    if (asked.get(sequence)?.first === batch.first) asked.delete(sequence)
  }
  return poses
}

/** Posts `{ sequence, first }` for the first missing pose from `frame` on. */
export function askForPoses(post: (data: JsonValue) => void, sequence: string, poses: string[], frame: number, count: number, loop: boolean, tick: number): void {
  for (let step = 0; step < count; step += 1) {
    const index = loop ? (frame + step) % count : frame + step
    if (index >= count) return
    if (poses[index] !== undefined) continue
    const previous = asked.get(sequence)
    // A new instance restarts its clock, so an older ask never holds it back.
    if (previous?.first === index && tick >= previous.tick && tick - previous.tick < RETRY_TICKS) return
    asked.set(sequence, { first: index, tick })
    post({ sequence, first: index })
    return
  }
}

/** The pose for `frame`, else the latest one received before it. */
export function poseAt(poses: string[], frame: number): string | undefined {
  for (let index = frame; index >= 0; index -= 1) if (poses[index] !== undefined) return poses[index]
  return undefined
}

export function poseSvg(pose: string | undefined, alt: string) {
  return {
    type: 'Svg' as const,
    props: {
      source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 384" width="144" height="144">' +
        (pose ? `<image href="data:image/webp;base64,${pose}" width="384" height="384"/>` : '') + '</svg>',
      alt,
      width: 144,
      height: 144,
      isInteractive: false,
    },
  }
}
