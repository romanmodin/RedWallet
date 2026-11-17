import copy
import json
import unittest
from pathlib import Path
from verify_rc7_preparation import validate, SOURCE, IOS_RUN, SCREEN_RUN, RPC_RUN, RPC_SOURCE

class ReadinessInterlockTests(unittest.TestCase):
    def setUp(self):
        self.p = {"candidateSource": SOURCE, "readyForSigning": True, "blockers": [],
                  "native": {"sourceCommit": SOURCE, "id": IOS_RUN},
                  "screenshotChecker": {"run": SCREEN_RUN, "source": SOURCE, "verified": True},
                  "rpcVisual": {"run": RPC_RUN, "source": RPC_SOURCE, "verified": True},
                  "startupVisualSupplement": {"candidateSource": SOURCE, "manualVisualApproved": True}}
    def check(self, p=None, source=SOURCE, native=IOS_RUN, checker=SCREEN_RUN):
        return validate(self.p if p is None else p, source, native, checker)
    def test_complete_preparation_clears_only_this_interlock(self):
        self.assertTrue(self.check())
    def test_missing_or_non_boolean_readiness_fails(self):
        for value in (None, False, "true", 1):
            with self.subTest(value=value):
                self.p["readyForSigning"] = value
                with self.assertRaises(RuntimeError): self.check()
    def test_unresolved_or_missing_blockers_fails(self):
        for value in (["RPC pending"], None, ""):
            self.p["blockers"] = value
            with self.assertRaises(RuntimeError): self.check()
    def test_wrong_workflow_or_manifest_source_fails(self):
        with self.assertRaises(RuntimeError): self.check(source="0" * 40)
        self.p["candidateSource"] = "0" * 40
        with self.assertRaises(RuntimeError): self.check()
    def test_other_runs_do_not_substitute(self):
        for kwargs in ({"native": IOS_RUN + 1}, {"checker": SCREEN_RUN + 1}):
            with self.assertRaises(RuntimeError): self.check(**kwargs)
        for section, field in (("native", "id"), ("screenshotChecker", "run"), ("rpcVisual", "run")):
            p = copy.deepcopy(self.p); p[section][field] += 1
            with self.assertRaises(RuntimeError): self.check(p)
    def test_missing_unreviewed_or_wrong_source_evidence_fails(self):
        for section in ("native", "screenshotChecker", "rpcVisual", "startupVisualSupplement"):
            p = copy.deepcopy(self.p); del p[section]
            with self.assertRaises(RuntimeError): self.check(p)
        for section, field in (("screenshotChecker", "verified"), ("rpcVisual", "verified"),
                               ("startupVisualSupplement", "manualVisualApproved")):
            for value in (False, "true", 1):
                p = copy.deepcopy(self.p); p[section][field] = value
                with self.assertRaises(RuntimeError): self.check(p)
        for section in ("screenshotChecker", "rpcVisual"):
            p = copy.deepcopy(self.p); p[section]["source"] = "0" * 40
            with self.assertRaises(RuntimeError): self.check(p)

if __name__ == "__main__":
    unittest.main()
