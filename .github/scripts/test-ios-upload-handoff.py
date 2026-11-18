#!/usr/bin/env python3
import copy
from pathlib import Path
import runpy
import unittest


link = runpy.run_path(str(Path(__file__).with_name("link-ios-upload-receipt.py")))["link_receipts"]


class UploadHandoffTests(unittest.TestCase):
    def setUp(self):
        self.source, self.orchestration = "a" * 40, "b" * 40
        self.package = {
            "ipaSha256": "c" * 64, "sourceCommit": self.source, "publicSourceCommit": self.source,
            "orchestrationCommit": self.orchestration, "productionTreeSha256": "d" * 64,
            "productionPathCount": 25, "signatureVerification": "passed", "sourceMappingVerification": "passed",
            "lightningNetwork": "mainnet", "bundles": [{"bundleId": "com.example.fixture", "build": "41"}],
            "qualification": {"sourceCommit": self.source, "gates": [{"id": 31, "runAttempt": 2}], "verifiedAt": "later"},
        }
        self.signed = copy.deepcopy(self.package)
        self.signed["sourceRunId"] = "71"
        self.signed["qualification"]["verifiedAt"] = "earlier"

    def verify(self, signing="71", upload="72"):
        return link(self.signed, self.package, signing, upload, self.source, self.orchestration)

    def test_separate_and_combined_dispatches_record_actual_runs(self):
        for upload in ("71", "72"):
            with self.subTest(upload=upload):
                result = self.verify(upload=upload)
                self.assertEqual((result["sourceRunId"], result["uploadRunId"]), ("71", upload))
                self.assertEqual(result["qualification"], self.package["qualification"])

    def test_refuses_wrong_run_and_different_package(self):
        with self.assertRaisesRegex(ValueError, "different run"):
            self.verify(signing="70")
        for field, wrong in (("ipaSha256", "e" * 64), ("sourceCommit", "e" * 40),
                             ("orchestrationCommit", "f" * 40), ("bundles", []), ("lightningNetwork", "regtest")):
            other = {**self.signed, field: wrong}
            with self.subTest(field=field), self.assertRaises(ValueError):
                link(other, self.package, "71", "72", self.source, self.orchestration)

    def test_requalification_or_missing_proof_blocks_upload(self):
        self.package["qualification"]["gates"][0]["runAttempt"] = 3
        with self.assertRaisesRegex(ValueError, "gate attempts"):
            self.verify()
        self.package["qualification"]["gates"] = []
        self.signed["qualification"]["gates"] = []
        with self.assertRaisesRegex(ValueError, "gate attempts"):
            self.verify()
        del self.package["signatureVerification"]
        with self.assertRaises(KeyError):
            self.verify()


if __name__ == "__main__":
    unittest.main()
