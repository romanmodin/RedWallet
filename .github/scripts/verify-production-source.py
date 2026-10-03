#!/usr/bin/env python3
"""Check the tracked production tree against the reviewed public source mapping.

This is a source identity check, not a reproducible-binary claim.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def production_rows():
    rows = []
    for line in git('ls-tree', '-r', 'HEAD').splitlines():
        path = line.split('\t', 1)[1]
        if path == 'zapstore.yaml' or path.startswith(('.github/', 'tests/', 'fastlane/metadata/')) or path.endswith('.md'):
            continue
        rows.append(line)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--public-commit', required=True)
    parser.add_argument('--expected-hash', required=True)
    parser.add_argument('--receipt', default='reviewed-source-verification.json')
    args = parser.parse_args()
    for value in (args.source_commit, args.public_commit):
        if not re.fullmatch(r'[0-9a-f]{40}', value):
            parser.error('Commit must be a full lowercase Git SHA')
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_hash):
        parser.error('Expected production hash must be SHA-256')
    if git('rev-parse', 'HEAD') != args.source_commit:
        raise RuntimeError('Checkout does not match the approved source commit')
    subprocess.run(['git', 'diff-index', '--quiet', 'HEAD', '--'], check=True)
    rows = production_rows()
    digest = hashlib.sha256(('\n'.join(rows) + '\n').encode()).hexdigest()
    if digest != args.expected_hash:
        raise RuntimeError('Production source differs from the reviewed public tree')
    receipt = {
        'publicRepository': 'https://github.com/romanmodin/RedWallet',
        'publicSourceCommit': args.public_commit,
        'sourceCommit': args.source_commit,
        'productionTreeSha256': digest,
        'productionPathCount': len(rows),
        'sourceMappingVerification': 'passed',
        'treeDefinition': 'git ls-tree -r COMMIT, excluding .github/, tests/, fastlane/metadata/, zapstore.yaml and *.md; includes mode, object ID, path and trailing newline',
        'binaryReproducibilityVerified': False,
    }
    Path(args.receipt).write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
