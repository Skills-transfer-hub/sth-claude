#!/usr/bin/env python3
"""Integrate the approved nine-second Fika V1 poses without re-rendering.

Requires Pillow and cwebp. From the mod root:
    python3 tools/encode_fika_frames.py previews/fika-3d/transparent

Writes assets/desktop/fika.webp, assets/terminal/fika.png and tools/fika-frames.json.
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageFilter, ImageStat

from check_buddy_assets import frame_svg, webp_info
from encode_buddy_terminal import MAIN_COLUMNS, MAIN_ROWS, MAIN_SOURCE_WIDTH, MAIN_SOURCE_HEIGHT, MAIN_GAMMA
from buddy_terminal_codec import encode_packet, decode_packet
from frame_sheets import raster_sheet, webp_sheet


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
QUALITY = 75
ALPHA_QUALITY = 50
MAX_ALPHA_GEOMETRY_MAE = 5
MAX_IMAGE_BYTES = 70_000
MAX_RENDER_CHARS = 100_000


def sheets_for(desktop, terminal):
    """The desktop WebP poses (base64) and terminal BP1 packets, as the two sheets."""
    return (webp_sheet([base64.b64decode(pose) for pose in desktop], round(1000 / FPS)) if desktop is not None else None,
            raster_sheet([decode_packet(packet)[2] for packet in terminal], round(1000 / TERMINAL_FPS)))


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


def install_sheet(path, content, work):
    staged = work / path.name
    staged.write_bytes(content)
    path.parent.mkdir(parents=True, exist_ok=True)
    staged.replace(path)


def install_native_sources(sources, root, work):
    """Include exact source PNGs so image-capable terminals work in fresh clones."""
    destination = root / "assets" / "fika"
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


def terminal_only(sources, root):
    """Refresh the terminal poses while preserving every desktop WebP byte."""
    manifest_path = root / "tools" / "fika-frames.json"
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
    _, terminal = sheets_for(None, frames)
    with tempfile.TemporaryDirectory(prefix="fika-terminal-codec-") as folder:
        install_sheet(root / "assets" / "terminal" / "fika.png", terminal, Path(folder))
    report.update({"terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS], "terminal_fps": TERMINAL_FPS,
                   "terminal_frames": len(frames), "terminal_stride": TERMINAL_STRIDE, "terminal_gamma": TERMINAL_GAMMA,
                   "terminal_codec": "APNG RGBA from BP1 palettes", "terminal_source_size": [TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT],
                   "terminal_sheet_bytes": len(terminal)})
    manifest_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"terminal_only": True, "source_sha256": digest, "terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS],
                      "terminal_fps": TERMINAL_FPS, "terminal_frames": len(frames), "duration_ms": DURATION_MS,
                      "terminal_sheet_bytes": len(terminal)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preview", type=Path, help="Transparent V1 directory with manifest.json and frames/")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Mod root that receives the sheets")
    parser.add_argument("--check-only", action="store_true", help="Validate source poses without encoding or modifying UI")
    parser.add_argument("--terminal-only", action="store_true", help="Refresh terminal cells without regenerating the desktop WebP poses")
    args = parser.parse_args()
    preview, root = args.preview.resolve(), args.root.resolve()
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
    if not (root / "tools").is_dir():
        parser.error(f"Not a mod root: {root}")
    if args.terminal_only:
        terminal_only(sources, root)
        return
    binary = shutil.which(os.environ.get("BUDDY_CWEBP") or "cwebp")
    if binary is None:
        parser.error("cwebp not found; set BUDDY_CWEBP to its executable path")
    with tempfile.TemporaryDirectory(prefix="fika-codec-") as folder:
        work = Path(folder)
        workers = min(os.cpu_count() or 1, 6)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            poses = list(pool.map(lambda item: prepare_pose(item, work), enumerate(sources)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            encoded = list(pool.map(lambda pose: webp_pose(binary, pose[0], QUALITY), poses))
        desktop, terminal = sheets_for([pose[0] for pose in encoded], [pose[1] for pose in poses if pose[1] is not None])
        install_native_sources(sources, root, work)
        install_sheet(root / "assets" / "desktop" / "fika.webp", desktop, work)
        install_sheet(root / "assets" / "terminal" / "fika.png", terminal, work)
        report = {
            "source": str(preview.relative_to(root)) if preview.is_relative_to(root) else str(preview),
            "source_sha256": hashlib.sha256(b"".join(pose[2] for pose in poses)).hexdigest(),
            "fps": FPS, "duration_ms": DURATION_MS, "frames": FRAME_COUNT,
            "source_size": [SOURCE_SIZE, SOURCE_SIZE], "desktop_size": [SIZE, SIZE],
            "native_source_path": "assets/fika", "native_frames": len(sources),
            "terminal_cells": [TERMINAL_COLUMNS, TERMINAL_ROWS], "terminal_fps": TERMINAL_FPS,
            "terminal_frames": FRAME_COUNT // TERMINAL_STRIDE, "terminal_stride": TERMINAL_STRIDE, "terminal_gamma": TERMINAL_GAMMA,
            "terminal_codec": "APNG RGBA from BP1 palettes", "terminal_source_size": [TERMINAL_SOURCE_WIDTH, TERMINAL_SOURCE_HEIGHT],
            "quality": QUALITY, "alpha_quality": ALPHA_QUALITY,
            "desktop_sheet_bytes": len(desktop), "terminal_sheet_bytes": len(terminal),
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
        }
        (root / "tools" / "fika-frames.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Fika encoding failed: {error}", file=sys.stderr)
        sys.exit(1)
