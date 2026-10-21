"""Create and boot a disposable simulator before the full wallet test process."""
import json
import os
from pathlib import Path
import subprocess
import uuid


def prepare(run=subprocess.check_output, config_path=Path('.detoxrc.json')):
    def command(*args, timeout=30):
        return run(['xcrun', 'simctl', *args], text=True, timeout=timeout).strip()

    config = json.loads(config_path.read_text())
    device_type = config['devices']['simulator']['device']['type']
    types = json.loads(command('list', 'devicetypes', '-j'))['devicetypes']
    selected = next(t['identifier'] for t in types if t['name'] == device_type)
    runtimes = json.loads(command('list', 'runtimes', '-j'))['runtimes']
    available = [r for r in runtimes if r.get('isAvailable') and '.iOS-' in r['identifier']]
    runtime = max(available, key=lambda r: tuple(map(int, r['version'].split('.'))))['identifier']
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
    device_id = prepare()
    Path('artifacts').mkdir(exist_ok=True)
    Path('artifacts/selftest-simulator.json').write_text(json.dumps({
        'deviceId': device_id, 'createdFresh': True, 'bootCompleted': True,
        'sourceCommit': os.environ.get('GITHUB_SHA'),
    }, indent=2) + '\n')
    Path('selftest-simulator-id.txt').write_text(device_id + '\n')
