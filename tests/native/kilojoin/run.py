"""Compile pinned upstream Kotlin crypto, verify RedWallet transactions, export Kotlin signatures.
No relay, node, funds or Android JNI. Arguments: source_dir kotlinc java redwallet_tsv output_json.
Run the session unit test with KILOJOIN_INTEROP_OUTPUT pointing to a NEW TSV first.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source, compiler, java, vectors, output = map(Path, sys.argv[1:])
here = Path(__file__).resolve().parent
manifest = json.loads((here / 'source-sha256.json').read_text())
for name, expected in manifest.items():
    if hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Pinned Kotlin source hash mismatch: ' + name)
with tempfile.TemporaryDirectory(prefix='redwallet-kilojoin-interop-') as temporary:
    jar = Path(temporary) / 'interop.jar'
    environment = dict(os.environ, JAVA_HOME=str(java.resolve().parent.parent))
    subprocess.run([str(compiler), *[str(source / name) for name in manifest],
                    str(here / 'ArkNativeStub.kt'), str(here / 'Interop.kt'),
                    '-include-runtime', '-d', str(jar)], env=environment, check=True)
    subprocess.run([str(java), '-jar', str(jar), str(vectors), str(output)], check=True)
