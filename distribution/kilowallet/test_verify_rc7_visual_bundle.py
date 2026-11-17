import copy
import hashlib
import io
import json
import struct
import unittest
from unittest.mock import patch
import warnings
import zipfile
from pathlib import Path

from verify_rc7_visual_bundle import (PRODUCT_ROOTS, RPC_IMAGES, validate_manifest, validate_remote,
                                      validate_product_trees, verify_archive, verify_bundle)

PENDING = json.loads(Path(__file__).with_name("rc7-visual-review.json").read_text())


def archive_fixture(dimensions=(1290, 2796), names=("09-ln-starting.png",)):
    # Minimal PNG header bytes are sufficient for the dimension/hash gate.
    data = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", *dimensions)
    stream = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(stream, "w") as archive:
            for name in names:
                archive.writestr(name, data)
    raw = stream.getvalue()
    return raw, {"artifactSha256": hashlib.sha256(raw).hexdigest(),
                 "imageHashes": {name: hashlib.sha256(data).hexdigest() for name in names}}


class RC7VisualTests(unittest.TestCase):
    def reviewed(self):
        value = copy.deepcopy(PENDING)
        value.update(approvedForSigning=True, blockers=[])
        value["evidence"]["rpc"].update(
            artifactId=123, artifactSha256="a" * 64, reviewed=True, glyphsComplete=True,
            layoutOrClippingBlockers=[], reviewedAt="synthetic-test-only",
            imageHashes={name: hashlib.sha256(name.encode()).hexdigest() for name in sorted(RPC_IMAGES)})
        return value

    def test_complete_review_shape(self):
        self.assertEqual(set(validate_manifest(self.reviewed())), {"native", "startup", "rpc"})

    def test_current_unreviewed_preparation_stays_blocked(self):
        value = self.reviewed()
        value["approvedForSigning"] = False
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            validate_manifest(value)

    def test_approval_cannot_hide_missing_rpc_artifact(self):
        value = copy.deepcopy(PENDING)
        value.update(approvedForSigning=True, blockers=[])
        value["evidence"]["rpc"]["artifactId"] = None
        with self.assertRaises(RuntimeError):
            validate_manifest(value)

    def test_each_source_attempt_or_role_change_rejected(self):
        for role in PENDING["evidence"]:
            for key, wrong in [("run", 1), ("sourceCommit", "0" * 40), ("attempt", 2),
                               ("event", "push"), ("reviewed", False), ("artifactId", None),
                               ("excludedImages", ["02-history.png"])]:
                value = self.reviewed()
                value["evidence"][role][key] = wrong
                with self.subTest(role=role, key=key), self.assertRaises(RuntimeError):
                    validate_manifest(value)

    def test_missing_rpc_state_or_reused_pixels_rejected(self):
        for duplicate in (False, True):
            value = self.reviewed()
            hashes = value["evidence"]["rpc"]["imageHashes"]
            if duplicate:
                hashes["78-rpc-cert.png"] = hashes["77-rpc-settings.png"]
            else:
                hashes.pop("78-rpc-cert.png")
            with self.assertRaises(RuntimeError):
                validate_manifest(value)

    def test_missing_role_attribution_or_physical_claim_rejected(self):
        for mutation in ("role", "attribution", "physical"):
            value = self.reviewed()
            if mutation == "role":
                value["evidence"].pop("startup")
            elif mutation == "attribution":
                value["diagnosticLimitations"] = "Production qualified"
            else:
                value["physicalPhoneQualified"] = True
            with self.assertRaises(RuntimeError):
                validate_manifest(value)

    def test_archive_bytes_and_reviewed_pixels_bound(self):
        raw, item = archive_fixture()
        self.assertEqual(verify_archive(raw, item), item["imageHashes"])
        with self.assertRaisesRegex(RuntimeError, "ZIP digest"):
            verify_archive(raw + b"changed", item)
        item["imageHashes"]["09-ln-starting.png"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "pixels"):
            verify_archive(raw, item)

    def test_wrong_dimensions_or_duplicate_zip_entries_rejected(self):
        for raw, item in [archive_fixture((1179, 2556)),
                          archive_fixture(names=("09-ln-starting.png", "09-ln-starting.png"))]:
            with self.assertRaises(RuntimeError):
                verify_archive(raw, item)

    def test_zip_file_set_must_match_review(self):
        raw, item = archive_fixture(names=("09-ln-starting.png", "extra.png"))
        item["imageHashes"].pop("extra.png")
        with self.assertRaisesRegex(RuntimeError, "missing screenshot"):
            verify_archive(raw, item)

    def test_remote_current_attempt_and_artifact_binding(self):
        item = self.reviewed()["evidence"]["startup"]
        run = {"id": item["run"], "run_attempt": 1, "event": item["event"]}
        artifact = {"id": item["artifactId"], "name": "screenshots", "expired": False,
                    "digest": "sha256:" + item["artifactSha256"],
                    "workflow_run": {"id": item["run"], "head_sha": item["sourceCommit"]}}
        validate_remote(run, artifact, item)
        for key, wrong in [("expired", True), ("digest", "sha256:wrong"), ("id", 1),
                           ("workflow_run", {"id": 1, "head_sha": item["sourceCommit"]}),
                           ("workflow_run", {"id": item["run"], "head_sha": "0" * 40})]:
            bad = dict(artifact, **{key: wrong})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                validate_remote(run, bad, item)
        with self.assertRaisesRegex(RuntimeError, "Stale"):
            validate_remote(dict(run, run_attempt=2), artifact, item)

    def test_rejected_startup_pixels_cannot_be_reused(self):
        value = self.reviewed()
        value["evidence"]["startup"]["imageHashes"]["09-ln-starting.png"] = value["evidence"]["native"]["imageHashes"]["09-ln-starting.png"]
        with self.assertRaisesRegex(RuntimeError, "Rejected startup frame reused"):
            validate_manifest(value)

    def test_product_provenance_rejects_changed_startup_or_native_rpc_code(self):
        candidate = {name: hashlib.sha1(name.encode()).hexdigest() for name in PRODUCT_ROOTS}
        rpc = dict(candidate, app="f" * 40)
        self.assertTrue(validate_product_trees(candidate, candidate, rpc))
        for role in ("startup", "rpc"):
            for root in PRODUCT_ROOTS:
                if role == "rpc" and root == "app":
                    continue
                bad = dict(candidate, **{root: "0" * 40})
                with self.subTest(role=role, root=root), self.assertRaises(RuntimeError):
                    validate_product_trees(candidate, bad if role == "startup" else candidate,
                                           bad if role == "rpc" else rpc)

    def test_effective_bundle_and_cross_artifact_duplicate(self):
        def fixture(repeat_across_artifacts=False):
            value = self.reviewed()
            archives = {}
            for role, item in value["evidence"].items():
                buffer = io.BytesIO()
                hashes = {}
                with zipfile.ZipFile(buffer, "w") as archive:
                    for name in item["imageHashes"]:
                        identity = role + name
                        if name == "68-pool-create-v6.png":
                            identity = "native22-pool-create.png"
                        if repeat_across_artifacts and name == "77-rpc-settings.png":
                            identity = "native02-history.png"
                        image = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 1290, 2796) + identity.encode()
                        archive.writestr(name, image)
                        hashes[name] = hashlib.sha256(image).hexdigest()
                archives[role] = buffer.getvalue()
                item.update(imageHashes=hashes, artifactSha256=hashlib.sha256(archives[role]).hexdigest())
            pins = {role: (item["artifactId"], item["artifactSha256"])
                    for role, item in value["evidence"].items() if role != "rpc"}
            return value, archives, pins
        value, archives, pins = fixture()
        with patch("verify_rc7_visual_bundle.KNOWN_ARTIFACTS", pins):
            result = verify_bundle(value, archives)
            self.assertEqual(len(result), 79)
            self.assertEqual(result["09-ln-starting.png"], value["evidence"]["startup"]["imageHashes"]["09-ln-starting.png"])
            with self.assertRaisesRegex(RuntimeError, "Missing downloaded"):
                verify_bundle(value, {k: v for k, v in archives.items() if k != "startup"})
        value, archives, pins = fixture(True)
        with patch("verify_rc7_visual_bundle.KNOWN_ARTIFACTS", pins), self.assertRaisesRegex(RuntimeError, "cross-artifact"):
            verify_bundle(value, archives)

    def test_workflow_keeps_independent_gates_in_order(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/build-kilowallet.yml").read_text()
        qualify = workflow.split("  qualify:\n", 1)[1].split("  certificate:\n", 1)[0]
        sign = workflow.split("  sign:\n", 1)[1].split("      - name: Fetch verified", 1)[0]
        for section in (qualify, sign):
            self.assertLess(section.index("verify_rc7_preparation.py"), section.index("verify_gates.py"))
            self.assertLess(section.index("verify_gates.py"), section.index("verify_rc7_visual_bundle.py"))
        self.assertIn("github.event_name == 'workflow_dispatch'", qualify)
        self.assertIn("github.ref == 'refs/heads/main'", qualify)


if __name__ == "__main__":
    unittest.main()
