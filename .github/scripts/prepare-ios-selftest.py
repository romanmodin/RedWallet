"""Create and boot a disposable simulator before the full wallet test process."""
import json
import os
from pathlib import Path
import subprocess
import uuid


def prepare(run=subprocess.check_output, config_path=Path('.detoxrc.json'), prototype_id=None):
    def command(*args, timeout=30):
        return run(['xcrun', 'simctl', *args], text=True, timeout=timeout).strip()

    prototype_id = prototype_id or os.environ.get('REDWALLET_PREBOOT_SIMULATOR')
    uuid.UUID(prototype_id or '')
    config = json.loads(config_path.read_text())
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
    config['devices']['simulator']['device'] = {'id': device_id}
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    return device_id


if __name__ == '__main__':
    try:
        device_id = prepare()
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        Path('artifacts').mkdir(exist_ok=True)
        output = error.output or b''
        if isinstance(output, bytes):
            output = output.decode(errors='replace')
        Path('artifacts/selftest-provision-failure.log').write_text(output)
        print(output, flush=True)
        raise
    Path('artifacts').mkdir(exist_ok=True)
    Path('artifacts/selftest-simulator.json').write_text(json.dumps({
        'deviceId': device_id, 'createdFresh': True, 'bootCompleted': True,
        'sourceCommit': os.environ.get('GITHUB_SHA'),
    }, indent=2) + '\n')
    Path('selftest-simulator-id.txt').write_text(device_id + '\n')
