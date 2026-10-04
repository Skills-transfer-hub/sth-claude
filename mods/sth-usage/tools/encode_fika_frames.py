#!/usr/bin/env python3
"""Integrate the approved nine-second Fika V1 poses without re-rendering.

Requires Pillow and cwebp. From the mod root:
    python3 tools/encode_fika_frames.py previews/fika-3d/transparent --ui ui
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageFilter, ImageStat

from check_buddy_assets import MAX_GRAPH_BYTES, MAX_MODULE_BYTES, check_ui_budget, frame_svg, webp_info
from encode_buddy_terminal import MAIN_COLUMNS, MAIN_ROWS, MAIN_SOURCE_WIDTH, MAIN_SOURCE_HEIGHT, MAIN_GAMMA
from buddy_terminal_codec import encode_packet, decode_packet


FPS = 30
DURATION_MS = 9_000
FRAME_COUNT = 270
TERMINAL_COLUMNS = MAIN_COLUMNS
TERMINAL_ROWS = MAIN_ROWS
TERMINAL_SOURCE_WIDTH = MAIN_SOURCE_WIDTH
TERMINAL_SOURCE_HEIGHT = MAIN_SOURCE_HEIGHT
TERMINAL_FPS = 15
TERMINAL_GAMMA = MAIN_GAMMA
TERMINAL_STRIDE = FPS // TERMINAL_FPS
SIZE = 384
SOURCE_SIZE = 720
CHUNK_FRAMES = 12
QUALITIES = (75,)
ALPHA_QUALITY = 50
MAX_ALPHA_GEOMETRY_MAE = 5
MAX_IMAGE_BYTES = 70_000
MAX_RENDER_CHARS = 100_000
GRAPH_HEADROOM = 65_536
SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"}


def generated_module(path, ui):
    return (path.parent in (ui / "frames" / "fika", ui / "terminal-frames" / "fika")
            and (path.name == "index.ts" or re.fullmatch(r"\d{3}\.ts", path.name)))


def existing_source_bytes(ui):
    total = 0
    for path in ui.rglob("*"):
        if not path.is_file() or path.suffix not in SOURCE_EXTENSIONS or generated_module(path, ui):
            continue
        size = path.stat().st_size
        if size > MAX_MODULE_BYTES:
            raise ValueError(f"Existing UI module exceeds 1 MiB: {path}")
        total += size
    return total


def modules_for(frames, terminal=False):
    modules = {}
    imports = []
    for index, start in enumerate(range(0, len(frames), CHUNK_FRAMES)):
        name = f"{index:03d}.ts"
        module = "export default " + json.dumps(frames[start:start + CHUNK_FRAMES], separators=(",", ":")) + ";\n"
        modules[name] = module.encode("utf-8")
        imports.append(f"import block{index} from './{index:03d}';")
    index_source = "\n".join(imports) + "\n"
    index_source += f"export const FPS = {TERMINAL_FPS if terminal else FPS};\nexport const DURATION_MS = {DURATION_MS};\n"
    index_source += f"export const FRAME_COUNT = {len(frames)};\n"
    if terminal:
        index_source += f"export const COLUMNS = {TERMINAL_COLUMNS};\nexport const ROWS = {TERMINAL_ROWS};\n"
        index_source += f"export const SOURCE_WIDTH = {TERMINAL_SOURCE_WIDTH};\nexport const SOURCE_HEIGHT = {TERMINAL_SOURCE_HEIGHT};\n"
    expression = ",".join(f"...block{index}" for index in range(len(imports)))
    index_source += f"export const FRAMES: string[] = [{expression}];\nexport default FRAMES;\n"
    modules["index.ts"] = index_source.encode("utf-8")
    if max(map(len, modules.values())) > MAX_MODULE_BYTES:
        raise ValueError("Generated Fika module exceeds 1 MiB")
    return modules


def validate_pose(pose, source):
    if pose.size != (SOURCE_SIZE, SOURCE_SIZE) or pose.mode != "RGBA":
        raise ValueError(f"Expected {SOURCE_SIZE}x{SOURCE_SIZE} RGBA V1 pose: {source}")
    minimum, maximum = pose.getchannel("A").getextrema()
    if minimum != 0 or maximum == 0:
        raise ValueError(f"Expected visible pixels and fully transparent background: {source}")


def prepare_pose(item, work):
    index, source = item
    output = work / f"{index:03d}.png"
    with Image.open(source) as pose:
        validate_pose(pose, source)
        # Filter associated RGB and alpha together so invisible colors cannot form fringes.
        resized = pose.convert("RGBa").resize((SIZE, SIZE), Image.Resampling.LANCZOS).convert("RGBA")
        resized.save(output)
    encoded_terminal = (encode_packet(source, width=TERMINAL_SOURCE_WIDTH, height=TERMINAL_SOURCE_HEIGHT, gamma=TERMINAL_GAMMA)
                        if index % TERMINAL_STRIDE == 0 else None)
    if encoded_terminal is not None and decode_packet(encoded_terminal)[:2] != (TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT):
        raise ValueError(f"Invalid terminal BP1 dimensions: {source}")
    return output, encoded_terminal, hashlib.sha256(source.read_bytes()).digest()


def webp_pose(binary, source, quality):
    output = source.with_suffix(".webp")
    result = subprocess.run(
        [binary, "-quiet", "-q", str(quality), "-alpha_q", str(ALPHA_QUALITY), "-m", "6",
         "-exact", str(source), "-o", str(output)],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError(f"cwebp failed for {source.name}: {result.stderr.strip()}")
    content = output.read_bytes()
    dimensions, alpha = webp_info(content)
    if dimensions != (SIZE, SIZE) or not alpha or not 0 < len(content) <= MAX_IMAGE_BYTES:
        raise ValueError(f"Invalid Fika WebP dimensions/alpha/size: {source.name}")
    with Image.open(source) as png, Image.open(output) as webp:
        expected_alpha = png.getchannel("A")
        actual_alpha = webp.convert("RGBA").getchannel("A")
        minimum, maximum = actual_alpha.getextrema()
        if minimum != 0 or maximum == 0:
            raise ValueError(f"WebP did not preserve a transparent background: {source.name}")
        difference = ImageChops.difference(expected_alpha, actual_alpha)
        geometry = expected_alpha.point(lambda value: 255 if value >= 128 else 0)
        opaque = expected_alpha.point(lambda value: 255 if value >= 240 else 0)
        edge = ImageChops.difference(opaque.filter(ImageFilter.MaxFilter(3)),
                                    opaque.filter(ImageFilter.MinFilter(3)))
        zero = expected_alpha.point(lambda value: 255 if value == 0 else 0)
        geometry_mae = ImageStat.Stat(difference, geometry).mean[0]
        edge_mae = ImageStat.Stat(difference, edge).mean[0]
        if ImageStat.Stat(actual_alpha, zero).extrema[0][1] != 0:
            raise ValueError(f"WebP changed fully transparent background pixels: {source.name}")
        if geometry_mae >= MAX_ALPHA_GEOMETRY_MAE or edge_mae >= MAX_ALPHA_GEOMETRY_MAE:
            raise ValueError(f"WebP alpha changed geometry or edges too much: {source.name}")
        decoded_geometry = actual_alpha.point(lambda value: 255 if value >= 128 else 0)
        expected_bbox, decoded_bbox = geometry.getbbox(), decoded_geometry.getbbox()
        if expected_bbox is None or decoded_bbox is None:
            raise ValueError(f"WebP has no readable Buddy silhouette: {source.name}")
        loss = {
            "mae": ImageStat.Stat(difference).mean[0],
            "geometry_mae": geometry_mae,
            "edge_mae": edge_mae,
            "bbox_shift_max": max(abs(old - new) for old, new in zip(expected_bbox, decoded_bbox)),
            "zero_preserved": True,
        }
    encoded = base64.b64encode(content).decode("ascii")
    svg = frame_svg(encoded)
    element = {"type": "Svg", "props": {"source": svg, "alt": "Buddy fait une pause fika",
                                         "width": 144, "height": 144, "isInteractive": False}}
    if len(svg) >= MAX_RENDER_CHARS or len(json.dumps(element)) >= MAX_RENDER_CHARS:
        raise ValueError(f"Fika pose exceeds the client render budget: {source.name}")
    return encoded, len(content), alpha, loss


def install_modules(ui, group, modules, work):
    destination = ui / group / "fika"
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in modules.items():
        staged = work / group / name
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_bytes(content)
        staged.replace(destination / name)
    for path in destination.glob("*.ts"):
        if generated_module(path, ui) and path.name not in modules:
            path.unlink()


def install_native_sources(sources, ui, work):
    """Include exact source PNGs so image-capable terminals work in fresh clones."""
    destination = ui.parent / "assets" / "fika"
    expected = {source.name for source in sources}
    unexpected = {path.name for path in destination.glob("*.png")} - expected
    if unexpected:
        raise ValueError(f"Unexpected native Fika PNG files; preserve and inspect them: {sorted(unexpected)}")
    destination.mkdir(parents=True, exist_ok=True)
    staging = work / "native-fika"
    staging.mkdir()
    for source in sources:
        content = source.read_bytes()
        target = destination / source.name
        if target.is_file() and target.read_bytes() == content:
            continue
        candidate = staging / source.name
        candidate.write_bytes(content)
        candidate.replace(target)


def terminal_only(sources, ui):
    """Refresh the terminal poses while preserving every desktop WebP byte."""
    manifest_path = ui / "frames" / "fika" / "manifest.json"
    report = json.loads(manifest_path.read_text())
    frames, digests = [], []
    for index, source in enumerate(sources):
        with Image.open(source) as pose:
            pose.load()
            validate_pose(pose, source)
        digests.append(hashlib.sha256(source.read_bytes()).digest())
        if index % TERMINAL_STRIDE == 0:
            frame = encode_packet(source, width=TERMINAL_SOURCE_WIDTH, height=TERMINAL_SOURCE_HEIGHT, gamma=TERMINAL_GAMMA)
            if decode_packet(frame)[:2] != (TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT):
                raise ValueError(f"Invalid terminal BP1 dimensions: {source}")
            frames.append(frame)
    digest = hashlib.sha256(b"".join(digests)).hexdigest()
    if digest != report.get("source_sha256"):
        raise ValueError("Terminal-only refresh requires the unchanged desktop source poses")
    modules = modules_for(frames, terminal=True)
    terminal_bytes = sum(map(len, modules.values()))
    desktop_bytes = sum(path.stat().st_size for path in (ui / "frames" / "fika").glob("*.ts") if generated_module(path, ui))
    graph_bytes = existing_source_bytes(ui) + desktop_bytes + terminal_bytes
    if graph_bytes + GRAPH_HEADROOM > MAX_GRAPH_BYTES:
        raise ValueError(f"Terminal poses exceed the 8 MiB UI graph budget: {graph_bytes}")
    with tempfile.TemporaryDirectory(prefix="fika-terminal-codec-") as folder:
        install_modules(ui, "terminal-frames", modules, Path(folder))
    report.update({"terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS], "terminal_fps": TERMINAL_FPS,
                   "terminal_frames": len(frames), "terminal_stride": TERMINAL_STRIDE, "terminal_gamma": TERMINAL_GAMMA,
                   "terminal_codec": "BP1", "terminal_source_size": [TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT],
                   "terminal_modules": len(modules), "terminal_module_bytes": terminal_bytes, **check_ui_budget(ui)})
    manifest_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"terminal_only": True, "source_sha256": digest, "terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS],
                      "terminal_fps": TERMINAL_FPS, "terminal_frames": len(frames), "duration_ms": DURATION_MS,
                      "terminal_module_bytes": terminal_bytes, "ui_source_bytes_total": graph_bytes}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preview", type=Path, help="Transparent V1 directory with manifest.json and frames/")
    parser.add_argument("--ui", type=Path, default=Path(__file__).resolve().parents[1] / "ui")
    parser.add_argument("--check-only", action="store_true", help="Validate source poses without encoding or modifying UI")
    parser.add_argument("--terminal-only", action="store_true", help="Refresh terminal cells without regenerating the desktop WebP poses")
    args = parser.parse_args()
    preview, ui = args.preview.resolve(), args.ui.resolve()
    manifest = json.loads((preview / "manifest.json").read_text())
    if (manifest.get("fps"), manifest.get("seconds"), manifest.get("frames")) != (FPS, 9, FRAME_COUNT):
        parser.error("Expected the approved Fika V1 clip: 30 FPS, 9 seconds, 270 poses")
    if manifest.get("transparent") is not True:
        parser.error("Transparent Fika sources require manifest.transparent = true")
    sources = sorted((preview / "frames").glob("*.png"))
    expected = [f"fika-{index:04d}.png" for index in range(1, FRAME_COUNT + 1)]
    if [path.name for path in sources] != expected:
        parser.error("Fika V1 requires exactly fika-0001.png through fika-0270.png")
    if args.check_only:
        for source in sources:
            with Image.open(source) as pose:
                validate_pose(pose, source)
        print(json.dumps({"source": str(preview), "fps": FPS, "duration_ms": DURATION_MS,
                          "frames": len(sources), "source_size": [SOURCE_SIZE, SOURCE_SIZE],
                          "transparent": True, "check_only": True}), flush=True)
        return
    if not ui.is_dir():
        parser.error(f"Not a UI folder: {ui}")
    if args.terminal_only:
        terminal_only(sources, ui)
        return
    binary = shutil.which(os.environ.get("BUDDY_CWEBP") or "cwebp")
    if binary is None:
        parser.error("cwebp not found; set BUDDY_CWEBP to its executable path")
    with tempfile.TemporaryDirectory(prefix="fika-codec-") as folder:
        work = Path(folder)
        workers = min(os.cpu_count() or 1, 6)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            poses = list(pool.map(lambda item: prepare_pose(item, work), enumerate(sources)))
        terminal_modules = modules_for([pose[1] for pose in poses if pose[1] is not None], terminal=True)
        terminal_bytes = sum(map(len, terminal_modules.values()))
        selected = None
        attempts = []
        for quality in QUALITIES:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                encoded = list(pool.map(lambda pose: webp_pose(binary, pose[0], quality), poses))
            desktop_modules = modules_for([pose[0] for pose in encoded])
            desktop_bytes = sum(map(len, desktop_modules.values()))
            graph_bytes = existing_source_bytes(ui) + desktop_bytes + terminal_bytes
            attempts.append({"quality": quality, "alpha_quality": ALPHA_QUALITY,
                             "desktop_bytes": desktop_bytes, "graph_bytes": graph_bytes})
            if graph_bytes + GRAPH_HEADROOM <= MAX_GRAPH_BYTES:
                selected = quality
                break
        if selected is None:
            raise ValueError(f"No quality preserves the 8 MiB UI graph budget: {attempts}")
        install_native_sources(sources, ui, work)
        install_modules(ui, "frames", desktop_modules, work)
        install_modules(ui, "terminal-frames", terminal_modules, work)
        budget = check_ui_budget(ui)
        report = {
            "source": str(preview.relative_to(ui.parent)) if preview.is_relative_to(ui.parent) else str(preview),
            "source_sha256": hashlib.sha256(b"".join(pose[2] for pose in poses)).hexdigest(),
            "fps": FPS, "duration_ms": DURATION_MS, "frames": FRAME_COUNT,
            "source_size": [SOURCE_SIZE, SOURCE_SIZE], "desktop_size": [SIZE, SIZE],
            "native_source_path": "assets/fika", "native_frames": len(sources),
            "terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS], "terminal_fps": TERMINAL_FPS,
            "terminal_frames": FRAME_COUNT // TERMINAL_STRIDE, "terminal_stride": TERMINAL_STRIDE, "terminal_gamma": TERMINAL_GAMMA,
            "terminal_codec": "BP1", "terminal_source_size": [TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT],
            "quality": selected, "alpha_quality": ALPHA_QUALITY,
            "desktop_modules": len(desktop_modules), "terminal_modules": len(terminal_modules),
            "desktop_module_bytes": desktop_bytes, "terminal_module_bytes": terminal_bytes,
            "max_webp_bytes": max(pose[1] for pose in encoded),
            "transparent": True, "transparent_png_frames": len(sources),
            "transparent_webp_frames": sum(bool(pose[2]) for pose in encoded),
            "alpha_mask_verified": True, "alpha_exact": False,
            "alpha_loss": {
                "mae_mean": sum(pose[3]["mae"] for pose in encoded) / len(encoded),
                "geometry_mae_max": max(pose[3]["geometry_mae"] for pose in encoded),
                "edge_mae_max": max(pose[3]["edge_mae"] for pose in encoded),
                "bbox_shift_max": max(pose[3]["bbox_shift_max"] for pose in encoded),
                "source_zero_preserved": True,
            },
            "resampling": "Lanczos with premultiplied alpha",
            "attempts": attempts, **budget,
        }
        (ui / "frames" / "fika" / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Fika encoding failed: {error}", file=sys.stderr)
        sys.exit(1)
