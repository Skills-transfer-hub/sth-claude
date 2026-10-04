#!/usr/bin/env python3
"""BP1 palette/RLE packets for Buddy's unmodified PNG source poses.

Header: ASCII BP, version 1, pixel width, half pixel height, palette count,
encoding (0 raw indices, 1 count/index pairs). The palette has RGB8 triplets
for indices 1..N; zero always means transparent. Pixels are in row-major order.
"""

import base64
import math
import struct

from PIL import Image


PIXEL_LIMIT = 65_536
ALPHA_THRESHOLD = 96
MAGIC = b"BP\x01"
DEFAULT_COLOR = 0x01000000
QUADRANTS = (0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
             0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588)


def palette_pixels(image, width, height, gamma, crop=None):
    if not isinstance(width, int) or not isinstance(height, int) or not 0 < width <= 255 or not 0 < height <= 510 or height % 2 or width * height > PIXEL_LIMIT:
        raise ValueError("BP1 requires positive byte-sized dimensions, an even height, and at most 65536 pixels")
    if not 0 < gamma <= 1:
        raise ValueError("BP1 gamma must be greater than zero and at most one")
    if crop is not None:
        image = image.crop(crop)
    resized = image.convert("RGBA").resize((width, height), Image.Resampling.LANCZOS)
    curve = tuple(round(255 * (channel / 255) ** gamma) for channel in range(256))
    colors = [None if alpha < ALPHA_THRESHOLD else tuple(curve[channel] for channel in (red, green, blue))
              for red, green, blue, alpha in resized.get_flattened_data()]
    opaque = [color for color in colors if color is not None]
    if not opaque:
        raise ValueError("BP1 source has no visible opaque pixels")
    unique = sorted(set(opaque))
    if len(unique) <= 255:
        palette = unique
        lookup = {color: index + 1 for index, color in enumerate(palette)}
        indices = bytes(0 if color is None else lookup[color] for color in colors)
    else:
        strip = Image.new("RGB", (len(opaque), 1))
        strip.putdata(opaque)
        quantized = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        values = list(quantized.get_flattened_data())
        used = sorted(set(values))
        raw_palette = quantized.getpalette()
        palette = [tuple(raw_palette[index * 3:index * 3 + 3]) for index in used]
        lookup = {old: new + 1 for new, old in enumerate(used)}
        cursor = iter(values)
        indices = bytes(0 if color is None else lookup[next(cursor)] for color in colors)
    return palette, indices


