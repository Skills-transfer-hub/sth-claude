import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { scene } from './scene'

const SCENE = 'fika'

// Buddy by STH: chalk by day, graphite by night, and the terminal's one emerald. The grays are
// the design system's neutrals, tinted a few points toward Buddy's own pets. The other roles
// only keep code readable; the design system has no accent besides the emerald.
// The backdrop is Buddy's fika nook (scene.ts), morning in light mode and evening in dark mode.
const { theme } = makeColors({
  label: 'Buddy',
  roles: { accent: '#3bb974', danger: '#e7000b', success: '#7bb33e', warning: '#c98a1b', pro: '#8b6fb8' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f8f8f5',
        'surface-1': '#fcfcfa',
        'surface-2': '#ffffff',
        'text-primary': '#0a0a0a',
        'text-secondary': '#47474a',
        'text-muted': '#66666a',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0f0f11',
        'surface-1': '#151517',
        'surface-2': '#19191c',
        'surface-3': '#19191c',
        'text-primary': '#ecebe4',
        'text-secondary': '#c4c3bc',
        'text-muted': '#9a9a96',
      },
    },
  },
})

// The desktop app frosts its panels over the backdrop, 16 points of blur under a tint 60% opaque by
// default, which turns Buddy into a smear. No blur and a light tint let him show through the panels.
const GLASS = { blur: 0, opacity: 0.3 }

const LOOK: ThemeSetArgs = { colors: theme, backdrop: { scene: SCENE, glass: GLASS } }

const ALT = 'Buddy prend sa pause fika dans un coin cosy : un café, une kanelbulle, une lampe, une fenêtre sur le jour ou sur la nuit.'

// The app draws a backdrop as a still: no CSS or SMIL animation plays in an SVG, no image is drawn, and no
// `Client` is mounted there (three of them in the backdrop never posted, nor failed), while redrawing the
// scene through the engine, ten times a second, flickered. So the backdrop is one instant of the scene,
// 4 s in: Buddy's cup is down on his bench and the little Buddies are spread out.
const STILL = scene(4)

export const register: Register = on => {
  // One call names the whole theme, and a reload or a resume loses it: set it here.
  on('session.start', async ($, e, next) => {
    await $.theme.set(LOOK)
    // A reload keeps the status line the version before it wrote: clear it.
    $.ui.status(undefined)

    return next(e)
  })

  // Every plugin's hook hears the Backdrop: draw only this mod's scene.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== $.plugin.name || e.props.scene !== SCENE) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={STILL} alt={ALT} />
  })
}
