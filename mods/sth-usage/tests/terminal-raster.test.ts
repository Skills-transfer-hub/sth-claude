import { describe, expect, test } from 'claude-code/testing'
import { terminalRaster } from '../hooks/terminal-raster'
import type { RasterPose } from '../hooks/frame-sheets'

const DEFAULT = 0x01000000
let poses = 0
// One palette index per pixel (0 is transparent), or count/index pairs when `runs` is set.
function pose(width: number, height: number, palette: number[], payload: number[], runs = 0): RasterPose {
  const indices = runs ? payload.flatMap((count, at) => at % 2 ? [] : Array<number>(count).fill(payload[at + 1]!)) : payload
  const rgba = new Uint8Array(width * height * 4)
  indices.forEach((index, pixel) => {
    if (index) rgba.set([palette[index - 1]! >> 16 & 255, palette[index - 1]! >> 8 & 255, palette[index - 1]! & 255, 255], pixel * 4)
  })
  return { key: `test:${poses++}`, width, height, rgba }
}
function cells(encoded: string): number[][] {
  const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const result: number[][] = []
  for (let offset = 0; offset < bytes.length; offset += 12) {
    result.push([view.getUint32(offset, true), view.getUint32(offset + 4, true), view.getUint32(offset + 8, true)])
  }
  return result
}

describe('Buddy source poses and quadrant geometry', () => {
  test('all sixteen quadrant masks retain the exact transparent silhouette', () => {
    const glyphs = [...' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█']
    for (let mask = 0; mask < 16; mask += 1) {
      const source = pose(2, 2, [0x123456], [0, 1, 2, 3].map(bit => mask & 1 << bit ? 1 : 0))
      expect(cells(terminalRaster(source, 1, 1))).toEqual([[glyphs[mask]!.codePointAt(0), mask ? 0x123456 : DEFAULT, DEFAULT]])
    }
  })

  test('pixels are read row by row and opaque black stays visible', () => {
    const raw = pose(4, 4, [0xff0000, 0x0000ff], [1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2])
    const rle = pose(4, 4, [0xff0000, 0x0000ff], [2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2], 1)
    expect(terminalRaster(raw, 2, 2)).toBe(terminalRaster(rle, 2, 2))
    expect(cells(terminalRaster(rle, 2, 2))).toEqual([[0x2588, 0xff0000, DEFAULT], [0x2588, 0x0000ff, DEFAULT], [0x2588, 0xff0000, DEFAULT], [0x2588, 0x0000ff, DEFAULT]])
    expect(cells(terminalRaster(pose(2, 2, [0], [4, 1], 1), 1, 1))).toEqual([[0x2588, 0, DEFAULT]])
  })

  test('area sampling averages all contributing pixels instead of choosing one jagged pixel', () => {
    const checkerboard = pose(4, 4, [0, 0xffffff], [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1])
    expect(cells(terminalRaster(checkerboard, 1, 1))).toEqual([[0x2588, 0x808080, DEFAULT]])
  })

  test('transparent coverage uses the terminal background without darkening the remaining color', () => {
    const source = pose(4, 4, [0xff0000], [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(cells(terminalRaster(source, 1, 1))).toEqual([[0x259f, 0xff0000, DEFAULT]])
    const halfCovered = pose(4, 4, [0xff0000], [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1])
    expect(cells(terminalRaster(halfCovered, 1, 1))).toEqual([[0x2588, 0xff0000, DEFAULT]])
  })

  test('four shaded samples choose two colors and preserve the brighter lower half', () => {
    const gradient = pose(2, 2, [0, 0x555555, 0xaaaaaa, 0xffffff], [1, 2, 3, 4])
    expect(cells(terminalRaster(gradient, 1, 1))).toEqual([[0x2584, 0xd5d5d5, 0x2b2b2b]])
  })

  test('the same pose can be fitted to different panes and stays cached', () => {
    const palette = Array.from({ length: 255 }, (_, index) => index === 254 ? 0x112233 : 0)
    const source = pose(2, 2, palette, [4, 255], 1)
    const small = terminalRaster(source, 1, 1)
    const large = terminalRaster(source, 2, 2)
    expect(cells(small)).toEqual([[0x2588, 0x112233, DEFAULT]])
    expect(cells(large)).toHaveLength(4)
    expect(terminalRaster(source, 1, 1)).toBe(small)
    for (let index = 0; index < 10; index += 1) terminalRaster(pose(2, 2, [index], [4, 1], 1), 1, 1)
    expect(terminalRaster(source, 1, 1)).toBe(small)
  })
})

describe('Malformed Buddy poses are refused', () => {
  const malformed: Record<string, RasterPose> = {
    short: { key: 'bad:short', width: 2, height: 2, rgba: new Uint8Array(15) },
    long: { key: 'bad:long', width: 2, height: 2, rgba: new Uint8Array(17) },
    empty: { key: 'bad:empty', width: 0, height: 2, rgba: new Uint8Array(0) },
    fraction: { key: 'bad:fraction', width: 1.5, height: 2, rgba: new Uint8Array(12) },
  }
  for (const [name, source] of Object.entries(malformed)) {
    test(`rejects ${name}`, () => { expect(() => terminalRaster(source, 1, 1)).toThrow() })
  }
  test('rejects dimensions that cannot be a legal terminal grid', () => {
    const source = pose(2, 2, [0], [4, 1], 1)
    for (const [columns, rows] of [[0, 1], [1, 0], [-1, 1], [513, 1], [1, 257], [1.5, 1], [1, NaN]]) {
      expect(() => terminalRaster(source, columns!, rows!)).toThrow()
    }
  })
})
