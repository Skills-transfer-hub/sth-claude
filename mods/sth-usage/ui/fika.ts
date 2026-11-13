import type { ClientModule } from 'claude-code'
import { askForPoses, poseAt, poseSvg, posesFor } from './frame-stream'
import type { PoseBatch } from './frame-stream'

const FPS = 30

type FikaProps = { startFrame: number; caption: string; count: number; batch?: PoseBatch }
// The hook owns eligibility and the nine-second lifetime; this clock draws locally.
const Fika: ClientModule<FikaProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    const last = props.count - 1
    surface.setState(Math.min(last, Math.max(0, props.startFrame)))
    const stop = surface.every(1000 / FPS, () => {
      const frame = Math.min(last, (surface.state ?? 0) + 1)
      surface.setState(frame)
      if (frame === last) stop()
    })
  }
  const frame = surface.state ?? props.startFrame
  const poses = posesFor('fika', props.batch)
  askForPoses(data => surface.post(data), 'fika', poses, frame, props.count, false, frame)
  return poseSvg(poseAt(poses, frame), props.caption)
}

export default Fika
