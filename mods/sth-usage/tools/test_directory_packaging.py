"""Regression checks for immutable hosted and self-contained Buddy bundles.

Run with the same Python environment as build_directory_bundle.py:
  python tools/test_directory_packaging.py
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import zipfile

from PIL import Image

import build_directory_bundle as build
import stage_directory_release as stage


class HostedPackagingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sth-hosted-packaging-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "source"
        self.source = self.repo / "mods/sth-usage"
        self.bundle = self.root / "bundle/sth-usage"
        self.data = self.bundle / "assets/buddy-codec"
        self.index = {"format": build.FORMAT, "codec": "zlib-rgba-subtract", "keyframeInterval": 30, "sequences": {}}
        for name in build.EXPECTED_SEQUENCES:
            packet = build.json_bytes({"format": build.FORMAT, "sequence": name, "frames": []})
            path = self.data / name / "0000.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(packet)
            self.index["sequences"][name] = {"chunks": [{"path": f"{name}/0000.json", "bytes": len(packet), "sha256": build.digest(packet)}]}
            if name != "fika":
                # The packaging contract preserves the entire original file,
                # including bytes which a decoder could otherwise discard.
                original = self.source / f"assets/frames/{name}/000.png"
                original.parent.mkdir(parents=True, exist_ok=True)
                original.write_bytes(b"\x89PNG\r\n\x1a\n" + name.encode() + bytes(range(256)))
        build.write_json(self.data / "index.json", self.index)
        commit = "a" * 40
        self.config = {"format": "sth-buddy-assets-source-v1", "commit": commit,
                       "id": build.digest(build.json_bytes(self.index)),
                       "baseUrl": f"https://raw.githubusercontent.com/Skills-transfer-hub/sth-claude/{commit}/mods/sth-usage/assets/buddy-codec/"}
        build.write_json(self.source / build.ASSET_SOURCE_FILE, self.config)

    def externalize(self) -> dict:
        metadata = build.externalize_assets(self.source, self.data, self.index, self.config)
        return {"assetDelivery": "hosted", "hostedAssetSource": metadata}

    def test_hosted_bundle_contains_only_manifest_and_exact_initial_poses(self) -> None:
        receipt = self.externalize()
        self.assertEqual(list(self.data.rglob("*.json")), [self.data / "remote.json"])
        expected = stage.validate_asset_tree(self.repo, self.bundle, receipt)
        actual = {path.relative_to(self.bundle) for path in (self.bundle / "assets").rglob("*") if path.is_file()}
        self.assertEqual(actual, expected)
        self.assertEqual(receipt["hostedAssetSource"]["packetCount"], 7)

    def test_changed_asset_index_cannot_reuse_an_older_host(self) -> None:
        altered = copy.deepcopy(self.index)
        altered["keyframeInterval"] = 15
        with self.assertRaisesRegex(ValueError, "differ from the pinned"):
            build.externalize_assets(self.source, self.data, altered, self.config)
        self.assertTrue((self.data / "index.json").is_file())
        self.assertFalse((self.data / "remote.json").exists())

    def test_corrupt_packet_prevents_externalization(self) -> None:
        (self.data / "ok/0000.json").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Packet differs"):
            self.externalize()

    def test_unexpected_packet_prevents_externalization(self) -> None:
        (self.data / "unexpected.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "tree differs"):
            self.externalize()

    def test_mutable_branch_asset_url_is_rejected(self) -> None:
        changed = {**self.config, "baseUrl": self.config["baseUrl"].replace("a" * 40, "main")}
        build.write_json(self.source / build.ASSET_SOURCE_FILE, changed)
        with self.assertRaisesRegex(ValueError, "pin a GitHub commit"):
            build.hosted_asset_source(self.source, [Path(build.ASSET_SOURCE_FILE)])

    def test_altered_bootstrap_or_receipt_cannot_be_staged(self) -> None:
        receipt = self.externalize()
        altered_receipt = copy.deepcopy(receipt)
        altered_receipt["hostedAssetSource"]["packetBytes"] += 1
        with self.assertRaisesRegex(SystemExit, "receipt differs"):
            stage.validate_asset_tree(self.repo, self.bundle, altered_receipt)
        (self.bundle / "assets/bootstrap/ok.png").write_bytes(b"different pixels")
        with self.assertRaisesRegex(SystemExit, "exact original PNG"):
            stage.validate_asset_tree(self.repo, self.bundle, receipt)

    def test_altered_host_or_manifest_cannot_be_staged(self) -> None:
        receipt = self.externalize()
        remote = json.loads((self.data / "remote.json").read_text())
        remote["remote"]["baseUrl"] = "https://example.com/"
        build.write_json(self.data / "remote.json", remote)
        with self.assertRaisesRegex(SystemExit, "does not match"):
            stage.validate_asset_tree(self.repo, self.bundle, receipt)

    def test_embedded_bundle_hashes_every_shipped_packet(self) -> None:
        receipt = {"assetDelivery": "embedded", "hostedAssetSource": None}
        self.assertEqual(len(stage.validate_asset_tree(self.repo, self.bundle, receipt)), 8)
        (self.data / "fika/0000.json").write_text("changed")
        with self.assertRaisesRegex(SystemExit, "packet differs"):
            stage.validate_asset_tree(self.repo, self.bundle, receipt)


class ReleaseBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sth-release-boundary-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.bundle = self.root / "bundle"
        self.contents = {
            ".claude-plugin/plugin.json": b'{"name":"sth-usage","version":"0.3.3"}',
            "README.md": b"Buddy runtime documentation\n",
            "PRIVACY.md": b"Data handling\n",
            "LICENSE": b"MIT\n",
            "THIRD_PARTY_NOTICES.md": b"Decoder notice\n",
            "hooks/hooks.json": b'{"modules":["./register.tsx"]}',
            "hooks/register.tsx": b"export default function register(on) { on('session.start', () => {}) }\n",
            "hooks/buddy-codec.ts": b"export const pixelDecoder = true\n",
            "hooks/vendor/inflate.js": b"export const inflate = true\n",
            "ui/buddy.ts": b"export default ['original pixels']\n",
            "types/index.d.ts": b"export type Buddy = string\n",
            "tests/activity.test.ts": b"on('classic.PreToolUse', () => fakeResult)\n",
            "tests/fixtures/mock-tool.ts": b"export const mockToolCall = 'test-only-call'\n",
        }
        for name, contents in self.contents.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
        self.tracked = [Path(name) for name in self.contents]

    def test_ci_bundle_retains_tests_but_published_files_and_archive_are_production_only(self) -> None:
        build.copy_runtime(self.source, self.bundle, self.tracked, include_tests=True)
        production = stage.release_files(self.bundle, set(), None)
        expected = {Path(name) for name in self.contents if not name.startswith("tests/")}
        self.assertEqual({relative for _, relative in production}, expected)
        archive = self.root / "release.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for path, relative in production:
                output.write(path, relative.as_posix())
        with zipfile.ZipFile(archive) as output:
            self.assertEqual(set(output.namelist()), {path.as_posix() for path in expected})
            self.assertFalse(any(b"classic.PreToolUse" in output.read(name) for name in output.namelist()))
            for name in output.namelist():
                self.assertEqual(output.read(name), self.contents[name])
        # Filtering must not delete source tests or the bundle CI actually ran.
        for name, contents in self.contents.items():
            self.assertEqual((self.source / name).read_bytes(), contents)
            self.assertEqual((self.bundle / name).read_bytes(), contents)

    def test_staging_rejects_a_bundle_built_without_regression_tests(self) -> None:
        build.copy_runtime(self.source, self.bundle, self.tracked, include_tests=False)
        self.assertFalse((self.bundle / "tests").exists())
        with self.assertRaisesRegex(SystemExit, "must include its regression tests"):
            stage.release_files(self.bundle, set(), None)

    def test_excluded_test_directory_still_receives_bundle_safety_checks(self) -> None:
        build.copy_runtime(self.source, self.bundle, self.tracked, include_tests=True)
        (self.bundle / "tests/fixtures/unexpected-link").symlink_to(self.source / "README.md")
        with self.assertRaisesRegex(SystemExit, "Symlinks are not permitted"):
            stage.release_files(self.bundle, set(), None)


class ReviewSourceTests(ReleaseBoundaryTests):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.root.resolve() / "repository"
        self.repo.mkdir()
        relocated = self.repo / "mods/sth-usage"
        relocated.parent.mkdir()
        self.source.rename(relocated)
        self.source = relocated
        for name in build.REVIEW_TOOLS:
            path = self.source / "tools" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# readable build input\n")
        for name in build.REVIEW_VENDOR:
            path = self.source / "review-source/fflate" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// readable decoder input\n")
        model = self.source / "assets/model/buddy-v6.blend"
        model.parent.mkdir(parents=True)
        model.write_bytes(b"BLENDER-original-review-model")
        self.frame = self.source / "assets/frames/ok/000.png"
        self.frame.parent.mkdir(parents=True)
        Image.new("RGBA", (2, 2), (120, 90, 60, 255)).save(self.frame)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=Packaging test", "-c", "user.email=packaging@example.invalid",
                        "commit", "-qm", "Source fixture"], check=True)
        _, self.tracked = build.tracked_files(self.source)

    def reviewed_bundle(self) -> dict:
        build.copy_runtime(self.source, self.bundle, self.tracked, include_tests=True)
        with patch.object(build, "source_sequences", return_value=[("ok", [self.frame])]):
            return {"reviewSources": build.copy_review_sources(self.source, self.bundle, self.repo, self.tracked)}

    def test_exact_review_sources_survive_production_filter(self) -> None:
        receipt = self.reviewed_bundle()
        stage.validate_review_sources(self.repo, self.bundle, receipt)
        production = {relative for _, relative in stage.release_files(self.bundle, set(), None)}
        self.assertIn(Path("review-source/fflate/browser.js"), production)
        self.assertIn(Path("review-source/tools/build_directory_bundle.py"), production)
        self.assertIn(Path("review-source/artwork/buddy-v6.blend"), production)
        manifest = json.loads((self.bundle / "review-source/source-manifest.json").read_text())
        self.assertEqual(manifest["originalFrameFiles"][0]["sha256"], build.digest(self.frame.read_bytes()))
        self.assertFalse(any(entry["path"].startswith("tests/") for entry in manifest["includedFiles"]))

    def test_modified_source_payload_is_rejected_even_with_a_self_reported_hash(self) -> None:
        receipt = self.reviewed_bundle()
        relative = "review-source/fflate/browser.js"
        (self.bundle / relative).write_text("altered decoder source")
        path = self.bundle / "review-source/source-manifest.json"
        manifest = json.loads(path.read_text())
        next(entry for entry in manifest["includedFiles"] if entry["path"] == relative)["sha256"] = build.digest((self.bundle / relative).read_bytes())
        build.write_json(path, manifest)
        with self.assertRaisesRegex(SystemExit, "differs from its original"):
            stage.validate_review_sources(self.repo, self.bundle, receipt)

    def test_missing_source_or_frame_fingerprint_is_rejected(self) -> None:
        receipt = self.reviewed_bundle()
        (self.bundle / "review-source/fflate/entry.js").unlink()
        with self.assertRaisesRegex(SystemExit, "allowed source payload"):
            stage.validate_review_sources(self.repo, self.bundle, receipt)

    def test_untracked_build_inputs_must_be_explicitly_staged(self) -> None:
        tracked = [path for path in self.tracked if path != Path("review-source/fflate/browser.js")]
        with self.assertRaisesRegex(FileNotFoundError, "required review sources"):
            build.copy_review_sources(self.source, self.bundle, self.repo, tracked)


class ReviewableFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sth-review-files-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_image_extension_must_match_the_decoded_format(self) -> None:
        Image.new("RGBA", (2, 2)).save(self.root / "correct.png")
        build.validate_reviewable_files(self.root)
        Image.new("RGB", (2, 2)).save(self.root / "wrong.png", format="JPEG")
        with self.assertRaisesRegex(ValueError, "format does not match"):
            build.validate_reviewable_files(self.root)

    def test_script_limits_and_readable_text(self) -> None:
        script = self.root / "module.js"
        for contents, message in ((b"x" * build.MAX_SCRIPT_BYTES, "smaller than 1 MiB"),
                                  (b"\xff", "UTF-8"), (b"hello\x00world", "NUL")):
            script.write_bytes(contents)
            with self.assertRaisesRegex(ValueError, message):
                build.validate_reviewable_files(self.root)
        script.write_text("export const readable = true\n")
        build.validate_reviewable_files(self.root)


if __name__ == "__main__":
    unittest.main()
