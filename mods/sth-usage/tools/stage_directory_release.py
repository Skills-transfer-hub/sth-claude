#!/usr/bin/env python3
"""Stage the production release after testing its full bundle; never push.

The input must retain its regression tests. The workflow validates and runs them
before this step; only the published tree and its archive omit tests/ fixtures.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

from build_directory_bundle import REVIEW_TOOLS, REVIEW_VENDOR, validate_reviewable_files

MAX_ARCHIVE_BYTES = 48 * 1024 * 1024  # Headroom below the portal's 50 MiB ceiling.
REPOSITORY = "Skills-transfer-hub/sth-claude"
RELEASE_BRANCH = "codex/directory-release"
STATES = {"ok", "work", "done", "error", "update", "noConfig"}


def run_git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def validate_asset_tree(source: Path, bundle: Path, receipt: dict) -> set[Path]:
    """Validate what will ship, including every immutable hosted reference."""
    data = bundle / "assets/buddy-codec"
    remote_path, index_path = data / "remote.json", data / "index.json"
    if remote_path.is_file() == index_path.is_file():
        raise SystemExit("Bundle must have exactly one hosted or embedded Buddy manifest")
    hosted = remote_path.is_file()
    index = json.loads((remote_path if hosted else index_path).read_text())
    remote = index.pop("remote", None)
    if index.get("format") != "sth-rgba-delta-v1" or set(index.get("sequences", {})) != STATES | {"fika"}:
        raise SystemExit("Buddy manifest format or animation sequences differ")
    chunks = [chunk for info in index["sequences"].values() for chunk in info["chunks"]]
    expected = {Path("assets/buddy-codec/remote.json" if hosted else "assets/buddy-codec/index.json")}
    if hosted:
        config = json.loads((source / "mods/sth-usage/tools/buddy-assets-source.json").read_text())
        commit, asset_id = config.get("commit", ""), config.get("id", "")
        url = f"https://raw.githubusercontent.com/{REPOSITORY}/{commit}/mods/sth-usage/assets/buddy-codec/"
        canonical = (json.dumps(index, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if (config.get("format") != "sth-buddy-assets-source-v1"
                or not re.fullmatch(r"[0-9a-f]{40}", commit)
                or not re.fullmatch(r"[0-9a-f]{64}", asset_id)
                or config.get("baseUrl") != url
                or remote != {"baseUrl": url, "id": asset_id}
                or sha256(canonical) != asset_id):
            raise SystemExit("Hosted Buddy manifest does not match the pinned asset source")
        bootstrap = {}
        for state in sorted(STATES):
            relative = Path(f"assets/bootstrap/{state}.png")
            original = source / f"mods/sth-usage/assets/frames/{state}/000.png"
            if not (bundle / relative).is_file() or (bundle / relative).read_bytes() != original.read_bytes():
                raise SystemExit(f"Bootstrap pose must be the exact original PNG: {state}")
            bootstrap[state] = sha256((bundle / relative).read_bytes())
            expected.add(relative)
        metadata = {"baseUrl": url, "id": asset_id, "commit": commit, "indexSha256": asset_id,
                    "packetCount": len(chunks), "packetBytes": sum(chunk["bytes"] for chunk in chunks),
                    "bootstrapSha256": bootstrap}
        if receipt.get("assetDelivery") != "hosted" or receipt.get("hostedAssetSource") != metadata:
            raise SystemExit("Hosted asset receipt differs from the shipped files and pinned source")
    else:
        if remote is not None or receipt.get("assetDelivery", "embedded") != "embedded" or receipt.get("hostedAssetSource") is not None:
            raise SystemExit("Embedded Buddy bundle must not claim hosted assets")
        for chunk in chunks:
            name = chunk.get("path", "")
            if not re.fullmatch(r"(?:ok|work|done|error|update|noConfig|fika)/[0-9]{4}\.json", name):
                raise SystemExit("Unexpected embedded Buddy packet path")
            path = data / name
            if not path.is_file() or path.stat().st_size != chunk["bytes"] or sha256(path.read_bytes()) != chunk["sha256"]:
                raise SystemExit(f"Embedded Buddy packet differs from its manifest: {name}")
            expected.add(path.relative_to(bundle))
    return expected


def validate_review_sources(source: Path, bundle: Path, receipt: dict) -> None:
    """Check submitted build inputs against the source, not just self-reported hashes."""
    root = bundle / "review-source"
    manifest_path = root / "source-manifest.json"
    if not manifest_path.is_file():
        raise SystemExit("Bundle must include its review-source manifest")
    manifest = json.loads(manifest_path.read_text())
    commit = run_git(source, "rev-parse", "HEAD")
    if (manifest.get("format") != "sth-review-source-v1" or manifest.get("sourceCommit") != commit
            or manifest.get("sourceHasChanges") is not False
            or manifest.get("sourceRoot") != "mods/sth-usage"
            or manifest.get("sourceRepository") != f"https://github.com/{REPOSITORY}"):
        raise SystemExit("Review sources must identify the exact clean source commit")
    expected = {Path("review-source/tools") / name for name in REVIEW_TOOLS}
    expected |= {Path("review-source/fflate") / name for name in REVIEW_VENDOR}
    expected |= {Path("review-source/artwork/buddy-v6.blend"), Path("review-source/README.md"),
                 Path("review-source/source-manifest.json")}
    actual = {path.relative_to(bundle) for path in root.rglob("*") if path.is_file()}
    if actual != expected:
        raise SystemExit("Review-source files differ from the allowed source payload")
    seen = set()
    for entry in manifest.get("includedFiles", []):
        relative, original = Path(entry["path"]), Path(entry["sourcePath"])
        if relative.is_absolute() or original.is_absolute() or ".." in relative.parts or ".." in original.parts or relative in seen:
            raise SystemExit("Invalid or duplicate review-source manifest path")
        seen.add(relative)
        bundled, source_file = bundle / relative, source / "mods/sth-usage" / original
        if (not bundled.is_file() or not source_file.is_file()
                or sha256(bundled.read_bytes()) != entry["sha256"]
                or bundled.read_bytes() != source_file.read_bytes()):
            raise SystemExit(f"Submitted source differs from its original: {relative}")
    if not expected.difference({Path("review-source/README.md"), Path("review-source/source-manifest.json")}).issubset(seen):
        raise SystemExit("Review-source manifest is missing required build inputs")
    originals = manifest.get("originalFrameFiles", [])
    source_frames = source / "mods/sth-usage/assets"
    expected_frames = set(source_frames.glob("frames/*/*.png")) | set(source_frames.glob("fika/*.png"))
    seen_frames = set()
    for entry in originals:
        relative = Path(entry["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit("Invalid original frame source path")
        path = source / "mods/sth-usage" / relative
        if path in seen_frames or path not in expected_frames or path.stat().st_size != entry["bytes"] or sha256(path.read_bytes()) != entry["sha256"]:
            raise SystemExit(f"Original frame source inventory differs: {relative}")
        seen_frames.add(path)
    if seen_frames != expected_frames:
        raise SystemExit("Original frame source inventory is incomplete")
    expected_receipt = {"manifest": "review-source/source-manifest.json", "sourceCommit": commit,
                        "sourceHasChanges": False, "includedFileCount": len(manifest["includedFiles"]),
                        "originalFrameCount": len(originals)}
    if receipt.get("reviewSources") != expected_receipt:
        raise SystemExit("Review-source receipt differs from the submitted source manifest")


def release_files(bundle: Path, asset_paths: set[Path], icon: Path | None) -> list[tuple[Path, Path]]:
    """Keep the tested runtime unchanged and omit test-only hook registrations."""
    if not any(path.is_file() for path in (bundle / "tests").rglob("*.test.ts")):
        raise SystemExit("Input bundle must include its regression tests before release staging")
    allowed = {".claude-plugin", "hooks", "ui", "types", "tests", "assets", "review-source", "README.md", "PRIVACY.md", "LICENSE", "tsconfig.json"}
    files = []
    for path in sorted(bundle.rglob("*")):
        relative = path.relative_to(bundle)
        if path.is_symlink():
            raise SystemExit(f"Symlinks are not permitted in the generated bundle: {relative}")
        if not path.is_file():
            continue
        if relative.parts[0] not in allowed and relative != icon and not (len(relative.parts) == 1 and relative.name.startswith("THIRD_PARTY")):
            raise SystemExit(f"Unexpected bundle entry: {relative}")
        if relative.parts[0] == "assets" and relative not in asset_paths and relative != icon:
            raise SystemExit(f"Unexpected artwork or animation data in release: {relative}")
        if any(part in {".git", ".env", "node_modules", "outputs", "previews", "__pycache__"} for part in relative.parts):
            raise SystemExit(f"Forbidden bundle entry: {relative}")
        if path.suffix.lower() in {".blend", ".mov", ".mp4", ".webm", ".pyc"} and relative != Path("review-source/artwork/buddy-v6.blend"):
            raise SystemExit(f"Source media must remain on main: {relative}")
        if relative.parts[:2] == (".claude-plugin", "types"):
            raise SystemExit("Locally generated Claude SDK declarations must not be published")
        # Preserve the validated input for CI and local debugging. Test fixtures
        # register mock hooks/tools and must not be scanned as shipped behavior.
        if relative.parts[0] != "tests":
            files.append((path, relative))
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True, help="Validated output/sth-usage directory")
    parser.add_argument("--output", type=Path, required=True, help="New empty staging directory")
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    source, bundle, output = (value.resolve() for value in (args.source_root, args.bundle, args.output))
    if output.exists():
        raise SystemExit("Output must not already exist")
    if source == output or source in output.parents or bundle == output or bundle in output.parents:
        raise SystemExit("Output must be outside both the source tree and bundle")
    commit = run_git(source, "rev-parse", "HEAD")
    if commit != args.source_commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("Source commit does not match checked-out HEAD")
    if subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD", "--", ".claude-plugin/marketplace.json", "mods/sth-usage"]).returncode:
        raise SystemExit("Commit the source changes before staging a release")
    manifest = json.loads((bundle / ".claude-plugin/plugin.json").read_text())
    source_manifest = json.loads((source / "mods/sth-usage/.claude-plugin/plugin.json").read_text())
    version = manifest.get("version", "")
    if manifest.get("name") != "sth-usage" or source_manifest.get("version") != version:
        raise SystemExit("Source and bundle plugin identity/version differ")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("A numeric major.minor.patch release version is required")
    required = [".claude-plugin/plugin.json", "hooks/hooks.json", "LICENSE", "PRIVACY.md", "README.md"]
    for name in required:
        if not (bundle / name).is_file():
            raise SystemExit(f"Missing required bundle file: {name}")
    if not any(path.is_file() for path in bundle.glob("THIRD_PARTY*")):
        raise SystemExit("Bundle must include third-party notices for its decoder")
    receipt = json.loads((bundle.parent / "receipt.json").read_text())
    if receipt.get("format") != "sth-rgba-delta-v1" or receipt.get("codecIncluded") is not True or receipt.get("pixelVerification") != "passed":
        raise SystemExit("Builder receipt must confirm codec inclusion and exact pixel verification")
    asset_paths = validate_asset_tree(source, bundle, receipt)
    validate_review_sources(source, bundle, receipt)
    validate_reviewable_files(bundle)
    icon_name = manifest.get("icon")
    icon = Path(icon_name) if isinstance(icon_name, str) and icon_name and not icon_name.startswith(("https://", "http://")) else None
    if icon is not None and (icon.is_absolute() or ".." in icon.parts or not (bundle / icon).is_file()):
        raise SystemExit("Declared listing icon must be a file inside the bundle")
    files = release_files(bundle, asset_paths, icon)

    plugin = output / "mods/sth-usage"
    plugin.mkdir(parents=True)
    for path, relative in files:
        target = plugin / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    (output / ".claude-plugin").mkdir()
    marketplace = json.loads((source / ".claude-plugin/marketplace.json").read_text())
    entries = marketplace.get("plugins", [])
    if marketplace.get("name") != "sth" or len(entries) != 1 or entries[0].get("name") != "sth-usage" or entries[0].get("source") != "./mods/sth-usage":
        raise SystemExit("Marketplace must point at the one compact plugin in this release tree")
    dump(output / ".claude-plugin/marketplace.json", marketplace)
    hashes = {str(relative): hashlib.sha256(path.read_bytes()).hexdigest() for path, relative in files}
    dump(output / "release.json", {
        "format": 1, "plugin": "sth-usage", "version": version,
        "sourceRepository": REPOSITORY, "sourceCommit": commit,
        "sourceCommitTime": run_git(source, "show", "-s", "--format=%cI", commit),
        "releaseBranch": RELEASE_BRANCH, "pluginFilesSha256": hashes,
        "assetDelivery": receipt.get("assetDelivery", "embedded"),
        "hostedAssetSource": receipt.get("hostedAssetSource"),
        "reviewSources": receipt["reviewSources"],
    })
    (output / "README.md").write_text(
        f"# Buddy by STH · {version}\n\n"
        "This branch contains the generated distribution, readable runtime source and "
        "[submitted build inputs](mods/sth-usage/review-source/README.md). The original rendered PNG frames remain in "
        f"[the exact source commit](https://github.com/{REPOSITORY}/tree/{commit}/mods/sth-usage/assets); "
        "their SHA-256 hashes are included in the review-source manifest.\n\n"
        "Requires Claude Code 2.1.287 or later and Git.\n\n"
        "```sh\n"
        f"claude plugin marketplace add https://github.com/{REPOSITORY}.git#{RELEASE_BRANCH}\n"
        "claude plugin install sth-usage@sth --scope user\n"
        "```\n\n"
        "Restart Claude Code or run `/reload-plugins`, then `/sth-usage`. "
        "To receive future versions automatically, enable auto-update for `sth` in `/plugin` → Marketplaces. "
        "Manual update: `claude plugin update sth-usage@sth`.\n\n"
        "See [usage](mods/sth-usage/README.md), [privacy](mods/sth-usage/PRIVACY.md), "
        "[licensing](mods/sth-usage/LICENSE) and the bundled third-party notices.\n\n"
        f"Built from [{commit[:7]}](https://github.com/{REPOSITORY}/commit/{commit}); "
        "`release.json` records the source and file hashes.\n"
    )
    archive_path = output.parent / f"{output.name}.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(p for p in output.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo("sth-claude-codex-directory-release/" + path.relative_to(output).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    size = archive_path.stat().st_size
    if size > MAX_ARCHIVE_BYTES:
        raise SystemExit(f"Release archive exceeds 48 MiB budget: {size} bytes")
    print(json.dumps({"version": version, "sourceCommit": commit, "tree": str(output), "archive": str(archive_path), "archiveBytes": size, "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
