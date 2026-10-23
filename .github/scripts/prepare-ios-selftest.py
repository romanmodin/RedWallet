"""Create and boot a disposable simulator before the full wallet test process."""
import json
import os
import plistlib
import re
from pathlib import Path
import subprocess
import uuid


def prepare(run=subprocess.check_output, config_path=Path('.detoxrc.json'), prototype_id=None):
    def command(*args, timeout=30):
        return run(['xcrun', 'simctl', *args], text=True, timeout=timeout, stderr=subprocess.STDOUT).strip()

    prototype_id = prototype_id or os.environ.get('REDWALLET_PREBOOT_SIMULATOR')
    uuid.UUID(prototype_id or '')
    config = json.loads(config_path.read_text())
    # Validate the exact release artifact before changing either simulator.
    binary_path = (config_path.parent / config['apps']['ios.release']['binaryPath']).resolve()
    with (binary_path / 'Info.plist').open('rb') as info:
        bundle_id = plistlib.load(info)['CFBundleIdentifier']
    if bundle_id != 'com.romanmodin.redwallet':
        raise ValueError('Unexpected self-test app bundle identifier')
    device_type = config['devices']['simulator']['device']['type']
    types = json.loads(command('list', 'devicetypes', '-j'))['devicetypes']
    selected = next(t['identifier'] for t in types if t['name'] == device_type)
    devices = json.loads(command('list', 'devices', '-j'))['devices']
    matches = [(runtime, device) for runtime, group in devices.items()
               for device in group if device['udid'] == prototype_id]
    if len(matches) != 1:
        raise ValueError('Expected exactly one preboot simulator')
    runtime, prototype = matches[0]
    if prototype.get('state') != 'Booted' or prototype.get('deviceTypeIdentifier') != selected:
        raise ValueError('Preboot simulator type/state does not match')
    # TLS has exited. Stop only this job's selected simulator before booting
    # another; preserve the exact runtime that already passed TLS and artwork.
    command('shutdown', prototype_id)
    device_id = command('create', 'RedWallet-selftest-' + uuid.uuid4().hex, selected, runtime)
    uuid.UUID(device_id)
    command('boot', device_id)
    # A newly erased simulator needed >150s for first-boot migration in run
    # 39513793887. Bound provisioning separately; test assertion deadlines stay unchanged.
    command('bootstatus', device_id, '-b', timeout=300)
    # --reuse deliberately skips Detox's install phase. Install once on this
    # never-used device before the test; do not terminate a nonexistent app.
    command('install', device_id, str(binary_path), timeout=120)
    installed_path = command('get_app_container', device_id, bundle_id, 'app')
    if not Path(installed_path).is_absolute() or Path(installed_path).name != binary_path.name:
        raise ValueError('Self-test app installation could not be verified')
    config['devices']['simulator']['device'] = {'id': device_id}
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    return {
        'deviceId': device_id, 'createdFresh': True, 'bootCompleted': True,
        'appInstalled': True, 'appLaunched': False, 'bundleId': bundle_id,
        'binaryPath': str(binary_path), 'installedPath': installed_path,
    }


def checked_out_source(run=subprocess.check_output):
    # GITHUB_SHA on pull_request is the synthetic merge SHA, while this workflow
    # explicitly checks out the PR head. Record the source actually on disk.
    source = run(['git', 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('Invalid checked-out self-test source')
    return source


if __name__ == '__main__':
    try:
        source = checked_out_source()
        receipt = prepare()
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        Path('artifacts').mkdir(exist_ok=True)
        output = error.output or b''
        if isinstance(output, bytes):
            output = output.decode(errors='replace')
        Path('artifacts/selftest-provision-failure.log').write_text(output)
        print(output, flush=True)
        raise
    Path('artifacts').mkdir(exist_ok=True)
    receipt['sourceCommit'] = source
    receipt['workflowCommit'] = os.environ.get('GITHUB_SHA')
    Path('artifacts/selftest-simulator.json').write_text(json.dumps(receipt, indent=2) + '\n')
    Path('selftest-simulator-id.txt').write_text(receipt['deviceId'] + '\n')
