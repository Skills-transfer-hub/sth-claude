#!/usr/bin/env python3
"""Rebuild the existing decoder for comparison; never overwrite runtime code."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import subprocess

HEADER = ("// fflate 0.8.3, unzlibSync export from esm/browser.js.\n"
          "// Copyright (c) 2026 Arjun Barrett. MIT license: LICENSE.fflate.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esbuild", required=True, help="Path to esbuild 0.27.0")
    parser.add_argument("--compare", type=Path, required=True, help="Existing hooks/vendor/inflate.js")
    args = parser.parse_args()
    if subprocess.check_output([args.esbuild, "--version"], text=True).strip() != "0.27.0":
        raise SystemExit("Reproduction requires esbuild 0.27.0")
    root = Path(__file__).resolve().parent
    # The only executable is the explicitly supplied local esbuild. The entry
    # and every option are fixed; there is no shell, download, or output write.
    generated = subprocess.check_output(
        [args.esbuild, "entry.js", "--bundle", "--format=esm", "--tree-shaking=true"],
        cwd=root, text=True)
    if not generated.startswith("// browser.js\n"):
        raise SystemExit("Unexpected esbuild source banner")
    rebuilt = (HEADER + generated.split("\n", 1)[1]).encode()
    if rebuilt != args.compare.read_bytes():
        raise SystemExit("The decoder differs from the pinned source rebuild")
    print("Exact decoder reproduction: " + hashlib.sha256(rebuilt).hexdigest())


if __name__ == "__main__":
    main()
