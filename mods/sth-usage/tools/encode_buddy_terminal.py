#!/usr/bin/env python3
"""Encode Buddy's PNG poses as animated PNG raster sheets (assets/terminal/<state>.png).

Poses are cropped, scaled and palette-quantized through the BP1 codec, then stored
losslessly; hooks/frame-sheets.ts holds the matching cell and rate constants.
"""

import argparse
import base64
from pathlib import Path
import struct

from PIL import Image
from buddy_terminal_codec import decode_packet, encode_packet
from frame_sheets import raster_sheet


STATES = ("ok", "work", "done", "error", "update", "noConfig")
COLUMNS = 24
ROWS = 12
DEFAULT_COLOR = 0x01000000
MAIN_COLUMNS = 48
MAIN_ROWS = 24
MAIN_SOURCE_WIDTH = 96
MAIN_SOURCE_HEIGHT = 96
# Fixed for every pose/state: covers the union alpha>=96 bbox (26,53,360,315).
# Its square aspect preserves Buddy's shape and keeps motion free of crop jitter.
MAIN_CROP = (18, 8, 368, 358)
MAIN_FPS = 10
SOURCE_FPS = 20
MAIN_GAMMA = 0.75


def color(pixel, tone_curve=None):
    red, green, blue, alpha = pixel
    if tone_curve is not None:
        red, green, blue = (tone_curve[channel] for channel in (red, green, blue))
    return None if alpha < 96 else (red << 16) | (green << 8) | blue


def encode_frame(source, *, columns=COLUMNS, rows=ROWS, gamma=1.0):
    if not isinstance(columns, int) or not isinstance(rows, int) or columns <= 0 or rows <= 0:
        raise ValueError("Terminal dimensions must be positive integers")
    if not 0 < gamma <= 1:
        raise ValueError("Terminal gamma must be greater than zero and at most one")
    tone_curve = None if gamma == 1 else tuple(round(255 * (channel / 255) ** gamma) for channel in range(256))
    with Image.open(source) as pose:
        pixels = pose.convert("RGBA").resize((columns, rows * 2), Image.Resampling.LANCZOS)
    words = []
    for row in range(rows):
        for column in range(columns):
            top = color(pixels.getpixel((column, row * 2)), tone_curve)
            bottom = color(pixels.getpixel((column, row * 2 + 1)), tone_curve)
            if top is None and bottom is None:
                words.extend((ord(" "), DEFAULT_COLOR, DEFAULT_COLOR))
            elif top is None:
                words.extend((ord("▄"), bottom, DEFAULT_COLOR))
            else:
                words.extend((ord("▀"), top, DEFAULT_COLOR if bottom is None else bottom))
    return base64.b64encode(struct.pack(f"<{len(words)}I", *words)).decode("ascii")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for state in STATES:
        sources = sorted((args.frames / state).glob("*.png"))
        if not sources or [int(path.stem) for path in sources] != list(range(len(sources))):
            raise ValueError(f"Missing or non-contiguous frames: {state}")
        # Keep the clip duration and its first pose while halving the data budget.
        encoded = [encode_packet(source, width=MAIN_SOURCE_WIDTH, height=MAIN_SOURCE_HEIGHT, gamma=MAIN_GAMMA, crop=MAIN_CROP)
                   for source in sources[::SOURCE_FPS // MAIN_FPS]]
        (args.output / f"{state}.png").write_bytes(raster_sheet([decode_packet(packet)[2] for packet in encoded], 1000 // MAIN_FPS))
        print(f"{state}: {len(encoded)} frames, {MAIN_COLUMNS}x{MAIN_ROWS} cells, {MAIN_FPS} FPS")


if __name__ == "__main__":
    main()
