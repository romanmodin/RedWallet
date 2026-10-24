"""Create and boot a disposable simulator before the full wallet test process."""
import json
import os
import plistlib
import re
import sys
from pathlib import Path
import subprocess
import uuid
import time


def traced_command(run, args, timeout):
    """Retain provisioning output without retrying or changing command deadlines."""
    started = time.monotonic()
    row = {'command': args, 'timeoutSeconds': timeout}
    try:
        result = run(args, text=True, timeout=timeout, stderr=subprocess.STDOUT)
        row.update(status='success', output=result)
        return result.strip()
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        output = error.output or ''
        if isinstance(output, bytes):
            output = output.decode(errors='replace')
        row.update(status='failure', errorType=type(error).__name__, output=output)
        raise
    finally:
        row['elapsedSeconds'] = round(time.monotonic() - started, 3)
        trace = os.environ.get('REDWALLET_SIMULATOR_TRACE')
        if trace:
            path = Path(trace)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('a') as stream:
                stream.write(json.dumps(row) + '\n')


def prepare(run=subprocess.check_output, config_path=Path('.detoxrc.json'), prototype_id=None, park=False, cold=False):
    def command(*args, timeout=30):
        return traced_command(run, ['xcrun', 'simctl', *args], timeout)

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
    allowed_states = {'Booted', 'Shutdown'} if park or cold else {'Booted'}
    if prototype.get('state') not in allowed_states or prototype.get('deviceTypeIdentifier') != selected:
        raise ValueError('Preboot simulator type/state does not match')
    # In park mode, inventory and prepare the disposable simulator before the
    # original's first boot. Listing types after first-boot migration stalled in
    # 40025524053. Keep the same bounded commands and reject transitional states.
    # Explicit --fresh also accepts a shutdown prototype, using the new device
    # immediately without the park/reboot handoff. Legacy direct mode is unchanged.
    if prototype['state'] == 'Booted':
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
    if park:
        # Complete first-boot migration before artwork/TLS load, then leave the
        # installed app never launched and the fresh simulator shut down.
        command('shutdown', device_id)
        command('boot', prototype_id)
        command('bootstatus', prototype_id, '-b', timeout=300)
        # Two devices now share the type. Keep artwork/TLS on the warmed original;
        # a type-only selector can accidentally boot and contaminate the parked twin.
        config['devices']['simulator']['device'] = {'id': prototype_id}
        config_path.write_text(json.dumps(config, indent=2) + '\n')
    else:
        config['devices']['simulator']['device'] = {'id': device_id}
        config_path.write_text(json.dumps(config, indent=2) + '\n')
    return {
        'deviceId': device_id, 'createdFresh': True, 'bootCompleted': True,
        'parked': park, 'prototypeId': prototype_id, 'runtime': runtime, 'deviceType': selected,
        'appInstalled': True, 'appLaunched': False, 'bundleId': bundle_id,
        'binaryPath': str(binary_path), 'installedPath': installed_path,
    }



def activate(receipt, source, run=subprocess.check_output, config_path=Path('.detoxrc.json')):
    def command(*args, timeout=30):
        return traced_command(run, ['xcrun', 'simctl', *args], timeout)

    device_id, prototype_id = receipt['deviceId'], receipt['prototypeId']
    uuid.UUID(device_id)
    uuid.UUID(prototype_id)
    if device_id == prototype_id or receipt.get('sourceCommit') != source:
        raise ValueError('Prepared simulator identity/source mismatch')
    if not all(receipt.get(k) is True for k in ['createdFresh', 'bootCompleted', 'appInstalled', 'parked']):
        raise ValueError('Prepared simulator is not verified and parked')
    if receipt.get('appLaunched') is not False or receipt.get('bundleId') != 'com.romanmodin.redwallet':
        raise ValueError('Prepared simulator app state mismatch')
    config = json.loads(config_path.read_text())
    if config['devices']['simulator']['device'] != {'id': prototype_id}:
        raise ValueError('Original simulator selection changed before activation')
    binary = (config_path.parent / config['apps']['ios.release']['binaryPath']).resolve()
    if receipt.get('binaryPath') != str(binary):
        raise ValueError('Prepared simulator artifact path mismatch')
    devices = json.loads(command('list', 'devices', '-j'))['devices']
    matches = [(runtime, d) for runtime, group in devices.items() for d in group if d['udid'] == device_id]
    if len(matches) != 1:
        raise ValueError('Prepared simulator not uniquely present')
    runtime, selected = matches[0]
    if (runtime != receipt['runtime'] or selected.get('state') != 'Shutdown'
            or selected.get('deviceTypeIdentifier') != receipt['deviceType']):
        raise ValueError('Prepared simulator runtime/type/state mismatch')
    command('shutdown', prototype_id)
    command('boot', device_id)
    command('bootstatus', device_id, '-b', timeout=300)
    installed = command('get_app_container', device_id, receipt['bundleId'], 'app')
    if installed != receipt['installedPath']:
        raise ValueError('Prepared app container changed')
    config['devices']['simulator']['device'] = {'id': device_id}
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    return {**receipt, 'parked': False, 'activated': True}


def checked_out_source(run=subprocess.check_output):
    # GITHUB_SHA on pull_request is the synthetic merge SHA, while this workflow
    # explicitly checks out the PR head. Record the source actually on disk.
    source = run(['git', 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('Invalid checked-out self-test source')
    return source


def record_failure(error, source, directory=Path('artifacts')):
    directory.mkdir(exist_ok=True)
    output = error.output or b''
    if isinstance(output, bytes):
        output = output.decode(errors='replace')
    # A timed-out simctl may emit nothing. Keep the failed command and deadline
    # independently of stdout so the next hosted failure is still diagnosable.
    details = {
        'sourceCommit': source, 'errorType': type(error).__name__, 'command': error.cmd,
        'timeoutSeconds': getattr(error, 'timeout', None),
        'returnCode': getattr(error, 'returncode', None), 'output': output,
    }
    (directory / 'selftest-provision-failure.json').write_text(json.dumps(details, indent=2) + '\n')
    (directory / 'selftest-provision-failure.log').write_text(str(error) + '\n' + output)
    print(str(error) + '\n' + output, flush=True)


if __name__ == '__main__':
    os.environ['REDWALLET_SIMULATOR_TRACE'] = 'artifacts/selftest-command-trace.jsonl'
    source = None
    try:
        source = checked_out_source()
        mode = sys.argv[1] if len(sys.argv) == 2 else ''
        if mode == '--activate':
            receipt = activate(json.loads(Path('artifacts/selftest-prepared.json').read_text()), source)
        elif mode in ['', '--park', '--fresh']:
            receipt = prepare(park=mode == '--park', cold=mode == '--fresh')
        else:
            raise ValueError('Unexpected simulator preparation mode')
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        record_failure(error, source)
        raise
    Path('artifacts').mkdir(exist_ok=True)
    receipt['sourceCommit'] = source
    receipt['workflowCommit'] = os.environ.get('GITHUB_SHA')
    receipt_path = 'artifacts/selftest-prepared.json' if mode == '--park' else 'artifacts/selftest-simulator.json'
    Path(receipt_path).write_text(json.dumps(receipt, indent=2) + '\n')
    Path('selftest-simulator-id.txt').write_text(receipt['deviceId'] + '\n')
