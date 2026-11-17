import hashlib
import json
import unittest
from verify_rc7_preparation import SOURCE, validate_visual_binding

class VisualBinding(unittest.TestCase):
    def test_review_digest_and_approval_bound(self):
        raw = json.dumps({"sourceCommit": SOURCE, "approvedForSigning": True}).encode()
        preparation = {"visualReviewSha256": hashlib.sha256(raw).hexdigest()}
        self.assertTrue(validate_visual_binding(preparation, raw))
        for altered in (raw+b" ", raw.replace(b"true", b"false")):
            with self.assertRaisesRegex(RuntimeError, "digest"):
                validate_visual_binding(preparation, altered)

    def test_matching_hash_cannot_approve_incomplete_or_wrong_source(self):
        for manual in [{"sourceCommit": SOURCE, "approvedForSigning": False},
                       {"sourceCommit": "0"*40, "approvedForSigning": True}]:
            raw = json.dumps(manual).encode()
            with self.assertRaisesRegex(RuntimeError, "not approved"):
                validate_visual_binding({"visualReviewSha256": hashlib.sha256(raw).hexdigest()}, raw)

    def test_missing_review_digest_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "digest"):
            validate_visual_binding({}, b"{}")
