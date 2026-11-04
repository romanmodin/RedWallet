#!/usr/bin/env python3
"""Verify the immutable uploaded candidate and its completed iOS gates."""
import json
import os
import runpy
import subprocess
from pathlib import Path

REPO = 'romanmodin/RedWallet'
PUBLIC = '656f2ab348ca95259f064045e7c89d60296e0e90'
ORCHESTRATION = '49c0b0857db4dc38ec8878dcf2393dd211560594'
UPLOAD_RUN = '41895465041'


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
    ('41815906819', '41815907354', '41815901073', '41815907091'),
    verifier['required_gates'](mainnet=True),
    strict=True
):
    gate = api(f'repos/{REPO}/actions/runs/{rid}')
    gate_jobs = api(f"repos/{REPO}/actions/runs/{rid}/attempts/{gate['run_attempt']}/jobs?per_page=100")['jobs']
    gate_receipts.append(verifier['validate_gate'](gate, gate_jobs, PUBLIC, workflow, required_jobs))

receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
expected = {
    'lightningNetwork': 'mainnet',
    'ipaSha256': 'ad7f921fb1b648147e76ec73ea8983f5cca212a6ab1b7a01c2b886b1e4605741',
    'publicSourceCommit': PUBLIC,
    'sourceCommit': PUBLIC,
    'orchestrationCommit': ORCHESTRATION,
    'productionTreeSha256': 'da5e1ad4efb72b95da7372d90e325f82e9a3f7f01159ac298010fa94db76eec4',
    'productionPathCount': 1035,
    'signatureVerification': 'passed',
    'sourceMappingVerification': 'passed'
}
assert all(receipt.get(k) == v for k, v in expected.items()), 'Uploaded package receipt does not match'
assert receipt['qualification']['sourceCommit'] == PUBLIC
assert receipt['qualification']['gates'] == gate_receipts, 'Package qualification differs from current gate attempts'
bundles = receipt['bundles']
assert len(bundles) == 2 and {b['bundleId'] for b in bundles} == {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}
assert all(b['version'] == '8.0.1' and b['build'] == '1793820415' and b['architectures'] == ['arm64'] for b in bundles), 'Wrong iPhone package'
print('PASS: uploaded IPA, exact production source, and completed iOS/software gates verified')
