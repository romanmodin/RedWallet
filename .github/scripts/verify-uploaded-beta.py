#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed native gates."""
import json
import os
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '2572a890cc4aa6b9eef070662ee9e9f30916c625'
ORCHESTRATION = 'dd58f1027ae2d4b34a4d7eff54c8bdb7c575a484'
UPLOAD_RUN = '37893452659'

def run(run_id, expected_head, expected_path):
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{run_id}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO, 'Wrong repository'
    assert data['head_sha'] == expected_head and data['path'] == expected_path, 'Wrong source/workflow'
    assert data['status'] == 'completed' and data['conclusion'] == 'success', 'Required run did not pass'
    return data

assert os.environ['UPLOAD_RUN_ID'] == UPLOAD_RUN, 'Only the reviewed upload run is authorized'
upload = run(UPLOAD_RUN, ORCHESTRATION, '.github/workflows/build-ios-approved-source.yml')
assert upload['event'] == 'workflow_dispatch' and upload['head_branch'] == 'main', 'Wrong release event'
# Run-level success cannot substitute for an actual successful upload job.
jobs = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{UPLOAD_RUN}/jobs?per_page=100']))['jobs']
assert any(j['name'] == 'testflight-upload' and j['conclusion'] == 'success' for j in jobs), 'Upload job did not pass'
for rid in ['37795349200', '37795348924', '37795349143']:
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{rid}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO
    assert data['head_sha'] == PUBLIC and data['status'] == 'completed' and data['conclusion'] == 'success', 'Native/unit gate did not pass'
receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'ipaSha256': 'e1dd2053fb26b5bcccbedfb2177b46d0dc7131b3bc543a61255f12d51a8e4ebb',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': 'b012b8e7481833ad91c9b72bd81af59a0e5c4c41',
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': 'a8e3747e14b55c76a4f4ae13824a295aa8c154fdd5db24de48f02bc8504be992',
    'productionPathCount': 948,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1791526289' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed native/unit gates verified')
