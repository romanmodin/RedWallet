#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed native gates."""
import json
import os
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '755e6971cff0335134f72920d845367e4d97ae39'
ORCHESTRATION = '3f692c34bf781a282938a2e61f00f9a8b68371d7'
UPLOAD_RUN = '37188039652'

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
for rid in ['37183653234', '37183653224', '37183653246']:
    data = json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPO}/actions/runs/{rid}']))
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO
    assert data['head_sha'] == PUBLIC and data['status'] == 'completed' and data['conclusion'] == 'success', 'Native/unit gate did not pass'
receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'ipaSha256': 'a0040a69a21e15d315f24a0a82cf77fd78608748bbb5a5cd55d7a285f27ca6c7',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': '62b5670a859af20b3e7db1f181c9b7d9352c743d',
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': '28a948b43427a1b832e153b917dac3670b8eb7deb715930c5b87e22acf80887a',
    'productionPathCount': 943,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1791098754' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed native/unit gates verified')
