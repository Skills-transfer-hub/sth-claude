import { describe, expect, test } from 'claude-code/testing'
import { fromBase64 } from '../hooks/buddy-codec'
import { rasterPose, rasterSheet, webpPoses } from '../hooks/frame-sheets'
import { desktopFixture, rasterFixture, sheetFixture } from './frame-fixtures'

function sheet(path: string): Uint8Array {
  const contents = sheetFixture(path)
  if (contents === undefined) throw new Error(`No fixture for ${path}`)
  return fromBase64(contents)
}

describe('Buddy frame sheets', () => {
  test('a desktop sheet rebuilds every still pose byte for byte', () => {
    for (const sequence of ['ok', 'fika'] as const) {
      expect(webpPoses(sheet(`/plugin/assets/desktop/${sequence}.webp`))).toEqual(desktopFixture(sequence))
    }
  })

  test('a terminal sheet inflates each pose to its exact RGBA', () => {
    const poses = rasterSheet(sheet('/plugin/assets/terminal/noConfig.png'), 'noConfig')
    const expected = rasterFixture('noConfig')
    expect(poses.frames).toHaveLength(expected.length)
    for (const index of [0, 1, expected.length - 1]) {
      const pose = rasterPose(poses, index)
      expect(pose.key).toBe(`noConfig:${index}`)
      expect(pose.rgba).toEqual(expected[index]!.rgba)
    }
    expect(() => rasterPose(poses, expected.length)).toThrow('Missing Buddy raster pose')
  })

  test('a blended WebP frame or a filtered PNG row is refused', () => {
    const webp = sheet('/plugin/assets/desktop/error.webp').slice()
    // RIFF header 12, VP8X chunk 18, ANIM chunk 14, ANMF chunk header 8: the frame's flags byte is its 16th.
    webp[12 + 18 + 14 + 8 + 15] = 0
    expect(() => webpPoses(webp)).toThrow('Invalid WebP sheet frame 0')
    const png = sheet('/plugin/assets/terminal/error.png').slice()
    // Signature 8, IHDR 25, acTL 20, fcTL 38, IDAT header 8, zlib header 2, stored block header 5: the first row's filter byte.
    png[8 + 25 + 20 + 38 + 8 + 2 + 5] = 1
    expect(() => rasterPose(rasterSheet(png, 'error'), 0)).toThrow('Buddy raster rows must use PNG filter 0')
  })
})
