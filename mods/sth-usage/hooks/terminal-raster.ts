import type { RasterPose } from './frame-sheets'

const DEFAULT_COLOR = 0x01000000
const QUADRANTS = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588] as const
const cache = new Map<string, string>()

/** A pose's colors: alpha 0 is transparent, any other alpha keeps the pixel's RGB. */
function colors({ width, height, rgba }: RasterPose): Uint32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error('Invalid Buddy pose dimensions')
  }
  const pixels = new Uint32Array(width * height)
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4
    pixels[index] = rgba[offset + 3] ? (rgba[offset]! << 16) | (rgba[offset + 1]! << 8) | rgba[offset + 2]! : DEFAULT_COLOR
  }
  return pixels
}

function sample(pixels: Uint32Array, width: number, height: number, targetWidth: number, targetHeight: number) {
  const result = new Uint32Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const top = y * height / targetHeight
    const bottom = (y + 1) * height / targetHeight
    for (let x = 0; x < targetWidth; x += 1) {
      const left = x * width / targetWidth
      const right = (x + 1) * width / targetWidth
      let coverage = 0, red = 0, green = 0, blue = 0
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy += 1) {
        const yWeight = Math.min(bottom, sy + 1) - Math.max(top, sy)
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx += 1) {
          const color = pixels[sy * width + sx]!
          if (color === DEFAULT_COLOR) continue
          const weight = yWeight * (Math.min(right, sx + 1) - Math.max(left, sx))
          coverage += weight
          red += (color >> 16 & 255) * weight
          green += (color >> 8 & 255) * weight
          blue += (color & 255) * weight
        }
      }
      result[y * targetWidth + x] = coverage < (right - left) * (bottom - top) / 2 || !coverage
        ? DEFAULT_COLOR : (Math.round(red / coverage) << 16) | (Math.round(green / coverage) << 8) | Math.round(blue / coverage)
    }
  }
  return result
}

function cell(colors: number[]): readonly [number, number, number] {
  let mask = 0, red = 0, green = 0, blue = 0, opaque = 0
  for (let index = 0; index < 4; index += 1) {
    const color = colors[index]!
    if (color === DEFAULT_COLOR) continue
    mask |= 1 << index
    opaque += 1
    red += color >> 16 & 255
    green += color >> 8 & 255
    blue += color & 255
  }
  if (!opaque) return [0x20, DEFAULT_COLOR, DEFAULT_COLOR]
  if (opaque < 4) return [QUADRANTS[mask]!, (Math.round(red / opaque) << 16) | (Math.round(green / opaque) << 8) | Math.round(blue / opaque), DEFAULT_COLOR]
  if (colors.every(color => color === colors[0])) return [0x2588, colors[0]!, DEFAULT_COLOR]
  let minimum = Infinity, maximum = -Infinity, foreground = colors[0]!, background = colors[0]!
  for (const color of colors) {
    const luminance = (color >> 16 & 255) * 0.2126 + (color >> 8 & 255) * 0.7152 + (color & 255) * 0.0722
    if (luminance < minimum) { minimum = luminance; background = color }
    if (luminance > maximum) { maximum = luminance; foreground = color }
  }
  if (foreground === background) foreground = colors.find(color => color !== background)!
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let r = 0, g = 0, b = 0, count = 0
    mask = 0
    for (let index = 0; index < 4; index += 1) {
      const color = colors[index]!
      const fr = (color >> 16 & 255) - (foreground >> 16 & 255)
      const fg = (color >> 8 & 255) - (foreground >> 8 & 255)
      const fb = (color & 255) - (foreground & 255)
      const br = (color >> 16 & 255) - (background >> 16 & 255)
      const bg = (color >> 8 & 255) - (background >> 8 & 255)
      const bb = (color & 255) - (background & 255)
      if (fr * fr + fg * fg + fb * fb <= br * br + bg * bg + bb * bb) {
        mask |= 1 << index; r += color >> 16 & 255; g += color >> 8 & 255; b += color & 255; count += 1
      }
    }
    if (count) foreground = Math.round(r / count) << 16 | Math.round(g / count) << 8 | Math.round(b / count)
    if (count < 4) background = Math.round((red - r) / (4 - count)) << 16 | Math.round((green - g) / (4 - count)) << 8 | Math.round((blue - b) / (4 - count))
  }
  return [QUADRANTS[mask]!, foreground, background]
}

/** Decode source pixels before fitting them, keeping details in narrow panes. */
export function terminalRaster(pose: RasterPose, columns: number, rows: number): string {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || columns > 512 || rows < 1 || rows > 256) {
    throw new Error('Invalid Buddy raster dimensions')
  }
  const key = `${columns}x${rows}:${pose.key}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key); cache.set(key, hit)
    return hit
  }
  const pixels = sample(colors(pose), pose.width, pose.height, columns * 2, rows * 2)
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const start = row * 2 * columns * 2 + column * 2
      const values = cell([pixels[start]!, pixels[start + 1]!, pixels[start + columns * 2]!, pixels[start + columns * 2 + 1]!])
      const offset = (row * columns + column) * 12
      for (let word = 0; word < 3; word += 1) view.setUint32(offset + word * 4, values[word]!, true)
    }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const result = btoa(binary)
  cache.set(key, result)
  if (cache.size > 8) cache.delete(cache.keys().next().value!)
  return result
}
