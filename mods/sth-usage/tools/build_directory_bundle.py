#!/usr/bin/env python3
"""Build the Claude Directory distribution without changing Buddy pixels.

Usage:
  python tools/build_directory_bundle.py --source . --output /tmp/sth-directory \\
      --include-tests

Requires Pillow and NumPy. Stage or commit all runtime files before building:
the allowlist copies tracked files from hooks/, ui/, and types/, required listing
documents, the manifest, and optionally tests/. Untracked media and experiments
are never copied. Source PNG sequences remain in the source checkout. Lossless
RGBA keyframes/deltas are verified against an immutable hosted asset release.
The default bundle includes the pinned manifest and exact initial PNG poses;
--embed-assets includes every lossless packet for a fully offline distribution.
Every encoded frame is decoded and checked against its source in both modes.

OUTPUT must not exist and must be outside the repository. It receives sth-usage/,
receipt.json, and reproducible ZIP/tar.gz archives. Size checks cover individual
files, the plugin, and both archives. Packaging does not validate runtime behavior:
run Claude's plugin validate/test commands against OUTPUT/sth-usage before release.
Use --include-tests for CI and local checks. The release staging tool retains
that tested input and excludes test-only hooks from the published production tree.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
import zipfile
import zlib

import numpy as np
from PIL import Image
import PIL

FORMAT = "sth-rgba-delta-v1"
MAX_PACKET_BYTES = 4 * 1024 * 1024
KEYFRAME_INTERVAL = 30
CHUNK_SIZE = 6
EXPECTED_SEQUENCES = {
    "ok": (80, 384, 384), "work": (48, 384, 384), "done": (38, 384, 384),
    "error": (30, 384, 384), "update": (36, 384, 384), "noConfig": (72, 384, 384),
    "fika": (270, 720, 720),
}
MAX_PLUGIN_BYTES = 200 * 1024 * 1024
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_SCRIPT_BYTES = 1024 * 1024
SCRIPT_SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".sh"}
IMAGE_FORMATS = {".png": "PNG", ".webp": "WEBP", ".jpg": "JPEG", ".jpeg": "JPEG", ".gif": "GIF"}
RUNTIME_DIRECTORIES = ("hooks", "ui", "types")
REQUIRED_FILES = ("README.md", "PRIVACY.md", "LICENSE", ".claude-plugin/plugin.json")
ASSET_SOURCE_FILE = "tools/buddy-assets-source.json"
REVIEW_TOOLS = (
    "build_directory_bundle.py", "stage_directory_release.py", "test_directory_packaging.py",
    "buddy-assets-source.json", "encode_buddy_frames.py", "encode_buddy_terminal.py",
    "encode_fika_frames.py", "buddy_terminal_codec.py", "render_buddy_frames.py",
    "render_fika_transparent.py", "fika_props.py", "fika_table.py", "check_buddy_assets.py",
    "audit_buddy_media.py", "README.md",
)
REVIEW_VENDOR = ("README.md", "browser.js", "entry.js", "rebuild.py")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_json(path: Path, value: object) -> bytes:
    data = json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def hosted_asset_source(source: Path, tracked: list[Path]) -> dict:
    """Only a reviewed, tracked, commit-pinned asset source may be released."""
    if Path(ASSET_SOURCE_FILE) not in tracked:
        raise ValueError(f"Stage or commit {ASSET_SOURCE_FILE} before building hosted assets")
    config = json.loads((source / ASSET_SOURCE_FILE).read_text())
    commit, asset_id = config.get("commit", ""), config.get("id", "")
    expected = f"https://raw.githubusercontent.com/Skills-transfer-hub/sth-claude/{commit}/mods/sth-usage/assets/buddy-codec/"
    if (config.get("format") != "sth-buddy-assets-source-v1"
            or not re.fullmatch(r"[0-9a-f]{40}", commit)
            or not re.fullmatch(r"[0-9a-f]{64}", asset_id)
            or config.get("baseUrl") != expected):
        raise ValueError("Buddy asset source must pin a GitHub commit and the index SHA-256")
    return config


def externalize_assets(source: Path, data_root: Path, index: dict, config: dict) -> dict:
    """Require exact hosted packets before replacing them with their manifest."""
    index_data = json_bytes(index)
    if digest(index_data) != config["id"]:
        raise ValueError("Buddy assets differ from the pinned hosted release. Publish and verify a new "
                         "immutable asset release, then update tools/buddy-assets-source.json; "
                         "or use --embed-assets for a self-contained bundle.")
    expected = {"index.json"}
    for info in index["sequences"].values():
        for chunk in info["chunks"]:
            path = data_root / chunk["path"]
            contents = path.read_bytes()
            if len(contents) != chunk["bytes"] or digest(contents) != chunk["sha256"]:
                raise ValueError(f"Packet differs from its verified manifest: {chunk['path']}")
            expected.add(chunk["path"])
    actual = {path.relative_to(data_root).as_posix() for path in data_root.rglob("*") if path.is_file()}
    if actual != expected or (data_root / "index.json").read_bytes() != index_data:
        raise ValueError("Encoded asset tree differs from the pinned manifest")
    bootstrap = {}
    for name in EXPECTED_SEQUENCES:
        if name == "fika":
            continue
        original = source / "assets" / "frames" / name / "000.png"
        target = data_root.parent / "bootstrap" / f"{name}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        bootstrap[name] = digest(target.read_bytes())
    shutil.rmtree(data_root)
    write_json(data_root / "remote.json", {**index, "remote": {"baseUrl": config["baseUrl"], "id": config["id"]}})
    return {"baseUrl": config["baseUrl"], "id": config["id"], "commit": config["commit"],
            "indexSha256": config["id"], "packetCount": len(expected) - 1,
            "packetBytes": sum(chunk["bytes"] for info in index["sequences"].values() for chunk in info["chunks"]),
            "bootstrapSha256": bootstrap}


def encode_sequence(name: str, paths: list[Path], data_root: Path) -> dict:
    previous = None
    packet_frames = []
    chunks = []
    width = height = 0
    combined_source = hashlib.sha256()
    combined_decoded = hashlib.sha256()
    compressed_size = 0

    def flush() -> None:
        if not packet_frames:
            return
        first = packet_frames[0]["frame"]
        packet = {"format": FORMAT, "sequence": name, "width": width, "height": height,
                  "firstFrame": first, "keyframeInterval": KEYFRAME_INTERVAL,
                  "frames": packet_frames}
        relative = f"{name}/{first:04d}.json"
        data = json_bytes(packet)
        if len(data) >= MAX_PACKET_BYTES:
            raise ValueError(f"Packet {relative} is {len(data)} bytes; must be smaller than 4 MiB")
        write_json(data_root / relative, packet)
        chunks.append({"path": relative, "firstFrame": first, "frameCount": len(packet_frames),
                       "bytes": len(data), "sha256": digest(data)})
        print(json.dumps({"packet": str(data_root / relative), "frames": len(packet_frames),
                          "bytes": len(data)}), flush=True)
        packet_frames.clear()

    for frame, path in enumerate(paths):
        with Image.open(path) as image:
            current = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
        frame_height, frame_width, channels = current.shape
        _, expected_width, expected_height = EXPECTED_SEQUENCES[name]
        if (frame_width, frame_height, channels) != (expected_width, expected_height, 4):
            raise ValueError(f"Runtime expects {expected_width}x{expected_height} RGBA for {name}: {path}")
        if frame == 0:
            width, height = frame_width, frame_height
        if (frame_width, frame_height, channels) != (width, height, 4):
            raise ValueError(f"Unexpected dimensions in {path}")
        raw = current.tobytes()
        combined_source.update(raw)
        keyframe = frame % KEYFRAME_INTERVAL == 0
        payload = raw if keyframe else np.subtract(current, previous, dtype=np.uint8).tobytes()
        compressed = zlib.compress(payload, 9)
        decoded_array = np.frombuffer(zlib.decompress(compressed), dtype=np.uint8).reshape(current.shape)
        reconstructed = decoded_array if keyframe else np.add(decoded_array, previous, dtype=np.uint8)
        reconstructed_bytes = reconstructed.tobytes()
        if reconstructed_bytes != raw:
            raise AssertionError(f"RGBA mismatch: {path}")
        combined_decoded.update(reconstructed_bytes)
        record = {"frame": frame, "kind": "key" if keyframe else "delta",
                  "data": base64.b64encode(compressed).decode("ascii"), "sha256": digest(raw),
                  "sourceFileSha256": digest(path.read_bytes())}
        compressed_size += len(compressed)
        packet_frames.append(record)
        # Runtime derives packet paths from frame // 6. Never shrink an oversized
        # packet silently: flush() rejects it instead of changing that contract.
        if len(packet_frames) == CHUNK_SIZE:
            flush()
        previous = current
    flush()
    assert combined_source.digest() == combined_decoded.digest()
    return {"width": width, "height": height, "frameCount": len(paths), "chunkSize": CHUNK_SIZE,
            "keyframeInterval": KEYFRAME_INTERVAL, "compressedBytes": compressed_size,
            "rgbaSha256": combined_source.hexdigest(), "decodedRgbaSha256": combined_decoded.hexdigest(),
            "chunks": chunks}


def tracked_files(source: Path) -> tuple[Path, list[Path]]:
    """Return repository-contained tracked paths, including staged new files."""
    repo = Path(subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "--show-toplevel"], text=True).strip()).resolve()
    prefix = source.relative_to(repo).as_posix()
    output = subprocess.check_output(["git", "-C", str(repo), "ls-files", "-z", "--", prefix])
    paths = []
    for encoded in output.split(b"\0"):
        if not encoded:
            continue
        path = repo / encoded.decode("utf-8")
        relative = path.relative_to(source)
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != repo):
            raise ValueError(f"Tracked symbolic links are not supported: {relative}")
        paths.append(relative)
    return repo, sorted(set(paths))


def copy_runtime(source: Path, target: Path, tracked: list[Path], include_tests: bool) -> bool:
    target.mkdir(parents=True, exist_ok=False)
    tracked_names = {path.as_posix() for path in tracked}
    manifest = json.loads((source / ".claude-plugin/plugin.json").read_text())
    listing_assets = []
    icon = manifest.get("icon")
    if isinstance(icon, str) and icon and not icon.startswith(("https://", "http://")):
        icon_path = Path(icon)
        if icon_path.is_absolute() or ".." in icon_path.parts:
            raise ValueError("The listing icon must remain inside the plugin folder")
        listing_assets.append(icon_path)
    required = (*REQUIRED_FILES, "hooks/hooks.json", "hooks/buddy-codec.ts",
                *(path.as_posix() for path in listing_assets))
    missing = [name for name in required if name not in tracked_names or not (source / name).is_file()]
    if missing:
        raise FileNotFoundError("Required files are absent or not staged/tracked: " + ", ".join(missing))
    notices = [path for path in tracked if len(path.parts) == 1 and path.name.startswith("THIRD_PARTY")]
    if not notices:
        raise FileNotFoundError("A tracked THIRD_PARTY notices file is required for bundled runtime dependencies")
    directories = (*RUNTIME_DIRECTORIES, *(("tests",) if include_tests else ()))
    selected = [path for path in tracked if path.parts[0] in directories
                or path.as_posix() in (*REQUIRED_FILES, "tsconfig.json") or path in notices
                or path in listing_assets]
    if not any(path.parts[:2] == ("hooks", "vendor") for path in selected):
        raise FileNotFoundError("Tracked hooks/vendor/ decoder dependency is missing")
    for relative in selected:
        path = source / relative
        if not path.is_file():
            raise FileNotFoundError(f"Tracked runtime file is missing: {path}")
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    return (target / "hooks/buddy-codec.ts").is_file()


def source_sequences(source: Path, tracked: list[Path]) -> list[tuple[str, list[Path]]]:
    """Only use tracked source PNGs, rejecting gaps that would change timing."""
    groups: dict[str, list[Path]] = {}
    for relative in tracked:
        if relative.suffix != ".png":
            continue
        parts = relative.parts
        if len(parts) == 3 and parts[:2] == ("assets", "fika"):
            groups.setdefault("fika", []).append(source / relative)
        elif len(parts) == 4 and parts[:2] == ("assets", "frames"):
            groups.setdefault(parts[2], []).append(source / relative)
    if set(groups) != set(EXPECTED_SEQUENCES):
        raise ValueError("Runtime sequence names differ: expected " + ", ".join(sorted(EXPECTED_SEQUENCES)))
    sequences = [(name, sorted(paths)) for name, paths in groups.items()]
    sequences.sort(key=lambda item: (item[0] != "fika", item[0]))
    for name, paths in sequences:
        expected_count = EXPECTED_SEQUENCES[name][0]
        if len(paths) != expected_count:
            raise ValueError(f"Runtime expects {expected_count} frames for {name}; found {len(paths)}")
        for frame, path in enumerate(paths):
            expected = f"fika-{frame + 1:04d}.png" if name == "fika" else f"{frame:03d}.png"
            if path.name != expected:
                raise ValueError(f"Non-contiguous sequence {name}: expected {expected}, found {path.name}")
    return sequences


def copy_review_sources(source: Path, plugin: Path, repo: Path, tracked: list[Path]) -> dict:
    """Ship readable build inputs and bind copied files to the exact source bytes."""
    selected = [(Path("tools") / name, Path("review-source/tools") / name) for name in REVIEW_TOOLS]
    selected += [(Path("review-source/fflate") / name, Path("review-source/fflate") / name) for name in REVIEW_VENDOR]
    selected.append((Path("assets/model/buddy-v6.blend"), Path("review-source/artwork/buddy-v6.blend")))
    tracked_set = set(tracked)
    missing = [str(original) for original, _ in selected if original not in tracked_set or not (source / original).is_file()]
    if missing:
        raise FileNotFoundError("Stage or commit required review sources: " + ", ".join(missing))
    copied = []
    for original, relative in selected:
        destination = plugin / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / original, destination)
        copied.append({"path": relative.as_posix(), "sourcePath": original.as_posix(),
                       "sha256": digest(destination.read_bytes())})
    # Runtime TS/TSX and the readable decoder ship as-is, not as a compiled
    # substitute. Record these too so release staging can verify that claim.
    for path in sorted(plugin.rglob("*")):
        relative = path.relative_to(plugin)
        if path.is_file() and relative.parts[0] not in {"review-source", "tests"}:
            original = source / relative
            if relative in tracked_set and original.is_file() and path.read_bytes() == original.read_bytes():
                copied.append({"path": relative.as_posix(), "sourcePath": relative.as_posix(),
                               "sha256": digest(path.read_bytes())})
    prefix = source.relative_to(repo).as_posix()
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    dirty = subprocess.run(["git", "-C", str(repo), "diff", "--quiet", "HEAD", "--", prefix]).returncode != 0
    images = []
    for _, paths in source_sequences(source, tracked):
        for path in paths:
            images.append({"path": path.relative_to(source).as_posix(), "bytes": path.stat().st_size,
                           "sha256": digest(path.read_bytes())})
    manifest = {"format": "sth-review-source-v1", "sourceCommit": commit, "sourceHasChanges": dirty,
                "sourceRepository": "https://github.com/Skills-transfer-hub/sth-claude",
                "sourceRoot": prefix, "includedFiles": sorted(copied, key=lambda entry: entry["path"]),
                "originalFrameFiles": sorted(images, key=lambda entry: entry["path"])}
    write_json(plugin / "review-source/source-manifest.json", manifest)
    (plugin / "review-source/README.md").write_text(
        "# Submitted build sources\n\n"
        "The plugin ships its readable hooks, UI, types and vendored decoder unchanged. "
        "This folder also includes the exact packaging/encoding scripts, upstream decoder "
        "input and original Buddy Blender model. None of these review files is registered "
        "as a runtime hook. See `fflate/README.md` to reproduce the decoder byte for byte.\n\n"
        "`source-manifest.json` records the source commit and SHA-256 of every copied input. "
        "`sourceHasChanges` identifies a local preview; release staging rejects those previews. "
        "The original 574 rendered PNG frames are inventoried with their exact hashes; they "
        "remain in the source repository at the recorded commit rather than being duplicated "
        "in the compact distribution. The build checks every decoded animation pixel against them.\n\n"
        "To rebuild the complete distribution, check out that commit, install the pinned "
        "Pillow 12.3.0 and NumPy 2.3.5 build dependencies, and run "
        "`python mods/sth-usage/tools/build_directory_bundle.py --source mods/sth-usage "
        "--output /tmp/buddy-review-build --include-tests`. Run "
        "`python mods/sth-usage/tools/test_directory_packaging.py` to check packaging. "
        "The output directory must be new. These are manually invoked build tools, "
        "not commands launched by the installed plugin.\n")
    return {"manifest": "review-source/source-manifest.json", "sourceCommit": commit,
            "sourceHasChanges": dirty, "includedFileCount": len(copied), "originalFrameCount": len(images)}


def validate_reviewable_files(plugin: Path) -> None:
    """Reject unreadable/oversized scripts and mislabeled or damaged image files."""
    for path in sorted(plugin.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(plugin)
        if path.suffix.lower() in SCRIPT_SUFFIXES:
            data = path.read_bytes()
            if len(data) >= MAX_SCRIPT_BYTES:
                raise ValueError(f"Scripts must be smaller than 1 MiB: {relative}")
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ValueError(f"Scripts must be readable UTF-8 text: {relative}") from error
            if "\x00" in text:
                raise ValueError(f"Scripts must not contain binary NUL bytes: {relative}")
        expected = IMAGE_FORMATS.get(path.suffix.lower())
        if expected:
            with Image.open(path) as image:
                if image.format != expected:
                    raise ValueError(f"Image format does not match extension: {relative} ({image.format})")
                image.verify()


def archive_bundle(plugin: Path, out: Path) -> dict:
    validate_reviewable_files(plugin)
    paths = sorted(p for p in plugin.rglob("*") if p.is_file())
    uncompressed_bytes = sum(path.stat().st_size for path in paths)
    oversized = [str(path.relative_to(plugin)) for path in paths if path.stat().st_size >= MAX_FILE_BYTES]
    if oversized:
        raise ValueError("Files must be smaller than 5 MiB: " + ", ".join(oversized))
    if uncompressed_bytes >= MAX_PLUGIN_BYTES:
        raise ValueError(f"Plugin exceeds the 200 MiB limit: {uncompressed_bytes} bytes")
    zip_path = out / "sth-usage-directory.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in paths:
            entry = zipfile.ZipInfo("sth-usage/" + path.relative_to(plugin).as_posix(), (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    tar_path = out / "sth-usage-directory.tar.gz"
    with tar_path.open("wb") as disk, gzip.GzipFile(filename="", mode="wb", fileobj=disk, compresslevel=6, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
            for path in paths:
                contents = path.read_bytes()
                entry = tarfile.TarInfo("sth-usage/" + path.relative_to(plugin).as_posix())
                entry.size = len(contents)
                entry.mode = 0o644
                entry.mtime = 0
                archive.addfile(entry, io.BytesIO(contents))
    for path in (zip_path, tar_path):
        if path.stat().st_size >= MAX_ARCHIVE_BYTES:
            raise ValueError(f"Archive exceeds the 50 MiB limit: {path} ({path.stat().st_size} bytes)")
    with zipfile.ZipFile(zip_path) as archive:
        failed = archive.testzip()
        if failed is not None:
            raise ValueError(f"Archive CRC verification failed: {failed}")
    return {"fileCount": len(paths), "uncompressedBytes": uncompressed_bytes,
            "largestFileBytes": max(path.stat().st_size for path in paths),
            "zip": {"path": str(zip_path), "bytes": zip_path.stat().st_size, "sha256": digest(zip_path.read_bytes())},
            "tarGz": {"path": str(tar_path), "bytes": tar_path.stat().st_size, "sha256": digest(tar_path.read_bytes())}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True, help="Mod root containing .claude-plugin/plugin.json and tracked PNGs")
    parser.add_argument("--output", type=Path, required=True, help="New output directory outside the source repository; never overwritten")
    parser.add_argument("--include-tests", action="store_true", help="Include tracked tests/ for validation of the produced bundle")
    parser.add_argument("--embed-assets", action="store_true", help="Include all verified animation packets for a fully offline bundle")
    args = parser.parse_args()
    source, out = args.source.resolve(), args.output.resolve()
    repo, tracked = tracked_files(source)
    asset_source = None if args.embed_assets else hosted_asset_source(source, tracked)
    if out == repo or repo in out.parents:
        raise ValueError("Output must be outside the source repository")
    out.mkdir(parents=True, exist_ok=False)
    plugin = out / "sth-usage"
    codec_included = copy_runtime(source, plugin, tracked, args.include_tests)
    data_root = plugin / "assets" / "buddy-codec"
    sequences = source_sequences(source, tracked)
    index = {"format": FORMAT, "codec": "zlib-rgba-subtract", "keyframeInterval": KEYFRAME_INTERVAL,
             "sequences": {}}
    started = time.monotonic()
    for name, paths in sequences:
        if not paths:
            raise ValueError(f"No frames for sequence {name}")
        index["sequences"][name] = encode_sequence(name, paths, data_root)
    write_json(data_root / "index.json", index)
    hosted = externalize_assets(source, data_root, index, asset_source) if asset_source else None
    review_sources = copy_review_sources(source, plugin, repo, tracked)
    receipt = {"format": FORMAT, "source": str(source), "plugin": str(plugin),
               "codecIncluded": codec_included and (data_root / ("remote.json" if hosted else "index.json")).is_file(),
               "assetDelivery": "hosted" if hosted else "embedded", "hostedAssetSource": hosted,
               "runtimeValidation": "not-run", "pixelVerification": "passed",
               "reviewSources": review_sources,
               "frameCount": sum(len(paths) for _, paths in sequences),
               "chunkSize": CHUNK_SIZE, "keyframeInterval": KEYFRAME_INTERVAL,
               "dependencies": {"Pillow": PIL.__version__, "numpy": np.__version__, "zlib": zlib.ZLIB_RUNTIME_VERSION},
               "sequences": {name: {key: value for key, value in info.items() if key != "chunks"}
                             for name, info in index["sequences"].items()},
               "archives": archive_bundle(plugin, out)}
    write_json(out / "receipt.json", receipt)
    print(json.dumps({"complete": str(out / "receipt.json"), "seconds": round(time.monotonic() - started, 2),
                      "archives": receipt["archives"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
