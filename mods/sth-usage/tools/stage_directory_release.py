#!/usr/bin/env python3
"""Stage a compact release tree and reproducible archive; never commit or push."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

MAX_ARCHIVE_BYTES = 48 * 1024 * 1024  # Headroom below the portal's 50 MiB ceiling.
REPOSITORY = "Skills-transfer-hub/sth-claude"
RELEASE_BRANCH = "codex/directory-release"


def run_git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


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
    if not any((bundle / "tests").rglob("*.test.ts")):
        raise SystemExit("Bundle must include its regression tests")
    if not (bundle / "assets/buddy-codec/index.json").is_file():
        raise SystemExit("Compact Buddy codec data is missing")
    receipt = json.loads((bundle.parent / "receipt.json").read_text())
    if receipt.get("format") != "sth-rgba-delta-v1" or receipt.get("codecIncluded") is not True or receipt.get("pixelVerification") != "passed":
        raise SystemExit("Builder receipt must confirm codec inclusion and exact pixel verification")
    icon_name = manifest.get("icon")
    icon = Path(icon_name) if isinstance(icon_name, str) and icon_name and not icon_name.startswith(("https://", "http://")) else None
    if icon is not None and (icon.is_absolute() or ".." in icon.parts or not (bundle / icon).is_file()):
        raise SystemExit("Declared listing icon must be a file inside the bundle")
    allowed = {".claude-plugin", "hooks", "ui", "types", "tests", "assets", "README.md", "PRIVACY.md", "LICENSE", "tsconfig.json"}
    files = []
    for path in sorted(bundle.rglob("*")):
        relative = path.relative_to(bundle)
        if path.is_symlink():
            raise SystemExit(f"Symlinks are not permitted in the generated bundle: {relative}")
        if not path.is_file():
            continue
        if relative.parts[0] not in allowed and relative != icon and not (len(relative.parts) == 1 and relative.name.startswith("THIRD_PARTY")):
            raise SystemExit(f"Unexpected bundle entry: {relative}")
        if relative.parts[0] == "assets" and relative.parts[1] != "buddy-codec" and relative != icon:
            raise SystemExit(f"Original source artwork must remain on main: {relative}")
        if any(part in {".git", ".env", "node_modules", "outputs", "previews", "__pycache__"} for part in relative.parts):
            raise SystemExit(f"Forbidden bundle entry: {relative}")
        if path.suffix.lower() in {".blend", ".mov", ".mp4", ".webm", ".pyc"}:
            raise SystemExit(f"Source media must remain on main: {relative}")
        if relative.parts[:2] == (".claude-plugin", "types"):
            raise SystemExit("Locally generated Claude SDK declarations must not be published")
        files.append((path, relative))

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
    })
    (output / "README.md").write_text(
        f"# Buddy by STH · {version}\n\n"
        "This branch contains the generated distribution. Source code and original artwork remain on "
        f"[main](https://github.com/{REPOSITORY}/tree/main).\n\n"
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
