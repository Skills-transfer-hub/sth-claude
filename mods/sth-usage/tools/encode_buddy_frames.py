#!/usr/bin/env python3
"""Encode Buddy's PNG poses into WebP data modules for the Claude client."""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile


STATES = ("ok", "work", "done", "error", "update", "noConfig")
QUALITY = 95
MAX_IMAGE_BYTES = 70_000
MAX_MODULE_BYTES = 1_048_576
MAX_TOTAL_BYTES = 8_388_608
BLOCK_FRAMES = 12


def png_dimensions(path):
    with path.open("rb") as source:
        header = source.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG header: {path}")
    return struct.unpack(">II", header[16:24])


def frame_module(frames):
    return ("export default " + json.dumps(frames, separators=(",", ":")) + ";\n").encode("utf-8")


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
    return len(content), base64.b64encode(content).decode("ascii")


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
    sizes = [size for size, _ in poses]
    encoded = [content for _, content in poses]
    state = directory.name
    whole = frame_module(encoded)
    modules = {}
    if len(whole) <= MAX_MODULE_BYTES:
        modules[f"{state}.ts"] = whole
    else:
        blocks = []
        for index, start in enumerate(range(0, len(encoded), BLOCK_FRAMES)):
            name = f"{state}/{index:03d}.ts"
            modules[name] = frame_module(encoded[start:start + BLOCK_FRAMES])
            blocks.append(name)
        imports = [f"import block{index} from './{name[:-3]}';" for index, name in enumerate(blocks)]
        expression = ",".join(f"...block{index}" for index in range(len(blocks)))
        modules[f"{state}.ts"] = ("\n".join(imports) + f"\nexport default [{expression}];\n").encode("utf-8")
    for name, content in modules.items():
        if len(content) > MAX_MODULE_BYTES:
            raise RuntimeError(f"Module {name} has {len(content)} bytes; limit is {MAX_MODULE_BYTES}")
    return modules, {
        "state": state,
        "frames": len(encoded),
        "width": 384,
        "height": 384,
        "quality": QUALITY,
        "image_bytes": sum(sizes),
        "max_image_bytes": max(sizes),
        "module_bytes": sum(len(content) for content in modules.values()),
        "max_module_bytes": max(len(content) for content in modules.values()),
        "modules": len(modules),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path, help="Folder containing state/000.png poses")
    parser.add_argument("output", type=Path, help="Destination ui/frames directory")
    args = parser.parse_args()
    source_root = args.frames.resolve()
    if not source_root.is_dir():
        parser.error(f"Not a directory: {source_root}")
    binary = shutil.which(os.environ.get("BUDDY_CWEBP") or "cwebp")
    if binary is None:
        parser.error("cwebp not found; set BUDDY_CWEBP to its executable path")
    modules = {}
    reports = []
    with tempfile.TemporaryDirectory(prefix="buddy-client-frames-") as folder:
        work = Path(folder)
        for state in STATES:
            state_modules, report = encode_state(binary, source_root / state, work)
            modules.update(state_modules)
            reports.append(report)
            print(json.dumps(report), flush=True)
        total = sum(len(content) for content in modules.values())
        if total > MAX_TOTAL_BYTES:
            raise RuntimeError(f"Frame modules have {total} bytes; total limit is {MAX_TOTAL_BYTES}")
        destination = args.output.resolve()
        destination.mkdir(parents=True, exist_ok=True)
        for name, content in modules.items():
            staged = work / name
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_bytes(content)
            output = destination / name
            output.parent.mkdir(parents=True, exist_ok=True)
            staged.replace(output)
        print(json.dumps({"total_frames": sum(r["frames"] for r in reports),
                          "total_modules": len(modules), "total_module_bytes": total,
                          "output": str(destination)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Buddy frame encoding failed: {error}", file=sys.stderr)
        sys.exit(1)
