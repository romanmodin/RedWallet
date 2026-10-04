#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed native gates."""
import json
import os
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '71697797a2967718adeba19d82160422885d59db'
ORCHESTRATION = '10720d07c36eace3f7e27aca828f75d0ea7a1fca'
UPLOAD_RUN = '37214109044'

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
for rid in ['37207037717', '37207037746', '37207037709']:
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{rid}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO
    assert data['head_sha'] == PUBLIC and data['status'] == 'completed' and data['conclusion'] == 'success', 'Native/unit gate did not pass'
receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'ipaSha256': '922a612f31d03d72ad602dce3600593a59c4814df64ddf744e7868d1bbb37c34',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': 'e4ea8deccdd1bc3e1728b6d52e27985ef0a83467',
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': '1258feff0a9579ce623c2c37682a43ca192c163ac29c7df8766a6ace75a8c7c1',
    'productionPathCount': 945,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1791127611' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed native/unit gates verified')
