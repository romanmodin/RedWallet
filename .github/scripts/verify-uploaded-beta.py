#!/usr/bin/env python3
"""Verify an uploaded RedWallet package before internal tester distribution."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile

REPO = 'romanmodin/RedWallet'
PUBLIC = '6a5ac5efb64e7bb86e32d2bdcc9c5b6c2d62c703'
ORCHESTRATION = 'e0f53bba19d043def996bda697c50255c7c053f7'
# This historical combined run predates linked signing and upload receipts.
LEGACY_RUN = '43379269059'
SIGNING_RUN = '45508193659'
UPLOAD_RUN = '45515564670'
SIGNING_ATTEMPT = 1
UPLOAD_ATTEMPT = 1
GATE_RUNS = {
    'CI_RUN_ID': '45456843517',
    'IOS_RUN_ID': '45456891729',
    'FUNDED_IOS_RUN_ID': '45456882120',
    'LND_IOS_RUN_ID': '45456843515',
    'HARDWARE_IOS_RUN_ID': '45456872143',
}
RELEASE_WORKFLOW = '.github/workflows/build-ios-approved-source.yml'
gates = runpy.run_path(str(Path(__file__).with_name('verify-ios-release-gates.py')))
handoff = runpy.run_path(str(Path(__file__).with_name('link-ios-upload-receipt.py')))


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path]))


def latest_attempt(run_id, attempt):
    endpoint = f'repos/{REPO}/actions/runs/{run_id}'
    run = api(endpoint)
    if (str(run['id']) != run_id or run['repository']['full_name'] != REPO or run['head_repository']['full_name'] != REPO
            or run['head_sha'] != ORCHESTRATION or run['path'] != RELEASE_WORKFLOW
            or run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main'
            or run['status'] != 'completed' or run['conclusion'] != 'success' or run['run_attempt'] != attempt):
        raise ValueError('Protected release run differs from the reviewed successful attempt')
    jobs = api(f'{endpoint}/attempts/{attempt}/jobs?per_page=100')['jobs']
    return run, jobs


def expect_job(jobs, name, conclusion, successful_steps=()):
    matches = [j for j in jobs if j['name'] == name]
    if len(matches) != 1 or matches[0]['status'] != 'completed' or matches[0]['conclusion'] != conclusion:
        raise ValueError(f'Expected one completed {name} job with conclusion {conclusion}')
    steps = matches[0].get('steps', [])
    for label in successful_steps:
        if [step['conclusion'] for step in steps if step['name'] == label] != ['success']:
            raise ValueError(f'The {name} job must have completed {label}')


def signing_receipt(run_id):
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(['gh', 'run', 'download', run_id, '--repo', REPO, '--name', 'ios-build-verification',
                        '--dir', directory], check=True)
        return json.loads((Path(directory) / 'ios-ipa-verification.json').read_text())


def verify_handoff(receipt, signing_run, signing_attempt, upload_run, upload_attempt):
    _, jobs = latest_attempt(upload_run, upload_attempt)
    expect_job(jobs, 'testflight-upload', 'success', ('Save package verification receipt', 'Upload to TestFlight'))
    if signing_run == upload_run == LEGACY_RUN:
        if signing_attempt != 1 or upload_attempt != 1:
            raise ValueError('The reviewed historical release used its first attempt')
        expect_job(jobs, 'build', 'success', ('Save signing verification receipt',))
        return
    if signing_run != upload_run:
        expect_job(jobs, 'build', 'skipped')
        _, signed_jobs = latest_attempt(signing_run, signing_attempt)
        expect_job(signed_jobs, 'build', 'success', ('Save signing verification receipt',))
        expect_job(signed_jobs, 'testflight-upload', 'skipped')
    original = signing_receipt(signing_run)
    if signing_run == upload_run:
        handoff['combined_signing_attempt'](original, upload_run, upload_attempt, ORCHESTRATION, str(signing_attempt))
    expected = handoff['link_receipts'](original, receipt, signing_run, upload_run, PUBLIC, ORCHESTRATION,
                                        signing_attempt, upload_attempt)
    # The uploaded artifact must already contain the exact, reviewed run IDs and attempts.
    if (expected != receipt or type(receipt.get('sourceRunAttempt')) is not int
            or type(receipt.get('uploadRunAttempt')) is not int):
        raise ValueError('Upload receipt does not record the reviewed signing and upload attempts')


def qualification(run_ids, *, legacy):
    required = gates['required_gates'](mainnet=True, tor_smoke=not legacy,
                                       tor_fee_unit=not legacy, standard_hardware=not legacy)
    if set(run_ids) != {variable for variable, _, _ in required}:
        raise ValueError('The reviewed gate run IDs must cover the full release policy')
    results = []
    for variable, workflow, required_jobs in required:
        run_id = run_ids[variable]
        endpoint = f'repos/{REPO}/actions/runs/{run_id}'
        run = api(endpoint)
        if str(run['id']) != run_id:
            raise ValueError('Qualification run ID differs from the reviewed run')
        jobs = api(f"{endpoint}/attempts/{run['run_attempt']}/jobs?per_page=100")['jobs']
        results.append(gates['validate_gate'](run, jobs, PUBLIC, workflow, required_jobs))
    return results


def main():
    if os.environ['UPLOAD_RUN_ID'] != UPLOAD_RUN:
        raise ValueError('Only the reviewed upload run is authorized')
    receipt = json.loads(Path(os.environ['UPLOAD_RECEIPT_PATH']).read_text())
    verify_handoff(receipt, SIGNING_RUN, SIGNING_ATTEMPT, UPLOAD_RUN, UPLOAD_ATTEMPT)
    gate_receipts = qualification(GATE_RUNS, legacy=SIGNING_RUN == UPLOAD_RUN == LEGACY_RUN)
    expected = {
        'lightningNetwork': 'mainnet',
        'ipaSha256': 'b89426043518e88e256942e7f282b6f7fb457e18bf4aa7304fd215b1b440c8e5',
        'publicSourceCommit': PUBLIC,
        'sourceCommit': PUBLIC,
        'orchestrationCommit': ORCHESTRATION,
        'productionTreeSha256': 'b0ca1fffc5e98d19c1da91d0d39806e4b8b411fd2843a9f5aa276dfbb3131a5a',
        'productionPathCount': 1183,
        'signatureVerification': 'passed',
        'sourceMappingVerification': 'passed',
    }
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ValueError('Uploaded package differs from the reviewed package')
    if receipt['qualification']['sourceCommit'] != PUBLIC or receipt['qualification']['gates'] != gate_receipts:
        raise ValueError('Package qualification differs from the current gate attempts')
    bundles = receipt['bundles']
    if len(bundles) != 2 or {b['bundleId'] for b in bundles} != {'com.romanmodin.redwallet', 'com.romanmodin.redwallet.Stickers'}:
        raise ValueError('Unexpected app or extension')
    if any(b['version'] != '8.0.1' or b['build'] != '1795562313' or b['architectures'] != ['arm64'] for b in bundles):
        raise ValueError('Wrong iPhone package')
    print('PASS: uploaded IPA, exact production source, and completed iOS/software gates verified')


if __name__ == '__main__':
    main()
