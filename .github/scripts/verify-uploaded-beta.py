#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed native gates."""
import json
import os
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '32c54888ee383cc1fe418b7c5968376dfeadd71d'
ORCHESTRATION = '3b775d3ad2e8af31a93d5ee6464a3178341fed0c'
UPLOAD_RUN = '37203666704'

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
for rid in ['37198159377', '37198159386', '37198159406']:
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{rid}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO
    assert data['head_sha'] == PUBLIC and data['status'] == 'completed' and data['conclusion'] == 'success', 'Native/unit gate did not pass'
receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'ipaSha256': '20f97d1775245fc6d80c7b576021f5ec2ce3747105fea5087efd5409c9ef9544',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': 'e8f5512062c0bfa5da4c7b86ba1ee423bb898ba3',
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': 'ff91f542e77c912d69b48d40c834eabc42c838e4924232e33f52d6bb00b59157',
    'productionPathCount': 945,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1791117525' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed native/unit gates verified')
