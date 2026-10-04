import type { ClientModule } from 'claude-code'
import frames, { FPS } from './frames/fika/index'

type FikaProps = { startFrame: number; caption: string }
// The hook owns eligibility and the nine-second lifetime; this clock draws locally.
const Fika: ClientModule<FikaProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState(Math.min(frames.length - 1, Math.max(0, props.startFrame)))
    const stop = surface.every(1000 / FPS, () => {
      const frame = Math.min(frames.length - 1, (surface.state ?? 0) + 1)
      surface.setState(frame)
      if (frame === frames.length - 1) stop()
    })
  }
  const pose = frames[surface.state ?? props.startFrame]!
  return {
    type: 'Svg',
    props: {
      source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 384" width="144" height="144">' +
        `<image href="data:image/webp;base64,${pose}" width="384" height="384"/></svg>`,
      alt: props.caption,
      width: 144,
      height: 144,
      isInteractive: false,
    },
  }
}

export default Fika
