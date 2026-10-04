#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed native gates."""
import json
import os
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '2479c4f5d7b31b2836fa1d3b3d366219bc6f1969'
ORCHESTRATION = '817e20cbfec5548a5958fe9c6d9bd3033749ec06'
UPLOAD_RUN = '37233767699'

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
for rid in ['37227082250', '37227082241', '37227082300']:
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{rid}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO
    assert data['head_sha'] == PUBLIC and data['status'] == 'completed' and data['conclusion'] == 'success', 'Native/unit gate did not pass'
receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'ipaSha256': '4796314f5181e041f42c967e74e36398e6dd78ad8ac6fa4d370259c4120ca76d',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': '87bdf8512c4626aeba34005a013ef1dc2fa209d4',
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': 'd1d57fe1b2439a009f672f98325eb9b78deaf73f4c80c2f0d5744caad8b52c92',
    'productionPathCount': 945,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1791146217' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed native/unit gates verified')
