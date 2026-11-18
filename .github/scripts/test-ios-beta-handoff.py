#!/usr/bin/env python3
import copy
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


module = runpy.run_path(str(Path(__file__).with_name('verify-uploaded-beta.py')))
verify = module['verify_handoff']
scope = verify.__globals__
source, orchestration = module['PUBLIC'], module['ORCHESTRATION']


def job(name, conclusion):
    labels = ('Save signing verification receipt',) if name == 'build' else ('Save package verification receipt', 'Upload to TestFlight')
    return {'name': name, 'status': 'completed', 'conclusion': conclusion,
            'steps': [{'name': label, 'conclusion': conclusion} for label in labels]}


def release(run_id, attempt=1):
    repo = {'full_name': module['REPO']}
    return {'id': int(run_id), 'repository': repo, 'head_repository': repo, 'head_sha': orchestration,
            'path': module['RELEASE_WORKFLOW'], 'event': 'workflow_dispatch', 'head_branch': 'main',
            'status': 'completed', 'conclusion': 'success', 'run_attempt': attempt}


class BetaHandoffTests(unittest.TestCase):
    def setUp(self):
        self.signed = {
            'ipaSha256': 'c' * 64, 'sourceCommit': source, 'publicSourceCommit': source,
            'orchestrationCommit': orchestration, 'productionTreeSha256': 'd' * 64, 'productionPathCount': 25,
            'signatureVerification': 'passed', 'sourceMappingVerification': 'passed', 'lightningNetwork': 'mainnet',
            'bundles': [{'bundleId': 'com.example.test', 'build': '81'}],
            'qualification': {'sourceCommit': source, 'gates': [{'id': 19, 'runAttempt': 1}]},
            'sourceRunId': '71', 'sourceRunAttempt': 2,
        }
        self.upload = {**copy.deepcopy(self.signed), 'uploadRunId': '72', 'uploadRunAttempt': 1}
        self.signing_jobs = [job('build', 'success'), job('testflight-upload', 'skipped')]
        self.upload_jobs = [job('build', 'skipped'), job('testflight-upload', 'success')]

    def run_split(self):
        records = {'71': (release('71', 2), self.signing_jobs), '72': (release('72'), self.upload_jobs)}
        def fetch(path):
            run_id, *rest = path.split('/runs/')[1].split('/')
            run, jobs = records[run_id]
            if rest:
                self.assertEqual(rest, ['attempts', str(run['run_attempt']), 'jobs?per_page=100'])
                return {'jobs': jobs}
            return run
        with patch.dict(scope, api=fetch, signing_receipt=lambda run_id: self.signed if run_id == '71' else None):
            verify(self.upload, '71', 2, '72', 1)

    def test_separate_runs_match_original_artifact(self):
        self.run_split()

    def test_rejects_wrong_job_or_ambiguous_job(self):
        for jobs, name, conclusion in ((self.signing_jobs, 'build', 'failure'), (self.signing_jobs, 'testflight-upload', 'success'),
                                       (self.upload_jobs, 'build', 'success'), (self.upload_jobs, 'testflight-upload', 'skipped')):
            entry = next(j for j in jobs if j['name'] == name)
            with self.subTest(name=name, conclusion=conclusion), patch.dict(entry, conclusion=conclusion), self.assertRaises(ValueError):
                self.run_split()
        self.upload_jobs.append(job('testflight-upload', 'success'))
        with self.assertRaises(ValueError):
            self.run_split()

    def test_successful_job_cannot_mask_skipped_signing_receipt_or_upload(self):
        for jobs, label in [(self.signing_jobs, 'Save signing verification receipt'), (self.upload_jobs, 'Save package verification receipt'),
                            (self.upload_jobs, 'Upload to TestFlight')]:
            step = next(step for j in jobs if j['conclusion'] == 'success' for step in j['steps'] if step['name'] == label)
            with self.subTest(label=label), patch.dict(step, conclusion='skipped'), self.assertRaises(ValueError):
                self.run_split()

    def test_unsigned_or_changed_package_is_rejected(self):
        for key, value in [('ipaSha256', 'd' * 64), ('bundles', []), ('sourceCommit', 'e' * 40),
                           ('signatureVerification', 'failed'), ('lightningNetwork', 'regtest'),
                           ('qualification', {'sourceCommit': source, 'gates': []})]:
            with self.subTest(key=key), patch.dict(self.signed, {key: value}), self.assertRaises(ValueError):
                self.run_split()

    def test_wrong_missing_or_boolean_attempt_is_rejected(self):
        for key, value in [('sourceRunId', '70'), ('uploadRunId', '71'), ('sourceRunAttempt', 1),
                           ('uploadRunAttempt', 2), ('uploadRunAttempt', True)]:
            with self.subTest(key=key), patch.dict(self.upload, {key: value}), self.assertRaises(ValueError):
                self.run_split()
        del self.upload['sourceRunAttempt']
        with self.assertRaises(ValueError):
            self.run_split()

    def test_legacy_run_needs_both_jobs_and_never_downloads_an_unlinked_artifact(self):
        legacy = module['LEGACY_RUN']
        jobs = [job('build', 'success'), job('testflight-upload', 'success')]
        with patch.dict(scope, latest_attempt=lambda *_: (release(legacy), jobs),
                        signing_receipt=lambda *_: self.fail('Unlinked historical signing artifact requested')):
            verify({}, legacy, 1, legacy, 1)
            with self.assertRaises(ValueError):
                verify({}, legacy, 2, legacy, 1)
            jobs.pop(0)
            with self.assertRaises(ValueError):
                verify({}, legacy, 1, legacy, 1)

    def test_new_combined_retry_checks_the_original_build(self):
        upload = {**self.upload, 'sourceRunAttempt': 1, 'uploadRunId': '71', 'uploadRunAttempt': 2}
        signed = {**self.signed, 'sourceRunAttempt': 1}
        build = {**job('build', 'success'), 'run_id': 71, 'run_attempt': 1, 'head_sha': orchestration,
                 'steps': [{'name': 'Save signing verification receipt', 'conclusion': 'success'}]}
        with patch.dict(scope, latest_attempt=lambda *_: (release('71', 2), [job('testflight-upload', 'success')]),
                        signing_receipt=lambda *_: signed), patch('subprocess.check_output', return_value=json.dumps({'jobs': [build]})) as api:
            verify(upload, '71', 1, '71', 2)
            self.assertIn('/attempts/1/jobs', api.call_args.args[0][-1])
            with self.assertRaises(ValueError):
                verify(upload, '71', 2, '71', 2)

    def test_run_identity_and_attempt_are_checked_before_any_job_query(self):
        for change in ({'head_sha': 'e' * 40}, {'path': 'wrong.yml'}, {'event': 'pull_request'}, {'head_branch': 'feature'},
                       {'status': 'in_progress'}, {'conclusion': 'cancelled'}, {'run_attempt': 2}, {'id': 70},
                       {'repository': {'full_name': 'other/project'}}, {'head_repository': {'full_name': 'other/project'}}):
            with self.subTest(change=change), patch.dict(scope, api=lambda _: {**release('72'), **change}), self.assertRaises(ValueError):
                module['latest_attempt']('72', 1)

    def test_new_release_requires_hardware_tor_smoke_and_standalone_tor_fee(self):
        qualification = module['qualification']
        ids = {'CI_RUN_ID': '81', 'IOS_RUN_ID': '82', 'FUNDED_IOS_RUN_ID': '83',
               'LND_IOS_RUN_ID': '84', 'HARDWARE_IOS_RUN_ID': '88'}
        rules = module['gates']['required_gates'](mainnet=True, tor_smoke=True, tor_fee_unit=True, standard_hardware=True)
        records = {}
        for name, path, names in rules:
            run_id = ids[name]
            run = {**release(run_id), 'head_sha': source, 'path': path, 'html_url': 'fixture'}
            records[run_id] = (run, [job(n, 'success') for n in names])
        def fetch(path):
            run_id, *rest = path.split('/runs/')[1].split('/')
            record, jobs = records[run_id]
            return {'jobs': jobs} if rest else record
        with patch.dict(scope, api=fetch):
            self.assertEqual(len(qualification(ids, legacy=False)), 5)
            with self.assertRaises(ValueError):
                qualification({key: value for key, value in ids.items() if key != 'HARDWARE_IOS_RUN_ID'}, legacy=False)
            for name, required in [('HARDWARE_IOS_RUN_ID', 'Watch-only signing on iOS simulator'), ('LND_IOS_RUN_ID', 'tor-smoke'),
                                   ('LND_IOS_RUN_ID', 'tor-fee-unit')]:
                bad = next(j for j in records[ids[name]][1] if j['name'] == required)
                with self.subTest(required=required), patch.dict(bad, conclusion='skipped'), self.assertRaises(RuntimeError):
                    qualification(ids, legacy=False)

    def test_download_selects_only_the_signing_receipt(self):
        def fake_download(command, check):
            self.assertTrue(check)
            self.assertEqual(command[:-1], ['gh', 'run', 'download', '71', '--repo', module['REPO'], '--name', 'ios-build-verification', '--dir'])
            (Path(command[-1]) / 'ios-ipa-verification.json').write_text(json.dumps(self.signed))
        with patch('subprocess.run', side_effect=fake_download):
            self.assertEqual(module['signing_receipt']('71'), self.signed)


if __name__ == '__main__':
    unittest.main()
