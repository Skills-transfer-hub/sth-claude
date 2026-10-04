#!/usr/bin/env python3
"""Encode Buddy's HD poses as portable terminal half-block cells."""

import argparse
import base64
import json
from pathlib import Path
import struct

from PIL import Image


STATES = ("ok", "work", "done", "error", "update", "noConfig")
COLUMNS = 24
ROWS = 12
DEFAULT_COLOR = 0x01000000


def color(pixel):
    red, green, blue, alpha = pixel
    return None if alpha < 96 else (red << 16) | (green << 8) | blue


def encode_frame(source):
    with Image.open(source) as pose:
        pixels = pose.convert("RGBA").resize((COLUMNS, ROWS * 2), Image.Resampling.LANCZOS)
    words = []
    for row in range(ROWS):
        for column in range(COLUMNS):
            top = color(pixels.getpixel((column, row * 2)))
            bottom = color(pixels.getpixel((column, row * 2 + 1)))
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
        encoded = [encode_frame(source) for source in sources]
        module = "export default " + json.dumps(encoded, separators=(",", ":")) + ";\n"
        if len(module.encode("utf-8")) > 1_048_576:
            raise ValueError(f"Terminal frame module too large: {state}")
        (args.output / f"{state}.ts").write_text(module)
        print(f"{state}: {len(encoded)} frames, {COLUMNS}x{ROWS} cells")


if __name__ == "__main__":
    main()
