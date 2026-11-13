import type { ClientModule } from 'claude-code'
import { askForPoses, poseAt, poseSvg, posesFor } from './frame-stream'
import type { PoseBatch } from './frame-stream'

type BuddyProps = { state: string; caption: string; count: number; batch?: PoseBatch }

// One local clock, one HD pose at a time. The pane sends the state and caption;
// the hooks module answers this module's requests with the state's poses.
const Buddy: ClientModule<BuddyProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState(0)
    surface.every(50, () => surface.setState((surface.state ?? 0) + 1))
  }
  const tick = surface.state ?? 0
  const frame = tick % props.count
  const poses = posesFor(props.state, props.batch)
  askForPoses(data => surface.post(data), props.state, poses, frame, props.count, true, tick)
  return poseSvg(poseAt(poses, frame), props.caption)
}

export default Buddy
