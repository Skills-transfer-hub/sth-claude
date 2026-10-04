#!/usr/bin/env python3
"""Check Buddy's HD poses, client data modules and runtime size budgets."""

import argparse
import base64
import json
from pathlib import Path
import re
import struct
import sys


SIZE = 384
CHUNK_FRAMES = 12
MAX_RENDER_CHARS = 100_000
MAX_MODULE_BYTES = 1_048_576
MAX_GRAPH_BYTES = 8_388_608
STATES = {
    "ok": (80, "4"),
    "work": (48, "2.4"),
    "done": (38, "1.9"),
    "error": (30, "1.5"),
    "update": (36, "1.8"),
    "noConfig": (72, "3.6"),
}
CAPTIONS = {
    "ok": "Buddy est prêt",
    "work": "Buddy travaille…",
    "done": "Buddy a fini le tour",
    "error": "Buddy freine : limite proche",
    "update": "Buddy surveille les limites",
    "noConfig": "Buddy attend le premier tour",
}


def check_png(path):
    with path.open("rb") as source:
        header = source.read(29)
    if len(header) != 29 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Invalid PNG header: {path.name}")
    width, height = struct.unpack(">II", header[16:24])
    if (width, height) != (SIZE, SIZE) or header[25] != 6:
        raise ValueError(f"{path.name}: expected {SIZE}x{SIZE} RGBA, got {width}x{height}, color type {header[25]}")


def webp_info(data):
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("Invalid WebP RIFF header")
    if struct.unpack("<I", data[4:8])[0] + 8 != len(data):
        raise ValueError("WebP RIFF size does not match the file")
    offset, dimensions, alpha = 12, None, False
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated WebP chunk header")
        kind = data[offset:offset + 4]
        length = struct.unpack("<I", data[offset + 4:offset + 8])[0]
        payload = data[offset + 8:offset + 8 + length]
        if len(payload) != length:
            raise ValueError("Truncated WebP chunk")
        if kind == b"VP8X" and length >= 10:
            dimensions = (1 + int.from_bytes(payload[4:7], "little"), 1 + int.from_bytes(payload[7:10], "little"))
            alpha = alpha or bool(payload[0] & 0x10)
        elif kind == b"VP8L" and length >= 5 and payload[0] == 0x2F:
            bits = int.from_bytes(payload[1:5], "little")
            dimensions = dimensions or (1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF))
            alpha = alpha or bool(bits & (1 << 28))
        elif kind == b"VP8 " and length >= 10 and payload[3:6] == b"\x9d\x01\x2a":
            width, height = struct.unpack("<HH", payload[6:10])
            dimensions = dimensions or (width & 0x3FFF, height & 0x3FFF)
        elif kind == b"ALPH":
            alpha = True
        offset += 8 + length + (length & 1)
    if dimensions is None:
        raise ValueError("WebP has no readable dimensions")
    return dimensions, alpha


def frame_svg(encoded):
    # Exact markup returned by ui/buddy.ts for one pose.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="144" height="144">'
        f'<image href="data:image/webp;base64,{encoded}" width="{SIZE}" height="{SIZE}"/></svg>'
    )


def load_frame_module(path, ui_root, chunk=False):
    """Read the codec's JSON exports or its simple index, without executing JS."""
    path = path.resolve()
    if not path.is_relative_to(ui_root):
        raise ValueError(f"Frame import leaves the UI folder: {path}")
    source = path.read_text(encoding="utf-8").strip()
    direct = re.fullmatch(r"export default\s+(\[.*\]);", source, re.DOTALL)
    if direct:
        frames = json.loads(direct[1])
        if not isinstance(frames, list) or not all(isinstance(frame, str) for frame in frames):
            raise ValueError(f"{path.name}: expected an array of base64 strings")
        return frames, {path}
    if chunk:
        raise ValueError(f"{path.name}: expected a JSON frame chunk")
    lines = source.splitlines()
    if len(lines) < 2:
        raise ValueError(f"{path.name}: unrecognized frame module")
    imports = []
    for index, line in enumerate(lines[:-1]):
        match = re.fullmatch(r"import (block\d+) from '([^']+)';", line)
        if not match or match[1] != f"block{index}":
            raise ValueError(f"{path.name}: invalid frame chunk import")
        expected = f"./{path.stem}/{index:03d}"
        if match[2] not in (expected, expected + ".ts"):
            raise ValueError(f"{path.name}: expected contiguous chunk {expected}")
        imported = path.parent / match[2]
        imports.append(imported if imported.suffix else imported.with_suffix(".ts"))
    expression = ",".join(f"...block{index}" for index in range(len(imports)))
    if lines[-1] != f"export default [{expression}];":
        raise ValueError(f"{path.name}: invalid frame chunk order")
    frames, modules = [], {path}
    for index, imported in enumerate(imports):
        poses, loaded = load_frame_module(imported, ui_root, chunk=True)
        if not 1 <= len(poses) <= CHUNK_FRAMES or (index < len(imports) - 1 and len(poses) != CHUNK_FRAMES):
            raise ValueError(f"{imported.name}: expected chunks of {CHUNK_FRAMES} poses, with a partial final chunk")
        frames.extend(poses)
        modules.update(loaded)
    return frames, modules


