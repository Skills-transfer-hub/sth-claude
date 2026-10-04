import { describe, expect, test } from 'claude-code/testing'
import { terminalRaster } from '../hooks/terminal-raster'

const DEFAULT = 0x01000000
function base64(bytes: number[]): string { return btoa(String.fromCharCode(...bytes)) }
function packet(width: number, height: number, palette: number[], payload: number[], mode = 0): string {
  return base64([66, 80, 1, width, height / 2, palette.length, mode,
    ...palette.flatMap(color => [color >> 16 & 255, color >> 8 & 255, color & 255]), ...payload])
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

describe('Buddy source packets and quadrant geometry', () => {
  test('all sixteen quadrant masks retain the exact transparent silhouette', () => {
    const glyphs = [...' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█']
    for (let mask = 0; mask < 16; mask += 1) {
      const source = packet(2, 2, [0x123456], [0, 1, 2, 3].map(bit => mask & 1 << bit ? 1 : 0))
      expect(cells(terminalRaster(source, 1, 1))).toEqual([[glyphs[mask]!.codePointAt(0), mask ? 0x123456 : DEFAULT, DEFAULT]])
    }
  })

  test('raw and RLE packets produce the same row-major pixels and opaque black stays visible', () => {
    const raw = packet(4, 4, [0xff0000, 0x0000ff], [1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2])
    const rle = packet(4, 4, [0xff0000, 0x0000ff], [2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2], 1)
    expect(terminalRaster(raw, 2, 2)).toBe(terminalRaster(rle, 2, 2))
    expect(cells(terminalRaster(rle, 2, 2))).toEqual([[0x2588, 0xff0000, DEFAULT], [0x2588, 0x0000ff, DEFAULT], [0x2588, 0xff0000, DEFAULT], [0x2588, 0x0000ff, DEFAULT]])
    expect(cells(terminalRaster(packet(2, 2, [0], [4, 1], 1), 1, 1))).toEqual([[0x2588, 0, DEFAULT]])
  })

  test('area sampling averages all contributing pixels instead of choosing one jagged pixel', () => {
    const checkerboard = packet(4, 4, [0, 0xffffff], [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1])
    expect(cells(terminalRaster(checkerboard, 1, 1))).toEqual([[0x2588, 0x808080, DEFAULT]])
  })

  test('transparent coverage uses the terminal background without darkening the remaining color', () => {
    const source = packet(4, 4, [0xff0000], [0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(cells(terminalRaster(source, 1, 1))).toEqual([[0x259f, 0xff0000, DEFAULT]])
    const halfCovered = packet(4, 4, [0xff0000], [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1])
    expect(cells(terminalRaster(halfCovered, 1, 1))).toEqual([[0x2588, 0xff0000, DEFAULT]])
  })

  test('four shaded samples choose two colors and preserve the brighter lower half', () => {
    const gradient = packet(2, 2, [0, 0x555555, 0xaaaaaa, 0xffffff], [1, 2, 3, 4])
    expect(cells(terminalRaster(gradient, 1, 1))).toEqual([[0x2584, 0xd5d5d5, 0x2b2b2b]])
  })

  test('the maximum palette index is valid and the same packet can be fitted to different panes', () => {
    const palette = Array.from({ length: 255 }, (_, index) => index === 254 ? 0x112233 : 0)
    const source = packet(2, 2, palette, [4, 255], 1)
    const small = terminalRaster(source, 1, 1)
    const large = terminalRaster(source, 2, 2)
    expect(cells(small)).toEqual([[0x2588, 0x112233, DEFAULT]])
    expect(cells(large)).toHaveLength(4)
    expect(terminalRaster(source, 1, 1)).toBe(small)
    for (let index = 0; index < 10; index += 1) terminalRaster(packet(2, 2, [index], [4, 1], 1), 1, 1)
    expect(terminalRaster(source, 1, 1)).toBe(small)
  })
})

describe('Malformed Buddy packets are refused', () => {
  const malformed: Record<string, string> = {
    base64: '@@', short: base64([66, 80, 1]), magic: base64([66, 80, 49, 2, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]),
    width: base64([66, 80, 1, 0, 1, 1, 0, 0, 0, 0]), height: base64([66, 80, 1, 2, 0, 1, 0, 0, 0, 0]),
    palette: base64([66, 80, 1, 2, 1, 0, 0]), mode: base64([66, 80, 1, 2, 1, 1, 2, 0, 0, 0]),
    truncatedPalette: base64([66, 80, 1, 2, 1, 1, 0, 0, 0]),
    shortRaw: packet(2, 2, [0], [1, 1, 1]), longRaw: packet(2, 2, [0], [1, 1, 1, 1, 1]), rawIndex: packet(2, 2, [0], [1, 1, 1, 2]),
    oddRle: packet(2, 2, [0], [4], 1), zeroRun: packet(2, 2, [0], [0, 1], 1),
    shortRle: packet(2, 2, [0], [3, 1], 1), longRle: packet(2, 2, [0], [5, 1], 1),
    extraRle: packet(2, 2, [0], [4, 1, 1, 1], 1), rleIndex: packet(2, 2, [0], [4, 2], 1),
  }
  for (const [name, source] of Object.entries(malformed)) {
    test(`rejects ${name}`, () => { expect(() => terminalRaster(source, 1, 1)).toThrow() })
  }
  test('rejects dimensions that cannot be a legal terminal grid', () => {
    const source = packet(2, 2, [0], [4, 1], 1)
    for (const [columns, rows] of [[0, 1], [1, 0], [-1, 1], [513, 1], [1, 257], [1.5, 1], [1, NaN]]) {
      expect(() => terminalRaster(source, columns!, rows!)).toThrow()
    }
  })
})
