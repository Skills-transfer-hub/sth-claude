#!/usr/bin/env python3
"""Publish only the generated compact branch; requires explicit --publish."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

BRANCH = "codex/directory-release"
REMOTE = "https://github.com/Skills-transfer-hub/sth-claude.git"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--tree", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    root, tree = args.source_root.resolve(), args.tree.resolve()
    info = json.loads((tree / "release.json").read_text())

    def git(*values: str, env: dict | None = None) -> str:
        return subprocess.check_output(["git", "-C", str(root), *values], env=env, text=True).strip()

    origin = git("remote", "get-url", "origin")
    if origin.removesuffix(".git") != REMOTE.removesuffix(".git"):
        raise SystemExit("Refusing to publish through an unexpected origin")
    if info["sourceCommit"] != git("rev-parse", "HEAD"):
        raise SystemExit("Source HEAD changed after staging")
    version = tuple(int(part) for part in info["version"].split("."))
    ref = f"refs/heads/{BRANCH}"
    refs = git("ls-remote", "--heads", "origin", ref)
    previous = refs.split()[0] if refs else None
    if not args.publish:
        print(json.dumps({"dryRun": True, "branch": BRANCH, "version": info["version"], "sourceCommit": info["sourceCommit"], "previousReleaseCommit": previous}))
        return
    if previous:
        git("fetch", "--no-tags", "--depth=1", "origin", ref)
        if git("rev-parse", "FETCH_HEAD") != previous:
            raise SystemExit("Release branch changed during preflight; retry the workflow")
        old = json.loads(git("show", f"{previous}:release.json"))
        old_version = tuple(int(part) for part in old["version"].split("."))
        if old_version == version:
            print(f"Version {info['version']} is already published; bump plugin.json to ship another release.")
            return
        if old_version > version:
            raise SystemExit("Refusing to publish a version older than the current compact release")
    with tempfile.TemporaryDirectory(prefix="sth-release-index-") as temporary:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(temporary) / "index"),
                   GIT_AUTHOR_NAME="github-actions[bot]", GIT_COMMITTER_NAME="github-actions[bot]",
                   GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com",
                   GIT_COMMITTER_EMAIL="41898282+github-actions[bot]@users.noreply.github.com")
        git("read-tree", "--empty", env=env)
        git(f"--work-tree={tree}", "add", "--all", env=env)
        staged = git("write-tree", env=env)
        parents = ["-p", previous] if previous else []
        commit = git("commit-tree", staged, *parents, "-m", f"Release Buddy by STH {info['version']} from {info['sourceCommit'][:12]}", env=env)
        # Ordinary fast-forward push: never force, never update main.
        git("push", "origin", f"{commit}:{ref}")
        print(json.dumps({"version": info["version"], "releaseCommit": commit, "sourceCommit": info["sourceCommit"], "branch": BRANCH}))


if __name__ == "__main__":
    main()
