import type { ThemeSetArgs } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'
import { scene } from '../hooks/scene'

const BACKDROP = {
  plugin: 'sth-theme',
  component: 'Backdrop',
  props: { scene: 'fika', plugin: 'sth-theme', glass: { blur: 0, opacity: 0.45 } },
} as const

test('a session starts with the Buddy colors and the fika scene in one theme', async ($, on) => {
  let look: ThemeSetArgs | undefined

  on('theme.set', (_, e) => {
    look = e

    return { value: { isDrawn: true, requestId: 'look' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // No blur: the app's default glass (16 points) turned Buddy into a smear. A 45% tint keeps the muted text
  // readable over the scene: at 30% only 70% of the chat column reached 4.5:1 in light mode.
  expect(look?.backdrop).toEqual({ scene: 'fika', glass: { blur: 0, opacity: 0.45 } })
  // Desktop ignores the whole theme over a line like this one; the other lines are notes.
  expect(checkColors(look?.colors).filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
})

test('both apps draw the same still scene, one SVG within the size limit', async $ => {
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    const tree = await ui.drawn()

    expect(tree.type).toBe('Svg')

    const source = tree.type === 'Svg' ? tree.props.source : ''
    const alt = tree.type === 'Svg' ? tree.props.alt : 'not drawn'

    // The one instant the still shows, 4 s in.
    expect(source).toBe(scene(4))
    expect(source.length).toBeLessThanOrEqual(131072)
    // The desktop app's own schema refuses an empty or blank alt (`alt: string().trim().min(1)`) and then draws no
    // backdrop at all, though the engine accepts it: 0.1.1 and 0.1.2 shipped '' and showed nothing in the app.
    expect(alt.trim().length).toBeGreaterThan(0)
    // A wash of the window's own color, there for the system's "more contrast" and invisible otherwise.
    expect(source).toContain('@media (prefers-contrast:more){:root{--calm-o:.6}}')
    expect(source).toContain('fill="var(--calm)" style="opacity:var(--calm-o)"')
    expect(source).toContain('--calm-o:0}')
    // The app's backdrop draws no image, not even a data: PNG (seen on screen): Buddy is vector.
    expect(source).not.toContain('<image')
    expect(source).not.toContain('data:image')
    // His cup is down on the bench, not lifted to his mouth.
    expect(source).toContain('class="cu" transform="translate(0 0) rotate(0 338 294)"')
    // Buddy's statuses on the little Buddies: four at work (`>_<`), three idle (one looks, one waves, one
    // jumps), one waiting, one failed, and the one at the window in review. Four more doze off sitting,
    // their eyes shut, three z's each.
    expect(source.match(/M33 35L41 42L33 49/g)).toHaveLength(4)
    expect(source.match(/M34.5 43.5H44.5M55.5 43.5H65.5/g)).toHaveLength(4)
    expect(source.match(/>z<\/text>/g)).toHaveLength(12)
    expect(source.match(/M35.5 42.5L39.5 36L43.5 42.5/g)).toHaveLength(3)
    expect(source.match(/cx="40" cy="44" r="1.9"/g)).toHaveLength(1)
    expect(source.match(/M39 41L45 47M45 41L39 47/g)).toHaveLength(1)
    expect(source.match(/cx="58" cy="45" r="6"/g)).toHaveLength(1)
    await ui.unmount()
  }
})

test("another mod's backdrop is left to the engine", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, plugin: 'someone-else' }, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
