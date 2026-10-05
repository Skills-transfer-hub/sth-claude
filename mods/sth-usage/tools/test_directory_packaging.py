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


if __name__ == "__main__":
    unittest.main()