def encode_packet(source, *, width, height, gamma=1.0, crop=None):
    with Image.open(source) as image:
        image.load()
        if image.mode != "RGBA":
            raise ValueError(f"Expected RGBA source pose: {source}")
        palette, indices = palette_pixels(image, width, height, gamma, crop)
    runs = bytearray()
    current, length = indices[0], 0
    for index in indices:
        if index != current or length == 255:
            runs.extend((length, current))
            current, length = index, 0
        length += 1
    runs.extend((length, current))
    mode = 1 if len(runs) < len(indices) else 0
    packet = bytearray(MAGIC)
    packet.extend((width, height // 2, len(palette), mode))
    packet.extend(channel for color in palette for channel in color)
    packet.extend(runs if mode else indices)
    return base64.b64encode(packet).decode("ascii")


def decode_packet(encoded):
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise ValueError("Invalid BP1 base64") from error
    if len(data) < 7 or data[:3] != MAGIC:
        raise ValueError("Invalid BP1 header")
    width, half_height, count, mode = data[3:7]
    height = half_height * 2
    if not width or not height or not count or width * height > PIXEL_LIMIT or mode not in (0, 1) or len(data) < 7 + count * 3:
        raise ValueError("Invalid BP1 dimensions, palette or encoding")
    palette = [None] + [tuple(data[7 + index * 3:10 + index * 3]) for index in range(count)]
    payload = data[7 + count * 3:]
    if mode:
        if len(payload) % 2:
            raise ValueError("Truncated BP1 run")
        indices = bytearray()
        for offset in range(0, len(payload), 2):
            length, index = payload[offset:offset + 2]
            if not length or index > count or len(indices) + length > width * height:
                raise ValueError("Invalid BP1 run length or index")
            indices.extend([index] * length)
    else:
        indices = payload
    if len(indices) != width * height or any(index > count for index in indices):
        raise ValueError("Invalid BP1 pixel count or palette index")
    return width, height, [palette[index] for index in indices]


def js_round(value):
    return math.floor(value + 0.5)


def _sample(pixels, width, height, target_width, target_height):
    result = []
    for y in range(target_height):
        top, bottom = y * height / target_height, (y + 1) * height / target_height
        for x in range(target_width):
            left, right = x * width / target_width, (x + 1) * width / target_width
            coverage = red = green = blue = 0
            for sy in range(math.floor(top), math.ceil(bottom)):
                y_weight = min(bottom, sy + 1) - max(top, sy)
                for sx in range(math.floor(left), math.ceil(right)):
                    color = pixels[sy * width + sx]
                    if color is None:
                        continue
                    weight = y_weight * (min(right, sx + 1) - max(left, sx))
                    coverage += weight
                    red += color[0] * weight
                    green += color[1] * weight
                    blue += color[2] * weight
            result.append(None if coverage < (right - left) * (bottom - top) / 2 or not coverage
                          else (js_round(red / coverage), js_round(green / coverage), js_round(blue / coverage)))
    return result


def _color_word(color):
    return DEFAULT_COLOR if color is None else (color[0] << 16) | (color[1] << 8) | color[2]


def _cell(colors):
    opaque = [color for color in colors if color is not None]
    mask = sum(1 << index for index, color in enumerate(colors) if color is not None)
    if not opaque:
        return QUADRANTS[0], DEFAULT_COLOR, DEFAULT_COLOR
    red, green, blue = (sum(color[channel] for color in opaque) for channel in range(3))
    if len(opaque) < 4:
        color = (js_round(red / len(opaque)), js_round(green / len(opaque)), js_round(blue / len(opaque)))
        return QUADRANTS[mask], _color_word(color), DEFAULT_COLOR
    if all(color == colors[0] for color in colors):
        return QUADRANTS[15], _color_word(colors[0]), DEFAULT_COLOR
    minimum, maximum = float("inf"), -float("inf")
    foreground = background = colors[0]
    for color in colors:
        luminance = color[0] * .2126 + color[1] * .7152 + color[2] * .0722
        if luminance < minimum:
            minimum, background = luminance, color
        if luminance > maximum:
            maximum, foreground = luminance, color
    if foreground == background:
        foreground = next(color for color in colors if color != background)
    for _ in range(4):
        first = []
        mask = 0
        for index, color in enumerate(colors):
            f_delta = tuple(color[channel] - foreground[channel] for channel in range(3))
            b_delta = tuple(color[channel] - background[channel] for channel in range(3))
            if sum(value * value for value in f_delta) <= sum(value * value for value in b_delta):
                mask |= 1 << index
                first.append(color)
        if first:
            foreground = tuple(js_round(sum(color[channel] for color in first) / len(first)) for channel in range(3))
        if len(first) < 4:
            foreground_sums = tuple(sum(color[channel] for color in first) for channel in range(3))
            background = tuple(js_round((total - part) / (4 - len(first))) for total, part in zip((red, green, blue), foreground_sums))
    return QUADRANTS[mask], _color_word(foreground), _color_word(background)


def terminal_cells(packet, columns, rows):
    """Mirror hooks/terminal-raster.ts, including JS rounding and four iterations."""
    if not isinstance(columns, int) or not isinstance(rows, int) or not 1 <= columns <= 512 or not 1 <= rows <= 256:
        raise ValueError("Invalid Buddy raster dimensions")
    width, height, source = decode_packet(packet)
    pixels = _sample(source, width, height, columns * 2, rows * 2)
    words = []
    for row in range(rows):
        for column in range(columns):
            start = row * 2 * columns * 2 + column * 2
            words.extend(_cell([pixels[start], pixels[start + 1], pixels[start + columns * 2], pixels[start + columns * 2 + 1]]))
    return base64.b64encode(struct.pack(f"<{len(words)}I", *words)).decode("ascii")


def raster_image(cells, columns, rows, background=(38, 38, 38)):
    """Reconstruct encoded quadrant masks/colors at the physical 1:2 cell aspect."""
    raw = base64.b64decode(cells, validate=True)
    if len(raw) != columns * rows * 12:
        raise ValueError("Invalid raster cell byte count")
    words = struct.unpack(f"<{columns * rows * 3}I", raw)
    masks = {glyph: index for index, glyph in enumerate(QUADRANTS)}
    image = Image.new("RGB", (columns * 2, rows * 2), background)
    pixels = image.load()
    for row in range(rows):
        for column in range(columns):
            glyph, foreground, backdrop = words[(row * columns + column) * 3:(row * columns + column) * 3 + 3]
            if glyph not in masks:
                raise ValueError(f"Unsupported quadrant glyph {glyph}")
            for index in range(4):
                word = foreground if masks[glyph] & 1 << index else backdrop
                pixels[column * 2 + index % 2, row * 2 + index // 2] = (background if word == DEFAULT_COLOR
                    else ((word >> 16) & 255, (word >> 8) & 255, word & 255))
    return image.resize((columns * 8, rows * 16), Image.Resampling.NEAREST)
