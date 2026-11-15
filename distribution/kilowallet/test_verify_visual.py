import copy
import json
import unittest
from pathlib import Path
from verify_visual import validate_manual

REVIEW = json.loads(Path(__file__).with_name("visual-review.json").read_text())

class ManualGate(unittest.TestCase):
    def good(self):
        return copy.deepcopy(REVIEW)

    def test_complete(self):
        value = self.good()
        validate_manual(value, value["imageHashes"])

    def test_missing_each_field(self):
        for key in self.good():
            value = self.good()
            del value[key]
            with self.subTest(key=key), self.assertRaises((AssertionError, KeyError)):
                validate_manual(value, value.get("imageHashes", {}))

    def test_changed_pixels_or_file_set(self):
        value = self.good()
        first = next(iter(value["imageHashes"]))
        for hashes in [
            dict(value["imageHashes"], **{first: "f" * 64}),
            {k: v for k, v in value["imageHashes"].items() if k != first},
        ]:
            with self.assertRaises(AssertionError):
                validate_manual(value, hashes)

    def test_unreviewed_or_non_synthetic_rejected(self):
        changes = {
            "allImagesReviewed": False,
            "glyphsComplete": False,
            "approvedForSigning": False,
            "syntheticOnly": False,
            "realTransaction": True,
            "physicalPhoneTested": True,
            "layoutOrClippingBlockers": ["clipped"],
        }
        for key, bad in changes.items():
            value = self.good()
            value[key] = bad
            with self.subTest(key=key), self.assertRaises(AssertionError):
                validate_manual(value, value["imageHashes"])

    def test_wrong_identity_rejected(self):
        for key in [
            "sourceCommit",
            "run",
            "attempt",
            "artifactId",
            "artifactSha256",
            "joinBlaketFrames",
        ]:
            value = self.good()
            value[key] = "wrong"
            with self.subTest(key=key), self.assertRaises(AssertionError):
                validate_manual(value, value["imageHashes"])

    def test_unallowlisted_duplicate_rejected(self):
        value = self.good()
        names = ["02-history.png", "03-create.png"]
        value["imageHashes"][names[1]] = value["imageHashes"][names[0]]
        with self.assertRaises(AssertionError):
            validate_manual(value, value["imageHashes"])

    def test_duplicate_allowlist_tamper_rejected(self):
        for mutate in ("files", "reason"):
            value = self.good()
            if mutate == "files":
                value["duplicateImageAllowlist"][0]["files"][1] = "02-history.png"
            else:
                value["duplicateImageAllowlist"][0]["reason"] = "generic duplicate"
            with self.subTest(mutate=mutate), self.assertRaises(AssertionError):
                validate_manual(value, value["imageHashes"])

if __name__ == "__main__":
    unittest.main()