def check_ui_budget(ui_root):
    # All UI source files is a conservative bound for the Client's import graph.
    extensions = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}
    files = [path for path in ui_root.rglob("*") if path.is_file() and path.suffix in extensions]
    if not files:
        raise ValueError(f"No UI source files found in {ui_root}")
    sizes = []
    for path in files:
        size = path.stat().st_size
        if size > MAX_MODULE_BYTES:
            raise ValueError(f"{path.relative_to(ui_root)}: source exceeds {MAX_MODULE_BYTES} bytes: {size}")
        sizes.append(size)
    total = sum(sizes)
    if total > MAX_GRAPH_BYTES:
        raise ValueError(f"UI source graph exceeds {MAX_GRAPH_BYTES} bytes: {total}")
    return {"ui_files": len(files), "ui_source_bytes_total": total, "ui_source_bytes_max": max(sizes)}


def check_state(root, ui_root, state):
    frames, seconds = STATES[state]
    duration = float(seconds)
    if abs(frames / duration - 20) > 1e-9:
        raise ValueError(f"Expected 20 FPS, got {frames / duration}")
    folder = root / "frames" / state
    expected = {f"{index:03d}.png" for index in range(frames)}
    actual = {path.name for path in folder.glob("*.png")}
    if actual != expected:
        raise ValueError(f"Expected {frames} numbered PNG frames; found {len(actual)} (missing {sorted(expected - actual)[:4]}, extra {sorted(actual - expected)[:4]})")
    for name in sorted(expected):
        check_png(folder / name)
    poses, modules = load_frame_module(ui_root / "frames" / f"{state}.ts", ui_root)
    if len(poses) != frames:
        raise ValueError(f"Expected {frames} WebP poses in the TS data, found {len(poses)}")
    sizes, svg_sizes, render_sizes = [], [], []
    for index, encoded in enumerate(poses):
        data = base64.b64decode(encoded, validate=True)
        dimensions, alpha = webp_info(data)
        if dimensions != (SIZE, SIZE):
            raise ValueError(f"Pose {index:03d}: expected WebP {SIZE}x{SIZE}, got {dimensions[0]}x{dimensions[1]}")
        if not alpha:
            raise ValueError(f"Pose {index:03d}: WebP has no alpha channel")
        svg = frame_svg(encoded)
        svg_chars = len(svg)
        element = {"type": "Svg", "props": {"source": svg, "alt": CAPTIONS[state],
                                           "width": 144, "height": 144, "isInteractive": False}}
        render_chars = len(json.dumps(element, separators=(",", ":"), ensure_ascii=False))
        if svg_chars >= MAX_RENDER_CHARS or render_chars >= MAX_RENDER_CHARS:
            raise ValueError(f"Pose {index:03d}: SVG/client JSON must be below {MAX_RENDER_CHARS} characters, got {svg_chars}/{render_chars}")
        sizes.append(len(data))
        svg_sizes.append(svg_chars)
        render_sizes.append(render_chars)
    return {
        "state": state, "frames": frames, "frame_size": [SIZE, SIZE],
        "fps": 20, "seconds": duration, "modules": len(modules), "alpha": True,
        "webp_bytes_total": sum(sizes), "webp_bytes_max": max(sizes),
        "svg_chars_max": max(svg_sizes), "client_json_chars_max": max(render_sizes),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path, help="Asset folder containing frames/state/000.png")
    parser.add_argument("--ui", type=Path, help="UI folder (default: assets.parent/ui)")
    args = parser.parse_args()
    root = args.assets.resolve()
    if not root.is_dir():
        parser.error(f"Not a directory: {root}")
    ui_root = (args.ui or root.parent / "ui").resolve()
    if not ui_root.is_dir():
        parser.error(f"Not a UI directory: {ui_root}")
    failed = False
    try:
        print(json.dumps(check_ui_budget(ui_root)), flush=True)
    except (OSError, ValueError) as error:
        failed = True
        print(json.dumps({"ui_error": str(error)}), flush=True)
    for state in STATES:
        try:
            report = check_state(root, ui_root, state)
        except (OSError, ValueError) as error:
            failed = True
            report = {"state": state, "error": str(error)}
        print(json.dumps(report), flush=True)
    if failed:
        print("Buddy asset validation failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
