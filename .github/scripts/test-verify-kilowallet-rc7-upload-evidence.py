import copy
import hashlib
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("evidence", Path(__file__).with_name("verify-kilowallet-rc7-upload-evidence.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class UploadEvidence(unittest.TestCase):
    def attempt(self):
        repo = {"full_name": m.REPO}
        run = dict(repository=repo, head_repository=repo, id=m.RUN, head_sha=m.HEAD,
                   head_branch="main", event="workflow_dispatch", path=".github/workflows/build-kilowallet.yml",
                   status="completed", conclusion="failure", run_attempt=1)
        jobs = [dict(name=n, id=i, run_id=m.RUN, head_sha=m.HEAD, run_attempt=1,
                     status="completed", conclusion="failure" if n == "sign" else "success") for n, i in m.JOBS.items()]
        jobs[-1]["steps"] = [dict(number=n, name=m.REQUIRED_STEPS.get(n, "Other successful step"),
                                 status="completed", conclusion="failure" if n == 21 else "success")
                              for n in list(range(1, 24)) + [44, 45, 46, 47]]
        return run, jobs

    def test_only_original_processing_timeout_accepted(self):
        self.assertEqual(m.validate_attempt(*self.attempt())["jobId"], m.JOBS["sign"])

    def test_replayed_or_foreign_run_rejected(self):
        for key, value in [("id", m.RUN + 1), ("head_sha", "foreign"), ("head_branch", "other"),
                           ("run_attempt", 2), ("event", "pull_request"), ("status", "in_progress"),
                           ("conclusion", "success"), ("path", ".github/workflows/other.yml"),
                           ("head_repository", {"full_name": "other/repo"}), ("repository", {"full_name": "other/repo"})]:
            run, jobs = self.attempt()
            run[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.validate_attempt(run, jobs)

    def test_missing_duplicate_or_replaced_job_rejected(self):
        for mutation in [lambda j: j.pop(), lambda j: j.append(copy.deepcopy(j[0])),
                         lambda j: j[0].update(id=1), lambda j: j[0].update(run_id=1),
                         lambda j: j[0].update(head_sha="other"), lambda j: j[0].update(run_attempt=2),
                         lambda j: j[0].update(conclusion="failure"), lambda j: j[-1].update(conclusion="success")]:
            run, jobs = self.attempt()
            mutation(jobs)
            with self.assertRaises(RuntimeError):
                m.validate_attempt(run, jobs)

    def test_every_nonprocessing_step_must_succeed(self):
        for step in self.attempt()[1][-1]["steps"]:
            if step["number"] == 21:
                continue
            for bad in ["failure", "cancelled", "skipped", ""]:
                run, jobs = self.attempt()
                next(s for s in jobs[-1]["steps"] if s["number"] == step["number"])["conclusion"] = bad
                with self.subTest(step=step["number"], conclusion=bad), self.assertRaises(RuntimeError):
                    m.validate_attempt(run, jobs)

    def test_missing_duplicate_and_renamed_steps_rejected(self):
        for mutation in [lambda s: s.pop(19), lambda s: s.append(copy.deepcopy(s[19])),
                         lambda s: s[19].update(name="Other upload"), lambda s: s[20].update(name="Other failure"),
                         lambda s: s[20].update(conclusion="success"), lambda s: s[19].update(status="in_progress")]:
            run, jobs = self.attempt()
            mutation(jobs[-1]["steps"])
            with self.assertRaises(RuntimeError):
                m.validate_attempt(run, jobs)

    def archive(self, extra=False):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as z:
            z.writestr("receipt.json", b'{"synthetic":true}')
            if extra:
                z.writestr("unexpected.json", b'{}')
        raw = data.getvalue()
        digest = hashlib.sha256(raw).hexdigest()
        meta = dict(id=m.ARTIFACT, name="kilowallet-release-verification", expired=False,
                    workflow_run={"id": m.RUN, "head_sha": m.HEAD}, digest="sha256:" + digest)
        members = {"receipt.json": hashlib.sha256(b'{"synthetic":true}').hexdigest()}
        return meta, raw, digest, members

    def test_artifact_and_member_digests_verified(self):
        meta, raw, digest, members = self.archive()
        with patch.object(m, "ZIP_SHA", digest), patch.object(m, "MEMBERS", members):
            self.assertTrue(m.validate_archive(meta, raw)["receipt.json"]["synthetic"])
            with self.assertRaises(RuntimeError):
                m.validate_archive(meta, raw + b"tampered")
            with patch.object(m, "MEMBERS", {"receipt.json": "0" * 64}), self.assertRaises(RuntimeError):
                m.validate_archive(meta, raw)

    def test_foreign_expired_or_extra_artifact_rejected(self):
        for key, value in [("id", 1), ("name", "wrong"), ("expired", True), ("digest", "sha256:wrong"),
                           ("workflow_run", {"id": 1, "head_sha": m.HEAD}),
                           ("workflow_run", {"id": m.RUN, "head_sha": "foreign"})]:
            meta, raw, digest, members = self.archive()
            meta[key] = value
            with patch.object(m, "ZIP_SHA", digest), patch.object(m, "MEMBERS", members), self.assertRaises(RuntimeError):
                m.validate_archive(meta, raw)
        meta, raw, digest, members = self.archive(extra=True)
        with patch.object(m, "ZIP_SHA", digest), patch.object(m, "MEMBERS", members), self.assertRaises(RuntimeError):
            m.validate_archive(meta, raw)

    def test_evidence_never_claims_processing_or_distribution(self):
        package = dict(sourceCommit=m.SOURCE, orchestrationCommit=m.HEAD, ipaSha256=m.IPA,
                       runId=str(m.RUN), runAttempt="1", version="1.0.0", build="30",
                       bundle="com.kilombino.kilowallet", team="PPG9C98EY9", signature="verified",
                       sdk="iphoneos26.2", usesNonExemptEncryption=False)
        result = m.summarize({"kilowallet-package-verification.json": package}, m.validate_attempt(*self.attempt()))
        for key in ["processingVerified", "testerMembershipVerified", "currentNativeGatesVerified", "readyForDistribution"]:
            self.assertIs(result[key], False)
        self.assertEqual(result["originalRunConclusion"], "failure")
        self.assertNotIn("appleBuildId", result)
        self.assertNotIn("uploadVerified", result)
        self.assertEqual(result["writes"], [])
        for key, value in [("sourceCommit", "other"), ("ipaSha256", "other"), ("build", "21"),
                           ("usesNonExemptEncryption", 0), ("usesNonExemptEncryption", None),
                           ("signature", "unsigned")]:
            bad = dict(package, **{key: value})
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.summarize({"kilowallet-package-verification.json": bad}, {})


if __name__ == "__main__":
    unittest.main()
