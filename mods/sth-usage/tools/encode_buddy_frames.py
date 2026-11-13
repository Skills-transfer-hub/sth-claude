#!/usr/bin/env python3
"""Encode Buddy's PNG poses into animated WebP sheets (assets/desktop/<state>.webp)."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

from frame_sheets import webp_sheet


STATES = tuple(os.environ.get("BUDDY_STATES", "ok,work,done,error,update,noConfig").split(","))
QUALITY = 95
MAX_IMAGE_BYTES = 70_000
FRAME_MS = 50


def png_dimensions(path):
    with path.open("rb") as source:
        header = source.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG header: {path}")
    return struct.unpack(">II", header[16:24])


def encode_frame(binary, source, work):
    if png_dimensions(source) != (384, 384):
        raise ValueError(f"Expected 384x384 PNG pose: {source}")
    candidate = work / f"{source.parent.name}-{source.stem}.webp"
    result = subprocess.run(
        [binary, "-quiet", "-q", str(QUALITY), "-alpha_q", "100", "-m", "6",
         "-exact", str(source), "-o", str(candidate)],
        capture_output=True, text=True,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise RuntimeError(f"cwebp failed for {source}: {detail}")
    content = candidate.read_bytes()
    if not 0 < len(content) <= MAX_IMAGE_BYTES:
        raise RuntimeError(f"{source}: WebP has {len(content)} bytes; limit is {MAX_IMAGE_BYTES}")
    return content


def encode_state(binary, directory, work):
    sources = sorted(directory.glob("*.png"))
    if not sources:
        raise ValueError(f"No PNG frames found in {directory}")
    numbers = [int(source.stem) for source in sources]
    if numbers != list(range(len(sources))):
        raise ValueError(f"Frames must start at 000 and be contiguous: {directory}")
    workers = min(os.cpu_count() or 1, 6)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        poses = list(pool.map(lambda source: encode_frame(binary, source, work), sources))
    sheet = webp_sheet(poses, FRAME_MS)
    return sheet, {
        "state": directory.name,
        "frames": len(poses),
        "width": 384,
        "height": 384,
        "quality": QUALITY,
        "image_bytes": sum(map(len, poses)),
        "max_image_bytes": max(map(len, poses)),
        "sheet_bytes": len(sheet),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path, help="Folder containing state/000.png poses")
    parser.add_argument("output", type=Path, help="Destination assets/desktop directory")
    args = parser.parse_args()
    source_root = args.frames.resolve()
    if not source_root.is_dir():
        parser.error(f"Not a directory: {source_root}")
    binary = shutil.which(os.environ.get("BUDDY_CWEBP") or "cwebp")
    if binary is None:
        parser.error("cwebp not found; set BUDDY_CWEBP to its executable path")
    sheets = {}
    reports = []
    with tempfile.TemporaryDirectory(prefix="buddy-client-frames-") as folder:
        work = Path(folder)
        for state in STATES:
            sheets[f"{state}.webp"], report = encode_state(binary, source_root / state, work)
            reports.append(report)
            print(json.dumps(report), flush=True)
        destination = args.output.resolve()
        destination.mkdir(parents=True, exist_ok=True)
        for name, content in sheets.items():
            staged = work / name
            staged.write_bytes(content)
            staged.replace(destination / name)
        print(json.dumps({"total_frames": sum(r["frames"] for r in reports), "sheets": len(sheets),
                          "total_sheet_bytes": sum(map(len, sheets.values())), "output": str(destination)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Buddy frame encoding failed: {error}", file=sys.stderr)
        sys.exit(1)
