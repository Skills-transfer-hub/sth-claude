#!/usr/bin/env python3
"""Decode every shipped Buddy/Fika image and render proofs from those exact bytes.

Writes only a new audit directory, never the mod's images or generated modules.
Requires Pillow and cwebp for deterministic source/order verification.
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageStat

from encode_buddy_terminal import encode_frame, MAIN_COLUMNS, MAIN_ROWS, MAIN_SOURCE_WIDTH, MAIN_SOURCE_HEIGHT, MAIN_CROP, MAIN_FPS, MAIN_GAMMA
from buddy_terminal_codec import encode_packet, decode_packet, terminal_cells, raster_image


STATES = {"ok": 80, "work": 48, "done": 38, "error": 30, "update": 36, "noConfig": 72}
BG = (38, 38, 38)
DEFAULT_COLOR = 0x01000000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_frames(path):
    source = path.read_text()
    direct = re.fullmatch(r"export default\s+(\[.*\]);\s*", source, re.DOTALL)
    if direct:
        frames = json.loads(direct[1])
        require(isinstance(frames, list) and all(isinstance(frame, str) for frame in frames), f"Invalid data module: {path}")
        return frames
    imports = re.findall(r"^import block(\d+) from '\./(\d{3})';$", source, re.MULTILINE)
    require(imports and all(int(index) == position and int(name) == position for position, (index, name) in enumerate(imports)), f"Invalid chunk order: {path}")
    expected = ",".join(f"...block{index}" for index in range(len(imports)))
    require(f"export const FRAMES: string[] = [{expected}];" in source, f"Invalid frame concatenation: {path}")
    frames = []
    for position, (_, name) in enumerate(imports):
        chunk = load_frames(path.parent / f"{name}.ts")
        require(1 <= len(chunk) <= 12 and (position == len(imports) - 1 or len(chunk) == 12), f"Invalid chunk length: {name}")
        frames.extend(chunk)
    return frames


def numeric_exports(path):
    return {name: int(value) for name, value in re.findall(r"export const ([A-Z_]+) = (\d+);", path.read_text())}


def decode_image(content, size, label):
    with Image.open(BytesIO(content)) as image:
        image.load()
        require(image.size == size and image.mode == "RGBA", f"{label}: expected RGBA {size}, got {image.mode} {image.size}")
        result = image.copy()
    low, high = result.getchannel("A").getextrema()
    require(low == 0 and high > 0, f"{label}: missing visible pixels or transparent background")
    return result


def decode_cells(content, columns, rows):
    raw = base64.b64decode(content, validate=True)
    if raw[:3] == b"BP\x01":
        return raster_image(terminal_cells(content, columns, rows), columns, rows)
    require(len(raw) == columns * rows * 12, "Invalid raster byte length")
    words = struct.unpack(f"<{columns * rows * 3}I", raw)
    image = Image.new("RGB", (columns, rows * 2), BG)
    pixels = image.load()
    visible = 0
    for index in range(columns * rows):
        glyph, fg, bg = words[index * 3:index * 3 + 3]
        require(glyph in (32, 0x2580, 0x2584), f"Invalid raster glyph: {glyph}")
        require(all(color <= 0xffffff or color == DEFAULT_COLOR for color in (fg, bg)), "Invalid raster RGB/default word")
        def rgb(word):
            return BG if word == DEFAULT_COLOR else ((word >> 16) & 255, (word >> 8) & 255, word & 255)
        x, y = index % columns, (index // columns) * 2
        pixels[x, y] = rgb(fg if glyph == 0x2580 else bg)
        pixels[x, y + 1] = rgb(fg if glyph == 0x2584 else bg)
        visible += glyph != 32
    require(visible > 20, "Empty or truncated raster")
    return image


def webp_bytes(binary, image, work, name, quality, alpha_quality):
    png, encoded = work / f"{name}.png", work / f"{name}.webp"
    image.save(png)
    result = subprocess.run([binary, "-quiet", "-q", str(quality), "-alpha_q", str(alpha_quality), "-m", "6", "-exact", str(png), "-o", str(encoded)], capture_output=True, text=True)
    require(result.returncode == 0, f"cwebp: {result.stderr.strip()}")
    return encoded.read_bytes()


def alpha_metrics(expected, actual):
    source, encoded = expected.getchannel("A"), actual.getchannel("A")
    delta = ImageChops.difference(source, encoded)
    geometry = source.point(lambda value: 255 if value >= 128 else 0)
    zero = source.point(lambda value: 255 if value == 0 else 0)
    return {"alpha_mae": ImageStat.Stat(delta).mean[0], "geometry_alpha_mae": ImageStat.Stat(delta, geometry).mean[0],
            "source_zero_preserved": ImageStat.Stat(encoded, zero).extrema[0][1] == 0,
            "alpha_max_error": delta.getextrema()[1]}


def dark(image):
    background = Image.new("RGBA", image.size, BG + (255,))
    return Image.alpha_composite(background, image.convert("RGBA")).convert("RGB")


def contact(rows, labels, column_labels, output, tile=232, raster_rows=None):
    width, height = len(rows[0]) * (tile + 16) + 20, len(rows) * (tile + 46) + 60
    canvas = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 12), "Assets exacts sur fond #262626 (vignettes)", fill="white")
    for row, images in enumerate(rows):
        for column, image in enumerate(images):
            x, y = 12 + column * (tile + 16), 48 + row * (tile + 46)
            draw.text((x, y), f"{labels[row]} | {column_labels[column]}", fill="white")
            rendered = dark(image).resize((tile, tile), Image.Resampling.NEAREST if raster_rows and row in raster_rows else Image.Resampling.LANCZOS)
            canvas.paste(rendered, (x, y + 22))
    canvas.save(output)


def animation(images, fps, output, raster=False):
    # APNG is lossless. 33/34 ms scheduling preserves the full nine-second clip.
    pictures = [dark(image).resize((384, 384), Image.Resampling.NEAREST) if raster else dark(image) for image in images]
    durations = [round((index + 1) * 1000 / fps) - round(index * 1000 / fps) for index in range(len(images))]
    pictures[0].save(output, format="PNG", save_all=True, append_images=pictures[1:], duration=durations, loop=0, disposal=0, blend=0, compress_level=3)
    with Image.open(output) as proof:
        actual_duration = 0
        for index in range(proof.n_frames):
            proof.seek(index)
            actual_duration += proof.info.get("duration", 0)
        require(abs(actual_duration - sum(durations)) < 1, f"Preview duration changed: {output}")
    return {"file": output.name, "source_frames": len(images), "duration_ms": sum(durations), "bytes": output.stat().st_size}


def audit(root, output, typescript_proof=None, reuse_image_proof=None):
    output.mkdir(parents=True, exist_ok=False)
    binary = shutil.which("cwebp")
    require(binary is not None, "cwebp is required to verify every frame against its source")
    report = {"audited_at": datetime.now(timezone.utc).isoformat(), "root": str(root), "states": {}, "anomalies": [], "previews": [], "proofs": []}
    previous = json.loads(reuse_image_proof.read_text()) if reuse_image_proof else None
    if previous:
        require(previous.get("webp_order_verified_by_exact_reencoding") == 574, "Previous proof did not verify all WebP encodings")
    ts_cells = {(item["state"], item["index"], item["columns"], item["rows"]): item["cells"]
                for item in json.loads(typescript_proof.read_text())} if typescript_proof else {}
    ts_checked = 0
    rendered_40 = {}
    def checked_cells(packet, state, index, columns, rows):
        nonlocal ts_checked
        result = terminal_cells(packet, columns, rows)
        raw = base64.b64decode(result)
        words = struct.unpack(f"<{columns * rows * 3}I", raw)
        pairs = {(words[index + 1], words[index + 2]) for index in range(0, len(words), 3)}
        require(len(pairs) <= 1024, f"Raster foreground/background pairs exceed SDK limit: {state}/{index} {columns}x{rows}")
        if typescript_proof:
            require(ts_cells.get((state, index, columns, rows)) == result, f"Python/TypeScript raster mismatch: {state}/{index} {columns}x{rows}")
            ts_checked += 1
        return result
    all_desktop, all_raster = {}, {}
    jobs = []
    with tempfile.TemporaryDirectory(prefix="buddy-media-audit-") as temporary:
        work = Path(temporary)
        for state, count in STATES.items():
            sources = sorted((root / "assets" / "frames" / state).glob("*.png"))
            require([path.name for path in sources] == [f"{index:03d}.png" for index in range(count)], f"{state}: invalid PNG count/order")
            webps = load_frames(root / "ui" / "frames" / f"{state}.ts")
            rasters = load_frames(root / "ui" / "terminal-frames" / f"{state}.ts")
            require(len(webps) == count and len(rasters) == count // 2, f"{state}: invalid encoded count")
            desktop_images, raster_images, raster_40_images, frames = [], [], [], []
            for index, path in enumerate(sources):
                content = path.read_bytes()
                source = decode_image(content, (384, 384), str(path))
                webp = base64.b64decode(webps[index], validate=True)
                desktop = decode_image(webp, (384, 384), f"{state} WebP {index}")
                metrics = alpha_metrics(source, desktop)
                require(metrics["alpha_max_error"] == 0, f"{state}/{index}: desktop alpha differs from lossless source")
                if not previous:
                    jobs.append((state, index, source, webp, 95, 100))
                frame = {"index": index, "png_sha256": hashlib.sha256(content).hexdigest(), "webp_sha256": hashlib.sha256(webp).hexdigest(), **metrics}
                if previous:
                    prior = previous["states"][state]["frames"][index]
                    require((prior["png_sha256"], prior["webp_sha256"]) == (frame["png_sha256"], frame["webp_sha256"]), f"Image fingerprint changed: {state}/{index}")
                if index % 2 == 0:
                    raster = rasters[index // 2]
                    require(raster == encode_packet(path, width=MAIN_SOURCE_WIDTH, height=MAIN_SOURCE_HEIGHT, gamma=MAIN_GAMMA, crop=MAIN_CROP), f"{state}/{index}: raster does not match source/order")
                    require(decode_packet(raster)[:2] == (MAIN_SOURCE_WIDTH, MAIN_SOURCE_HEIGHT), "Main BP1 source dimensions mismatch")
                    cells_48 = checked_cells(raster, state, index // 2, MAIN_COLUMNS, MAIN_ROWS)
                    cells_40 = checked_cells(raster, state, index // 2, 40, 20)
                    raster_images.append(raster_image(cells_48, MAIN_COLUMNS, MAIN_ROWS))
                    raster_40_images.append(raster_image(cells_40, 40, 20))
                    frame["rendered_cells_sha256"] = {"48x24": hashlib.sha256(base64.b64decode(cells_48)).hexdigest(), "40x20": hashlib.sha256(base64.b64decode(cells_40)).hexdigest()}
                    frame["raster_sha256"] = hashlib.sha256(base64.b64decode(raster)).hexdigest()
                frames.append(frame)
                desktop_images.append(desktop)
            report["states"][state] = {"png_frames": count, "webp_frames": len(webps), "raster_frames": len(rasters), "png_size": [384, 384], "desktop_fps": 20, "terminal_fps": MAIN_FPS, "terminal_cells": [MAIN_COLUMNS, MAIN_ROWS], "terminal_codec": "BP1", "source_size": [MAIN_SOURCE_WIDTH, MAIN_SOURCE_HEIGHT], "gamma": MAIN_GAMMA, "crop": list(MAIN_CROP), "duration_ms": count * 50, "frames": frames}
            all_desktop[state], all_raster[state] = desktop_images, raster_images
            rendered_40[state] = raster_40_images
            print(f"Decoded all {state}: {count} PNG, {len(webps)} WebP, {len(rasters)} Raster", flush=True)

        manifest = json.loads((root / "ui/frames/fika/manifest.json").read_text())
        desktop_metadata = numeric_exports(root / "ui/frames/fika/index.ts")
        terminal_metadata = numeric_exports(root / "ui/terminal-frames/fika/index.ts")
        require(desktop_metadata == {"FPS": 30, "DURATION_MS": 9000, "FRAME_COUNT": 270}, "Fika desktop cadence metadata mismatch")
        terminal_fps, terminal_count = terminal_metadata["FPS"], terminal_metadata["FRAME_COUNT"]
        terminal_columns, terminal_rows = terminal_metadata["COLUMNS"], terminal_metadata["ROWS"]
        require(30 % terminal_fps == 0 and terminal_count / terminal_fps == 9 and terminal_metadata["DURATION_MS"] == 9000, "Fika terminal cadence/duration mismatch")
        terminal_stride = 30 // terminal_fps
        terminal_gamma = manifest.get("terminal_gamma", 1.0)
        require(manifest["terminal_cells"] == [terminal_columns, terminal_rows], "Fika raster dimensions differ from manifest")
        generation_root = (root / manifest["source"]).resolve()
        canonical_root = root / "assets/fika"
        source_root = canonical_root if canonical_root.is_dir() else generation_root / "frames"
        require(source_root.is_relative_to(root), "Fika source path leaves the repository")
        sources = sorted(source_root.glob("*.png"))
        require([path.name for path in sources] == [f"fika-{index:04d}.png" for index in range(1, 271)], "Fika PNG count/order mismatch")
        webps = load_frames(root / "ui/frames/fika/index.ts")
        rasters = load_frames(root / "ui/terminal-frames/fika/index.ts")
        require(len(webps) == 270 and len(rasters) == terminal_count, "Fika encoded frame count mismatch")
        desktop_images, raster_images, raster_40_images, source_images, frames, source_hashes = [], [], [], [], [], []
        for index, path in enumerate(sources):
            content = path.read_bytes()
            source = decode_image(content, (720, 720), str(path))
            resized = source.convert("RGBa").resize((384, 384), Image.Resampling.LANCZOS).convert("RGBA")
            webp = base64.b64decode(webps[index], validate=True)
            desktop = decode_image(webp, (384, 384), f"Fika WebP {index}")
            metrics = alpha_metrics(resized, desktop)
            require(metrics["source_zero_preserved"] and metrics["geometry_alpha_mae"] <= 5, f"Fika/{index}: alpha transparency changed beyond codec limits")
            digest = hashlib.sha256(content).digest()
            source_hashes.append(digest)
            frame = {"index": index, "png_sha256": digest.hex(), "webp_sha256": hashlib.sha256(webp).hexdigest(), **metrics}
            if previous:
                prior = previous["fika"]["frames"][index]
                require((prior["png_sha256"], prior["webp_sha256"]) == (frame["png_sha256"], frame["webp_sha256"]), f"Fika image fingerprint changed: {index}")
            if index % terminal_stride == 0:
                raster = rasters[index // terminal_stride]
                source_width, source_height = manifest["terminal_source_size"]
                require(raster == encode_packet(path, width=source_width, height=source_height, gamma=terminal_gamma), f"Fika/{index}: raster source/order mismatch")
                cells_48 = checked_cells(raster, "fika", index // terminal_stride, terminal_columns, terminal_rows)
                cells_40 = checked_cells(raster, "fika", index // terminal_stride, 40, 20)
                raster_images.append(raster_image(cells_48, terminal_columns, terminal_rows))
                raster_40_images.append(raster_image(cells_40, 40, 20))
                frame["rendered_cells_sha256"] = {"48x24": hashlib.sha256(base64.b64decode(cells_48)).hexdigest(), "40x20": hashlib.sha256(base64.b64decode(cells_40)).hexdigest()}
                frame["raster_sha256"] = hashlib.sha256(base64.b64decode(raster)).hexdigest()
            frames.append(frame)
            if not previous:
                jobs.append(("fika", index, resized, webp, 75, 50))
            desktop_images.append(desktop)
            source_images.append(source)
        source_digest = hashlib.sha256(b"".join(source_hashes)).hexdigest()
        require(source_digest == manifest["source_sha256"], "Fika source digest differs from the shipped manifest")
        report["fika"] = {"png_frames": 270, "webp_frames": 270, "raster_frames": len(rasters), "native_png_size": [720, 720], "webp_size": [384, 384], "source_path": str(source_root), "source_kind": "canonical-assets" if source_root == canonical_root else "generation-preview", "source_sha256_verified": source_digest, "fps": 30, "duration_ms": 9000, "terminal_cells": [terminal_columns, terminal_rows], "terminal_fps": terminal_fps, "terminal_stride": terminal_stride, "terminal_gamma": terminal_gamma, "alpha_mae_mean": sum(frame["alpha_mae"] for frame in frames) / 270, "geometry_alpha_mae_max": max(frame["geometry_alpha_mae"] for frame in frames), "frames": frames}
        report["fika"]["terminal_codec"] = "BP1"
        report["fika"]["terminal_source_size"] = manifest["terminal_source_size"]
        print(f"Decoded all Fika: 270 PNG, 270 WebP, {len(rasters)} Raster; native sources and manifest digest verified", flush=True)

        def verify_job(job):
            state, index, image, shipped, quality, alpha_quality = job
            regenerated = webp_bytes(binary, image, work, f"{state}-{index:03d}", quality, alpha_quality)
            return state, index, regenerated == shipped
        mismatches = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            for state, index, identical in pool.map(verify_job, jobs):
                if not identical:
                    mismatches.append({"state": state, "index": index})
        require(not mismatches, f"Source/order re-encoding mismatch: {mismatches[:12]}")
        report["webp_order_verified_by_exact_reencoding"] = 574 if previous else len(jobs)
        if previous:
            report["image_proof_reused"] = {"report": str(reuse_image_proof), "report_sha256": hashlib.sha256(reuse_image_proof.read_bytes()).hexdigest(), "all_image_fingerprints_unchanged": 574}
        report["typescript_raster_byte_matches"] = ts_checked
        print(f"All 574 image fingerprints/order verified; Python/TypeScript raster byte matches: {ts_checked}", flush=True)

        labels = ["frame 0", "milieu", "dernier"]
        rows = [[all_desktop[state][(0, len(all_desktop[state]) // 2, len(all_desktop[state]) - 1)[row]] for state in STATES] for row in range(3)]
        contact(rows, labels, list(STATES), output / "buddy-desktop-contact.png")
        rows = [[all_raster[state][(0, len(all_raster[state]) // 2, len(all_raster[state]) - 1)[row]] for state in STATES] for row in range(3)]
        contact(rows, labels, list(STATES), output / "buddy-terminal-contact.png", raster_rows={0, 1, 2})
        rows = [[rendered_40[state][(0, len(rendered_40[state]) // 2, len(rendered_40[state]) - 1)[row]] for state in STATES] for row in range(3)]
        contact(rows, labels, list(STATES), output / "buddy-terminal-40-contact.png", raster_rows={0, 1, 2})
        old = raster_image(encode_frame(root / "assets/frames/ok/000.png", columns=32, rows=16, gamma=.55), 32, 16)
        contact([[old, rendered_40["ok"][0], all_raster["ok"][0]]], ["Meme empreinte384px"], ["Ancien32x16 gamma.55", "40x20 quadrants gamma.75", "48x24 quadrants gamma.75"], output / "buddy-before-after.png", tile=384, raster_rows={0})
        indices = [0, 39, 85, 183, 204, 261, 269]
        contact([[source_images[index] for index in indices], [desktop_images[index] for index in indices],
                 [raster_images[index // terminal_stride] for index in indices]],
                ["PNG natif", "WebP utilise", "Raster utilise"], [f"{index / 30:.2f}s" for index in indices], output / "fika-contact.png", raster_rows={2})
        for state in STATES:
            report["previews"].append(animation(all_desktop[state], 20, output / f"buddy-{state}-desktop.apng"))
            report["previews"].append(animation(all_raster[state], MAIN_FPS, output / f"buddy-{state}-terminal.apng", raster=True))
            print(f"Exact animated proofs: {state}", flush=True)
        report["previews"].append(animation(desktop_images, 30, output / "fika-desktop.apng"))
        report["previews"].append(animation(raster_images, terminal_fps, output / "fika-terminal.apng", raster=True))
        report["previews"].append(animation(rendered_40["ok"], MAIN_FPS, output / "buddy-ok-terminal-40.apng", raster=True))
        report["previews"].append(animation(raster_40_images, terminal_fps, output / "fika-terminal-40.apng", raster=True))
        # A native-source preview makes the 720px alternative directly reviewable.
        report["previews"].append(animation(source_images, 30, output / "fika-native-720.apng"))
        report["proofs"] = ["buddy-desktop-contact.png", "buddy-terminal-contact.png", "buddy-terminal-40-contact.png", "fika-contact.png", "buddy-before-after.png"]
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        cards = []
        for preview in report["previews"]:
            dimensions = "40x20 cellules" if "terminal-40" in preview["file"] else "48x24 cellules" if "terminal" in preview["file"] else "PNG/WebP source"
            cards.append(f'<figure><figcaption>{preview["file"]} ({preview["duration_ms"] / 1000:g}s, {dimensions})</figcaption><img src="{preview["file"]}" alt="{preview["file"]}"></figure>')
        cards.insert(0, '<figure style="grid-column:1/-1"><figcaption>Avant/apres au meme format384px : ancien32x16 et nouveaux quadrants40x20 /48x24</figcaption><img src="buddy-before-after.png" alt="Comparaison exacte des cellules rendues"></figure>')
        raster_total = sum(state["raster_frames"] for state in report["states"].values()) + len(rasters)
        image_verification = ('Les empreintes des574 PNG et574 WebP correspondent à l’audit précédent, qui avait reproduit chaque encodage exactement depuis son PNG.' if previous else 'Chaque WebP a été reproduit exactement depuis son PNG correspondant.')
        html = '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Audit Buddy · données réelles</title><style>body{background:#262626;color:#eee;font:16px system-ui;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px}figure{margin:0}img{max-width:100%}figcaption{margin:12px 0}</style><h1>Buddy · audit des assets réellement utilisés</h1><p>' + image_verification + ' Cet audit contrôle les' + str(raster_total) + ' paquets BP1 et leurs574 rendus en40x20 et48x24 cellules. Les images raster sont agrandies sans lissage ; les animations APNG conservent les pixels et la durée réelle.</p><p><a href="report.json">Rapport détaillé</a></p><main>' + "".join(cards) + '</main></html>'
        (output / "index.html").write_text(html)
    print(json.dumps({"result": "pass", "output": str(output), "png": 574, "webp": 574, "raster": raster_total, "proofs": len(report["previews"]), "anomalies": report["anomalies"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--typescript-proof", type=Path, help="JSON cells emitted by the actual TS helper for all poses at40/48 columns")
    parser.add_argument("--reuse-image-proof", type=Path, help="Reuse prior exact WebP re-encoding only when every PNG/WebP fingerprint still matches")
    args = parser.parse_args()
    root = args.root.resolve()
    output = args.output.resolve() if args.output else root / "outputs/buddy-audit" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    audit(root, output, args.typescript_proof, args.reuse_image_proof)


if __name__ == "__main__":
    main()
