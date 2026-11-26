import copy
import io
import stat
import unittest
import zipfile
from unittest.mock import patch

from fetch_archive import ARTIFACT_ID, OUTER_DIGEST, COMMIT, NAME, REPO, RUN, WORKFLOW, artifact, checked_members
from sign_archive import APP_ID, BUNDLE, check_app, check_apple


class CandidateTests(unittest.TestCase):
    def test_archive_origin(self):
        repository = {"full_name": REPO}
        run = {"id": RUN, "run_attempt": 1, "head_sha": COMMIT, "repository": repository,
               "head_repository": repository, "event": "workflow_dispatch", "workflow_id":429494744, "head_branch":"qa/kilobot-external-build-6", "path": WORKFLOW,
               "status": "completed", "conclusion": "success"}
        entry = {"id": ARTIFACT_ID, "name": NAME, "digest": OUTER_DIGEST, "expired": False,
                 "workflow_run": {"id": RUN, "head_sha": COMMIT}}
        listing = {"total_count": 1, "artifacts": [entry]}
        self.assertEqual(artifact(run, listing), entry)
        for key, value in (("head_sha", "other"), ("run_attempt", 2), ("conclusion", "failure"),
                           ("head_repository", {"full_name": "fork"})):
            with self.subTest(key=key), self.assertRaises(ValueError):
                artifact(dict(run, **{key: value}), listing)
        changed = copy.deepcopy(listing)
        changed["artifacts"][0]["workflow_run"]["id"] = 543
        with self.assertRaises(ValueError):
            artifact(run, changed)

    def test_unsafe_archive_paths(self):
        for name, mode in (("../outside", 0), ("/absolute", 0), ("KilobotQA.xcarchive/link", stat.S_IFLNK)):
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(), "w") as archive:
                item = zipfile.ZipInfo(name)
                item.external_attr = mode << 16
                archive.writestr(item, "content")
                with self.assertRaises(ValueError):
                    checked_members(archive)

    def test_app_identity(self):
        info = {"CFBundleIdentifier": BUNDLE, "CFBundleDisplayName": "Kilobot QA",
                "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "6",
                "CFBundleExecutable": "Kilowallet", "CFBundleSupportedPlatforms": ["iPhoneOS"],
                "ITSAppUsesNonExemptEncryption": False, "DTSDKName": "iphoneos26.5"}
        check_app(info)
        for field, value in (("CFBundleIdentifier", "com.kilombino.kilowallet"),
                             ("CFBundleVersion", "30"), ("DTSDKName", "iphonesimulator26.5")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                check_app(dict(info, **{field: value}))

    def test_duplicate_build(self):
        app = {"data": {"id": APP_ID, "attributes": {"bundleId": BUNDLE}}}
        with patch("sign_archive.get", side_effect=[app, {"data": []}]):
            check_apple()
        with patch("sign_archive.get", side_effect=[app, {"data": [{"attributes": {"version": "6"}}]}]):
            with self.assertRaisesRegex(ValueError, "already in use"):
                check_apple()
