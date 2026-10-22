"""Actual pinned PoolSession vs RedWallet. Test-only stdio transport and synthetic coins.
Arguments: source_dir kotlinc java json_jar. Requires installed repository dependencies.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
source, compiler, java, json_jar = map(Path, sys.argv[1:])
here = Path(__file__).resolve().parent
root = here.parents[2]
manifest = json.loads((here / 'peer-v4-source-sha256.json').read_text())
for name, expected in manifest.items():
    if hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Pinned Kotlin source hash mismatch: ' + name)
if hashlib.sha256(json_jar.read_bytes()).hexdigest() != '3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796':
    raise SystemExit('Expected Maven Central org.json:json:20250517 jar')
with tempfile.TemporaryDirectory(prefix='redwallet-kilojoin-peer-') as temporary:
    jar = Path(temporary) / 'peer.jar'
    environment = dict(os.environ, JAVA_HOME=str(java.resolve().parent.parent))
    subprocess.run([str(compiler), *[str(source / name) for name in manifest],
                    *[str(here / name) for name in ['ArkNativeStub.kt', 'RelayClientStub.kt', 'PeerV4.kt']],
                    '-cp', str(json_jar), '-include-runtime', '-d', str(jar)], env=environment, check=True)
    environment.update(KILOJOIN_JAVA=str(java), KILOJOIN_PEER_CLASSPATH=os.pathsep.join([str(jar), str(json_jar)]))
    subprocess.run([str(root / 'node_modules/.bin/jest'), 'tests/native/kilojoin/peer-v4.test.ts', '--runInBand'],
                   cwd=root, env=environment, check=True)
