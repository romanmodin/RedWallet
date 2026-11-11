#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed iOS gates."""
import json
import os
import runpy
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = 'f2901defedc0a1571a935b0f775da800bf4f9834'
ORCHESTRATION = 'ad0f0113f984e8e41d1e86bd220e7d7804c0856b'
UPLOAD_RUN = '43061907456'


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path]))


def run(run_id, expected_head, expected_path):
    data = api(f'repos/{REPO}/actions/runs/{run_id}')
    assert data['repository']['full_name'] == REPO and data['head_repository']['full_name'] == REPO, 'Wrong repository'
    assert data['head_sha'] == expected_head and data['path'] == expected_path, 'Wrong source/workflow'
    assert data['status'] == 'completed' and data['conclusion'] == 'success', 'Required run did not pass'
    return data


assert os.environ['UPLOAD_RUN_ID'] == UPLOAD_RUN, 'Only the reviewed upload run is authorized'
upload = run(UPLOAD_RUN, ORCHESTRATION, '.github/workflows/build-ios-approved-source.yml')
assert upload['event'] == 'workflow_dispatch' and upload['head_branch'] == 'main', 'Wrong release event'
assert upload['run_attempt'] == 1, 'A replacement upload attempt requires fresh receipt review'
# A successful workflow cannot substitute for both actual build and upload jobs.
jobs = api(f"repos/{REPO}/actions/runs/{UPLOAD_RUN}/attempts/{upload['run_attempt']}/jobs?per_page=100")['jobs']
for required in ('build', 'testflight-upload'):
    assert any(j['name'] == required and j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs), 'Required release job did not pass'

# Reuse the release verifier so older attempts, different workflows, and skipped
# required jobs cannot qualify the candidate for tester delivery.
verifier = runpy.run_path(str(Path(__file__).with_name('verify-ios-release-gates.py')))
gate_receipts = []
for rid, (_, workflow, required_jobs) in zip(
    ('43044908715', '43044908533', '43044902381', '43044908997'),
    verifier['required_gates'](mainnet=True),
    strict=True
):
    gate = api(f'repos/{REPO}/actions/runs/{rid}')
    gate_jobs = api(f"repos/{REPO}/actions/runs/{rid}/attempts/{gate['run_attempt']}/jobs?per_page=100")['jobs']
    gate_receipts.append(verifier['validate_gate'](gate, gate_jobs, PUBLIC, workflow, required_jobs))

receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'lightningNetwork': 'mainnet',
    'ipaSha256': '9656562949989249b2b4240fce8ad7fc5ee03641b0b3cfd479eb341c7c1775ce',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': PUBLIC,
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': '4c98cfa23a3dccd95f199297794fc1f434c090c9655f49cc3691fb9a75db3b1e',
    'productionPathCount': 1104,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
assert receipt['qualification']['sourceCommit'] == PUBLIC
assert receipt['qualification']['gates'] == gate_receipts, 'Package qualification differs from current gate attempts'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1794416109' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed iOS/software gates verified')
